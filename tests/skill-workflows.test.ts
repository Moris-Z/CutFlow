import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {BriefSchema,durationOf,type Asset,type Bgm} from '../shared/types';
import {planSkillWorkflow,workflowSkillIds} from '../server/skill-workflows';
import {energyBeats,speechShots} from '../server/skill-analysis';
import {normalizeBrief,validateEDL,createPlan,createPatch} from '../server/planner';
import {updateSettings} from '../server/settings';
import {command,ingestVideo,renderVideo,evaluateRender,hashFile} from '../server/media';
import {slicePreview,revisionRegions,assertRevisionScope} from '../server/revisions';
import {createApp} from '../server/server';
import {editingSkills} from '../shared/skills';
const bgm:Bgm={track_id:'fixture',sha256:'fixture',title:'测试节拍',author:'test',license:'test',license_url:'https://example.com',source_url:'https://example.com',attribution:'test',gain:.5,start_ms:0,ducking:true};
function asset(id:string,transcript?:string):Asset{return {id,name:id+'.mp4',duration_ms:3000,width:320,height:180,fps:30,has_audio:!!transcript,file_path:'',url:'',thumbnail_url:'',sha256:id,created_at:'',warnings:[],shots:[{id:id+'-shot',asset_id:id,start_ms:0,end_ms:3000,summary:id,transcript,evidence:{type:transcript?'user_annotation':'metadata',description:'测试分段',confidence:1}}]};}
const brief=(id:any,extra={})=>normalizeBrief({request:'为产品制作广告，保留原始依据',skill_id:id,duration_ms:30000,...extra});
const options={bgm,musicPath:''};

