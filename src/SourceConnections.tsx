import {useEffect,useState} from 'react';
import {ExternalLink,LoaderCircle,RefreshCw} from 'lucide-react';
import type {SourceConnection} from '../shared/types';
import {api,post} from './api';

const labels={ready:'已连接',needs_auth:'待授权',unavailable:'未安装',error:'连接异常',disabled:'已暂停',pending_connection:'待接入'};
export function SourceConnections(){
 const [items,setItems]=useState<SourceConnection[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [configure,setConfigure]=useState(false),[key,setKey]=useState('');
 const saveDouyin=async()=>{setBusy(true);setError('');try{const result=await post<SourceConnection>('/source-connections/douyin',{api_key:key});setKey('');setItems(current=>current.map(i=>i.id==='douyin'?result:i));if(result.status==='ready')setConfigure(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const refresh=async(check=false)=>{setBusy(true);setError('');try{if(check&&items.some(i=>i.id==='douyin'&&i.enabled))await post('/source-connections/douyin/check');setItems(await api('/source-connections'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{void refresh();},[]);
 return <section className="settings-section source-connections" aria-label="素材来源">
  <div className="settings-section-title"><h3>素材来源</h3><button type="button" className="button compact" disabled={busy} onClick={()=>void refresh(true)}>{busy?<LoaderCircle className="spin" size={14}/>:<RefreshCw size={14}/>}检查连接</button></div>
  <p className="setting-note">优先检索企业素材，不足时补充公共素材。这里只同步与创作需求相关的视频。</p>
  {error&&<p role="alert" className="settings-error">{error}</p>}
  {items.map(item=><div className="source-connection" key={item.id}><div className="source-connection-heading"><strong>{item.name}</strong><span className="connection-status" data-status={item.status}>{labels[item.status]}</span></div><p className="setting-note">{item.message}</p>{item.id==='feishu'&&item.status==='needs_auth'&&<small>完成本机飞书 CLI 用户授权后，点击“检查连接”。</small>}{item.url&&<a className="source-link" href={item.url} target="_blank" rel="noreferrer">打开工作台<ExternalLink size={13}/></a>}</div>)}
  <button className="button compact" type="button" aria-expanded={configure} onClick={()=>setConfigure(!configure)}>配置工作台连接</button>
  {configure&&<div className="settings-section"><label className="field"><span>工作台 API Key</span><input aria-label="工作台 API Key" type="password" autoComplete="off" value={key} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(key.trim()&&!busy)void saveDouyin();}}} onChange={e=>setKey(e.target.value)} placeholder="粘贴工作台发布页面的 API Key"/></label><small className="setting-note">凭证仅保存在本机服务端，不会随接口返回。</small><button className="button primary compact" disabled={busy||!key.trim()} type="button" onClick={()=>void saveDouyin()}>保存并检查连接</button></div>}
  <small className="source-public-note">公共素材：Mixkit · Steam</small>
 </section>;
}
