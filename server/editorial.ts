import type { Asset, Clip, EDL, Plan, QAReport, QAIssue, Shot } from '../shared/types.js';
import { assert, AppError } from './errors.js';

const matchingEvidence = (clip: Clip, shot: Shot) =>
  clip.asset_id === shot.asset_id && JSON.stringify(clip.evidence) === JSON.stringify(shot.evidence);

/** An old EDL may omit shot_id, but must never silently choose between overlapping annotations. */
export function resolveClipShot(clip: Clip, assets: Asset[]): Shot | undefined {
  const shots = assets.find(asset => asset.id === clip.asset_id)?.shots ?? [];
  if (clip.shot_id) return shots.find(shot => shot.id === clip.shot_id && matchingEvidence(clip, shot));
  const matches = shots.filter(shot => matchingEvidence(clip, shot) && clip.start_ms >= shot.start_ms && clip.end_ms <= shot.end_ms + 1);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Protected ranges include anticipation and reaction, not only the instant of contact. */
export function protectedRange(shot: Shot): [number, number] | undefined {
  const intent = shot.intent;
  if (!intent) return undefined;
  const start = intent.action_start_ms - intent.pre_roll_ms;
  const end = intent.action_end_ms + intent.post_roll_ms;
  assert(
    Number.isInteger(start) && Number.isInteger(end) &&
    intent.action_start_ms < intent.action_end_ms && intent.pre_roll_ms >= 0 && intent.post_roll_ms >= 0 &&
    start >= shot.start_ms && end <= shot.end_ms && end > start &&
    intent.message.trim() && intent.key_action.trim() && intent.evidence.description.trim() &&
    new Set(intent.evidence.observed_at_ms).size >= 2 &&
    intent.evidence.observed_at_ms.every(time => Number.isInteger(time) && time >= shot.start_ms && time <= shot.end_ms) &&
    Math.min(...intent.evidence.observed_at_ms) <= intent.action_start_ms && Math.max(...intent.evidence.observed_at_ms) >= intent.action_end_ms,
    'INVALID_SHOT_INTENT', `镜头「${shot.summary}」的关键动作标注不完整或超出素材范围；请补充覆盖动作开始与结束的观察时间点，并修正动作前后余量。`, 422,
  );
  return [start, end];
}

const covers = (clip: Clip, range: [number, number]) => clip.start_ms <= range[0] && clip.end_ms >= range[1];
const seconds = (time: number) => `${(time / 1000).toFixed(2)} 秒`;

export function validateEditorial(edl: EDL, assets: Asset[]): void {
  const shots = assets.flatMap(asset => asset.shots);
  const referenced = new Set<string>();
  for (const [index, clip] of edl.clips.entries()) {
    const shot = resolveClipShot(clip, assets);
    assert(shot, 'EVIDENCE_AMBIGUOUS', `第 ${index + 1} 镜头无法唯一对应素材证据；请重新规划并保留 shot_id，避免误用重叠的镜头标注。`, 422);
    referenced.add(`${clip.asset_id}:${shot.id}`);
    assert(clip.start_ms>=shot.start_ms&&clip.end_ms<=shot.end_ms+1,'EVIDENCE_NOT_FOUND','选段超出引用镜头的证据区间',422);
    const range = protectedRange(shot);
    if (range) assert(covers(clip, range), 'KEY_ACTION_CUT', `第 ${index + 1} 镜头剪掉了「${shot.intent!.key_action}」的关键信息。必须保留原片 ${seconds(range[0])} 至 ${seconds(range[1])}，包括动作前铺垫与完成后的反应；请延长选段或调整总时长。`, 422);
  }
  for (const shot of shots) {
    protectedRange(shot);
    if (shot.intent?.required) assert(referenced.has(`${shot.asset_id}:${shot.id}`), 'REQUIRED_ACTION_MISSING', `方案遗漏了必须保留的「${shot.intent.key_action}」。请恢复该镜头；如确需删掉，请先修改素材的关键动作标注并重新规划。`, 422);
  }
}

export function editorialReview(edl: EDL, assets: Asset[]): NonNullable<Plan['editorial_review']> {
  const items: NonNullable<Plan['editorial_review']>['items'] = edl.clips.map(clip => {
    const shot = resolveClipShot(clip, assets);
    let range: [number, number] | undefined;
    try { range = shot && protectedRange(shot); } catch { /* Report as unverified; strict validation rejects malformed annotations. */ }
    const protectedAction = !!shot?.intent && !!range && covers(clip, range);
    return {
      clip_id: clip.id,
      shot_id: shot?.id,
      status: protectedAction ? 'protected' : 'unverified',
      message: protectedAction
        ? `表达「${shot!.intent!.message}」；完整保留「${shot!.intent!.key_action}」及动作前后余量（原片 ${seconds(range![0])}–${seconds(range![1])}）。`
        : '尚未确认该镜头最关键的信息与动作完成点；请观看原片并标注，当前选段只依据已有时间范围。',
    };
  });
  return { status: items.every(item => item.status === 'protected') ? 'protected' : 'needs_review', items };
}

/** This checks EDL coverage against reviewed observations, not semantic understanding of rendered pixels. */
export function assessEditorial(edl: EDL, assets: Asset[]): { checks: QAReport['checks']; issues: QAIssue[] } {
  const checks: QAReport['checks'] = [];
  const issues: QAIssue[] = [];
  try {
    validateEditorial(edl, assets);
  } catch (error) {
    const message = error instanceof Error ? error.message : '镜头关键信息覆盖检查失败';
    checks.push({ name: '关键动作完整性', status: 'fail', detail: message });
    issues.push({ code: error instanceof AppError ? error.code : 'EDITORIAL_INVALID', severity: 'error', message, evidence: 'EDL 选段与人工确认的关键动作保护范围不一致。', repairability: 'human_review' });
    return { checks, issues };
  }
  const review = editorialReview(edl, assets);
  const protectedCount = review.items.filter(item => item.status === 'protected').length;
  if (protectedCount) checks.push({ name: '关键动作完整性', status: 'pass', detail: `${protectedCount} 个镜头完整覆盖人工确认的动作、铺垫及反应范围；此检查验证时间覆盖，不能代替观看成片。` });
  const unverified = review.items.filter(item => item.status === 'unverified');
  if (unverified.length) {
    checks.push({ name: '未标注镜头的核心信息', status: 'manual', detail: `${unverified.length} 个镜头没有经确认的核心信息与动作时间码，需逐镜观看；技术质检通过不代表叙事完整。` });
    issues.push({ code: 'EDITORIAL_NEEDS_REVIEW', severity: 'warning', message: `${unverified.length} 个镜头的关键内容尚未验证，可能存在动作被截断。`, evidence: unverified.map(item => item.clip_id).join(', '), repairability: 'human_review' });
  }
  return { checks, issues };
}
