import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {setTimeout as delay,setImmediate as nextTurn} from 'node:timers/promises';
import {createPatch,normalizeBrief} from '../server/planner.js';
import {assertRevisionScope,assertPatchPreviewApproved,edlDigest,renderedDuration,resolveRevisionScope,revisionRegions,slicePreview} from '../server/revisions.js';
import {createApp} from '../server/server.js';
import {Harness,newTask,snapshot} from '../server/harness.js';
import {Store} from '../server/store.js';
import {resolveBgm} from '../server/music.js';
import {generateDemoAssets,hashFile} from '../server/media.js';
import {updateSettings} from '../server/settings.js';
import {EDLSchema,type Asset,type EDL,type Task} from '../shared/types.js';
updateSettings({model_api_key:'',model_name:'',renderer:'ffmpeg'});
const asset:Asset={id:'a',name:'a.mp4',file_path:'/tmp/source.mp4',url:'',thumbnail_url:'',duration_ms:20000,width:1280,height:720,fps:30,has_audio:true,sha256:'test',created_at:'',warnings:[],shots:[{id:'s',asset_id:'a',start_ms:0,end_ms:20000,summary:'测试内容',evidence:{type:'user_annotation',description:'测试观察',confidence:1}}]};
function base():EDL{return EDLSchema.parse({schema_version:'1.0',version:1,clips:[0,1,2].map(i=>({id:`c${i}`,asset_id:'a',shot_id:'s',start_ms:i*4000,end_ms:i*4000+4000,purpose:`镜头${i}`,caption:`字幕${i}`,evidence:asset.shots[0].evidence})),aspect_ratio:'16:9',resolution:'720p',fps:30,subtitles:true});}
const stable=(t:Task)=>({edl:t.edl,versions:t.versions,artifacts:t.artifacts,state:t.state,progress:t.progress,qa:t.qa,plan_approved_version:t.plan_approved_version,preview_approved_version:t.preview_approved_version,validated_trace:t.validated_trace,error:t.error});

test('revision location requires unambiguous evidence and respects the explicit selection',()=>{
 const e=base();assert.throws(()=>resolveRevisionScope(e,[asset],'调整一下'),{code:'REVISION_SCOPE_REQUIRED'});
 assert.deepEqual(resolveRevisionScope(e,[asset],'最后一个镜头保留前2秒').clip_ids,['c2']);
 assert.deepEqual(resolveRevisionScope(e,[asset],'音量50%',['c1']).clip_ids,['c1']);
 assert.throws(()=>resolveRevisionScope(e,[asset],'第3镜头保留前2秒',['c0']),{code:'SCOPE_CONFLICT'});
 assert.throws(()=>resolveRevisionScope(e,[asset],'静音',['old']),{code:'SCOPE_INVALID'});
 e.clips[1].purpose='人物品味咖啡后放下杯子';assert.deepEqual(resolveRevisionScope(e,[asset],'人物品味咖啡后放下杯子的镜头保留前2秒').clip_ids,['c1']);
 e.clips[2].purpose=e.clips[1].purpose;assert.throws(()=>resolveRevisionScope(e,[asset],'人物品味咖啡后放下杯子的镜头缩短到2秒'),{code:'REVISION_SCOPE_REQUIRED'});
});

test('scope guards unselected content, globals, movement and newly inserted clips',()=>{
 const e=base(),scope=resolveRevisionScope(e,[asset],'第2镜头保留前2秒');
 for(const change of [(n:EDL)=>{n.clips[0].caption='偷偷修改';},(n:EDL)=>{n.audio_gain=0;},(n:EDL)=>{n.clips.reverse();},(n:EDL)=>{n.clips.unshift({...n.clips[1],id:'new'}); }]){const n=structuredClone(e);change(n);assert.throws(()=>assertRevisionScope(e,n,scope),{code:'REVISION_SCOPE_EXCEEDED'});}
 const replace=structuredClone(e);replace.clips[1]={...replace.clips[1],id:'replacement'};assert.doesNotThrow(()=>assertRevisionScope(e,replace,scope));
 const deletion=structuredClone(e);deletion.clips.splice(1,1);assert.doesNotThrow(()=>assertRevisionScope(e,deletion,scope));
 e.title='片头';const removeFirst=structuredClone(e);removeFirst.clips.shift();assert.throws(()=>assertRevisionScope(e,removeFirst,{kind:'clips',clip_ids:['c0'],basis:'test'}),{code:'REVISION_SCOPE_EXCEEDED'});
});