test('all catalog entries have executable routing; missing prerequisite never falls back to generic montage',async()=>{
 assert.equal(editingSkills.filter(s=>s.unavailable).length,0);assert.equal(workflowSkillIds.length,17);await assert.rejects(()=>createPlan(brief('same_rhythm'),[asset('a')]),{code:'SKILL_WORKFLOW_REQUIRED'});
 await assert.rejects(()=>planSkillWorkflow(brief('same_rhythm'),[asset('a')],options),{code:'REFERENCE_REQUIRED'});
 await assert.rejects(()=>planSkillWorkflow(brief('video_translate',{skill_options:{target_language:'en'}}),[asset('a')],options),{code:'SPEECH_REQUIRED'});
 await assert.rejects(()=>planSkillWorkflow(brief('benefit_variants'),[asset('a')],options),{code:'VARIANT_LABELS_REQUIRED'});
 await assert.rejects(()=>planSkillWorkflow(brief('ten_versions'),[asset('a')],options),{code:'VARIANTS_NEED_MATERIAL'});
});
test('measured beats track nonuniform onsets and reject silence',()=>{
 const rate=8000,data=new Float32Array(rate*5),times=[320,880,1700,2220,3550];for(const time of times)for(let j=0;j<400;j++)data[Math.round(time*rate/1000)+j]=Math.sin(j*.3)*.6;
 const found=energyBeats(data,rate);for(const time of times)assert(found.some(t=>Math.abs(t-time)<=30));assert.deepEqual(energyBeats(new Float32Array(16000)),[]);
});
test('hook, batch, size and speech skills create actual distinct edits without changing source assets',async()=>{
 const input=['a','b','c','d','e'].map(id=>asset(id)),before=structuredClone(input);
 const hooks=await planSkillWorkflow(brief('hook_variants'),input,options);assert.equal(hooks.plans.length,3);assert.deepEqual(hooks.plans[0].plan.edl.clips.slice(1),hooks.plans[1].plan.edl.clips.slice(1));assert.notEqual(hooks.plans[0].plan.edl.clips[0].asset_id,hooks.plans[1].plan.edl.clips[0].asset_id);
 const batch=await planSkillWorkflow(brief('ten_versions'),input,options);assert.equal(batch.plans.length,10);assert.equal(new Set(batch.plans.map(p=>p.plan.edl.clips.map(c=>c.asset_id).join(','))).size,10);
 const sizes=await planSkillWorkflow(brief('multi_size'),input,options);assert.deepEqual(sizes.plans.map(p=>p.plan.edl.aspect_ratio),['9:16','16:9','1:1']);assert.deepEqual(sizes.plans[0].plan.edl.clips,sizes.plans[1].plan.edl.clips);assert.deepEqual(input,before);
 const trimmed=await planSkillWorkflow(brief('speech_trim'),[asset('a','轻松带走'),asset('b','嗯'),asset('c','轻松带走'),asset('d','装进包里')],options);assert.deepEqual(trimmed.plans[0].plan.edl.clips.map(c=>c.asset_id),['a','d']);
 const captions=await planSkillWorkflow(brief('kinetic_captions',{subtitles:true}),[asset('a','Hello')],options);assert.equal(captions.plans[0].plan.edl.caption_style,'emphasis');
 await assert.rejects(()=>planSkillWorkflow(brief('kinetic_captions'),[asset('a','Hello')],options),{code:'CAPTIONS_DISABLED'});
});
test('model workflows validate real shot IDs, preserve source scripts, reject duplicate variants',async()=>{
 let repeated=false;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body),content=payload.messages[1].content;const ctx=JSON.parse(typeof content==='string'?content:content[0].text);let value:any;
  if(ctx.clips)value={lines:ctx.clips.map((c:any)=>({clip_id:c.clip_id,text:c.source?'Hello':''}))};
  else{let ids=ctx.shots.map((s:any)=>s.id);if(!repeated&&String(ctx.purpose).includes('travel'))ids=[...ids.slice(1),ids[0]];value={shot_ids:ids,reason:'按提供的真实片段选择'};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;updateSettings({model_api_key:'test-local-only',model_name:'fixture',model_base_url:`http://127.0.0.1:${port}`});
 try{
  const speech=[asset('a','你好'),asset('b','欢迎')],mixed=[...speech,asset('detail')];
  for(const id of ['live_to_ad','comment_reply','broll','tvc_to_ugc','video_translate','overseas_recut'] as const){const result=await planSkillWorkflow(brief(id,{skill_options:{comment:'好用吗',target_language:'en',market:'美国'}}),mixed,options);assert.equal(result.plans[0].plan.skill?.id,id);assert(result.plans[0].plan.edl.clips.length>0);if(id==='broll')assert(result.plans[0].plan.edl.clips.some(c=>c.audio_source));if(['tvc_to_ugc','video_translate','overseas_recut','comment_reply'].includes(id))assert(result.plans[0].plan.edl.clips.some(c=>c.narration));}
  for(const id of ['benefit_variants','audience_variants'] as const){const result=await planSkillWorkflow(brief(id,{skill_options:{variants:['home','travel']}}),mixed,options);assert.equal(result.plans.length,2);}
  const voice=asset('testimonial','这是一段完整评价');voice.duration_ms=6000;voice.shots[0].end_ms=6000;voice.shots[0].ad_roles=['testimonial'];
  const covered=await planSkillWorkflow(brief('broll'),[voice,asset('detail')],options);const coveredEdl=covered.plans[0].plan.edl;
  assert.equal(durationOf(coveredEdl),6000);assert.equal(coveredEdl.clips[1].start_ms,3000);
  const gap=structuredClone(coveredEdl);gap.clips[0].audio_source!.start_ms=100;gap.clips[0].audio_source!.end_ms=3100;
  assert.throws(()=>validateEDL(gap,[voice,asset('detail')]),{code:'TESTIMONIAL_TRUNCATED'});
  repeated=true;await assert.rejects(()=>planSkillWorkflow(brief('benefit_variants',{skill_options:{variants:['home','travel']}}),mixed,options),{code:'DUPLICATE_VARIANTS'});
  assert.equal(speech[0].shots[0].transcript,'你好');
 }finally{updateSettings({model_api_key:'',model_name:'',model_base_url:'https://api.openai.com/v1'});await new Promise<void>(r=>server.close(()=>r()));}
});
test('HTTP multi-size creates one reviewable group atomically and never approves another version',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-variants-'));const {app,store}=createApp(root);store.saveAsset(asset('a'));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 const post=async(url:string,body={})=>{const r=await fetch(`http://127.0.0.1:${port}/api${url}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{const t=await post('/tasks',{brief:brief('multi_size'),asset_ids:['a']});const p=await post(`/tasks/${t.data.id}/plan`);assert.equal(p.status,200);const tasks=store.tasks();assert.equal(tasks.length,3);assert.equal(new Set(tasks.map(t=>t.variant_group!.id)).size,1);assert(tasks.every(t=>t.state==='WAITING_PLAN_APPROVAL'&&!t.plan_approved_version&&t.artifacts.length===0&&!!t.edl?.bgm));const again=await post(`/tasks/${t.data.id}/plan`);assert.equal(again.status,409);assert.equal(store.tasks().length,3);}
 finally{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}
});
test('real media: reference cuts, music onsets, caption animation, replacement voice and B-roll audio render',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-skill-media-'));
 try{
  const source=path.join(root,'source.mp4');await command('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=red:s=320x180:d=3:r=30','-f','lavfi','-i','color=c=blue:s=320x180:d=3:r=30','-f','lavfi','-i','color=c=white:s=320x180:d=3:r=30','-f','lavfi','-i','sine=frequency=440:duration=9','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
  const a=await ingestVideo(source,'source.mp4',path.join(root,'media','assets'));a.shots=[0,1,2].map(i=>({...a.shots[0],id:`shot-${i}`,start_ms:i*3000,end_ms:(i+1)*3000,summary:`测试画面${i}`}));
  const mock=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;let value:any;
   if(req.url==='/audio/transcriptions'){assert(body.includes('whisper-1'));assert(body.includes('speech.mp3'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({segments:[{start:0,end:3,text:'First sentence'},{start:3,end:6,text:'Second sentence'},{start:6,end:9,text:'Third sentence'}]}));return;}
   const payload=JSON.parse(body),content=payload.messages[1].content,ctx=JSON.parse(typeof content==='string'?content:content[0].text);value=ctx.shots?{shot_ids:ctx.shots.map((s:any)=>s.id),reason:'参考叙事顺序'}:{stages:ctx.durations_ms.map(()=>({summary:'真实产品画面'}))};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
  });await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));updateSettings({model_api_key:'fixture-local',model_name:'fixture',model_base_url:`http://127.0.0.1:${(mock.address() as any).port}`});
  try{const transcribed=await speechShots(a);assert.equal(transcribed.length,3);assert.equal(transcribed[1].start_ms,3000);assert.equal(transcribed[0].evidence.type,'model_audio');const remade=await planSkillWorkflow(brief('viral_remake',{duration_ms:9000}),[a],{...options,reference:a});assert.equal(remade.plans[0].plan.skill?.id,'viral_remake');assert.equal(remade.plans[0].plan.edl.clips.length,3);}
  finally{updateSettings({model_api_key:'',model_name:'',model_base_url:'https://api.openai.com/v1'});await new Promise<void>(r=>mock.close(()=>r()));}
  const rhythm=await planSkillWorkflow(brief('same_rhythm',{duration_ms:9000}),[a],{...options,reference:a});assert.equal(rhythm.plans[0].plan.edl.clips.length,3);assert(Math.abs(durationOf(rhythm.plans[0].plan.edl)-9000)<100);
  const music=path.join(root,'beats.wav');await command('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i',"aevalsrc=if(lt(mod(t\\,0.6)\\,0.06)\\,0.5*sin(2*PI*150*t)\\,0):s=8000:d=12",music]);
  const realBgm={...bgm,sha256:await hashFile(music)};
  for(const id of ['beat_showcase','music_beats'] as const){const result=await planSkillWorkflow(brief(id,{duration_ms:9000}),[a],{bgm:realBgm,musicPath:music});assert(result.plans[0].plan.strategy[0].includes('重音'));assert(result.plans[0].plan.edl.clips.length>=2);}
  const edl=rhythm.plans[0].plan.edl;delete edl.bgm;edl.clips=edl.clips.slice(0,1);edl.subtitles=true;edl.caption_style='emphasis';edl.clips[0].caption='Hello';edl.clips[0].narration={text:'Hello, enjoy your coffee.',language:'en'};
  const result=await renderVideo(edl,[a],path.join(root,'voice'),{quality:'preview'});assert((await evaluateRender(result,edl,'preview')).passed);
  const edit=await createPatch(edl,[a],'第1镜头配音改为：Hello, coffee.');assert.equal(edit.edl.clips[0].caption,edl.clips[0].caption);assert.equal(edit.edl.clips[0].narration?.text,'Hello, coffee.');assert.deepEqual(edit.constraints?.clip_fields,['narration']);assert(edit.changes?.some(c=>c.field==='配音'));
  const patch=slicePreview(edl,[1000,2000]);assert.equal(patch.clips[0].narration!.offset_ms,1000);assert.equal(patch.clips[0].narration!.full_duration_ms,3000);
  const fragment=await renderVideo(patch,[a],path.join(root,'fragment'),{quality:'preview'});assert.equal(fragment.duration_ms,1000);
  delete edl.clips[0].narration;edl.clips[0].audio_source={asset_id:a.id,start_ms:3000,end_ms:6000};const broll=await renderVideo(edl,[a],path.join(root,'broll'),{quality:'preview'});assert((await evaluateRender(broll,edl,'preview')).passed);
  const sliced=slicePreview(edl,[1000,2000]);assert.deepEqual(sliced.clips[0].audio_source,{asset_id:a.id,start_ms:4000,end_ms:5000});validateEDL(sliced,[a]);
  const changed=structuredClone(edl);changed.caption_style='plain';assert(revisionRegions(edl,changed).length);assert.throws(()=>assertRevisionScope(edl,changed,{kind:'clips',clip_ids:[edl.clips[0].id],basis:'test'}),{code:'REVISION_SCOPE_EXCEEDED'});
 }finally{await rm(root,{recursive:true,force:true});}
});
