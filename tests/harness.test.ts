import {test} from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createApp} from '../server/server.js';
import {Store} from '../server/store.js';
import {Harness,newTask,snapshot} from '../server/harness.js';
import {edlDigest,revisionRegions} from '../server/revisions.js';
import {normalizeBrief,validateEDL} from '../server/planner.js';
import {config,updateSettings} from '../server/settings.js';
import type {Asset,EDL,Task} from '../shared/types.js';

// These tests exercise state, approval and persistence contracts, not video rendering.
// Where a valid API request starts a render, its queue handoff is explicitly recorded.
config.apiKey='';config.model='';
const now='2026-09-27T00:00:00.000Z';
function fixtureAsset(root:string):Asset {
  return {id:'asset-fixture',name:'fixture.mp4',file_path:path.join(root,'private-source.mp4'),url:'/media/assets/fixture/source.mp4',thumbnail_url:'/media/assets/fixture/thumbnail.jpg',duration_ms:6000,width:1080,height:1920,fps:30,has_audio:true,sha256:'a'.repeat(64),created_at:now,shots:[{id:'shot-fixture',asset_id:'asset-fixture',start_ms:0,end_ms:6000,summary:'用户标注的授权测试片段',transcript:'原始字幕',evidence:{type:'user_annotation',description:'测试输入的时间码',confidence:1}}],warnings:[]};
}
function fixtureEDL(asset:Asset,version=1):EDL {
  return {schema_version:'1.0',version,clips:[{id:'clip-1',asset_id:asset.id,start_ms:0,end_ms:2000,purpose:'第一段',caption:'原始字幕',evidence:asset.shots[0].evidence,locked:false},{id:'clip-2',asset_id:asset.id,start_ms:2000,end_ms:4000,purpose:'第二段',caption:'',evidence:asset.shots[0].evidence,locked:false}],aspect_ratio:'9:16',resolution:'720p',fps:30,title:'',cta:'',audio_gain:1,subtitles:true};
}
function fixtureTask(asset:Asset):Task {
  const task=newTask(normalizeBrief({request:'使用人工标注的片段，剪成4秒',duration_ms:4000}),[asset.id]);
  snapshot(task,fixtureEDL(asset),'测试初始版本');task.state='WAITING_PLAN_APPROVAL';return task;
}
async function httpFixture(){
  const root=await mkdtemp(path.join(tmpdir(),'cutflow-http-'));
  const {app,store,harness}=createApp(root);
  harness.enqueuePatchPreview=(t)=>{const p=t.pending_patch!;p.preview={id:'test-preview',status:'ready',progress:100,base_digest:edlDigest(t.edl!),candidate_digest:edlDigest(p.edl),created_at:now,regions:revisionRegions(t.edl!,p.edl).map(r=>({...r,before:{url:'/media/test-before.mp4',sha256:'test',duration_ms:1000,qa:{passed:true,checks:[],issues:[],checked_at:now}},after:{url:'/media/test-after.mp4',sha256:'test',duration_ms:1000,qa:{passed:true,checks:[],issues:[],checked_at:now}}}))};return store.save(t);};
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const asset=fixtureAsset(root);store.saveAsset(asset);
  async function request(method:string,route:string,body?:unknown,headers:Record<string,string>={}){
    const response=await fetch(url+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,text};
  }
  async function close(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));store.close();await rm(root,{recursive:true,force:true});}
  return {root,url,store,harness,asset,request,close};
}

