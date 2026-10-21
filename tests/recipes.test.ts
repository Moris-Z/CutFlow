import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchRecipe, recipes, type AdRole } from '../shared/recipes.js';
import { createPlan, createPatch, normalizeBrief } from '../server/planner.js';
import { config, updateSettings } from '../server/settings.js';
import { durationOf, type Asset } from '../shared/types.js';
updateSettings({ model_api_key: '', model_name: '' });
function asset(role: AdRole, duration = 10000): Asset {
  return { id: role, name: `商品${role}.mp4`, file_path: '', url: '', thumbnail_url: '', duration_ms: duration, width: 720, height: 1280, fps: 30, has_audio: true, sha256: '', created_at: '', warnings: [], shots: [{ id: role, asset_id: role, start_ms: 0, end_ms: duration, summary: `已观看确认：${role}`, ad_roles: [role], comparison_group: ['before', 'after'].includes(role) ? '同一把椅子' : undefined, transcript: role === 'testimonial' ? '这是我实际试用的感受。' : undefined, evidence: { type: 'user_annotation', description: '人工确认测试素材', confidence: 1 } }] };
}

test('legacy briefs default to auto; all nine recipes produce their actual stage order', async () => {
  assert.equal(normalizeBrief({ request: '产品视频' }).recipe, 'auto');
  const assets: Asset[] = (['offer', 'after', 'benefit', 'result', 'detail', 'testimonial', 'demo', 'scene', 'unboxing', 'before', 'pain'] as AdRole[]).map(r => asset(r));
  for (const recipe of recipes) {
    const plan = await createPlan(normalizeBrief({ request: '产品视频', recipe: recipe.id, duration_ms: 120000 }), assets);
    assert.equal(plan.recipe_match?.resolved, recipe.id);
    assert.equal(plan.recipe_match?.status, 'matched');
    const stages = plan.edl.clips.map(c => plan.recipe_match!.assignments[c.shot_id!]).filter(i => i !== undefined);
    assert.deepEqual(stages, [...stages].sort((a, b) => a - b), recipe.id);
    assert.equal(plan.edl.subtitles, false); assert.equal(plan.edl.title, ''); assert.equal(plan.edl.cta, '');
  }
});

test('manual structures change shot order AND duration allocation on the same footage', async () => {
  const assets = [asset('result', 20000), asset('demo', 20000), asset('pain', 20000), asset('detail', 20000), asset('scene', 20000)];
  const make = (recipe: string) => createPlan(normalizeBrief({ request: '产品广告', recipe, duration_ms: 15000 }), assets);
  const pain = await make('pain_solution'), detail = await make('detail');
  assert.equal(pain.edl.clips[0].shot_id, 'pain'); assert.equal(detail.edl.clips[0].shot_id, 'detail');
  assert.equal(pain.edl.clips.at(-1)?.shot_id, 'result'); assert.equal(detail.edl.clips.at(-1)?.shot_id, 'result');
  const length = (p: typeof pain, id: string) => { const c = p.edl.clips.find(c => c.shot_id === id)!; return c.end_ms - c.start_ms; };
  assert(length(pain, 'demo') > length(detail, 'demo'));
  assert.equal(durationOf(pain.edl), 15000); assert.equal(durationOf(detail.edl), 15000);
});

test('auto is evidence-based; metadata, thumbnail, claims in filenames and negated descriptions cannot match', () => {
  assert.equal(matchRecipe([asset('benefit'), asset('demo'), asset('result')]).resolved, 'benefits');
  for (const type of ['metadata', 'model_vision'] as const) {
    const assets = [asset('pain'), asset('demo')];
    assets.forEach(a => { a.name = '真实口碑优惠前后对比.mp4'; a.shots[0].evidence.type = type; });
    assert.equal(matchRecipe(assets).resolved, 'safe');
  }
  const negated = [asset('demo'), asset('result')];
  negated[1].shots[0].ad_roles = undefined; negated[1].shots[0].summary = '人物还没喝咖啡，尚未完成饮用';
  assert.equal(matchRecipe(negated, 'demo').status, 'needs_material');
  const linked = asset('detail'); linked.shots[0].ad_roles = undefined;
  linked.shots[0].summary = '桌面画面，来源：https://example.com/demo-close-up-finished';
  assert.deepEqual(matchRecipe([linked]).evidence[0].roles, [], 'source URL words are not visual evidence');
});

test('missing material never fabricates testimonials, paired comparisons or discounts', async () => {
  const silent = asset('testimonial'); silent.has_audio = false;
  assert.equal(matchRecipe([silent, asset('demo')], 'testimonial').resolved, 'safe');
  const untranscribed = asset('testimonial'); untranscribed.shots[0].transcript = '';
  assert.equal(matchRecipe([untranscribed, asset('demo')], 'testimonial').resolved, 'safe');
  const before = asset('before'), after = asset('after'); after.shots[0].comparison_group = '另一把椅子';
  assert.equal(matchRecipe([before, after], 'before_after').resolved, 'safe');
  after.shots[0].comparison_group = before.shots[0].comparison_group;
  assert.equal(matchRecipe([after, before], 'before_after').resolved, 'before_after');
  const plan = await createPlan(normalizeBrief({ request: '优惠广告，半价', recipe: 'offer' }), [asset('demo'), asset('detail')]);
  assert.equal(plan.recipe_match?.resolved, 'safe'); assert.equal(plan.edl.cta, '');
  assert.deepEqual(plan.edl.clips.map(c => c.shot_id), ['demo', 'detail']);
});

