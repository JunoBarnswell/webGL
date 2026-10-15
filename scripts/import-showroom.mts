import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { importO2vr, type FileBundle } from '@studio/asset-pipeline';
import { assertDocument, type SceneAsset } from '@studio/scene-schema';
import assert from 'node:assert/strict';
const config=JSON.parse(await readFile(new URL('../.local/config.json',import.meta.url),'utf8'));
const base=process.env.STUDIO_API??'http://127.0.0.1:18080';
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:config.adminUser,password:config.adminPassword})});
if(!login.ok)throw new Error('登录失败 HTTP '+login.status);
const token=(await login.json()).token;
async function register(name:string,kind:SceneAsset['kind'],entry:string,files:FileBundle):Promise<SceneAsset>{
  const response=await fetch(base+'/api/assets?'+new URLSearchParams({name,kind,entry}),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/zip'},body:zipSync(Object.fromEntries(files),{level:0}) as Uint8Array<ArrayBuffer>});
  if(!response.ok)throw new Error('归档失败 HTTP '+response.status+' '+await response.text());
  return response.json();
}
const scene=JSON.parse(await readFile(new URL('../public/model/showroom/scene.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('../public/artworks/manifest.json',import.meta.url),'utf8'));
const edit=JSON.parse(await readFile(new URL('../public/model/showroom/edit_info.json',import.meta.url),'utf8'));
const imported=await importO2vr(scene,manifest,edit,async path=>{
  if(/^https?:/.test(path)){
    const response=await fetch(path);
    if(!response.ok)throw new Error('图片 HTTP '+response.status);
    return new Uint8Array(await response.arrayBuffer());
  }
  return new Uint8Array(await readFile(new URL('../public/'+path,import.meta.url)));
},register);
assert.equal(imported.report.sourceNodes,80);assert.equal(imported.report.meshes,70);assert.equal(imported.report.bindings,57);assertDocument(imported.document);
await mkdir(new URL('../.local/import',import.meta.url),{recursive:true});
await writeFile(new URL('../.local/import/report.json',import.meta.url),JSON.stringify(imported.report,null,2));
await writeFile(new URL('../.local/import/scene.json',import.meta.url),JSON.stringify(imported.document,null,2));
const created=await fetch(base+'/api/projects',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:imported.document.name,document:imported.document})});
if(!created.ok)throw new Error('工程创建失败 HTTP '+created.status+' '+await created.text());
const draft=await created.json();await writeFile(new URL('../.local/import/draft.json',import.meta.url),JSON.stringify(draft,null,2));
console.log(JSON.stringify({sceneId:draft.sceneId,projectId:draft.projectId,nodes:imported.report.sourceNodes,meshes:imported.report.meshes,bindings:imported.report.bindings,assets:imported.document.assets.length,missing:imported.report.missing.length,conflicts:imported.report.conflicts.length,report:'.local/import/report.json'}));