test('HTTP recipes persist through creation, annotation snapshot and planning trace',async()=>{
 const f=await httpFixture();
 try{
  const a=f.asset;
  const shots=[{...a.shots[0],id:'ad-before',start_ms:0,end_ms:2000,ad_roles:['before'],comparison_group:'椅子 A'},{...a.shots[0],id:'ad-after',start_ms:2000,end_ms:4000,ad_roles:['after'],comparison_group:'椅子 A'}];
  const saved=await f.request('PUT',`/api/assets/${a.id}/shots`,{shots});assert.equal(saved.status,200);assert.deepEqual(saved.data.shots[0].ad_roles,['before']);
  const created=await f.request('POST','/api/tasks',{brief:{request:'四秒对比',duration_ms:4000,recipe:'before_after'},asset_ids:[a.id]});
  assert.equal(created.data.brief.recipe,'before_after');assert.equal(created.data.asset_shots[a.id][0].comparison_group,'椅子 A');
  const planned=await f.request('POST',`/api/tasks/${created.data.id}/plan`,{});
  assert.equal(planned.status,200);assert.equal(planned.data.plan.recipe_match.resolved,'before_after');assert.equal(planned.data.edl.subtitles,false);
  assert.equal(planned.data.events.find((e:any)=>e.type==='plan.ready')?.data.recipe_match.requested,'before_after');
  assert.equal((await f.request('POST','/api/tasks',{brief:{request:'x',recipe:'invented'},asset_ids:[a.id]})).status,400);
  assert.equal((await f.request('PUT',`/api/assets/${a.id}/shots`,{shots:[{...shots[0],ad_roles:['invented']}]})).status,400);
 }finally{await f.close();}
});

test('HTTP text switch versions the project, persists defaults and respects approval and locks',async()=>{
 const f=await httpFixture();
 try{
  const created=await f.request('POST','/api/tasks',{brief:{request:'剪成4秒'},asset_ids:[f.asset.id]});
  assert.equal(created.data.brief.subtitles,false);
  const route=`/api/tasks/${created.data.id}`;
  const plan=await f.request('POST',`${route}/plan`,{});assert.equal(plan.data.edl.subtitles,false);
  const original=structuredClone(plan.data.edl);
  let queued=0;f.harness.enqueue=(t)=>{queued++;return f.store.save(t);};
  const enabled=await f.request('POST',`${route}/text-display`,{enabled:true,version:1});
  assert.equal(enabled.status,200);assert.equal(enabled.data.edl.version,2);assert.equal(enabled.data.edl.subtitles,true);
  assert.equal(enabled.data.brief.subtitles,true);assert.equal(enabled.data.state,'WAITING_PLAN_APPROVAL');assert.equal(queued,0);
  assert.deepEqual(enabled.data.edl.clips,original.clips);assert.equal(enabled.data.edl.audio_gain,original.audio_gain);assert.deepEqual(enabled.data.versions[0].edl,original);
  assert.equal((await f.request('POST',`${route}/text-display`,{enabled:false,version:1})).data.error.code,'STALE_VERSION');
  const t=f.store.task(created.data.id)!;t.plan_approved_version=2;t.state='WAITING_USER_REVIEW';f.store.save(t);
  await f.request('POST','/api/settings',{confirm_text_plan:false});
  const disabled=await f.request('POST',`${route}/text-display`,{enabled:false,version:2});assert.equal(disabled.status,200);assert.equal(disabled.data.edl.subtitles,false);assert.equal(queued,1);
  const locked=f.store.task(created.data.id)!;locked.edl!.clips[0].locked=true;f.store.save(locked);
  assert.equal((await f.request('POST',`${route}/text-display`,{enabled:true,version:3})).data.error.code,'LOCK_CONFLICT');
  assert.equal(f.store.task(created.data.id)!.edl!.subtitles,false);
 }finally{await f.close();}
});

