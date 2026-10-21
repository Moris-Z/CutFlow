import { z } from 'zod';
import {SkillIdSchema,type SkillId} from './skills.js';
import { RecipeIdSchema, type AdRole, type RecipeMatch } from './recipes.js';
export const ScenarioSchema=z.enum(['montage','talking_head','highlight','scripted','beat']);
export type Scenario=z.infer<typeof ScenarioSchema>;
export const BgmPreferenceSchema=z.object({mode:z.enum(['default','track']).default('default'),track_id:z.string().max(100).optional(),gain:z.number().min(0.05).max(1).default(0.5),start_ms:z.number().int().min(0).max(1200000).default(0),ducking:z.boolean().default(true)});
export type BgmPreference=z.infer<typeof BgmPreferenceSchema>;
export const BgmSchema=z.object({track_id:z.string(),sha256:z.string(),title:z.string(),author:z.string(),license:z.string(),license_url:z.string(),source_url:z.string(),attribution:z.string(),gain:z.number().min(0.05).max(1),start_ms:z.number().int().nonnegative(),ducking:z.boolean()});
export type Bgm=z.infer<typeof BgmSchema>;
export interface MusicTrack {deleted_at?:string;id:string;title:string;author:string;tags:string[];duration_ms:number;sha256:string;file_path:string;url:string;license:string;license_url:string;source_url:string;attribution:string;origin:'builtin'|'upload';}
export interface MusicReference {title:string;author:string;period:string;source_url:string;}
export interface MusicLibrary {tracks:MusicTrack[];references:MusicReference[];default_bgm_id:string;}
export const SkillOptionsSchema=z.object({variant_topics:z.string().max(1200).optional(),reference_asset_id:z.string().max(100).optional(),comment:z.string().trim().max(500).optional(),target_language:z.enum(['zh','en','ja','es','fr']).optional(),market:z.string().trim().max(100).optional(),variants:z.array(z.string().trim().min(1).max(100)).min(2).max(10).optional()});
export const BriefSchema=z.object({skill_options:SkillOptionsSchema.optional(),bgm:BgmPreferenceSchema.optional(),request:z.string().min(1).max(8000),skill_id:SkillIdSchema.optional(),recipe:RecipeIdSchema.default('auto'),scenario:ScenarioSchema.default('montage'),product:z.string().max(120).default(''),audience:z.string().max(300).default(''),platform:z.string().max(60).default('抖音'),duration_ms:z.number().int().min(2000).max(180000).default(30000),aspect_ratio:z.enum(['9:16','16:9','1:1']).default('9:16'),resolution:z.enum(['720p','1080p']).default('1080p'),fps:z.literal(30).default(30),cta:z.string().max(100).default(''),allow_text_overlays:z.boolean().default(false),style:z.string().max(300).default('节奏紧凑，突出核心信息'),subtitles:z.boolean().default(false)});
export type Brief=z.infer<typeof BriefSchema>;
export interface Evidence {type:'metadata'|'user_annotation'|'model_vision'|'model_audio'|'demo';description:string;confidence:number}
export const ShotIntentSchema=z.object({message:z.string().trim().min(1).max(500),key_action:z.string().trim().min(1).max(300),action_start_ms:z.number().int().nonnegative(),action_end_ms:z.number().int().positive(),pre_roll_ms:z.number().int().min(0).max(10000).default(0),post_roll_ms:z.number().int().min(0).max(10000).default(0),priority:z.number().int().min(1).max(5).default(3),required:z.boolean().default(true),evidence:z.object({description:z.string().trim().min(1).max(1500),observed_at_ms:z.array(z.number().int().nonnegative()).min(2).max(100)})});
export type ShotIntent=z.infer<typeof ShotIntentSchema>;
export interface Shot {id:string;asset_id:string;start_ms:number;end_ms:number;summary:string;transcript?:string;evidence:Evidence;intent?:ShotIntent;ad_roles?:AdRole[];comparison_group?:string}
export interface Asset {source?:{usage?:'stock_license'|'publisher_reference'|'enterprise_reference';provider:string;url:string;license_url:string;description:string;retrieved_at:string};deleted_at?:string;id:string;name:string;file_path:string;url:string;thumbnail_url:string;duration_ms:number;width:number;height:number;fps:number;has_audio:boolean;sha256:string;created_at:string;shots:Shot[];warnings:string[]}
export interface SourceReference {provider:'Feishu'|'Douyin';title:string;url:string;document_url?:string}
export interface SearchSourceReport {provider:string;status:'ok'|'error'|'needs_auth'|'skipped';found:number;references_found?:number;message?:string}
export interface SourceSearchJob {references?:SourceReference[];sources?:SearchSourceReport[];id:string;status:'searching'|'ready'|'failed';subject?:string;kind?:'game'|'general';needs_details?:boolean;message:string;query:string[];assets:Asset[];warnings:string[];created_at:string}
export const ClipSchema=z.object({caption_offset_ms:z.number().int().nonnegative().max(180000).optional(),narration:z.object({offset_ms:z.number().int().nonnegative().optional(),full_duration_ms:z.number().int().positive().max(180000).optional(),text:z.string().min(1).max(500),language:z.enum(['zh','en','ja','es','fr'])}).optional(),audio_source:z.object({asset_id:z.string(),start_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive()}).optional(),id:z.string().min(1),asset_id:z.string().min(1),shot_id:z.string().min(1).optional(),start_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive(),purpose:z.string().max(500),caption:z.string().max(180).default(''),audio_gain:z.number().min(0).max(2).optional(),evidence:z.object({type:z.enum(['metadata','user_annotation','model_vision','model_audio','demo']),description:z.string().max(2000),confidence:z.number().min(0).max(1)}),locked:z.boolean().default(false)});
export type Clip=z.infer<typeof ClipSchema>;
export const EDLSchema=z.object({caption_style:z.enum(['plain','emphasis']).optional(),bgm:BgmSchema.optional(),schema_version:z.literal('1.0'),version:z.number().int().positive(),clips:z.array(ClipSchema).min(1).max(60),aspect_ratio:z.enum(['9:16','16:9','1:1']),resolution:z.enum(['720p','1080p']),fps:z.literal(30),title:z.string().max(100).default(''),cta:z.string().max(100).default(''),audio_gain:z.number().min(0).max(2).default(1),subtitles:z.boolean().default(false)});
export type EDL=z.infer<typeof EDLSchema>;
export interface EditorialReview {status:'protected'|'needs_review';items:{clip_id:string;shot_id?:string;status:'protected'|'unverified';message:string}[]}
export interface TextPlanReview {required:boolean;candidate_digest:string;base_digest?:string;approved_digest?:string;approved_at?:string}
export interface RevisionChanges {clip_fields:(keyof Clip)[];global_fields:(keyof EDL)[];allow_delete:boolean;allow_reorder:boolean}
export interface TextChange {target:string;field:string;before:string;after:string}
export interface Plan {skill?:{id:SkillId;name:string;status:'applied'|'needs_material';details:string[]};text_review?:TextPlanReview;summary:string;strategy:string[];risks:string[];mode:'rules'|'model';edl:EDL;assumptions:string[];created_at:string;editorial_review?:EditorialReview;recipe_match?:RecipeMatch}
export interface QAIssue {code:string;severity:'error'|'warning';message:string;time_range?:[number,number];evidence:string;repairability:'human_review'|'deterministic_safe'}
export interface QAReport {passed:boolean;checks:{name:string;status:'pass'|'fail'|'manual';detail:string}[];issues:QAIssue[];checked_at:string}
export interface Artifact {kind:'preview'|'final'|'cover'|'subtitles'|'edl'|'manifest'|'trace'|'music_credits';url:string;path:string;sha256?:string;version:number}
export interface RenderResult {video_path:string;cover_path:string;subtitle_path:string;duration_ms:number;width:number;height:number;fps:number;sha256:string;cache_hits:number;renderer:string}
export interface RevisionScope {kind:'clips'|'global';clip_ids:string[];basis:string;allowed_globals?:('title'|'cta')[]}
export interface PatchRegion {id:string;before_range:[number,number];after_range:[number,number];before_preview_range:[number,number];after_preview_range:[number,number];clip_ids:string[]}
export interface PatchPreviewMedia {url:string;sha256:string;duration_ms:number;qa:QAReport}
export interface PatchPreview {id:string;status:'queued'|'rendering'|'ready'|'failed'|'cancelled';progress:number;base_digest:string;candidate_digest:string;regions:(PatchRegion & {before?:PatchPreviewMedia;after?:PatchPreviewMedia})[];error?:string;created_at:string}
export interface Patch {text_review?:TextPlanReview;changes?:TextChange[];constraints?:RevisionChanges;id:string;base_version:number;feedback:string;summary:string;edl:EDL;affected_ranges:[number,number][];scope?:RevisionScope;regions?:PatchRegion[];preview?:PatchPreview;requires_confirmation:boolean;created_at:string}
export type TaskState='DRAFT_BRIEF'|'WAITING_PLAN_APPROVAL'|'COMPILING'|'RENDERING_PREVIEW'|'QUALITY_CHECKING'|'WAITING_USER_REVIEW'|'REVISING'|'RENDERING_FINAL'|'DELIVERED'|'FAILED'|'CANCELLED';
export interface Version {version:number;edl:EDL;reason:string;created_at:string;qa?:QAReport}
export interface TraceEvent {id:string;at:string;stage:string;type:string;message:string;data?:Record<string,unknown>}
export interface Preparation {references?:SourceReference[];sources?:SearchSourceReport[];status:'queued'|'searching'|'planning'|'needs_input'|'ready';message:string;search_job_id?:string;messages:{id:string;role:'user'|'assistant';text:string}[]}
export interface Task {preparation?:Preparation;variant_group?:{id:string;index:number;count:number;label:string};deleted_at?:string;id:string;name:string;state:TaskState;brief:Brief;asset_ids:string[];asset_shots?:Record<string,Shot[]>;plan?:Plan;edl?:EDL;versions:Version[];pending_patch?:Patch;plan_approved_version?:number;preview_approved_version?:number;qa?:QAReport;artifacts:Artifact[];events:TraceEvent[];progress:number;error?:{code:string;message:string;retryable:boolean;stage:string};created_at:string;updated_at:string;is_demo:boolean;validated_trace:boolean}
export interface Settings {default_bgm_id?:string;confirm_text_plan:boolean;model_configured:boolean;model_name:string;model_base_url:string;renderer:string;capabilities:{id:string;name:string;status:'ready'|'requires_model'|'planned';description:string}[]}
export const durationOf=(edl:EDL)=>edl.clips.reduce((s,c)=>s+c.end_ms-c.start_ms,0);

export type TrashKind='tasks'|'assets'|'music';
export interface TrashItem {kind:TrashKind;id:string;name:string;deleted_at:string;}

export interface SourceConnection {id:'feishu'|'douyin';name:string;enabled:boolean;status:'ready'|'needs_auth'|'unavailable'|'error'|'disabled'|'pending_connection';message:string;url?:string}
