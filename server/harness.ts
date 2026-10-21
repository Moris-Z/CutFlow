import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Asset, Artifact, EDL, Task } from '../shared/types.js';
import { Store,addEvent } from './store.js';
import { assert,AppError } from './errors.js';
import { validateEDL } from './planner.js';
import { assessEditorial } from './editorial.js';
import { settings } from './settings.js';
import { renderVideo,evaluateRender,hashFile } from './media.js';
import {musicPath,musicCredits} from './music.js';
import { skillRegistry } from './registry.js';
import { assertRevisionScope, edlDigest, revisionRegions, slicePreview, renderedDuration } from './revisions.js';
import { assertRequestedChanges, assertTextReview } from './revision-changes.js';
export const publicAsset=(asset:Asset):Asset=>({...asset,file_path:''});
export const publicTask=(task:Task):Task=>({...task,artifacts:task.artifacts.map(a=>({...a,path:''}))});
export function snapshot(task:Task,edl:EDL,reason:string){task.edl=structuredClone(edl);task.versions.push({version:edl.version,edl:structuredClone(edl),reason,created_at:new Date().toISOString()});task.plan_approved_version=undefined;task.preview_approved_version=undefined;task.qa=undefined;task.validated_trace=false;task.pending_patch=undefined;task.error=undefined;}
export function traceRecord(task:Task,assets:Asset[]){return {schema_version:'1.0',id:task.id,validated_trace:task.validated_trace,publication_status:'personal_trace',workflow_status:'not_replayed_not_published',brief:task.brief,assets:assets.map(a=>({id:a.id,name:a.name,sha256:a.sha256,duration_ms:a.duration_ms,shots:a.shots})),plan:task.plan,versions:task.versions,approvals:{plan:task.plan_approved_version,preview:task.preview_approved_version},qa:task.qa,artifacts:task.artifacts.map(({path:_,...a})=>a),events:task.events,skill_registry:skillRegistry,created_at:task.created_at,updated_at:task.updated_at};}
interface FullJob {taskId:string;quality:'preview'|'final';controller:AbortController;renderer:string}
interface PatchJob {taskId:string;quality:'patch';controller:AbortController;renderer:string;patchId:string;previewId:string}
type Job=FullJob|PatchJob;
export class Harness {
 private queue:Job[]=[];private jobs=new Map<string,Job>();private running=false;private activeJob:string|undefined;
 readonly operations=new Set<string>();
 constructor(readonly store:Store,readonly mediaRoot:string){}
 assets(task:Task){return task.asset_ids.map(id=>{const a=this.store.asset(id);assert(a,'ASSET_MISSING','任务素材已缺失',409);return task.asset_shots?.[id]?{...a,shots:task.asset_shots[id]}:a;});}
 get(id:string){const task=this.store.task(id);assert(task,'TASK_NOT_FOUND','项目不存在',404);return task;}
 idle(task:Task){assert(!this.jobs.has(task.id)&&!this.operations.has(task.id),'TASK_BUSY','项目仍在处理中，请等待完成或取消当前渲染',409);}
 async exclusive<T>(id:string,operation:()=>Promise<T>):Promise<T>{const task=this.get(id);this.idle(task);this.operations.add(id);try{return await operation();}finally{this.operations.delete(id);}}
 enqueue(task:Task,quality:'preview'|'final'){
 assert(task.plan?.skill?.status!=='needs_material','SKILL_NEEDS_MATERIAL','所选技能缺少必要素材。请补充素材注释后重新生成方案。',422);
 assert(!task.pending_patch,'PENDING_PATCH','请先确认或放弃当前片段修改',409);
 assert(!this.jobs.has(task.id),'TASK_BUSY','已有渲染任务',409);assert(task.edl,'NO_EDL','没有可渲染的时间线',409);
 assert(task.plan_approved_version===task.edl.version,'PLAN_APPROVAL_REQUIRED','当前版本尚未确认剪辑计划',409);
 if(task.plan?.edl.version===task.edl.version)assertTextReview(task.plan.text_review,task.edl);
 if(quality==='final')assert(task.preview_approved_version===task.edl.version&&task.qa?.passed,'PREVIEW_APPROVAL_REQUIRED','请先通过预览质检并确认当前预览',409);
 validateEDL(task.edl,this.assets(task));
 const job:FullJob={taskId:task.id,quality,controller:new AbortController(),renderer:settings().renderer};
 task.state=quality==='preview'?'RENDERING_PREVIEW':'RENDERING_FINAL';task.progress=0;task.error=undefined;
 addEvent(task,'render.queued',quality==='preview'?'预览已进入本地渲染队列':'已确认当前预览，开始高清交付',{version:task.edl.version,renderer:job.renderer,quality});
 this.store.save(task);this.jobs.set(task.id,job);this.queue.push(job);void this.drain();return task;
 }
 enqueuePatchPreview(task:Task){
  assert(!this.jobs.has(task.id),'TASK_BUSY','已有渲染任务',409);
  const patch=task.pending_patch;
  assert(patch&&task.edl&&patch.base_version===task.edl.version,'STALE_PATCH','修改所基于的版本已变化',409);
  assertTextReview(patch.text_review,patch.edl,task.edl);
  validateEDL(patch.edl,this.assets(task),task.edl);
  assert(patch.scope,'REVISION_SCOPE_REQUIRED','旧修改尚未锁定区间，请重新提交修改建议',409);
  assertRevisionScope(task.edl,patch.edl,patch.scope);
  assert(patch.constraints,'REVISION_CHANGE_REQUIRED','请重新提交修改，核对具体改动点',409);assertRequestedChanges(task.edl,patch.edl,patch.constraints);
  patch.regions=revisionRegions(task.edl,patch.edl);patch.affected_ranges=patch.regions.map(r=>r.before_range);
  patch.preview={id:randomUUID(),status:'queued',progress:0,base_digest:edlDigest(task.edl),candidate_digest:edlDigest(patch.edl),regions:structuredClone(patch.regions),created_at:new Date().toISOString()};
  const job:PatchJob={taskId:task.id,quality:'patch',patchId:patch.id,previewId:patch.preview.id,controller:new AbortController(),renderer:settings().renderer};
  addEvent(task,'patch.preview.queued','正在生成修改前后的局部片段，完整版本保持不变',{patch_id:patch.id,preview_id:patch.preview.id,regions:patch.regions});
  this.store.save(task);this.jobs.set(task.id,job);this.queue.push(job);void this.drain();return task;
 }
 cancelPatch(id:string,patchId:string,previewId:string){const task=this.get(id),patch=task.pending_patch;assert(patch?.id===patchId&&patch.preview?.id===previewId,'STALE_PATCH','片段预览已变化，请刷新',409);const job=this.jobs.get(id);if(!job)return task;assert(job.quality==='patch'&&job.previewId===previewId,'STALE_PATCH','该片段预览已不在运行',409);return this.cancel(id);}
 cancel(id:string){const task=this.get(id);assert(!this.operations.has(id),'OPERATION_BUSY','模型规划正在处理中，请等待返回后操作',409);const job=this.jobs.get(id);if(job)job.controller.abort();this.queue=this.queue.filter(j=>j.taskId!==id);if(job&&this.activeJob!==id)this.jobs.delete(id);
  if(job?.quality==='patch'){
   if(task.pending_patch?.preview?.id===job.previewId){task.pending_patch.preview.status='cancelled';task.pending_patch.preview.error='已停止片段预览，完整版本保持不变';}
   addEvent(task,'patch.preview.cancelled','已停止片段预览，完整版本保持不变');
  }else{task.state='CANCELLED';task.progress=0;addEvent(task,'task.cancelled','用户取消当前任务；已保留素材与版本');}
  return this.store.save(task);
 }
 private async drain(){if(this.running)return;this.running=true;try{while(this.queue.length){const job=this.queue.shift()!;try{if(!job.controller.signal.aborted){this.activeJob=job.taskId;if(job.quality==='patch')await this.executePatch(job);else await this.execute(job);}}finally{this.activeJob=undefined;this.jobs.delete(job.taskId);}}}finally{this.running=false;}}
 private async executePatch(job:PatchJob){
  const initial=this.get(job.taskId),base=structuredClone(initial.edl!),patch=structuredClone(initial.pending_patch!),assets=this.assets(initial);
  const update=(change:(task:Task,preview:NonNullable<typeof patch.preview>)=>void)=>{
   const current=this.get(job.taskId),p=current.pending_patch;
   assert(p?.id===job.patchId&&p.preview?.id===job.previewId&&current.edl?.version===patch.base_version,'STALE_PATCH','片段预览已失效',409);
   change(current,p.preview);this.store.save(current);
  };
  try{
   update((_t,p)=>{p.status='rendering';});
   const regions=patch.preview!.regions,total=regions.length*2;let done=0;
   for(const region of regions)for(const side of ['before','after'] as const){
    job.controller.signal.throwIfAborted();
    const edl=slicePreview(side==='before'?base:patch.edl,region[side==='before'?'before_preview_range':'after_preview_range']);
    const directory=path.join(this.mediaRoot,'tasks',job.taskId,'patches',job.patchId,job.previewId,region.id,side);
    const result=await renderVideo(edl,assets,directory,{quality:'preview',renderer:job.renderer,signal:job.controller.signal,musicPath:musicPath(this.store,edl),timelineOffsetMs:region[side==='before'?'before_preview_range':'after_preview_range'][0],fullDurationMs:renderedDuration(side==='before'?base:patch.edl)});
    const qa=await evaluateRender(result,edl,'preview',{allowSilentComparison:side==='before'});job.controller.signal.throwIfAborted();
    update((_t,p)=>{p.regions.find(r=>r.id===region.id)![side]={url:'/media/'+path.relative(this.mediaRoot,result.video_path).split(path.sep).map(encodeURIComponent).join('/'),sha256:result.sha256,duration_ms:result.duration_ms,qa};p.progress=Math.round(++done/total*100);});
    assert(qa.passed,'PATCH_QA_FAILED','片段文件未通过技术检查，请重试或调整修改建议',422);
   }
   update((t,p)=>{p.status='ready';p.progress=100;addEvent(t,'patch.preview.ready','片段对比已就绪，等待用户看片确认后再修改完整视频',{patch_id:patch.id,preview_id:p.id});});
  }catch(error){
   const current=this.get(job.taskId);
   if(current.pending_patch?.id!==job.patchId||current.pending_patch.preview?.id!==job.previewId)return;
   const p=current.pending_patch.preview;p.status=job.controller.signal.aborted?'cancelled':'failed';p.error=job.controller.signal.aborted?'已停止片段预览，完整版本保持不变':error instanceof Error?error.message.slice(0,1500):'片段预览失败';
   addEvent(current,'patch.preview.'+p.status,p.error,{patch_id:patch.id,preview_id:p.id});this.store.save(current);
  }
 }
 private async execute(job:FullJob){let task=this.get(job.taskId);const edl=structuredClone(task.edl!);const assets=this.assets(task);const outputDir=path.join(this.mediaRoot,'tasks',task.id,`v${edl.version}`,job.quality);
 try{
 assert(edl.bgm,'BGM_REQUIRED','此旧方案尚未配置 BGM，请先点击“配置配乐”生成修改方案；不会交付无配乐视频',422);
 await mkdir(outputDir,{recursive:true});
 addEvent(task,'skill.started','执行已批准的 EDL',{skill:'render.video@1.0.0',edl_version:edl.version,dag:edl.clips.map(c=>({node:c.id,skill:'clip.trim',asset_id:c.asset_id,start_ms:c.start_ms,end_ms:c.end_ms})),renderer:job.renderer});this.store.save(task);
 let lastUpdate=0;
 const result=await renderVideo(edl,assets,outputDir,{quality:job.quality,musicPath:musicPath(this.store,edl),renderer:job.renderer,signal:job.controller.signal,onProgress:(value,message)=>{if(Date.now()-lastUpdate<500)return;lastUpdate=Date.now();const current=this.get(task.id);if(current.state==='CANCELLED')return;current.progress=Math.max(0,Math.min(90,Math.round(value<=1?value*90:value*.9)));this.store.save(current);}});
 if(job.controller.signal.aborted)throw new AppError('CANCELLED','任务已取消');
 task=this.get(task.id);task.progress=92;task.state='QUALITY_CHECKING';addEvent(task,'qa.started','独立检查实际生成文件',{quality:job.quality,version:edl.version});this.store.save(task);
 const qa=await evaluateRender(result,edl,job.quality);
 const editorial=assessEditorial(edl,assets);qa.checks.push(...editorial.checks);qa.issues.push(...editorial.issues);qa.passed=qa.passed&&!editorial.checks.some(c=>c.status==='fail');
 if(job.controller.signal.aborted)throw new AppError('CANCELLED','任务已取消');
 task=this.get(task.id);task.qa=qa;const version=task.versions.find(v=>v.version===edl.version);if(version)version.qa=qa;
 const artifact=(kind:Artifact['kind'],file:string,hash?:string):Artifact=>({kind,path:file,url:'/media/'+path.relative(this.mediaRoot,file).split(path.sep).map(encodeURIComponent).join('/'),version:edl.version,...(hash?{sha256:hash}:{})});
 const newArtifacts=[artifact(job.quality,result.video_path,result.sha256),artifact('cover',result.cover_path),artifact('subtitles',result.subtitle_path)];
 if(edl.bgm){const credits=path.join(outputDir,'music-credits.txt');await writeFile(credits,musicCredits(edl));newArtifacts.push(artifact('music_credits',credits,await hashFile(credits)));}
 const edlPath=path.join(outputDir,'edl.json');await writeFile(edlPath,JSON.stringify(edl,null,2));newArtifacts.push(artifact('edl',edlPath,await hashFile(edlPath)));
 task.artifacts=task.artifacts.filter(a=>!(a.version===edl.version&&newArtifacts.some(n=>n.kind===a.kind))).concat(newArtifacts);
 if(job.controller.signal.aborted)throw new AppError('CANCELLED','任务已取消');
 addEvent(task,'qa.completed',qa.passed?'技术质检通过；内容与授权由用户审阅':'技术质检发现阻塞项',{quality:job.quality,passed:qa.passed,issues:qa.issues,cache_hits:result.cache_hits});
 if(!qa.passed){task.state='FAILED';task.error={code:'QA_FAILED',message:'实际文件质检未通过，请查看质量报告。未标记交付成功。',retryable:true,stage:'QUALITY_CHECKING'};task.progress=100;this.store.save(task);return;}
 if(job.quality==='preview'){task.state='WAITING_USER_REVIEW';task.progress=100;addEvent(task,'preview.ready','预览已就绪。可提出修改或确认当前版本并导出高清成片');this.store.save(task);return;}
 // Final artifacts are successful only after final QA and both manifest + Trace writes succeed.
 const manifestPath=path.join(outputDir,'manifest.json');const manifest={schema_version:'1.0',task_id:task.id,edl_version:edl.version,renderer:result.renderer,background_music:edl.bgm,skills:skillRegistry,files:task.artifacts.filter(a=>a.version===edl.version).map(({path:_,...a})=>a),spec:{duration_ms:result.duration_ms,width:result.width,height:result.height,fps:result.fps},qa,source_assets:assets.map(a=>({asset_id:a.id,sha256:a.sha256,name:a.name})),content_review:{approved_version:task.preview_approved_version,automated_compliance:false},created_at:new Date().toISOString()};
 await writeFile(manifestPath,JSON.stringify(manifest,null,2));task.artifacts.push(artifact('manifest',manifestPath,await hashFile(manifestPath)));
 task.state='DELIVERED';task.progress=100;task.validated_trace=true;addEvent(task,'delivery.completed','高清成片、字幕、封面与交付清单已生成',{edl_version:edl.version});addEvent(task,'trace.validated','人工确认和最终技术质检均已通过；Trace 仅作为项目记录，未发布工作流');
 const tracePath=path.join(outputDir,'trace.json');await writeFile(tracePath,JSON.stringify(traceRecord(task,assets),null,2));task.artifacts.push(artifact('trace',tracePath,await hashFile(tracePath)));if(job.controller.signal.aborted)throw new AppError('CANCELLED','任务已取消');this.store.save(task);
 }catch(error){task=this.get(job.taskId);if(job.controller.signal.aborted||task.state==='CANCELLED'){task.state='CANCELLED';task.progress=0;}else{const stage=task.state;task.state='FAILED';task.validated_trace=false;task.error={code:error instanceof AppError?error.code:'RENDER_FAILED',message:error instanceof Error?error.message.slice(0,1800):'渲染失败',retryable:true,stage};addEvent(task,'task.failed','处理失败，工程状态已保存',{code:task.error.code,stage,retryable:true});}this.store.save(task);}
 }
}
export function newTask(brief:Task['brief'],assetIds:string[],name?:string,isDemo=false):Task {const now=new Date().toISOString();return {id:randomUUID(),name:name||brief.product||'未命名剪辑项目',state:'DRAFT_BRIEF',brief,asset_ids:assetIds,versions:[],artifacts:[],events:[],progress:0,created_at:now,updated_at:now,is_demo:isDemo,validated_trace:false};}
