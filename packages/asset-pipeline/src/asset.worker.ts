import * as THREE from 'three';
import { unzipSync, zipSync } from 'fflate';
import { importO2vr, readGltf, type FileBundle } from './index';
import type { SceneAsset } from '@studio/scene-schema';

const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
function transferables(value:unknown,found=new Set<ArrayBuffer>()):ArrayBuffer[]{
  if(ArrayBuffer.isView(value)&&value.buffer instanceof ArrayBuffer)found.add(value.buffer);
  else if(value instanceof ArrayBuffer)found.add(value);
  else if(value&&typeof value==='object')for(const child of Object.values(value))transferables(child,found);
  return [...found];
}
scope.onmessage=async event=>{
  try{
    const {operation,payload}=event.data;let result:unknown;
    if(operation==='unpack'){
      const bundle:FileBundle=new Map();for(const file of payload as {name:string;bytes:Uint8Array}[]){if(file.name.toLowerCase().endsWith('.zip'))for(const [name,bytes]of Object.entries(unzipSync(file.bytes))){if(!name.endsWith('/'))bundle.set(name,bytes);}else bundle.set(file.name,file.bytes);}result=[...bundle];
    }else if(operation==='pack')result=zipSync(Object.fromEntries(payload as [string,Uint8Array][]),{level:0});
    else if(operation==='json')result=JSON.parse(new TextDecoder().decode(payload));
    else if(operation==='gltf')result=readGltf(new Map(payload.files),payload.entry);
    else if(operation==='geometry'){
      const geometry=new THREE.BufferGeometryLoader().parse(JSON.parse(new TextDecoder().decode(payload)));
      const attribute=(a:THREE.BufferAttribute|THREE.InterleavedBufferAttribute)=>{if(a instanceof THREE.InterleavedBufferAttribute)throw new Error('独立几何不接受交错属性');return {array:a.array,itemSize:a.itemSize,normalized:a.normalized};};
      result={attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,attribute(a)])),index:geometry.index?attribute(geometry.index):null,groups:geometry.groups};geometry.dispose();
    }else if(operation==='thumbnail'){
      const bitmap=await createImageBitmap(new Blob([payload as ArrayBuffer]));const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));const canvas=new OffscreenCanvas(width,height);const context=canvas.getContext('2d');if(!context)throw new Error('缩略图画布不可用');context.drawImage(bitmap,0,0,width,height);bitmap.close();const blob=await canvas.convertToBlob({type:'image/webp',quality:.78});result={bytes:new Uint8Array(await blob.arrayBuffer()),width,height};
    }else if(operation==='o2vr'){
      const bundle:FileBundle=new Map(payload.files);const paths=[...bundle.keys()];const scenePath=paths.find(p=>p.endsWith('scene.json'));if(!scenePath)throw new Error('资源包缺少 scene.json');
      const parse=(path:string)=>JSON.parse(new TextDecoder().decode(bundle.get(path)!));const prefix=scenePath.slice(0,scenePath.lastIndexOf('/')+1),manifest=paths.find(p=>p.endsWith('manifest.json')),edit=paths.find(p=>p.endsWith('edit_info.json'));let completed=0;
      const read=async(path:string):Promise<Uint8Array>=>{if(/^https?:/.test(path)){const response=await fetch(path);if(!response.ok)throw new Error('外部资源 HTTP '+response.status);return new Uint8Array(await response.arrayBuffer());}const bytes=bundle.get(path)??bundle.get(prefix+path.replace('model/showroom/',''));if(!bytes)throw new Error('资源包缺失 '+path);return bytes;};
      result=await importO2vr(parse(scenePath),manifest?parse(manifest):{},edit?parse(edit):{},read,async(name,kind,entry,files)=>{
        scope.postMessage({progress:true,message:'上传 '+name,completed,total:0});
        const response=await fetch(payload.origin+'/api/assets?'+new URLSearchParams({name,kind,entry,importTaskId:payload.taskId}),{method:'POST',body:zipSync(Object.fromEntries(files),{level:0}) as Uint8Array<ArrayBuffer>,headers:{...payload.headers,'Content-Type':'application/zip'}});
        if(!response.ok)throw new Error('上传 '+name+' 失败：HTTP '+response.status);completed++;let asset=await response.json() as SceneAsset;
        if(['image','texture'].includes(kind)&&/\.(png|jpe?g|webp)$/i.test(entry)&&!asset.preview){
          const bytes=files.get(entry)!;const bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));const ratio=Math.min(1,256/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio));const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d')!.drawImage(bitmap,0,0,width,height);bitmap.close();const blob=await canvas.convertToBlob({type:'image/webp',quality:.78});
          const preview=await fetch(payload.origin+'/api/assets/'+asset.id+'/preview?width='+width+'&height='+height,{method:'PUT',body:blob,headers:{...payload.headers,'Content-Type':'image/webp'}});if(!preview.ok)throw new Error('缩略图归档失败：'+name);asset=await preview.json();
        }return asset;
      });
    }else throw new Error('未知资源操作 '+operation);
    scope.postMessage({result},transferables(result));
  }catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)});}
};
