import {skillContext,skillCandidates,skillClipCapacity,validateSkillClips} from './skills.js';
import {getSkill,isWorkflowSkill} from '../shared/skills.js';
import { matchRecipe, recipes, recipeName, recipeShotOrder, recipeShotWeight } from '../shared/recipes.js';
import { changeContract, modelChangeContract, assertRequestedChanges, describeChanges } from './revision-changes.js';
import { editingInstructions, resolveRevisionScope, assertRevisionScope, revisionRegions } from './revisions.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BriefSchema, EDLSchema, durationOf, type Asset, type Brief, type Clip, type EDL, type Patch, type Plan } from '../shared/types.js';
import { assert, AppError } from './errors.js';
import { validateEditorial, editorialReview, protectedRange, resolveClipShot } from './editorial.js';
import { callModel,modelAvailable } from './model.js';
const subtitlesOnlyRequested=(text:string)=>/(?:只|仅)(?:保留|显示|要)字幕|(?:不要|不加|移除|去掉|删除)(?:[^。！？\n]{0,20})(?:额外文案|额外文字|字幕之外的文案|字幕以外的文案)/.test(text);
export function normalizeBrief(input:unknown):Brief{
 const b=BriefSchema.parse(input);const r=b.request;const skill=getSkill(b.skill_id);
 if(skill){assert(!skill.unavailable,'SKILL_UNAVAILABLE',`${skill.name}：${skill.unavailable}`,422);b.recipe=skill.recipe;if(skill.behavior==='portrait'){if(!(input as Partial<Brief>).aspect_ratio)b.aspect_ratio='9:16';if(!(input as Partial<Brief>).platform)b.platform='TikTok';}}
 if(subtitlesOnlyRequested(r))b.allow_text_overlays=false;
 const seconds=r.match(/(?:控制在|剪成|时长|长度|总长|约|为)?\s*(\d+(?:\.\d+)?)\s*(?:秒|s\b)/i);
 if(seconds)b.duration_ms=Math.round(Number(seconds[1])*1000);
 if(/16\s*[:：]\s*9|横屏/.test(r))b.aspect_ratio='16:9';else if(/9\s*[:：]\s*16|竖屏/.test(r))b.aspect_ratio='9:16';else if(/1\s*[:：]\s*1|方形/.test(r))b.aspect_ratio='1:1';
 if(/720\s*p/i.test(r))b.resolution='720p';else if(/1080\s*p/i.test(r))b.resolution='1080p';
 if(/口播/.test(r))b.scenario='talking_head';else if(/卡点|舞蹈/.test(r))b.scenario='beat';else if(/高光/.test(r))b.scenario='highlight';else if(/情景剧|按.*脚本/.test(r))b.scenario='scripted';
 return BriefSchema.parse(b);
}
export function validateEDL(input:unknown,assets:Asset[],previous?:EDL):EDL{
 const edl=EDLSchema.parse(input);const ids=new Set<string>();
 for(const c of edl.clips){assert(!ids.has(c.id),'DUPLICATE_CLIP','镜头 ID 必须唯一');ids.add(c.id);const a=assets.find(a=>a.id===c.asset_id);assert(a,'ASSET_NOT_FOUND',`素材 ${c.asset_id} 不存在`);assert(c.end_ms>c.start_ms,'INVALID_RANGE','镜头结束时间必须晚于开始');assert(c.end_ms<=a.duration_ms+1,'SOURCE_OUT_OF_BOUNDS',`镜头超出素材 ${a.name} 时长`);assert(c.end_ms-c.start_ms>=100,'CLIP_TOO_SHORT','单镜头至少 100ms');assert(a.shots.some(s=>c.start_ms>=s.start_ms&&c.end_ms<=s.end_ms+1&&JSON.stringify(c.evidence)===JSON.stringify(s.evidence)),'EVIDENCE_NOT_FOUND','片段必须包含在素材证据区间内，且保留对应证据');}
 for(const c of edl.clips)if(c.audio_source){const source=assets.find(a=>a.id===c.audio_source!.asset_id);assert(source?.has_audio,'AUDIO_SOURCE_MISSING','独立口播素材缺失或没有音轨',422);assert(c.audio_source.end_ms>c.audio_source.start_ms&&c.audio_source.end_ms<=source.duration_ms&&Math.abs(c.audio_source.end_ms-c.audio_source.start_ms-(c.end_ms-c.start_ms))<=34,'AUDIO_SOURCE_RANGE','独立口播区间无效',422);}
 validateEditorial(edl,assets);
 for(const clip of edl.clips){const shot=resolveClipShot(clip,assets);if(shot?.evidence.type==='user_annotation'&&shot.ad_roles?.includes('testimonial')&&shot.transcript?.trim()){
  // B-roll may cover the beginning while the same complete utterance continues underneath.
  // Require consecutive, audible source ranges in timeline order; gaps or reordering never qualify.
  let cursor=shot.start_ms,continuous=false;
  for(const c of edl.clips){const audio=c.audio_source||{asset_id:c.asset_id,start_ms:c.start_ms,end_ms:c.end_ms};
   if(c.narration||(c.audio_gain??1)*edl.audio_gain<=0||audio.asset_id!==shot.asset_id||audio.start_ms!==cursor||audio.end_ms>shot.end_ms){cursor=shot.start_ms;continue;}
   cursor=audio.end_ms;if(cursor===shot.end_ms){continuous=true;break;}
  }
  assert(clip.start_ms===shot.start_ms&&clip.end_ms===shot.end_ms||continuous,'TESTIMONIAL_TRUNCATED','真人评价缺少逐句时间码，必须保留标注的完整评价区间；请缩小注释范围或延长时长',422);
 }}
 assert(durationOf(edl)<=180000,'DURATION_LIMIT','单任务总时长暂限 180 秒');
 if(previous){if(previous.clips.some(c=>c.locked))assert(edl.aspect_ratio===previous.aspect_ratio&&edl.resolution===previous.resolution&&edl.fps===previous.fps&&edl.audio_gain===previous.audio_gain&&edl.subtitles===previous.subtitles&&edl.title===previous.title&&edl.cta===previous.cta&&edl.caption_style===previous.caption_style&&JSON.stringify(edl.bgm)===JSON.stringify(previous.bgm),'LOCK_CONFLICT','全局画幅、音频或字幕变更会影响锁定镜头；请先解锁');for(const c of previous.clips.filter(c=>c.locked)){const next=edl.clips.find(n=>n.id===c.id);const oldStart=timelineRange(previous,c.id)[0],newStart=next?timelineRange(edl,c.id)[0]:-1;assert(next&&next.locked&&JSON.stringify({...c,locked:false})===JSON.stringify({...next,locked:false})&&oldStart===newStart,'LOCK_CONFLICT',`镜头 ${previous.clips.indexOf(c)+1} 已锁定；请先解锁再修改或移动`);}}
 return edl;
}
export function timelineRange(edl:EDL,id:string):[number,number]{let pos=0;for(const c of edl.clips){const end=pos+c.end_ms-c.start_ms;if(c.id===id)return[pos,end];pos=end;}return[0,0];}
const PlanResponse=z.object({summary:z.string().max(800),strategy:z.array(z.string().max(300)).max(8),risks:z.array(z.string().max(300)).max(12),clips:z.array(z.object({shot_id:z.string(),start_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive(),purpose:z.string().max(500),caption:z.string().max(180)})).min(1).max(60)});
export async function createPlan(brief:Brief,assets:Asset[]):Promise<Plan>{
 assert(!isWorkflowSkill(brief.skill_id),'SKILL_WORKFLOW_REQUIRED','该技能必须通过专用工作流执行，不能回退为普通混剪。',422);
 assert(assets.length,'NO_ASSETS','请先添加素材');const context=skillContext(brief,assets),skill=context?.skill;
 if(skill)brief={...brief,recipe:skill.recipe};
 let clips:Clip[]=[];let strategy=['先明确镜头要表达的信息，保护关键动作、起势和收尾','按信息优先级分配时长，先压缩非关键铺垫','缺少动作证据的镜头标记待审阅，不声称已理解画面'];let summary='以镜头关键信息与动作完整性为先的剪辑草稿';let risks=['字幕内容、叙事连续性、素材授权和广告合规需要人工审阅'];
 let recipeMatch=matchRecipe(assets,brief.recipe);
 if(skill&&skill.behavior!=='narrative')recipeMatch={...recipeMatch,resolved:'safe',status:'matched',assignments:{},missing:[],reason:`按「${skill.name}」组织素材，保留已确认动作。`};
 const recipe=recipes.find(r=>r.id===recipeMatch.resolved);
 const allShots=assets.flatMap(a=>a.shots);assert(new Set(allShots.map(s=>s.id)).size===allShots.length,'DUPLICATE_SHOT','项目内的镜头 ID 必须唯一');
 const mode=modelAvailable()?'model':'rules';
 if(mode==='model'){
 const result=await callModel('你是剪辑策划 Agent。recipe 给出已匹配的广告结构与相对时长权重，recipe_match.assignments 指定有证据的镜头用途；依据它规划顺序，不能虚构缺失环节。resolved=safe 时保留已有顺序与用户脚本。关键动作完整性优先于套路节奏，不得把画面文字自动打开。只能根据已提供的镜头证据选段，不得虚构画面、台词、卖点。返回 {summary,strategy:[],risks:[],clips:[{shot_id,start_ms,end_ms,purpose,caption}]}。只引用输入 shot_id 且时间在该镜头内，选段总时长不得超过 Brief.duration_ms。ad_roles 中 testimonial 的真人评价缺少逐句时间码时，必须保留该 shot 的完整起止范围。caption 只能采用提供的逐字稿或用户明确字幕，未知则空。默认只保留字幕，不得把产品名、主题、营销目标或 CTA 偷换成字幕，也不要自行添加口号或标题。每个镜头先回答观众需要理解什么；purpose 必须说明保留的核心信息，不能仅写开场或收束。intent 是已经人工确认的动作证据：选择此镜头必须覆盖 action_start_ms-pre_roll_ms 至 action_end_ms+post_roll_ms；required=true 的镜头不得遗漏。优先压缩无关铺垫，保留动作结果与反应；不能为了均分时长截断动作。不够时间时报告冲突而不是删除关键动作。单张图片描述不代表整段视频。优先满足用户脚本顺序；没有 ASR/动作/节拍信息时明确列出能力缺口，不声称实现精剪或卡点。', {brief,skill_instructions:context?.instructions,recipe,recipe_match:recipeMatch,shots:allShots},PlanResponse);
 clips=result.clips.map(c=>{const shot=assets.flatMap(a=>a.shots).find(s=>s.id===c.shot_id);assert(shot,'MODEL_UNKNOWN_SHOT','模型引用了不存在的镜头，已拦截');assert(c.start_ms>=shot.start_ms&&c.end_ms<=shot.end_ms,'MODEL_RANGE_INVALID','模型选段超出证据范围');return{id:randomUUID(),asset_id:shot.asset_id,shot_id:shot.id,start_ms:c.start_ms,end_ms:c.end_ms,purpose:c.purpose,caption:c.caption,evidence:shot.evidence,locked:false};});summary=result.summary;strategy=result.strategy;risks.push(...result.risks);
 }else{
 const candidates=assets.flatMap(a=>a.shots).filter(s=>s.end_ms-s.start_ms>=100);
 assert(candidates.filter(s=>s.intent?.required).length<=60,'TOO_MANY_REQUIRED_SHOTS','必须保留的动作超过 60 个，请缩小素材范围',422);
 const minimum=(shot:typeof candidates[number])=>{if(shot.evidence.type==='user_annotation'&&shot.ad_roles?.includes('testimonial')&&shot.transcript?.trim())return shot.end_ms-shot.start_ms;const range=protectedRange(shot);return range?range[1]-range[0]:Math.min(1000,shot.end_ms-shot.start_ms);};
 const required=candidates.filter(s=>s.intent?.required);
 let remaining=brief.duration_ms-required.reduce((sum,s)=>sum+minimum(s),0);
 assert(remaining>=0,'DURATION_INTENT_CONFLICT',`关键动作及收尾至少需要 ${(brief.duration_ms-remaining)/1000} 秒，超过目标 ${brief.duration_ms/1000} 秒。请延长成片或明确取消某个镜头的必须保留标记；不会截断动作以凑时长。`,422);
 const selected=new Set(required);
 // Reserve one source for each required narrative stage before spending the remaining budget.
 if(recipe)for(const [i,stage] of recipe.stages.entries()){
  if(!stage.required||[...selected].some(s=>recipeMatch.assignments[s.id]===i))continue;
  const anchor=candidates.filter(s=>recipeMatch.assignments[s.id]===i&&!selected.has(s)).sort((a,b)=>minimum(a)-minimum(b))[0];
  if(anchor&&selected.size<60&&remaining>=minimum(anchor)){selected.add(anchor);remaining-=minimum(anchor);}
 }
 for(const shot of skillCandidates(candidates.filter(s=>!selected.has(s)),skill)){const min=minimum(shot);if(selected.size<60&&remaining>=min){selected.add(shot);remaining-=min;}}
 const unavailable=recipe?.stages.filter((stage,i)=>stage.required&&![...selected].some(s=>recipeMatch.assignments[s.id]===i)).map(s=>s.name)||[];
 if(unavailable.length)recipeMatch={...recipeMatch,resolved:'safe',status:'needs_material',assignments:{},missing:unavailable,reason:'目标时长不足以容纳完整套路与必选动作，已保留素材顺序。请延长时长后重新规划。'};
 const shots=recipeShotOrder(candidates.filter(s=>selected.has(s)),recipeMatch);
 const budgets=shots.map(minimum);
 // Allocate remaining context by information priority, never by fixed equal cuts.
 while(remaining>0){const eligible=shots.map((s,i)=>({s,i,capacity:skillClipCapacity(s,brief,skill)-budgets[i]})).filter(x=>x.capacity>0);if(!eligible.length)break;const weight=eligible.reduce((sum,x)=>sum+recipeShotWeight(x.s,recipeMatch,shots),0),pool=remaining;let spent=0;for(const {s,i,capacity} of eligible){const extra=Math.min(capacity,remaining,Math.max(1,Math.floor(pool*recipeShotWeight(s,recipeMatch,shots)/weight)));budgets[i]+=extra;remaining-=extra;spent+=extra;}if(!spent)break;}
 clips=shots.map((shot,i)=>{const range=protectedRange(shot),budget=budgets[i];const start=range?Math.max(shot.start_ms,Math.min(range[0]-Math.floor((budget-(range[1]-range[0]))/2),shot.end_ms-budget)):shot.start_ms;return{id:randomUUID(),asset_id:shot.asset_id,shot_id:shot.id,start_ms:start,end_ms:start+budget,purpose:[recipeMatch.assignments[shot.id]!==undefined?recipe?.stages[recipeMatch.assignments[shot.id]].name:'',shot.intent?`${shot.intent.message}；保留${shot.intent.key_action}及收尾`:shot.evidence.type==='user_annotation'?shot.summary.slice(0,400):'待确认核心信息 · 仅按已有范围选段'].filter(Boolean).join(' · ').slice(0,500),caption:shot.transcript||'',evidence:shot.evidence,locked:false};});
 if(selected.size<candidates.length)risks.push(`时长预算不足以容纳全部可选镜头，已按信息优先级舍弃 ${candidates.length-selected.size} 段非必选素材；必选动作均保留。`);
 risks.push('当前为规则模式：尚未识别语义高光、口水词、节拍或人物关系。可补充人工时间码与字幕，或配置模型辅助策划。');
 }
 // Apply the same source-grounded sequence to model and local planning.
 {
  const order=recipeShotOrder(allShots,recipeMatch).map(s=>s.id);
  clips.sort((a,b)=>order.indexOf(a.shot_id||'')-order.indexOf(b.shot_id||''));
 }

 // Recheck the selected model output as well: an omitted stage must not be presented as complete.
 if(recipeMatch.resolved!=='safe'&&recipe){
  const missing=recipe.stages.filter((stage,i)=>stage.required&&!clips.some(c=>recipeMatch.assignments[c.shot_id||'']===i)).map(s=>s.name);
  if(missing.length)recipeMatch={...recipeMatch,status:'needs_material',missing,reason:`方案尚未覆盖 ${missing.join('、')}；请补充或重新规划，不能视为完整套路。`};
 }
 validateSkillClips(clips,skill,assets);
 if(skill?.behavior==='fast')clips=clips.map(c=>{const shot=allShots.find(s=>s.id===c.shot_id)!;const capacity=skillClipCapacity(shot,brief,skill);if(c.end_ms-c.start_ms<=capacity)return c;const range=protectedRange(shot);const start=range?Math.max(shot.start_ms,Math.min(range[0],shot.end_ms-capacity)):c.start_ms;return {...c,start_ms:start,end_ms:Math.min(shot.end_ms,start+capacity)};});
 if(skill)strategy.unshift(`技能「${skill.name}」：${skill.description}`);
 strategy.unshift(recipeMatch.reason);
 if(recipeMatch.resolved!=='safe'&&recipe)strategy.push(`叙事结构：${recipe.stages.map(s=>s.name).join(' → ')}；${recipe.rhythm}。动作保护优先于时长权重。`);
 if(recipeMatch.status==='needs_material')risks.push(`${recipeMatch.reason} 缺少：${recipeMatch.missing.join('、')}`);
 if(recipeMatch.resolved!=='safe')summary=`${recipeName(recipeMatch.resolved)} · ${summary}`;
 assert(clips.length,'NO_USABLE_SHOTS','没有至少 100ms 的可用素材区间');
 const edl=validateEDL({schema_version:'1.0',version:1,clips,aspect_ratio:brief.aspect_ratio,resolution:brief.resolution,fps:30,title:'',cta:brief.allow_text_overlays&&!subtitlesOnlyRequested(brief.request)?brief.cta:'',audio_gain:1,subtitles:brief.subtitles},assets);
 assert(durationOf(edl)<=brief.duration_ms+34,'PLAN_DURATION_EXCEEDED','方案超出目标时长，请减少素材选段或重新规划');
 if(durationOf(edl)<brief.duration_ms-1000)risks.push(`当前可用选段合计 ${(durationOf(edl)/1000).toFixed(1)} 秒，短于目标 ${brief.duration_ms/1000} 秒。未重复或编造素材补时长。`);
 if(brief.scenario==='beat')risks.push('本版未接入动作同步与节拍检测，此草稿无法保证音乐卡点。');
 if(brief.scenario==='talking_head')risks.push('本版未接入 ASR 和口水词检测；自动精剪需先补充人工有效片段。');
 if(brief.scenario==='highlight')risks.push('高光质量依赖已标注内容证据，需人工确认语义与上下文。');
 return {...(skill?{skill:{id:skill.id,name:skill.name,status:recipeMatch.status==='needs_material'?'needs_material' as const:'applied' as const,details:recipeMatch.status==='needs_material'?recipeMatch.missing:[skill.description,skill.needs]}}:{}),summary:skill?`${skill.name} · ${summary}`:summary,strategy,recipe_match:recipeMatch,editorial_review:editorialReview(edl,assets),risks:[...new Set(risks)],mode,edl,assumptions:[!brief.subtitles?'文案字幕默认关闭：不在画面添加字幕、标题或结尾文字':brief.allow_text_overlays&&!subtitlesOnlyRequested(brief.request)?'仅叠加用户明确填写的结尾文案':'画面仅保留字幕，不自动叠加标题、口号或结尾文案','未指定的音频策略为保留原声；不添加未知来源的配乐','采用留边适配画幅，避免未经确认裁掉主体','缺少逐字稿时不生成对白字幕'],created_at:new Date().toISOString()};
}
const PatchModel=z.object({summary:z.string().max(800),edl:EDLSchema});
export async function createPatch(current:EDL,assets:Asset[],feedback:string,selectedIds?:string[]):Promise<Patch>{
 assert(feedback.trim(),'EMPTY_FEEDBACK','请输入修改意见');
 const originalFeedback=feedback;feedback=editingInstructions(feedback);
 assert(feedback.trim(),'NO_CHANGE','这条建议只要求保持现状，没有可执行的改动；如需调整，请明确目标镜头和修改内容');const scope=resolveRevisionScope(current,assets,feedback,selectedIds);let next=structuredClone(current);let summary='';let constraints=changeContract();
 const indexMatch=feedback.match(/第\s*(\d+)\s*(?:个)?(?:镜头|段)/);const index=indexMatch?Number(indexMatch[1])-1:scope.kind==='clips'&&scope.clip_ids.length===1?current.clips.findIndex(c=>c.id===scope.clip_ids[0]):-1;const clip=scope.kind==='clips'&&scope.clip_ids.length===1&&index>=0?next.clips[index]:undefined;const targets=next.clips.filter(c=>scope.clip_ids.includes(c.id));
 if(indexMatch)assert(next.clips[index],'CLIP_NOT_FOUND','指定的镜头不存在');
 const textCommand=feedback.match(/(?:配音|片头标题|标题|CTA|结尾文案|行动号召|字幕|文案)(?:改为|改成|设为|：|:)/i);
 const command=textCommand?.index!==undefined?feedback.slice(0,textCommand.index+textCommand[0].length):feedback;
 const narration=feedback.match(/配音(?:改为|改成|设为|：|:)\s*[：:]?\s*[“"「]?(.+?)[”"」]?$/s);
 const caption=textCommand&&/^(?:字幕|文案)/.test(textCommand[0])?feedback.match(/(?:字幕|文案)(?:改为|改成|设为|：|:)\s*[：:]?\s*[“"「]?(.+?)[”"」]?$/s):null;
 const range=command.match(/(?:取原片|原片|源片)\s*(\d+(?:\.\d+)?)\s*秒?\s*(?:到|至|[-–])\s*(\d+(?:\.\d+)?)\s*秒/);
 const trim=command.match(/(?:缩短到|截取前|保留前|时长改为)\s*(\d+(?:\.\d+)?)\s*秒/);
 const volume=command.match(/(?:音量|原声)(?:改为|设为|调到|调为|：|:)?\s*(\d+)\s*%/);
 const cta=textCommand&&/^(?:CTA|结尾文案|行动号召)/i.test(textCommand[0])?feedback.match(/(?:CTA|结尾文案|行动号召)(?:改为|改成|：|:)\s*[：:]?\s*[“"「]?(.+?)[”"」]?$/is):null;
 const title=textCommand&&/^(?:片头标题|标题)/.test(textCommand[0])?feedback.match(/(?:片头标题|标题)(?:改为|改成|：|:)\s*[：:]?\s*[“"「]?(.+?)[”"」]?$/s):null;
 assert(!(scope.kind==='clips'&&scope.clip_ids.length>1&&(range||trim||/保留关键动作|修复关键动作/.test(command))),'REVISION_NEEDS_SPLIT','多个镜头的裁切请分别提出建议，逐段预览后确认',422);
 const operations=feedback.replace(/[“\"「][^”\"」]*[”\"」]/g,'');
 const multipleOperations=[/(?:配音|字幕|文案)(?:改为|改成|设为|：|:)/,/(?:缩短到|截取前|保留前|时长改为|取原片)/,/(?:音量|原声)(?:改为|设为|调到|调为|：|:)?\s*\d+\s*%|静音/].filter(pattern=>pattern.test(operations)).length>1||[...operations.matchAll(/(?:配音|字幕|文案)(?:改为|改成|设为|：|:)/g)].length>1||[...operations.matchAll(/(?:音量|原声)(?:改为|设为|调到|调为|：|:)?\s*\d+\s*%|静音|去掉原声|关闭原声/g)].length>1;
 assert(!multipleOperations,'REVISION_NEEDS_SPLIT','请将不同改动点分别提出，逐项确认，避免改变未指定的内容',422);
 const removeTitle=/(?:移除|去掉|删除|不要|取消)(?:片头)?标题/.test(command);
 const removeCta=/(?:移除|去掉|删除|不要|取消)(?:CTA|结尾文案|片尾文案|行动号召)/i.test(command);
 if(subtitlesOnlyRequested(command)){constraints=changeContract([],['subtitles','title','cta']);next.subtitles=true;next.title='';next.cta='';summary='移除标题与结尾文案，只保留原有字幕';}
 else if(removeTitle||removeCta){constraints=changeContract([],[...(removeTitle?['title' as const]:[]),...(removeCta?['cta' as const]:[])]);if(removeTitle)next.title='';if(removeCta)next.cta='';summary='移除指定的额外画面文案';}
 else if(narration&&scope.kind==='clips'){constraints=changeContract(['narration']);for(const c of targets){assert(c.narration,'NO_NARRATION','该镜头没有独立配音，请选择已有配音的镜头。',422);c.narration={text:narration[1],language:c.narration.language};}summary='仅修改选定镜头的配音文案';}
 else if(title){constraints=changeContract([],['title']);next.title=title[1];summary=`标题改为「${next.title}」`;}
 else if(cta){constraints=changeContract([],['cta']);next.cta=cta[1];summary=`结尾文案改为「${next.cta}」`;}
 else if(scope.kind==='global'&&caption){constraints=changeContract(['caption']);next.clips=next.clips.map(c=>({...c,caption:caption[1]}));summary='更新全片已有镜头的字幕';}
 else if(scope.kind==='clips'&&caption){constraints=changeContract(['caption']);for(const c of targets)c.caption=caption[1];summary='更新选定镜头的字幕';}
 else if(clip&&range){constraints=changeContract(['start_ms','end_ms']);clip.start_ms=Math.round(Number(range[1])*1000);clip.end_ms=Math.round(Number(range[2])*1000);summary=`第 ${index+1} 个镜头改为原片 ${range[1]}–${range[2]} 秒，保留完整关键动作`; }
 else if(clip&&/保留关键动作|修复关键动作/.test(command)){constraints=changeContract(['start_ms','end_ms']);const shot=resolveClipShot(clip,assets);const protect=shot&&protectedRange(shot);assert(protect,'KEY_ACTION_UNKNOWN','该镜头尚无经过确认的关键动作时间码，请先标注源片并重新规划',422);clip.start_ms=Math.min(clip.start_ms,protect[0]);clip.end_ms=Math.max(clip.end_ms,protect[1]);summary=`恢复第 ${index+1} 镜头的关键动作与收尾`; }
 else if(clip&&trim){constraints=changeContract(['end_ms']);clip.end_ms=clip.start_ms+Math.round(Number(trim[1])*1000);summary=`第 ${index+1} 个镜头缩短到 ${trim[1]} 秒`;}
 else if(scope.kind==='clips'&&/静音|去掉原声|关闭原声/.test(command)){constraints=changeContract(['audio_gain']);for(const c of targets)c.audio_gain=0;summary='关闭选定镜头的原声';}
 else if(scope.kind==='clips'&&/关闭字幕|不要字幕|去掉字幕|删除字幕/.test(command)){constraints=changeContract(['caption']);for(const c of targets)c.caption='';summary='移除选定镜头的字幕';}
 else if(scope.kind==='clips'&&/^(?:请)?(?:(?:删除|去掉)(?:第\s*\d+\s*(?:个)?(?:镜头|段)|最后(?:一|1)?(?:个)?(?:镜头|段))?|(?:第\s*\d+\s*(?:个)?(?:镜头|段)|最后(?:一|1)?(?:个)?(?:镜头|段))(?:删除|去掉))[。！!\s]*$/.test(command)){constraints=changeContract([],[],true);next.clips=next.clips.filter(c=>!scope.clip_ids.includes(c.id));summary='删除选定镜头';}
 else if(/^(?:请)?(?:全部)?(?:静音|去掉原声|关闭原声)[。！!\s]*$/.test(command)){constraints=changeContract([],['audio_gain']);next.audio_gain=0;summary='关闭全部原声音轨';}
 else if(volume){constraints=scope.kind==='clips'?changeContract(['audio_gain']):changeContract([],['audio_gain']);if(scope.kind==='clips')for(const c of targets)c.audio_gain=Number(volume[1])/100;else next.audio_gain=Number(volume[1])/100;summary=`${scope.kind==='clips'?'选定镜头':'全片'}原声音量设为 ${volume[1]}%`;}
 else if(/关闭字幕|不要字幕|去掉字幕/.test(command)){constraints=changeContract([],['subtitles']);next.subtitles=false;summary='关闭字幕';}
 else if(/开启字幕|显示字幕|恢复字幕/.test(command)){constraints=changeContract([],['subtitles']);next.subtitles=true;summary='显示已有字幕';}
 else if(modelAvailable()){constraints=modelChangeContract(feedback,scope);const r=await callModel('你是剪辑修改 Agent。只改用户明确提到的改动点。constraints 指定允许调整的字段及删除/顺序权限；即使在选定镜头内部，也不得改动其他字段、目的、音量或字幕。替换素材也保留原 clip.id。不做额外润色或整体优化。返回 {summary,edl}。scope 是已锁定的唯一修改范围，只能修改 scope.clip_ids 内的镜头，其他镜头字段和相对顺序必须逐字保留；不得扩大范围。保留未删除镜头的 clip.id。只有 constraints.global_fields 明确允许时才可修改 title、cta 或 subtitles，未明确要求时保持完全相同；不得将额外文案混入字幕。必须保留所有已标注 intent 的完整动作及前后余量，required 镜头不得遗漏。不能修改 locked=true 镜头或其时间线位置。替换片段仅来自给定素材证据。所有变化由用户二次确认。版本号由系统处理。不要生成新事实、台词或任意代码。', {feedback,scope,constraints,current_edl:current,shots:assets.flatMap(a=>a.shots)},PatchModel);next=r.edl;summary=r.summary;}
 else throw new AppError('FEEDBACK_NEEDS_MODEL','当前规则模式支持：「只保留字幕」「删除标题」「删除结尾文案」「第1镜头字幕改为：…」「第2段保留前2秒」「第6镜头取原片5秒到12秒」「第6镜头保留关键动作」「删除第3镜头」「原声音量50%」「静音」「关闭字幕」「CTA改为：…」。更复杂的修改请配置模型。',422);
 next.version=current.version+1;
 assertRevisionScope(current,next,scope);
 assertRequestedChanges(current,next,constraints);
 next=validateEDL(next,assets,current);
 assert(JSON.stringify({...next,version:current.version})!==JSON.stringify(current),'NO_CHANGE','修改未产生变化');
 const regions=revisionRegions(current,next);
 return {id:randomUUID(),base_version:current.version,feedback:originalFeedback,summary,edl:next,scope,regions,constraints,changes:describeChanges(current,next,assets),affected_ranges:regions.map(r=>r.before_range),requires_confirmation:true,created_at:new Date().toISOString()};
}
