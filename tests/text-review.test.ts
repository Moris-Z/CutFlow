import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createServer} from 'node:http';
import {createApp} from '../server/server.js';
import {Store} from '../server/store.js';
import {newTask,snapshot} from '../server/harness.js';
import {createPatch,normalizeBrief} from '../server/planner.js';
import {assertRequestedChanges,assertTextReview,textReview} from '../server/revision-changes.js';
import {edlDigest} from '../server/revisions.js';
import {config} from '../server/settings.js';
import {EDLSchema,type Asset,type EDL,type Task} from '../shared/types.js';
const asset:Asset={id:'a',name:'source.mp4',file_path:'/tmp/source.mp4',url:'',thumbnail_url:'',duration_ms:12000,width:1280,height:720,fps:30,has_audio:true,sha256:'test',created_at:'',warnings:[],shots:[{id:'s',asset_id:'a',start_ms:0,end_ms:12000,summary:'授权标注',evidence:{type:'user_annotation',description:'人工时间码',confidence:1}}]};
const edl=():EDL=>EDLSchema.parse({schema_version:'1.0',version:1,clips:[0,1,2].map(i=>({id:`c${i}`,asset_id:'a',shot_id:'s',start_ms:i*3000,end_ms:(i+1)*3000,purpose:`原定镜头目的${i}`,caption:`已有字幕${i}`,evidence:asset.shots[0].evidence})),aspect_ratio:'16:9',resolution:'720p',fps:30,subtitles:true});
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'cutflow-text-review-')),{app,store,harness}=createApp(root);store.saveAsset(asset);
 const full:number[]=[],local:string[]=[];
 harness.enqueue=(t)=>{full.push(t.edl!.version);return store.save(t);};
 harness.enqueuePatchPreview=(t)=>{assertTextReview(t.pending_patch!.text_review,t.pending_patch!.edl,t.edl);assertRequestedChanges(t.edl!,t.pending_patch!.edl,t.pending_patch!.constraints!);local.push(t.pending_patch!.id);return store.save(t);};
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const request=async(route:string,body?:unknown)=>{const r=await fetch(url+'/api'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 const seed=()=>{const t=newTask(normalizeBrief({request:'九秒测试'}),['a']);snapshot(t,edl(),'test');t.state='WAITING_USER_REVIEW';t.plan_approved_version=1;return store.save(t);};
 return {root,store,harness,request,seed,full,local,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(root,{recursive:true,force:true});}};
}

test('platform switch defaults on, persists per store and rejects invalid values',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/settings')).data.confirm_text_plan,true);
  assert.equal((await f.request('/settings',{confirm_text_plan:'false'})).status,400);assert.equal(f.store.confirmTextPlan(),true);
  assert.equal((await f.request('/settings',{confirm_text_plan:false})).data.confirm_text_plan,false);
  const reopened=new Store(f.root);assert.equal(reopened.confirmTextPlan(),false);reopened.close();
  await f.request('/settings',{renderer:'ffmpeg'});assert.equal((await f.request('/settings')).data.confirm_text_plan,false);
  assert.equal((await f.request('/settings',{confirm_text_plan:true})).data.confirm_text_plan,true);
 }finally{await f.close();}
});

test('first plan waits for exact text confirmation; disabled mode starts only newly requested plans',async()=>{
 const f=await fixture();try{
  const create=async()=> (await f.request('/tasks',{brief:{request:'剪成6秒',duration_ms:6000},asset_ids:['a']})).data;
  const t=await create(),route=`/tasks/${t.id}`;const p=(await f.request(route+'/plan',{})).data;
  assert.equal(p.state,'WAITING_PLAN_APPROVAL');assert.equal(p.plan.text_review.required,true);assert.equal(f.full.length,0);
  assert.equal((await f.request(route+'/approve-plan',{version:1,candidate_digest:'old'})).data.error.code,'STALE_TEXT_PLAN');assert.equal(f.full.length,0);
  await f.request('/settings',{confirm_text_plan:false});assert.equal(f.full.length,0,'changing preference does not execute a waiting plan');
  const approved=await f.request(route+'/approve-plan',{version:1,candidate_digest:p.plan.text_review.candidate_digest});assert.equal(approved.status,200);assert.deepEqual(f.full,[1]);
  const fresh=await create(),auto=(await f.request(`/tasks/${fresh.id}/plan`,{})).data;assert.equal(auto.plan.text_review.required,false);assert.equal(f.full.length,2);
  assert(auto.events.some((e:any)=>e.type==='plan.confirmation.skipped'));assert(!auto.events.some((e:any)=>e.type==='approval.plan'));
 }finally{await f.close();}
});

