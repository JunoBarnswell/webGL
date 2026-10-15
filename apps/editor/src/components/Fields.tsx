import { useEffect, useId, useState } from 'react';
import { fieldDefaults, type FieldSchema, type JsonValue } from '@studio/scene-schema';
import { useStudio,type EditingPoint } from '../state/studio';
export function TextField({value,onChange,label,type='text',step,minimum,maximum}:{value:string|number;onChange:(value:string)=>void;label:string;type?:string;step?:number;minimum?:number;maximum?:number}){
  const [draft,setDraft]=useState(String(value));const id=useId();
  useEffect(()=>setDraft(String(value)),[value]);
  const commit=()=>{if(type==='number' && (!Number.isFinite(Number(draft)) || minimum!==undefined && Number(draft)<minimum || maximum!==undefined && Number(draft)>maximum)){setDraft(String(value));return;}if(draft!==String(value))onChange(draft);};
  return <input id={id} aria-label={label} type={type} value={draft} step={step??'any'} min={minimum} max={maximum} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){setDraft(String(value));event.currentTarget.blur();}}}/>;
}
function TextAreaField({value,label,onChange}:{value:string;label:string;onChange:(value:string)=>void}){
  const [draft,setDraft]=useState(value);useEffect(()=>setDraft(value),[value]);
  return <textarea aria-label={label} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={()=>{if(draft!==value)onChange(draft);}} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))event.currentTarget.blur();}}/>;
}
export function Field({field,value,onChange,path}:{field:FieldSchema;value:JsonValue;onChange:(value:JsonValue)=>void;path:string}){
  const document=useStudio(s=>s.document),selected=useStudio(s=>s.selected),editingPoint=useStudio(s=>s.editingPoint),pointPreview=useStudio(s=>s.pointPreview);const title=field.title??path;
  const match=/^(Cruise|Zone)\.(points|views)\.(\d+)\.(position|target)$/.exec(path);
  const point:EditingPoint|null=match&&selected[0]?{entityId:selected[0],type:match[1] as EditingPoint['type'],collection:match[2] as EditingPoint['collection'],index:Number(match[3]),property:match[4] as EditingPoint['property']}:path==='Panorama.position'&&selected[0]?{entityId:selected[0],type:'Panorama',collection:null,index:0,property:'position'}:null;
  if(pointPreview&&point&&JSON.stringify(point)===JSON.stringify(editingPoint))value=pointPreview;
  if(field['x-reference']){
    const options=field['x-reference']==='entity'?document?.entities:field['x-reference']==='material'?document?.materials:document?.assets;
    return <label className="field"><span>{title}</span><select aria-label={title} value={String(value??'')} onChange={event=>onChange(event.target.value)}><option value="">未指定</option>{options?.map(item=><option key={item.id} value={item.id}>{item.name||item.id}</option>)}</select></label>;
  }
  if(field.enum)return <label className="field"><span>{title}</span><select aria-label={title} value={String(value)} onChange={event=>onChange(event.target.value)}>{field.enum.map(option=><option key={option} value={option}>{option}</option>)}</select></label>;
  if(field.type==='boolean')return <label className="field check"><span>{title}</span><input type="checkbox" checked={Boolean(value)} onChange={event=>onChange(event.target.checked)}/></label>;
  if(field['x-editor']==='color')return <label className="field"><span>{title}</span><div className="color-input"><input type="color" aria-label={title} value={String(value)} onChange={event=>onChange(event.target.value)}/><TextField label={title+' 色值'} value={String(value)} onChange={onChange}/></div></label>;
  if(field.type==='number'||field.type==='integer')return <label className="field"><span>{title}</span><TextField label={title} type="number" minimum={field.minimum} maximum={field.maximum} step={field.type==='integer'?1:undefined} value={Number(value)} onChange={text=>onChange(Number(text))}/></label>;
  if(field.type==='array'){
    const items=Array.isArray(value)?value:[];const vector=field['x-editor']==='vector';
    return <div className={'array-field '+(vector?'vector-field':'')}><div className="field-title">{title}{point&&<button onClick={()=>useStudio.getState().set({editingPoint:point,pointPreview:null,tool:'translate'})}>视口编辑</button>}{!vector&&<button type="button" onClick={()=>onChange([...items,field.items?.properties?fieldDefaults(field.items.properties):field.items?.default??''])}>添加</button>}</div>
      <div className={vector?'vector-inputs':''}>{items.map((item,index)=><div key={index} className={vector?'axis':'array-item'}>
        {vector?<><span>{['X','Y','Z','W'][index]??index}</span><TextField label={title+' '+index} type="number" value={Number(item)} onChange={text=>onChange(items.map((current,i)=>i===index?Number(text):current))}/></>
        :<><div className="array-item-actions"><span>{index+1}</span><button aria-label={'上移 '+title+' '+index} disabled={index===0} onClick={()=>{const next=[...items];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next);}}>上移</button><button aria-label={'删除 '+title+' '+index} onClick={()=>onChange(items.filter((_v,i)=>i!==index))}>删除</button></div><Field field={field.items??{type:'string'}} value={item} path={path+'.'+index} onChange={next=>onChange(items.map((current,i)=>i===index?next:current))}/></>}
      </div>)}</div>
    </div>;
  }
  if(field.type==='object'||field.properties){
    const object=value&&!Array.isArray(value)&&typeof value==='object'?value:{};
    return <div className="object-fields">{Object.entries(field.properties??{}).map(([key,child])=><Field key={key} field={child} value={object[key]??null} path={path+'.'+key} onChange={next=>onChange({...object,[key]:next})}/>)}</div>;
  }
  if(field['x-editor']==='textarea')return <label className="field stacked"><span>{title}</span><TextAreaField label={title} value={String(value??'')} onChange={onChange}/></label>;
  return <label className="field"><span>{title}</span><TextField label={title} value={String(value??'')} onChange={onChange}/></label>;
}
export function Fields({fields,value,onChange,path}:{fields:Record<string,FieldSchema>;value:Record<string,JsonValue>;onChange:(key:string,value:JsonValue)=>void;path:string}){
  return <>{Object.entries(fields).map(([key,field])=><Field key={key} field={field} value={value[key]??null} path={path+'.'+key} onChange={next=>onChange(key,next)}/>)}</>;
}
