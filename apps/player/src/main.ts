import { ShowroomEngine } from '@o2vr/engine';
import { SceneRuntime } from '@studio/scene-runtime';
import { assertDocument, createAction, getComponent, type ActionType, type PublishedManifest } from '@studio/scene-schema';
import './style.css';

const root=document.getElementById('root')!;
root.innerHTML='<main class="player"><div class="stage"></div><header><strong>WebGL 展厅</strong><span class="title"></span></header><div class="loading" role="status">正在读取已发布场景…</div><nav aria-label="展厅控制"></nav><div class="message" role="alert" hidden></div><div class="info" hidden></div></main>';
const stage=root.querySelector<HTMLDivElement>('.stage')!,loading=root.querySelector<HTMLDivElement>('.loading')!,toolbar=root.querySelector<HTMLElement>('nav')!,message=root.querySelector<HTMLDivElement>('.message')!;
const scene=new URLSearchParams(location.search).get('scene');
let runtime:SceneRuntime|undefined,engine:ShowroomEngine|undefined;
function fail(error:unknown){message.hidden=false;message.textContent=error instanceof Error?error.message:String(error);}
function button(label:string,action:()=>void){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);toolbar.appendChild(button);return button;}
async function boot(){
  if(!scene)throw new Error('缺少场景地址，请使用发布后的 Player 链接');
  const response=await fetch('/api/player/'+encodeURIComponent(scene)+'/manifest');
  if(!response.ok)throw new Error(response.status===404?'场景尚未发布或已取消发布':'展厅读取失败: HTTP '+response.status);
  const manifest=await response.json() as PublishedManifest;assertDocument(manifest.document);
  root.querySelector('.title')!.textContent=manifest.document.name;document.title=manifest.document.name+' · WebGL Player';
  engine=new ShowroomEngine({container:stage});
  runtime=new SceneRuntime(engine,{url:(id,path)=>'/api/player/'+encodeURIComponent(scene)+'/versions/'+manifest.versionId+'/assets/'+id+'/files/'+path.split('/').map(encodeURIComponent).join('/')},{
    onIssue:(_id,error)=>fail(error),
    onInfo:info=>{
      const overlay=root.querySelector<HTMLDivElement>('.info')!;overlay.replaceChildren();overlay.hidden=false;
      const article=document.createElement('article'),close=document.createElement('button'),title=document.createElement('h2'),content=document.createElement('p');
      close.textContent='关闭';close.addEventListener('click',()=>{overlay.hidden=true;});title.textContent=info.title;content.textContent=info.content;
      article.append(close);if(info.imageUrl){const image=new Image();image.src=info.imageUrl;image.alt=info.title;article.append(image);}article.append(title,content);overlay.append(article);
    }
  });
  await runtime.loadDocument(manifest.document);
  if(runtime.issues.size)throw new Error('展厅资源未能完整加载：'+[...runtime.issues.values()].join('；'));
  toolbar.hidden=true;
  loading.textContent='展厅已就绪';const enter=document.createElement('button');enter.textContent='进入展厅';enter.className='enter';loading.appendChild(enter);
  enter.addEventListener('click',()=>{loading.hidden=true;toolbar.hidden=false;void runtime!.setMode('play').catch(fail);});
  const perform=(type:ActionType,targetId='',data?:Record<string,import('@studio/scene-schema').JsonValue>)=>{const action=createAction(type);action.targetId=targetId;if(data)Object.assign(action.data,data);void runtime!.executeAction(action).catch(fail);};
  button('第一 / 第三人称',()=>perform('ViewMode','',{mode:runtime!.navigation.viewMode==='first'?'third':'first'}));
  button('实体 / X-Ray',()=>perform('DisplayMode','',{mode:runtime!.displayMode==='solid'?'xray':'solid'}));
  let playing=false;
  for(const entity of manifest.document.entities){
    const zone=getComponent(entity,'Zone');
    if(zone){const select=document.createElement('select');select.setAttribute('aria-label','展区视点');const empty=document.createElement('option');empty.textContent='选择展区';empty.value='';select.append(empty);for(const view of zone.data.views as {id:string;name:string}[]){const option=document.createElement('option');option.value=view.id;option.textContent=view.name;select.appendChild(option);}select.addEventListener('change',()=>perform('FlyTo',entity.id,{viewId:select.value}));toolbar.appendChild(select);}
    if(getComponent(entity,'Cruise'))button('巡航 / 暂停',()=>{playing=!playing;perform(playing?'StartCruise':'PauseCruise',entity.id);});
    const animation=getComponent(entity,'Animation');
    if(animation){
      button(entity.name+' · 动画',()=>{const model=runtime!.objects.get(String(animation.data.modelEntityId));if(model?.mixer?.timeScale===0)perform('PlayAnimation',entity.id,{clip:String(animation.data.clip),loop:animation.data.loop});else if(model?.clips.some(clip=>model.mixer?.existingAction(clip)?.isRunning()))perform('PauseAnimation',entity.id);else perform('PlayAnimation',entity.id,{clip:String(animation.data.clip),loop:animation.data.loop});});
    }
    const audio=getComponent(entity,'Audio');
    if(audio){
      const name=manifest.document.assets.find(asset=>asset.id===audio.data.assetId)?.name??entity.name;
      const control=button('播放 '+name,()=>{const element=runtime!.objects.get(entity.id)?.audio;if(element&&!element.paused)perform('StopAudio',entity.id);else void runtime!.playAudio(entity.id).catch(fail);});
      const element=runtime.objects.get(entity.id)?.audio;
      const update=()=>{control.textContent=(element&&!element.paused?'停止 ':'播放 ')+name;};
      for(const event of ['play','pause','ended'])element?.addEventListener(event,update);
      update();
    }
    if(getComponent(entity,'Panorama'))button('导出全景',()=>void runtime!.snapshot(entity.id).then(blob=>{const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='panorama.png';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(fail));
  }

  const help=document.createElement('p');help.className='help';help.textContent='点击场景后 WASD 移动 · Shift 加速 · 拖动观察 · 滚轮调整视角';root.querySelector('.player')!.append(help);
  const touch=document.createElement('div');touch.className='touch-controls';touch.setAttribute('aria-label','移动控制');
  for(const [label,code]of [['前进','KeyW'],['左移','KeyA'],['后退','KeyS'],['右移','KeyD']]){
    const control=document.createElement('button');control.textContent=label;
    control.addEventListener('pointerdown',event=>{control.setPointerCapture(event.pointerId);engine!.renderer.domElement.focus();engine!.renderer.domElement.dispatchEvent(new KeyboardEvent('keydown',{code}));});
    for(const name of ['pointerup','pointercancel'])control.addEventListener(name,()=>engine!.renderer.domElement.dispatchEvent(new KeyboardEvent('keyup',{code})));
    touch.appendChild(control);
  }root.querySelector('.player')!.append(touch);
}
void boot().catch(error=>{loading.textContent='无法进入展厅';fail(error);});
window.addEventListener('pagehide',()=>{runtime?.dispose();engine?.dispose();},{once:true});
