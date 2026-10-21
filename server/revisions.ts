import { createHash, randomUUID } from 'node:crypto';
import type { Asset, Clip, EDL, Patch, PatchRegion, RevisionScope } from '../shared/types.js';
import { assert, AppError } from './errors.js';

const globalFields = ['aspect_ratio', 'resolution', 'fps', 'audio_gain', 'subtitles', 'title', 'cta', 'bgm', 'caption_style'] as const;
export const edlDigest = (edl: EDL) => createHash('sha256').update(JSON.stringify(edl)).digest('hex');
export function editingInstructions(feedback:string):string {
  const quotes:string[]=[];
  const masked=feedback.replace(/[“"「][^”"」]*[”"」]/g,value=>{quotes.push(value);return `__QUOTED_${quotes.length-1}__`;});
  return masked.replace(/(?:^|[，,；;。\n])([^，,；;。\n]+)/g,(whole,clause:string)=>!/(?:字幕|标题|文案|CTA)(?:改为|改成|设为|：|:)/i.test(clause)&&/(?:不要|别|不许|无需|不需要|不能|不得|禁止|不准).*(?:改|动|调整|修改|删除|换|静音|去掉|关闭)|不(?:静音|关闭|去掉|删除|调整|改动|修改|更换)|保持.*(?:不变|原样)|(?:其余|其他|其它).*(?:不变|别动)|保留原/.test(clause)?'':whole).replace(/__QUOTED_(\d+)__/g,(_m,i)=>quotes[Number(i)]);
}
export function resolveRevisionScope(edl: EDL, assets: Asset[], feedback: string, selectedIds?: string[]): RevisionScope {
  feedback=editingInstructions(feedback);
  const payload=feedback.match(/(?:配音|字幕|片头标题|标题|CTA|结尾文案|行动号召|文案)(?:改为|改成|设为|：|:)/i);
  if(payload?.index!==undefined)feedback=feedback.slice(0,payload.index+payload[0].length);
  const numbered = [...feedback.matchAll(/第\s*(\d+)\s*(?:个)?(?:镜头|段)/g)].map(m => Number(m[1]) - 1);
  if (/最后(?:一|1)?(?:个)?(?:镜头|段)|结尾(?:的)?镜头/.test(feedback)) numbered.push(edl.clips.length - 1);
  if (/第一个镜头|第一段|开头(?:的)?镜头|片头(?:的)?镜头/.test(feedback)) numbered.push(0);
  const explicit = [...new Set(numbered)];
  assert(explicit.every(i => edl.clips[i]), 'CLIP_NOT_FOUND', '指定的镜头不存在', 422);
  const all = /全片|全部镜头|整体|所有镜头|全局/.test(feedback);
  const allowedGlobals = (ids:string[]):RevisionScope['allowed_globals'] => [...(/标题/.test(feedback)&&ids.includes(edl.clips[0].id)?['title' as const]:[]), ...(/CTA|结尾文案|行动号召|片尾文案/i.test(feedback)&&ids.includes(edl.clips.at(-1)!.id)?['cta' as const]:[])];
  if (selectedIds?.length) {
    assert(new Set(selectedIds).size === selectedIds.length && selectedIds.every(id => edl.clips.some(c => c.id === id)), 'SCOPE_INVALID', '选定的修改镜头已变化，请重新选择', 409);
    assert(!all && explicit.every(i => selectedIds.includes(edl.clips[i].id)), 'SCOPE_CONFLICT', '建议中的范围与当前选定镜头不一致，请调整修改范围', 422);
    return { kind: 'clips', clip_ids: selectedIds, allowed_globals:allowedGlobals(selectedIds), basis: '用户在界面明确选定的镜头；其他镜头内容保持不变' };
  }
  if (explicit.length) return { kind: 'clips', clip_ids: explicit.map(i => edl.clips[i].id), allowed_globals:allowedGlobals(explicit.map(i=>edl.clips[i].id)), basis: '根据建议中明确的镜头编号定位' };
  if (all || /只保留字幕|仅保留字幕|^\s*(?:请)?(?:静音|去掉原声|关闭原声|原声音量|音量|关闭字幕|不要字幕|去掉字幕|开启字幕|显示字幕|恢复字幕)/.test(feedback)) return { kind: 'global', clip_ids: edl.clips.map(c => c.id), basis: '建议明确修改全片设置，影响范围会如实展示' };
  if (/标题/.test(feedback)&&/CTA|结尾文案|片尾文案|行动号召/i.test(feedback)) return {kind:'clips',clip_ids:[...new Set([edl.clips[0].id,edl.clips.at(-1)!.id])],allowed_globals:['title','cta'],basis:'仅修改片头标题和片尾文案'};
  if (/片头标题|标题/.test(feedback)) return { kind: 'clips', clip_ids: [edl.clips[0].id], allowed_globals: ['title'], basis: '标题仅作用于片头镜头' };
  if (/CTA|结尾文案|行动号召|片尾文案/i.test(feedback)) return { kind: 'clips', clip_ids: [edl.clips.at(-1)!.id], allowed_globals: ['cta'], basis: '结尾文案仅作用于末镜头' };
  // Only an unambiguous literal description can locate a shot in local mode.
  const subject = feedback.split(/字幕|文案|改为|改成|设为|缩短|保留前|取原片|音量/)[0].replace(/请|帮我|视频中|视频里|这段视频|镜头|片段|画面|修改|一下|把|将/g, '');
  const scored = edl.clips.map(clip => {
    const shot = assets.find(a => a.id === clip.asset_id)?.shots.find(s => s.id === clip.shot_id);
    const description = [clip.purpose, shot?.intent?.message, shot?.intent?.key_action, shot?.summary].join(' ');
    let score = 0;
    for (let n = Math.min(subject.length, 24); n >= 4 && !score; n--) for (let i = 0; i <= subject.length - n; i++) if (description.includes(subject.slice(i, i + n))) { score = n; break; }
    return { id: clip.id, score };
  }).sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 4 && scored[0].score > (scored[1]?.score || 0)) return { kind: 'clips', clip_ids: [scored[0].id], basis: '建议中的描述唯一对应当前镜头证据，请在片段预览中核对' };
  throw new AppError('REVISION_SCOPE_REQUIRED', '尚不能准确定位修改区间。请在下方选择目标镜头，或写明“第几镜头”；不会猜测范围或直接修改全片。', 422);
}

/** Lock the editing scope, without changing the user's persistent clip locks. */
export function assertRevisionScope(before: EDL, after: EDL, scope: RevisionScope) {
  if (scope.kind === 'global') return;
  for (const key of globalFields) assert(JSON.stringify(before[key]) === JSON.stringify(after[key]) || scope.allowed_globals?.includes(key as 'title' | 'cta'), 'REVISION_SCOPE_EXCEEDED', '修改超出了选定区间，已拦截全片设置变更', 422);
  const selected = new Set(scope.clip_ids), outside = before.clips.filter(c => !selected.has(c.id));
  const afterOutside = after.clips.filter(c => outside.some(o => o.id === c.id));
  assert(JSON.stringify(outside) === JSON.stringify(afterOutside), 'REVISION_SCOPE_EXCEEDED', '修改影响了范围外的镜头内容或顺序，已拦截', 422);
  for(const clip of outside){const ai=before.clips.indexOf(clip),bi=after.clips.findIndex(c=>c.id===clip.id);assert(renderIdentity(before,clip,ai)===renderIdentity(after,after.clips[bi],bi),'REVISION_SCOPE_EXCEEDED','修改导致范围外的镜头出现或丢失画面文案，请扩大范围后重新预览',422);}
  const gapById = new Map<string, number>(); let gap = 0;
  for (const c of before.clips) { if (selected.has(c.id)) gapById.set(c.id, gap); else gap++; }
  const allowedGaps = new Set(gapById.values()); gap = 0;
  for (const c of after.clips) {
    if (outside.some(o => o.id === c.id)) { gap++; continue; }
    assert(allowedGaps.has(gap) && (!gapById.has(c.id) || gapById.get(c.id) === gap), 'REVISION_SCOPE_EXCEEDED', '新片段或移动镜头超出了锁定的修改区间', 422);
  }
}

const frames = (clip: Clip, fps: number) => Math.max(1, Math.round((clip.end_ms - clip.start_ms) * fps / 1000));
function boundaries(edl: EDL) { const b = [0]; for (const c of edl.clips) b.push(b.at(-1)! + frames(c, edl.fps)); return b; }
export function renderedDuration(edl: EDL) { return boundaries(edl).at(-1)! * 1000 / edl.fps; }
function renderIdentity(edl: EDL, c: Clip, i: number) {
  return JSON.stringify([c.id, c.asset_id, c.start_ms, c.end_ms, c.audio_gain ?? 1, c.narration, c.audio_source, edl.subtitles?edl.caption_style:undefined, edl.audio_gain, edl.bgm, edl.aspect_ratio, edl.resolution, edl.fps, edl.subtitles ? c.caption : '', edl.subtitles && i === 0 ? edl.title : '', edl.subtitles && i === edl.clips.length - 1 ? edl.cta : '']);
}

/** Unchanged content anchors delimit changes; a downstream time shift is not itself a change. */
export function revisionRegions(before: EDL, after: EDL): PatchRegion[] {
  const {version:av,bgm:ab,...arest}=before,{version:bv,bgm:bb,...brest}=after;
  if(JSON.stringify(ab)!==JSON.stringify(bb)&&JSON.stringify(arest)===JSON.stringify(brest)){
    const end=renderedDuration(before);
    return [{id:randomUUID(),before_range:[0,end],after_range:[0,end],before_preview_range:[0,Math.min(8000,end)],after_preview_range:[0,Math.min(8000,end)],clip_ids:before.clips.map(c=>c.id)}];
  }
  const a = before.clips.map((c, i) => renderIdentity(before, c, i)), b = after.clips.map((c, i) => renderIdentity(after, c, i));
  const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0) as number[]);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
  const anchors: [number, number][] = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { anchors.push([i++, j++]); } else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++; }
  anchors.push([a.length, b.length]);
  const oldBounds = boundaries(before), newBounds = boundaries(after);
  const range = (bounds: number[], from: number, to: number, fps: number): [number, number] => [bounds[from] * 1000 / fps, bounds[to] * 1000 / fps];
  const context = (r: [number, number], edl: EDL): [number, number] => [Math.max(0, r[0] - 400), Math.min(renderedDuration(edl), r[1] + 400)];
  const regions: PatchRegion[] = []; let left = 0, right = 0;
  for (const [x, y] of anchors) {
    if (x > left || y > right) {
      const beforeRange = range(oldBounds, left, x, before.fps), afterRange = range(newBounds, right, y, after.fps);
      // A trim only changes its cut boundary. Shared source frames need not be
      // replayed in full; keep 400 ms around the actual removed/added portion.
      const sameLook = (ai:number,bi:number) => ai<x&&bi<y&&!before.clips[ai].narration&&!after.clips[bi].narration&&renderIdentity(before,{...before.clips[ai],start_ms:0,end_ms:0},ai)===renderIdentity(after,{...after.clips[bi],start_ms:0,end_ms:0},bi);
      if(left<x&&right<y){
        const firstA=before.clips[left],firstB=after.clips[right];
        if(sameLook(left,right)&&firstA.start_ms===firstB.start_ms){
          const common=Math.min(frames(firstA,before.fps)*1000/before.fps,frames(firstB,after.fps)*1000/after.fps);
          beforeRange[0]+=common;afterRange[0]+=common;
        }
        const lastA=before.clips[x-1],lastB=after.clips[y-1];
        const endA=lastA.start_ms+frames(lastA,before.fps)*1000/before.fps,endB=lastB.start_ms+frames(lastB,after.fps)*1000/after.fps;
        if(sameLook(x-1,y-1)&&Math.abs(endA-endB)<0.001){
          const common=Math.min(frames(lastA,before.fps)*1000/before.fps,frames(lastB,after.fps)*1000/after.fps,beforeRange[1]-beforeRange[0],afterRange[1]-afterRange[0]);
          beforeRange[1]-=common;afterRange[1]-=common;
        }
        if(beforeRange[1]-beforeRange[0]<0.001&&afterRange[1]-afterRange[0]<0.001){left=x+1;right=y+1;continue;}
      }
      regions.push({ id: randomUUID(), before_range: beforeRange, after_range: afterRange, before_preview_range: context(beforeRange, before), after_preview_range: context(afterRange, after), clip_ids: [...new Set([...before.clips.slice(left, x), ...after.clips.slice(right, y)].map(c => c.id))] });
    }
    left = x + 1; right = y + 1;
  }
  assert(regions.length, 'NO_VISIBLE_CHANGE', before.subtitles ? '此次修改没有改变画面、声音或剪辑，无法生成有差异的片段预览。' : '此次修改没有可见或可听变化。当前文案字幕已关闭；如要检查字幕修改效果，请先开启文案字幕。', 422);
  return regions;
}