test('HTTP action annotations validate evidence, freeze per project and reject destructive trims',async()=>{
  const f=await httpFixture();
  try{
    const shot={...f.asset.shots[0],intent:{message:'喝过咖啡后的停留',key_action:'举杯、喝下、放下杯子',action_start_ms:2500,action_end_ms:4500,pre_roll_ms:500,post_roll_ms:500,priority:5,required:true,evidence:{description:'源片 2 秒开始举杯，4.5 秒放下杯子',observed_at_ms:[2000,4500]}}};
    const route=`/api/assets/${f.asset.id}/shots`;
    const badRange=await f.request('PUT',route,{shots:[{...shot,intent:{...shot.intent,post_roll_ms:2000}}]});
    assert.equal(badRange.data.error.code,'INVALID_INTENT_RANGE');
    const badEvidence=await f.request('PUT',route,{shots:[{...shot,intent:{...shot.intent,evidence:{description:'重复时间不能证明动作完成',observed_at_ms:[2500,2500]}}}]});
    assert.equal(badEvidence.data.error.code,'INVALID_INTENT_EVIDENCE');
    assert.equal(f.store.asset(f.asset.id)!.shots[0].intent,undefined);
    assert.equal((await f.request('PUT',route,{shots:[shot]})).status,200);
    const created=await f.request('POST','/api/tasks',{brief:{request:'剪成4秒，完整保留喝咖啡',duration_ms:4000},asset_ids:[f.asset.id]});
    const taskRoute=`/api/tasks/${created.data.id}`;
    const plan=await f.request('POST',`${taskRoute}/plan`,{});
    assert.equal(plan.status,200);assert.equal(plan.data.plan.editorial_review.status,'protected');
    const clip=plan.data.edl.clips[0];assert(clip.start_ms<=2000&&clip.end_ms>=5000);
    const oldVersion=structuredClone(plan.data.edl);
    await f.request('PUT',route,{shots:[f.asset.shots[0]]});
    const blocked=await f.request('POST',`${taskRoute}/revise`,{feedback:'第1镜头保留前1秒',base_version:1});
    assert.equal(blocked.status,422);assert.equal(blocked.data.error.code,'KEY_ACTION_CUT');
    const persisted=f.store.task(created.data.id)!;
    assert.deepEqual(persisted.edl,oldVersion);assert.equal(persisted.asset_shots![f.asset.id][0].intent!.key_action,shot.intent.key_action);
    assert.equal((await f.request('POST',`/api/assets/${f.asset.id}/analyze-actions`,{})).data.error.code,'MODEL_NOT_CONFIGURED');
  }finally{await f.close();}
});

test('HTTP local-only guard, private settings and source boundaries',async()=>{
  const f=await httpFixture();
  try{
    assert.equal((await f.request('GET','/api/health')).status,200);
    assert.equal((await f.request('GET','/api/health',undefined,{Origin:'https://foreign.example'})).status,403);
    const badHost=await new Promise<number>((resolve,reject)=>{const req=httpRequest(f.url+'/api/health',{headers:{Host:'foreign.example'}},response=>{response.resume();resolve(response.statusCode!);});req.on('error',reject);req.end();});
    assert.equal(badHost,403);
    const secret='test-credential-do-not-return';
    const configured=await f.request('POST','/api/settings',{model_api_key:secret,model_name:'fixture-model'});
    assert.equal(configured.status,200);assert.equal(configured.data.model_configured,true);
    assert(!configured.text.includes(secret));assert(!(await f.request('GET','/api/settings')).text.includes(secret));
    const changed=await f.request('POST','/api/settings',{model_base_url:'https://another-provider.example/v1'});
    assert.equal(changed.data.model_configured,false,'changing provider clears the existing API key');
    assert.equal((await f.request('POST','/api/settings',{model_base_url:'http://remote.example/v1'})).status,400);
    assert.equal((await f.request('POST','/api/settings',{model_base_url:'https://user:password@example.com/v1'})).status,400);
    assert.equal((await f.request('POST','/api/settings',{model_base_url:'https://example.com/v1?api_key=secret'})).status,400);
    const assets=await f.request('GET','/api/assets');assert.equal(assets.data[0].file_path,'');assert(!assets.text.includes(f.root));
    const invalid=await f.request('PUT',`/api/assets/${f.asset.id}/shots`,{shots:[{start_ms:0,end_ms:7000,summary:'越界'}]});
    assert.equal(invalid.status,400);assert.equal(invalid.data.error.code,'INVALID_SHOT_RANGE');
    assert.equal(f.store.asset(f.asset.id)?.shots[0].end_ms,6000,'failed updates do not persist');
    const valid=await f.request('PUT',`/api/assets/${f.asset.id}/shots`,{shots:[{id:'manual-shot',asset_id:'unauthorized-asset',start_ms:500,end_ms:5000,summary:'人工标注',evidence:{type:'model_vision',confidence:1}}]});
    assert.equal(valid.status,200);assert.equal(valid.data.shots[0].asset_id,f.asset.id);assert.equal(valid.data.shots[0].evidence.type,'user_annotation');
    const missing=await f.request('POST','/api/tasks',{brief:{request:'测试'},asset_ids:['missing']});
    assert.equal(missing.status,400);assert.equal(missing.data.error.code,'ASSET_NOT_FOUND');
    await writeFile(path.join(f.root,'private.txt'),'outside-media-sentinel');
    const traversal=await fetch(f.url+'/media/%2e%2e%2fprivate.txt');
    assert(!(await traversal.text()).includes('outside-media-sentinel'));
  }finally{updateSettings({model_api_key:'',model_name:'',model_base_url:'https://api.openai.com/v1'});await f.close();}
});

