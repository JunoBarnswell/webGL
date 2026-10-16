import { useState } from 'react';
import { createAction, createComponent, createEntity, type Tour, type Viewpoint } from '@studio/scene-schema';
import { useRuntime } from '@studio/player-ui';
import { useStudio } from '../state/studio';
import { upload } from '../state/api';
import { TextField } from '../components/Fields';
import { AssetThumbnail } from '../components/AssetThumbnail';

export function TourPanel(){
  const document=useStudio(s=>s.document),runtime=useStudio(s=>s.runtime),mode=useStudio(s=>s.mode),activeId=useStudio(s=>s.activeTourId),editing=useStudio(s=>s.editingPoint);const state=useRuntime(runtime);
  const [selectedStop,setSelectedStop]=useState(''),[dragged,setDragged]=useState(''),[warning,setWarning]=useState('');
  if(!document)return <div className="empty-state">打开场景后录制导览</div>;
  const tour=document.tours.find(t=>t.id===activeId)??document.tours[0];
  const create=()=>{const route:Tour={id:crypto.randomUUID(),name:'新导览',stops:[],loop:false,speed:document.settings.moveSpeed};useStudio.getState().command({label:'新建导览',mutate:doc=>{doc.tours.push(route);}});useStudio.getState().set({activeTourId:route.id});};
  const record=async()=>{
    const current=useStudio.getState(),pose=current.view?.pose();if(!pose||!runtime)throw new Error('视口尚未就绪');
    const sceneId=document.sceneId;const image=await runtime.captureViewThumbnail();const entry='view-'+crypto.randomUUID()+'.webp';const asset=await upload(entry,'image',entry,new Map([[entry,new Uint8Array(await image.arrayBuffer())]]));
    if(useStudio.getState().document?.sceneId!==sceneId)throw new Error('场景已切换，录制未提交');
    const view:Viewpoint={id:crypto.randomUUID(),name:'视点 '+((tour?.stops.length??0)+1),anchorId:'',...pose,thumbnailAssetId:asset.id};let id=tour?.id??crypto.randomUUID();
    useStudio.getState().command({label:'记录当前视点',mutate:doc=>{
      let route=doc.tours.find(t=>t.id===id);if(!route){route={id,name:'新导览',stops:[],loop:false,speed:doc.settings.moveSpeed};doc.tours.push(route);}id=route.id;view.name='视点 '+(route.stops.length+1);doc.viewpoints.push(view);if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);route.stops.push({id:crypto.randomUUID(),viewpointId:view.id,hold:3,travel:0});
    }});useStudio.getState().set({activeTourId:id});setSelectedStop(view.id);
  };
  const play=async()=>{if(!tour||!runtime)return;if(mode==='edit')await useStudio.getState().switchMode();const action=createAction(state.tour.id===tour.id&&state.tour.status==='paused'?'ResumeCruise':'StartCruise');action.targetId=tour.id;await runtime.dispatch(action);};
  const update=(fn:(tour:Tour)=>void,label='调整导览')=>{if(tour)useStudio.getState().command({label,mutate:doc=>{fn(doc.tours.find(t=>t.id===tour.id)!);}});};
  const pose=editing?document.viewpoints.find(v=>v.id===editing.viewpointId):document.viewpoints.find(v=>v.id===selectedStop);
  const reorder=(from:string,to:string)=>update(t=>{const i=t.stops.findIndex(s=>s.id===from),j=t.stops.findIndex(s=>s.id===to);if(i>=0&&j>=0)t.stops.splice(j,0,t.stops.splice(i,1)[0]);},'排列停靠点');
  return <section className="task-panel tour-task"><div className="task-heading"><span className="section-kicker">导览巡航</span><h2>把看到的画面录下来</h2><p>移动视角并记录，拖动卡片排列顺序。</p></div>
    <div className="task-actions"><button disabled={mode==='play'} onClick={create}>＋ 新建导览</button><button className="primary" disabled={mode==='play'||state.load.phase!=='ready'} onClick={()=>void useStudio.getState().run('记录视点',record)}>● 记录当前画面</button></div>
    <select aria-label="当前导览" value={tour?.id??''} onChange={e=>{useStudio.getState().set({activeTourId:e.target.value,editingPoint:null});setSelectedStop('');}}><option value="">选择导览</option>{document.tours.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
    {tour?<><fieldset disabled={mode==='play'}><label className="field"><span>导览名称</span><TextField label="导览名称" value={tour.name} onChange={name=>update(t=>{t.name=name;})}/></label><div className="tour-filmstrip">{tour.stops.map((stop,index)=>{
      const view=document.viewpoints.find(v=>v.id===stop.viewpointId);if(!view)return <p role="alert" key={stop.id}>视点引用缺失 {stop.viewpointId}</p>;const asset=document.assets.find(a=>a.id===view.thumbnailAssetId);
      return <article key={stop.id} className={'tour-stop '+(pose?.id===view.id?'active':'')} draggable={mode==='edit'} onDragStart={()=>setDragged(stop.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>reorder(dragged,stop.id)}><button className="tour-thumbnail" onClick={()=>{setSelectedStop(view.id);useStudio.getState().view?.setPose(runtime!.resolveViewpoint(view.id));}}>{asset?<AssetThumbnail asset={asset}/>:<span>视点 {index+1}</span>}<b>{index+1}</b></button><div><TextField label={'视点名称 '+(index+1)} value={view.name} onChange={name=>useStudio.getState().command({label:'命名视点',mutate:doc=>{doc.viewpoints.find(v=>v.id===view.id)!.name=name;}})}/><small>移动 {stop.travel?stop.travel.toFixed(1)+' 秒':'自动'} · 停留 {stop.hold} 秒</small><div className="button-group"><button onClick={()=>{setSelectedStop(view.id);useStudio.getState().set({editingPoint:{viewpointId:view.id,property:'position'},tool:'translate'});}}>调整路径</button><button aria-label={'删除停靠点 '+(index+1)} onClick={()=>update(t=>{t.stops=t.stops.filter(s=>s.id!==stop.id);},'移除停靠点')}>移除</button></div></div></article>;
    })}</div>
    <label className="field"><span>行进速度</span><select aria-label="巡航速度" value={tour.speed} onChange={e=>update(t=>{t.speed=Number(e.target.value);})}>{[750,1500,document.settings.moveSpeed,6000].filter((v,i,a)=>a.indexOf(v)===i).map(v=><option key={v} value={v}>{v===document.settings.moveSpeed?'工程速度':v<=750?'舒缓':v<=1500?'标准':'快速'} · {v} mm/s</option>)}</select></label><label className="field check"><span>循环播放</span><input type="checkbox" checked={tour.loop} onChange={e=>update(t=>{t.loop=e.target.checked;})}/></label>
    {pose&&<details open><summary>当前视点 · 精确调整</summary><div className="button-group"><button onClick={()=>useStudio.getState().set({editingPoint:{viewpointId:pose.id,property:'position'},tool:'translate'})}>移动位置</button><button onClick={()=>useStudio.getState().set({editingPoint:{viewpointId:pose.id,property:'target'},tool:'translate'})}>调整朝向</button><button onClick={()=>{if(!runtime)return;const point=runtime.snapToGround(pose.position);useStudio.getState().command({label:'视点落地吸附',mutate:doc=>{doc.viewpoints.find(v=>v.id===pose.id)!.position=point;}});}}>落地吸附</button></div>
      {tour.stops.filter(s=>s.viewpointId===pose.id).map(stop=><div key={stop.id}><label className="field"><span>停留秒数</span><TextField type="number" minimum={0} maximum={3600} label="视点停留秒数" value={stop.hold} onChange={v=>update(t=>{t.stops.find(s=>s.id===stop.id)!.hold=Number(v);})}/></label><label className="field"><span>移动秒数 · 0 为自动</span><TextField type="number" minimum={0} maximum={3600} label="视点移动秒数" value={stop.travel} onChange={v=>update(t=>{t.stops.find(s=>s.id===stop.id)!.travel=Number(v);})}/></label></div>)}
      {(['position','target']as const).map(property=><div key={property}><small>{property==='position'?'位置 mm':'朝向目标 mm'}</small><div className="vector-field">{pose[property].map((value,index)=><TextField key={index} type="number" label={(property==='position'?'视点位置':'视点目标')+'XYZ'[index]} value={value} onChange={v=>useStudio.getState().command({label:'精确调整视点',mutate:doc=>{doc.viewpoints.find(p=>p.id===pose.id)![property][index]=Number(v);}})}/>)}</div></div>)}
      <label className="field"><span>视野 FOV</span><TextField type="number" minimum={10} maximum={150} label="视点 FOV" value={pose.fov} onChange={v=>useStudio.getState().command({label:'调整镜头',mutate:doc=>{doc.viewpoints.find(p=>p.id===pose.id)!.fov=Number(v);}})}/></label>
      <button onClick={()=>useStudio.getState().command({label:'加入展区导航',mutate:doc=>{let root=doc.entities.find(e=>e.components.some(c=>c.type==='Zone'));if(!root){root=createEntity('展区导航');root.components.push(createComponent('Zone'));doc.entities.push(root);}const zone=root.components.find(c=>c.type==='Zone')!;const ids=zone.data.viewpointIds as string[];if(!ids.includes(pose.id))ids.push(pose.id);}})}>加入展区导航</button>
    </details>}</fieldset>
    <div className="task-actions"><button className="primary" disabled={tour.stops.length<2} onClick={()=>void play().catch(error=>useStudio.getState().set({message:String(error)}))}>{mode==='play'?'播放 / 继续':'预览这条导览'}</button><button onClick={()=>{const issues=runtime?.checkTour(tour.id)??[];setWarning(issues.length?issues.join('\n'):'未发现路径穿墙；仍可调整镜头构图。');}}>检查路径</button></div>{warning&&<p className="task-callout">{warning}</p>}
    </>:<div className="empty-state">先点击“记录当前画面”，创建第一条导览。</div>}
  </section>;
}
