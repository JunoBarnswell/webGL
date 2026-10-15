import { openDB } from 'idb';
import type { SceneDocument } from '@studio/scene-schema';
export interface JournalEntry { sceneId: string; revision: number; document: SceneDocument; label: string; committedAt: string; dirty: boolean }
const database=openDB('webgl-studio-v1',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'sceneId'});db.createObjectStore('transactions',{keyPath:'id',autoIncrement:true});}});
let sequence=Promise.resolve();
export function journal(entry: JournalEntry, transaction=true): Promise<void> {
  sequence=sequence.catch(()=>{}).then(async()=>{
    const db=await database;const tx=db.transaction(['drafts','transactions'],'readwrite');
    await tx.objectStore('drafts').put(entry);
    if(transaction) await tx.objectStore('transactions').add(entry);
    const count=await tx.objectStore('transactions').count();
    if(count>500) {const cursor=await tx.objectStore('transactions').openCursor();if(cursor) await cursor.delete();}
    await tx.done;
  });
  return sequence;
}
export async function localDraft(sceneId: string): Promise<JournalEntry|undefined> {return (await database).get('drafts',sceneId);}
