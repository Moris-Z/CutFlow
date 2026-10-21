import type {Asset,Clip,EDL,RevisionChanges,TextChange,RevisionScope,TextPlanReview} from '../shared/types.js';
import {assert} from './errors.js';
import {edlDigest} from './revisions.js';

export const changeContract=(clip_fields:RevisionChanges['clip_fields']=[],global_fields:RevisionChanges['global_fields']=[],allow_delete=false,allow_reorder=false):RevisionChanges=>({clip_fields,global_fields,allow_delete,allow_reorder});

/** A model may choose values, but cannot grant itself permission to edit fields. */
export function modelChangeContract(feedback:string,scope:RevisionScope):RevisionChanges {
 const affirmative=feedback.split(/[，,；;。\n]/).filter(s=>!/(?:不要|不许|别|无需|不需要|不改|不变|保持|保留原)/.test(s)).join('，');
 const clip=new Set<keyof Clip>(),global=new Set<keyof EDL>();
 if(/字幕/.test(affirmative))clip.add('caption');
 if(/音量|原声|静音/.test(affirmative))(scope.kind==='global'?global:clip).add('audio_gain');
 if(/缩短|剪短|延长|入点|出点|截取|裁切|快一点|慢一点|节奏|铺垫|收尾|关键动作|取原片/.test(affirmative)){clip.add('start_ms');clip.add('end_ms');}
 if(/替换|换成|换用|更换/.test(affirmative)&&/素材|镜头|画面|片段/.test(affirmative))for(const k of ['asset_id','shot_id','evidence','start_ms','end_ms'] as const)clip.add(k);
 if(/标题/.test(affirmative))global.add('title');
 if(/CTA|结尾文案|片尾文案|行动号召/i.test(affirmative))global.add('cta');
 if(/画幅|比例|横屏|竖屏/.test(affirmative))global.add('aspect_ratio');
 if(/分辨率|720p|1080p/i.test(affirmative))global.add('resolution');
 const allow_delete=/(?:删除|去掉|移除|删掉).*(?:镜头|整段)|(?:镜头|整段).*(?:删除|去掉|移除|删掉)/.test(affirmative)&&!/字幕|文案|音量|原声|人物|物品|口水词/.test(affirmative);
 const allow_reorder=/顺序|交换|调换|对调|移动镜头|镜头.*移到/.test(affirmative);
 assert(clip.size||global.size||allow_delete||allow_reorder,'REVISION_CHANGE_REQUIRED','请明确希望改变的内容，例如镜头时长、字幕或音量；不会自动润色其他内容',422);
 return changeContract([...clip],[...global],allow_delete,allow_reorder);
}

