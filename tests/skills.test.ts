import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBrief,createPlan} from '../server/planner';
import {updateSettings} from '../server/settings';
import {editingSkills,skillCategories,SkillIdSchema} from '../shared/skills';
import {exampleEmbedUrl,examplePosterUrl} from '../shared/skill-examples';
import type {Asset} from '../shared/types';
updateSettings({model_api_key:'',model_name:''});
function asset(id:string,role?:'pain'|'demo'|'result'|'detail'):Asset{return {id,name:id+'.mp4',duration_ms:15000,width:720,height:1280,fps:30,has_audio:true,file_path:'',url:'',thumbnail_url:'',sha256:id,created_at:'',warnings:[],shots:[{id,asset_id:id,start_ms:0,end_ms:15000,summary:role||'未知',ad_roles:role?[role]:undefined,evidence:{type:role?'user_annotation':'metadata',description:'已确认素材区间',confidence:1}}]};}
test('catalog keeps all eight task categories, stable IDs and real reference sources',()=>{
 assert.equal(skillCategories.length,8);assert.equal(editingSkills.length,34);assert.equal(new Set(editingSkills.map(s=>s.id)).size,34);
 for(const category of skillCategories)assert(editingSkills.some(s=>s.category===category.id));
 for(const skill of editingSkills){assert(SkillIdSchema.safeParse(skill.id).success);assert.match(skill.example.source,/^https:\/\//);assert(skill.exampleNote.length>0);}
});
test('each skill has a distinct Douyin reference and poster path',()=>{
 const examples=editingSkills.flatMap(skill=>skill.examples?.map(c=>c.example)||[skill.example]);
 assert.equal(examples.length,34);
 assert.equal(new Set(examples.map(e=>`${e.provider}:${e.videoId}`)).size,examples.length);
 const covers=new Set<string>();
 for(const example of examples){
  assert.equal(example.provider,'douyin');
  assert.match(example.videoId,/^\d{16,22}$/);
  assert.equal(example.source,`https://www.douyin.com/video/${example.videoId}`);
  const embed=new URL(exampleEmbedUrl(example));
  assert.equal(embed.origin,'https://open.douyin.com');
  assert.equal(embed.searchParams.get('vid'),example.videoId);
  const poster=examplePosterUrl(example)!;assert.match(poster,/^\/skill-covers\/[a-z_]+\.jpg$/);
  covers.add(poster);
 }
 assert.equal(covers.size,34);
});
test('example URLs preserve provider boundaries and existing YouTube playback',()=>{
 const example=editingSkills[0].example;
 assert.throws(()=>exampleEmbedUrl({...example,videoId:'123&redirect=evil'}));
 const youtube={...example,provider:'youtube' as const,videoId:'ZUG9qYTJMsI',poster:undefined,endSeconds:8};
 assert.match(exampleEmbedUrl(youtube),/^https:\/\/www.youtube.com\/embed\/ZUG9qYTJMsI\?/);
 assert.match(exampleEmbedUrl(youtube),/&end=8$/);
 assert.equal(examplePosterUrl(youtube),'https://i.ytimg.com/vi/ZUG9qYTJMsI/hqdefault.jpg');
});
test('selected skill reaches the planner without exposing internal instructions or changing the user request',async()=>{
 const assets=[asset('result','result'),asset('demo','demo'),asset('detail','detail'),asset('pain','pain')];
 const request='我的品牌，不加标题，保留喝咖啡动作';
 const b=normalizeBrief({request,skill_id:'product_highlight',recipe:'pain_solution',duration_ms:20000});assert.equal(b.request,request);assert.equal(b.recipe,'detail');
 const p=await createPlan(b,assets);assert.equal(p.skill?.status,'applied');assert.equal(p.edl.clips[0].shot_id,'detail');assert.equal(p.edl.clips.at(-1)?.shot_id,'result');assert.equal(p.edl.subtitles,false);assert.equal(p.edl.title,'');
 const hook=await createPlan(normalizeBrief({...b,skill_id:'strong_hook'}),assets);assert.equal(hook.edl.clips[0].shot_id,'pain');
});
test('a task missing necessary evidence is not reported as an applied skill',async()=>{
 const p=await createPlan(normalizeBrief({request:'制作广告',skill_id:'product_unboxing'}),[asset('unknown')]);assert.equal(p.skill?.status,'needs_material');assert(p.skill!.details.length>0);
 assert.equal(normalizeBrief({request:'翻译',skill_id:'video_translate'}).skill_id,'video_translate');
 assert(editingSkills.every(s=>!s.unavailable));
 await assert.rejects(()=>createPlan(normalizeBrief({request:'作品',skill_id:'multi_montage'}),[asset('one')]),{code:'SKILL_NEEDS_MATERIAL'});
 await assert.rejects(()=>createPlan(normalizeBrief({request:'作品',skill_id:'highlight_reel'}),[asset('one')]),{code:'SKILL_NEEDS_MATERIAL'});
});
test('fast cutting changes durations but never cuts the key sip or reaction',async()=>{
 const a=asset('sip','result');a.shots[0].intent={message:'喝咖啡并品味',key_action:'举杯、饮用、放下',action_start_ms:7500,action_end_ms:10500,pre_roll_ms:1000,post_roll_ms:2000,priority:5,required:true,evidence:{description:'核对动作',observed_at_ms:[6500,12500]}};
 const p=await createPlan(normalizeBrief({request:'咖啡广告',skill_id:'fast_cut',duration_ms:18000}),[asset('intro'),a,asset('end')]);
 const sip=p.edl.clips.find(c=>c.shot_id==='sip')!;assert(sip.start_ms<=6500&&sip.end_ms>=12500);assert(p.edl.clips.filter(c=>c.shot_id!=='sip').every(c=>c.end_ms-c.start_ms<=3000));assert.equal(p.skill?.status,'applied');
 const slow=await createPlan(normalizeBrief({request:'改成舒缓节奏',skill_id:'fast_cut',duration_ms:15000}),[asset('slow')]);assert.equal(slow.edl.clips[0].end_ms,15000);
});
test('montage reserves variety; platform preset yields to explicit format instructions',async()=>{
 const a=asset('a');a.shots=[{...a.shots[0],id:'a1',end_ms:5000},{...a.shots[0],id:'a2',start_ms:5000,end_ms:10000},{...a.shots[0],id:'a3',start_ms:10000}];
 const p=await createPlan(normalizeBrief({request:'产品展示',skill_id:'multi_montage',duration_ms:2000}),[a,asset('b')]);assert.deepEqual(new Set(p.edl.clips.map(c=>c.asset_id)),new Set(['a','b']));
 assert.equal(normalizeBrief({request:'广告',skill_id:'tiktok_adapt'}).aspect_ratio,'9:16');assert.equal(normalizeBrief({request:'广告 16:9',skill_id:'tiktok_adapt'}).aspect_ratio,'16:9');assert.equal(normalizeBrief({request:'广告',skill_id:'tiktok_adapt',aspect_ratio:'16:9',platform:'YouTube'}).aspect_ratio,'16:9');
});

test('API persists the chosen skill, BGM and unmet requirements without auto-rendering or accepting approval',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {createApp}=await import('../server/server');
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-skill-'));const {app,store}=createApp(root);store.saveAsset(asset('plain'));store.setConfirmTextPlan(false);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as import('node:net').AddressInfo;const base=`http://127.0.0.1:${address.port}/api`;
 const post=async(url:string,body={})=>{const res=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
 try{
  const created=await post('/tasks',{brief:{request:'开箱视频',skill_id:'product_unboxing'},asset_ids:['plain']});assert.equal(created.status,201);assert.equal(created.data.brief.request,'开箱视频');
  const planned=await post(`/tasks/${created.data.id}/plan`);assert.equal(planned.status,200);assert.equal(planned.data.plan.skill.status,'needs_material');assert.equal(planned.data.state,'WAITING_PLAN_APPROVAL');assert.equal(planned.data.plan.text_review.required,true);assert(planned.data.edl.bgm.track_id);assert.equal(planned.data.artifacts.length,0);
  const approved=await post(`/tasks/${created.data.id}/approve-plan`,{version:planned.data.edl.version,candidate_digest:planned.data.plan.text_review.candidate_digest});assert.equal(approved.status,422);assert.equal(approved.data.error.code,'SKILL_NEEDS_MATERIAL');assert.equal(store.task(created.data.id)!.plan_approved_version,undefined);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(root,{recursive:true,force:true});}
});

test('creator montage cannot claim success after selecting only one of the required voices',async()=>{
 const creators=[asset('speaker-1'),asset('speaker-2')];for(const a of creators){a.shots[0].ad_roles=['testimonial'];a.shots[0].transcript='这是我的完整评价。';a.shots[0].evidence.type='user_annotation';}
 await assert.rejects(()=>createPlan(normalizeBrief({request:'达人体验',skill_id:'creator_montage',duration_ms:17000}),[...creators,asset('use','demo')]),{code:'SKILL_NEEDS_DURATION'});
 const plan=await createPlan(normalizeBrief({request:'达人体验',skill_id:'creator_montage',duration_ms:35000}),[...creators,asset('use','demo')]);assert.equal(plan.skill?.status,'applied');assert.equal(plan.edl.clips.filter(c=>c.shot_id?.startsWith('speaker')).length,2);
});
