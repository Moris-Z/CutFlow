import {useEffect,useRef,useState} from 'react';
import type {BgmPreference,MusicLibrary,MusicReference,MusicTrack} from '../shared/types';
import {api} from './api';
import {AudioLines,Search,Trash2,Upload,X} from 'lucide-react';
import {SelectControl} from './SelectControl';
const onlyThisAudio=(event:React.SyntheticEvent<HTMLAudioElement>)=>{document.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media=>{if(media!==event.currentTarget)media.pause();});};
export const defaultMusic:BgmPreference={mode:'default',gain:.5,start_ms:0,ducking:true};

export function MusicPicker({library,value=defaultMusic,onChange}:{library?:MusicLibrary;value?:BgmPreference;onChange:(v:BgmPreference)=>void}){
 const audio=useRef<HTMLAudioElement>(null);
 const track=library?.tracks.find(t=>t.id===(value.mode==='default'?library.default_bgm_id:value.track_id));
 return <section className="music-picker"><div className="music-heading"><strong>背景音乐</strong><span>循环铺满 · 自动淡入淡出</span></div>
  <SelectControl label="选择音乐" value={value.mode==='default'?'default':value.track_id||''} onChange={id=>onChange({...value,mode:id==='default'?'default':'track',track_id:id==='default'?undefined:id,start_ms:0})} options={[{value:'default',label:'使用平台默认',description:library?.tracks.find(t=>t.id===library.default_bgm_id)?.title||'加载中'},...(library?.tracks||[]).map(t=>({value:t.id,label:t.title,description:t.tags.join(' · ')}))]}/>

  {track&&<><p className="music-caption">{track.author} · {Math.floor(track.duration_ms/60000)}:{String(Math.floor(track.duration_ms/1000)%60).padStart(2,'0')} · {track.license}</p><audio ref={audio} key={track.id} controls onPlay={onlyThisAudio} preload="metadata" src={track.url} onLoadedMetadata={e=>{e.currentTarget.volume=value.gain;e.currentTarget.currentTime=value.start_ms/1000;}} aria-label={`试听 ${track.title}`}/></>}
  <div className="music-controls"><label>配乐音量 · {Math.round(value.gain*100)}%<input aria-label="配乐音量" type="range" min={5} max={100} step={5} value={value.gain*100} onChange={e=>{const gain=Number(e.target.value)/100;onChange({...value,gain});if(audio.current)audio.current.volume=gain;}}/></label><label>起播位置（秒）<input aria-label="配乐起播位置" type="number" min={0} step={.1} max={track?Math.floor((track.duration_ms-1)/100)/10:1200} value={value.start_ms/1000} onChange={e=>{const start_ms=Math.max(0,Math.round(Number(e.target.value)*1000));onChange({...value,start_ms});if(audio.current?.readyState)audio.current.currentTime=start_ms/1000;}}/></label></div>
  <label className="music-check"><input type="checkbox" checked={value.ducking} onChange={e=>onChange({...value,ducking:e.target.checked})}/>有原声时，自动降低配乐音量</label>
  <small>试听为音乐原轨；混音效果以视频预览为准。CC BY 曲目需将随片提供的署名放入发布说明。</small>
 </section>;
}

