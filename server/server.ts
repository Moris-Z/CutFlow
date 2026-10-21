import express,{type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import { z } from 'zod';
import path from 'node:path';
import type {EDL} from '../shared/types.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync,existsSync } from 'node:fs';
import { readFile,unlink } from 'node:fs/promises';
import { Store,addEvent } from './store.js';
import { AppError,assert } from './errors.js';
import { settings,updateSettings } from './settings.js';
import { Harness,newTask,publicAsset,publicTask,snapshot,traceRecord } from './harness.js';
import {planSkillWorkflow} from './skill-workflows.js';
import { normalizeBrief,createPlan,createPatch,validateEDL } from './planner.js';
import { ingestVideo,generateDemoAssets } from './media.js';
import { approveTextReview, assertTextReview, textReview, assertRequestedChanges } from './revision-changes.js';
import { assertPatchPreviewApproved, assertRevisionScope } from './revisions.js';
import { proposeActionAnalysis } from './action-analysis.js';
import { callModel } from './model.js';
import { AdRoleSchema } from '../shared/recipes.js';
import { BriefSchema,BgmPreferenceSchema,ShotIntentSchema,type Shot } from '../shared/types.js';
import {installMusic,musicReferences,importMusic,resolveBgm,musicPath,musicPatch} from './music.js';
import {SourceSearch,type SearchDependencies} from './source-search.js';
import {EnterpriseSources,type CliRunner} from './enterprise-sources.js';
import {DouyinSource} from './douyin-source.js';
import {ProjectPreparation,reply} from './preparation.js';
import {searchIntent} from './search-intent.js';
export function createApp(root:string,dependencies:{search?:SearchDependencies;larkCli?:CliRunner;douyinFetch?:typeof fetch}={}){
 const store=new Store(root);store.recover();const mediaRoot=path.join(root,'media');const assetsDir=path.join(mediaRoot,'assets');const uploadDir=path.join(root,'uploads');mkdirSync(assetsDir,{recursive:true});mkdirSync(uploadDir,{recursive:true});
 installMusic(store);
 const harness=new Harness(store,mediaRoot);const app=express();app.disable('x-powered-by');
 const enterprise=new EnterpriseSources(root,dependencies.larkCli);
 const douyin=new DouyinSource(root,dependencies.douyinFetch);
 const enterpriseSearch={discoverEnterprise:(subject:string)=>enterprise.discover(subject),discoverDouyin:(subject:string)=>douyin.discover(subject),downloadEnterprise:enterprise.download.bind(enterprise)};
 const sourceSearch=new SourceSearch(store,path.join(root,'source-search'),dependencies.search?{...dependencies.search}:enterpriseSearch);
 const preparation=new ProjectPreparation(store,sourceSearch,planTask);
 const shareMode=process.env.CUTFLOW_SHARE_MODE==='1';
 app.use((req,res,next)=>{const host=req.hostname;const local=['127.0.0.1','localhost','[::1]'].includes(host);const publicHost=shareMode&&(/^[a-z0-9-]+\.trycloudflare\.com$/.test(host)||/^[a-z0-9-]+\.loca\.lt$/.test(host));if(!local&&!publicHost)return res.status(403).json({error:{code:'LOCAL_ONLY',message:'仅接受本机请求'}});const origin=req.headers.origin;if(origin){try{const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||!(local?['127.0.0.1','localhost','[::1]'].includes(url.hostname):url.protocol==='https:'&&url.hostname===host))throw Error();}catch{return res.status(403).json({error:{code:'ORIGIN_REJECTED',message:'不接受外部网站请求'}});}}res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');next();});
 app.use(express.json({limit:'2mb'}));
 app.use('/media',express.static(mediaRoot,{dotfiles:'deny',setHeaders:(res,file)=>{if(/\.(json|srt)$/.test(file))res.setHeader('Content-Disposition','attachment');}}));
 app.get('/api/source-connections',async(_req,res)=>res.json([await enterprise.larkStatus(),await douyin.status()]));
 app.post('/api/source-connections/douyin',async(req,res)=>{const data=z.object({api_key:z.string().trim().min(12).max(512)}).strict().parse(req.body);res.json(await douyin.configure(data.api_key));});
 app.post('/api/source-connections/douyin/check',async(_req,res)=>res.json(await douyin.check()));
 app.post('/api/source-connections',async(req,res)=>{const data=z.object({feishu_enabled:z.boolean()}).strict().parse(req.body);await enterprise.setEnabled(data.feishu_enabled);res.json(await enterprise.status());});
 app.get('/api/health',(_req,res)=>res.json({ok:true}));
 app.post('/api/source-search',async(req,res)=>{const body=z.object({request:z.string().trim().min(1).max(8000),product:z.string().max(120).default('')}).parse(req.body);res.status(202).json(await sourceSearch.start(body.request,body.product));});
 app.get('/api/source-search/:id',async(req,res)=>res.json(await sourceSearch.get(req.params.id)));
 const platformSettings=()=>({...settings(),confirm_text_plan:store.confirmTextPlan(),default_bgm_id:store.defaultBgmId()});
 app.get('/api/settings',(_req,res)=>res.json(platformSettings()));
 app.post('/api/settings',(req,res)=>{if(req.body.default_bgm_id!==undefined)assert(typeof req.body.default_bgm_id==='string'&&store.musicTracks().some(t=>t.id===req.body.default_bgm_id),'BGM_NOT_FOUND','默认配乐不存在',422);updateSettings(req.body);if(req.body.default_bgm_id!==undefined)store.setDefaultBgmId(req.body.default_bgm_id);if(req.body.confirm_text_plan!==undefined)store.setConfirmTextPlan(req.body.confirm_text_plan);res.json(platformSettings());});
 app.get('/api/music',(_req,res)=>res.json({tracks:store.musicTracks().map(t=>({...t,file_path:''})),references:musicReferences(),default_bgm_id:store.defaultBgmId()}));
 const musicUpload=multer({dest:uploadDir,limits:{fileSize:(shareMode?20:100)*1024*1024,files:1},fileFilter:(_req,file,cb)=>{if(!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname))return cb(new AppError('UNSUPPORTED_MUSIC','请上传 MP3、WAV、M4A、AAC、OGG 或 FLAC 音频'));cb(null,true);}});
 app.post('/api/music',musicUpload.single('file'),async(req,res)=>{
  assert(req.file,'NO_FILE','请选择配乐文件');
  try{
   const b=z.object({title:z.string().trim().max(120).default(''),author:z.string().trim().max(120).default(''),source_url:z.union([z.string().url().refine(v=>/^https?:\/\//.test(v)),z.literal('')]).default(''),license_note:z.string().trim().max(2000).optional()}).parse(req.body);
   const track=await importMusic(store,req.file.path,req.file.originalname,b);res.status(201).json({...track,file_path:''});
  }finally{await unlink(req.file.path);}
 });
 app.post('/api/tasks/:id/bgm',(req,res)=>{
  const b=z.object({version:z.number().int().nonnegative(),bgm:BgmPreferenceSchema}).parse(req.body),t=harness.get(req.params.id);harness.idle(t);preparation.idle(t);
  assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前修改',409);
  assert((t.edl?.version??0)===b.version,'STALE_VERSION','版本已变化，请刷新',409);
  const bgm=resolveBgm(store,b.bgm);
  if(!t.edl){t.brief.bgm=b.bgm;return res.json(publicTask(store.save(t)));}
  assert(['WAITING_PLAN_APPROVAL','WAITING_USER_REVIEW','DELIVERED','FAILED','CANCELLED'].includes(t.state),'INVALID_STATE','请等待当前操作完成',409);
  const confirmation=store.confirmTextPlan();
  if(t.state==='WAITING_PLAN_APPROVAL'&&t.plan_approved_version!==t.edl.version){
   const edl=validateEDL({...structuredClone(t.edl),version:t.edl.version+1,bgm},harness.assets(t),t.edl);
   snapshot(t,edl,`首版方案设置配乐 ${bgm.title}`);t.brief.bgm=b.bgm;
   if(t.plan){t.plan.edl=structuredClone(edl);t.plan.text_review=textReview(edl,confirmation);t.plan.assumptions=t.plan.assumptions.filter(a=>!a.includes('配乐'));t.plan.assumptions.push(`配乐：${bgm.title}，循环铺满全片并淡入淡出。`);}
   t.state='WAITING_PLAN_APPROVAL';addEvent(t,'plan.music.updated','首版文字方案已更新配乐，仍需确认完整镜头安排');
   if(!confirmation){t.plan_approved_version=edl.version;return res.json(publicTask(harness.enqueue(t,'preview')));}
   return res.json(publicTask(store.save(t)));
  }
  t.pending_patch=musicPatch(t.edl,bgm,harness.assets(t));t.pending_patch.text_review=textReview(t.pending_patch.edl,confirmation,t.edl);
  addEvent(t,'patch.music.proposed',t.pending_patch.summary,{patch_id:t.pending_patch.id,changes:t.pending_patch.changes});
  res.json(publicTask(confirmation?store.save(t):harness.enqueuePatchPreview(t)));
 });
 app.get('/api/assets',(req,res)=>res.json(store.assets(req.query.include_deleted==='true').map(publicAsset)));
 const upload=multer({dest:uploadDir,limits:{fileSize:(shareMode?100:1024)*1024*1024,files:shareMode?5:12},fileFilter:(_req,file,cb)=>{if(!/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.originalname))return cb(new AppError('UNSUPPORTED_FILE','请上传 MP4、MOV、WEBM 或 MKV 视频'));cb(null,true);}});
 app.post('/api/assets',upload.array('files',shareMode?5:12),async(req,res)=>{const files=(req.files as Express.Multer.File[])||[];assert(files.length,'NO_FILES','请选择视频文件');const imported=[];try{for(const file of files){const asset=await ingestVideo(file.path,file.originalname,assetsDir);const previous=store.asset(asset.id);if(previous?.deleted_at)store.setDeleted('assets',asset.id,false);imported.push(publicAsset(previous?store.asset(asset.id)!:store.saveAsset(asset)));}res.json(imported);}finally{await Promise.allSettled(files.map(f=>unlink(f.path)));}});
 app.put('/api/assets/:id/shots',(req,res)=>{const asset=store.asset(req.params.id);assert(asset&&!asset.deleted_at,'ASSET_NOT_FOUND','素材不存在',404);const schema=z.object({shots:z.array(z.object({id:z.string().optional(),asset_id:z.string().optional(),start_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive(),summary:z.string().max(2000),transcript:z.string().max(180).optional(),intent:ShotIntentSchema.optional(),ad_roles:z.array(AdRoleSchema).max(11).optional(),comparison_group:z.string().trim().max(100).optional(),evidence:z.unknown().optional()})).min(1).max(100)});const {shots}=schema.parse(req.body);asset.shots=shots.map(s=>{assert(s.end_ms>s.start_ms&&s.end_ms<=asset.duration_ms,'INVALID_SHOT_RANGE','标注区间必须位于素材时长内');if(s.intent){const i=s.intent;assert(i.action_end_ms>i.action_start_ms&&i.action_start_ms-i.pre_roll_ms>=s.start_ms&&i.action_end_ms+i.post_roll_ms<=s.end_ms,'INVALID_INTENT_RANGE','关键动作及起势、收尾必须完整位于标注区间内');assert(new Set(i.evidence.observed_at_ms).size>=2&&i.evidence.observed_at_ms.every(t=>t>=s.start_ms&&t<=s.end_ms)&&Math.min(...i.evidence.observed_at_ms)<=i.action_start_ms&&Math.max(...i.evidence.observed_at_ms)>=i.action_end_ms,'INVALID_INTENT_EVIDENCE','动作证据需至少两个不同的源片时间点，并覆盖关键动作开始与结束');}return {id:s.id||randomUUID(),asset_id:asset.id,start_ms:s.start_ms,end_ms:s.end_ms,summary:s.summary,transcript:s.transcript,ad_roles:s.ad_roles,comparison_group:s.comparison_group,...(s.intent?{intent:s.intent}:{}),evidence:{type:'user_annotation',description:'用户提供的时间码、画面描述与字幕',confidence:1}};});assert(new Set(asset.shots.map(s=>s.id)).size===asset.shots.length,'DUPLICATE_SHOT','标注 ID 不能重复');res.json(publicAsset(store.saveAsset(asset)));});
 app.post('/api/assets/:id/analyze',async(req,res)=>{const asset=store.asset(req.params.id);assert(asset&&!asset.deleted_at,'ASSET_NOT_FOUND','素材不存在',404);const thumbnail=path.join(assetsDir,asset.id,'thumbnail.jpg');const bytes=await readFile(thumbnail);const result=await callModel('描述这张视频采样缩略图中可直接观察到的画面。不要猜测整段情节、人物身份、对白、产品效果或时间点。返回 {summary:string,confidence:number}。只描述图中可见内容，无法确定写 unknown。',{name:asset.name,sampling:'单张缩略图，不能证明整个素材的内容'},z.object({summary:z.string().max(1500),confidence:z.number().min(0).max(1)}),[`data:image/jpeg;base64,${bytes.toString('base64')}`]);const current=store.asset(asset.id)!;current.shots=current.shots.map(s=>s.evidence.type==='user_annotation'?s:{...s,summary:`采样帧：${result.summary}`,evidence:{type:'model_vision',description:'单张缩略图视觉判断；整段内容尚未验证',confidence:result.confidence}});current.warnings=[...new Set([...current.warnings,'视觉分析仅依据一张缩略图，未识别音频、连续动作或精确事件时间。'])];res.json(publicAsset(store.saveAsset(current)));});
 app.post('/api/assets/:id/analyze-actions',async(req,res)=>{const asset=store.asset(req.params.id);assert(asset&&!asset.deleted_at,'ASSET_NOT_FOUND','素材不存在',404);res.json(await proposeActionAnalysis(asset,assetsDir));});
 app.get('/api/trash',(_req,res)=>res.json(store.trash()));
 app.delete('/api/tasks/:id',(req,res)=>{const t=harness.get(req.params.id);harness.idle(t);preparation.idle(t);store.setDeleted('tasks',t.id,true);res.json({ok:true});});
 app.delete('/api/assets/:id',(req,res)=>{const a=store.asset(req.params.id);assert(a&&!a.deleted_at,'ASSET_NOT_FOUND','素材不存在',404);store.setDeleted('assets',a.id,true);res.json({ok:true});});
 app.delete('/api/music/:id',(req,res)=>{const m=store.musicTrack(req.params.id);assert(m&&!m.deleted_at,'BGM_NOT_FOUND','配乐不存在',404);assert(m.origin==='upload','BUILTIN_MUSIC','内置配乐不可删除',409);store.setDeleted('music',m.id,true);res.json({ok:true,default_bgm_id:store.defaultBgmId()});});
 app.post('/api/trash/:kind/:id/restore',(req,res)=>{const kind=z.enum(['tasks','assets','music']).parse(req.params.kind);assert(store.trash().some(t=>t.kind===kind&&t.id===req.params.id),'TRASH_NOT_FOUND','此项已恢复或不存在，请刷新',404);store.setDeleted(kind,req.params.id,false);res.json({ok:true});});
 app.get('/api/tasks',(_req,res)=>res.json(store.tasks().map(publicTask)));
 app.post('/api/tasks',(req,res)=>{const body=z.object({name:z.string().max(100).optional(),brief:BriefSchema,asset_ids:z.array(z.string()).max(12).default([]),prepare:z.boolean().default(false)}).parse(req.body);assert(new Set(body.asset_ids).size===body.asset_ids.length,'DUPLICATE_ASSET','同一素材无需重复添加');for(const id of body.asset_ids)assert(store.asset(id)&&!store.asset(id)!.deleted_at,'ASSET_NOT_FOUND','所选素材已删除，请重新选择');if(body.brief.bgm)resolveBgm(store,body.brief.bgm);const intent=searchIntent(body.brief.request,body.brief.product);const task=newTask(normalizeBrief(body.brief),body.asset_ids,body.name||[intent.subject||'新建','广告视频'].join(' · '));task.asset_shots=Object.fromEntries(body.asset_ids.map(id=>[id,structuredClone(store.asset(id)!.shots)]));addEvent(task,'brief.created','已结构化剪辑需求',{brief:task.brief,sources:{request:'user',delivery:'user_form_or_explicit_request',defaults:'platform=抖音, duration=30s, aspect=9:16, fps=30'},asset_snapshot:harness.assets(task).map(a=>({id:a.id,sha256:a.sha256,shots:a.shots}))});res.status(201).json(publicTask(body.prepare||!body.asset_ids.length?preparation.enqueue(task):store.save(task)));});
 app.get('/api/tasks/:id',(req,res)=>res.json(publicTask(harness.get(req.params.id))));
 async function planTask(id:string){
  return harness.exclusive(id,async()=>{
   const t=harness.get(id);assert(t.asset_ids.length,'MATERIAL_REQUIRED','请在对话中补充素材需求，或上传视频后继续。',422);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);assert(['DRAFT_BRIEF','WAITING_PLAN_APPROVAL'].includes(t.state),'INVALID_STATE','当前阶段不能重新规划；请使用对话修改或创建新项目',409);assert(!t.edl?.clips.some(c=>c.locked),'LOCK_CONFLICT','请先解锁镜头',409);
   // A batch is an immutable set of independently reviewed projects, not a render loop.
   assert(!t.variant_group,'VARIANT_REPLAN','多版本方案已保存，请在各版本中提出修改；重新批量生成请新建创作。',409);
   t.asset_shots=Object.fromEntries(t.asset_ids.map(id=>[id,structuredClone(store.asset(id)!.shots)]));
   const confirmation=store.confirmTextPlan(),bgm=resolveBgm(store,t.brief.bgm,true),refId=t.brief.skill_options?.reference_asset_id,reference=refId?store.asset(refId):undefined;
   if(refId)assert(!t.asset_ids.includes(refId),'REFERENCE_IS_FOOTAGE','参考片应单独选择，不作为作品素材。',422);
   if(refId)assert(reference&&!reference.deleted_at,'REFERENCE_MISSING','参考视频已删除，请重新选择。',422);
   const result=await planSkillWorkflow(t.brief,harness.assets(t),{reference,bgm,musicPath:musicPath(store,{bgm} as EDL)!});
   const group=result.plans.length>1?randomUUID():undefined;
   const tasks=result.plans.map(({plan,label},index)=>{
    const current=index===0?t:newTask(structuredClone(t.brief),[...t.asset_ids],`${t.name} · ${label}`);
    current.asset_shots=Object.fromEntries(result.assets.map(a=>[a.id,structuredClone(a.shots)]));
    if(group)current.variant_group={id:group,index,count:result.plans.length,label};
    plan.edl.version=(current.edl?.version||0)+1;plan.text_review=textReview(plan.edl,confirmation||plan.skill?.status==='needs_material');current.plan=plan;snapshot(current,plan.edl,'生成剪辑计划');current.state='WAITING_PLAN_APPROVAL';addEvent(current,'plan.ready','剪辑计划已就绪',{skill:plan.skill,recipe_match:plan.recipe_match,editorial_review:plan.editorial_review,mode:plan.mode,risks:plan.risks,assumptions:plan.assumptions,variant:current.variant_group,confirm_text_plan:confirmation});return current;
   });
   store.saveTasks(tasks);
   if(!confirmation)for(const current of tasks)if(current.plan?.skill?.status!=='needs_material'){current.plan_approved_version=current.edl!.version;addEvent(current,'plan.confirmation.skipped','文字确认开关已关闭，开始预览');harness.enqueue(current,'preview');}
   return harness.get(t.id);
  });
 }
 app.post('/api/tasks/:id/plan',async(req,res)=>{preparation.idle(harness.get(req.params.id));res.json(publicTask(await planTask(req.params.id)));});
 app.post('/api/tasks/:id/brief',(req,res)=>{
  const body=z.object({message:z.string().trim().max(4000).default(''),asset_ids:z.array(z.string()).max(12).default([]),retry:z.boolean().default(false)}).parse(req.body);
  const task=harness.get(req.params.id);harness.idle(task);preparation.idle(task);
  assert(task.state==='DRAFT_BRIEF'&&!task.edl,'BRIEF_ALREADY_PLANNED','方案已生成，请使用视频修改入口。',409);
  assert(body.message||body.asset_ids.length||body.retry,'EMPTY_REPLY','请输入补充说明或选择素材。',422);
  const ids=[...new Set([...task.asset_ids,...body.asset_ids])];assert(ids.length<=12,'TOO_MANY_ASSETS','每个项目最多 12 份素材。',422);
  for(const id of ids)assert(store.asset(id)&&!store.asset(id)!.deleted_at,'ASSET_NOT_FOUND','所选素材已删除，请重新选择。',422);
  task.preparation??={status:'needs_input',message:'',messages:[{id:randomUUID(),role:'user',text:task.brief.request}]};
  if(body.message){
   const request=task.brief.request+'\n补充需求：'+body.message;assert(request.length<=8000,'BRIEF_TOO_LONG','需求内容已达到长度上限，请新建项目整理需求。',422);
   task.brief=normalizeBrief({...task.brief,request});reply(task,body.message,'user');
  }
  task.asset_ids=ids;addEvent(task,'brief.continued',body.message||'继续准备素材与方案',{asset_ids:body.asset_ids});
  res.status(202).json(publicTask(preparation.enqueue(task)));
 });
 app.post('/api/tasks/:id/approve-plan',(req,res)=>{const t=harness.get(req.params.id);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);harness.idle(t);const {version,candidate_digest}=z.object({version:z.number().int(),candidate_digest:z.string().optional()}).parse(req.body);assert(t.edl?.version===version,'STALE_VERSION','计划版本已变化，请刷新',409);assert(t.state==='WAITING_PLAN_APPROVAL','INVALID_STATE','当前不在计划确认阶段',409);assert(t.plan?.skill?.status!=='needs_material','SKILL_NEEDS_MATERIAL','所选技能缺少必要素材，请补充注释后重新生成方案。',422);if(t.plan?.text_review)approveTextReview(t.plan.text_review,t.edl,candidate_digest||'');t.plan_approved_version=version;addEvent(t,'approval.plan','用户确认剪辑计划和已展示风险',{version,accepted_risks:t.plan?.risks});res.json(publicTask(harness.enqueue(t,'preview')));});
 app.post('/api/tasks/:id/revise',async(req,res)=>{
  const body=z.object({feedback:z.string().min(1).max(4000),base_version:z.number().int(),clip_ids:z.array(z.string()).min(1).max(60).optional()}).parse(req.body);
  const task=await harness.exclusive(req.params.id,async()=>{
   const t=harness.get(req.params.id);
   assert(t.edl&&['WAITING_USER_REVIEW','DELIVERED','FAILED','WAITING_PLAN_APPROVAL','CANCELLED'].includes(t.state),'INVALID_STATE','请等待剪辑计划或预览完成',409);
   assert(t.edl.version===body.base_version,'STALE_VERSION','完整版本已变化，请刷新后重新提交修改',409);
   const confirmation=store.confirmTextPlan();
   t.pending_patch=await createPatch(t.edl,harness.assets(t),body.feedback,body.clip_ids);
   t.pending_patch.text_review=textReview(t.pending_patch.edl,confirmation,t.edl);
   addEvent(t,'patch.proposed',t.pending_patch.summary,{feedback:body.feedback,patch_id:t.pending_patch.id,base_version:t.edl.version,scope:t.pending_patch.scope});
   if(confirmation){addEvent(t,'patch.text_plan.ready','文字修改方案已就绪，等待确认后生成片段预览',{patch_id:t.pending_patch.id,changes:t.pending_patch.changes});return store.save(t);}
   return harness.enqueuePatchPreview(t);
  });res.json(publicTask(task));
 });
 const patchBody=z.object({patch_id:z.string(),base_version:z.number().int()});
 function currentPatch(id:string,body:z.infer<typeof patchBody>){const t=harness.get(id);harness.idle(t);const p=t.pending_patch;assert(p&&p.id===body.patch_id&&t.edl?.version===body.base_version&&p.base_version===body.base_version,'STALE_PATCH','修改或基础版本已失效，请重新提交',409);return {t,patch:p};}
 app.post('/api/tasks/:id/approve-patch-plan',(req,res)=>{const b=patchBody.extend({candidate_digest:z.string()}).parse(req.body);const {t,patch}=currentPatch(req.params.id,b);assert(patch.text_review,'TEXT_PLAN_MISSING','该修改没有待确认的文字方案，请重新提交',409);approveTextReview(patch.text_review,patch.edl,b.candidate_digest,t.edl);addEvent(t,'patch.text_plan.approved','用户确认文字修改方案，开始生成局部预览',{patch_id:patch.id,candidate_digest:b.candidate_digest,changes:patch.changes});res.json(publicTask(harness.enqueuePatchPreview(t)));});
 app.post('/api/tasks/:id/patch-preview',(req,res)=>{const {t,patch}=currentPatch(req.params.id,patchBody.parse(req.body));assertTextReview(patch.text_review,patch.edl,t.edl);res.json(publicTask(harness.enqueuePatchPreview(t)));});
 app.post('/api/tasks/:id/cancel-patch-preview',(req,res)=>{const b=patchBody.extend({preview_id:z.string()}).parse(req.body);res.json(publicTask(harness.cancelPatch(req.params.id,b.patch_id,b.preview_id)));});
 app.post('/api/tasks/:id/discard-patch',(req,res)=>{const {t,patch}=currentPatch(req.params.id,patchBody.parse(req.body));t.pending_patch=undefined;addEvent(t,'patch.discarded','已放弃片段修改，完整版本保持不变',{patch_id:patch.id});res.json(publicTask(store.save(t)));});
 app.post('/api/tasks/:id/apply-patch',(req,res)=>{
  const b=patchBody.extend({preview_id:z.string().optional()}).parse(req.body),{t,patch}=currentPatch(req.params.id,b);
  assertTextReview(patch.text_review,patch.edl,t.edl);
  assertPatchPreviewApproved(patch,t.edl!,b.preview_id||'');
  assert(patch.constraints,'REVISION_CHANGE_REQUIRED','请重新提交修改，核对具体改动点',409);assertRequestedChanges(t.edl!,patch.edl,patch.constraints);
  assert(patch.scope,'REVISION_SCOPE_REQUIRED','请重新生成锁定修改区间的片段预览',409);assertRevisionScope(t.edl!,patch.edl,patch.scope);
  const edl=validateEDL(patch.edl,harness.assets(t),t.edl);
  snapshot(t,edl,patch.summary);t.plan_approved_version=edl.version;
  addEvent(t,'patch.approved','用户确认局部片段效果，开始将同一修改应用到完整视频',{patch_id:patch.id,preview_id:b.preview_id,base_version:patch.base_version,new_version:edl.version,feedback:patch.feedback,regions:patch.preview!.regions,base_digest:patch.preview!.base_digest,candidate_digest:patch.preview!.candidate_digest});
  res.json(publicTask(harness.enqueue(t,'preview')));
 });
 app.post('/api/tasks/:id/lock',(req,res)=>{const t=harness.get(req.params.id);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);harness.idle(t);const b=z.object({clip_id:z.string(),locked:z.boolean(),version:z.number().int()}).parse(req.body);assert(t.edl?.version===b.version,'STALE_VERSION','版本已变化，请刷新',409);const edl=structuredClone(t.edl);const clip=edl.clips.find(c=>c.id===b.clip_id);assert(clip,'CLIP_NOT_FOUND','镜头不存在',404);clip.locked=b.locked;edl.version++;const qa=t.qa;const approved=t.plan_approved_version===b.version;const existing=t.artifacts.filter(a=>a.version===b.version&&['preview','cover','subtitles','music_credits'].includes(a.kind));snapshot(t,edl,b.locked?'锁定镜头':'解锁镜头');if(t.plan){t.plan.edl=structuredClone(edl);t.plan.text_review=textReview(edl,store.confirmTextPlan());if(approved){t.plan.text_review.approved_digest=t.plan.text_review.candidate_digest;t.plan.text_review.approved_at=new Date().toISOString();}}t.qa=qa;if(approved)t.plan_approved_version=edl.version;t.artifacts.push(...existing.map(a=>({...a,version:edl.version})));if(t.state==='DELIVERED')t.state='WAITING_USER_REVIEW';addEvent(t,'lock.updated',b.locked?'镜头已锁定':'镜头已解锁',{clip_id:clip.id,version:edl.version});res.json(publicTask(store.save(t)));});
 app.post('/api/tasks/:id/rollback',(req,res)=>{const t=harness.get(req.params.id);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);harness.idle(t);const {version}=z.object({version:z.number().int()}).parse(req.body);const old=t.versions.find(v=>v.version===version);assert(old&&t.edl,'VERSION_NOT_FOUND','历史版本不存在',404);const edl=validateEDL({...structuredClone(old.edl),version:t.edl.version+1},harness.assets(t),t.edl);snapshot(t,edl,`回退到 v${version} 的内容`);t.plan_approved_version=edl.version;addEvent(t,'version.restored','用户请求回退，建立新版本并重新预览',{from_version:version,to_version:edl.version});res.json(publicTask(harness.enqueue(t,'preview')));});
 app.post('/api/tasks/:id/approve-preview',(req,res)=>{const t=harness.get(req.params.id);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);harness.idle(t);const {version}=z.object({version:z.number().int()}).parse(req.body);assert(t.edl?.version===version,'STALE_VERSION','预览版本已变化，请刷新',409);assert(t.state==='WAITING_USER_REVIEW'&&t.qa?.passed&&t.artifacts.some(a=>a.kind==='preview'&&a.version===version),'PREVIEW_NOT_READY','当前预览尚未通过质检',409);t.preview_approved_version=version;addEvent(t,'approval.preview','用户确认当前预览与人工审阅项',{version,manual_review:t.qa.checks.filter(c=>c.status==='manual')});res.json(publicTask(harness.enqueue(t,'final')));});
 app.post('/api/tasks/:id/text-display',(req,res)=>{
  const t=harness.get(req.params.id);harness.idle(t);preparation.idle(t);
  const {enabled,version}=z.object({enabled:z.boolean(),version:z.number().int().nonnegative()}).parse(req.body);
  assert((t.edl?.version??0)===version,'STALE_VERSION','方案版本已变化，请刷新',409);
  assert(!t.pending_patch,'PENDING_PATCH','请先处理待确认的修改，再切换文案字幕',409);
  if(!t.edl){assert(t.state==='DRAFT_BRIEF','INVALID_STATE','当前无法修改文字设置',409);t.brief.subtitles=enabled;addEvent(t,'text_display.updated',enabled?'已开启文案字幕':'已关闭文案字幕',{enabled});return res.json(publicTask(store.save(t)));}
  assert(['WAITING_PLAN_APPROVAL','WAITING_USER_REVIEW','DELIVERED','FAILED','CANCELLED'].includes(t.state),'INVALID_STATE','请等待当前操作完成',409);
  if(t.edl.subtitles===enabled)return res.json(publicTask(t));
  const approved=t.plan_approved_version===version;
  const edl=validateEDL({...structuredClone(t.edl),version:version+1,subtitles:enabled},harness.assets(t),t.edl);
  snapshot(t,edl,enabled?'开启文案字幕':'关闭文案字幕');t.brief.subtitles=enabled;
  if(t.plan){t.plan.edl=structuredClone(edl);t.plan.text_review=textReview(edl,store.confirmTextPlan());t.plan.assumptions=t.plan.assumptions.filter(a=>!a.includes('画面仅保留字幕')&&!a.includes('仅叠加用户')&&!a.includes('文案字幕'));t.plan.assumptions.unshift(enabled?'文案字幕已开启':'文案字幕已关闭，不在画面添加字幕、标题或结尾文字');}
  t.state='WAITING_PLAN_APPROVAL';t.progress=0;
  addEvent(t,'text_display.updated',enabled?'已开启文案字幕':'已关闭文案字幕',{enabled,from_version:version,version:edl.version,audio_unchanged:true});
  // The toggle authorizes this presentation change; it does not approve an unreviewed plan.
  if(approved&&!store.confirmTextPlan()){t.plan_approved_version=edl.version;return res.json(publicTask(harness.enqueue(t,'preview')));}
  return res.json(publicTask(store.save(t)));
 });
 app.post('/api/tasks/:id/cancel',(req,res)=>res.json(publicTask(harness.cancel(req.params.id))));
 app.post('/api/tasks/:id/retry',(req,res)=>{const t=harness.get(req.params.id);assert(!t.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);harness.idle(t);assert(['FAILED','CANCELLED'].includes(t.state),'INVALID_STATE','当前无需重试',409);const quality=t.edl&&t.preview_approved_version===t.edl.version&&t.qa?.passed?'final':'preview';res.json(publicTask(harness.enqueue(t,quality)));});
 app.get('/api/tasks/:id/trace',(req,res)=>{const t=harness.get(req.params.id);res.setHeader('Content-Disposition',`attachment; filename="cutflow-${t.id}-trace.json"`);res.json(traceRecord(t,harness.assets(t)));});
 let demoBusy=false;
 app.post('/api/demo',async(_req,res)=>{assert(!demoBusy,'DEMO_BUSY','演示素材正在生成，请稍候',409);demoBusy=true;try{const assets=await generateDemoAssets(assetsDir);for(const a of assets)store.saveAsset(a);const brief=normalizeBrief({request:'把这三个合成测试素材拼成一条12秒演示视频，展示剪辑、字幕与导出流程。',product:'CutFlow 演示',duration_ms:12000,cta:'从素材到成片',style:'清晰、简洁'});const task=newTask(brief,assets.map(a=>a.id),'第一条剪辑 · 合成素材演示',true);task.asset_shots=Object.fromEntries(assets.map(a=>[a.id,structuredClone(a.shots)]));const confirmation=store.confirmTextPlan();const plan=await createPlan(brief,assets);plan.edl.bgm=resolveBgm(store,brief.bgm);plan.text_review=textReview(plan.edl,confirmation||plan.skill?.status==='needs_material');task.plan=plan;snapshot(task,plan.edl,'演示剪辑计划');task.state='WAITING_PLAN_APPROVAL';addEvent(task,'demo.created','已创建合成测试素材；用于验证流程，不代表语义剪辑质量');if(!confirmation){task.plan_approved_version=plan.edl.version;addEvent(task,'plan.confirmation.skipped','文字确认开关已关闭，直接生成演示预览');harness.enqueue(task,'preview');}res.status(201).json(publicTask(store.save(task)));}finally{demoBusy=false;}});
 app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'接口不存在'}}));
 if(existsSync(path.resolve('dist/index.html'))){app.use(express.static(path.resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));}
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{const e=error as Error;const status=error instanceof AppError?error.status:error instanceof z.ZodError||error instanceof multer.MulterError?400:500;const code=error instanceof AppError?error.code:error instanceof z.ZodError?'SCHEMA_INVALID':error instanceof multer.MulterError?error.code:'INTERNAL_ERROR';const message=error instanceof z.ZodError?error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；'):e.message||'服务处理失败';res.status(status).json({error:{code,message}});});
 return {app,store,harness,preparation};
}
