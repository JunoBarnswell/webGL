import { useEffect, useState } from 'react';
import { createAction, getComponent, type ActionType, type BehaviorAction, type SceneDocument, type UiNode } from '@studio/scene-schema';
import type { RuntimeSnapshot, SceneRuntime } from '@studio/scene-runtime';

export interface BusinessControlProps { node:UiNode; document:SceneDocument; runtime:SceneRuntime|null; state:RuntimeSnapshot; contentId:string; design:boolean; run:(action:BehaviorAction)=>void; onError:(error:unknown)=>void }
export function BusinessControls({node,document:doc,runtime,state,contentId,design,run,onError}:BusinessControlProps){
  const [choice,setChoice]=useState('');
  const action=(type:ActionType,id='',data:BehaviorAction['data']={})=>{const command=createAction(type);command.targetId=id;Object.assign(command.data,data);run(command);};
  const disabled=design||state.mode!=='play';
  const selectedContent=doc.contents.find(c=>c.id===contentId);
  useEffect(()=>()=>{if(node.kind==='movement')runtime?.setMovement(0,0);},[runtime,node.kind]);
  if(node.kind==='tourControls'){
    const tours=doc.tours.filter(t=>!node.targetId||t.id===node.targetId);if(!tours.length)return design?<span>巡航控制 · 录制路线后可用</span>:null;
    const id=tours.some(t=>t.id===choice)?choice:tours.some(t=>t.id===state.tour.id)?state.tour.id:tours[0].id;
    const active=state.tour.id===id,status=active?state.tour.status:'stopped';
    return <div className="player-tour-controls"><select aria-label="选择巡航路线" value={id} disabled={design} onChange={e=>setChoice(e.target.value)}>{tours.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><div className="player-control-row"><button disabled={disabled} onClick={()=>action(status==='paused'?'ResumeCruise':status==='playing'?'PauseCruise':status==='completed'?'ReplayCruise':'StartCruise',id)}>{status==='paused'?'继续':status==='playing'?'暂停':status==='completed'?'重播':'播放巡航'}</button><button disabled={disabled||!active||status==='stopped'} onClick={()=>action('StopCruise',id)}>停止</button><button disabled={disabled} onClick={()=>action('ReplayCruise',id)}>从头播放</button></div><label className="player-progress"><input type="range" aria-label="巡航进度" min="0" max="1" step="0.001" value={active?state.tour.progress:0} disabled={disabled} onChange={e=>action('SeekCruise',id,{progress:Number(e.target.value)})}/><span>{Math.round((active?state.tour.progress:0)*100)}%</span></label></div>;
  }
  if(node.kind==='viewpointList'){
    const ids=new Set(doc.entities.flatMap(e=>(getComponent(e,'Zone')?.data.viewpointIds as string[]|undefined)??[]));
    const views=doc.viewpoints.filter(v=>node.targetId?v.id===node.targetId:ids.has(v.id));if(!views.length)return design?<span>展区视点 · 记录后可用</span>:null;
    return <select aria-label="展区导航" disabled={disabled} value="" onChange={e=>{if(e.target.value)action('FlyTo',e.target.value,{duration:1.5});}}><option value="">前往展区…</option>{views.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>;
  }
  if(node.kind==='viewMode')return <button disabled={disabled} onClick={()=>action('ViewMode','',{mode:state.viewMode==='first'?'third':'first'})}>{state.viewMode==='first'?'切换第三人称':'切换第一人称'}</button>;
  if(node.kind==='displayMode')return <button disabled={disabled} onClick={()=>action('DisplayMode','',{mode:state.displayMode==='solid'?'xray':'solid'})}>{state.displayMode==='solid'?'X-Ray 展示':'实体展示'}</button>;
  if(node.kind==='audioControls'){
    const target=node.binding==='content.audio'?selectedContent?.audioEntityId:node.targetId;
    const audio=doc.entities.filter(e=>getComponent(e,'Audio')&&(!target||e.id===target));
    if(node.binding==='content.audio'&&!target)return null;
    if(!audio.length)return design?<span>音频控制 · 绑定音频后可用</span>:null;
    return <div className="player-media-controls">{audio.map(entity=>{const media=state.media[entity.id],playing=media?.status==='playing';return <div key={entity.id}><button disabled={disabled} onClick={()=>action(playing?'StopAudio':'PlayAudio',entity.id)}>{playing?'停止':'播放'} · {entity.name}</button><input aria-label={entity.name+' 音量'} type="range" min="0" max="1" step=".05" value={media?.volume??Number(getComponent(entity,'Audio')!.data.volume)} disabled={disabled} onChange={e=>action('SetVolume',entity.id,{volume:Number(e.target.value)})}/></div>;})}</div>;
  }
  if(node.kind==='animationControls'){
    const entities=doc.entities.filter(e=>getComponent(e,'Animation')&&(!node.targetId||e.id===node.targetId));if(!entities.length)return design?<span>动画控制 · 绑定模型动画后可用</span>:null;
    return <div className="player-control-row">{entities.map(entity=><button key={entity.id} disabled={disabled} onClick={()=>{const component=getComponent(entity,'Animation')!;action(state.animations[entity.id]==='playing'?'PauseAnimation':'PlayAnimation',entity.id,{clip:component.data.clip,loop:component.data.loop});}}>{state.animations[entity.id]==='playing'?'暂停':'播放'} · {entity.name}</button>)}</div>;
  }
  if(node.kind==='panoramaControls'){
    const entities=doc.entities.filter(e=>getComponent(e,'Panorama')&&(!node.targetId||node.targetId===e.id));if(!entities.length)return design?<span>全景控制 · 添加观察点后可用</span>:null;
    return <div className="player-control-row">{entities.map(e=><div key={e.id}><button disabled={disabled} onClick={()=>action('EnterPanorama',e.id)}>进入全景</button><button disabled={disabled} onClick={()=>action('CapturePanorama',e.id)}>导出全景</button></div>)}</div>;
  }
  if(node.kind==='movement')return <div className="player-movement" aria-label="移动控制">{[['前进',1,0],['左移',0,-1],['后退',-1,0],['右移',0,1]].map(([label,forward,right])=><button key={String(label)} aria-label={String(label)} disabled={disabled} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);runtime?.setMovement(Number(forward),Number(right));}} onPointerUp={()=>runtime?.setMovement(0,0)} onPointerCancel={()=>runtime?.setMovement(0,0)} onLostPointerCapture={()=>runtime?.setMovement(0,0)}>{label}</button>)}</div>;
  if(node.kind==='loading')return <div className="player-loading-content" role="status"><strong>{state.load.message||'准备展厅…'}</strong><progress max={state.load.total||1} value={state.load.completed}/><span>{({idle:'等待开始',structure:'准备结构',assets:'加载资源',gpu:'准备画面',ready:'已就绪',error:'加载失败',cancelled:'已取消'}as const)[state.load.phase]}</span></div>;
  if(node.kind==='entry')return <div className="player-entry"><strong>{doc.name}</strong><button className="player-primary" disabled={design||state.load.phase!=='ready'} onClick={()=>{void runtime?.enter().catch(onError);}}>进入展厅</button><small>WASD 移动 · 拖动观察 · 可使用屏幕上的导览控制</small></div>;
  return null;
}
