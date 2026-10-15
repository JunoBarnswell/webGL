import { useEffect, useRef, useState } from 'react';
import { Box, Image as ImageIcon, Music2, Upload, FileBox, Trash2 } from 'lucide-react';
import { unzipSync } from 'fflate';
import { assertDocument, createComponent, createMaterial, documentReferences, type SceneAsset } from '@studio/scene-schema';
import { importO2vr, modelEntities, readGltf, type FileBundle, type ImportReport } from '@studio/asset-pipeline';
import { useStudio } from '../state/studio';
import { authHeaders, request, upload, type CloudDraft } from '../state/api';

export async function mountModel(asset:SceneAsset,parentId:string|null=null):Promise<void>{
  const files:FileBundle=new Map();
  await Promise.all(asset.files.map(async path=>{
    const response=await fetch('/api/assets/'+asset.id+'/files/'+path.split('/').map(encodeURIComponent).join('/'),{headers:authHeaders()});
    if(!response.ok)throw new Error('模型资源读取失败: '+response.status);
    files.set(path,new Uint8Array(await response.arrayBuffer()));
  }));
  const entities=modelEntities(asset,readGltf(files,asset.entry),parentId);
  useStudio.getState().command({label:'挂载模型',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);doc.entities.push(...entities);}});
  useStudio.getState().select([entities[0].id]);
}
function Thumbnail({asset}:{asset:SceneAsset}){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    if(!['image','texture'].includes(asset.kind))return;
    const abort=new AbortController();let objectUrl='';
    void fetch('/api/assets/'+asset.id+'/files/'+asset.entry.split('/').map(encodeURIComponent).join('/'),{headers:authHeaders(),signal:abort.signal}).then(async response=>{
      if(response.ok){objectUrl=URL.createObjectURL(await response.blob());setUrl(objectUrl);}
    }).catch(()=>{});
    return()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[asset.id,asset.entry,asset.kind]);
  return url?<img src={url} alt="" loading="lazy"/>:asset.kind==='model'?<Box/>:asset.kind==='audio'?<Music2/>:['image','texture'].includes(asset.kind)?<ImageIcon/>:<FileBox/>;
}
export function Resources(){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),mode=useStudio(s=>s.mode),busy=useStudio(s=>s.busy);
  const [filter,setFilter]=useState('all'),[report,setReport]=useState<ImportReport|null>(null),[library,setLibrary]=useState<{asset:SceneAsset;status:string}[]>([]);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{void request<{asset:SceneAsset;status:string}[]>('/assets').then(setLibrary).catch(()=>{});},[document?.assets.length,busy]);
  const importFiles=async(files:FileList|null)=>{
    if(!files?.length)return;
    await useStudio.getState().run('导入资源',async()=>{
      const bundle:FileBundle=new Map();
      for(const file of Array.from(files)){
        const bytes=new Uint8Array(await file.arrayBuffer());
        if(file.name.toLowerCase().endsWith('.zip')){for(const [path,content]of Object.entries(unzipSync(bytes)))if(!path.endsWith('/'))bundle.set(path,content);}
        else bundle.set(file.webkitRelativePath||file.name,bytes);
      }
      const paths=[...bundle.keys()];const scenePath=paths.find(path=>path.endsWith('scene.json'));
      if(scenePath){
        const source=JSON.parse(new TextDecoder().decode(bundle.get(scenePath)));
        if(source.schemaVersion){assertDocument(source);const draft=await request<CloudDraft>('/projects',{method:'POST',body:JSON.stringify({name:source.name,document:source})});await useStudio.getState().open(draft);return;}
        const prefix=scenePath.slice(0,scenePath.lastIndexOf('/')+1);
        const manifestPath=paths.find(path=>path.endsWith('manifest.json'));const editPath=paths.find(path=>path.endsWith('edit_info.json'));
        const imported=await importO2vr(source,manifestPath?JSON.parse(new TextDecoder().decode(bundle.get(manifestPath))):{},editPath?JSON.parse(new TextDecoder().decode(bundle.get(editPath))):{},
          async path=>{
            if(/^https?:/.test(path)){const response=await fetch(path);if(!response.ok)throw new Error('外部资源 HTTP '+response.status);return new Uint8Array(await response.arrayBuffer());}
            const content=bundle.get(path)??bundle.get(prefix+path.replace('model/showroom/',''));if(!content)throw new Error('资源包中缺失');return content;
          },upload);
        setReport(imported.report);const draft=await request<CloudDraft>('/projects',{method:'POST',body:JSON.stringify({name:imported.document.name,document:imported.document})});await useStudio.getState().open(draft);return;
      }
      const entry=paths.find(path=>/\.(gltf|glb)$/i.test(path));
      if(entry){const metadata=readGltf(bundle,entry);const asset=await upload(entry.split('/').pop()!,'model',entry,bundle);const entities=modelEntities(asset,metadata,selected[0]??null);useStudio.getState().command({label:'导入模型',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);doc.entities.push(...entities);}});useStudio.getState().select([entities[0].id]);}
      else for(const [entry,bytes]of bundle){
        const kind:SceneAsset['kind']=/\.(mp3|wav|ogg)$/i.test(entry)?'audio':/\.(png|jpe?g|webp)$/i.test(entry)?'image':'texture';
        const asset=await upload(entry.split('/').pop()!,kind,entry,new Map([[entry,bytes]]));
        useStudio.getState().command({label:'导入资源',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);}});
      }
    });
    if(input.current)input.current.value='';
  };
  const assets=document?.assets.filter(asset=>filter==='all'||asset.kind===filter)??[];
  const attach=async(asset:SceneAsset)=>{
    if(asset.kind==='model'){await mountModel(asset,selected[0]??null);return;}
    const id=selected[0];if(!id)throw new Error('请先选择要绑定资源的节点');
    useStudio.getState().command({label:'绑定业务资源',mutate:doc=>{
      const entity=doc.entities.find(e=>e.id===id)!;const type=asset.kind==='audio'?'Audio':'Artwork';
      let component=entity.components.find(c=>c.type===type);if(!component){component=createComponent(type);entity.components.push(component);}
      component.data.assetId=asset.id;if(type==='Artwork')component.data.title=asset.name;
    }});
  };
  return <section className="panel resource-panel"><div className="panel-toolbar"><div className="tabs">{[['all','全部'],['material','材质'],['model','模型'],['image','图片'],['texture','纹理'],['audio','音频'],['mesh','网格']].map(([value,title])=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{title}</button>)}</div><button disabled={mode==='play'||Boolean(busy)} onClick={()=>{if(filter==='material')useStudio.getState().command({label:'新建材质',mutate:doc=>{doc.materials.push(createMaterial('新材质'));}});else input.current?.click();}}><Upload size={14}/> {filter==='material'?'新建材质':'导入资源'}</button><input ref={input} type="file" multiple hidden aria-label="导入资源文件" onChange={event=>void importFiles(event.target.files)}/></div>
    <div className="asset-grid">{filter==='material'&&document?.materials.map(material=><article key={material.id} className="asset" draggable={mode==='edit'} onDragStart={event=>event.dataTransfer.setData('studio/material',material.id)}>
      <button className="asset-preview material-preview" title={'使用材质 '+material.name} disabled={mode==='play'} onClick={()=>useStudio.getState().command({label:'使用材质',mutate:doc=>{
        const entity=doc.entities.find(e=>e.id===selected[0]);const component=entity?.components.find(c=>['Mesh','Model','ModelNode'].includes(c.type));if(!component)throw new Error('请先选择模型或网格节点');component.data.materialId=material.id;
      }})}><span style={{backgroundColor:material.color,opacity:material.opacity}}/></button><div className="asset-name">{material.name}</div><div className="asset-meta">{material.kind} · {Object.keys(material.maps).length} 张贴图</div>
    </article>)}{assets.map(asset=>{
      const status=library.find(item=>item.asset.id===asset.id)?.status;const missing=status!=='Ready';
      return <article key={asset.id} className={'asset '+(missing?'asset-missing':'')} draggable={mode==='edit'} onDragStart={event=>event.dataTransfer.setData('studio/asset',asset.id)}>
        <button className="asset-preview" disabled={mode==='play'} onClick={()=>void useStudio.getState().run('使用资源',()=>attach(asset))}><Thumbnail asset={asset}/></button><div className="asset-name" title={asset.name}>{asset.name}</div><div className="asset-meta"><span>{missing?'未就绪':asset.kind}</span><button className="icon-button" aria-label={'移除资源 '+asset.name} disabled={mode==='play'} onClick={()=>{
          if(documentReferences(document!).some(ref=>ref.kind==='asset'&&ref.id===asset.id)){useStudio.getState().set({message:'资源仍被组件或材质引用，请先移除绑定'});return;}
          useStudio.getState().command({label:'移除工程资源',mutate:doc=>{doc.assets=doc.assets.filter(a=>a.id!==asset.id);}});
        }}><Trash2/></button></div>
      </article>;
    })}{(filter==='material'?!document?.materials.length:assets.length===0)&&<div className="empty-state">导入 GLB / glTF 与依赖文件，或完整 O2VR ZIP。<br/>资源可拖入视口，图片与音频可绑定到选中对象。</div>}</div>
    <details className="cloud-library"><summary>云端资源库 · {library.length}</summary><div className="cloud-resources">{library.slice(0,300).map(({asset,status})=><div key={asset.id}><span>{asset.name} · {status}</span><button disabled={mode==='play'||status!=='Ready'} onClick={()=>useStudio.getState().command({label:'引用云端资源',mutate:doc=>{if(!doc.assets.some(a=>a.id===asset.id))doc.assets.push(asset);}})}>引用</button><button className="text-button danger" onClick={()=>void useStudio.getState().run('删除云资源',async()=>{await request('/assets/'+asset.id,{method:'DELETE'});})}>删除</button></div>)}</div></details>
    {report&&<details open className="import-report"><summary>导入报告：{report.sourceNodes} 节点 / {report.meshes} Mesh / {report.bindings} 绑定</summary>{report.missing.map((item,index)=><p className="danger" key={index}>{item}</p>)}{report.conflicts.map(item=><p key={item}>{item}</p>)}<p>未支持字段：{report.unsupported.join('、')||'无'}</p></details>}
  </section>;
}