test('revision text plan preserves original, cannot be bypassed by retry or settings, and is reset by a new suggestion',async()=>{
 const f=await fixture();try{
  const t=f.seed(),before=structuredClone(t),route=`/tasks/${t.id}`;
  const p=(await f.request(route+'/revise',{feedback:'第2镜头音量50%',base_version:1})).data.pending_patch;
  const checkpoint=new Store(f.root);checkpoint.recover();assert.equal(checkpoint.task(t.id)!.pending_patch!.text_review!.required,true);assert.equal(checkpoint.task(t.id)!.pending_patch!.text_review!.approved_digest,undefined);checkpoint.close();
  assert.equal(p.preview,undefined);assert.equal(f.local.length,0);assert.deepEqual(p.changes,[{target:'镜头 2',field:'音量',before:'100%',after:'50%'}]);
  const current=f.store.task(t.id)!;assert.deepEqual(current.edl,before.edl);assert.deepEqual(current.versions,before.versions);assert.equal(current.state,before.state);
  assert.equal((await f.request(route+'/patch-preview',{patch_id:p.id,base_version:1})).data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  assert.equal((await f.request(route+'/apply-patch',{patch_id:p.id,base_version:1})).data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  await f.request('/settings',{confirm_text_plan:false});
  assert.equal((await f.request(route+'/patch-preview',{patch_id:p.id,base_version:1})).data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  assert.equal((await f.request(route+'/approve-patch-plan',{patch_id:p.id,base_version:1,candidate_digest:'old'})).data.error.code,'STALE_TEXT_PLAN');
  const confirmed=await f.request(route+'/approve-patch-plan',{patch_id:p.id,base_version:1,candidate_digest:p.text_review.candidate_digest});assert.equal(confirmed.status,200);assert.equal(f.local.length,1);
  assert.deepEqual(f.store.task(t.id)!.edl,before.edl);
  await f.request('/settings',{confirm_text_plan:true});const newer=(await f.request(route+'/revise',{feedback:'第2镜头音量40%',base_version:1})).data.pending_patch;
  assert.notEqual(newer.id,p.id);assert.equal(newer.text_review.approved_digest,undefined);assert.equal(f.local.length,1);
  assert.equal((await f.request(route+'/approve-patch-plan',{patch_id:p.id,base_version:1,candidate_digest:p.text_review.candidate_digest})).data.error.code,'STALE_PATCH');
  await f.request(route+'/discard-patch',{patch_id:newer.id,base_version:1});assert.equal(f.store.task(t.id)!.pending_patch,undefined);assert.deepEqual(f.store.task(t.id)!.edl,before.edl);
  await f.request('/settings',{confirm_text_plan:false});const direct=(await f.request(route+'/revise',{feedback:'第2镜头音量30%',base_version:1})).data.pending_patch;assert.equal(direct.text_review.required,false);assert.equal(f.local.length,2);
  const reopen=new Store(f.root);assert.equal(reopen.task(t.id)!.pending_patch!.text_review!.required,false);reopen.close();
 }finally{await f.close();}
});

test('even the selected shot can change only the requested fields; global scope is not blanket permission',async()=>{
 const e=edl(),local=await createPatch(e,[asset],'第2镜头音量50%');
 for(const change of [(n:EDL)=>n.clips[1].caption='顺带优化字幕',(n:EDL)=>n.clips[1].start_ms+=100,(n:EDL)=>n.clips[1].purpose='顺带优化目的',(n:EDL)=>n.clips.reverse(),(n:EDL)=>n.clips.pop()]){
  const candidate=structuredClone(local.edl);change(candidate);assert.throws(()=>assertRequestedChanges(e,candidate,local.constraints!),{code:'UNREQUESTED_CHANGE'});
 }
 const global=await createPatch(e,[asset],'全片原声音量50%');const bad=structuredClone(global.edl);bad.clips[0].caption='未要求的字幕';assert.throws(()=>assertRequestedChanges(e,bad,global.constraints!),{code:'UNREQUESTED_CHANGE'});
 const negative=await createPatch(e,[asset],'第1镜头保留前2秒，不要改第2镜头的字幕和音量');assert.deepEqual(negative.scope!.clip_ids,['c0']);assert.deepEqual(negative.edl.clips.slice(1),e.clips.slice(1));
 const literal=await createPatch(e,[asset],'第1镜头字幕改为：“只保留字幕，删除标题，不要改动你的梦想”');assert.equal(literal.edl.clips[0].caption,'只保留字幕，删除标题，不要改动你的梦想');assert.equal(literal.edl.title,e.title);
 const quoted=await createPatch(e,[asset],'第1镜头字幕改为：“第3镜头音量50%”');assert.deepEqual(quoted.scope!.clip_ids,['c0']);assert.equal(quoted.edl.clips[0].caption,'第3镜头音量50%');
 await assert.rejects(()=>createPatch(e,[asset],'第1镜头保留前2秒，第2镜头音量50%'),{code:'REVISION_NEEDS_SPLIT'});
});

test('negative audio instructions never become commands or expand the selected scope',async()=>{
 const e=edl();
 for(const feedback of ['第2镜头不要静音','第2镜头别关闭原声','第2镜头不要去掉原声','第2镜头不静音','第2镜头不能静音']){
  await assert.rejects(()=>createPatch(e,[asset],feedback),{code:'NO_CHANGE'},feedback);
 }
 const p=await createPatch(e,[asset],'第1镜头音量50%，第2镜头不要静音');
 assert.deepEqual(p.scope!.clip_ids,['c0']);assert.equal(p.edl.clips[0].audio_gain,0.5);
 assert.deepEqual(p.edl.clips.slice(1),e.clips.slice(1));
 const caption=await createPatch(e,[asset],'第1镜头字幕改为：“不要静音，听见你的声音”');
 assert.equal(caption.edl.clips[0].caption,'不要静音，听见你的声音');
});

test('repeated volume requests cannot silently assign the first value to every target',async()=>{
 const e=edl();
 await assert.rejects(()=>createPatch(e,[asset],'第1镜头音量50%，第2镜头音量80%'),{code:'REVISION_NEEDS_SPLIT'});
 const same=await createPatch(e,[asset],'第1镜头和第2镜头音量50%');
 assert.equal(same.edl.clips[0].audio_gain,0.5);assert.equal(same.edl.clips[1].audio_gain,0.5);
 assert.deepEqual(same.edl.clips[2],e.clips[2]);
});

test('ambiguous or preservation-only feedback never saves a partial proposal or starts rendering',async()=>{
 const f=await fixture();try{
  const task=f.seed(),route=`/tasks/${task.id}`;
  await f.request(route+'/revise',{feedback:'第3镜头音量60%',base_version:1});
  const before=structuredClone(f.store.task(task.id));
  for(const confirm_text_plan of [true,false]){
   await f.request('/settings',{confirm_text_plan});
   for(const feedback of ['第2镜头不要静音','第1镜头音量50%，第2镜头音量80%']){
    const response=await f.request(route+'/revise',{feedback,base_version:1});
    assert(response.status>=400);assert.deepEqual(f.store.task(task.id),before);
   }
  }
  assert.equal(f.full.length,0);assert.equal(f.local.length,0);
 }finally{await f.close();}
});

test('model receives field permissions and unrelated edits are rejected before a proposal is saved',async()=>{
 const original=edl();let malicious=true;
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);const input=JSON.parse(body.messages[1].content);
  assert.deepEqual(input.constraints.clip_fields,['start_ms','end_ms']);assert.deepEqual(input.constraints.global_fields,[]);
  const next=structuredClone(original);next.clips[1].end_ms-=400;if(malicious)next.clips[1].caption='擅自重写';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'缩短选定镜头',edl:next})}}]}));
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const previous={...config};Object.assign(config,{apiKey:'test-only',model:'test',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`});
 try{await assert.rejects(()=>createPatch(original,[asset],'第2镜头节奏快一点'),{code:'UNREQUESTED_CHANGE'});malicious=false;const allowed=await createPatch(original,[asset],'第2镜头节奏快一点');assert.equal(allowed.edl.clips[1].caption,original.clips[1].caption);assert.equal(allowed.changes!.length,1);
  const review=textReview(allowed.edl,true,original);review.approved_digest=review.candidate_digest;allowed.edl.clips[1].end_ms-=100;assert.throws(()=>assertTextReview(review,allowed.edl,original),{code:'STALE_TEXT_PLAN'});
 }finally{Object.assign(config,previous);await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('locking an unrendered shot retains a confirmable current text plan',async()=>{
 const f=await fixture();try{
  const created=(await f.request('/tasks',{brief:{request:'剪成6秒'},asset_ids:['a']})).data;
  const route=`/tasks/${created.id}`,p=(await f.request(route+'/plan',{})).data;
  const locked=(await f.request(route+'/lock',{version:1,clip_id:p.edl.clips[0].id,locked:true})).data;
  assert.equal(locked.edl.version,2);assert.equal(locked.plan.text_review.candidate_digest,edlDigest(locked.edl));
  assert.equal((await f.request(route+'/approve-plan',{version:2,candidate_digest:locked.plan.text_review.candidate_digest})).status,200);assert.deepEqual(f.full,[2]);
 }finally{await f.close();}
});
