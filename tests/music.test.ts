import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import type {AddressInfo} from 'node:net';
import {Store} from '../server/store';
import {createApp} from '../server/server';
import {installMusic,resolveBgm,importMusic,musicPatch,musicPath,musicCredits} from '../server/music';
import {generateDemoAssets,renderVideo,evaluateRender,hashFile} from '../server/media';
import {EDLSchema,type EDL} from '../shared/types';
import {assertRequestedChanges,changeContract} from '../server/revision-changes';
import {slicePreview,edlDigest,assertRevisionScope} from '../server/revisions';
import {validateEDL} from '../server/planner';
const require=createRequire(import.meta.url),ffmpeg=require('ffmpeg-static');
const audioSamples=(file:string,start=0,duration=1)=>{const b=execFileSync(ffmpeg,['-v','error','-i',file,'-vn','-af',`aresample=48000,atrim=start_sample=${Math.round(start*48000)}:end_sample=${Math.round((start+duration)*48000)}`, '-ac','1','-ar','48000','-f','f32le','-']);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
function rms(samples:Float32Array){return Math.sqrt(samples.reduce((n,v)=>n+v*v,0)/samples.length);}

test('music library persists default; frozen plans and music-only changes protect other fields',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-music-store-'));let store=new Store(root);
 try{
  installMusic(store);assert.equal(store.musicTracks().filter(t=>t.origin==='builtin').length,5);
  const first=resolveBgm(store);assert.equal(first.track_id,'carefree');
  store.setDefaultBgmId('monkeys-spinning-monkeys');store.close();store=new Store(root);
  assert.equal(resolveBgm(store).track_id,'monkeys-spinning-monkeys');assert.equal(first.track_id,'carefree');
  assert.throws(()=>resolveBgm(store,{mode:'track',track_id:'missing'}),{code:'BGM_NOT_FOUND'});
  assert.throws(()=>resolveBgm(store,{start_ms:1200000}),{code:'BGM_START_INVALID'});
  assert.throws(()=>resolveBgm(store,{gain:0}));
  const assets=await generateDemoAssets(path.join(root,'media','assets')),a=assets[2];
  const before=EDLSchema.parse({schema_version:'1.0',version:1,clips:[0,1,2].map(i=>({id:'clip'+i,asset_id:a.id,start_ms:0,end_ms:5000,purpose:'镜头'+i,caption:'',evidence:a.shots[0].evidence})),aspect_ratio:'16:9',resolution:'720p',fps:30});
  const patch=musicPatch(before,first,assets);
  assert.deepEqual(patch.edl.clips,before.clips);assert.deepEqual(patch.regions![0].after_range,[0,15000]);assert.deepEqual(patch.regions![0].after_preview_range,[0,8000]);
  assertRequestedChanges(before,patch.edl,patch.constraints!);
  assert.throws(()=>assertRequestedChanges(before,patch.edl,changeContract(['caption'])),{code:'UNREQUESTED_CHANGE'},'adding absent BGM must not bypass the change contract');
  const locked=structuredClone(before);locked.clips[0].locked=true;
  assert.throws(()=>musicPatch(locked,first,assets),{code:'LOCK_CONFLICT'});
  const existing={...before,bgm:first};const local=structuredClone(existing);local.clips[0].caption='changed';
  assertRevisionScope(existing,local,{kind:'clips',clip_ids:['clip0'],basis:'test'});
  assert.match(musicCredits(existing),/Creative Commons/);
  const bad={...existing,bgm:{...first,sha256:'changed'}};assert.throws(()=>musicPath(store,bad),{code:'BGM_CHANGED'});
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('real BGM mix fills silent sources, loops, ducks original audio, keeps pixels and slice timing', {timeout:180000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-music-render-')),store=new Store(root);
 try{
  const source=path.join(root,'music.wav');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=700:sample_rate=48000:duration=1.4','-y',source]);
  const track=await importMusic(store,source,'music.wav',{title:'测试音乐',author:'程序合成',source_url:'',license_note:'测试自有信号'});
  const bgm=resolveBgm(store,{mode:'track',track_id:track.id,gain:.5,start_ms:600,ducking:false});
  const assets=await generateDemoAssets(path.join(root,'media','assets')),a=assets[2];
  const edl=EDLSchema.parse({schema_version:'1.0',version:1,clips:[{id:'one',asset_id:a.id,start_ms:0,end_ms:4000,purpose:'无声原片',evidence:a.shots[0].evidence}],aspect_ratio:'16:9',resolution:'720p',fps:30});
  const silent=await renderVideo(edl,assets,path.join(root,'silent'),{quality:'preview'});
  assert.equal((await evaluateRender(silent,edl,'preview')).passed,false);
  assert((await evaluateRender(silent,edl,'preview')).issues.some(i=>i.code==='SILENT_OUTPUT'));
  assert.equal((await evaluateRender(silent,edl,'preview',{allowSilentComparison:true})).passed,true);
  const withMusic={...edl,bgm};const output=await renderVideo(withMusic,assets,path.join(root,'music'),{quality:'preview',musicPath:track.file_path});
  assert.equal((await evaluateRender(output,withMusic,'preview')).passed,true);
  assert.equal(output.cache_hits,1,'music does not invalidate unchanged picture segments');
  const tags=JSON.parse(execFileSync(require('ffprobe-static').path,['-v','error','-show_entries','format_tags=comment','-of','json',output.video_path],{encoding:'utf8'}));assert.match(tags.format.tags.comment,/测试音乐/);assert.match(tags.format.tags.comment,/Adapted:/); 
  const frameHash=(file:string)=>execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:v','-f','hash','-hash','sha256','-'],{encoding:'utf8'});
  assert.equal(frameHash(silent.video_path),frameHash(output.video_path));
  assert(rms(audioSamples(output.video_path,2.2,.5))>.01,'BGM loops past the short source duration');
  assert(rms(audioSamples(output.video_path,3.96,.03))<rms(audioSamples(output.video_path,2,.03))*.4,'end fades out');
  const slice=slicePreview(withMusic,[2000,3000]);
  const partial=await renderVideo(slice,assets,path.join(root,'partial'),{quality:'preview',musicPath:track.file_path,timelineOffsetMs:2000,fullDurationMs:4000});
  const fullSamples=audioSamples(output.video_path,2.1,.6),partialSamples=audioSamples(partial.video_path,.1,.6);
  assert.equal(fullSamples.length,partialSamples.length,'excerpt and full output have same audio sample count');
  const error=Math.sqrt(fullSamples.reduce((sum,x,i)=>sum+(x-partialSamples[i])**2,0)/fullSamples.length);
  assert(error/rms(fullSamples)<.08,`slice has same music phase/envelope, relative error ${error/rms(fullSamples)}`);
  const voiced={...withMusic,clips:[{...edl.clips[0],asset_id:assets[0].id}],audio_gain:1};
  const unDucked=await renderVideo(voiced,assets,path.join(root,'voice'),{quality:'preview',musicPath:track.file_path});
  const ducked=await renderVideo({...voiced,bgm:{...bgm,ducking:true}},assets,path.join(root,'duck'),{quality:'preview',musicPath:track.file_path});
  function toneEnergy(file:string,hz:number){const s=audioSamples(file,1,1);let sin=0,cos=0;for(let i=0;i<s.length;i++){sin+=s[i]*Math.sin(2*Math.PI*hz*i/48000);cos+=s[i]*Math.cos(2*Math.PI*hz*i/48000);}return Math.hypot(sin,cos)/s.length;}
  assert(toneEnergy(ducked.video_path,700)<toneEnergy(unDucked.video_path,700)*.8,'background reduces when source voice is present');
  assert(Math.abs(toneEnergy(ducked.video_path,440)/toneEnergy(unDucked.video_path,440)-1)<.05,'source voice remains unchanged');
  await assert.rejects(()=>renderVideo(withMusic,assets,path.join(root,'missing'),{quality:'preview'}),/配乐文件缺失/);
  await writeFile(track.file_path,'broken');await assert.rejects(()=>renderVideo(withMusic,assets,path.join(root,'corrupt'),{quality:'preview',musicPath:track.file_path}),/配乐内容已变化/);
  const empty=path.join(root,'empty.wav');execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=r=48000','-t','1','-y',empty]);
  await assert.rejects(()=>importMusic(store,empty,'empty.wav',{title:'无声',author:'test',source_url:'',license_note:'test'}),/没有可听见/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('HTTP music preference resolves before text review, only BGM patch needs two confirmations', {timeout:120000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-music-http-')), {app,store,harness}=createApp(root);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=async(route:string,body:unknown)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  const assets=await generateDemoAssets(path.join(root,'media','assets'));assets.forEach(a=>store.saveAsset(a));
  const created=await post('/api/tasks',{brief:{request:'制作两秒视频',duration_ms:2000},asset_ids:[assets[2].id]});
  const route='/api/tasks/'+created.data.id;
  const plan=await post(route+'/plan',{});assert.equal(plan.status,200);assert.equal(plan.data.edl.bgm.track_id,'carefree');assert.equal(plan.data.plan.text_review.candidate_digest,edlDigest(plan.data.edl));
  const draft=await post('/api/tasks',{brief:{request:'另一份首版方案',duration_ms:2000},asset_ids:[assets[2].id]});
  await post('/api/tasks/'+draft.data.id+'/plan',{});
  const revisedPlan=await post('/api/tasks/'+draft.data.id+'/bgm',{version:1,bgm:{mode:'track',track_id:'beach-bum'}});
  assert.equal(revisedPlan.status,200);assert.equal(revisedPlan.data.state,'WAITING_PLAN_APPROVAL');assert.equal(revisedPlan.data.edl.version,2);assert.equal(revisedPlan.data.pending_patch,undefined);assert.equal(revisedPlan.data.plan.text_review.candidate_digest,edlDigest(revisedPlan.data.edl));assert.equal(revisedPlan.data.plan_approved_version,undefined,'changing first-plan music must not approve unseen picture arrangement');
  assert.equal((await post('/api/settings',{default_bgm_id:'missing'})).status,422);
  await post('/api/settings',{default_bgm_id:'beach-bum'});assert.equal(store.task(created.data.id)!.edl!.bgm!.track_id,'carefree');
  const current=store.task(created.data.id)!;current.state='WAITING_USER_REVIEW';store.save(current);
  const proposed=await post(route+'/bgm',{version:1,bgm:{mode:'track',track_id:'monkeys-spinning-monkeys',gain:.6}});
  assert.equal(proposed.status,200);const p=proposed.data.pending_patch;assert.equal(p.preview,undefined);assert.equal(proposed.data.edl.bgm.track_id,'carefree');assert.deepEqual(p.constraints.global_fields,['bgm']);assert.deepEqual(p.edl.clips,proposed.data.edl.clips);
  const payload={patch_id:p.id,base_version:1};
  assert.equal((await post(route+'/patch-preview',payload)).data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  assert.equal((await post(route+'/apply-patch',payload)).data.error.code,'TEXT_PLAN_APPROVAL_REQUIRED');
  let queued=0;harness.enqueuePatchPreview=t=>{queued++;return store.save(t);};
  assert.equal((await post(route+'/approve-patch-plan',{...payload,candidate_digest:p.text_review.candidate_digest})).status,200);assert.equal(queued,1);
  assert.equal((await post(route+'/apply-patch',payload)).data.error.code,'PATCH_PREVIEW_REQUIRED');
  assert.equal(store.task(created.data.id)!.edl!.version,1);
  assert.equal((await post(route+'/bgm',{version:1,bgm:{mode:'default'}})).data.error.code,'PENDING_PATCH');
  await post(route+'/discard-patch',payload);
  assert.equal((await post(route+'/bgm',{version:0,bgm:{mode:'default'}})).data.error.code,'STALE_VERSION');
  const library=await(await fetch(base+'/api/music')).json();assert.equal(library.tracks.length,5);assert(library.tracks.every((t:any)=>!t.file_path));assert.equal(library.references.length,12);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}
});

test('HTTP music import accepts file-only form without inventing a rights declaration',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-music-import-')), {app,store}=createApp(root);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  const file=path.join(root,'test.wav');execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=730:duration=1.2','-y',file]);const bytes=await readFile(file);
  const upload=async(source?:string)=>{const form=new FormData();form.set('file',new Blob([bytes],{type:'audio/wav'}),'original-name.wav');if(source!==undefined)form.set('source_url',source);const r=await fetch(base+'/api/music',{method:'POST',body:form});return {status:r.status,data:await r.json()};};
  const first=await upload();assert.equal(first.status,201);assert.equal(first.data.title,'original-name');assert.equal(first.data.origin,'upload');assert.equal(first.data.license,'用户导入');assert(!/已授权|undefined/.test(first.data.attribution));assert.equal(first.data.file_path,'');
  assert.equal((await upload('javascript:alert(1)')).status,400);
  const again=await upload();assert.equal(again.status,201);assert.equal(again.data.id,first.data.id);assert.equal(store.musicTracks().filter(t=>t.origin==='upload').length,1);
  const missing=await fetch(base+'/api/music',{method:'POST',body:new FormData()});assert.equal(missing.status,400);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}
});