/** Build only the review window; retain title/CTA positioning from the full timeline. */
export function slicePreview(edl: EDL, range: [number, number]): EDL {
  const b = boundaries(edl), startFrame = Math.max(0, Math.floor(range[0] * edl.fps / 1000 + 0.0001)), endFrame = Math.min(b.at(-1)!, Math.ceil(range[1] * edl.fps / 1000 - 0.0001));
  const indices: number[] = [];
  const clips = edl.clips.flatMap((clip, i) => {
    const from = Math.max(startFrame, b[i]), to = Math.min(endFrame, b[i + 1]);
    if (to <= from) return [];
    indices.push(i);
    const end = Math.min(clip.end_ms, clip.start_ms + (to - b[i]) * 1000 / edl.fps);
    const start = Math.max(clip.start_ms, end - (to - from) * 1000 / edl.fps);
    return [{ ...clip, start_ms: Math.round(start), end_ms: Math.round(end),...(edl.caption_style==='emphasis'?{caption_offset_ms:(clip.caption_offset_ms||0)+Math.round(start)-clip.start_ms}:{}),...(clip.audio_source?{audio_source:{...clip.audio_source,start_ms:clip.audio_source.start_ms+Math.round(start)-clip.start_ms,end_ms:clip.audio_source.start_ms+Math.round(end)-clip.start_ms}}:{}),...(clip.narration?{narration:{...clip.narration,full_duration_ms:clip.narration.full_duration_ms??Math.round(frames(clip,edl.fps)*1000/edl.fps),offset_ms:(clip.narration.offset_ms||0)+Math.round(start)-clip.start_ms}}:{}) }];
  });
  assert(clips.length, 'EMPTY_PATCH_PREVIEW', '修改区间没有可预览画面', 422);
  return { ...edl, clips, title: indices[0] === 0 ? edl.title : '', cta: indices.at(-1) === edl.clips.length - 1 ? edl.cta : '' };
}

export function assertPatchPreviewApproved(patch: Patch, current: EDL, previewId: string) {
  const preview = patch.preview;
  assert(preview?.status === 'ready' && preview.id === previewId, 'PATCH_PREVIEW_REQUIRED', '请先生成并检查当前修改的片段预览，再确认应用到完整视频', 409);
  assert(preview.base_digest === edlDigest(current) && preview.candidate_digest === edlDigest(patch.edl), 'STALE_PATCH_PREVIEW', '预览对应的基础版本或修改已变化，请重新生成片段预览', 409);
  assert(preview.regions.length && preview.regions.every(r => r.before?.qa.passed && r.after?.qa.passed && r.before.url && r.after.url), 'PATCH_PREVIEW_REQUIRED', '部分片段预览尚未通过检查，不能应用到全片', 409);
}