test('HTTP plan and preview approvals are tied to current versions and QA',async()=>{
  const f=await httpFixture();
  try{
    const created=await f.request('POST','/api/tasks',{brief:{request:'测试4秒剪辑',duration_ms:4000},asset_ids:[f.asset.id]});
    assert.equal(created.status,201);const id=created.data.id;
    assert.equal((await f.request('POST',`/api/tasks/${id}/approve-plan`,{version:1})).status,409);
    const planned=await f.request('POST',`/api/tasks/${id}/plan`,{});
    assert.equal(planned.status,200);assert.equal(planned.data.state,'WAITING_PLAN_APPROVAL');assert.equal(planned.data.plan.mode,'rules');
    assert.equal((await f.request('POST',`/api/tasks/${id}/approve-plan`,{version:99})).data.error.code,'STALE_VERSION');
    assert.equal((await f.request('POST',`/api/tasks/${id}/approve-preview`,{version:1})).data.error.code,'PREVIEW_NOT_READY');
    const queued:{quality:string;version:number;approved?:number}[]=[];
    f.harness.enqueue=(task,quality)=>{queued.push({quality,version:task.edl!.version,approved:quality==='final'?task.preview_approved_version:task.plan_approved_version});return f.store.save(task);};
    const approved=await f.request('POST',`/api/tasks/${id}/approve-plan`,{version:1,candidate_digest:planned.data.plan.text_review.candidate_digest});
    assert.equal(approved.status,200);assert.deepEqual(queued,[{quality:'preview',version:1,approved:1}]);
    let task=f.store.task(id)!;task.state='WAITING_USER_REVIEW';task.qa={passed:true,checks:[],issues:[],checked_at:now};task.artifacts=[{kind:'preview',version:99,url:'/media/fake-old-preview.mp4',path:path.join(f.root,'fake-old-preview.mp4')}];f.store.save(task);
    assert.equal((await f.request('POST',`/api/tasks/${id}/approve-preview`,{version:1})).data.error.code,'PREVIEW_NOT_READY');
    task.artifacts[0].version=1;task.qa.passed=false;f.store.save(task);
    assert.equal((await f.request('POST',`/api/tasks/${id}/approve-preview`,{version:1})).data.error.code,'PREVIEW_NOT_READY');
    task.qa.passed=true;f.store.save(task);
    const final=await f.request('POST',`/api/tasks/${id}/approve-preview`,{version:1});
    assert.equal(final.status,200);assert.deepEqual(queued[1],{quality:'final',version:1,approved:1});
    const trace=await f.request('GET',`/api/tasks/${id}/trace`);
    assert.equal(trace.status,200);assert(!trace.text.includes(f.root));assert.equal(trace.data.workflow_status,'not_replayed_not_published');
    assert.equal(trace.data.validated_trace,false,'approval alone does not claim a validated delivery');
  }finally{await f.close();}
});

