import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan,createPatch,normalizeBrief,validateEDL } from '../server/planner.js';
import { updateSettings } from '../server/settings.js';
import { durationOf,type Asset } from '../shared/types.js';
const assets:Asset[]=[12000,2000].map((duration_ms,i)=>({id:`asset-${i}`,name:`file${i}`,file_path:'',url:'',thumbnail_url:'',duration_ms,width:1920,height:1080,fps:30,has_audio:true,sha256:'example',created_at:'',warnings:[],shots:[{id:`s${i}`,asset_id:`asset-${i}`,start_ms:0,end_ms:duration_ms,summary:'未知内容',evidence:{type:'metadata',description:'实测时长',confidence:1}}]}));
updateSettings({model_api_key:'',model_name:''});
test('explicit Chinese request overrides delivery defaults',()=>{const b=normalizeBrief({request:'剪成12秒，16:9，720P'});assert.equal(b.duration_ms,12000);assert.equal(b.aspect_ratio,'16:9');assert.equal(b.resolution,'720p');});
test('text defaults off, and marketing goals never become unrequested screen text',async()=>{
 const p=await createPlan(normalizeBrief({request:'剪成12秒咖啡短片',cta:'给自己，一杯咖啡的时间'}),assets);
 assert.equal(p.edl.subtitles,false);assert.equal(p.edl.cta,'');assert.equal(p.edl.title,'');
 assert.equal(normalizeBrief({request:'只保留字幕，不加标题',subtitles:false}).subtitles,false,'a request mentioning subtitles must not override the explicit display switch');
 const explicit=await createPlan(normalizeBrief({request:'剪成12秒',subtitles:true,allow_text_overlays:true,cta:'预约体验'}),assets);
 assert.equal(explicit.edl.cta,'预约体验');assert.equal(explicit.edl.subtitles,true);
 const removed=await createPatch({...explicit.edl,title:'片头',clips:explicit.edl.clips.map(c=>({...c,caption:'保留原有旁白字幕'}))},assets,'只保留字幕，移除标题和结尾文案');
 assert.equal(removed.edl.title,'');assert.equal(removed.edl.cta,'');assert.equal(removed.edl.subtitles,true);
 assert(removed.edl.clips.every(c=>c.caption==='保留原有旁白字幕'));
 assert.equal(removed.edl.audio_gain,explicit.edl.audio_gain);
});
test('rules plan fills available target without repeating or fabricating assets',async()=>{const plan=await createPlan(normalizeBrief({request:'12秒内容混剪'}),assets);assert.equal(durationOf(plan.edl),12000);assert.equal(plan.mode,'rules');assert(plan.edl.clips.every(c=>c.caption===''));assert(plan.risks.some(r=>r.includes('规则模式')));});
test('unknown assets, invalid ranges, false evidence and empty edits are rejected',async()=>{const p=await createPlan(normalizeBrief({request:'12秒内容混剪'}),assets);const bad=structuredClone(p.edl);bad.clips[0].end_ms=13000;assert.throws(()=>validateEDL(bad,assets),/超出/);bad.clips[0].end_ms=1000;bad.clips[0].evidence.type='model_vision';assert.throws(()=>validateEDL(bad,assets),/证据/);});
test('patches preserve originals and reject stale locks including global overlays',async()=>{const plan=await createPlan(normalizeBrief({request:'12秒混剪',subtitles:true}),assets);const original=JSON.stringify(plan.edl);const patch=await createPatch(plan.edl,assets,'第1镜头字幕改为：可靠的剪辑流程');assert.equal(patch.edl.version,2);assert.equal(patch.edl.clips[0].caption,'可靠的剪辑流程');assert.equal(JSON.stringify(plan.edl),original);const locked=structuredClone(plan.edl);locked.clips[0].locked=true;await assert.rejects(()=>createPatch(locked,assets,'第1镜头字幕改为：修改'),/锁定/);await assert.rejects(()=>createPatch(locked,assets,'静音'),/锁定/);const unlock=structuredClone(locked);unlock.clips[0].locked=false;assert.throws(()=>validateEDL(unlock,assets,locked),/锁定/);});
test('unsupported natural language does not pretend to execute',async()=>{const p=await createPlan(normalizeBrief({request:'12秒混剪'}),assets);await assert.rejects(()=>createPatch(p.edl,assets,'帮我自动识别并删掉全片口水词'),/规则模式支持/);});

function actionFixture():Asset {
 const a=structuredClone(assets[0]);a.duration_ms=13178;a.shots=[{...a.shots[0],end_ms:13178,summary:'阅读后举杯饮用',intent:{message:'人物喝下咖啡并停留品味',key_action:'举杯、饮用、放下杯子',action_start_ms:7400,action_end_ms:10400,pre_roll_ms:1800,post_roll_ms:2000,priority:5,required:true,evidence:{description:'5.5秒举杯，8至10秒饮用，12秒放下杯子后停顿',observed_at_ms:[5500,8000,10000,12000]}}}];return a;
}
test('late key action wins over equal source-start trimming and includes the reaction tail',async()=>{
 const a=actionFixture();const p=await createPlan(normalizeBrief({request:'剪成8秒'}),[a]);const c=p.edl.clips[0];
 assert(c.start_ms<=5600&&c.start_ms>0);assert(c.end_ms>=12400);assert.equal(durationOf(p.edl),8000);assert.equal(c.shot_id,a.shots[0].id);assert.equal(p.editorial_review?.status,'protected');assert.match(c.purpose,/喝下咖啡/);
});
test('short duration and later revision cannot silently remove the sip or its reaction',async()=>{
 const a=actionFixture();await assert.rejects(()=>createPlan(normalizeBrief({request:'剪成4秒'}),[a]),{code:'DURATION_INTENT_CONFLICT'});
 const p=await createPlan(normalizeBrief({request:'剪成8秒'}),[a]);
 await assert.rejects(()=>createPatch(p.edl,[a],'第1段保留前2秒'),{code:'KEY_ACTION_CUT'});
 await assert.rejects(()=>createPatch(p.edl,[a],'第1镜头取原片5.6秒到10.4秒'),{code:'KEY_ACTION_CUT'});
 const bad=structuredClone(p.edl);bad.clips[0].start_ms=0;bad.clips[0].end_ms=4000;assert.throws(()=>validateEDL(bad,[a]),{code:'KEY_ACTION_CUT'});
});
test('required action cannot be bypassed with an overlapping unprotected annotation',async()=>{
 const a=actionFixture();a.shots.push({...a.shots[0],id:'unprotected',intent:undefined});
 const p=await createPlan(normalizeBrief({request:'剪成8秒'}),[a]);const bad=structuredClone(p.edl);bad.clips=bad.clips.filter(c=>c.shot_id===a.shots[0].id);bad.clips[0].shot_id='unprotected';
 assert.throws(()=>validateEDL(bad,[a]),{code:'REQUIRED_ACTION_MISSING'});
 bad.clips[0].shot_id=undefined;assert.throws(()=>validateEDL(bad,[a]),{code:'EVIDENCE_AMBIGUOUS'});
});
test('unobserved footage stays manual review; incomplete temporal evidence is rejected',async()=>{
 const p=await createPlan(normalizeBrief({request:'12秒混剪'}),assets);assert.equal(p.editorial_review?.status,'needs_review');
 const a=actionFixture();a.shots[0].intent!.evidence.observed_at_ms=[8000,9000];await assert.rejects(()=>createPlan(normalizeBrief({request:'剪成8秒'}),[a]),{code:'INVALID_SHOT_INTENT'});
});
