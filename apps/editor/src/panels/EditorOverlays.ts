import * as THREE from 'three';
import { getComponent,type SceneDocument } from '@studio/scene-schema';
import type { SceneRuntime } from '@studio/scene-runtime';
import type { EditingPoint } from '../state/studio';

export interface EditorOverlays { root:THREE.Group; handles:THREE.Mesh[]; update:()=>void; dispose:()=>void }
export function createOverlays(runtime:SceneRuntime,document:SceneDocument,selected:string[]):EditorOverlays {
  const root=new THREE.Group(),handles:THREE.Mesh[]=[],groups=new Map<string,THREE.Group>();
  const sphere=new THREE.SphereGeometry(95,12,8);
  const positionMaterial=new THREE.MeshBasicMaterial({color:0x6eddbd,depthTest:false});
  const targetMaterial=new THREE.MeshBasicMaterial({color:0xe4bc6a,depthTest:false});
  const marker=(group:THREE.Group,position:number[],point:EditingPoint)=>{
    const object=new THREE.Mesh(sphere,point.property==='position'?positionMaterial:targetMaterial);
    object.position.fromArray(position);object.renderOrder=1001;object.userData.editorHandle=point;group.add(object);handles.push(object);
  };
  for(const id of selected){
    const entity=document.entities.find(e=>e.id===id);if(!entity)continue;
    const group=new THREE.Group();group.matrixAutoUpdate=false;root.add(group);groups.set(id,group);
    for(const type of ['Cruise','Zone']as const){
      const component=getComponent(entity,type);if(!component)continue;
      const collection=type==='Cruise'?'points':'views';
      const points=component.data[collection] as {position:number[];target:number[]}[];
      for(const [index,point]of points.entries())for(const property of ['position','target']as const)
        marker(group,point[property],{entityId:id,type,collection,index,property});
      if(type==='Cruise'&&points.length>=2){
        const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3().fromArray(p.position)),Boolean(component.data.closed),'centripetal');
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(384)),new THREE.LineBasicMaterial({color:0x63c9ad,depthTest:false,transparent:true,opacity:.7}));
        line.renderOrder=1000;group.add(line);
      }else{
        const segments=points.flatMap(point=>[new THREE.Vector3().fromArray(point.position),new THREE.Vector3().fromArray(point.target)]);
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments),new THREE.LineBasicMaterial({color:0xdab76e,depthTest:false})));
      }
    }
    const panorama=getComponent(entity,'Panorama');
    if(panorama)marker(group,panorama.data.position as number[],{entityId:id,type:'Panorama',collection:null,index:0,property:'position'});
    const trigger=getComponent(entity,'Trigger');
    if(trigger){
      const box=new THREE.BoxGeometry(1,1,1),geometry=new THREE.EdgesGeometry(box);box.dispose();
      const wire=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xc8a275,depthTest:false}));
      wire.position.fromArray(trigger.data.offset as number[]);wire.scale.fromArray(trigger.data.size as number[]);wire.renderOrder=999;group.add(wire);
    }
  }
  // These shared objects are retained even if no marker uses them; dispose their unused allocations now.
  if(!handles.length){sphere.dispose();positionMaterial.dispose();targetMaterial.dispose();}
  else if(!handles.some(h=>(h.userData.editorHandle as EditingPoint).property==='target'))targetMaterial.dispose();
  runtime.engine.resourceRegistry.retainHierarchy(root);
  const update=()=>{for(const [id,group]of groups){group.matrix.copy(runtime.getEntityFrame(id));group.matrixWorldNeedsUpdate=true;}};
  update();
  return {root,handles,update,dispose:()=>{root.removeFromParent();runtime.engine.resourceRegistry.releaseHierarchy(root);}};
}
