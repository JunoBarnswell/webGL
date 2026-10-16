import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createAction, type SceneDocument, type UiBreakpoint } from '@studio/scene-schema';
import type { SceneRuntime } from '@studio/scene-runtime';
import { ContentCard } from './ContentCard';
import { UiLayoutView } from './UiLayoutView';
import { useRuntime } from './useRuntime';
import './style.css';

export function PlayerUI({document:doc,runtime}:{document:SceneDocument;runtime:SceneRuntime}){
  const state=useRuntime(runtime),host=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDivElement>(null);
  const [breakpoint,setBreakpoint]=useState<UiBreakpoint>('desktop'),[error,setError]=useState('');
  const onError=(error:unknown)=>setError(error instanceof Error?error.message:String(error));
  const content=doc.contents.find(c=>c.id===state.contentId),layout=content&&doc.ui.layouts.find(l=>l.id===content.layoutId);
  const close=()=>{const action=createAction('CloseContent');void runtime.dispatch(action).catch(onError);};
  useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setBreakpoint(entry.contentRect.width<768?'mobile':entry.contentRect.width<1024?'tablet':'desktop'));observer.observe(host.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!state.contentId)return;const previously=document.activeElement as HTMLElement|null;dialog.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();close();}if(event.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]');if(!items?.length){event.preventDefault();return;}const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};const target=dialog.current;target?.addEventListener('keydown',key);return()=>{target?.removeEventListener('keydown',key);previously?.focus();};},[state.contentId,runtime]);
  const theme={'--player-accent':doc.ui.theme.accent,'--player-background':doc.ui.theme.background,'--player-text':doc.ui.theme.text,fontFamily:doc.ui.theme.fontFamily} as CSSProperties;
  const scope=state.load.phase==='ready'?state.entered?'hud':'entry':'loading';
  return <div ref={host} className="player-ui" style={theme} data-breakpoint={breakpoint}>
    {doc.ui.layouts.filter(l=>l.id===doc.ui.layouts.find(candidate=>candidate.scope===scope)?.id).map(l=><UiLayoutView key={l.id} document={doc} runtime={runtime} layoutId={l.id} breakpoint={breakpoint} onError={onError}/>)}
    {layout&&content&&<div className={'player-content-backdrop player-presentation-'+layout.presentation} onPointerDown={event=>{if(event.target===event.currentTarget)close();}}><ContentCard document={doc} runtime={runtime} layout={layout} contentId={content.id} breakpoint={breakpoint} dialogRef={dialog} onClose={close} onError={onError}/></div>}
    {(error||Object.keys(state.errors).length>0||state.load.phase==='error'||state.load.phase==='cancelled')&&<div className="player-error" role="alert"><strong>{error||state.load.message||'运行问题'}</strong>{Object.values(state.errors).slice(0,4).map((message,i)=><p key={i}>{message}</p>)}{error&&<button onClick={()=>setError('')}>关闭提示</button>}</div>}
  </div>;
}
