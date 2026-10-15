import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ShowroomEngine } from '@o2vr/engine';
import { SceneRuntime } from '@studio/scene-runtime';
import { getComponent, type Transform } from '@studio/scene-schema';
import { useStudio,type EditingPoint } from '../state/studio';
import { authHeaders } from '../state/api';
import { createOverlays,type EditorOverlays } from './EditorOverlays';
import { mountModel } from './Resources';
import { Move, MousePointer2, RotateCcw, Scaling, LocateFixed, Grid2X2, Magnet } from 'lucide-react';

function readTransform(runtime:SceneRuntime,id:string):Transform{
  const object=runtime.getObject(id)!;const document=runtime.document!;const entity=document.entities.find(e=>e.id===id)!;
  let factor=1,scaleFactor=1;
  const binding=getComponent(entity,'ModelNode');
  const parent=entity.parentId?document.entities.find(e=>e.id===entity.parentId):undefined;
  const parentBinding=parent&&getComponent(parent,'ModelNode');
  const modelId=String(binding?.data.modelEntityId??parentBinding?.data.modelEntityId??'');
  const model=document.entities.find(e=>e.id===modelId);const component=model&&getComponent(model,'Model');
  if(component){factor=Number(component.data.unitScale);if(!binding)scaleFactor=factor;}
  return {position:object.position.clone().multiplyScalar(factor).toArray(),rotation:object.quaternion.clone().normalize().toArray() as [number,number,number,number],scale:object.scale.clone().multiplyScalar(scaleFactor).toArray()};
}
export function Viewport(){
  const host=useRef<HTMLDivElement>(null);const controls=useRef<{orbit:OrbitControls;gizmo:TransformControls;engine:ShowroomEngine;runtime:SceneRuntime;helpers:THREE.Group;pivot:THREE.Group;overlays?:EditorOverlays;frame:()=>void}|null>(null);
  const mode=useStudio(s=>s.mode),tool=useStudio(s=>s.tool),space=useStudio(s=>s.space),snap=useStudio(s=>s.snap),selected=useStudio(s=>s.selected),document=useStudio(s=>s.document),editingPoint=useStudio(s=>s.editingPoint);
  const [statistics,setStatistics]=useState({fps:0,draws:0,triangles:0}),[grid,setGrid]=useState(true),[rectangle,setRectangle]=useState<{x:number;y:number;w:number;h:number}|null>(null);
  useEffect(()=>{
    if(!host.current)return;
    const container=host.current;const engine=new ShowroomEngine({container});const canvas=engine.renderer.domElement;
    const runtime=new SceneRuntime(engine,{url:(id,path)=>'/api/assets/'+id+'/files/'+path.split('/').map(encodeURIComponent).join('/'),headers:authHeaders},{
      onSelect:id=>{if(!controls.current?.gizmo.dragging&&!useStudio.getState().document?.entities.find(e=>e.id===id)?.locked)useStudio.getState().select([id]);},
      onIssue:(id,error)=>useStudio.getState().set({issues:{...useStudio.getState().issues,[id]:error}}),
      onInfo:info=>useStudio.getState().set({info})
    });
    const helpers=new THREE.Group();engine.scene.add(helpers);
    const gridObject=new THREE.GridHelper(100000,100,'#4a5665','#2b333f');gridObject.position.y=-2;helpers.add(gridObject);
    const orbit=new OrbitControls(engine.camera,canvas);orbit.enableDamping=false;orbit.maxDistance=150000;orbit.addEventListener('change',()=>engine.requestRender());
    const gizmo=new TransformControls(engine.camera,canvas);helpers.add(gizmo);
    const pivot=new THREE.Group();helpers.add(pivot);const boxes:THREE.BoxHelper[]=[];
    let drag:{pivot:THREE.Matrix4;worlds:Map<string,THREE.Matrix4>;point?:EditingPoint}|null=null;
    const activeIds=()=>{const state=useStudio.getState();return state.selected.filter(id=>{const entity=state.document?.entities.find(e=>e.id===id);if(!entity||entity.locked)return false;let parent=entity.parentId;while(parent){if(state.selected.includes(parent))return false;parent=state.document?.entities.find(e=>e.id===parent)?.parentId??null;}return true;});};
    gizmo.addEventListener('mouseDown',()=>{
      const point=gizmo.object?.userData.editorHandle as EditingPoint|undefined;const worlds=new Map<string,THREE.Matrix4>();for(const id of point?[]:activeIds()){const object=runtime.getObject(id);if(object){object.updateWorldMatrix(true,false);worlds.set(id,object.matrixWorld.clone());}}
      pivot.updateWorldMatrix(true,false);drag={pivot:pivot.matrixWorld.clone(),worlds,point};orbit.enabled=false;
    });
    gizmo.addEventListener('objectChange',()=>{
      if(drag&&gizmo.object===pivot){
        pivot.updateMatrixWorld(true);const delta=pivot.matrixWorld.clone().multiply(drag.pivot.clone().invert());
        for(const [id,before]of drag.worlds){const object=runtime.getObject(id);if(!object)continue;object.parent?.updateWorldMatrix(true,false);const local=(object.parent?.matrixWorld.clone().invert()??new THREE.Matrix4()).multiply(delta.clone().multiply(before));local.decompose(object.position,object.quaternion,object.scale);}
      }
      if(drag?.point&&gizmo.object)useStudio.getState().set({pointPreview:gizmo.object.position.toArray()});
      if(drag&&!drag.point)useStudio.getState().set({transforms:Object.fromEntries([...drag.worlds.keys()].map(id=>[id,readTransform(runtime,id)]))});
      engine.requestRender();
    });
    const finish=(cancel:boolean)=>{
      if(!drag)return;
      if(drag.point&&gizmo.object){
        const point=drag.point,position=gizmo.object.position.toArray();drag=null;useStudio.getState().set({pointPreview:null});
        if(cancel){gizmo.reset();gizmo.dragging=false;}else useStudio.getState().command({label:'编辑路径视点',mutate:doc=>{
          const component=doc.entities.find(e=>e.id===point.entityId)?.components.find(c=>c.type===point.type);if(!component)return;
          if(point.collection){const rows=component.data[point.collection] as {[key:string]:import('@studio/scene-schema').JsonValue}[];rows[point.index][point.property]=position;}
          else component.data[point.property]=position;
        }});
        orbit.enabled=useStudio.getState().mode==='edit';engine.requestRender();return;
      }
      const ids=[...drag.worlds.keys()];const transforms=new Map(ids.map(id=>[id,readTransform(runtime,id)]));drag=null;useStudio.getState().set({transforms:{}});
      if(cancel){gizmo.reset();gizmo.dragging=false;const current=useStudio.getState().document;if(current)void runtime.applyChangeSet({before:current,after:current,entityIds:ids,materialIds:[],settingsChanged:false,behaviorsChanged:false,assetsChanged:false});}
      else useStudio.getState().command({label:'视口变换',mutate:doc=>{for(const entity of doc.entities){const transform=transforms.get(entity.id);if(transform)entity.transform=transform;}}});
      orbit.enabled=useStudio.getState().mode==='edit';engine.requestRender();
    };
    gizmo.addEventListener('mouseUp',()=>finish(false));
    const selectionAbort=new AbortController();let start:{x:number;y:number}|null=null;
    canvas.addEventListener('pointerup',event=>{
      if(event.shiftKey||drag||useStudio.getState().mode!=='edit')return;
      const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),engine.camera);
      const hit=ray.intersectObjects(controls.current?.overlays?.handles??[],false)[0];
      if(hit){useStudio.getState().set({editingPoint:hit.object.userData.editorHandle as EditingPoint,pointPreview:null,tool:'translate'});event.stopImmediatePropagation();}
    },{capture:true,signal:selectionAbort.signal});
    canvas.addEventListener('pointerdown',event=>{
      if(!event.shiftKey||useStudio.getState().mode!=='edit')return;const rect=canvas.getBoundingClientRect();start={x:event.clientX-rect.left,y:event.clientY-rect.top};orbit.enabled=false;event.stopImmediatePropagation();
    },{capture:true,signal:selectionAbort.signal});
    canvas.addEventListener('pointermove',event=>{
      if(!start)return;const rect=canvas.getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;setRectangle({x:Math.min(x,start.x),y:Math.min(y,start.y),w:Math.abs(x-start.x),h:Math.abs(y-start.y)});
    },{signal:selectionAbort.signal});
    canvas.addEventListener('pointerup',event=>{
      if(!start)return;const rect=canvas.getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;const ids:string[]=[];
      for(const entity of useStudio.getState().document?.entities??[]){if(entity.locked||!entity.visible)continue;const object=runtime.getObject(entity.id);if(!object)continue;const projected=new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).project(engine.camera);const px=(projected.x*.5+.5)*rect.width,py=(-projected.y*.5+.5)*rect.height;if(projected.z>=-1&&projected.z<=1&&px>=Math.min(x,start.x)&&px<=Math.max(x,start.x)&&py>=Math.min(y,start.y)&&py<=Math.max(y,start.y))ids.push(entity.id);}
      start=null;setRectangle(null);orbit.enabled=true;useStudio.getState().select(ids,true);
    },{signal:selectionAbort.signal});
    canvas.addEventListener('pointercancel',()=>finish(true),{signal:selectionAbort.signal});
    canvas.addEventListener('keydown',event=>{if(event.key==='Escape')finish(true);},{signal:selectionAbort.signal});
    const frame=()=>{
      const ids=useStudio.getState().selected;const box=new THREE.Box3();
      for(const id of ids){const object=runtime.getObject(id);if(object){const local=new THREE.Box3().setFromObject(object);if(local.isEmpty())box.expandByPoint(object.getWorldPosition(new THREE.Vector3()));else box.union(local);}}
      if(box.isEmpty())for(const instance of runtime.objects.values())if(instance.root.visible)box.expandByObject(instance.root);
      if(box.isEmpty())return;
      const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();orbit.target.copy(center);engine.camera.position.copy(center).add(new THREE.Vector3(1,.8,1).normalize().multiplyScalar(Math.max(1200,size)));
      engine.camera.far=Math.max(35000,size*5);engine.camera.updateProjectionMatrix();orbit.update();engine.requestRender();
    };
    window.addEventListener('studio-frame-selection',frame,{signal:selectionAbort.signal});
    const overlayUpdate=engine.onUpdate(()=>{controls.current?.overlays?.update();return false;});
    const renderCleanup=engine.onRender(()=>{
      for(const box of boxes){box.removeFromParent();box.geometry.dispose();(box.material as THREE.Material).dispose();}boxes.length=0;
      if(useStudio.getState().mode==='edit')for(const id of useStudio.getState().selected){const object=runtime.getObject(id);if(object){const box=new THREE.BoxHelper(object,0x59d8be);helpers.add(box);boxes.push(box);}}
    });
    const timer=setInterval(()=>setStatistics({fps:engine.frameScheduler.fps,draws:engine.renderer.info.render.calls,triangles:engine.renderer.info.render.triangles}),700);
    controls.current={engine,runtime,orbit,gizmo,helpers,pivot,frame};useStudio.getState().set({runtime});
    const initial=useStudio.getState().document;if(initial)void runtime.loadDocument(initial).then(()=>{orbit.target.fromArray(initial.settings.target);orbit.update();});
    return()=>{
      clearInterval(timer);selectionAbort.abort();renderCleanup();overlayUpdate();controls.current?.overlays?.dispose();gizmo.dispose();orbit.dispose();runtime.dispose();
      for(const box of boxes){box.geometry.dispose();(box.material as THREE.Material).dispose();}
      gridObject.geometry.dispose();(gridObject.material as THREE.Material).dispose();engine.dispose();controls.current=null;useStudio.getState().set({runtime:null});
    };
  },[]);
  useEffect(()=>{
    const current=controls.current;if(!current)return;
    current.overlays?.dispose();
    if(document&&mode==='edit'){current.overlays=createOverlays(current.runtime,document,selected);current.helpers.add(current.overlays.root);}else current.overlays=undefined;
    current.engine.requestRender();
  },[document,selected,mode]);
  useEffect(()=>{
    const current=controls.current;if(!current)return;const {gizmo,pivot,engine}=current;
    gizmo.detach();const ids=selected.filter(id=>!document?.entities.find(e=>e.id===id)?.locked);const handle=editingPoint?current.overlays?.handles.find(object=>JSON.stringify(object.userData.editorHandle)===JSON.stringify(editingPoint)):undefined;const object=handle??(ids.length?pivot:undefined);
    if(ids.length){const position=new THREE.Vector3();let count=0;for(const id of ids){const target=current.runtime.getObject(id);if(target){const box=new THREE.Box3().setFromObject(target);position.add(box.isEmpty()?target.getWorldPosition(new THREE.Vector3()):box.getCenter(new THREE.Vector3()));count++;}}pivot.position.copy(position.divideScalar(count||1));const primary=current.runtime.getObject(ids[0]);if(primary)pivot.quaternion.copy(primary.getWorldQuaternion(new THREE.Quaternion()));else pivot.rotation.set(0,0,0);pivot.scale.set(1,1,1);}
    if(object&&mode==='edit'&&tool!=='select')gizmo.attach(object);
    gizmo.setMode(handle?'translate':tool==='select'?'translate':tool);gizmo.setSpace(space);gizmo.setTranslationSnap(snap?100:null);gizmo.setRotationSnap(snap?Math.PI/12:null);gizmo.setScaleSnap(snap ? .1 : null);engine.requestRender();
  },[selected,tool,space,snap,mode,document,editingPoint]);
  useEffect(()=>{const current=controls.current;if(current){current.orbit.enabled=mode==='edit';current.helpers.visible=mode==='edit';if(mode==='edit'&&current.runtime.document){current.orbit.target.fromArray(current.runtime.document.settings.target);current.orbit.update();}current.engine.requestRender();}},[mode]);
  useEffect(()=>{const helper=controls.current?.helpers.children.find(object=>object instanceof THREE.GridHelper);if(helper){helper.visible=grid;controls.current?.engine.requestRender();}},[grid]);
  return <section className="viewport-panel" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const materialId=event.dataTransfer.getData('studio/material');if(materialId){const current=controls.current;if(current){const rect=current.engine.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),current.engine.camera);let object:THREE.Object3D|undefined=ray.intersectObjects([...current.runtime.objects.values()].map(i=>i.visual),true).find(hit=>{let cursor:THREE.Object3D|null=hit.object;while(cursor){if(!cursor.visible||cursor.userData.collider)return false;cursor=cursor.parent;}return true;})?.object;while(object&&!object.userData.entityId)object=object.parent??undefined;const id=String(object?.userData.entityId??selected[0]??'');useStudio.getState().command({label:'拖放材质',mutate:doc=>{const component=doc.entities.find(e=>e.id===id)?.components.find(c=>['Mesh','Model','ModelNode'].includes(c.type));if(component)component.data.materialId=materialId;}});}return;}const id=event.dataTransfer.getData('studio/asset');const asset=document?.assets.find(a=>a.id===id);if(asset?.kind==='model')void useStudio.getState().run('挂载模型',()=>mountModel(asset));}}>
    <div ref={host} className="viewport-canvas"/>
    <div className="viewport-toolbar"><div className="tool-strip">{[['select',MousePointer2,'选择 Q'],['translate',Move,'移动 W'],['rotate',RotateCcw,'旋转 E'],['scale',Scaling,'缩放 R']].map(([value,Icon,title])=>{
      const Glyph=Icon as typeof Move;return <button key={String(value)} className={tool===value?'active':''} aria-label={String(title)} title={String(title)} disabled={mode==='play'} onClick={()=>useStudio.getState().set({tool:value as typeof tool,editingPoint:null,pointPreview:null})}><Glyph/></button>;
    })}<span className="tool-divider"/><select aria-label="坐标空间" value={space} disabled={mode==='play'} onChange={event=>useStudio.getState().set({space:event.target.value as typeof space})}><option value="world">世界</option><option value="local">局部</option></select><button className={snap?'active':''} title="吸附 100mm / 15° / 0.1" aria-label="切换吸附" onClick={()=>useStudio.getState().set({snap:!snap})}><Magnet/></button></div>
    <div className="tool-strip"><button title="聚焦选中 F" aria-label="聚焦选中" onClick={()=>controls.current?.frame()}><LocateFixed/></button><button className={grid?'active':''} title="网格" aria-label="切换网格" onClick={()=>setGrid(!grid)}><Grid2X2/></button></div></div>
    {editingPoint&&mode==='edit'&&<div className="point-edit-tools"><span>{editingPoint.type} · {editingPoint.index+1} · {editingPoint.property==='position'?'位置':'朝向'}</span><button onClick={()=>useStudio.getState().set({editingPoint:null,pointPreview:null})}>完成视点编辑</button></div>}
    <div className="viewport-bottom"><span>{mode==='play'?'预览 · 点击视口后 WASD 漫游，拖动观察':'透视 · 毫米 · Shift 拖动框选'}</span><span>{statistics.fps} FPS · {statistics.draws} Draws · {statistics.triangles.toLocaleString()} △</span></div>
    {rectangle&&<div className="selection-box" style={{left:rectangle.x,top:rectangle.y,width:rectangle.w,height:rectangle.h}}/>}
    {mode==='play'&&<div className="preview-tools"><button onClick={()=>void useStudio.getState().run('启用音频',async()=>{await controls.current?.runtime.enableAudio();})}>启用音频</button><button onClick={()=>{const runtime=controls.current?.runtime;if(runtime){runtime.navigation.viewMode=runtime.navigation.viewMode==='first'?'third':'first';runtime.engine.requestRender();}}}>第一 / 第三人称</button></div>}
  </section>;
}
