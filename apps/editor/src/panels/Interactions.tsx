import { useState } from 'react';
import { actionDefinitions, createAction, type ActionType, type Behavior, type JsonValue } from '@studio/scene-schema';
import { useStudio } from '../state/studio';
import { Fields, TextField } from '../components/Fields';
export function Interactions(){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),mode=useStudio(s=>s.mode),runtime=useStudio(s=>s.runtime);
  const [tab,setTab]=useState<'events'|'cruise'>('events'),[active,setActive]=useState('');
  if(!document)return <div className="empty-state">打开工程以配置交互</div>;
  const behavior=document.behaviors.find(b=>b.id===active)??document.behaviors.find(b=>b.sourceId===selected[0])??document.behaviors[0];
  const command=useStudio.getState().command;
  const update=(label:string,mutate:(behavior:Behavior)=>void)=>{if(behavior)command({label,mutate:doc=>mutate(doc.behaviors.find(b=>b.id===behavior.id)!)});};
  const routes=document.entities.filter(e=>e.components.some(c=>c.enabled&&['Cruise','Zone','Animation','Audio','Panorama'].includes(c.type)));
  return <section className="panel interactions"><div className="panel-toolbar"><div className="tabs"><button className={tab==='events'?'active':''} onClick={()=>setTab('events')}>事件与动作</button><button className={tab==='cruise'?'active':''} onClick={()=>setTab('cruise')}>巡航与业务</button></div>{tab==='events'&&<button disabled={mode==='play'} onClick={()=>{const id=crypto.randomUUID();command({label:'新增交互',mutate:doc=>{doc.behaviors.push({id,name:'新交互',event:'click',sourceId:selected[0]??'',condition:{once:false,viewMode:'any',displayMode:'any'},actions:[]});}});setActive(id);}}>＋ 新增事件</button>}</div>
    {tab==='events'?<div className="interaction-layout"><nav className="behavior-list" aria-label="事件列表">{document.behaviors.map(item=><button key={item.id} className={behavior?.id===item.id?'active':''} onClick={()=>setActive(item.id)}><span>{item.name}</span><small>{item.event} · {item.actions.length} 个动作</small></button>)}</nav>
      <div className="behavior-detail">{behavior?<fieldset disabled={mode==='play'}>
        <div className="behavior-header"><TextField label="交互名称" value={behavior.name} onChange={value=>update('重命名交互',b=>{b.name=value;})}/><button className="text-button danger" onClick={()=>command({label:'删除交互',mutate:doc=>{doc.behaviors=doc.behaviors.filter(b=>b.id!==behavior.id);}})}>删除</button></div>
        <div className="behavior-grid"><label className="field"><span>触发事件</span><select aria-label="触发事件" value={behavior.event} onChange={event=>update('修改事件',b=>{b.event=event.target.value as Behavior['event'];if(b.event==='ready')b.sourceId='';})}>{[['click','点击'],['enter','进入区域'],['leave','离开区域'],['ready','场景就绪'],['animationEnd','动画完成']].map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label>
          <label className="field"><span>事件源</span><select aria-label="事件源" disabled={behavior.event==='ready'} value={behavior.sourceId} onChange={event=>update('修改事件源',b=>{b.sourceId=event.target.value;})}><option value="">整个场景</option>{document.entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="field check"><span>仅执行一次</span><input type="checkbox" checked={behavior.condition.once} onChange={event=>update('修改条件',b=>{b.condition.once=event.target.checked;})}/></label>
          {(['viewMode','displayMode'] as const).map(key=><label key={key} className="field"><span>{key==='viewMode'?'视角条件':'展示条件'}</span><select aria-label={key} value={behavior.condition[key]} onChange={event=>update('修改条件',b=>{Object.assign(b.condition,{[key]:event.target.value});})}>{(key==='viewMode'?['any','first','third']:['any','solid','xray']).map(value=><option key={value}>{value}</option>)}</select></label>)}
        </div>
        <ol className="action-list">{behavior.actions.map((action,index)=>{
          const definition=actionDefinitions.find(d=>d.type===action.type)!;
          return <li key={index}><div className="action-header"><span>{index+1}. {definition.title}</span><button disabled={index===0} onClick={()=>update('调整动作顺序',b=>{[b.actions[index-1],b.actions[index]]=[b.actions[index],b.actions[index-1]];})}>上移</button><button onClick={()=>update('删除动作',b=>{b.actions.splice(index,1);})}>移除</button></div>
            <label className="field"><span>目标</span><select aria-label={'动作目标 '+index} value={action.targetId} onChange={event=>update('修改动作目标',b=>{b.actions[index].targetId=event.target.value;})}><option value="">未指定</option>{document.entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <Fields fields={definition.fields} value={action.data} path={'action.'+index} onChange={(key,value:JsonValue)=>update('修改动作',b=>{b.actions[index].data[key]=value;})}/>
          </li>;
        })}</ol>
        <select aria-label="添加动作" value="" onChange={event=>{if(event.target.value)update('添加动作',b=>{b.actions.push(createAction(event.target.value as ActionType));});}}><option value="">＋ 添加有序动作</option>{actionDefinitions.map(d=><option key={d.type} value={d.type}>{d.title}</option>)}</select>
      </fieldset>:<div className="empty-state">为对象创建事件，再按顺序添加动作</div>}</div></div>:<div className="business-list">
        {routes.map(entity=><div key={entity.id} className="business-row"><button className="text-button" onClick={()=>useStudio.getState().select([entity.id])}>{entity.name}</button><div className="button-group">{entity.components.filter(c=>c.enabled).map(c=>{
          const action=c.type==='Cruise'?'StartCruise':c.type==='Zone'?'FlyTo':c.type==='Audio'?'PlayAudio':c.type==='Animation'?'PlayAnimation':c.type==='Panorama'?'Panorama':null;
          if(c.type==='Zone')return <select key={c.type} aria-label={'展区视点 '+entity.name} disabled={mode!=='play'} defaultValue="" onChange={event=>void useStudio.getState().run('切换展区',async()=>{const command=createAction('FlyTo');command.targetId=entity.id;command.data.viewId=event.target.value;await runtime?.executeAction(command);})}><option value="">选择展区</option>{(c.data.views as {id:string;name:string}[]).map(view=><option key={view.id} value={view.id}>{view.name}</option>)}</select>;
          return action&&<div key={c.type} className="button-group"><button disabled={mode!=='play'} onClick={()=>void useStudio.getState().run('执行业务',async()=>{const command=createAction(action);command.targetId=entity.id;if(c.type==='Animation'){command.data.clip=c.data.clip;command.data.loop=c.data.loop;}await runtime?.executeAction(command);})}>{componentTitle(c.type)}</button>{['Animation','Audio','Cruise'].includes(c.type)&&<button disabled={mode!=='play'} onClick={()=>void useStudio.getState().run('停止业务',async()=>{const command=createAction(c.type==='Animation'?'PauseAnimation':c.type==='Audio'?'StopAudio':'PauseCruise');command.targetId=entity.id;await runtime?.executeAction(command);})}>{c.type==='Audio'?'停止音频':c.type==='Animation'?'暂停动画':'暂停巡航'}</button>}</div>;
        })}</div></div>)}
        <p className="hint">在属性面板编辑路线、停靠点与业务参数；切换预览后执行。</p>
      </div>}
  </section>;
}
function componentTitle(type:string){return ({Cruise:'播放巡航',Zone:'切换展区',Audio:'播放音频',Animation:'播放动画',Panorama:'进入全景'} as Record<string,string>)[type]??type;}
