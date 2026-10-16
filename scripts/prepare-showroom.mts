import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { zipSync } from 'fflate';
import type { SceneAsset } from '@studio/scene-schema';

const base=process.env.STUDIO_API??'http://127.0.0.1:18080';
const config=JSON.parse(await readFile(new URL('../.local/config.json',import.meta.url),'utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:config.adminUser,password:config.adminPassword})});
if(!login.ok)throw new Error('本地登录失败');const token=(await login.json()).token,headers={Authorization:'Bearer '+token};
const libraryResponse=await fetch(base+'/api/assets',{headers});if(!libraryResponse.ok)throw new Error('资源目录读取失败');const library=await libraryResponse.json() as {asset:SceneAsset;status:string}[];
const files:Record<string,Uint8Array>={};
async function directory(path:string){for(const entry of await readdir(new URL('../public/'+path,import.meta.url),{withFileTypes:true})){const name=path+'/'+entry.name;if(entry.isDirectory())await directory(name);else files[name]=new Uint8Array(await readFile(new URL('../public/'+name,import.meta.url)));}}
await directory('model/showroom');files['model/avatar/character.glb']=new Uint8Array(await readFile(new URL('../public/model/avatar/character.glb',import.meta.url)));files['audio/bgm.mp3']=new Uint8Array(await readFile(new URL('../public/audio/bgm.mp3',import.meta.url)));
const manifest=JSON.parse(await readFile(new URL('../public/artworks/manifest.json',import.meta.url),'utf8'));
const edit=JSON.parse(await readFile(new URL('../public/model/showroom/edit_info.json',import.meta.url),'utf8'));
let count=0;for(const [uuid,binding]of Object.entries(manifest) as [string,{url:string}][]){const name=decodeURIComponent(binding.url.split('/').pop()!.split('?')[0]);const cached=library.filter(a=>a.status==='Ready'&&a.asset.name===name&&a.asset.kind==='image');
  const response=await fetch(cached.length===1?base+'/api/assets/'+cached[0].asset.id+'/files/'+cached[0].asset.entry:binding.url,{headers:cached.length===1?headers:undefined});if(!response.ok)throw new Error('作品资源不可读取：'+name+' HTTP '+response.status);
  const path='artworks/'+name;files[path]=new Uint8Array(await response.arrayBuffer());binding.url=path;if(edit.user_item_info?.[uuid])edit.user_item_info[uuid].url=path;count++;
}
files['artworks/manifest.json']=new TextEncoder().encode(JSON.stringify(manifest));files['model/showroom/edit_info.json']=new TextEncoder().encode(JSON.stringify(edit));
await mkdir(new URL('../.local/import',import.meta.url),{recursive:true});await writeFile(new URL('../.local/import/showroom-source.zip',import.meta.url),zipSync(files,{level:0}));
console.log(JSON.stringify({files:Object.keys(files).length,artworks:count,path:'.local/import/showroom-source.zip'}));
