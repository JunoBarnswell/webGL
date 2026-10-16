import { useConsoleLayout } from "../shell/layout";
import * as THREE from 'three';
import { useState } from 'react';
import { createContent, getComponent } from '@studio/scene-schema';
import { bindContent, contentForEntity } from '@studio/editor-core';
import { useStudio } from '../state/studio';
import { TextAreaField, TextField } from '../components/Fields';
import { ReferencePicker } from '../components/ReferencePicker';
import { AssetThumbnail } from '../components/AssetThumbnail';

export function ContentPanel(){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),active=useStudio(s=>s.activeContentId),mode=useStudio(s=>s.mode),placing=useStudio(s=>s.placingHotspot),[query,setQuery]=useState('');
  if(!document)return <div className="empty-state">打开工程后制作热点和作品内容</div>;
  const content=document.contents.find(c=>c.id===active)||contentForEntity(document,selected[0]);
  const update=(key:'title'|'body'|'imageAssetId'|'audioEntityId'|'layoutId',value:string)=>{if(content)useStudio.getState().command({label:'编辑作品内容',mutate:doc=>{const item=doc.contents.find(c=>c.id===content.id)!;item[key]=value;if(key==='title')item.name=value;}});};
  const bind=()=>{
    const state=useStudio.getState();if(!selected[0]){state.set({message:'先选择作品或对象，或使用“点击场景放置”'});return;}state.command(bindContent(selected[0],'Hotspot'));
    const object=state.runtime?.getObject(selected[0]);if(object){const box=new THREE.Box3().setFromObject(object),point=box.getCenter(new THREE.Vector3()).applyMatrix4(state.runtime!.getEntityFrame(selected[0]).invert());state.command({label:'定位热点标记',mutate:doc=>{const hotspot=doc.entities.find(e=>e.id===selected[0])?.components.find(c=>c.type==='Hotspot');if(hotspot)hotspot.data.offset=point.toArray();}});}
  };
  return <section className="task-panel content-task"><div className="task-heading"><span className="section-kicker">热点内容</span><h2>让场景讲述内容</h2><p>选择作品直接改资料，或在场景中放置热点。</p></div>
    <div className="task-actions"><button className={placing?'primary':''} disabled={mode==='play'} onClick={()=>useStudio.getState().set({placingHotspot:!placing,tool:'select'})}>{placing?'取消放置':'＋ 点击场景放置'}</button><button disabled={!selected.length||mode==='play'} onClick={bind}>绑定选中对象</button></div>
    {placing&&<p className="task-callout">点击模型表面放置热点；按 Esc 取消。</p>}
    <label className="search-field"><input type="search" aria-label="搜索热点内容" placeholder="搜索作品、热点…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="content-list">{document.contents.filter(c=>(c.title+' '+c.body).toLowerCase().includes(query.toLowerCase())).map(item=>{
      const asset=document.assets.find(a=>a.id===item.imageAssetId);const entity=document.entities.find(e=>e.components.some(c=>['Artwork','Hotspot'].includes(c.type)&&c.data.contentId===item.id));
      return <button key={item.id} className={'content-list-row '+(content?.id===item.id?'active':'')} onClick={()=>{if(entity)useStudio.getState().select([entity.id]);useStudio.getState().set({activeContentId:item.id});}}>{asset?<AssetThumbnail asset={asset}/>:<span className="content-symbol">◎</span>}<span><strong>{item.title||'未命名内容'}</strong><small>{entity?.name??'未绑定场景对象'}</small></span></button>;
    })}</div>
    {content?<fieldset disabled={mode==='play'} className="content-editor"><h3>编辑内容</h3><label className="field stacked"><span>标题</span><TextField label="内容标题" value={content.title} onChange={v=>update('title',v)}/></label><label className="field stacked"><span>介绍文案</span><TextAreaField label="介绍文案" value={content.body} onChange={v=>update('body',v)}/></label>
      <ReferencePicker kind="asset" assetKind="image" label="作品图片" value={content.imageAssetId} onChange={v=>update('imageAssetId',v)}/><ReferencePicker kind="entity" components={['Audio']} label="解说音频" value={content.audioEntityId} onChange={v=>update('audioEntityId',v)}/>
      <label className="field"><span>展示版式</span><select aria-label="内容展示版式" value={content.layoutId} onChange={e=>update('layoutId',e.target.value)}>{document.ui.layouts.filter(l=>l.scope==='content').map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <button className="wide-button" onClick={()=>{useStudio.getState().set({uiLayoutId:content.layoutId,activeContentId:content.id,uiSelected:[]});useConsoleLayout.getState().open('interface');}}>自由设计内容版式 →</button>
      {selected[0]&&getComponent(document.entities.find(e=>e.id===selected[0])!,'Hotspot')&&<details><summary>标记外观</summary>{['label','icon','color'].map(key=>{const hotspot=getComponent(document.entities.find(e=>e.id===selected[0])!,'Hotspot')!;return <label className="field" key={key}><span>{{label:'标记文字',icon:'图标字符',color:'颜色'}[key]}</span><TextField label={'热点 '+key} value={String(hotspot.data[key])} onChange={v=>useStudio.getState().command({label:'修改热点标记',mutate:doc=>{doc.entities.find(e=>e.id===selected[0])!.components.find(c=>c.type==='Hotspot')!.data[key]=v;}})}/></label>;})}</details>}
    </fieldset>:<div className="empty-state">选一幅作品，或放置第一个热点。</div>}
    <button className="text-button" disabled={mode==='play'} onClick={()=>{const item=createContent('新内容');useStudio.getState().command({label:'新建内容',mutate:doc=>{doc.contents.push(item);}});useStudio.getState().set({activeContentId:item.id});}}>＋ 新建独立内容</button>
  </section>;
}
