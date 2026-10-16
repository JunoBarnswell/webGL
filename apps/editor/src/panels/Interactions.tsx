import { useState } from 'react';
import { createAction, createBehavior, type Behavior, type EventType, type ReferenceKind, type SceneVariable, type SourceKind } from '@studio/scene-schema';
import { contentForEntity } from '@studio/editor-core';
import { useRuntime } from '@studio/player-ui';
import { useStudio } from '../state/studio';
import { TextField } from '../components/Fields';
import { ReferencePicker } from '../components/ReferencePicker';
import { ConditionEditor } from '../components/ConditionEditor';
import { ActionList } from '../components/ActionList';

const events:[EventType,string,SourceKind][]=[['click','点击对象','entity'],['hover','悬停对象','entity'],['enter','进入区域','entity'],['leave','离开区域','entity'],['ready','场景就绪','scene'],['animationEnd','动画完成','entity'],['mediaEnd','音频完成','entity'],['viewpointArrive','到达视点','viewpoint'],['tourEnd','巡航结束','tour'],['variableChange','变量变化','variable'],['uiClick','点击界面','ui'],['uiChange','界面值变化','ui'],['key','按下按键','key']];
export function Interactions(){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),active=useStudio(s=>s.activeRuleId),runtime=useStudio(s=>s.runtime),mode=useStudio(s=>s.mode),state=useRuntime(runtime),[all,setAll]=useState(false);
  if(!document)return <div className="empty-state">打开工程以配置交互</div>;
  const visible=document.behaviors.filter(b=>all||b.id===active||!selected.length||b.sourceKind==='entity'&&b.sourceId===selected[0]);
  const behavior=visible.find(b=>b.id===active)??visible[0];
  const update=(patch:Partial<Behavior>)=>{if(behavior)useStudio.getState().command({label:'编辑交互规则',mutate:doc=>Object.assign(doc.behaviors.find(b=>b.id===behavior.id)!,patch)});};
  const choose=(b:Behavior)=>{if(b.sourceKind==='entity'&&b.sourceId)useStudio.getState().select([b.sourceId]);useStudio.getState().set({activeRuleId:b.id});};
  const template=(kind:'content'|'toggle'|'tour'|'empty')=>{
    const behavior=createBehavior({content:'点击介绍',toggle:'点击切换显隐',tour:'场景就绪后导览',empty:'新交互'}[kind]);behavior.sourceId=selected[0]??'';
    if(kind==='content'){const content=contentForEntity(document,selected[0]);const action=createAction('OpenContent');action.targetId=content?.id??'';behavior.actions=[action];}
    if(kind==='toggle'){const action=createAction('Toggle');action.targetId=selected[0]??'';behavior.actions=[action];}
    if(kind==='tour'){behavior.event='ready';behavior.sourceKind='scene';behavior.sourceId='';const action=createAction('StartCruise');action.targetId=document.tours[0]?.id??'';behavior.actions=[action];}
    useStudio.getState().command({label:'新建交互模板',mutate:doc=>{doc.behaviors.push(behavior);}});useStudio.getState().set({activeRuleId:behavior.id});
  };
  const tryRule=async()=>{if(!behavior||!runtime)return;if(mode==='edit')await useStudio.getState().switchMode();await runtime.tryRule(behavior.id);};
  return <section className="task-panel interaction-task"><div className="task-heading"><span className="section-kicker">事件交互</span><h2>当什么发生，就做什么</h2><p>从模板开始，按需要增加条件和动作。</p></div>
    <div className="rule-template-grid">{[['content','点击介绍'],['toggle','显隐开关'],['tour','自动导览'],['empty','空白规则']].map(([id,title])=><button key={id} disabled={mode==='play'} onClick={()=>template(id as Parameters<typeof template>[0])}>＋ {title}</button>)}</div>
    <label className="field check"><span>查看全部场景规则 · {document.behaviors.length}</span><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/></label>
    <nav className="rule-list" aria-label="交互规则列表">{visible.map(b=><button key={b.id} className={behavior?.id===b.id?'active':''} onClick={()=>choose(b)}><strong>{b.name}</strong><small>{events.find(e=>e[0]===b.event)?.[1]} → {b.actions.length} 个动作</small></button>)}</nav>
    {behavior?<><fieldset disabled={mode==='play'} className="rule-editor"><label className="field stacked"><span>规则名称</span><TextField label="交互名称" value={behavior.name} onChange={name=>update({name})}/></label>
      <div className="rule-sentence"><b>当</b><select aria-label="触发事件" value={behavior.event} onChange={e=>{const config=events.find(item=>item[0]===e.target.value)!;update({event:config[0],sourceKind:config[2],sourceId:config[2]==='entity'?selected[0]??'':''});}}>{events.map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></div>
      {!['scene','key'].includes(behavior.sourceKind)&&<ReferencePicker kind={behavior.sourceKind as ReferenceKind} components={['enter','leave'].includes(behavior.event)?['Trigger']:behavior.event==='mediaEnd'?['Audio']:behavior.event==='animationEnd'?['Animation','Model','Avatar']:[]} value={behavior.sourceId} label="事件来源" onChange={sourceId=>{update({sourceId});if(behavior.sourceKind==='entity'&&sourceId)useStudio.getState().select([sourceId]);useStudio.getState().set({activeRuleId:behavior.id});}}/>}
      {behavior.sourceKind==='key'&&<label className="field"><span>键盘 code</span><TextField label="触发按键" value={behavior.sourceId} onChange={sourceId=>update({sourceId})}/></label>}
      <h3>如果</h3><ConditionEditor value={behavior.condition} onChange={condition=>update({condition})}/><h3>就按顺序执行</h3><ActionList actions={behavior.actions} onChange={actions=>update({actions})}/>
      <details><summary>执行设置</summary><label className="field check"><span>启用规则</span><input type="checkbox" checked={behavior.enabled} onChange={e=>update({enabled:e.target.checked})}/></label><label className="field check"><span>本次播放仅执行一次</span><input type="checkbox" checked={behavior.once} onChange={e=>update({once:e.target.checked})}/></label><label className="field"><span>执行中再次触发</span><select aria-label="规则重复触发策略" value={behavior.concurrency} onChange={e=>update({concurrency:e.target.value as Behavior['concurrency']})}><option value="ignore">忽略重复触发</option><option value="restart">取消前次并重启</option><option value="queue">排队执行</option></select></label></details>
      <button className="text-button danger" onClick={()=>useStudio.getState().command({label:'删除规则',mutate:doc=>{doc.behaviors=doc.behaviors.filter(b=>b.id!==behavior.id);}})}>删除规则</button>
    </fieldset><div className="task-actions"><button className="primary" onClick={()=>void tryRule().catch(error=>useStudio.getState().set({message:String(error)}))}>▶ 试运行这条规则</button><button onClick={()=>runtime?.cancelRule(behavior.id)}>取消执行</button></div></>:<div className="empty-state">当前对象还没有规则，选择一个模板开始。</div>}
    <VariableEditor/>
    <details className="execution-log" open={mode==='play'}><summary>执行记录 · {state.trace.length}</summary>{state.trace.slice(-30).map(item=><button key={item.id} className={'trace-'+item.status} onClick={()=>{const rule=document.behaviors.find(r=>r.id===item.ruleId);if(rule){setAll(true);choose(rule);}}}><time>{new Date(item.time).toLocaleTimeString()}</time><span>{item.status} · {item.message}</span></button>)}</details>
  </section>;
}
function VariableEditor(){
  const variables=useStudio(s=>s.document?.variables)??[],mode=useStudio(s=>s.mode);const update=(id:string,patch:Partial<SceneVariable>)=>useStudio.getState().command({label:'编辑状态变量',mutate:doc=>Object.assign(doc.variables.find(v=>v.id===id)!,patch)});
  return <details className="variable-editor"><summary>场景状态变量 · {variables.length}</summary><fieldset disabled={mode==='play'}>{variables.map(variable=><div className="variable-row" key={variable.id}><TextField label="变量名称" value={variable.name} onChange={name=>update(variable.id,{name})}/><select aria-label="变量类型" value={variable.type} onChange={e=>{const type=e.target.value as SceneVariable['type'];update(variable.id,{type,initial:type==='boolean'?false:type==='number'?0:''});}}><option value="boolean">是 / 否</option><option value="number">数字</option><option value="string">文字</option></select>{variable.type==='boolean'?<input type="checkbox" aria-label="变量初始值" checked={variable.initial===true} onChange={e=>update(variable.id,{initial:e.target.checked})}/>:<TextField label="变量初始值" value={String(variable.initial)} type={variable.type==='number'?'number':'text'} onChange={v=>update(variable.id,{initial:variable.type==='number'?Number(v):v})}/>}</div>)}<button onClick={()=>useStudio.getState().command({label:'添加变量',mutate:doc=>{doc.variables.push({id:crypto.randomUUID(),name:'新变量',type:'boolean',initial:false});}})}>＋ 添加状态变量</button></fieldset></details>;
}
