import { CheckCheck, LoaderCircle } from 'lucide-react';
import type { Task } from '../shared/types';

export function PlanApprovalAction({ task, busy, onConfirm }: {
  task: Task;
  busy: string;
  onConfirm: () => void;
}) {
  if (task.pending_patch || !['DRAFT_BRIEF', 'WAITING_PLAN_APPROVAL'].includes(task.state)) return null;
  if (task.preparation && ['queued', 'searching', 'planning'].includes(task.preparation.status)) return null;

  const ready = task.state === 'WAITING_PLAN_APPROVAL' && !!task.plan && !!task.edl;
  const needsMaterial = task.plan?.skill?.status === 'needs_material';
  const reason = !ready
    ? task.asset_ids.length
      ? '素材已就绪，请先生成剪辑方案。'
      : task.preparation?.references?.length
        ? '还缺少可剪辑的视频文件，参考链接暂不能直接生成视频。'
        : '请先添加视频素材，生成剪辑方案后即可确认。'
    : needsMaterial
      ? '所选技能还缺少必要素材，补充后即可生成。'
      : undefined;

  return <section className="plan-approval-action" aria-label="确认剪辑方案">
    {reason && <p id="plan-approval-description">{reason}</p>}
    <button type="button" className="button primary full" aria-describedby={reason ? 'plan-approval-description' : undefined}
      disabled={!!busy || !ready || needsMaterial} onClick={onConfirm}>
      {busy === 'approve-plan' ? <LoaderCircle size={16} className="spin" /> : <CheckCheck size={16} />}
      {busy === 'approve-plan' ? '正在开始生成…' : '确认并生成视频'}
    </button>
  </section>;
}
