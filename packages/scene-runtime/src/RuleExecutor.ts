import type { Behavior, BehaviorAction, Condition, Scalar, SceneDocument } from '@studio/scene-schema';
import { RuntimeState, type ExecutionTrace } from './RuntimeState';

export function matchesCondition(condition:Condition,variables:Record<string,Scalar>,runtime:Record<string,unknown>):boolean {
  if(condition.type==='all')return condition.conditions.every(c=>matchesCondition(c,variables,runtime));
  if(condition.type==='any')return condition.conditions.some(c=>matchesCondition(c,variables,runtime));
  if(condition.type!=='compare')return false;
  const actual=condition.source==='variable'?variables[condition.key]:runtime[condition.key],expected=condition.value;
  switch(condition.operator){case 'eq':return actual===expected;case 'neq':return actual!==expected;case 'gt':return typeof actual==='number'&&typeof expected==='number'&&actual>expected;case 'gte':return typeof actual==='number'&&typeof expected==='number'&&actual>=expected;case 'lt':return typeof actual==='number'&&typeof expected==='number'&&actual<expected;case 'lte':return typeof actual==='number'&&typeof expected==='number'&&actual<=expected;case 'contains':return typeof actual==='string'&&typeof expected==='string'&&actual.includes(expected);}
}
export function abortError():DOMException{return new DOMException('操作已取消','AbortError');}
export function delay(seconds:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(abortError());return;}
  const abort=()=>{clearTimeout(timer);reject(abortError());};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},seconds*1000);signal.addEventListener('abort',abort,{once:true});
});}
export class RuleExecutor {
  private active=new Map<string,{controller:AbortController;promise:Promise<void>}>();
  private queues=new Map<string,number>();
  private fired=new Set<string>();
  private serial=0;
  private epoch=0;
  private cancellations=new Map<string,number>();
  private chains=new WeakMap<AbortSignal,ReadonlySet<string>>();
  private eventWindow={at:0,count:0};
  constructor(private state:RuntimeState,private document:()=>SceneDocument|null,private perform:(action:BehaviorAction,signal:AbortSignal)=>Promise<void>){}
  private runtimeValues():Record<string,unknown>{const s=this.state.getSnapshot();return {viewMode:s.viewMode,displayMode:s.displayMode,'tour.status':s.tour.status,contentId:s.contentId};}
  private trace(ruleId:string,actionId:string,status:ExecutionTrace['status'],message:string):void{
    const trace=[...this.state.getSnapshot().trace,{id:++this.serial,ruleId,actionId,status,message,time:Date.now()}].slice(-200);this.state.patch({trace});
  }
  private matches(condition:Condition):boolean{return matchesCondition(condition,this.state.getSnapshot().variables,this.runtimeValues());}
  async emit(event:string,sourceId:string,sourceKind:string,parentSignal?:AbortSignal):Promise<void>{
    if(this.state.getSnapshot().mode!=='play')return;
    const now=Date.now();if(now-this.eventWindow.at>1000)this.eventWindow={at:now,count:0};
    if(++this.eventWindow.count>256)throw new Error('一秒内事件超过 256 次，已停止循环触发');
    const chain=parentSignal?this.chains.get(parentSignal)??new Set<string>():new Set<string>();
    await Promise.all((this.document()?.behaviors??[]).filter(b=>b.enabled&&b.event===event&&b.sourceId===sourceId&&b.sourceKind===sourceKind).map(b=>this.run(b,chain)));
  }
  async run(rule:Behavior,chain:ReadonlySet<string>=new Set()):Promise<void>{
    if(this.state.getSnapshot().mode!=='play')return;const epoch=this.epoch,cancellation=this.cancellations.get(rule.id)??0;
    if(chain.has(rule.id)||chain.size>=32)throw new Error("检测到循环触发规则："+rule.name);
    if(rule.once&&this.fired.has(rule.id)){this.trace(rule.id,'','skipped','本次播放已执行过该规则');return;}if(!this.matches(rule.condition)){this.trace(rule.id,'','skipped','条件未满足，未执行动作');return;}
    const previous=this.active.get(rule.id);
    if(previous){
      if(rule.concurrency==='ignore'){this.trace(rule.id,'','skipped','规则执行中，已忽略重复触发');return;}
      if(rule.concurrency==='restart'){previous.controller.abort();await previous.promise.catch(error=>{if(error instanceof DOMException&&error.name==='AbortError')return;throw error;});if(epoch!==this.epoch||cancellation!==(this.cancellations.get(rule.id)??0)||this.state.getSnapshot().mode!=='play')return;}
      else {const queued=this.queues.get(rule.id)??0;if(queued>=8){this.trace(rule.id,'','error','规则排队超过 8 次');return;}this.queues.set(rule.id,queued+1);this.trace(rule.id,'','queued','等待前一次执行完成');await previous.promise.catch(error=>{if(error instanceof DOMException&&error.name==='AbortError')return;throw error;});if(epoch!==this.epoch||cancellation!==(this.cancellations.get(rule.id)??0)||this.state.getSnapshot().mode!=='play')return;this.queues.set(rule.id,(this.queues.get(rule.id)??1)-1);return this.run(rule,chain);}
    }
    const controller=new AbortController();this.chains.set(controller.signal,new Set([...chain,rule.id]));
    const promise=Promise.resolve().then(async()=>{
      this.trace(rule.id,'','start',rule.name);
      try{await this.sequence(rule.actions,rule.id,controller.signal,{steps:0});if(controller.signal.aborted)throw abortError();this.fired.add(rule.id);this.trace(rule.id,'','completed','规则执行完成');}
      catch(error){if(epoch!==this.epoch)return;if(controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError')this.trace(rule.id,'','cancelled','规则已取消');else{controller.abort();const message=error instanceof Error?error.message:String(error);this.trace(rule.id,'','error',message);this.state.patch({errors:{...this.state.getSnapshot().errors,[rule.id]:message}});throw error;}}
      finally{if(this.active.get(rule.id)?.controller===controller)this.active.delete(rule.id);}
    });
    this.active.set(rule.id,{controller,promise});await promise;
  }
  async sequence(actions:BehaviorAction[],ruleId:string,signal:AbortSignal,budget={steps:0}):Promise<void>{
    for(const action of actions){
      if(signal.aborted)throw abortError();if(++budget.steps>512)throw new Error('规则单次执行超过 512 步');this.trace(ruleId,action.id,'running',action.type);
      try{
        if(action.type==='If')await this.sequence(this.matches(action.condition!)?action.then??[]:action.else??[],ruleId,signal,budget);
        else if(action.type==='Delay')await delay(Number(action.data.seconds),signal);
        else await this.perform(action,signal);
        if(signal.aborted)throw abortError();this.trace(ruleId,action.id,'completed',action.type);
      }catch(error){this.trace(ruleId,action.id,signal.aborted?'cancelled':'error',error instanceof Error?error.message:String(error));throw error;}
    }
  }
  cancel(ruleId?:string):void{if(ruleId)this.cancellations.set(ruleId,(this.cancellations.get(ruleId)??0)+1);else this.epoch++;for(const [id,run]of this.active)if(!ruleId||id===ruleId)run.controller.abort();}
  reset():void{this.cancel();this.active.clear();this.cancellations.clear();this.fired.clear();this.queues.clear();this.eventWindow={at:0,count:0};}
}
