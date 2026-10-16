import * as THREE from 'three';
import { createAction, createComponent, createDocument, createEntity, createMaterial, createContent, createBehavior, type Entity, type SceneAsset, type SceneDocument } from '@studio/scene-schema';
import { O2vrGeometryDecoder } from './O2vrGeometryDecoder.js';

export type FileBundle = Map<string, Uint8Array>;
export type RegisterAsset = (name: string, kind: SceneAsset['kind'], entry: string, files: FileBundle) => Promise<SceneAsset>;
export interface ImportReport { sourceNodes: number; meshes: number; bindings: number; uuidMap: Record<string,string>; missing: string[]; conflicts: string[]; unsupported: string[] }
type LegacyNode = { uuid?: string; name?: string; meshid?: string; wts?: { elements: number[] }; position?: {x:number;y:number;z:number}; quaternion?: {_x:number;_y:number;_z:number;_w:number}; scale?: {x:number;y:number;z:number}; material?: Record<string,unknown>; children?: LegacyNode[] };
type Binding = { uuid: string; resid: number; name: string; url: string; showbox?: unknown };
type EditInfo = Record<string, unknown> & { user_item_info?: Record<string,{url?:string;preview?:string}> };
const color = (value: unknown, fallback: number) => '#' + Number(value ?? fallback).toString(16).padStart(6,'0').slice(-6);
const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))).map(n => n.toString(16).padStart(2,'0')).join('');
const id = (uuid: string) => 'o2vr-' + uuid.toLowerCase().replace(/[{}]/g,'');
export async function importO2vr(scene: LegacyNode, bindings: Record<string,Binding>, edit: EditInfo, read: (path: string) => Promise<Uint8Array>, register: RegisterAsset): Promise<{ document: SceneDocument; report: ImportReport }> {
  const document = createDocument('油画作品线上鉴赏展'); const report: ImportReport = { sourceNodes:0,meshes:0,bindings:0,uuidMap:{},missing:[],conflicts:[],unsupported:[] };
  const byPath = new Map<string,Promise<SceneAsset>>(); const materialIds = new Map<string,string>();
  const asset = (path: string, kind: SceneAsset['kind']) => {
    let promise = byPath.get(path);
    if (!promise) {
      promise = (async () => {
        const bytes = await read(path); const name = decodeURIComponent(path.split('/').pop()!.split('?')[0]);
        let stored: SceneAsset;
        if (kind === 'mesh') {
          const geometry = new O2vrGeometryDecoder().decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
          const entry = name + '.geometry.json'; const {uuid:_uuid,...canonical}=geometry.toJSON() as Record<string,unknown>; const content = encoded(canonical); geometry.dispose();
          stored = await register(name,kind,entry,new Map([[entry,content]]));
        } else stored = await register(name,kind,name,new Map([[name,bytes]]));
        document.assets.push(stored); return stored;
      })();
      byPath.set(path,promise);
    }
    return promise;
  };
  async function missingAsset(path: string, kind: SceneAsset['kind'], error: unknown): Promise<SceneAsset> {
    const sha = await digest(new TextEncoder().encode(path)); const name = path.split('/').pop()!.split('?')[0];
    const value: SceneAsset = { id:'missing-'+sha, name,kind,entry:name,files:[name],sha256:sha };
    if (!document.assets.some(a => a.id === value.id)) document.assets.push(value);
    report.missing.push(path.split('?')[0] + ': ' + (error instanceof Error ? error.message.split('?')[0] : String(error))); return value;
  }
  async function material(def: Record<string,unknown>): Promise<string> {
    const key = String(def.uuid ?? JSON.stringify(def)); const previous = materialIds.get(key); if (previous) return previous;
    const value = createMaterial('材质 ' + (materialIds.size+1)); value.id = 'mat-' + (def.uuid ? String(def.uuid).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,90) : await digest(encoded(def)));
    materialIds.set(key,value.id);
    value.kind = def.type === 'MeshPhysicalMaterial' ? 'physical' : def.type === 'MeshStandardMaterial' ? 'standard' : 'phong';
    value.color = color(def.color,0xffffff); value.specular = color(def.specular,0x111111); value.emissive = color(def.emissive,0);
    for (const field of ['opacity','shininess','reflectivity','metalness','roughness','clearcoat','clearcoatRoughness','lightMapIntensity','side'] as const) if (typeof def[field] === 'number') value[field] = def[field] as number;
    value.transparent = Boolean(def.transparent); value.depthWrite = def.depthWrite !== false;
    for (const field of ['map','lightMap','normalMap','aoMap','emissiveMap','alphaMap']) {
      const texture = def[field] as {name?:string;o2_default?:string;offset?:{x:number;y:number};repeat?:{x:number;y:number};rotation?:number} | null;
      if (!texture?.name || texture.o2_default) continue;
      // The baseline Phong path did not bind normal/ORM maps.
      if (value.kind === 'phong' && !['map','lightMap'].includes(field)) continue;
      let stored: SceneAsset;
      try { stored = await asset('model/showroom/'+texture.name,'texture'); } catch(error) { stored = await missingAsset(texture.name,'texture',error); }
      value.maps[field] = { assetId:stored.id,offset:[texture.offset?.x??0,texture.offset?.y??0],repeat:[texture.repeat?.x??1,texture.repeat?.y??1],rotation:texture.rotation??0,channel:field==='lightMap'?1:0,flipY:field!=='lightMap',colorSpace:field==='map' || field==='emissiveMap'?'srgb':'linear' };
    }
    const cube = def.cube_info as {url?:string}|undefined;
    if (cube?.url) for (const side of ['posx','negx','posy','negy','posz','negz']) {
      const path = 'model/showroom/image/'+cube.url+'/'+side+'.jpg';
      try { value.envAssetIds.push((await asset(path,'texture')).id); } catch(error) { value.envAssetIds.push((await missingAsset(path,'texture',error)).id); }
    }
    document.materials.push(value); return value.id;
  }
  async function visit(node: LegacyNode, parentId: string|null, collider: boolean, ground: boolean, path='root'): Promise<void> {
    report.sourceNodes++; const entity = createEntity(node.name || '未命名节点',parentId); entity.id=id(node.uuid??path); entity.legacyUuid=node.uuid??''; if(node.uuid)report.uuidMap[node.uuid]=entity.id;
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1,1,1);
    if (node.wts?.elements) new THREE.Matrix4().fromArray(node.wts.elements).decompose(position,rotation,scale);
    else { if(node.position) position.set(node.position.x,node.position.y,node.position.z); if(node.quaternion) rotation.set(node.quaternion._x,node.quaternion._y,node.quaternion._z,node.quaternion._w); if(node.scale) scale.set(node.scale.x,node.scale.y,node.scale.z); }
    entity.transform={position:position.toArray(),rotation:rotation.normalize().toArray() as [number,number,number,number],scale:scale.toArray()};
    const isCollider=collider || /colli/i.test(node.name??''); const isGround=ground || /ground|floor/i.test(node.name??'');
    // Source parser hid the colli group. Preserve group visibility and bake the meaning into components.
    entity.visible=!isCollider;
    if (node.meshid) {
      report.meshes++; const mesh=createComponent('Mesh');
      try { mesh.data.assetId=(await asset('model/showroom/'+node.meshid,'mesh')).id; } catch(error) { mesh.data.assetId=(await missingAsset(node.meshid,'mesh',error)).id; }
      mesh.data.materialId=await material(node.material??{}); entity.components.push(mesh);
      if (isCollider) entity.components.push(createComponent('Collider'));
      if (isGround) entity.components.push(createComponent('Ground'));
      const layer=createComponent('DisplayLayer'); layer.data.layer=/shell|body|外壳/i.test(node.name??'')?'shell':/chassis|底盘/i.test(node.name??'')?'chassis':'components'; entity.components.push(layer);
    }
    const binding=bindings[node.uuid??''];
    if (binding) {
      report.bindings++;const artwork=createComponent('Artwork'),content=createContent(binding.name);content.id='content-'+entity.id;
      const signed=edit.user_item_info?.[String(binding.resid)]?.url;const url=signed||binding.url;
      try{content.imageAssetId=(await asset(url,'image')).id;}catch(error){content.imageAssetId=(await missingAsset(url,'image',error)).id;}
      document.contents.push(content);artwork.data.contentId=content.id;entity.components.push(artwork);
      const action=createAction('OpenContent');action.targetId=content.id;
      const behavior=createBehavior('查看 '+binding.name);behavior.id='artwork-'+entity.id;behavior.sourceId=entity.id;behavior.actions=[action];document.behaviors.push(behavior);
    }
    document.entities.push(entity);
    for(const [index,child] of (node.children??[]).entries()) await visit(child,entity.id,isCollider,isGround,path+'-'+index);
  }
  await visit(scene,null,false,false);
  document.settings.moveSpeed=3500; document.settings.eyeHeight=1720; document.settings.position=[-1846,1720,726]; document.settings.target=[-1846,1720,-274];
  const root=document.entities[0];
  const addView=(suffix:string,name:string,position:number[],target:number[])=>{const id='view-'+suffix;document.viewpoints.push({id,name,anchorId:root.id,position:position as [number,number,number],target:target as [number,number,number],fov:document.settings.fov,thumbnailAssetId:''});return id;};
  const zone=createComponent('Zone');zone.data.viewpointIds=[
    addView('entrance','展厅入口',[-1846,2000,726],[-1778,2162,-1409]),
    addView('A','A区 · 经典写实油画',[-11142,2000,-20020],[-13127,2137,-20227]),
    addView('B','B区 · 印象派光影',[-13619,2000,-5834],[-15596,1912,-6126]),
    addView('C','C区 · 当代浪漫表现',[4864,2000,25700],[4858,2249,23715]),
    addView('D','D区 · 抽象意象空间',[-10323,2000,29875],[-10774,2123,27930])
  ];root.components.push(zone);
  const path=[[-1846,726],[-4500,-3000],[-8000,-11000],[-11142,-20020],[-13500,-13500],[-13619,-5834],[-10500,-4500],[-7000,-4000],[-4500,-1500],[-2000,1000],[-2000,8000],[-2000,15000],[-2000,22000],[0,24500],[2500,25200],[4864,25700],[2000,25000],[-1000,24600],[-4000,24600],[-6500,25180],[-8500,25300],[-10000,26800],[-10323,29875],[-10000,26800],[-8500,25300],[-6000,25180],[-3000,24500],[-2000,22000],[-2000,14000],[-1846,5000],[-1846,1500]];
  document.tours.push({id:'showroom-tour',name:'展厅导览',loop:false,speed:document.settings.moveSpeed,stops:path.map(([x,z],index)=>({id:'showroom-stop-'+index,viewpointId:addView('tour-'+index,'导览 '+(index+1),[x,2000,z],[path[Math.min(index+1,path.length-1)][0],2000,path[Math.min(index+1,path.length-1)][1]-1]),hold:[3,5,15,22].includes(index)?3:0,travel:0}))});
  const cruise=createComponent('Cruise');cruise.data.tourId='showroom-tour';root.components.push(cruise);
  const panorama=createComponent('Panorama');panorama.data.viewpointId=addView('panorama','全景观察点',[...document.settings.position],[...document.settings.target]);root.components.push(panorama);
  for (const [type,path,kind] of [['Audio','audio/bgm.mp3','audio'],['Avatar','model/avatar/character.glb','model']] as const) {
    const component=createComponent(type);
    try { component.data.assetId=(await asset(path,kind)).id; } catch(error) { component.data.assetId=(await missingAsset(path,kind,error)).id; }
    if(type==='Avatar'&&!String(component.data.assetId).startsWith('missing-')) {
      const metadata=readGltf(new Map([['character.glb',await read(path)]]),'character.glb');
      for(const state of ['idle','walk','run'] as const)component.data[state+'Clip']=metadata.animations.find(name=>name.toLowerCase().includes(state))??metadata.animations[0]??'';
    }
    root.components.push(component);
  }
  report.conflicts.push('启动相机采用 main 每帧实际生效的 1720mm 视高与 -Z 朝向；edit_info 初始朝向未被旧入口应用。');
  const effective: Record<string,unknown>={fov:60,maxDistance:35000,moveSpd:3500,collision:true,view:'-1846,2000,726,-1778,2162,-1409,-1846,0,726',modelFlag:false};
  for(const [key,value] of Object.entries(effective)) if (edit[key]!==undefined && edit[key]!==value) report.conflicts.push(key+': edit_info='+JSON.stringify(edit[key])+'；采用生效 main 设置 '+JSON.stringify(value));
  const supported=new Set(['bind','user_item','user_item_info','viewList',...Object.keys(effective)]);
  report.unsupported=Object.keys(edit).filter(key=>!supported.has(key)).map(key=>'edit_info.'+key);
  return {document,report};
}

