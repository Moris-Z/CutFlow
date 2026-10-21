import {useEffect,useState} from 'react';
import {ExternalLink,Play,LoaderCircle} from 'lucide-react';
import {exampleEmbedUrl,examplePosterUrl,type SkillExample} from '../shared/skill-examples';
export function ExampleVideo({example}:{example:SkillExample}){
 const [loaded,setLoaded]=useState(false),[ready,setReady]=useState(false),[slow,setSlow]=useState(false),[posterFailed,setPosterFailed]=useState(false);
 const poster=examplePosterUrl(example);
 useEffect(()=>{setLoaded(false);setReady(false);setSlow(false);setPosterFailed(false);},[example.provider,example.videoId]);
 useEffect(()=>{if(!loaded||ready)return;const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[loaded,ready]);
 const cover=poster&&!posterFailed?<img src={poster} alt={`${example.brand} · ${example.title}`} loading="lazy" onError={()=>setPosterFailed(true)}/>:<div className="example-poster-fallback">{example.title}</div>;
 return <div className={`real-example-video example-provider-${example.provider||'youtube'}`}><a className="example-external" href={example.source} target="_blank" rel="noreferrer" aria-label="新窗口播放范例" title="新窗口播放"><ExternalLink size={14}/></a>{loaded?<><iframe title={`${example.brand} · ${example.title}`} src={exampleEmbedUrl(example)} onLoad={()=>setReady(true)} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>{!ready&&<div className="case-loading">{cover}<div>{slow?<><strong>视频暂未加载</strong><a href={example.source} target="_blank" rel="noreferrer">打开原视频观看<ExternalLink size={14}/></a></>:<><LoaderCircle className="spin" size={25}/><span>正在加载范例…</span></>}</div></div>}</>:<button onClick={()=>setLoaded(true)} aria-label={`播放 ${example.title}`}>{cover}<span><Play size={27} fill="currentColor"/></span></button>}</div>;
}