export function MusicLibraryPage({library,onRefresh,onDefault,onDelete,onTrash}:{library?:MusicLibrary;onRefresh:()=>Promise<void>;onDefault:(id:string)=>Promise<unknown>;onDelete:(track:MusicTrack)=>void;onTrash:()=>void}){
 const [reference,setReference]=useState<MusicReference>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 const [showUpload,setShowUpload]=useState(false),[notice,setNotice]=useState(''),[selectedFile,setSelectedFile]=useState<File>();
 const form=useRef<HTMLFormElement>(null);
 useEffect(()=>{setSelectedFile(undefined);},[reference]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),4500);return()=>window.clearTimeout(timer);},[notice]);
 useEffect(()=>{if(showUpload){form.current?.scrollIntoView({behavior:'smooth',block:'start'});form.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus({preventScroll:true});}},[showUpload,reference]);
 const tracks=library?.tracks.filter(t=>`${t.title} ${t.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))||[];
 function openUpload(){setShowUpload(true);setNotice('');if(showUpload)form.current?.scrollIntoView({behavior:'smooth',block:'start'});}
 async function upload(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');try{await api<MusicTrack>('/music',{method:'POST',body:new FormData(e.currentTarget)});form.current?.reset();setSelectedFile(undefined);setReference(undefined);await onRefresh();setShowUpload(false);setQuery('');setNotice('配乐已导入，可试听或设为默认。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="library-page music-page"><div className="page-heading"><div><h1>配乐库<span className="heading-count">{library?.tracks.length||0}</span></h1><p>试听音乐，为下一支视频找到合适的节奏。</p></div><div className="page-actions"><button type="button" className="button subtle" onClick={onTrash}><Trash2 size={15}/>最近删除</button><button type="button" className="button primary" disabled={busy} aria-expanded={showUpload} aria-controls="music-import" onClick={openUpload}><Upload size={16}/>导入配乐</button></div></div>
 <div className="music-library">
 {notice&&<p className="music-page-notice" role="status">{notice}</p>}
 <form id="music-import" hidden={!showUpload} ref={form} onSubmit={upload} className="music-upload" key={reference?.title||'upload'}>
  <div className="music-upload-heading"><h3>导入自己的配乐</h3><button type="button" className="icon-button" aria-label="收起配乐导入" disabled={busy} onClick={()=>setShowUpload(false)}><X size={17}/></button></div>
  <fieldset className="music-upload-fields" disabled={busy}>
   <label className={`music-file-zone ${selectedFile?'has-file':''}`}>
    <input required type="file" name="file" aria-label="选择音频文件" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={e=>setSelectedFile(e.target.files?.[0])}/>
    <span className="music-file-icon">{selectedFile?<AudioLines size={26}/>:<Upload size={26}/>}</span>
    <strong>{selectedFile?selectedFile.name:'点击选择音频文件'}</strong>
    <span className="music-file-detail">{selectedFile?`${(selectedFile.size/1024/1024).toFixed(1)} MB · 点击更换`:'MP3、WAV、M4A、AAC、OGG、FLAC'}</span>
    <small>最大 100 MB · 最长 20 分钟</small>
   </label>
   <div className="music-import-details">
    <label>音乐名称<input name="title" defaultValue={reference?.title||''} placeholder="留空使用文件名" maxLength={120}/></label>
    <label>作者<span className="music-field-optional">选填</span><input name="author" defaultValue={reference?.author||''} placeholder="填写作者名称" maxLength={120}/></label>
    <label className="music-import-source">来源链接<span className="music-field-optional">选填</span><input name="source_url" type="url" placeholder="粘贴音频来源链接"/></label>
   </div>
  </fieldset>
  {error&&<p className="music-upload-error" role="alert">{error}</p>}
  <div className="music-upload-footer"><button type="button" className="button subtle" disabled={busy} onClick={()=>setShowUpload(false)}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy?'正在导入…':'确认导入'}</button></div>
 </form>
 <div className="music-library-toolbar"><label><Search size={16}/><input aria-label="搜索配乐" placeholder="搜索名称、风格或品类" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>默认配乐：<strong>{library?.tracks.find(t=>t.id===library.default_bgm_id)?.title||'加载中'}</strong></span></div>
 <div className="music-grid">{tracks.map(t=><article className="music-card" key={t.id}><div className="music-heading"><span className="music-track-symbol"><AudioLines size={20}/></span><strong>{t.title}</strong>{library?.default_bgm_id===t.id&&<span className="badge green">默认</span>}</div><p>{t.tags.join(' · ')}</p><audio controls onPlay={onlyThisAudio} preload="metadata" src={t.url} aria-label={`试听 ${t.title}`}/><div className="music-actions"><button type="button" className="text-button small" disabled={busy||library?.default_bgm_id===t.id} onClick={async()=>{setBusy(true);try{await onDefault(t.id);}finally{setBusy(false);}}}>设为默认</button>{t.origin==='upload'&&<button type="button" className="icon-button danger-text" disabled={busy} aria-label={`删除配乐 ${t.title}`} title="删除配乐" onClick={()=>onDelete(t)}><Trash2 size={15}/></button>}</div></article>)}</div>
 {!tracks.length&&<div className="music-empty"><AudioLines size={26}/><p>{query?'没有找到这首音乐，试试其他关键词。':'还没有配乐，导入一首开始使用。'}</p>{query&&<button className="button" onClick={()=>setQuery('')}>查看全部配乐</button>}</div>}
 <details className="music-references"><summary>抖音热歌参考 · {library?.references.length||0} 首 · 导入授权音频后可用</summary><p>来自“抖音音乐”发布的 2026 年 8 月月榜，采集于 2026-10-04；不是实时排名。榜单热度不包含广告使用授权。</p><div className="music-reference-list">{library?.references.map(r=><div key={r.title}><span><strong>{r.title}</strong><small>{r.author} · <a href={r.source_url} target="_blank" rel="noreferrer">查看月榜</a></small></span><button type="button" className="button compact" onClick={()=>{setReference(r);setShowUpload(true);setNotice('');if(showUpload)form.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>导入授权音频</button></div>)}</div></details>
 </div></section>;
}

export function ProjectMusic({library,initial,busy,onSave}:{library?:MusicLibrary;initial?:BgmPreference;busy:boolean;onSave:(value:BgmPreference)=>void}){
 const [value,setValue]=useState(initial||defaultMusic);
 return <form className="settings-form" onSubmit={e=>{e.preventDefault();onSave(value);}}><MusicPicker library={library} value={value} onChange={setValue}/><p>修改配乐后，先试听前 8 秒，确认后再应用到全片。</p><button className="button primary" disabled={busy||!library?.tracks.length}>生成配乐修改方案</button></form>;
}