test('one multi-purpose shot cannot masquerade as a full multi-stage recipe', () => {
  const a = asset('pain'); a.shots[0].ad_roles = ['pain', 'demo', 'result', 'detail', 'scene'];
  assert.equal(matchRecipe([a]).resolved, 'safe');
});

test('multi-purpose footage fills an available optional process stage before adding more detail shots', () => {
  const detail = asset('detail'), process = asset('demo'), result = asset('result');
  process.shots[0].ad_roles = ['detail', 'demo'];
  const match = matchRecipe([result, process, detail], 'detail');
  assert.equal(match.assignments.demo, 1); assert.equal(match.assignments.detail, 0); assert.equal(match.assignments.result, 2);
});

test('short targets downgrade incomplete recipes and never cut the sip or its aftermath', async () => {
  const sip = asset('result', 14000);
  sip.shots[0].intent = { message: '人物喝咖啡并品味', key_action: '举杯、触唇、放下杯子', action_start_ms: 7500, action_end_ms: 10500, pre_roll_ms: 1000, post_roll_ms: 2000, priority: 5, required: true, evidence: { description: '核对起势和动作结束', observed_at_ms: [6500, 12500] } };
  const assets = [sip, asset('demo'), asset('detail')];
  const p = await createPlan(normalizeBrief({ request: '咖啡短片', recipe: 'detail', duration_ms: 18000 }), assets);
  assert.equal(p.edl.clips.at(-1)?.shot_id, 'result');
  const clip = p.edl.clips.at(-1)!; assert(clip.start_ms <= 6500 && clip.end_ms >= 12500);
  const short = await createPlan(normalizeBrief({ request: '咖啡短片', recipe: 'detail', duration_ms: 6000 }), assets);
  assert.equal(short.recipe_match?.resolved, 'safe'); assert.equal(short.recipe_match?.status, 'needs_material');
  assert.equal(short.edl.clips.length, 1); assert.equal(short.edl.clips[0].end_ms, 12500);
  await assert.rejects(() => createPlan(normalizeBrief({ request: '咖啡短片', recipe: 'detail', duration_ms: 5000 }), assets), { code: 'DURATION_INTENT_CONFLICT' });
});

test('testimonials keep their complete annotated utterance without sentence timing', async () => {
  const sources = [asset('testimonial', 7000), asset('demo')];
  const plan = await createPlan(normalizeBrief({ request: '用户体验', recipe: 'testimonial', duration_ms: 12000 }), sources);
  const quote = plan.edl.clips.find(c => c.shot_id === 'testimonial')!;
  assert.equal(quote.start_ms, 0); assert.equal(quote.end_ms, 7000);
  assert.equal(plan.recipe_match?.status, 'matched');
  await assert.rejects(() => createPatch(plan.edl, sources, '第1段保留前2秒'), { code: 'TESTIMONIAL_TRUNCATED' });
});

test('model planning receives the selected recipe and shares stage ordering and missing-stage checks', async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const context = JSON.parse(JSON.parse(body).messages[1].content);
    assert.equal(context.brief.recipe, 'detail'); assert.equal(context.recipe.id, 'detail');
    assert.equal(context.brief.request,'广告');assert.equal(context.brief.skill_id,'product_highlight');assert.match(context.skill_instructions,/商品高光/);
    assert.equal(context.recipe_match.assignments.result, 2);
    const ids = ++calls === 1 ? ['result', 'demo', 'detail'] : ['demo', 'detail'];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '模型草稿', strategy: [], risks: [], clips: ids.map(shot_id => ({ shot_id, start_ms: 0, end_ms: 3000, purpose: shot_id, caption: '' })) }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = { ...config };
  Object.assign(config, { apiKey: 'test', model: 'fixture', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  try {
    const sources = [asset('result'), asset('demo'), asset('detail')];
    const brief = normalizeBrief({ request: '广告', skill_id:'product_highlight', duration_ms: 9000 });
    const plan = await createPlan(brief, sources);
    assert.equal(plan.mode, 'model'); assert.deepEqual(plan.edl.clips.map(c => c.shot_id), ['detail', 'demo', 'result']);
    assert.equal(plan.edl.subtitles, false);
    const missing = await createPlan(brief, sources);
    assert.equal(missing.recipe_match?.status, 'needs_material'); assert(missing.recipe_match?.missing.includes('体验收束'));
  } finally { Object.assign(config, previous); await new Promise<void>(resolve => server.close(() => resolve())); }
});
