import { useState } from 'react';
import { actionDefinitions, createAction, type BehaviorAction } from '@studio/scene-schema';
import { Field, Fields } from './Fields';
import { ReferencePicker } from './ReferencePicker';
import { ConditionEditor } from './ConditionEditor';
import { useRuntime } from '@studio/player-ui';
import { useStudio } from '../state/studio';

export function ActionList({actions,onChange,depth=0}:{actions:BehaviorAction[];onChange:(actions:BehaviorAction[])=>void;depth?:number}){
  const document=useStudio(s=>s.document);const [dragged,setDragged]=useState(''),runtime=useStudio(s=>s.runtime),state=useRuntime(runtime);
  const patch=(id:string,change:Partial<BehaviorAction>)=>onChange(actions.map(a=>a.id===id?{...a,...change}:a));
  const duplicate=(action:BehaviorAction)=>{const copy=structuredClone(action);const reId=(action:BehaviorAction)=>{action.id=crypto.randomUUID();action.then?.forEach(reId);action.else?.forEach(reId);};reId(copy);onChange([...actions.slice(0,actions.indexOf(action)+1),copy,...actions.slice(actions.indexOf(action)+1)]);};
  return <div className="rule-actions">{actions.map((action,index)=>{
    const definition=actionDefinitions.find(d=>d.type===action.type)!;const current=[...state.trace].reverse().find(item=>item.actionId===action.id);
    return <article key={action.id} className={'rule-action '+(current?'execution-'+current.status:'')} draggable onDragStart={e=>{e.stopPropagation();setDragged(action.id);}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.stopPropagation();const from=actions.findIndex(a=>a.id===dragged);if(from>=0){const next=[...actions];next.splice(index,0,next.splice(from,1)[0]);onChange(next);}}}>
      <div className="action-card-heading"><strong>{index+1}. {definition.title}</strong><div className="button-group"><button disabled={!index} aria-label="上移动作" onClick={()=>{const next=[...actions];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next);}}>↑</button><button aria-label="复制动作" onClick={()=>duplicate(action)}>复制</button><button aria-label="删除动作" onClick={()=>onChange(actions.filter(a=>a.id!==action.id))}>×</button></div></div>
      {definition.target&&<ReferencePicker kind={definition.target} components={definition.components} value={action.targetId} label="动作目标" onChange={targetId=>patch(action.id,{targetId,...(action.type==='SetVariable'?{data:{value:document?.variables.find(v=>v.id===targetId)?.initial??false}}:{})})}/>}
      {action.type==='SetVariable'?<Field field={{type:document?.variables.find(v=>v.id===action.targetId)?.type??'boolean',title:'设置值'}} value={action.data.value} path={'variable.'+action.id} onChange={value=>patch(action.id,{data:{value}})}/>:<Fields fields={definition.fields} value={action.data} path={'action.'+action.id} onChange={(key,value)=>patch(action.id,{data:{...action.data,[key]:value},...(key==='loop'&&value?{wait:false}:{})})}/>}
      {['FlyTo','PlayAnimation','PlayAudio','StartCruise','ReplayCruise'].includes(action.type)&&<label className="field check"><span>完成后继续</span><input type="checkbox" checked={action.wait} disabled={Boolean(action.data.loop)} onChange={e=>patch(action.id,{wait:e.target.checked})}/></label>}
      {action.type==='If'&&<><ConditionEditor value={action.condition!} onChange={condition=>patch(action.id,{condition})}/><div className="rule-branch"><h4>满足条件时</h4><ActionList actions={action.then??[]} depth={depth+1} onChange={then=>patch(action.id,{then})}/><h4>否则</h4><ActionList actions={action.else??[]} depth={depth+1} onChange={otherwise=>patch(action.id,{else:otherwise})}/></div></>}
      {current?.status==='error'&&<p role="alert" className="danger">{current.message}</p>}
    </article>;
  })}{depth<8&&<select aria-label="添加动作" value="" onChange={e=>{if(e.target.value)onChange([...actions,createAction(e.target.value as BehaviorAction['type'])]);}}><option value="">＋ 添加动作…</option>{actionDefinitions.map(d=><option key={d.type} value={d.type}>{d.title}</option>)}</select>}</div>;
}