test('trim preview isolates the actual cut and ignores downstream time shifts',async()=>{
 const e=base(),patch=await createPatch(e,[asset],'第1镜头保留前2秒');
 assert.deepEqual(patch.regions!.map(r=>r.before_range),[[2000,4000]]);
 assert.deepEqual(patch.regions![0].after_range,[2000,2000]);
 assert.deepEqual(patch.regions![0].before_preview_range,[1600,4400]);
 assert.deepEqual(patch.regions![0].after_preview_range,[1600,2400]);
 assert.deepEqual(patch.edl.clips.slice(1),e.clips.slice(1));assert.equal(e.version,1);
 assert.equal(renderedDuration(slicePreview(patch.edl,patch.regions![0].after_preview_range)),800);
 const head=await createPatch(e,[asset],'第2镜头取原片5秒到8秒');
 assert.deepEqual(head.regions![0].before_range,[4000,5000]);assert.deepEqual(head.regions![0].after_range,[4000,4000]);
});

test('deleted shot previews its new junction; disjoint changes keep separate windows',async()=>{
 const e=base(),p=await createPatch(e,[asset],'删除第2镜头');
 assert.deepEqual(p.regions![0].before_range,[4000,8000]);assert.deepEqual(p.regions![0].after_range,[4000,4000]);
 const window=slicePreview(p.edl,p.regions![0].after_preview_range);assert.deepEqual(window.clips.map(c=>c.id),['c0','c2']);assert.equal(renderedDuration(window),800);
 const n=structuredClone(e);n.clips[0].caption='开头';n.clips[2].caption='结尾';const regions=revisionRegions(e,n);
 assert.equal(regions.length,2);assert.deepEqual(regions.map(r=>r.clip_ids),[['c0'],['c2']]);
 const moved=structuredClone(e);moved.clips=[e.clips[1],e.clips[0],e.clips[2]];assert.equal(revisionRegions(e,moved).length,2);
});

test('local audio and subtitle requests never become a global change or shot deletion',async()=>{
 const e=base(),p=await createPatch(e,[asset],'第2镜头音量50%');assert.equal(p.edl.clips[1].audio_gain,.5);assert.equal(p.edl.audio_gain,1);assert.equal(p.edl.clips[0].audio_gain,undefined);
 const removed=await createPatch(e,[asset],'第2镜头去掉字幕');assert.equal(removed.edl.clips.length,3);assert.equal(removed.edl.clips[1].caption,'');assert.equal(removed.edl.subtitles,true);
 const multi=await createPatch(e,[asset],'字幕改为：你好',['c0','c2']);assert.deepEqual(multi.edl.clips.map(c=>c.caption),['你好','字幕1','你好']);assert.equal(multi.regions!.length,2);
 await assert.rejects(()=>createPatch(e,[asset],'第2镜头去掉人物身边的物品'),{code:'FEEDBACK_NEEDS_MODEL'});
 await assert.rejects(()=>createPatch({...e,subtitles:false},[asset],'第2镜头字幕改为：隐藏字幕'),{code:'NO_VISIBLE_CHANGE'});
});

test('global requests expose their full impact, titles and CTA stay on original boundary shots',async()=>{
 const e=base();e.title='标题';e.cta='结尾';
 const global=await createPatch(e,[asset],'音量50%');assert.equal(global.scope!.kind,'global');assert.deepEqual(global.regions![0].before_range,[0,12000]);
 const title=await createPatch(e,[asset],'删除标题');assert.deepEqual(title.regions![0].clip_ids,['c0']);
 const both=await createPatch(e,[asset],'删除标题，删除结尾文案');assert.equal(both.regions!.length,2);
 const middle=slicePreview(e,[4200,6000]);assert.equal(middle.title,'');assert.equal(middle.cta,'');
 assert.equal(slicePreview(e,[0,800]).cta,'');assert.equal(slicePreview(e,[11000,12000]).title,'');
 const fractional=structuredClone(e);fractional.clips[0].end_ms=413;
 assert.equal(renderedDuration(slicePreview(fractional,[100,1100])),1000);
});

