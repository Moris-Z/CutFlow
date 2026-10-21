import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/server';
import {Store} from '../server/store';
import {generateDemoAssets} from '../server/media';
import {importMusic,musicPath,resolveBgm} from '../server/music';

async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'cutflow-deletion-'));
  const {app,store,harness}=createApp(root),server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request=async(route:string,method='GET',body?:unknown)=>{const response=await fetch(base+'/api'+route,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
  const assets=await generateDemoAssets(path.join(root,'media','assets'));assets.forEach(a=>store.saveAsset(a));
  const task=async(bgm?:unknown)=>(await request('/tasks','POST',{name:'删除验证',brief:{request:'将素材剪成3秒广告',duration_ms:3000,...(bgm?{bgm}:{})},asset_ids:[assets[0].id]})).data;
  return {root,store,harness,assets,request,task,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(root,{recursive:true,force:true});}};
}

test('project deletion preserves approvals and source assets, rejects busy projects, and restores across restart',async()=>{
  const f=await fixture();
  try{
    const task=await f.task();await f.request(`/tasks/${task.id}/plan`,'POST',{});
    const original=f.store.task(task.id)!;
    f.harness.operations.add(task.id);
    assert.equal((await f.request(`/tasks/${task.id}`,'DELETE')).data.error.code,'TASK_BUSY');
    f.harness.operations.delete(task.id);
    assert.equal((await f.request(`/tasks/${task.id}`,'DELETE')).status,200);
    assert.equal((await f.request('/tasks')).data.length,0);
    assert.equal((await f.request(`/tasks/${task.id}`)).status,404);
    assert.equal((await f.request(`/tasks/${task.id}/approve-plan`,'POST',{version:1})).status,404);
    assert.equal((await f.request('/assets')).data.length,3);
    assert(existsSync(f.assets[0].file_path));
    const reopened=new Store(f.root);try{reopened.recover();assert.equal(reopened.tasks().length,0);assert.equal(reopened.trash()[0].id,task.id);}finally{reopened.close();}
    assert.equal((await f.request(`/trash/tasks/${task.id}/restore`,'POST',{})).status,200);
    assert.deepEqual(f.store.task(task.id),original,'restoration does not approve or revise the original plan');
    assert.equal((await f.request(`/trash/tasks/${task.id}/restore`,'POST',{})).status,404);
    assert.equal((await f.request('/trash/unknown/x/restore','POST',{})).status,400);
  }finally{await f.close();}
});

test('deleting a library asset hides new selection while existing projects keep usable source references',async()=>{
  const f=await fixture();
  try{
    const task=await f.task(),asset=f.assets[0];
    assert.equal((await f.request(`/assets/${asset.id}`,'DELETE')).status,200);
    assert.equal((await f.request('/assets')).data.some((a:any)=>a.id===asset.id),false);
    assert((await f.request('/assets?include_deleted=true')).data.find((a:any)=>a.id===asset.id).deleted_at);
    assert.equal((await f.request('/tasks','POST',{brief:{request:'新的广告'},asset_ids:[asset.id]})).data.error.code,'ASSET_NOT_FOUND');
    assert.equal((await f.request(`/assets/${asset.id}/shots`,'PUT',{shots:asset.shots})).status,404);
    const plan=await f.request(`/tasks/${task.id}/plan`,'POST',{});
    assert.equal(plan.status,200);assert.equal(plan.data.state,'WAITING_PLAN_APPROVAL');
    assert.equal(f.harness.assets(f.store.task(task.id)!)[0].file_path,asset.file_path);
    assert(existsSync(asset.file_path));
    const restore=await f.request(`/trash/assets/${asset.id}/restore`,'POST',{});assert.equal(restore.status,200);
    assert.deepEqual(f.store.asset(asset.id),asset);
  }finally{await f.close();}
});

test('imported music deletion resets the default atomically and preserves frozen and pending project soundtracks',async()=>{
  const f=await fixture();
  try{
    const builtin=f.store.musicTrack('carefree')!;
    const music=await importMusic(f.store,builtin.file_path,'user-copy.mp3',{title:'自有配乐验证',author:'测试',license_note:'测试副本',source_url:''});
    assert.equal(music.origin,'upload');
    await f.request('/settings','POST',{default_bgm_id:music.id});
    const task=await f.task({mode:'track',track_id:music.id});
    await f.request(`/tasks/${task.id}/plan`,'POST',{});
    const original=f.store.task(task.id)!,edl=original.edl!;
    const draft=await f.task({mode:'track',track_id:music.id});
    assert.equal((await f.request(`/music/${music.id}`,'DELETE')).status,200);
    const library=(await f.request('/music')).data;
    assert.equal(library.default_bgm_id,'carefree');assert(!library.tracks.some((m:any)=>m.id===music.id));
    assert.equal((await f.request('/settings','POST',{default_bgm_id:music.id})).status,422);
    assert.equal((await f.request(`/tasks/${task.id}/bgm`,'POST',{version:1,bgm:{mode:'track',track_id:music.id}})).status,422);
    assert.throws(()=>resolveBgm(f.store,{mode:'track',track_id:music.id}),{code:'BGM_NOT_FOUND'});
    assert.equal(musicPath(f.store,edl),music.file_path);assert(existsSync(music.file_path));
    assert.deepEqual(f.store.task(task.id),original);
    assert.equal((await f.request(`/tasks/${draft.id}/plan`,'POST',{})).data.edl.bgm.track_id,music.id,'previously selected draft soundtrack remains usable');
    assert.equal((await f.request('/music/carefree','DELETE')).data.error.code,'BUILTIN_MUSIC');
    const again=await importMusic(f.store,builtin.file_path,'same.mp3',{title:'new name',author:'test',license_note:'test',source_url:''});
    assert.equal(again.id,music.id);assert.equal(again.deleted_at,undefined);assert.equal(again.title,music.title);
    assert.equal(f.store.defaultBgmId(),'carefree','restoration does not silently change the default');
  }finally{await f.close();}
});
