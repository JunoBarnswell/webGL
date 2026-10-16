export interface AssetTaskOptions { signal?:AbortSignal; onProgress?:(message:string,completed:number,total:number)=>void }
interface Job { id:number; operation:string; payload:unknown; options:AssetTaskOptions; resolve:(value:unknown)=>void; reject:(error:Error)=>void }
const queue:Job[]=[];let serial=0;
const slots:{worker:Worker|null;busy:boolean}[]=[{worker:null,busy:false},{worker:null,busy:false}];
function start():void{
  for(const slot of slots){
    if(slot.busy||!queue.length)continue;
    const job=queue.shift()!;if(job.options.signal?.aborted){job.reject(new DOMException('任务已取消','AbortError'));continue;}
    slot.busy=true;const worker=slot.worker??new Worker(new URL('./asset.worker.ts',import.meta.url),{type:'module'});slot.worker=worker;
    let done=false;
    const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;if(error){worker.terminate();slot.worker=null;}worker.onmessage=null;worker.onerror=null;job.options.signal?.removeEventListener('abort',abort);slot.busy=false;if(error)job.reject(error);else job.resolve(value);start();};
    const abort=()=>finish(new DOMException('任务已取消','AbortError'));
    job.options.signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=(event:MessageEvent)=>{const response=event.data;if(response.progress){job.options.onProgress?.(response.message,response.completed,response.total);return;}if(response.error)finish(new Error(response.error));else finish(undefined,response.result);};
    worker.onerror=event=>finish(new Error('资源 Worker 失败：'+event.message));
    worker.postMessage({operation:job.operation,payload:job.payload});
  }
  if(queue.length&&slots.some(slot=>!slot.busy))start();
}
export function runAssetTask<T>(operation:string,payload:unknown,options:AssetTaskOptions={}):Promise<T>{
  return new Promise((resolve,reject)=>{queue.push({id:++serial,operation,payload,options,resolve:resolve as (value:unknown)=>void,reject});start();});
}
