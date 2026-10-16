import { useEffect, useRef, useState } from 'react';
import { ContentPanel } from './panels/ContentPanel';
import { TourPanel } from './panels/TourPanel';
import { InterfaceCanvas } from './panels/InterfaceCanvas';
import { clearAssetCache } from '@studio/scene-runtime';
import { runAssetTask } from '@studio/asset-pipeline';
import { localDraft, resolveLocalDraft } from './state/journal';
import type { Workspace } from './state/studio';
import { Box, CloudUpload, FolderOpen, History, Play, Redo2, Save, Square, Undo2, Upload, X, LayoutDashboard, MoreHorizontal } from 'lucide-react';
import { assertDocument } from '@studio/scene-schema';
import { deleteEntities, duplicateEntities } from '@studio/editor-core';
import { SceneTree } from './panels/SceneTree';
import { Inspector } from './panels/Inspector';
import { Viewport } from './panels/Viewport';
import { Resources } from './panels/Resources';
import { Interactions } from './panels/Interactions';
import { Login, ProjectsDialog, RecoveryDialog, VersionsDialog } from './components/Dialogs';
import { useStudio } from './state/studio';
import { ApiError, download, request, saveBlob, token, type CloudDraft } from './state/api';

const tasks:[Workspace,string,string][]=[['scene','场景搭建','搭建空间与外观'],['content','热点内容','作品与介绍'],['tour','导览巡航','记录镜头与路线'],['interaction','事件交互','当…如果…就…'],['interface','界面设计','设计 Player 界面']];
export default function App(){
  const [authenticated,setAuthenticated]=useState(Boolean(token())),[dialog,setDialog]=useState<'projects'|'versions'|null>(null),[published,setPublished]=useState('');
  const file=useRef<HTMLInputElement>(null);
  const document=useStudio(s=>s.document),session=useStudio(s=>s.session),mode=useStudio(s=>s.mode),saveState=useStudio(s=>s.saveState),message=useStudio(s=>s.message),busy=useStudio(s=>s.busy),layoutEpoch=useStudio(s=>s.layoutEpoch),issues=useStudio(s=>s.issues),revision=useStudio(s=>s.revision);
  const workspace=useStudio(s=>s.workspace),assetsOpen=useStudio(s=>s.assetsOpen),inspectorOpen=useStudio(s=>s.inspectorOpen);
  const [leftOpen,setLeftOpen]=useState(window.innerWidth>=768);
  useEffect(()=>{const resize=()=>{if(window.innerWidth<1024)useStudio.getState().set({inspectorOpen:false});if(window.innerWidth<768)setLeftOpen(false);};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{
    if(!authenticated)return;
    void useStudio.getState().run('载入工作空间',async()=>{
      try{await useStudio.getState().refreshProjects();const state=useStudio.getState();if(!state.session){const last=localStorage.getItem('studio-last-scene');const project=state.projects.find(p=>p.sceneId===last)??state.projects[0];if(project)await state.open(await request<CloudDraft>('/scenes/'+project.sceneId+'/draft'));else setDialog('projects');}}
      catch(error){if(error instanceof ApiError&&error.status===401)setAuthenticated(false);else throw error;}
    });
    const online=()=>{if(useStudio.getState().saveState==='offline')void useStudio.getState().save();};
    const expired=()=>setAuthenticated(false);
    window.addEventListener('online',online);window.addEventListener('studio-auth-expired',expired);
    return()=>{window.removeEventListener('online',online);window.removeEventListener('studio-auth-expired',expired);};
  },[authenticated]);
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(target.isContentEditable||['INPUT','SELECT','TEXTAREA'].includes(target.tagName)||dialog)return;
      const state=useStudio.getState();if(event.key==='Escape'){if(state.mode==='play'){void state.switchMode();return;}state.set({placingHotspot:false,pickEntity:null});return;}if(state.busy)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void state.save();return;}
      if(state.mode==='play'||state.workspace==='interface'||state.view?.isFlying)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)state.session?.redo();else state.session?.undo();}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();state.session?.redo();}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();state.command(duplicateEntities(state.selected));}
      else if(event.key.toLowerCase()==='f'){event.preventDefault();window.dispatchEvent(new Event('studio-frame-selection'));}
      else if(event.key==='Delete'){state.command(deleteEntities(state.selected));state.select([]);}
      else if(!event.ctrlKey&&!event.metaKey){const tools:Record<string,'select'|'translate'|'rotate'|'scale'>={q:'select',w:'translate',e:'rotate',r:'scale'};const tool=tools[event.key.toLowerCase()];if(tool)state.set({tool,editingPoint:null,pointPreview:null});}
    };
    window.addEventListener('keydown',keys);return()=>window.removeEventListener('keydown',keys);
  },[dialog]);
  const importProject=async(files:FileList|null)=>{
    if(!files?.length)return;const selected=files[0];
    await useStudio.getState().run('导入工程',async()=>{
      let draft:CloudDraft;
      if(selected.name.endsWith('.zip'))draft=await request('/projects/import',{method:'POST',body:selected,headers:{'Content-Type':'application/zip'}});
      else{const document=await runAssetTask<unknown>('json',new Uint8Array(await selected.arrayBuffer()));assertDocument(document);draft=await request('/projects',{method:'POST',body:JSON.stringify({name:document.name,document})});}
      await useStudio.getState().open(draft,true);await useStudio.getState().refreshProjects();
    });
    if(file.current)file.current.value='';
  };
  if(!authenticated)return <Login onLogin={()=>setAuthenticated(true)}/>;
  return <div className="studio-shell">
    <header className="app-header"><button className="brand" aria-label="打开工程管理" onClick={()=>{void useStudio.getState().refreshProjects();setDialog('projects');}}><span className="brand-symbol"><Box/></span><span>WebGL <strong>Studio</strong></span></button><span className="header-divider"/>
      <button className="project-title" onClick={()=>setDialog('projects')}><FolderOpen size={15}/><span>{document?.name??'选择工程'}</span></button>
      <details className="file-menu"><summary aria-label="工程菜单"><MoreHorizontal size={18}/></summary><nav onClick={event=>event.currentTarget.parentElement?.removeAttribute('open')}>
        <button onClick={()=>setDialog('projects')}>新建 / 打开 / 复制工程</button><button disabled={!document} onClick={()=>useStudio.getState().close()}>关闭工程</button>
        <button onClick={()=>file.current?.click()}><Upload/>导入工程包</button>
        <button disabled={!document} onClick={()=>void useStudio.getState().run('导出工程',async()=>{await useStudio.getState().save();if(useStudio.getState().saveState!=='saved')throw new Error('当前修改未成功保存，导出已取消');await download('/projects/'+useStudio.getState().projectId+'/export',(document?.name??'project')+'.studio.zip');})}>导出完整工程包</button>
        <button disabled={!document} onClick={()=>{if(document)window.open('/player/?scene='+document.sceneId,'_blank','noopener');}}>打开独立 Player</button>
        <button disabled={!document} onClick={()=>void useStudio.getState().run('取消发布',async()=>{await request('/scenes/'+document!.sceneId+'/publish',{method:'DELETE'});useStudio.getState().set({message:'已取消发布'});})}>取消发布</button>
        <button disabled={!document} onClick={()=>{if(document)saveBlob(new Blob([JSON.stringify(document,null,2)],{type:'application/json'}),document.name+'.scene.json');}}>导出场景文档</button>
        <button onClick={()=>{setLeftOpen(true);useStudio.getState().set({assetsOpen:false,inspectorOpen:true,workspace:'scene',layoutEpoch:layoutEpoch+1});}}><LayoutDashboard/>重置面板布局</button>
        <button onClick={()=>{useStudio.getState().close();clearAssetCache();sessionStorage.removeItem('studio-token');setAuthenticated(false);}}>退出登录</button>
      </nav></details>
      <input ref={file} type="file" accept=".zip,.json" hidden aria-label="导入工程文件" onChange={event=>void importProject(event.target.files)}/>
      <div className="header-spacer"/><div className="history-controls"><button className="icon-button" aria-label="撤销" title="撤销 Ctrl+Z" disabled={!session?.canUndo||mode==='play'} onClick={()=>session?.undo()}><Undo2/></button><button className="icon-button" aria-label="重做" title="重做 Ctrl+Shift+Z" disabled={!session?.canRedo||mode==='play'} onClick={()=>session?.redo()}><Redo2/></button></div>
      <button className={'preview-button '+(mode==='play'?'active':'')} disabled={!document||Boolean(busy)} onClick={()=>void useStudio.getState().run('切换预览',()=>useStudio.getState().switchMode())}>{mode==='play'?<Square size={14}/>:<Play size={14}/>}<span>{mode==='play'?'停止预览':'预览'}</span></button>
      <button className="save-button" disabled={!document||saveState==='saving'||Boolean(busy)} onClick={()=>void useStudio.getState().save()}><Save size={15}/><span>保存</span></button>
      <button className="icon-button" title="版本历史" aria-label="版本历史" disabled={!document} onClick={()=>setDialog('versions')}><History/></button>
      <button className="primary publish-button" disabled={!document||Boolean(busy)||mode==='play'} onClick={()=>void useStudio.getState().run('发布场景',async()=>{
        await useStudio.getState().save();if(useStudio.getState().saveState!=='saved')throw new Error('草稿尚未成功保存，请先处理保存状态');
        const result=await request<{versionId:string;playerUrl:string}>('/scenes/'+document!.sceneId+'/publish',{method:'POST',body:JSON.stringify({expectedRevision:useStudio.getState().revision})});setPublished(result.playerUrl);
      })}><CloudUpload size={16}/>发布</button>
    </header>
    {saveState==='conflict'&&<div className="conflict-bar"><span>保存冲突：本地修改已保留。</span><button onClick={()=>void useStudio.getState().run('另存工程',async()=>{const draft=await request<CloudDraft>('/projects',{method:'POST',body:JSON.stringify({name:document!.name+' 本地副本',document})});if(useStudio.getState().document!==document)throw new Error('副本已创建；另存期间工程又发生变化，当前本地事务已保留');const pending=await localDraft(document!.sceneId);if(pending)await resolveLocalDraft(pending.sceneId,pending.workspaceId,pending.committedAt);await useStudio.getState().open(draft,true);})}>另存为工程</button><button onClick={()=>void useStudio.getState().run('读取云端',async()=>{const draft=await request<CloudDraft>('/scenes/'+document!.sceneId+'/draft');await useStudio.getState().open(draft,true);})}>读取云端草稿</button></div>}
    <nav className="task-navigation" aria-label="创作任务">{tasks.map(([id,title,description])=><button key={id} title={description} disabled={mode==='play'} className={workspace===id?'active':''} onClick={()=>{useStudio.getState().set({workspace:id,placingHotspot:false,pickEntity:null,...(window.innerWidth<1024?{inspectorOpen:false}:{})});setLeftOpen(true);}}><span>{title}</span><small>{description}</small></button>)}<div className="header-spacer"/><button className={leftOpen?'active':''} disabled={workspace==='interface'} onClick={()=>{setLeftOpen(!leftOpen);if(window.innerWidth<1024)useStudio.getState().set({inspectorOpen:false});}}>{mode==='play'&&workspace==='interaction'?'调试面板':'任务面板'}</button><button className={assetsOpen?'active':''} onClick={()=>useStudio.getState().set({assetsOpen:!assetsOpen})}>资源库</button><button className={inspectorOpen?'active':''} disabled={workspace==='interface'} onClick={()=>{useStudio.getState().set({inspectorOpen:!inspectorOpen});if(window.innerWidth<1024)setLeftOpen(false);}}>属性</button></nav>
    <main className={'creation-workspace task-'+workspace+(mode==='play'?' is-preview':'')}>
      {workspace!=='interface'&&leftOpen&&mode==='edit'&&<aside className="task-sidebar">{workspace==='scene'?<SceneTree/>:workspace==='content'?<ContentPanel/>:workspace==='tour'?<TourPanel/>:<Interactions/>}</aside>}
      <div className="creation-main"><div className={'persistent-viewport '+(workspace==='interface'&&mode==='edit'?'behind-canvas':'')}><Viewport/></div>{workspace==='interface'&&mode==='edit'&&<InterfaceCanvas/>}{assetsOpen&&mode==='edit'&&<div className="resource-drawer"><Resources/></div>}</div>
      {workspace!=='interface'&&inspectorOpen&&mode==='edit'&&<aside className="properties-sidebar"><Inspector/></aside>}
      {mode==='play'&&workspace==='interaction'&&leftOpen&&<aside className="preview-debug"><Interactions/></aside>}
    </main>
    {busy&&<div className="operation-status" role="status">{busy}…</div>}
    <footer className="status-bar"><div><span className={'status-dot '+saveState}/><span>{!document?'未打开工程':({saved:'已保存到云端',dirty:'本地已提交 · 等待保存',saving:'正在保存…',offline:'云端保存失败 · 本地事务已保留',conflict:'版本冲突'}as const)[saveState]}</span><small>修订 {revision}</small></div><span>{busy|| (Object.keys(issues).length?Object.keys(issues).length+' 项资源加载问题':'SceneDocument · 毫米')}</span></footer>
    {message&&<aside className="notification" role="alert"><button className="icon-button" aria-label="关闭消息" onClick={()=>useStudio.getState().set({message:''})}><X/></button><strong>操作信息</strong><pre>{message}</pre>{saveState==='offline'&&<button onClick={()=>void useStudio.getState().save()}>重新保存</button>}</aside>}
    {Object.keys(issues).length>0&&<details className="runtime-issues"><summary>资源加载问题 · {Object.keys(issues).length}</summary>{Object.entries(issues).map(([id,error])=><p key={id}>{document?.entities.find(e=>e.id===id)?.name??id}：{error}</p>)}</details>}
    {dialog==='projects'&&<ProjectsDialog close={()=>setDialog(null)}/>} {dialog==='versions'&&<VersionsDialog close={()=>setDialog(null)}/>}<RecoveryDialog/>
    {published&&<div className="modal-backdrop"><section className="modal compact" role="dialog" aria-modal="true" aria-label="发布完成"><h2>场景已发布</h2><p>独立 Player 已就绪，公开访问已发布版本。</p><div className="button-group"><a className="button primary" href={published} target="_blank" rel="noreferrer">打开 Player</a><button onClick={()=>{void navigator.clipboard.writeText(location.origin+published);}}>复制地址</button><button onClick={()=>setPublished('')}>完成</button></div><button className="text-button danger" onClick={()=>void useStudio.getState().run('取消发布',async()=>{await request('/scenes/'+document!.sceneId+'/publish',{method:'DELETE'});setPublished('');})}>取消发布</button></section></div>}
  </div>;
}