test('approval is bound to current candidate, base, preview and every region passing QA',async()=>{
 const e=base(),p=await createPatch(e,[asset],'第2镜头保留前2秒');
 assert.throws(()=>assertPatchPreviewApproved(p,e,'none'),{code:'PATCH_PREVIEW_REQUIRED'});
 const media={url:'/media/test.mp4',sha256:'test',duration_ms:800,qa:{passed:true,checks:[],issues:[],checked_at:''}};
 p.preview={id:'preview',status:'ready',progress:100,base_digest:edlDigest(e),candidate_digest:edlDigest(p.edl),created_at:'',regions:p.regions!.map(r=>({...r,before:structuredClone(media),after:structuredClone(media)}))};
 assert.doesNotThrow(()=>assertPatchPreviewApproved(p,e,'preview'));
 assert.throws(()=>assertPatchPreviewApproved(p,e,'old'),{code:'PATCH_PREVIEW_REQUIRED'});
 p.preview.regions[0].after!.qa.passed=false;assert.throws(()=>assertPatchPreviewApproved(p,e,'preview'),{code:'PATCH_PREVIEW_REQUIRED'});p.preview.regions[0].after!.qa.passed=true;
 p.edl.clips[1].caption='未看过的内容';assert.throws(()=>assertPatchPreviewApproved(p,e,'preview'),{code:'STALE_PATCH_PREVIEW'});
 p.preview.candidate_digest=edlDigest(p.edl);e.version++;assert.throws(()=>assertPatchPreviewApproved(p,e,'preview'),{code:'STALE_PATCH_PREVIEW'});
});

