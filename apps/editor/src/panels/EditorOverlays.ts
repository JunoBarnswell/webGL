import * as THREE from 'three';
import { getComponent, type SceneDocument } from '@studio/scene-schema';
import type { SceneRuntime } from '@studio/scene-runtime';
import type { EditingPoint } from '../state/studio';

export interface EditorOverlays { root:THREE.Group; handles:THREE.Mesh[]; update:(excluded?:THREE.Object3D)=>void; dispose:()=>void }
export function createOverlays(runtime:SceneRuntime,document:SceneDocument,selected:string[],tourId:string):EditorOverlays{
  const root=new THREE.Group(),handles:THREE.Mesh[]=[],groups=new Map<string,THREE.Group>();
  const sphere=new THREE.SphereGeometry(70,10,6),positionMaterial=new THREE.MeshBasicMaterial({color:0x6eddbd,depthTest:false}),targetMaterial=new THREE.MeshBasicMaterial({color:0xe4bc6a,depthTest:false});
  const tour=document.tours.find(t=>t.id===tourId),viewIds=new Set(tour?.stops.map(s=>s.viewpointId)??[]);
  for(const id of selected){const entity=document.entities.find(e=>e.id===id);if(!entity)continue;for(const value of getComponent(entity,'Zone')?.data.viewpointIds as string[]??[])viewIds.add(value);const panorama=getComponent(entity,'Panorama');if(panorama?.data.viewpointId)viewIds.add(String(panorama.data.viewpointId));}
  for(const view of document.viewpoints.filter(v=>viewIds.has(v.id))){const group=new THREE.Group();group.matrixAutoUpdate=false;root.add(group);groups.set(view.id,group);for(const property of ['position','target']as const){const mesh=new THREE.Mesh(sphere,property==='position'?positionMaterial:targetMaterial);mesh.renderOrder=1001;mesh.userData.editorHandle={viewpointId:view.id,property} satisfies EditingPoint;group.add(mesh);handles.push(mesh);}}
  const geometry=new THREE.BufferGeometry();const count=Math.max(2,(tour?.stops.length??0)*16);geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x64d6b7,depthTest:false,transparent:true,opacity:.75}));line.renderOrder=1000;root.add(line);
  const triggers=new Map<string,THREE.LineSegments>();
  for(const id of selected){const entity=document.entities.find(e=>e.id===id),trigger=entity&&getComponent(entity,'Trigger');if(!trigger)continue;const box=new THREE.BoxGeometry(1,1,1),edges=new THREE.EdgesGeometry(box);box.dispose();const wire=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:0xdab76e,depthTest:false}));wire.matrixAutoUpdate=false;root.add(wire);triggers.set(id,wire);}
  if(!handles.length){sphere.dispose();positionMaterial.dispose();targetMaterial.dispose();}
  runtime.engine.resourceRegistry.retainHierarchy(root);
  const update=(excluded?:THREE.Object3D)=>{
    const doc=runtime.document;if(!doc)return;
    for(const mesh of handles){const point=mesh.userData.editorHandle as EditingPoint,view=doc.viewpoints.find(v=>v.id===point.viewpointId);if(!view)continue;const group=groups.get(view.id)!;group.matrix.copy(view.anchorId?runtime.getEntityFrame(view.anchorId):new THREE.Matrix4());group.matrixWorldNeedsUpdate=true;if(mesh!==excluded)mesh.position.fromArray(view[point.property]);}
    const currentTour=doc.tours.find(t=>t.id===tourId);line.visible=Boolean(currentTour&&currentTour.stops.length>=2);
    if(line.visible){const points=currentTour!.stops.map(s=>new THREE.Vector3().fromArray(runtime.resolveViewpoint(s.viewpointId).position)),curve=new THREE.CatmullRomCurve3(points,false,'centripetal'),attribute=geometry.getAttribute('position') as THREE.BufferAttribute;for(let i=0;i<count;i++){const p=curve.getPoint(i/(count-1));attribute.setXYZ(i,p.x,p.y,p.z);}attribute.needsUpdate=true;geometry.computeBoundingSphere();}
    for(const [id,wire]of triggers){const entity=doc.entities.find(e=>e.id===id),trigger=entity&&getComponent(entity,'Trigger');if(trigger){wire.matrix.copy(runtime.getEntityFrame(id)).multiply(new THREE.Matrix4().compose(new THREE.Vector3().fromArray(trigger.data.offset as number[]),new THREE.Quaternion(),new THREE.Vector3().fromArray(trigger.data.size as number[])));wire.matrixWorldNeedsUpdate=true;}}
  };
  update();return {root,handles,update,dispose:()=>{root.removeFromParent();runtime.engine.resourceRegistry.releaseHierarchy(root);}};
}