export function readGltf(files: FileBundle, entry: string): {nodes: Record<string,unknown>[]; roots: number[]; animations: string[]} {
  const bytes=files.get(entry); if(!bytes) throw new Error('找不到模型入口');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const json=entry.toLowerCase().endsWith('.glb') ? bytes.subarray(20,20+view.getUint32(12,true)) : bytes;
  const data=JSON.parse(new TextDecoder().decode(json)) as {nodes?:Record<string,unknown>[]; scenes?:{nodes:number[]}[];scene?:number;animations?:{name?:string}[];buffers?:{uri?:string}[];images?:{uri?:string}[]};
  for(const resource of [...data.buffers??[],...data.images??[]]) if(resource.uri && !resource.uri.startsWith('data:')) {
    const url=new URL(resource.uri,'https://studio.invalid/'+entry); const path=decodeURIComponent(url.pathname.slice(1));
    if(url.origin!=='https://studio.invalid' || !files.has(path)) throw new Error('缺少 glTF 相对依赖: '+path+'；请同时选择依赖文件或导入完整 ZIP');
  }
  return {nodes:data.nodes??[],roots:data.scenes?.[data.scene??0]?.nodes??[],animations:(data.animations??[]).map((a,i)=>a.name??'animation_'+i)};
}
export function modelEntities(asset: SceneAsset, metadata: ReturnType<typeof readGltf>, parentId: string|null): Entity[] {
  const root=createEntity(asset.name,parentId); const model=createComponent('Model'); model.data.assetId=asset.id; root.components.push(model);
  const map=new Map(metadata.nodes.map((_node,index)=>[index,crypto.randomUUID()]));
  const entities=[root]; const visited=new Set<number>();
  const visit=(index:number,parent:string) => {
    if(visited.has(index)) return; visited.add(index);
    const node=metadata.nodes[index]; if(!node) return;
    const entity=createEntity(String(node.name??'模型节点 '+index),parent); entity.id=map.get(index)!;
    const binding=createComponent('ModelNode'); binding.data.modelEntityId=root.id; binding.data.nodeIndex=index; entity.components.push(binding);
    const position=new THREE.Vector3().fromArray(node.translation as number[]??[0,0,0]),rotation=new THREE.Quaternion().fromArray(node.rotation as number[]??[0,0,0,1]),scale=new THREE.Vector3().fromArray(node.scale as number[]??[1,1,1]);
    if(node.matrix) new THREE.Matrix4().fromArray(node.matrix as number[]).decompose(position,rotation,scale);
    entity.transform={position:position.multiplyScalar(1000).toArray(),rotation:rotation.normalize().toArray() as [number,number,number,number],scale:scale.toArray()};entities.push(entity);
    for(const child of node.children as number[]??[]) visit(child,entity.id);
  };
  for(const index of metadata.roots) visit(index,root.id);
  if(metadata.animations.length) {const animation=createComponent('Animation');animation.data.modelEntityId=root.id;animation.data.clip=metadata.animations[0];root.components.push(animation);}
  return entities;
}

export { runAssetTask } from './AssetWorker';
