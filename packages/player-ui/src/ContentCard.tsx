import type { RefObject } from 'react';
import type { SceneDocument, UiBreakpoint, UiLayout } from '@studio/scene-schema';
import type { SceneRuntime } from '@studio/scene-runtime';
import { UiLayoutView } from './UiLayoutView';

export function ContentCard({document:doc,runtime,layout,contentId,breakpoint,design=false,dialogRef,onClose,onError}:{document:SceneDocument;runtime:SceneRuntime|null;layout:UiLayout;contentId:string;breakpoint:UiBreakpoint;design?:boolean;dialogRef?:RefObject<HTMLDivElement|null>;onClose?:()=>void;onError:(error:unknown)=>void}){
  const content=doc.contents.find(c=>c.id===contentId);
  return <div ref={dialogRef} className={'player-content-dialog'+(design?' player-design-content':'')} role={design?undefined:'dialog'} aria-modal={design?undefined:true} aria-label={content?.title} tabIndex={design?undefined:-1} style={{width:layout.width,minHeight:Math.min(layout.height,500)}}>
    <button className="player-close" aria-label="关闭内容" disabled={design} onClick={onClose}>关闭 ✕</button>
    <div className="player-content-surface" style={{minHeight:layout.height}}><UiLayoutView document={doc} runtime={runtime} layoutId={layout.id} contentId={contentId} breakpoint={breakpoint} design={design} onError={onError}/></div>
  </div>;
}
