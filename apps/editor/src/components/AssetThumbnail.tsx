import { useEffect, useRef, useState } from 'react';
import { Box, Image as ImageIcon, Music2, FileBox } from 'lucide-react';
import type { SceneAsset } from '@studio/scene-schema';
import { authHeaders } from '../state/api';

export function AssetThumbnail({asset}:{asset:SceneAsset}){
  const host=useRef<HTMLSpanElement>(null);const [visible,setVisible]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'80px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    if(!visible||!asset.preview)return;const abort=new AbortController();let objectUrl='';
    void fetch('/api/assets/'+asset.id+'/files/'+asset.preview.file,{headers:authHeaders(),signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('缩略图 HTTP '+response.status);objectUrl=URL.createObjectURL(await response.blob());setUrl(objectUrl);}).catch(error=>{if(!abort.signal.aborted)setError(String(error));});
    return()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[asset.id,asset.preview?.file,visible]);
  return <span className="asset-thumbnail" ref={host} title={error||asset.name}>{url?<img src={url} alt=""/>:asset.kind==='model'?<Box/>:asset.kind==='audio'?<Music2/>:['image','texture'].includes(asset.kind)?<ImageIcon/>:<FileBox/>}{error&&<small>缩略图读取失败</small>}</span>;
}
