import {z} from 'zod';
import type {RecipeId} from './recipes.js';
import type {SkillExample} from './skill-examples.js';
import {douyinSkillExamples} from './douyin-skill-examples.js';

export const SkillIdSchema=z.enum(['auto','viral_remake','same_rhythm','strong_hook','story_recut','speech_trim','ugc_native','review_recut','comment_reply','product_highlight','beat_showcase','functional_demo','product_unboxing','product_comparison','offer_ad','multi_montage','creator_montage','broll','highlight_reel','kinetic_captions','fast_cut','music_beats','benefit_pack','live_to_ad','long_to_short','tvc_to_ugc','tutorial_to_ad','hook_variants','benefit_variants','audience_variants','ten_versions','tiktok_adapt','multi_size','video_translate','overseas_recut']);
export type SkillId=z.infer<typeof SkillIdSchema>;
export const workflowSkillIds:SkillId[]=['viral_remake','same_rhythm','speech_trim','comment_reply','beat_showcase','broll','kinetic_captions','music_beats','live_to_ad','tvc_to_ugc','hook_variants','benefit_variants','audience_variants','ten_versions','multi_size','video_translate','overseas_recut'];
export const isWorkflowSkill=(id:SkillId|undefined)=>!!id&&workflowSkillIds.includes(id);

