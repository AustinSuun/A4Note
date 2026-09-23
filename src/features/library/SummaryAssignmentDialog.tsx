import { useId, useLayoutEffect, useRef, useState } from 'react';
import { summaryDocument, planSummaryAssignment, type SummaryAssignment } from '../../core/summaryDocument';
import { summaryFields, type SummaryColumn } from '../../core/librarySummary';
import './summary-field-settings.css';
import './summary-assignment.css';
export type AssignmentDraft = { scope: string; baseline: string; selection: { from: number; to: number; text: string } };
export type AssignmentCommit = (plan: SummaryAssignment, stillCurrent: () => boolean) => Promise<void>;
export function SummaryAssignmentDialog({ draft, columns, valid, commit, onClose }: {
  draft: AssignmentDraft; columns: SummaryColumn[]; valid: () => boolean; commit: AssignmentCommit; onClose: (fieldId?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(false), saving = useRef(false), latest = useRef({ columns, valid });
  latest.current = { columns, valid };
  const id = useId(), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => { alive.current = true; dialog.current?.showModal(); return () => { alive.current = false; }; }, []);
  const column = columns.find(c => c.id === target && !c.source);
  let plan: SummaryAssignment | null = null, problem = '';
  try { if (!valid()) throw new Error('笔记或字段目录已变化，请取消后重新选择。'); if (column) plan = planSummaryAssignment(summaryDocument(draft.baseline), draft.selection, column, { scope: draft.scope, mode: 'append', createIfMissing: true }); }
  catch (reason) { problem = String(reason); }
  const confirm = async () => {
    if (!plan || !column || saving.current) return;
    const proposal = plan, identity = JSON.stringify(column);
    const current = () => alive.current && latest.current.valid() && JSON.stringify(latest.current.columns.find(c => c.id === proposal.fieldId)) === identity;
    saving.current = true; setBusy(true); setError('');
    try {
      if (!current()) throw new Error('归类预览已过期，请重新选择。');
      await commit(proposal, current);
      if (alive.current) onClose(proposal.fieldId);
    } catch (reason) { if (alive.current) setError(`${String(reason)} 未在界面提前移除原文；如提示并发冲突，请先导出草稿再重新读取。`); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="summary-field-settings summary-assignment" aria-labelledby={id}
    onKeyDown={event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!saving.current) onClose(); }}>
    <h2 id={id}>归类选中文本</h2>
    <p>仅移动这次明确选中的自由文本。保存成功后才从原位置移除；目标已有内容不会被覆盖。</p>
    <label>目标字段<select aria-label="归类目标字段" value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setError(''); }}>
      <option value="">请选择目标字段</option>{columns.filter(c => !c.source).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
    </select></label>
    <h3>所选原文</h3><pre tabIndex={0} aria-label="所选原文">{draft.selection.text}</pre>
    {plan && <><p>{plan.createsField ? '本篇尚无此字段，确认将添加字段并归类。' : plan.previousValue ? '目标已有内容，只会追加，不会覆盖。' : '目标字段为空。'}</p>
      <h3>归类后目标内容</h3><pre tabIndex={0} aria-label="归类后目标内容">{summaryFields(plan.next).get(plan.fieldId)?.value}</pre></>}
    {(error || problem) && <p role="alert">{error || problem}</p>}
    <footer><button type="button" disabled={busy} onClick={() => onClose()}>取消归类</button>
      <button type="button" disabled={busy || !plan || !!problem} onClick={() => void confirm()}>{busy ? '正在保存归类…' : plan?.createsField ? '确认添加字段并归类' : plan?.previousValue ? '确认追加并归类' : '确认归类'}</button></footer>
  </dialog>;
}
