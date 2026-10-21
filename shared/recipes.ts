import { z } from 'zod';
import type { Asset, Shot } from './types.js';

export const RecipeIdSchema = z.enum(['auto', 'pain_solution', 'demo', 'testimonial', 'before_after', 'unboxing', 'detail', 'story', 'benefits', 'offer']);
export type RecipeId = z.infer<typeof RecipeIdSchema>;
export const AdRoleSchema = z.enum(['pain', 'demo', 'result', 'testimonial', 'before', 'after', 'unboxing', 'detail', 'scene', 'benefit', 'offer']);
export type AdRole = z.infer<typeof AdRoleSchema>;
export const roleNames: Record<AdRole, string> = { pain: '痛点 / 问题', demo: '使用 / 制作过程', result: '完成 / 体验结果', testimonial: '真人评价', before: '对比前', after: '对比后', unboxing: '拆包 / 开箱', detail: '外观 / 细节', scene: '生活 / 使用场景', benefit: '已确认卖点', offer: '已确认优惠' };
export const researchSources = {
  cardina: { name: 'Cardina 服饰大促案例', date: '活动：2025-11', url: 'https://ads.tiktok.com/business/en/inspiration/cardina-fashion-case-study' },
  diego: { name: 'Diego dalla Palma 美妆案例', date: '发布：2026-07-30', url: 'https://ads.tiktok.com/business/en/inspiration/diego-dalla-palma-tiktok-success-stories' },
  next: { name: 'TikTok Next 2026 趋势报告', date: '2026 年趋势', url: 'https://ads.tiktok.com/business/en-GB/next' },
  guidance: { name: 'TikTok 官方创意结构指南', date: '长期方法参考', url: 'https://ads.tiktok.com/business/creativecenter/quicktok/online/tiktok_creative_accelerator/pc/en' },
  fashion: { name: 'TikTok 服饰创意模式', date: '发布：2022-11-30 · 长期方法', url: 'https://ads.tiktok.com/business/creativecenter/quicktok/online/creative-tips-fashion-apparel/pc/en' },
};
type SourceId = keyof typeof researchSources;
export interface RecipeStage { name: string; roles: AdRole[]; weight: number; required: boolean }
export interface Recipe { id: Exclude<RecipeId, 'auto'>; name: string; description: string; industries: string; rhythm: string; needs: string; stages: RecipeStage[]; sources: SourceId[] }
const stage = (name: string, roles: AdRole[], weight: number, required = true): RecipeStage => ({ name, roles, weight, required });
// Weights are product design choices, not measured performance statistics or hard cut lengths.
export const recipes: Recipe[] = [
  { id: 'pain_solution', name: '痛点解决', description: '先让观众认出问题，再看到解决过程。', industries: '家居 · 个护 · 服务 · 应用', rhythm: '问题简洁，演示充分，结果停留', needs: '问题画面、解决过程；有真实结果更好', stages: [stage('问题切入', ['pain'], 2), stage('解决过程', ['demo'], 5), stage('结果验证', ['result', 'after'], 3, false)], sources: ['guidance', 'next'] },
  { id: 'demo', name: '上手演示', description: '用完整操作，让产品价值一看就懂。', industries: '数码 · 家电 · 食饮 · 应用', rhythm: '减少准备，保留操作和最终效果', needs: '实际使用过程、完成或体验结果', stages: [stage('场景引入', ['scene', 'pain'], 2, false), stage('关键操作', ['demo'], 5), stage('完成体验', ['result', 'after'], 3)], sources: ['cardina', 'guidance'] },
  { id: 'testimonial', name: '真人口碑', description: '真实评价配合使用证据，建立信任。', industries: '消费品 · 本地服务 · 企业服务', rhythm: '完整保留观点，画面补充体验依据', needs: '含原声与逐字稿的真人评价、使用或结果画面', stages: [stage('真实评价', ['testimonial'], 4), stage('体验依据', ['demo', 'result'], 5), stage('产品补充', ['detail', 'benefit'], 1, false)], sources: ['diego', 'next', 'fashion'] },
  { id: 'before_after', name: '前后对比', description: '同一对象的真实变化，按前因后果展开。', industries: '家居清洁 · 美妆 · 改造服务', rhythm: '交代原状，过程连接，结果看清', needs: '同组对比前后素材；在注释中填写相同对比组', stages: [stage('原始状态', ['before'], 3), stage('变化过程', ['demo'], 3, false), stage('真实变化', ['after'], 4)], sources: ['guidance', 'fashion'] },
  { id: 'unboxing', name: '开箱体验', description: '从拆开包装到实际使用，兑现期待。', industries: '电商 · 数码 · 美妆 · 礼赠', rhythm: '拆封有期待，亮相和首次体验完整', needs: '开箱、产品细节、首次使用或体验结果', stages: [stage('拆封期待', ['unboxing'], 3), stage('产品亮相', ['detail'], 2), stage('首次体验', ['demo', 'result'], 5)], sources: ['guidance', 'fashion'] },
  { id: 'detail', name: '质感特写', description: '通过细节与真实体验，呈现产品质感。', industries: '咖啡食饮 · 香氛 · 珠宝 · 服饰', rhythm: '细节连贯，体验收尾留足时间', needs: '细节特写、使用或品味结果', stages: [stage('质感细节', ['detail'], 5), stage('工艺展开', ['demo'], 2, false), stage('体验收束', ['result'], 3)], sources: ['fashion', 'diego'] },
  { id: 'story', name: '场景故事', description: '围绕一个生活片段，让产品自然进入。', industries: '生活方式 · 食饮 · 出行 · 服务', rhythm: '场景建立，行动展开，情绪落点', needs: '明确场景、行动过程、结果或人物反应', stages: [stage('场景建立', ['scene'], 3), stage('行动展开', ['demo', 'pain'], 4), stage('体验落点', ['result'], 3)], sources: ['next', 'diego', 'fashion'] },
  { id: 'benefits', name: '卖点速览', description: '逐项展示已确认卖点，并用演示支撑。', industries: '电商 · 数码 · 家电 · 软件', rhythm: '一段一个信息，按重要性展开', needs: '已确认卖点，以及对应使用演示', stages: [stage('核心卖点', ['benefit'], 3), stage('演示支撑', ['demo'], 5), stage('结果收束', ['result'], 2, false)], sources: ['cardina', 'guidance'] },
  { id: 'offer', name: '优惠转化', description: '已有活动信息切入，再给出购买理由。', industries: '电商大促 · 零售 · 本地服务', rhythm: '优惠清楚，产品演示与价值充分', needs: '原素材中的真实优惠信息、产品演示或卖点', stages: [stage('活动信息', ['offer'], 2), stage('购买理由', ['demo', 'benefit'], 5), stage('体验补充', ['result', 'detail'], 3, false)], sources: ['cardina', 'guidance'] },
];
export const recipeName = (id: RecipeId | 'safe' | undefined) => id === 'safe' ? '保留素材顺序' : recipes.find(r => r.id === id)?.name || '自动匹配';
export interface ShotRoleEvidence { shot_id: string; asset_id: string; roles: AdRole[]; basis: string; comparison_group?: string }
export interface RecipeMatch {
  requested: RecipeId; resolved: RecipeId | 'safe'; status: 'matched' | 'needs_material'; reason: string;
  missing: string[]; evidence: ShotRoleEvidence[]; assignments: Record<string, number>;
  alternatives: { id: Recipe['id']; matched_stages: number; total_stages: number; ready: boolean }[];
  catalog_version: string;
}
const patterns: Partial<Record<AdRole, RegExp>> = {
  pain: /痛点|困扰|遇到问题|失败|脏污|污渍|卡顿|麻烦|problem|struggle/i,
  demo: /演示|操作|制作|倒入|冲泡|萃取|研磨|涂抹|试用|使用过程|冲洗|清洁过程|demo|tutorial/i,
  result: /完成|结果|品味|品尝|喝下|饮用|喝咖啡|触唇|放下杯|享受|满意|成品|喝一口|finished|result/i,
  unboxing: /开箱|拆封|拆包|打开包装|unbox/i,
  detail: /特写|细节|质感|纹理|外观|拉花|close.up|texture/i,
  scene: /场景|生活|日常|早晨|早餐|办公室|通勤|阅读|休息|morning|routine/i,
};
export function shotRoles(assets: Asset[]): ShotRoleEvidence[] {
  return assets.flatMap(asset => asset.shots.filter(s => s.end_ms - s.start_ms >= 100).map(shot => {
    // Neither a filename nor one thumbnail proves an event, a testimonial or a product claim.
    const trusted = shot.evidence.type === 'user_annotation';
    const text = trusted ? (shot.intent ? [shot.intent.message, shot.intent.key_action].join('；') : shot.summary).replace(/https?:\/\/\S+/g, '') : '';
    const affirmative = text.split(/[。；！？;!?.]/).filter(t => !/尚未|还没|没有|未(?:见|发生|完成|饮用|喝|确认|识别)|不(?:是|含|能)|缺少|未知|待确认|无法|\b(?:not|without|no)\b/i.test(t)).join('；');
    let roles: AdRole[] = trusted ? shot.ad_roles ?? (Object.entries(patterns).filter(([, re]) => re!.test(affirmative)).map(([role]) => role as AdRole)) : [];
    roles = roles.filter(role => role !== 'testimonial' || (!!shot.transcript?.trim() && asset.has_audio));
    return { shot_id: shot.id, asset_id: asset.id, roles, basis: roles.length ? `${shot.ad_roles ? '已确认的素材用途' : '根据人工注释推断，需审阅'}：${text.slice(0, 120)}` : '缺少可用内容证据；请在素材注释中确认画面用途', comparison_group: trusted ? shot.comparison_group?.trim() : undefined };
  }));
}
function evaluate(recipe: Recipe, evidence: ShotRoleEvidence[]) {
  const assignments: Record<string, number> = {};
  const eligible = (e: ShotRoleEvidence, s: RecipeStage) => e.roles.some(role => s.roles.includes(role));
  let pool = evidence;
  if (recipe.id === 'before_after') {
    const groups = [...new Set(evidence.map(e => e.comparison_group).filter(Boolean))];
    const group = groups.find(g => evidence.some(e => e.comparison_group === g && e.roles.includes('before')) && evidence.some(e => e.comparison_group === g && e.roles.includes('after')));
    pool = group ? evidence.filter(e => e.comparison_group === group) : [];
  }
  // One shot serves one stage. Find distinct evidence for each required stage before adding context.
  const assign = (index: number, seen: Set<string>): boolean => {
    for (const e of pool.filter(e => eligible(e, recipe.stages[index]))) {
      if (seen.has(e.shot_id)) continue;
      seen.add(e.shot_id);
      const previous = assignments[e.shot_id];
      if (previous === undefined || assign(previous, seen)) { assignments[e.shot_id] = index; return true; }
    }
    return false;
  };
  recipe.stages.forEach((s, i) => { if (s.required) assign(i, new Set()); });
  recipe.stages.forEach((s, i) => { if (!s.required) assign(i, new Set()); });
  pool.forEach(e => { if (assignments[e.shot_id] === undefined) { const i = recipe.stages.findIndex(s => eligible(e, s)); if (i >= 0) assignments[e.shot_id] = i; } });
  const missing = recipe.stages.filter((s, i) => s.required && !Object.values(assignments).includes(i)).map(s => s.name);
  if (recipe.id === 'before_after' && !pool.length) missing.push('同一对比组的前后素材');
  const matched = new Set(Object.values(assignments)).size;
  return { assignments, missing, matched, ready: !missing.length };
}
export function matchRecipe(assets: Asset[], requested: RecipeId = 'auto'): RecipeMatch {
  const evidence = shotRoles(assets);
  const ranked = recipes.map(recipe => ({ recipe, ...evaluate(recipe, evidence) })).sort((a, b) => Number(b.ready) - Number(a.ready) || (b.matched / b.recipe.stages.length) - (a.matched / a.recipe.stages.length) || Object.keys(b.assignments).length - Object.keys(a.assignments).length);
  const chosen = requested === 'auto' ? ranked.find(r => r.ready) : ranked.find(r => r.recipe.id === requested);
  const ready = !!chosen?.ready;
  return { requested, resolved: ready ? chosen!.recipe.id : 'safe', status: ready ? 'matched' : 'needs_material', reason: ready ? `${requested === 'auto' ? '自动建议' : '已选择'}「${chosen!.recipe.name}」：${chosen!.matched} 个结构环节有素材依据；${evidence.filter(e => !e.roles.length).length ? `另有 ${evidence.filter(e => !e.roles.length).length} 段用途待确认；` : ''}仍需审阅镜头衔接。` : requested === 'auto' ? '素材内容证据不足以组成完整套路，先保留素材顺序。可编辑素材注释，或分析关键动作并确认后重新匹配。' : `「${recipeName(requested)}」缺少必要素材，当前保留原顺序；补齐下列素材后再应用该套路。`, missing: ready ? [] : chosen?.missing || ['至少两个不同片段的内容注释与素材用途'], evidence, assignments: ready ? chosen!.assignments : {}, alternatives: ranked.slice(0, 3).map(r => ({ id: r.recipe.id, matched_stages: r.matched, total_stages: r.recipe.stages.length, ready: r.ready })), catalog_version: '2026-10-02' };
}

export function recipeShotOrder(shots: Shot[], match: RecipeMatch): Shot[] {
  const recipe = recipes.find(r => r.id === match.resolved);
  if (!recipe) return shots;
  // Unclassified mandatory footage stays before the ending, so it cannot displace the payoff.
  const rank = (s: Shot) => match.assignments[s.id] ?? recipe.stages.length - 1.5;
  return [...shots].sort((a, b) => rank(a) - rank(b));
}
export function recipeShotWeight(shot: Shot, match: RecipeMatch, selected: Shot[]): number {
  const recipe = recipes.find(r => r.id === match.resolved), index = match.assignments[shot.id];
  if (!recipe || index === undefined) return shot.intent?.priority || 1;
  const same = selected.filter(s => match.assignments[s.id] === index);
  const total = same.reduce((sum, s) => sum + (s.intent?.priority || 1), 0);
  return recipe.stages[index].weight * (shot.intent?.priority || 1) / total;
}
