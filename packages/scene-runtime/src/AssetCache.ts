import type { SceneAsset } from '@studio/scene-schema';
import type { AssetSource } from './AssetStore';

interface Entry { promise:Promise<ArrayBuffer>; controller:AbortController; refs:number; bytes:number; used:number; ready:boolean }
const entries=new Map<string,Entry>();const capacity=128*1024*1024;
function evict():void{let size=[...entries.values()].reduce((sum,e)=>sum+e.bytes,0);for(const [key,entry]of [...entries].sort((a,b)=>a[1].used-b[1].used)){if(size<=capacity)break;if(entry.ready&&!entry.refs){entries.delete(key);size-=entry.bytes;}}}
export function assetBytes(source:AssetSource,asset:SceneAsset,path=asset.entry,signal?:AbortSignal):Promise<ArrayBuffer>{
  if(signal?.aborted)return Promise.reject(new DOMException('读取已取消','AbortError'));
  const url=source.url(asset.id,path),key=url+'#'+asset.sha256;let entry=entries.get(key);
  if(!entry){const controller=new AbortController();entry={controller,refs:0,bytes:0,used:performance.now(),ready:false,promise:Promise.resolve(new ArrayBuffer(0))};const owned=entry;
    owned.promise=fetch(url,{headers:source.headers?.(),signal:controller.signal}).then(response=>{if(!response.ok)throw new Error(asset.name+': HTTP '+response.status);return response.arrayBuffer();}).then(bytes=>{owned.ready=true;owned.bytes=bytes.byteLength;evict();return bytes;}).catch(error=>{if(entries.get(key)===owned)entries.delete(key);throw error;});entries.set(key,owned);
  }
  const owned=entry;owned.refs++;owned.used=performance.now();
  return new Promise((resolve,reject)=>{let settled=false;const release=()=>{if(settled)return false;settled=true;signal?.removeEventListener('abort',abort);owned.refs--;if(!owned.refs&&!owned.ready)owned.controller.abort();evict();return true;};const abort=()=>{if(release())reject(new DOMException('读取已取消','AbortError'));};signal?.addEventListener('abort',abort,{once:true});owned.promise.then(bytes=>{if(release())resolve(bytes);},error=>{if(release())reject(error);});});
}
export function clearAssetCache():void{for(const entry of entries.values())entry.controller.abort();entries.clear();}