test('real HTTP preview renders only local files, preserves full state and applies exactly the reviewed candidate', {timeout:180000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-local-preview-')),{app,store,harness}=createApp(root);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=async(route:string,body:unknown)=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 async function idle(id:string){for(let i=0;i<900;i++){await delay(100);try{harness.idle(harness.get(id));return harness.get(id);}catch{}}throw Error('render timeout');}
 let id='';
 try{
  const assets=await generateDemoAssets(path.join(root,'media','assets'));for(const a of assets)store.saveAsset(a);
  const e=base();e.bgm=resolveBgm(store);e.subtitles=false;e.clips=assets.map((a,i)=>({...e.clips[i],asset_id:a.id,shot_id:a.shots[0].id,start_ms:0,end_ms:1500,evidence:a.shots[0].evidence}));
  const t=newTask(normalizeBrief({request:'测试视频',duration_ms:4500}),assets.map(a=>a.id));id=t.id;snapshot(t,e,'test baseline');t.plan_approved_version=1;store.save(t);harness.enqueue(t,'preview');
  const original=await idle(id);assert.equal(original.state,'WAITING_USER_REVIEW');assert.equal(original.qa!.passed,true);const baseline=stable(original),route=`/api/tasks/${id}`;
  const stale=await post(route+'/revise',{feedback:'第2镜头保留前1秒',base_version:99});assert.equal(stale.data.error.code,'STALE_VERSION');
  const proposed=await post(route+'/revise',{feedback:'第2镜头保留前1秒',base_version:1});assert.equal(proposed.status,200);
  assert.deepEqual(stable(harness.get(id)),baseline,'queue handoff preserves full video state');
  const early=await post(route+'/apply-patch',{patch_id:proposed.data.pending_patch.id,base_version:1});assert.equal(early.status,409);
  assert.equal(proposed.data.pending_patch.preview,undefined);
  assert.equal(early.data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  const confirmed=await post(route+'/approve-patch-plan',{patch_id:proposed.data.pending_patch.id,base_version:1,candidate_digest:proposed.data.pending_patch.text_review.candidate_digest});assert.equal(confirmed.status,200);
  const ready=await idle(id),p=ready.pending_patch!;assert.equal(p.preview!.status,'ready',p.preview!.error);assert.deepEqual(stable(ready),baseline);
  for(const region of p.preview!.regions)for(const side of ['before','after'] as const){const media=region[side]!;assert(media.qa.passed);assert(media.duration_ms<2000);const file=path.join(root,'media',decodeURIComponent(media.url.slice('/media/'.length)));assert.equal(await hashFile(file),media.sha256);const response=await fetch(url+media.url);assert.equal(response.status,200);await response.arrayBuffer();}
  assert.equal((await post(route+'/lock',{clip_id:e.clips[0].id,locked:true,version:1})).data.error.code,'PENDING_PATCH');
  assert.equal((await post(route+'/apply-patch',{patch_id:p.id,base_version:1,preview_id:'stale-preview'})).data.error.code,'PATCH_PREVIEW_REQUIRED');
  assert.equal((await post(route+'/apply-patch',{patch_id:p.id,base_version:1})).data.error.code,'PATCH_PREVIEW_REQUIRED');
  // Late cancellation of a completed local job cannot cancel the full project.
  await post(route+'/cancel-patch-preview',{patch_id:p.id,base_version:1,preview_id:p.preview!.id});assert.deepEqual(stable(harness.get(id)),baseline);
  const applied=await post(route+'/apply-patch',{patch_id:p.id,base_version:1,preview_id:p.preview!.id});assert.equal(applied.status,200);
  const complete=await idle(id);assert.deepEqual(complete.edl,p.edl);assert.equal(complete.state,'WAITING_USER_REVIEW');assert.equal(complete.qa!.passed,true);assert.deepEqual(complete.versions[0].edl,e);assert.equal(complete.pending_patch,undefined);
  assert(complete.artifacts.some(a=>a.kind==='preview'&&a.version===1));assert(complete.artifacts.some(a=>a.kind==='preview'&&a.version===2));
  assert.equal(complete.events.filter(ev=>ev.type==='qa.completed').at(-1)!.data!.cache_hits,2,'full render reuses both unchanged shots');
  const appliedBaseline=stable(complete);
  // A source integrity failure remains local; retry gets a fresh preview identity.
  store.saveAsset({...assets[1],sha256:'bad-source-hash'});
  const failing=await post(route+'/revise',{feedback:'第2镜头保留前0.7秒',base_version:2});assert.equal(failing.status,200);
  await post(route+'/approve-patch-plan',{patch_id:failing.data.pending_patch.id,base_version:2,candidate_digest:failing.data.pending_patch.text_review.candidate_digest});
  const failed=await idle(id);assert.equal(failed.pending_patch!.preview!.status,'failed');assert.deepEqual(stable(failed),appliedBaseline);
  store.saveAsset(assets[1]);const badPreviewId=failed.pending_patch!.preview!.id;
  const retried=await post(route+'/patch-preview',{patch_id:failed.pending_patch!.id,base_version:2});assert.equal(retried.status,200);assert.notEqual(retried.data.pending_patch.preview.id,badPreviewId);
  const recovered=await idle(id);assert.equal(recovered.pending_patch!.preview!.status,'ready');assert.deepEqual(stable(recovered),appliedBaseline);
  assert.equal((await post(route+'/discard-patch',{patch_id:recovered.pending_patch!.id,base_version:2})).status,200);assert.equal(harness.get(id).pending_patch,undefined);assert.deepEqual(stable(harness.get(id)),appliedBaseline);
 }finally{if(id){try{harness.cancel(id);await idle(id);}catch{}}await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(root,{recursive:true,force:true});}
});

test('queued local cancellation and interrupted-preview recovery preserve the original project',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-patch-recovery-'));const store=new Store(root),harness=new Harness(store,path.join(root,'media'));
 let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
 (harness as unknown as {execute:(j:unknown)=>Promise<void>}).execute=async()=>barrier;
 try{
  store.saveAsset(asset);const first=newTask(normalizeBrief({request:'test'}),['a']);snapshot(first,base(),'test');first.plan_approved_version=1;store.save(first);harness.enqueue(first,'preview');
  const target=newTask(first.brief,['a']);snapshot(target,base(),'test');target.state='DELIVERED';target.validated_trace=true;store.save(target);const baseline=stable(structuredClone(target));
  target.pending_patch=await createPatch(target.edl!,[asset],'第2镜头保留前2秒');harness.enqueuePatchPreview(target);const p=target.pending_patch;
  harness.cancelPatch(target.id,p.id,p.preview!.id);assert.deepEqual(stable(harness.get(target.id)),baseline);assert.equal(harness.get(target.id).pending_patch!.preview!.status,'cancelled');assert.doesNotThrow(()=>harness.idle(harness.get(target.id)));
  const interrupted=harness.get(target.id);interrupted.pending_patch!.preview!.status='rendering';store.save(interrupted);store.recover();const recovered=harness.get(target.id);assert.equal(recovered.pending_patch!.preview!.status,'failed');assert.deepEqual(stable(recovered),baseline);
  const count=recovered.events.length;store.recover();assert.equal(harness.get(target.id).events.length,count);
 }finally{release();await nextTurn();store.close();await rm(root,{recursive:true,force:true});}
});
