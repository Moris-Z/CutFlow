import type {Asset,Brief,Shot,Clip} from '../shared/types.js';
import {getSkill,type EditingSkill} from '../shared/skills.js';
import {assert} from './errors.js';
import {protectedRange} from './editorial.js';

// Internal instructions never become visible textarea text, stored user requests or source-search queries.
export function skillContext(brief:Brief,assets:Asset[]){
 const skill=getSkill(brief.skill_id);
 if(!skill)return undefined;
 assert(!skill.unavailable,'SKILL_UNAVAILABLE',`${skill.name}：${skill.unavailable}`,422);
 if(skill.behavior==='montage')assert(assets.length>=2,'SKILL_NEEDS_MATERIAL','多素材混剪需要至少两份视频。请继续上传或从素材库选择。',422);
 if(skill.behavior==='highlight')assert(assets.some(a=>a.shots.some(s=>s.evidence.type==='user_annotation'&&s.intent)),'SKILL_NEEDS_MATERIAL',`${skill.name}需要先确认重点区间。请在素材库编辑注释，标注关键动作与优先级。`,422);
 if(skill.id==='creator_montage')assert(assets.filter(a=>a.has_audio&&a.shots.some(s=>s.evidence.type==='user_annotation'&&s.ad_roles?.includes('testimonial')&&s.transcript?.trim())).length>=2,'SKILL_NEEDS_MATERIAL','达人混剪需要至少两份含原声、已确认逐字稿和真人评价标注的素材。',422);
 return {skill,instructions:[`任务：${skill.name}。${skill.description}`,`素材要求：${skill.needs}`,'用户明确提出的保留项、时长、画幅和字幕配置优先。不改动用户未授权的内容，不虚构素材缺少的部分。','必选动作及其起势和收尾必须完整保留。每条策略必须落到实际 shot_id 和源片区间。',skill.behavior==='fast'&&!/舒缓|缓慢|慢节奏/.test(brief.request)?'可选镜头控制在3秒以内，完整关键动作和评价允许超过3秒；不宣称音乐卡点。':skill.behavior==='highlight'?'优先选择人工确认、优先级高的动作；选中后按源素材顺序叙述。':skill.behavior==='montage'?'优先覆盖不同素材文件，再补充各文件的其他镜头。':'依照有证据的叙事阶段安排镜头。'].join('\n')};
}
export function skillCandidates(shots:Shot[],skill:EditingSkill|undefined):Shot[]{
 if(skill?.behavior==='montage'){
  const groups=new Map<string,Shot[]>();for(const shot of shots)groups.set(shot.asset_id,[...(groups.get(shot.asset_id)||[]),shot]);
  const result:Shot[]=[];for(let i=0;i<Math.max(0,...[...groups.values()].map(a=>a.length));i++)for(const group of groups.values())if(group[i])result.push(group[i]);return result;
 }
 if(skill?.behavior==='highlight')return [...shots].sort((a,b)=>(Number(b.evidence.type==='user_annotation'&&!!b.intent)*10+(b.intent?.priority||0))-(Number(a.evidence.type==='user_annotation'&&!!a.intent)*10+(a.intent?.priority||0)));
 return [...shots].sort((a,b)=>(b.intent?.priority||1)-(a.intent?.priority||1));
}
export function skillClipCapacity(shot:Shot,brief:Brief,skill:EditingSkill|undefined){
 const full=shot.end_ms-shot.start_ms;
 if(skill?.behavior!=='fast'||/舒缓|缓慢|慢节奏/.test(brief.request))return full;
 if(shot.evidence.type==='user_annotation'&&shot.ad_roles?.includes('testimonial')&&shot.transcript?.trim())return full;
 const protectedTime=protectedRange(shot);return Math.min(full,Math.max(3000,protectedTime?protectedTime[1]-protectedTime[0]:0));
}
export function validateSkillClips(clips:Clip[],skill:EditingSkill|undefined,assets:Asset[]){
 if(skill?.id==='creator_montage'){const testimonials=new Set(assets.flatMap(a=>a.shots.filter(s=>s.evidence.type==='user_annotation'&&s.ad_roles?.includes('testimonial')&&s.transcript?.trim()&&a.has_audio).map(s=>s.id)));assert(new Set(clips.filter(c=>testimonials.has(c.shot_id||'')).map(c=>c.asset_id)).size>=2,'SKILL_NEEDS_DURATION','当前方案未保留两位使用者的完整评价，请延长时长后重新规划。',422);}
 if(skill?.behavior==='montage')assert(new Set(clips.map(c=>c.asset_id)).size>=2,'SKILL_NEEDS_DURATION','当前时长无法覆盖两份素材，请延长时长或减少必选片段。',422);
}
