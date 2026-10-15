import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createComponent,createDocument,createEntity,createMaterial,validateDocument,type SceneDocument } from '@studio/scene-schema';
import { EditorSession,addEntity,deleteEntities,duplicateEntities,reparentEntity } from '@studio/editor-core';
const document=createDocument('契约验证');const first=createEntity('父节点'),child=createEntity('子节点',first.id);document.entities.push(first,child);
const session=new EditorSession(document);const changes:string[]=[];session.subscribe((_change,label)=>changes.push(label));
session.execute(duplicateEntities([first.id]));assert.equal(session.document.entities.length,4);const copies=session.document.entities.slice(2);assert.equal(copies[1].parentId,copies[0].id);
session.undo();assert.equal(session.document.entities.length,2);session.redo();assert.equal(session.document.entities.length,4);
session.execute(reparentEntity(child.id,null));assert.equal(session.document.entities.find(e=>e.id===child.id)!.parentId,null);
session.execute(deleteEntities([first.id]));assert.equal(session.document.entities.length,3);session.undo();assert.equal(session.document.entities.length,4);
const history=session.history.length;assert.throws(()=>session.execute({label:'无效事务',mutate:doc=>{doc.entities[0].parentId=doc.entities[0].id;}}));assert.equal(session.history.length,history);
assert.throws(()=>{session.document.entities[0].name='绕过命令';});
session.execute(addEntity());assert.equal(changes.at(-1),'新增节点');
const fixtures:{name:string;document:SceneDocument;valid:boolean}[]=[];
const add=(name:string,mutate:(doc:SceneDocument)=>void,valid=false)=>{const doc=createDocument(name);mutate(doc);fixtures.push({name,document:doc,valid});};
add('empty valid',()=>{},true);
add('disabled render and animation',doc=>{const entity=createEntity();const model=createComponent('Model'),animation=createComponent('Animation');model.enabled=false;animation.enabled=false;entity.components.push(model,animation);doc.entities.push(entity);},true);
add('unfinished behavior draft',doc=>{doc.behaviors.push({id:'unfinished',name:'未完成交互',event:'ready',sourceId:'',condition:{once:false,viewMode:'any',displayMode:'any'},actions:[]});},true);
add('unfinished animation draft',doc=>{const entity=createEntity();entity.components.push(createComponent('Animation'));doc.entities.push(entity);},true);
add('all component defaults',doc=>{const entity=createEntity();entity.components.push(createComponent('Hotspot'),createComponent('Cruise'),createComponent('Zone'),createComponent('Panorama'),createComponent('Trigger'));doc.entities.push(entity);},true);
add('cycle',doc=>{const e=createEntity();e.parentId=e.id;doc.entities.push(e);});
add('unknown component',doc=>{const e=createEntity();e.components.push({type:'Unknown',enabled:true,data:{}} as never);doc.entities.push(e);});
add('quaternion',doc=>{const e=createEntity();e.transform.rotation=[0,0,0,0];doc.entities.push(e);});
add('zero scale',doc=>{const e=createEntity();e.transform.scale[0]=0;doc.entities.push(e);});
add('missing asset reference',doc=>{const e=createEntity();const c=createComponent('Artwork');c.data.assetId='absent';e.components.push(c);doc.entities.push(e);});
add('texture reference',doc=>{const material=createMaterial();material.maps.map={assetId:'absent',offset:[0,0],repeat:[1,1],rotation:0,channel:0,flipY:true,colorSpace:'srgb'};doc.materials.push(material);});
add('environment reference',doc=>{doc.settings.environmentAssetIds=['absent'];});
add('duplicate id',doc=>{const e=createEntity();doc.entities.push(e,structuredClone(e));});
add('bad path',doc=>{doc.assets.push({id:'asset',name:'bad',kind:'image',entry:'../bad',files:['../bad'],sha256:'0'.repeat(64)});});
add('invalid color',doc=>{doc.settings.background='wrong';});
for(const fixture of fixtures)assert.equal(validateDocument(fixture.document).length===0,fixture.valid,fixture.name);
const config=JSON.parse(await readFile(new URL('../.local/config.json',import.meta.url),'utf8'));const base=process.env.STUDIO_API??'http://127.0.0.1:18080';
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:config.adminUser,password:config.adminPassword})});assert.equal(login.status,200);const token=(await login.json()).token;
for(const fixture of fixtures){
 const response=await fetch(base+'/api/projects',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:fixture.name,document:fixture.document})});
 assert.equal(response.ok,fixture.valid,'API/TS contract divergence: '+fixture.name+' '+await response.clone().text());
 if(response.ok){
  const draft=await response.json();
  if(fixture.name.startsWith('unfinished')){
    assert.ok(validateDocument(fixture.document,true).length>0,'unfinished configuration must block publication');
    const published=await fetch(base+'/api/scenes/'+draft.sceneId+'/publish',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:draft.revision})});
    assert.equal(published.status,422,'API must reject unfinished publication');
  }
  if(fixture.name==='disabled render and animation'){
    assert.equal(validateDocument(fixture.document,true).length,0);
    const published=await fetch(base+'/api/scenes/'+draft.sceneId+'/publish',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:draft.revision})});
    assert.equal(published.status,200,'disabled incomplete components must not execute publication dependencies');
  }
  assert.equal((await fetch(base+'/api/projects/'+draft.projectId,{method:'DELETE',headers:{Authorization:'Bearer '+token}})).status,204);
 }
}
await mkdir(new URL('../.local/acceptance',import.meta.url),{recursive:true});
await writeFile(new URL('../.local/acceptance/contracts.json',import.meta.url),JSON.stringify({status:'Pass',fixtures:fixtures.map(f=>f.name),commands:changes.length,at:new Date().toISOString()},null,2));
console.log('Pass: editor transactions, hierarchy, immutable history, and '+fixtures.length+' cross-language contract fixtures.');
