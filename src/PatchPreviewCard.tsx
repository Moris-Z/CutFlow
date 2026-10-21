import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, PencilLine, RefreshCw, X } from 'lucide-react';
import { ChangeList } from './TextPlanDetails';
import type { Patch } from '../shared/types';
const time=(ms:number)=>`${(ms/1000).toFixed(2)}s`;
const range=(r:[number,number])=>Math.abs(r[1]-r[0])<1?`${time(r[0])} 切口`:`${time(r[0])} – ${time(r[1])}`;
export function PatchPreviewCard({patch,busy,onAction}:{patch:Patch;busy:boolean;onAction:(action:string,payload:unknown)=>void}){
 const preview=patch.preview,working=preview?.status==='queued'||preview?.status==='rendering';
 const musicOnly=patch.constraints?.global_fields.length===1&&patch.constraints.global_fields[0]==='bgm'&&!patch.constraints.clip_fields.length;
 const ready=preview?.status==='ready'&&preview.regions.every(r=>r.before?.qa.passed&&r.after?.qa.passed);
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{const node=root.current,parent=node?.closest('.agent-body');if(node&&parent)parent.scrollTo({top:parent.scrollTop+node.getBoundingClientRect().top-parent.getBoundingClientRect().top-18,behavior:'smooth'});},[patch.id]);
 const [reviewed,setReviewed]=useState(false);
 useEffect(()=>setReviewed(false),[patch.id,preview?.id]);
 const payload={patch_id:patch.id,base_version:patch.base_version};
 const awaitingText=patch.text_review?.required&&patch.text_review.approved_digest!==patch.text_review.candidate_digest;
 if(awaitingText)return <section ref={root} className="patch-card" aria-label="文字修改方案">
  <div className="message-label"><PencilLine size={14}/>文字修改方案<span className="badge amber">待确认</span></div>
  <p>{patch.summary}</p><small>基于 v{patch.base_version} · 尚未生成片段预览</small>
  <p className="patch-scope">{patch.scope?.basis}</p><ChangeList changes={patch.changes}/>
  <p className="patch-note">只执行以上列出的改动；未提及的镜头、字幕、音量和剪辑设置保持不变。裁短或删除镜头时，后续播放位置会自然前移。</p>
  <button className="button primary full" disabled={busy} onClick={()=>onAction('approve-patch-plan',{...payload,candidate_digest:patch.text_review!.candidate_digest})}><Check size={15}/>确认方案，预览片段</button>
  <button className="button full" disabled={busy} onClick={()=>onAction('discard-patch',payload)}><X size={14}/>放弃这次修改</button>
  <p className="patch-note">{musicOnly?'需要调整音乐或音量？先放弃本方案，再点击视频下方的“更换配乐”。':'需要调整可在下方重新描述要求，新方案需要重新确认。'}</p>
 </section>;
 return <section ref={root} className="patch-card" aria-label="局部修改预览">
  <div className="message-label"><PencilLine size={14}/>片段修改预览<span className="badge amber">尚未应用</span></div>
  <p>{patch.summary}</p><small>基于 v{patch.base_version} · 完整视频保持不变</small>
  <details className="patch-text-details"><summary>查看已列明的改动点</summary><ChangeList changes={patch.changes}/></details>
  <p className="patch-scope">{patch.scope?.basis||'旧修改尚未定位范围，请重新提交建议。'}</p>
  {working&&<div className="patch-progress" role="status"><LoaderCircle size={16} className="spin"/><span>正在生成前后对比 · {preview.progress}%</span></div>}
  {(preview?.regions||patch.regions||[]).map((region,i)=><div className="patch-region" key={region.id}>
   <strong>修改区间 {i+1}</strong>
   <div className="patch-comparison">{(['before','after'] as const).map(side=>{
    const media=preview?.regions.find(r=>r.id===region.id)?.[side];
    return <figure key={side}><figcaption>{side==='before'?'修改前':'修改后'}<span>{range(region[side==='before'?'before_range':'after_range'])}</span></figcaption>
     {media?<video style={{aspectRatio:patch.edl.aspect_ratio.replace(':','/')}} onPlay={event=>{for(const video of document.querySelectorAll('video'))if(video!==event.currentTarget)video.pause();}} key={media.url} src={media.url} controls playsInline preload="metadata" aria-label={`区间${i+1}${side==='before'?'修改前':'修改后'}预览`}/>:<div className="patch-video-placeholder" style={{aspectRatio:patch.edl.aspect_ratio.replace(':','/')}}>{working?'生成中…':'暂无预览'}</div>}
     {media&&<a className="patch-open-video" href={media.url} target="_blank" rel="noreferrer">放大播放</a>}<small>播放范围 {range(region[side==='before'?'before_preview_range':'after_preview_range'])}</small>
     {media&&!media.qa.passed&&<small className="patch-error">片段检查未通过</small>}
    </figure>;
   })}</div>
  </div>)}
  {!!preview?.regions.length&&<p className="patch-note">{musicOnly?'配乐影响全片；此处先试听前 8 秒，确认后按同一配置铺满整条视频。':'时间码对应各自的完整视频。预览额外保留切口前后最多 0.4 秒，便于检查衔接。'}</p>}
  {preview?.error&&<p className="patch-error" role="alert">{preview.error}</p>}
  {ready&&<label className="patch-review-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已观看片段，修改效果符合预期</label>}
  <button className="button primary full" disabled={busy||!ready||!reviewed} onClick={()=>onAction('apply-patch',{...payload,preview_id:preview?.id})}><Check size={15}/>应用到完整视频</button>
  <div className="patch-actions">{working?<button className="button compact" disabled={busy} onClick={()=>onAction('cancel-patch-preview',{...payload,preview_id:preview?.id})}><X size={14}/>停止片段预览</button>:<>
   {(!preview||preview.status==='failed'||preview.status==='cancelled')&&patch.scope&&<button className="button compact" disabled={busy} onClick={()=>onAction('patch-preview',payload)}><RefreshCw size={14}/>重新生成片段</button>}
   <button className="button compact" disabled={busy} onClick={()=>onAction('discard-patch',payload)}><X size={14}/>放弃这次修改</button>
  </>}</div>
  <p className="patch-note">{musicOnly?'还需调整？放弃本方案后，可在“更换配乐”中重新选择曲目和混音参数。':'还需调整？重新描述完整要求，会从当前完整版本生成新的片段预览。'}</p>
 </section>;
}
