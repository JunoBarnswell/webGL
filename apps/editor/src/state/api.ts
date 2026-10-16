import { runAssetTask } from '@studio/asset-pipeline';
import type { SceneAsset, SceneDocument } from '@studio/scene-schema';
import type { FileBundle } from '@studio/asset-pipeline';
export interface CloudDraft { projectId: string; sceneId: string; revision: number; document: SceneDocument; publishedVersionId: string|null }
export interface Project { id: string; name: string; sceneId: string; revision: number; publishedVersionId: string|null; updatedAt: string }
export interface Version { id: string; sceneId: string; createdAt: string; published: boolean }
export class ApiError extends Error { constructor(readonly status: number, message: string, readonly details: string[] = []) { super(message); } }
export const token = () => sessionStorage.getItem('studio-token') ?? '';
export const authHeaders = (): HeadersInit => ({ Authorization:'Bearer '+token() });
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); for (const [key,value] of new Headers(authHeaders())) headers.set(key,value);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const response = await fetch('/api'+path,{...options,headers});
  if (!response.ok) {
    if(response.status===401 && path!=='/auth/login')window.dispatchEvent(new Event('studio-auth-expired'));
    const error = await response.json().catch(()=>({error:'HTTP '+response.status,details:[]}));
    throw new ApiError(response.status,error.error??'请求失败',error.details??[]);
  }
  return response.status===204 ? undefined as T : response.json() as Promise<T>;
}
export async function upload(name:string,kind:SceneAsset['kind'],entry:string,files:FileBundle,options:{signal?:AbortSignal;taskId?:string}={}):Promise<SceneAsset> {
  const body=await runAssetTask<Uint8Array>('pack',[...files],{signal:options.signal});
  const asset=await request<SceneAsset>('/assets?'+new URLSearchParams({name,kind,entry,...(options.taskId?{importTaskId:options.taskId}:{})}),{method:'POST',body:body as Uint8Array<ArrayBuffer>,headers:{'Content-Type':'application/zip'},signal:options.signal});
  if(['image','texture'].includes(kind)&&/\.(png|jpe?g|webp)$/i.test(entry)&&!asset.preview){
    const preview=await runAssetTask<{bytes:Uint8Array;width:number;height:number}>('thumbnail',files.get(entry),{signal:options.signal});
    return request<SceneAsset>('/assets/'+asset.id+'/preview?'+new URLSearchParams({width:String(preview.width),height:String(preview.height)}),{method:'PUT',body:preview.bytes as Uint8Array<ArrayBuffer>,headers:{'Content-Type':'image/webp'},signal:options.signal});
  }
  return asset;
}
export async function download(path: string, name: string): Promise<void> {
  const response=await fetch('/api'+path,{headers:authHeaders()}); if(!response.ok) throw new Error('导出失败: HTTP '+response.status);
  saveBlob(await response.blob(),name);
}
export function saveBlob(blob: Blob, name: string): void {
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
