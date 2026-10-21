import {useState} from 'react';
import {FolderOpen,LoaderCircle,RefreshCw,Sparkles,Upload} from 'lucide-react';
import type {Asset,Task} from '../shared/types';

export function PreparationCard({task,assets,busy,onRetry,onUpload,onSelect}:{task:Task;assets:Asset[];busy:boolean;onRetry:()=>void;onUpload:()=>void;onSelect:(ids:string[])=>void}){
 const [choose,setChoose]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const pending=!!task.preparation&&['queued','searching','planning'].includes(task.preparation.status);
 const message=task.preparation?.message||'素材已就绪，可以继续生成剪辑方案。';
 return <section className="agent-message preparation-card" aria-label="创作准备">
  <div className="message-label">{pending?<LoaderCircle size={15} className="spin"/>:<Sparkles size={15}/>}<strong>{pending?task.preparation?.status==='planning'?'整理剪辑方案':'查找素材':task.asset_ids.length?'待生成剪辑方案':'等待视频素材'}</strong></div>
  <p role="status">{message}</p>
  {!!task.preparation?.sources?.length&&<details className="preparation-source-details"><summary>素材检索详情</summary>{task.preparation.sources.map(s=><p key={s.provider}><strong>{s.provider==='Feishu'?'飞书知识库':s.provider==='Douyin'?'抖音工作台':s.provider}</strong> · {s.status==='ok'?`找到 ${s.found} 个视频文件${s.references_found?`、${s.references_found} 个参考链接`:''}`:s.status==='needs_auth'?'待授权':s.status==='skipped'?'已跳过':'检索未完成'}{s.message&&<span> · {s.message}</span>}</p>)}</details>}
  {!!task.preparation?.references?.length&&<details className="preparation-source-details"><summary>查看相关视频（{task.preparation.references.length}）</summary><p>这些是参考链接，尚未作为剪辑素材导入。</p>{task.preparation.references.map(r=><p key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></p>)}</details>}
  {!pending&&<><div className="preparation-actions">
   <button className="button compact" disabled={busy} onClick={onRetry}><RefreshCw size={14}/>{task.asset_ids.length?'生成剪辑方案':'重新搜索'}</button>
   <button className="button compact" disabled={busy} onClick={onUpload}><Upload size={14}/>上传素材</button>
   <button className="button compact" disabled={busy} aria-expanded={choose} onClick={()=>setChoose(!choose)}><FolderOpen size={14}/>从素材库选择</button>
  </div>{choose&&<div className="preparation-library"><div className="preparation-assets">{assets.filter(a=>!task.asset_ids.includes(a.id)).map(a=><label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} disabled={busy||(!selected.includes(a.id)&&task.asset_ids.length+selected.length>=12)} onChange={()=>setSelected(ids=>ids.includes(a.id)?ids.filter(id=>id!==a.id):[...ids,a.id])}/><img src={a.thumbnail_url} alt=""/><span>{a.name}</span></label>)}</div>{assets.length?<button className="button primary compact" disabled={busy||!selected.length} onClick={()=>{onSelect(selected);setChoose(false);setSelected([]);}}>使用所选素材</button>:<p>素材库还没有视频，可以先上传。</p>}</div>}</>}
 </section>;
}
