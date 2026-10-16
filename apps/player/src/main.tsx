import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShowroomEngine } from '@o2vr/engine';
import { assertDocument, type PublishedManifest } from '@studio/scene-schema';
import { SceneRuntime } from '@studio/scene-runtime';
import { PlayerUI } from '@studio/player-ui';
import './style.css';
function Player(){
  const host=useRef<HTMLDivElement>(null);const [runtime,setRuntime]=useState<SceneRuntime|null>(null),[manifest,setManifest]=useState<PublishedManifest|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();let engine:ShowroomEngine|undefined,instance:SceneRuntime|undefined;
    void(async()=>{const scene=new URLSearchParams(location.search).get('scene');if(!scene)throw new Error('缺少场景地址');const response=await fetch('/api/player/'+encodeURIComponent(scene)+'/manifest',{signal:abort.signal});if(!response.ok)throw new Error('展厅无法读取：HTTP '+response.status);const manifest=await response.json() as PublishedManifest;assertDocument(manifest.document);if(abort.signal.aborted)return;
      engine=new ShowroomEngine({container:host.current!});instance=new SceneRuntime(engine,{url:(id,path)=>'/api/player/'+scene+'/versions/'+manifest.versionId+'/assets/'+id+'/files/'+path.split('/').map(encodeURIComponent).join('/')});setManifest(manifest);setRuntime(instance);await instance.loadDocument(manifest.document,{signal:abort.signal});
    })().catch(error=>{if(!abort.signal.aborted)setError(String(error));});
    return()=>{abort.abort();instance?.dispose();engine?.dispose();};
  },[]);
  return <main className="standalone-player"><div ref={host} className="player-viewport"/>{runtime&&manifest&&<PlayerUI runtime={runtime} document={manifest.document}/>}<div className="player-system-status" role={error?'alert':'status'}>{error||(!manifest?'正在连接展厅…':'')}</div></main>;
}
createRoot(document.getElementById('root')!).render(<Player/>);
