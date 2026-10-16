import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, X } from 'lucide-react';
import { createComponent, createMaterial, documentReferences, type SceneAsset } from '@studio/scene-schema';
import { bindContent } from '@studio/editor-core';
import { modelEntities, runAssetTask, type FileBundle, type ImportReport, type readGltf } from '@studio/asset-pipeline';
import { assetBytes } from '@studio/scene-runtime';
import { useStudio } from '../state/studio';
import { authHeaders, request, upload } from '../state/api';
import { AssetThumbnail } from '../components/AssetThumbnail';

const source={url:(id:string,path:string)=>'/api/assets/'+id+'/files/'+path.split('/').map(encodeURIComponent).join('/'),headers:authHeaders};
export async function mountModel(asset:SceneAsset,parentId:string|null=null):Promise<void>{
  const sceneId=useStudio.getState().document?.sceneId;
  const entry=new Uint8Array(await assetBytes(source,asset));
  const metadata=await runAssetTask<ReturnType<typeof readGltf>>('gltf',{files:[[asset.entry,entry]],entry:asset.entry});
  if(useStudio.getState().document?.sceneId!==sceneId)throw new Error('场景已切换，未挂载模型');
  const entities=modelEntities(asset,metadata,parentId);
  useStudio.getState().command({label:'挂载模型',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);doc.entities.push(...entities);}});useStudio.getState().select([entities[0].id]);
}
export function Resources(){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),mode=useStudio(s=>s.mode);
  const [filter,setFilter]=useState('all'),[report,setReport]=useState<ImportReport|null>(null),[library,setLibrary]=useState<{asset:SceneAsset;status:string}[]>([]),[page,setPage]=useState(48),[progress,setProgress]=useState(''),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
  useEffect(()=>{const abort=new AbortController();void request<{asset:SceneAsset;status:string}[]>('/assets',{signal:abort.signal}).then(setLibrary).catch(error=>{if(!abort.signal.aborted)setError(String(error));});return()=>abort.abort();},[document?.assets.length]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const importFiles=async(files:FileList|null)=>{
    if(!files?.length||controller.current)return;const abort=new AbortController();controller.current=abort;const taskId=crypto.randomUUID(),sceneId=document?.sceneId;setError('');setProgress('正在读取文件');
    try{
      const raw=[];for(const file of Array.from(files))raw.push({name:file.webkitRelativePath||file.name,bytes:new Uint8Array(await file.arrayBuffer())});
      const pairs=await runAssetTask<[string,Uint8Array][]>('unpack',raw,{signal:abort.signal});const bundle:FileBundle=new Map(pairs),paths=[...bundle.keys()];setProgress('正在解析资源');
      if(paths.some(p=>p.endsWith('scene.json'))){
        const imported=await runAssetTask<{document:NonNullable<typeof document>;report:ImportReport}>('o2vr',{files:pairs,origin:location.origin,headers:authHeaders(),taskId},{signal:abort.signal,onProgress:message=>setProgress(message)});
        if(useStudio.getState().document!==document)throw new Error('导入期间工程已变化，未覆盖当前创作；请重新导入');
        useStudio.getState().session!.execute({kind:'replaceScene',label:'导入展厅',mutate:doc=>{const id=doc.sceneId;Object.assign(doc,imported.document,{sceneId:id});}});setReport(imported.report);
      }else{
        const assets:SceneAsset[]=[];const entry=paths.find(path=>/\.(gltf|glb)$/i.test(path));let entities:ReturnType<typeof modelEntities>=[];
        if(entry){const metadata=await runAssetTask<ReturnType<typeof readGltf>>('gltf',{files:pairs,entry},{signal:abort.signal});setProgress('上传模型与依赖');const asset=await upload(entry.split('/').pop()!,'model',entry,bundle,{signal:abort.signal,taskId});assets.push(asset);entities=modelEntities(asset,metadata,selected[0]??null);}
        else for(const [entry,bytes]of bundle){setProgress('上传 '+entry);const kind:SceneAsset['kind']=/\.(mp3|wav|ogg)$/i.test(entry)?'audio':/\.(png|jpe?g|webp)$/i.test(entry)?'image':'texture';assets.push(await upload(entry.split('/').pop()!,kind,entry,new Map([[entry,bytes]]),{signal:abort.signal,taskId}));}
        abort.signal.throwIfAborted();if(useStudio.getState().document?.sceneId!==sceneId)throw new Error('场景已切换，导入未提交');
        useStudio.getState().session!.execute({label:entry?'导入模型':'导入资源',mutate:doc=>{for(const asset of assets)if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);doc.entities.push(...entities);}});if(entities[0])useStudio.getState().select([entities[0].id]);
      }
    }catch(error){setError(abort.signal.aborted?'导入已取消，未提交场景变更':String(error));try{await request('/imports/'+taskId,{method:'DELETE'});}catch(cleanup){setError(previous=>previous+'；资源清理失败：'+String(cleanup));}}
    finally{controller.current=null;setProgress('');if(input.current)input.current.value='';}
  };
  const assets=document?.assets.filter(asset=>filter==='all'||asset.kind===filter)??[];const cloud=library.filter(item=>filter==='all'||item.asset.kind===filter);
  const attach=async(asset:SceneAsset)=>{
    if(asset.kind==='model'){await mountModel(asset,selected[0]??null);return;}const id=selected[0];if(!id)throw new Error('先在场景中选中一个对象');
    if(['image','texture'].includes(asset.kind))useStudio.getState().command(bindContent(id,'Artwork',asset));
    else if(asset.kind==='audio')useStudio.getState().command({label:'绑定音频',mutate:doc=>{const entity=doc.entities.find(e=>e.id===id)!;let audio=entity.components.find(c=>c.type==='Audio');if(!audio){audio=createComponent('Audio');entity.components.push(audio);}audio.data.assetId=asset.id;}});
    else throw new Error('此资源请在属性面板中绑定');
  };
  return <section className="panel resource-panel"><div className="panel-toolbar"><strong>资源库</strong><button onClick={()=>useStudio.getState().set({assetsOpen:false})} aria-label="关闭资源库"><X size={16}/></button></div><div className="panel-toolbar"><div className="tabs">{[['all','全部'],['material','材质'],['model','模型'],['image','图片'],['texture','纹理'],['audio','音频'],['mesh','网格']].map(([value,title])=><button key={value} className={filter===value?'active':''} onClick={()=>{setFilter(value);setPage(48);}}>{title}</button>)}</div><button disabled={mode==='play'||!!progress} onClick={()=>{if(filter==='material')useStudio.getState().command({label:'新建材质',mutate:doc=>{doc.materials.push(createMaterial('新材质'));}});else input.current?.click();}}><Upload size={14}/> {filter==='material'?'新建材质':'导入资源'}</button><input ref={input} type="file" multiple hidden aria-label="导入资源文件" onChange={event=>void importFiles(event.target.files)}/></div>
    {progress&&<div role="status" className="import-progress"><span>{progress}</span><button onClick={()=>{controller.current?.abort();setProgress('正在取消…');}}>取消导入</button></div>}{error&&<p role="alert" className="task-callout danger">{error}</p>}
    <div className="asset-grid">{filter==='material'&&document?.materials.map(material=><article key={material.id} className="asset" draggable={mode==='edit'} onDragStart={event=>event.dataTransfer.setData('studio/material',material.id)}><button className="asset-preview material-preview" disabled={mode==='play'} onClick={()=>useStudio.getState().command({label:'使用材质',mutate:doc=>{const entity=doc.entities.find(e=>e.id===selected[0]);const component=entity?.components.find(c=>['Mesh','Model','ModelNode'].includes(c.type));if(!component)throw new Error('先选择模型或网格');component.data.materialId=material.id;}})}><span style={{backgroundColor:material.color,opacity:material.opacity}}/></button><div className="asset-name">{material.name}</div></article>)}{assets.slice(0,page).map(asset=><article key={asset.id} className="asset" draggable={mode==='edit'} onDragStart={event=>event.dataTransfer.setData('studio/asset',asset.id)}><button className="asset-preview" disabled={mode==='play'} onClick={()=>void attach(asset).catch(error=>setError(String(error)))}><AssetThumbnail asset={asset}/></button><div className="asset-name" title={asset.name}>{asset.name}</div><div className="asset-meta"><span>{library.find(a=>a.asset.id===asset.id)?.status??'未知状态'} · {asset.kind}</span><button className="icon-button" aria-label={'移除资源 '+asset.name} disabled={mode==='play'} onClick={()=>{if(documentReferences(document!).some(ref=>ref.kind==='asset'&&ref.id===asset.id)){setError('资源仍被内容、视点、界面或材质引用');return;}useStudio.getState().command({label:'移除工程资源',mutate:doc=>{doc.assets=doc.assets.filter(a=>a.id!==asset.id);}});}}><Trash2/></button></div></article>)}</div>{assets.length>page&&<button onClick={()=>setPage(page+48)}>加载更多 · {assets.length-page}</button>}
    <details className="cloud-library"><summary>云端资源 · {cloud.length} / {library.length}</summary>{cloud.slice(0,page).map(({asset,status})=><div className="cloud-resource" key={asset.id}><span>{asset.name} · {status}</span><button disabled={mode==='play'||status!=='Ready'} onClick={()=>useStudio.getState().command({label:'引用云端资源',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);}})}>引用</button><button disabled={document?.assets.some(a=>a.id===asset.id)} title={document?.assets.some(a=>a.id===asset.id)?'先从工程移除并保存，再删除云端资源':''} onClick={()=>void request('/assets/'+asset.id,{method:'DELETE'}).then(()=>setLibrary(items=>items.filter(i=>i.asset.id!==asset.id))).catch(error=>setError(String(error)))}>删除</button></div>)}{cloud.length>page&&<button onClick={()=>setPage(page+48)}>显示更多云端资源 · {cloud.length-page}</button>}</details>
    {report&&<details open className="import-report"><summary>导入报告：{report.sourceNodes} 节点 / {report.meshes} Mesh / {report.bindings} 绑定</summary>{report.missing.map((item,index)=><p className="danger" key={index}>{item}</p>)}{report.conflicts.map(item=><p key={item}>{item}</p>)}<p>未支持字段：{report.unsupported.join('、')||'无'}</p></details>}
  </section>;
}