test('HTTP locks, patches and rollback retain immutable historical EDLs',async()=>{
  const f=await httpFixture();
  try{
    const task=fixtureTask(f.asset);f.store.save(task);
    const route=`/api/tasks/${task.id}`;const first=structuredClone(task.versions[0].edl);
    const locked=await f.request('POST',`${route}/lock`,{clip_id:'clip-1',locked:true,version:1});
    assert.equal(locked.status,200);assert.equal(locked.data.edl.version,2);assert.equal(locked.data.edl.clips[0].locked,true);
    assert.deepEqual(locked.data.versions[0].edl,first);
    assert.equal((await f.request('POST',`${route}/plan`,{})).data.error.code,'LOCK_CONFLICT');
    const blocked=await f.request('POST',`${route}/revise`,{feedback:'第1镜头字幕改为：不可修改',base_version:2});
    assert.equal(blocked.data.error.code,'LOCK_CONFLICT');
    assert.equal((await f.request('POST',`${route}/lock`,{clip_id:'clip-1',locked:false,version:1})).data.error.code,'STALE_VERSION');
    const unlocked=await f.request('POST',`${route}/lock`,{clip_id:'clip-1',locked:false,version:2});
    assert.equal(unlocked.status,200);assert.equal(unlocked.data.edl.version,3);assert.equal(unlocked.data.versions[1].edl.clips[0].locked,true);
    const proposed=await f.request('POST',`${route}/revise`,{feedback:'第2镜头字幕改为：明确的新字幕',base_version:3});
    assert.equal(proposed.status,200);assert.equal(proposed.data.edl.version,3);assert.equal(proposed.data.edl.clips[1].caption,'');
    assert.equal(proposed.data.pending_patch.preview,undefined);
    const confirmed=await f.request('POST',`${route}/approve-patch-plan`,{patch_id:proposed.data.pending_patch.id,base_version:3,candidate_digest:proposed.data.pending_patch.text_review.candidate_digest});
    assert.equal(confirmed.status,200);const patch=confirmed.data.pending_patch;
    assert.equal(patch.base_version,3);assert.equal(patch.edl.version,4);
    assert.equal((await f.request('POST',`${route}/apply-patch`,{patch_id:patch.id,base_version:2})).data.error.code,'STALE_PATCH');
    const queued:string[]=[];f.harness.enqueue=(value,quality)=>{queued.push(quality);return f.store.save(value);};
    const applied=await f.request('POST',`${route}/apply-patch`,{patch_id:patch.id,base_version:3,preview_id:patch.preview.id});
    assert.equal(applied.status,200);assert.equal(applied.data.edl.version,4);assert.equal(applied.data.edl.clips[1].caption,'明确的新字幕');assert.equal(applied.data.plan_approved_version,4);
    assert.equal(applied.data.preview_approved_version,undefined);assert.equal(applied.data.qa,undefined);assert.equal(applied.data.pending_patch,undefined);
    assert.deepEqual(applied.data.versions[0].edl,first);assert.equal(applied.data.versions[2].edl.clips[1].caption,'');
    assert.equal((await f.request('POST',`${route}/apply-patch`,{patch_id:patch.id,base_version:3,preview_id:patch.preview.id})).data.error.code,'STALE_PATCH');
    const restored=await f.request('POST',`${route}/rollback`,{version:1});
    assert.equal(restored.status,200);assert.equal(restored.data.edl.version,5);assert.equal(restored.data.edl.clips[1].caption,'');
    assert.deepEqual(restored.data.versions[0].edl,first);assert.equal(restored.data.versions[3].edl.clips[1].caption,'明确的新字幕');assert.deepEqual(queued,['preview','preview']);
  }finally{await f.close();}
});

test('locked EDL rejects silent unlock, movement and global presentation changes',()=>{
  const asset=fixtureAsset('/tmp/fixture');const previous=fixtureEDL(asset);previous.clips[1].locked=true;
  for(const mutate of [
    (edl:EDL)=>{edl.clips[1].locked=false;},
    (edl:EDL)=>{edl.clips[0].end_ms=1000;},
    (edl:EDL)=>{edl.audio_gain=0;},
    (edl:EDL)=>{edl.subtitles=false;},
    (edl:EDL)=>{edl.aspect_ratio='16:9';},
  ]){const next=structuredClone(previous);next.version++;mutate(next);assert.throws(()=>validateEDL(next,[asset],previous),{code:'LOCK_CONFLICT'});}
  const allowed=structuredClone(previous);allowed.version++;allowed.clips[0].caption='未锁定的字幕';
  assert.doesNotThrow(()=>validateEDL(allowed,[asset],previous));
});

