import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySkill,emptyDraft,parseRoute,restoreDraft,routeHash,skillPrompt} from '../src/creation';

test('skill chips never inject prompts or change advertiser text, media, music or delivery settings',()=>{
 const draft=emptyDraft();draft.brief.request='  突出新品，不要加结尾文案\n保留喝咖啡动作。  ';draft.assetIds=['source-1','source-2'];draft.brief.duration_ms=23000;draft.brief.bgm={mode:'track',track_id:'carefree',gain:.5,start_ms:0,ducking:true};
 const first=applySkill(draft,'product_highlight'),next=applySkill(first,'functional_demo');
 assert.equal(next.brief.skill_id,'functional_demo');assert.equal(next.brief.recipe,'demo');assert.equal(next.brief.request,draft.brief.request);assert.equal(next.skillPrompt,'');assert.deepEqual(next.assetIds,draft.assetIds);assert.equal(next.brief.duration_ms,23000);assert.deepEqual(next.brief.bgm,draft.brief.bgm);
 assert.deepEqual(applySkill(next,'functional_demo'),next);const removed=applySkill(next,'auto');assert.equal(removed.brief.request,draft.brief.request);assert.equal(removed.brief.recipe,'auto');
});
test('legacy draft migration removes only exact old template text and keeps custom additions',()=>{
 const draft=emptyDraft();draft.brief.recipe='detail';draft.skillPrompt=skillPrompt('detail');draft.brief.request=draft.skillPrompt+'\n\n我的咖啡品牌，不加标题';draft.assetIds=['old-asset'];
 const next=restoreDraft(JSON.stringify(draft));assert.equal(next.brief.request,'我的咖啡品牌，不加标题');assert.equal(next.brief.skill_id,'product_highlight');assert.deepEqual(next.assetIds,draft.assetIds);assert.equal(next.skillPrompt,'');
 draft.brief.request=draft.brief.request.replace('完整保留关键动作','保留喝咖啡的动作');assert.equal(restoreDraft(JSON.stringify(draft)).brief.request,draft.brief.request,'edited templates are user text, never deleted speculatively');
 assert.deepEqual(restoreDraft(JSON.stringify(emptyDraft())),emptyDraft());assert.deepEqual(restoreDraft('{broken'),emptyDraft());assert.deepEqual(restoreDraft(JSON.stringify({brief:{request:'x',skill_id:'invented'}})),emptyDraft());
});
test('skill, creation and project links survive refresh; legacy skill links migrate',()=>{
 for(const hash of ['#create','#skills','#skills/auto','#skills/product_highlight','#projects','#assets','#music','#project/task-123','#trace/task-123'])assert.equal(routeHash(parseRoute(hash)),hash);
 assert.equal(routeHash(parseRoute('#skills/detail')),'#skills/product_highlight');assert.equal(routeHash(parseRoute('#skills/offer')),'#skills/offer_ad');assert.deepEqual(parseRoute('#home'),{view:'create'});assert.deepEqual(parseRoute('#workspace'),{view:'create'});assert.deepEqual(parseRoute('#skills/missing'),{view:'skills',skillId:undefined});
});
test('skill selection and restoration never truncate long advertiser text',()=>{
 const draft=emptyDraft();draft.brief.request='a'.repeat(8000);const next=applySkill(draft,'story_recut');assert.equal(next.brief.request,draft.brief.request);assert.deepEqual(restoreDraft(JSON.stringify(next)),next);
});
