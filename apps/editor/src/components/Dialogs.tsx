import { useEffect, useState } from 'react';
import { createDocument } from '@studio/scene-schema';
import { useStudio, newProject } from '../state/studio';
import { request, type CloudDraft, type Version } from '../state/api';
export function Login({onLogin}:{onLogin:()=>void}){
  const [username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <main className="login-page"><div className="login-brand"><span className="brand-symbol">W</span><span>WebGL Studio</span></div><form className="login-form" onSubmit={event=>{
    event.preventDefault();setBusy(true);setError('');void request<{token:string}>('/auth/login',{method:'POST',body:JSON.stringify({username,password})}).then(result=>{sessionStorage.setItem('studio-token',result.token);onLogin();}).catch(error=>setError(String(error.message))).finally(()=>setBusy(false));
  }}><span className="section-kicker">场景创作工作台</span><h1>登录工作空间</h1><p>搭建场景、配置交互，发布独立展厅。</p><label>管理员<input autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} required/></label><label>密码<input autoComplete="current-password" type="password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>{error&&<p role="alert" className="danger">{error}</p>}<button className="primary" disabled={busy}>{busy?'正在登录…':'进入工作台'}</button></form></main>;
}
export function ProjectsDialog({close}:{close:()=>void}){
  const projects=useStudio(s=>s.projects);const [name,setName]=useState('未命名工程');const busy=useStudio(s=>s.busy);
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="工程管理" className="modal"><div className="modal-header"><h2>工程工作空间</h2><button onClick={close}>关闭</button></div>
    <form className="new-project" onSubmit={event=>{event.preventDefault();void useStudio.getState().run('新建工程',async()=>{await newProject(name);close();});}}><input aria-label="新工程名称" value={name} onChange={event=>setName(event.target.value)} required/><button className="primary" disabled={Boolean(busy)}>新建工程</button></form>
    <div className="project-list">{projects.map(project=><article key={project.id}><div><h3>{project.name}</h3><p>修订 {project.revision} · {project.publishedVersionId?'已发布':'草稿'} · {new Date(project.updatedAt).toLocaleString('zh-CN')}</p></div><div className="button-group"><button disabled={Boolean(busy)} onClick={()=>void useStudio.getState().run('打开工程',async()=>{await useStudio.getState().open(await request<CloudDraft>('/scenes/'+project.sceneId+'/draft'));close();})}>打开</button><button disabled={Boolean(busy)} onClick={()=>void useStudio.getState().run('复制工程',async()=>{await useStudio.getState().open(await request<CloudDraft>('/projects/'+project.id+'/copy',{method:'POST'}));await useStudio.getState().refreshProjects();close();})}>复制</button><button className="text-button danger" disabled={Boolean(busy)} onClick={()=>{if(window.confirm('删除工程“'+project.name+'”及其全部版本？'))void useStudio.getState().run('删除工程',async()=>{await request('/projects/'+project.id,{method:'DELETE'});if(useStudio.getState().projectId===project.id){useStudio.getState().runtime?.unloadScene();useStudio.getState().set({session:null,document:null,projectId:''});}await useStudio.getState().refreshProjects();});}}>删除</button></div></article>)}
    {!projects.length&&<div className="empty-state">创建第一个工程，或导入已归档的展厅工程包。</div>}</div>
  </section></div>;
}
export function VersionsDialog({close}:{close:()=>void}){
  const document=useStudio(s=>s.document),revision=useStudio(s=>s.revision);const [versions,setVersions]=useState<Version[]>([]);const [_loaded,setLoaded]=useState(false);
  const load=async()=>{if(document){setVersions(await request('/scenes/'+document.sceneId+'/versions'));setLoaded(true);}};
  useEffect(()=>{void load().catch(error=>{useStudio.getState().set({message:String(error)});setLoaded(true);});},[document?.sceneId]);
  if(!document)return null;
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="版本历史"><div className="modal-header"><h2>版本历史</h2><button onClick={close}>关闭</button></div>
    <div className="panel-toolbar"><span>当前草稿修订 {revision}</span><button onClick={()=>void useStudio.getState().run('创建快照',async()=>{await useStudio.getState().save();if(useStudio.getState().saveState!=='saved')throw new Error('请先完成草稿保存');await request('/scenes/'+document.sceneId+'/versions',{method:'POST',body:JSON.stringify({expectedRevision:useStudio.getState().revision})});await load();})}>创建不可变快照</button></div>
    <div className="version-list">{versions.map(version=><article key={version.id}><div><strong>{version.published?'发布版本':'场景快照'}</strong><p>{new Date(version.createdAt).toLocaleString('zh-CN')}<br/>{version.id}</p></div><button onClick={()=>void useStudio.getState().run('恢复历史版本',async()=>{await useStudio.getState().save();if(useStudio.getState().saveState!=='saved')throw new Error('请先处理当前草稿保存状态');const restored=await request<CloudDraft>('/scenes/'+document.sceneId+'/versions/'+version.id+'/restore',{method:'POST',body:JSON.stringify({expectedRevision:useStudio.getState().revision})});await useStudio.getState().open(restored,true);close();})}>恢复为新草稿</button></article>)}
    {!versions.length&&<div className="empty-state">创建快照后可恢复到历史状态。已发布版本保持不变。</div>}</div>
  </section></div>;
}
export function RecoveryDialog(){
  const recovery=useStudio(s=>s.recovery);const revision=useStudio(s=>s.revision);if(!recovery)return null;
  const state=useStudio.getState();
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="恢复本地事务" className="modal compact"><h2>发现未同步的本地修改</h2><p>本地修订基线 {recovery.revision}，云端修订 {revision}。</p><p>{new Date(recovery.committedAt).toLocaleString('zh-CN')} · {recovery.label}</p><div className="button-group">
    <button onClick={()=>state.set({recovery:null})}>稍后处理</button>
    <button onClick={()=>void state.run('另存本地工程',async()=>{const draft=await request<CloudDraft>('/projects',{method:'POST',body:JSON.stringify({name:recovery.document.name+' 本地恢复',document:recovery.document??createDocument()})});await state.open(draft,true);state.set({recovery:null});})}>另存工程</button>
    <button className="primary" onClick={()=>{state.command({label:'恢复本地事务',mutate:doc=>Object.assign(doc,recovery.document)});state.set({recovery:null,saveState:recovery.revision===revision?'dirty':'conflict',message:recovery.revision===revision?'已恢复本地事务':'本地与云端已分歧，请另存工程或读取云端'});}}>恢复到工作台</button>
  </div></section></div>;
}
