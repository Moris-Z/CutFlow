import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/server';
import {Store} from '../server/store';
import {updateSettings} from '../server/settings';
import {searchIntent} from '../server/search-intent';
import {basicSearchTerms,type SearchDependencies,type StockCandidate} from '../server/source-search';
import type {Asset,Task} from '../shared/types';
updateSettings({model_api_key:'',model_name:''});
const prompt='帮我生成一个植物大战僵尸的广告视频，要求有趣有故事性，视频最后可以引导用户点击左下角了解下载立即去玩';
const candidate:StockCandidate={title:'Coffee',description:'Serving coffee',source_url:'https://mixkit.co/free-stock-video/serving-coffee-123/',download_url:'https://assets.mixkit.co/videos/123/123-1080.mp4',license_url:'https://mixkit.co/license/#videoFree'};
const asset:Asset={id:'fixture',name:'fixture.mp4',file_path:'/fixture.mp4',url:'/media/fixture.mp4',thumbnail_url:'/media/thumbnail.jpg',duration_ms:10000,width:1920,height:1080,fps:30,has_audio:false,sha256:'fixture',created_at:'2026-10-08T00:00:00Z',warnings:[],shots:[{id:'shot',asset_id:'fixture',start_ms:0,end_ms:10000,summary:'未分析的视频',evidence:{type:'metadata',description:'文件元数据',confidence:1}}]};
async function fixture(search:SearchDependencies={discover:async()=>[]}){
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-preparation-'));
 const {app,store,preparation}=createApp(root,{search:{discoverGame:search.discover,...search}}),server=app.listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 const request=async(route:string,body?:unknown,method=body?'POST':'GET')=>{const response=await fetch(base+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 const create=(requestText=prompt,asset_ids:string[]=[])=>request('/tasks',{brief:{request:requestText,duration_ms:3000},asset_ids,prepare:true});
 return {root,store,preparation,request,create,close:async()=>{await preparation.settled();await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}};
}
test('named game intent survives Chinese prompts, aliases and exact subject corrections',()=>{
 assert.equal(searchIntent(prompt).subject,'植物大战僵尸');assert.equal(searchIntent(prompt).kind,'game');assert.deepEqual(basicSearchTerms(prompt),['plants-vs-zombies']);
 assert.equal(searchIntent('请做一个有趣的游戏广告').subject,'');assert.equal(searchIntent('英雄联盟').subject,'英雄联盟');
 assert.equal(searchIntent(prompt+'\n补充需求：改成推广咖啡').subject,'咖啡');assert.deepEqual(basicSearchTerms(prompt+'\n补充需求：改成推广咖啡'),['coffee']);
});
test('no-material submit returns a persisted project before network finishes and rejects duplicate preparation',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let lookups=0;
 const f=await fixture({discover:async terms=>{lookups++;assert.deepEqual(terms,['plants-vs-zombies']);await gate;return [];}});
 try{
  const created=await f.create();assert.equal(created.status,201);const id=created.data.id;
  assert.equal(created.data.brief.request,prompt);assert.equal(created.data.state,'DRAFT_BRIEF');assert.equal(created.data.name,'植物大战僵尸 · 广告视频');
  assert.match(created.data.preparation.messages[1].text,/游戏广告/);assert.equal((await f.request(`/tasks/${id}`)).status,200);
  assert.equal((await f.request(`/tasks/${id}/brief`,{retry:true})).status,409);assert.equal((await f.request(`/tasks/${id}/plan`,{})).status,409);
  release();await f.preparation.settled();const task=f.store.task(id)!;
  assert.equal(task.preparation?.status,'needs_input');assert.match(task.preparation!.message,/植物大战僵尸/);assert.doesNotMatch(task.preparation!.message,/请补充要宣传的产品/);assert.equal(task.edl,undefined);assert.equal(lookups,1);
  const reopened=new Store(f.root);try{reopened.recover();assert.deepEqual(reopened.task(id),task);}finally{reopened.close();}
 }finally{release();await f.close();}
});
test('ambiguous request is clarified inside its project; replying can find stock and produce an unapproved plan',async()=>{
 let lookups=0;
 const f=await fixture({discover:async terms=>{lookups++;assert.deepEqual(terms,['coffee']);return [candidate];},download:async()=>Buffer.from('fixture'),ingest:async()=>structuredClone(asset)});
 try{
  const created=await f.create('帮我做一个好看的视频');assert.equal(created.status,201);await f.preparation.settled();const id=created.data.id;
  assert.match(f.store.task(id)!.preparation!.message,/想宣传什么/);assert.equal(lookups,0);
  assert.equal((await f.request(`/tasks/${id}/brief`,{message:'推广咖啡'})).status,202);await f.preparation.settled();const task=f.store.task(id)!;
  assert.equal(task.state,'WAITING_PLAN_APPROVAL');assert.equal(task.preparation?.status,'ready');assert.deepEqual(task.asset_ids,[asset.id]);assert.equal(task.plan_approved_version,undefined);assert.equal(task.artifacts.length,0);assert(task.edl?.bgm);assert.equal(task.brief.subtitles,false);
  assert.match(task.brief.request,/帮我做一个好看的视频\n补充需求：推广咖啡/);assert(task.preparation.messages.some(m=>m.role==='user'&&m.text==='推广咖啡'));assert.equal(lookups,1);
  assert.equal((await f.request(`/tasks/${id}/brief`,{message:'别改已有方案'})).status,409);
 }finally{await f.close();}
});
test('irrelevant stock cannot stand in for a named game; library attachment continues the same project',async()=>{
 let downloads=0;
 const f=await fixture({discover:async()=>[candidate],download:async()=>{downloads++;return Buffer.from('fixture');}});
 try{
  const created=await f.create();await f.preparation.settled();const id=created.data.id;
  assert.equal(downloads,0);assert.equal(f.store.task(id)!.asset_ids.length,0);
  f.store.saveAsset(structuredClone(asset));
  assert.equal((await f.request(`/tasks/${id}/brief`,{asset_ids:['missing']})).status,422);
  assert.equal((await f.request(`/tasks/${id}/brief`,{asset_ids:[asset.id]})).status,202);await f.preparation.settled();
  const task=f.store.task(id)!;assert.equal(task.id,id);assert.equal(task.state,'WAITING_PLAN_APPROVAL');assert.equal(task.brief.request,prompt);assert.equal(task.plan_approved_version,undefined);
 }finally{await f.close();}
});
test('uploaded material bypasses internet search, and multiple projects queue instead of failing SEARCH_BUSY',async()=>{
 let calls=0;const f=await fixture({discover:async()=>{calls++;return [];}});
 try{
  f.store.saveAsset(structuredClone(asset));
  const ready=await f.create('剪一个3秒视频',[asset.id]);await f.preparation.settled();assert.equal(f.store.task(ready.data.id)!.state,'WAITING_PLAN_APPROVAL');assert.equal(calls,0);
  const first=await f.create(),second=await f.create();await f.preparation.settled();assert.equal(calls,2);
  for(const id of [first.data.id,second.data.id])assert.equal(f.store.task(id)!.preparation?.status,'needs_input');
 }finally{await f.close();}
});
test('interrupted project restores saved conversation without starting search or approving a plan',async()=>{
 const f=await fixture();
 try{
  const created=await f.create('帮我剪个视频');await f.preparation.settled();const task=f.store.task(created.data.id)!;task.preparation!.status='searching';f.store.save(task);
  const reopened=new Store(f.root);try{reopened.recover();const recovered=reopened.task(task.id)!;assert.equal(recovered.preparation?.status,'needs_input');assert.match(recovered.preparation!.message,/重启/);assert.equal(recovered.brief.request,task.brief.request);assert.equal(recovered.edl,undefined);}finally{reopened.close();}
 }finally{await f.close();}
});
