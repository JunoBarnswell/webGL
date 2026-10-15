import { create } from 'zustand';
import { createDocument, type SceneDocument, type Transform, type Vec3 } from '@studio/scene-schema';
import { EditorSession, type EditorCommand } from '@studio/editor-core';
import type { SceneRuntime, RuntimeInfo } from '@studio/scene-runtime';
import { ApiError, request, type CloudDraft, type Project } from './api';
import { journal, localDraft, type JournalEntry } from './journal';

export interface EditingPoint {entityId:string;type:'Cruise'|'Zone'|'Panorama';collection:'points'|'views'|null;index:number;property:'position'|'target'}
type SaveState='saved'|'dirty'|'saving'|'offline'|'conflict';
interface StudioState {
  session: EditorSession|null; document: SceneDocument|null; runtime: SceneRuntime|null; projectId: string; revision: number;
  selected: string[]; editingPoint:EditingPoint|null; pointPreview:Vec3|null; transforms:Record<string,Transform>; tool:'select'|'translate'|'rotate'|'scale'; space:'world'|'local'; snap:boolean; mode:'edit'|'play';
  saveState:SaveState; message:string; issues:Record<string,string>; info:RuntimeInfo|null; busy:string;
  projects:Project[]; recovery:JournalEntry|null; layoutEpoch:number;
  set:(patch:Partial<StudioState>)=>void; command:(command:EditorCommand)=>void; select:(ids:string[],add?:boolean)=>void;
  open:(draft:CloudDraft,restore?:boolean)=>Promise<void>; close:()=>void; save:()=>Promise<void>; refreshProjects:()=>Promise<void>;
  switchMode:()=>Promise<void>; run:(label:string,action:()=>Promise<void>)=>Promise<void>;
}
let unsubscribe:(()=>void)|undefined;
let saveTimer:ReturnType<typeof setTimeout>|undefined;
let saveQueue=Promise.resolve();
let sessionGeneration=0;
export const useStudio=create<StudioState>((set,get)=>({
  session:null,document:null,runtime:null,projectId:'',revision:0,selected:[],editingPoint:null,pointPreview:null,transforms:{},tool:'translate',space:'world',snap:false,mode:'edit',
  saveState:'saved',message:'',issues:{},info:null,busy:'',projects:[],recovery:null,layoutEpoch:0,
  set,
  command(command) {
    const state=get();if(state.mode==='play') return;
    try{state.session?.execute(command);}catch(error){set({message:error instanceof Error?error.message:String(error)});}
  },
  select(ids,add=false){set({editingPoint:null,pointPreview:null,selected:add?[...new Set([...get().selected,...ids])]:ids});},
  close(){
    clearTimeout(saveTimer);unsubscribe?.();unsubscribe=undefined;sessionGeneration++;
    get().runtime?.unloadScene();
    set({session:null,document:null,projectId:'',revision:0,selected:[],editingPoint:null,pointPreview:null,transforms:{},mode:'edit',saveState:'saved',issues:{},info:null,recovery:null,message:''});
  },
  async open(draft,restore=false){
    clearTimeout(saveTimer);unsubscribe?.();sessionGeneration++;
    const session=new EditorSession(draft.document);
    set({session,document:session.document,projectId:draft.projectId,revision:draft.revision,selected:[],editingPoint:null,pointPreview:null,transforms:{},saveState:'saved',message:'',issues:{},recovery:null,mode:'edit'});
    unsubscribe=session.subscribe((change,label)=>{
      set({document:change.after,saveState:get().saveState==='conflict'?'conflict':'dirty'});
      void get().runtime?.applyChangeSet(change);
      void journal({sceneId:draft.sceneId,revision:get().revision,document:change.after,label,committedAt:new Date().toISOString(),dirty:true}).catch(error=>set({message:'本地恢复记录失败: '+String(error)}));
      clearTimeout(saveTimer);saveTimer=setTimeout(()=>void get().save(),1200);
    });
    await get().runtime?.setMode('edit');
    await get().runtime?.loadDocument(session.document);
    const local=await localDraft(draft.sceneId);
    if(local?.dirty && JSON.stringify(local.document)!==JSON.stringify(draft.document) && !restore) set({recovery:local,message:'发现未同步的本地事务，可恢复或另存工程'});
    if(restore) await journal({sceneId:draft.sceneId,revision:draft.revision,document:draft.document,label:'读取云端草稿',committedAt:new Date().toISOString(),dirty:false},false);
    localStorage.setItem('studio-last-scene',draft.sceneId);
  },
  async save(){
    const generation=sessionGeneration;
    const perform=async()=>{
      const state=get();
      if(!state.document || !state.session || state.saveState==='conflict' || generation!==sessionGeneration || state.saveState==='saved') return;
      const snapshot=state.document;const revision=state.revision;set({saveState:'saving'});
      try{
        const saved=await request<CloudDraft>('/scenes/'+snapshot.sceneId+'/draft',{method:'PUT',body:JSON.stringify({expectedRevision:revision,document:snapshot})});
        if(generation!==sessionGeneration) return;
        set({revision:saved.revision,saveState:get().document===snapshot?'saved':'dirty',message:''});
        await journal({sceneId:snapshot.sceneId,revision:saved.revision,document:get().document!,label:'云端保存',committedAt:new Date().toISOString(),dirty:get().document!==snapshot},false);
        if(get().saveState==='dirty') {clearTimeout(saveTimer);saveTimer=setTimeout(()=>void get().save(),100);}
      }catch(error){
        if(generation!==sessionGeneration) return;
        set({saveState:error instanceof ApiError && error.status===409?'conflict':'offline',message:error instanceof Error?error.message:String(error)});
      }
    };
    saveQueue=saveQueue.catch(()=>{}).then(perform);await saveQueue;
  },
  async refreshProjects(){set({projects:await request<Project[]>('/projects')});},
  async switchMode(){
    const state=get();if(!state.runtime) return;
    const mode=state.mode==='edit'?'play':'edit';set({mode,info:null,editingPoint:null,pointPreview:null});
    await state.runtime.setMode(mode);
  },
  async run(label,action){
    if(get().busy) return;
    set({busy:label,message:''});
    try{await action();}catch(error){set({message:error instanceof ApiError?[error.message,...error.details].join('\n'):error instanceof Error?error.message:String(error)});}
    finally{set({busy:''});}
  }
}));
export async function newProject(name:string):Promise<void>{
  const document=createDocument(name);
  const draft=await request<CloudDraft>('/projects',{method:'POST',body:JSON.stringify({name,document})});
  await useStudio.getState().open(draft);await useStudio.getState().refreshProjects();
}
