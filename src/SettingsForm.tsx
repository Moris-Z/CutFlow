import {useState} from 'react';
import {Check,ChevronDown,LoaderCircle,SlidersHorizontal,Sparkles} from 'lucide-react';
import type {MusicLibrary,Settings} from '../shared/types';
import {SourceConnections} from './SourceConnections';
import {SelectControl} from './SelectControl';

export function SettingsForm({library,settings,busy,error,onSave,onClose}:{library?:MusicLibrary;settings?:Settings;busy:string;error:string;onSave:(values:Record<string,string|boolean>)=>void;onClose:()=>void}){
  const [page,setPage]=useState<'general'|'advanced'>('general');
  const [url,setUrl]=useState(settings?.model_base_url||''),[model,setModel]=useState(settings?.model_name||''),[key,setKey]=useState('');
  const [defaultBgm,setDefaultBgm]=useState(settings?.default_bgm_id||'carefree'),[renderer,setRenderer]=useState(settings?.renderer||'ffmpeg');
  const [confirmTextPlan,setConfirmTextPlan]=useState(settings?.confirm_text_plan??true);
  const disabled=!!busy||!settings;
  return <form className="settings-editor" onSubmit={e=>{e.preventDefault();const data:Record<string,string|boolean>={confirm_text_plan:confirmTextPlan,default_bgm_id:defaultBgm,renderer,model_name:model};if(url.trim())data.model_base_url=url.trim();if(key)data.model_api_key=key;onSave(data);}}>
    <div className="settings-tabs" role="tablist" aria-label="设置类别">{(['general','advanced'] as const).map((id,index)=><button type="button" key={id} id={`settings-${id}-tab`} role="tab" aria-selected={page===id} aria-controls={`settings-${id}`} tabIndex={page===id?0:-1} className={page===id?'selected':''} onClick={()=>setPage(id)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'general':e.key==='End'?'advanced':index===0?'advanced':'general';setPage(next);document.getElementById(`settings-${next}-tab`)?.focus();}}}>{id==='general'?<SlidersHorizontal size={16}/>:<Sparkles size={16}/>}<span>{id==='general'?'常规设置':'高级设置'}</span></button>)}</div>
    {error&&<p className="settings-error" role="alert">{error}</p>}
    <div className="settings-content" id={`settings-${page}`} role="tabpanel" aria-labelledby={`settings-${page}-tab`}>
      {page==='general'?<>
        <SourceConnections/>
        <section className="settings-section"><h3>创作流程</h3><label className="setting-toggle-row"><span><strong>先确认文字方案</strong><small>首版视频和后续修改，都由你确认方案后再生成预览。</small></span><input className="ui-switch" type="checkbox" role="switch" aria-label="生成预览前确认文字方案" checked={confirmTextPlan} disabled={disabled} onChange={e=>setConfirmTextPlan(e.target.checked)}/></label>{!confirmTextPlan&&<p className="setting-note">新方案将直接生成预览，已有待确认方案仍需确认。</p>}</section>
        <section className="settings-section"><h3>视频配乐</h3><SelectControl label="默认背景音乐" value={defaultBgm} onChange={setDefaultBgm} disabled={disabled||!library?.tracks.length} options={(library?.tracks||[]).map(track=>({value:track.id,label:track.title,description:track.tags.join(' · ')}))}/><p className="setting-note">用于之后的新方案，也可以为单支视频选择其他配乐。</p></section>
      </>:<>
        <section className="settings-section"><div className="settings-section-title"><h3>模型连接</h3><span className="connection-status">{settings?.model_configured?'已配置':'未连接'}</span></div><p className="setting-note">可选。连接后可使用模型规划和素材分析。</p><label className="setting-field">服务地址<input type="url" disabled={disabled} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://api.example.com/v1" autoComplete="url"/></label><div className="settings-input-grid"><label className="setting-field">模型名称<input disabled={disabled} value={model} onChange={e=>setModel(e.target.value)} placeholder="服务支持的模型名称"/></label><label className="setting-field">API Key<input type="password" disabled={disabled} value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" placeholder={settings?.model_configured?'已配置，留空保持不变':'填写密钥'}/></label></div><details className="setting-help"><summary>连接说明<ChevronDown size={13}/></summary><p>使用兼容 Chat Completions 的服务。密钥仅保存在服务端内存，重启后需重新填写或通过 .env 配置；素材分析会发送采样画面到该服务。</p></details></section>
        <section className="settings-section"><h3>视频处理</h3><SelectControl label="处理方式" value={renderer} onChange={setRenderer} disabled={disabled} options={[{value:'ffmpeg',label:'标准处理',description:'FFmpeg · 日常剪辑与导出，推荐使用'},{value:'remotion',label:'高级合成',description:'Remotion · 使用 React 合成视频'}]}/></section>
        <details className="settings-capabilities"><summary>查看当前支持的功能<ChevronDown size={14}/></summary>{settings?.capabilities.map(c=><div key={c.id}><span><strong>{c.name}</strong><small>{c.description}</small></span><em>{c.status==='ready'?'可用':c.status==='requires_model'?'需连接模型':'暂不支持'}</em></div>)}</details>
      </>}
    </div>
    <div className="settings-footer"><span>修改后保存生效</span><div><button type="button" className="button" disabled={!!busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={disabled}>{busy==='settings'?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}保存设置</button></div></div>
  </form>;
}