export function assertRequestedChanges(before:EDL,after:EDL,contract:RevisionChanges){
 for(const key of new Set([...Object.keys(before),...Object.keys(after)] as (keyof EDL)[])){
  if(key==='version'||key==='clips'||contract.global_fields.includes(key))continue;
  assert(JSON.stringify(before[key])===JSON.stringify(after[key]),'UNREQUESTED_CHANGE',`修改包含未被要求调整的全片设置：${fieldName(key)}`,422);
 }
 const oldIds=before.clips.map(c=>c.id),newIds=after.clips.map(c=>c.id);
 assert(newIds.every(id=>oldIds.includes(id)),'UNREQUESTED_CHANGE','修改包含未被要求新增的镜头；替换素材应保留镜头编号',422);
 assert(contract.allow_delete||oldIds.every(id=>newIds.includes(id)),'UNREQUESTED_CHANGE','修改删除了未被要求删除的镜头',422);
 if(!contract.allow_reorder)assert(JSON.stringify(oldIds.filter(id=>newIds.includes(id)))===JSON.stringify(newIds),'UNREQUESTED_CHANGE','修改改变了未被要求调整的镜头顺序',422);
 for(const previous of before.clips){const next=after.clips.find(c=>c.id===previous.id);if(!next)continue;
  for(const field of new Set([...Object.keys(previous),...Object.keys(next)] as (keyof Clip)[])){
   if(contract.clip_fields.includes(field))continue;
   assert(JSON.stringify(previous[field])===JSON.stringify(next[field]),'UNREQUESTED_CHANGE',`镜头 ${oldIds.indexOf(previous.id)+1} 包含未被要求的修改：${fieldName(field)}`,422);
  }
 }
}
const names:Record<string,string>={narration:'配音',audio_source:'独立口播',caption_style:'字幕样式',bgm:'背景音乐',start_ms:'源片入点',end_ms:'源片出点',caption:'字幕',audio_gain:'音量',title:'标题',cta:'结尾文案',aspect_ratio:'画幅',resolution:'分辨率',fps:'帧率',subtitles:'文案字幕开关',asset_id:'素材',shot_id:'素材选段',evidence:'素材证据',purpose:'镜头目的',locked:'镜头锁',schema_version:'工程格式'};
function fieldName(key:string){return names[key]||key;}
function display(key:string,value:unknown):string{if(value===undefined)return key==='audio_gain'?'100%':'未设置';if(key==='narration')return (value as Clip['narration'])?.text||'无';if(key==='bgm'){const b=value as EDL['bgm'];return b?`${b.title} · ${Math.round(b.gain*100)}% · ${(b.start_ms/1000).toFixed(1)} 秒起播 · 人声避让${b.ducking?'开启':'关闭'}`:'未设置';}if(key.endsWith('_ms'))return `${(Number(value)/1000).toFixed(2)} 秒`;if(key==='audio_gain')return `${Math.round(Number(value)*100)}%`;if(typeof value==='boolean')return value?'开启':'关闭';if(typeof value==='object')return '随素材选段更新';return String(value||'无');}
export function describeChanges(before:EDL,after:EDL,assets:Asset[]=[]):TextChange[]{
 const rows:TextChange[]=[];
 for(const k of ['audio_gain','subtitles','title','cta','aspect_ratio','resolution','fps','bgm','caption_style'] as const)if(JSON.stringify(before[k])!==JSON.stringify(after[k]))rows.push({target:'全片',field:fieldName(k),before:display(k,before[k]),after:display(k,after[k])});
 for(const [i,c] of before.clips.entries()){
  const n=after.clips.find(clip=>clip.id===c.id),target=`镜头 ${i+1}`;
  if(!n){rows.push({target,field:'镜头',before:`保留 · ${c.purpose}`,after:'删除'});continue;}
  for(const k of ['asset_id','start_ms','end_ms','caption','audio_gain','narration'] as const)if(c[k]!==n[k])rows.push({target,field:fieldName(k),before:k==='asset_id'?(assets.find(a=>a.id===c.asset_id)?.name||'原素材'):display(k,c[k]),after:k==='asset_id'?(assets.find(a=>a.id===n.asset_id)?.name||'替换素材'):display(k,n[k])});
 }
 const old=before.clips.filter(c=>after.clips.some(n=>n.id===c.id)).map(c=>c.id);
 if(JSON.stringify(old)!==JSON.stringify(after.clips.map(c=>c.id)))rows.push({target:'选定镜头',field:'顺序',before:old.map(id=>`镜头${before.clips.findIndex(c=>c.id===id)+1}`).join(' → '),after:after.clips.map(c=>`镜头${before.clips.findIndex(p=>p.id===c.id)+1}`).join(' → ')});
 return rows;
}
export function textReview(edl:EDL,required:boolean,base?:EDL):TextPlanReview{return {required,candidate_digest:edlDigest(edl),...(base?{base_digest:edlDigest(base)}:{})};}
export function assertTextReview(review:TextPlanReview|undefined,candidate:EDL,base?:EDL){
 if(!review)return; // Older, already-created plans keep their original review flow.
 assert(review.candidate_digest===edlDigest(candidate)&&(!review.base_digest||!!base&&review.base_digest===edlDigest(base)),'STALE_TEXT_PLAN','文字方案对应的版本已变化，请重新生成方案',409);
 assert(!review.required||review.approved_digest===review.candidate_digest,'TEXT_PLAN_APPROVAL_REQUIRED','请先确认文字方案，再生成视频预览',409);
}
export function approveTextReview(review:TextPlanReview,candidate:EDL,digest:string,base?:EDL){
 assert(digest===review.candidate_digest&&digest===edlDigest(candidate)&&(!review.base_digest||!!base&&review.base_digest===edlDigest(base)),'STALE_TEXT_PLAN','文字方案已更新，请检查最新方案后确认',409);
 review.approved_digest=digest;review.approved_at=new Date().toISOString();
}