export const skillCategories=[
 {id:'recut',name:'爆款重剪',description:'换一种讲法，重新抓住注意'},
 {id:'speech',name:'口播带货',description:'让真人表达更有说服力'},
 {id:'product',name:'商品展示',description:'把产品的价值拍明白、剪清楚'},
 {id:'montage',name:'素材混剪',description:'让分散的素材成为一条作品'},
 {id:'packaging',name:'节奏包装',description:'用节奏和信息层次强化记忆'},
 {id:'conversion',name:'类型转换',description:'把已有内容变成广告素材'},
 {id:'variants',name:'素材裂变',description:'一个创意，探索多种表达'},
 {id:'localization',name:'平台 / 本地化',description:'适配不同平台与市场'},
] as const;
export type SkillCategory=typeof skillCategories[number]['id'];
export interface EditingSkill {id:Exclude<SkillId,'auto'>;name:string;category:SkillCategory;description:string;recipe:RecipeId;behavior:'narrative'|'montage'|'highlight'|'fast'|'portrait';needs:string;unavailable?:string;examples?:{label:string;example:SkillExample}[];example:SkillExample;exampleNote:string}
// References show an observable result. They are never imported as the advertiser's source footage.
const add=(id:EditingSkill['id'],name:string,category:SkillCategory,description:string,recipe:RecipeId,example:SkillExample,exampleNote:string,options:Partial<Pick<EditingSkill,'behavior'|'needs'|'unavailable'>>={}):EditingSkill=>({id,name,category,description,recipe,example,exampleNote,behavior:'narrative',needs:'先在素材库确认相关镜头的用途与关键动作。',...options});
export const editingSkills:EditingSkill[]=[
 add('viral_remake','爆款复刻','recut','参考一条喜欢的广告，用自己的素材重现叙事结构。','auto',douyinSkillExamples.viral_remake,douyinSkillExamples.viral_remake.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('same_rhythm','同款节奏','recut','参照样片的切换速度与停留，重排自己的素材。','auto',douyinSkillExamples.same_rhythm,douyinSkillExamples.same_rhythm.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('strong_hook','强 Hook 重剪','recut','把有依据的问题放在开头，用演示迅速回应。','pain_solution',douyinSkillExamples.strong_hook,douyinSkillExamples.strong_hook.description),
 add('story_recut','故事线重剪','recut','按场景、行动、结果，讲完一个小故事。','story',douyinSkillExamples.story_recut,douyinSkillExamples.story_recut.description),
 add('speech_trim','口播去废话','speech','去掉重复和停顿，保留完整观点。','auto',douyinSkillExamples.speech_trim,douyinSkillExamples.speech_trim.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('ugc_native','UGC 原生化','speech','以真实评价为主线，用使用画面补充依据。','testimonial',douyinSkillExamples.ugc_native,douyinSkillExamples.ugc_native.description),
 add('review_recut','测评重剪','speech','先讲体验观点，再给出能支持观点的实测。','testimonial',douyinSkillExamples.review_recut,douyinSkillExamples.review_recut.description),
 add('comment_reply','评论回复','speech','围绕一条用户问题，用讲解和演示作答。','pain_solution',douyinSkillExamples.comment_reply,douyinSkillExamples.comment_reply.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('product_highlight','商品高光','product','以产品细节吸引注意，完整保留使用体验。','detail',douyinSkillExamples.product_highlight,douyinSkillExamples.product_highlight.description),
 add('beat_showcase','卡点展示','product','让产品亮相和切镜落在音乐节拍上。','detail',douyinSkillExamples.beat_showcase,douyinSkillExamples.beat_showcase.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('functional_demo','功能演示','product','保留关键操作和最终效果，让功能一看就懂。','demo',douyinSkillExamples.functional_demo,douyinSkillExamples.functional_demo.description),
 add('product_unboxing','开箱','product','从拆封到亮相，再到第一次上手。','unboxing',douyinSkillExamples.product_unboxing,douyinSkillExamples.product_unboxing.description),
 add('product_comparison','前后对比','product','用同一对象的前后变化说明效果。','before_after',douyinSkillExamples.product_comparison,douyinSkillExamples.product_comparison.description),
 add('offer_ad','优惠促销','product','先讲清已有活动，再展示产品与购买理由。','offer',douyinSkillExamples.offer_ad,douyinSkillExamples.offer_ad.description),
 add('multi_montage','多素材混剪','montage','从多份素材中选段，按素材顺序串成一条视频。','auto',douyinSkillExamples.multi_montage,douyinSkillExamples.multi_montage.description,{behavior:'montage',needs:'至少两份原始视频。'}),
 add('creator_montage','达人混剪','montage','组合多位使用者的完整评价，再补充使用画面。','testimonial',douyinSkillExamples.creator_montage,douyinSkillExamples.creator_montage.description,{needs:'至少两份含原声和已确认逐字稿的评价素材，以及使用画面。'}),
 add('broll','B-roll 补剪','montage','保留口播声音，用相关细节画面覆盖空镜。','testimonial',douyinSkillExamples.broll,douyinSkillExamples.broll.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('highlight_reel','高光合集','montage','优先选择你标注的重要片段，保留完整动作。','auto',douyinSkillExamples.highlight_reel,douyinSkillExamples.highlight_reel.description,{behavior:'highlight',needs:'先为重点镜头确认动作区间与优先级。'}),
 add('kinetic_captions','爆款字幕','packaging','让口播字幕更醒目，以轻动效强化阅读节奏。','auto',douyinSkillExamples.kinetic_captions,douyinSkillExamples.kinetic_captions.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('fast_cut','高燃快剪','packaging','压缩铺垫，增加切换，同时保留关键动作。','auto',douyinSkillExamples.fast_cut,douyinSkillExamples.fast_cut.description,{behavior:'fast',needs:'可选段落尽量控制在 3 秒内，完整动作优先。'}),
 add('music_beats','音乐卡点','packaging','按选定音乐的节拍安排画面切换。','auto',douyinSkillExamples.music_beats,douyinSkillExamples.music_beats.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('benefit_pack','卖点包装','packaging','一段讲清一个卖点，用真实演示支撑。','benefits',douyinSkillExamples.benefit_pack,douyinSkillExamples.benefit_pack.description),
 add('live_to_ad','直播转广告','conversion','从直播里选出讲解、演示和成交理由。','auto',douyinSkillExamples.live_to_ad,douyinSkillExamples.live_to_ad.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('long_to_short','长视频转短广告','conversion','按你标注的重点压缩内容，控制在目标时长内。','auto',douyinSkillExamples.long_to_short,douyinSkillExamples.long_to_short.description,{behavior:'highlight',needs:'先在长素材上标注重点区间及优先级。'}),
 add('tvc_to_ugc','TVC 转 UGC','conversion','把品牌片重新组织为更自然的体验分享。','testimonial',douyinSkillExamples.tvc_to_ugc,douyinSkillExamples.tvc_to_ugc.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('tutorial_to_ad','教程转广告','conversion','减少准备，突出关键步骤与完成效果。','demo',douyinSkillExamples.tutorial_to_ad,douyinSkillExamples.tutorial_to_ad.description),
 add('hook_variants','Hook 裂变','variants','保留主体内容，尝试不同开场。','auto',douyinSkillExamples.hook_variants,douyinSkillExamples.hook_variants.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('benefit_variants','卖点裂变','variants','围绕不同卖点分别生成广告版本。','benefits',douyinSkillExamples.benefit_variants,douyinSkillExamples.benefit_variants.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('audience_variants','人群裂变','variants','针对不同人群，调整场景与购买理由。','auto',douyinSkillExamples.audience_variants,douyinSkillExamples.audience_variants.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('ten_versions','一条变十条','variants','组合不同开场和镜头顺序，生成十个不同版本。','auto',douyinSkillExamples.ten_versions,douyinSkillExamples.ten_versions.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('tiktok_adapt','TikTok 适配','localization','将已有内容输出为竖屏，保留完整画面和原声。','auto',douyinSkillExamples.tiktok_adapt,douyinSkillExamples.tiktok_adapt.description,{behavior:'portrait',needs:'默认竖屏 9:16；使用留边适配，避免裁掉主体。'}),
 add('multi_size','多尺寸','localization','一次输出适合不同版位的多种画幅。','auto',douyinSkillExamples.multi_size,douyinSkillExamples.multi_size.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('video_translate','视频翻译','localization','替换配音与字幕，让内容被另一种语言理解。','auto',douyinSkillExamples.video_translate,douyinSkillExamples.video_translate.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
 add('overseas_recut','海外版重剪','localization','按目标市场调整表达、节奏与信息。','auto',douyinSkillExamples.overseas_recut,douyinSkillExamples.overseas_recut.description,{needs:'选择后填写所需选项，Agent 会检查素材并生成可确认的方案。'}),
];
export const getSkill=(id:SkillId|undefined)=>editingSkills.find(s=>s.id===id);
export const skillName=(id:SkillId|undefined)=>getSkill(id)?.name||'自动匹配';
export const legacySkill:Record<Exclude<RecipeId,'auto'>,SkillId>={pain_solution:'strong_hook',demo:'functional_demo',testimonial:'ugc_native',before_after:'product_comparison',unboxing:'product_unboxing',detail:'product_highlight',story:'story_recut',benefits:'benefit_pack',offer:'offer_ad'};
export function resolveSkillId(value:unknown):SkillId|undefined {const parsed=SkillIdSchema.safeParse(value);return parsed.success?parsed.data:typeof value==='string'&&Object.hasOwn(legacySkill,value)?legacySkill[value as keyof typeof legacySkill]:undefined;}
