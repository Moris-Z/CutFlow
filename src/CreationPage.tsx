import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronDown,Film,FolderOpen,Globe2,LoaderCircle,Search,SlidersHorizontal,Sparkles,Upload,X} from 'lucide-react';
import type {Asset,Brief,MusicLibrary,Settings} from '../shared/types';
import {getSkill,skillName,type SkillId} from '../shared/skills';
import {ContextPanel} from './ContextPanel';
import {SkillOptions,hasSkillOptions} from './SkillOptions';
import {SkillBrowser} from './SkillsPage';
import type {CreationDraft} from './creation';
import {SelectControl} from './SelectControl';
import {MusicPicker} from './MusicPicker';

export function CreationPage({draft,onChange,assets,library,settings,busy,onUpload,onSkill,onSubmit}:{draft:CreationDraft;onChange:(draft:CreationDraft)=>void;assets:Asset[];library?:MusicLibrary;settings?:Settings;busy:string;onUpload:()=>void;onSkill:(id:SkillId)=>void;onSubmit:()=>void}) {
 const skillOptionsButton=useRef<HTMLButtonElement>(null),skillButton=useRef<HTMLButtonElement>(null),settingsButton=useRef<HTMLButtonElement>(null),libraryButton=useRef<HTMLButtonElement>(null);
 const [showSkills,setShowSkills]=useState(false),[showSkillOptions,setShowSkillOptions]=useState(false);
 const [showLibrary,setShowLibrary]=useState(false),[showSettings,setShowSettings]=useState(false),[query,setQuery]=useState(''),[previewId,setPreviewId]=useState<string>();
 useEffect(()=>{setShowSkillOptions(hasSkillOptions(draft.brief.skill_id)&&!draft.brief.skill_options);},[draft.brief.skill_id]);
 const input=useRef<HTMLTextAreaElement>(null);
 const selected=assets.filter(a=>draft.assetIds.includes(a.id)),preview=assets.find(a=>a.id===previewId);
 const working=!!busy;
 const update=<K extends keyof Brief>(key:K,value:Brief[K])=>onChange({...draft,brief:{...draft.brief,[key]:value}});
 const ready=!!draft.brief.request.trim()&&draft.brief.request.length<=8000&&selected.length===draft.assetIds.length&&draft.brief.duration_ms>=2000&&draft.brief.duration_ms<=180000;
 const toggle=(id:string)=>onChange({...draft,assetIds:draft.assetIds.includes(id)?draft.assetIds.filter(a=>a!==id):[...draft.assetIds,id].slice(0,12)});
 return <section className="compose-page">
  <header className="compose-heading"><span className="eyebrow">CUTFLOW</span><h1>和 Agent 一起，把想法剪成作品</h1></header>
  <div className="compose-card">
   <aside className="compose-sources" aria-label="创作素材">
    <div className="compose-source-title"><strong>素材</strong><span>{selected.length?`${selected.length}/12`:'选填'}</span></div>
    {selected.length?<div className="compose-selected">{selected.map(a=><article key={a.id}><button type="button" aria-label={`预览 ${a.name}`} onClick={()=>setPreviewId(a.id)}><img src={a.thumbnail_url} alt=""/><span>{a.name}</span></button><button type="button" className="compose-remove" disabled={working} aria-label={`取消选择 ${a.name}`} onClick={()=>toggle(a.id)}><X size={12}/></button></article>)}</div>:<button className="compose-upload-zone" type="button" disabled={working} onClick={onUpload}><span><Upload size={30}/></span><strong>上传素材</strong><small>选择你的原始视频</small></button>}
    <div className="compose-source-actions">{selected.length>0&&<button className="text-button" type="button" disabled={working} onClick={onUpload}><Upload size={14}/>继续上传</button>}<button className="text-button" type="button" ref={libraryButton} disabled={working} aria-haspopup="dialog" aria-expanded={showLibrary} onClick={()=>setShowLibrary(!showLibrary)}><FolderOpen size={15}/>从素材库选择</button></div>
    <p className="compose-source-note"><Globe2 size={15}/><span>不选素材也可以，Agent 会根据右侧需求联网查找。</span></p>
   </aside>
   <form className="compose-prompt" onSubmit={e=>{e.preventDefault();if(ready&&!working)onSubmit();}}>
    <div className="compose-prompt-label"><Sparkles size={17}/><span>告诉 Agent，你想做什么</span></div>
    {draft.brief.skill_id&&draft.brief.skill_id!=='auto'&&<div className="compose-skill-chip"><>{hasSkillOptions(draft.brief.skill_id)?<button ref={skillOptionsButton} className="compose-skill-options" type="button" disabled={working} aria-label={`设置${skillName(draft.brief.skill_id)}`} aria-haspopup="dialog" aria-expanded={showSkillOptions} onClick={()=>setShowSkillOptions(true)}><code><Sparkles size={14}/>{skillName(draft.brief.skill_id)}</code><ChevronDown size={12}/></button>:<code><Sparkles size={14}/>{skillName(draft.brief.skill_id)}</code>}</><button type="button" disabled={working} aria-label="移除已选技能" onClick={()=>onSkill('auto')}><X size={13}/></button></div>}
    <textarea ref={input} aria-label="给剪辑 Agent 的创作需求" placeholder="例如：帮我做一支 20 秒的咖啡广告，找些咖啡制作和品尝的素材，画面温暖、节奏舒缓。" value={draft.brief.request} maxLength={8000} onChange={e=>update('request',e.target.value)} disabled={working}/>
    <div className="compose-controls"><button ref={skillButton} type="button" className="compose-options skill-panel-trigger" onClick={()=>setShowSkills(true)} aria-haspopup="dialog" aria-expanded={showSkills} disabled={working}><Sparkles size={16}/>技能<ChevronDown size={14}/></button><button ref={settingsButton} type="button" className="compose-options" aria-haspopup="dialog" aria-expanded={showSettings} onClick={()=>setShowSettings(true)} disabled={working}><SlidersHorizontal size={15}/>视频设置<ChevronDown size={14}/></button><button className="compose-send" type="submit" disabled={working||!ready} aria-label={selected.length?'开始创作':'联网找素材并创作'}>{working?<LoaderCircle size={23} className="spin"/>:<ArrowUp size={23}/>}</button></div>
   </form>
  </div>
  <div className="compose-status"><span>{draft.brief.platform} · {draft.brief.duration_ms/1000} 秒 · {draft.brief.aspect_ratio} · {draft.brief.subtitles?'有字幕':'无字幕'}</span><span>{settings?.confirm_text_plan===false?'生成后预览，可继续对话修改':'先确认文字方案，再生成视频'}</span></div>
  {draft.brief.request.length>8000&&<p className="compose-error" role="alert">需求超过 8000 字，请精简后发送。</p>}
  {(draft.brief.duration_ms<2000||draft.brief.duration_ms>180000)&&<p className="compose-error" role="alert">请在视频设置中填写 2–180 秒的时长。</p>}

  {preview&&<div className="compose-source-player"><div><strong>{preview.name}</strong><button className="icon-button" aria-label="关闭素材预览" onClick={()=>setPreviewId(undefined)}><X size={16}/></button></div><video src={preview.url} poster={preview.thumbnail_url} controls playsInline/>{preview.source&&<a href={preview.source.url} target="_blank" rel="noreferrer">素材来源 · {preview.source.provider}</a>}</div>}
  {showSkills&&<ContextPanel title="选择技能" anchor={skillButton} columns wide onClose={()=>setShowSkills(false)}><SkillBrowser selectedId={draft.brief.skill_id} onUse={id=>{if(!getSkill(id)?.unavailable){onSkill(id);setShowSkills(false);if(hasSkillOptions(id))setShowSkillOptions(true);}}}/></ContextPanel>}
  {showLibrary&&<ContextPanel title="选择素材" anchor={libraryButton} wide onClose={()=>setShowLibrary(false)}><section className="compose-library"><div className="compose-section-heading"><span>最多选择 12 份视频</span><button type="button" className="text-button" onClick={()=>setShowLibrary(false)}>完成选择</button></div><label className="creation-search"><Search size={15}/><input aria-label="搜索创作素材" placeholder="搜索素材" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="compose-library-grid">{assets.filter(a=>a.id!==draft.brief.skill_options?.reference_asset_id&&a.name.toLowerCase().includes(query.toLowerCase())).map(a=><label key={a.id} className={draft.assetIds.includes(a.id)?'selected':''}><img src={a.thumbnail_url} alt="" loading="lazy"/><span><input type="checkbox" aria-label={`选择素材 ${a.name}`} checked={draft.assetIds.includes(a.id)} disabled={working||(!draft.assetIds.includes(a.id)&&draft.assetIds.length>=12)} onChange={()=>toggle(a.id)}/>{a.name}</span></label>)}</div>{!assets.length&&<p className="creation-empty">素材库还是空的，可以先上传视频。</p>}</section></ContextPanel>}
  {showSkillOptions&&hasSkillOptions(draft.brief.skill_id)&&<ContextPanel title={skillName(draft.brief.skill_id)} anchor={skillOptionsButton} onClose={()=>setShowSkillOptions(false)}><section className="compose-settings"><fieldset className="creation-settings" disabled={working}><SkillOptions brief={draft.brief} assets={assets} onChange={brief=>onChange({...draft,brief,assetIds:draft.assetIds.filter(id=>id!==brief.skill_options?.reference_asset_id)})}/></fieldset></section></ContextPanel>}
  {showSettings&&<ContextPanel title="视频设置" anchor={settingsButton} onClose={()=>setShowSettings(false)}><section className="compose-settings"><fieldset className="creation-settings video-settings-fields" disabled={working}>
    <label className="video-setting-duration"><span>视频时长</span><span className="video-duration-input"><input type="number" min={2} max={180} aria-label="视频时长（秒）" value={draft.brief.duration_ms/1000} onChange={e=>update('duration_ms',Math.round(Number(e.target.value)*1000))}/><span>秒</span></span></label>
    <SelectControl label="视频比例" value={draft.brief.aspect_ratio} onChange={value=>update('aspect_ratio',value as Brief['aspect_ratio'])} options={[{value:'9:16',label:'竖屏 9:16'},{value:'16:9',label:'横屏 16:9'},{value:'1:1',label:'方形 1:1'}]}/>
    <details className="video-setting-music"><summary><span>背景音乐</span><span>{draft.brief.bgm?.mode==='track'?library?.tracks.find(t=>t.id===draft.brief.bgm?.track_id)?.title:'平台默认'}<ChevronDown size={16}/></span></summary><div className="video-setting-music-body"><MusicPicker library={library} value={draft.brief.bgm} onChange={value=>update('bgm',value)}/></div></details>
    <label className="video-setting-subtitles"><span>文案字幕</span><span className="video-subtitle-control"><span>{draft.brief.subtitles?'开启':'关闭'}</span><input className="ui-switch" type="checkbox" role="switch" aria-label="创作视频字幕" checked={draft.brief.subtitles} onChange={e=>update('subtitles',e.target.checked)}/></span></label>
    <SelectControl label="清晰度" value={draft.brief.resolution} onChange={value=>update('resolution',value as Brief['resolution'])} options={[{value:'1080p',label:'1080p'},{value:'720p',label:'720p'}]}/>
  </fieldset></section></ContextPanel>}
 </section>;
}