test('queue cancellation releases a waiting task so it can be retried',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cutflow-queue-'));const store=new Store(root);const harness=new Harness(store,path.join(root,'media'));
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});const started:string[]=[];
  // Replace only the media execution boundary; exercise the real queue/cancel/idle code.
  (harness as unknown as {execute:(job:{taskId:string})=>Promise<void>}).execute=async job=>{started.push(job.taskId);await barrier;};
  try{
    const asset=fixtureAsset(root);store.saveAsset(asset);
    const first=fixtureTask(asset),second=fixtureTask(asset);
    for(const task of [first,second]){task.plan_approved_version=1;store.save(task);}
    harness.enqueue(first,'preview');harness.enqueue(second,'preview');
    assert.deepEqual(started,[first.id]);
    harness.cancel(second.id);assert.equal(store.task(second.id)?.state,'CANCELLED');
    assert.doesNotThrow(()=>harness.idle(harness.get(second.id)),'cancelled queued job must not remain permanently busy');
    harness.enqueue(harness.get(second.id),'preview');
    assert.throws(()=>harness.idle(harness.get(second.id)),{code:'TASK_BUSY'});
    release();await nextTurn();await nextTurn();
    assert.deepEqual(started,[first.id,second.id]);assert.doesNotThrow(()=>harness.idle(harness.get(second.id)));
  }finally{release();await nextTurn();store.close();await rm(root,{recursive:true,force:true});}
});

test('direct harness cannot render without approvals; SQLite restart retains versions and marks interruptions',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cutflow-recovery-'));let store=new Store(root);
  try{
    const asset=fixtureAsset(root);store.saveAsset(asset);const harness=new Harness(store,path.join(root,'media'));const task=fixtureTask(asset);store.save(task);
    assert.throws(()=>harness.enqueue(task,'preview'),{code:'PLAN_APPROVAL_REQUIRED'});
    task.plan_approved_version=1;assert.throws(()=>harness.enqueue(task,'final'),{code:'PREVIEW_APPROVAL_REQUIRED'});
    task.preview_approved_version=1;task.qa={passed:false,checks:[],issues:[],checked_at:now};assert.throws(()=>harness.enqueue(task,'final'),{code:'PREVIEW_APPROVAL_REQUIRED'});
    task.state='RENDERING_FINAL';task.qa.passed=true;store.save(task);const history=structuredClone(task.versions);
    store.close();store=new Store(root);store.recover();
    const restored=store.task(task.id)!;assert.equal(restored.state,'FAILED');assert.equal(restored.error?.code,'PROCESS_INTERRUPTED');assert.equal(restored.error?.stage,'RENDERING_FINAL');assert.equal(restored.error?.retryable,true);
    assert.deepEqual(restored.versions,history);assert.equal(restored.plan_approved_version,1);assert.equal(restored.preview_approved_version,1);assert.equal(restored.qa?.passed,true);assert.equal(store.asset(asset.id)?.sha256,asset.sha256);
    const eventCount=restored.events.length;store.recover();assert.equal(store.task(task.id)?.events.length,eventCount,'recovery is idempotent');
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('project keeps its approved evidence snapshot when library annotations change',async()=>{
 const f=await httpFixture();
 try{
  const created=await f.request('POST','/api/tasks',{brief:{request:'剪成4秒',subtitles:true},asset_ids:[f.asset.id]});const id=created.data.id;
  const planned=await f.request('POST',`/api/tasks/${id}/plan`,{});assert.equal(planned.status,200);
  const original=structuredClone(planned.data.edl.clips[0].evidence);
  const updated=await f.request('PUT',`/api/assets/${f.asset.id}/shots`,{shots:[{start_ms:4500,end_ms:6000,summary:'素材库后来补充的其他片段'}]});assert.equal(updated.status,200);
  const patch=await f.request('POST',`/api/tasks/${id}/revise`,{feedback:'第1镜头字幕改为：项目独立的版本',base_version:1});assert.equal(patch.status,200);
  assert.deepEqual(patch.data.pending_patch.edl.clips[0].evidence,original);
  assert.equal(f.harness.assets(f.harness.get(id))[0].shots[0].start_ms,0);
  assert.equal(f.store.asset(f.asset.id)!.shots[0].start_ms,4500);
 }finally{await f.close();}
});
