import { createAction, createBehavior, createComponent, createContent, createEntity, type SceneAsset, type SceneDocument, type Vec3 } from '@studio/scene-schema';
import type { EditorCommand } from './EditorSession';

export function contentForEntity(document:SceneDocument,id:string){const entity=document.entities.find(e=>e.id===id);const component=entity?.components.find(c=>c.type==='Artwork'||c.type==='Hotspot');return document.contents.find(c=>c.id===component?.data.contentId);}
export function bindContent(entityId:string,kind:'Artwork'|'Hotspot',image?:SceneAsset):EditorCommand{
  return {label:kind==='Hotspot'?'绑定介绍热点':'绑定作品内容',mutate:doc=>{
    const entity=doc.entities.find(e=>e.id===entityId);if(!entity)throw new Error('请先选择场景中的对象');
    let content=contentForEntity(doc,entityId);if(!content){content=createContent(entity.name);doc.contents.push(content);}
    if(image){if(!doc.assets.some(a=>a.id===image.id))doc.assets.push(image);content.imageAssetId=image.id;}
    let component=entity.components.find(c=>c.type===kind);if(!component){component=createComponent(kind);entity.components.push(component);}component.data.contentId=content.id;
    if(!doc.behaviors.some(b=>b.sourceKind==='entity'&&b.sourceId===entityId&&b.event==='click')){const behavior=createBehavior('点击查看 '+content.title);behavior.sourceId=entityId;const action=createAction('OpenContent');action.targetId=content.id;behavior.actions=[action];doc.behaviors.push(behavior);}
  }};
}
export function addHotspot(position:Vec3){
  const entity=createEntity('介绍热点'),content=createContent('新热点'),hotspot=createComponent('Hotspot'),rule=createBehavior('点击打开热点');entity.transform.position=position;hotspot.data.contentId=content.id;hotspot.data.label='';entity.components.push(hotspot);rule.sourceId=entity.id;const action=createAction('OpenContent');action.targetId=content.id;rule.actions=[action];
  const command:EditorCommand={label:'放置热点',mutate:doc=>{doc.entities.push(entity);doc.contents.push(content);doc.behaviors.push(rule);}};return {entity,content,command};
}
