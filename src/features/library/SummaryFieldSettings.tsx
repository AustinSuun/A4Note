import { useEffect, useId, useRef, useState } from 'react';
import type { SummaryColumn } from '../../core/librarySummary';
import { addSummaryField, renameSummaryField, reorderSummaryField, validateSummaryFieldCatalog } from '../../core/summaryFieldCatalog';
import './summary-field-settings.css';

export function SummaryFieldSettings({ columns, disabled, onSave, triggerLabel = '管理字段' }: {
  columns: SummaryColumn[]; disabled: boolean; triggerLabel?: string;
  onSave: (next: SummaryColumn[], baseline: SummaryColumn[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<SummaryColumn[] | null>(null), baseline = useRef<SummaryColumn[]>([]);
  const [name, setName] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  useEffect(() => { if (draft && !dialog.current?.open) dialog.current?.showModal(); }, [draft]);
  const close = () => { if (saving) return; dialog.current?.close(); setDraft(null); trigger.current?.focus(); };
  const apply = (operation: () => SummaryColumn[]) => {
    try { setDraft(operation()); setError(''); } catch (reason) { setError(String(reason)); }
  };
  const save = async () => {
    if (!draft || saving || rename) return;
    try {
      validateSummaryFieldCatalog(draft); setSaving(true); setError(''); setAttempted(true);
      await onSave(draft, baseline.current);
      dialog.current?.close(); setDraft(null); trigger.current?.focus();
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };
  return <>
    <button type="button" ref={trigger} disabled={disabled} onClick={() => {
      baseline.current = columns.map(column => ({ ...column })); setDraft(baseline.current);
      setName(''); setRename(null); setError(''); setAttempted(false);
    }}>{triggerLabel}</button>
    <dialog ref={dialog} className="summary-field-settings" aria-labelledby={titleId}
      onKeyDown={event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}>
      {draft && <>
        <h2 id={titleId}>总览字段目录</h2>
        <p>名称、显示和顺序适用于整个总览。新增字段不会给任何笔记补写空内容；已有笔记及字段标识保持不变。</p>
        <fieldset disabled={saving || attempted}>
          <legend className="summary-field-settings-legend">现有字段</legend>
          <ol>{draft.map((column, index) => <li key={column.id}>
            <label><input type="checkbox" checked={!column.hidden} aria-label={`显示${column.name}`}
              onChange={event => setDraft(draft.map(item => item.id === column.id ? { ...item, hidden: !event.target.checked } : item))} />
              <span>{column.name}{column.source && <small> · 论文信息</small>}</span></label>
            {rename?.id === column.id ? <form onSubmit={event => { event.preventDefault(); try {
              setDraft(renameSummaryField(draft, column.id, rename.value)); setRename(null); setError('');
            } catch (reason) { setError(String(reason)); } }}>
              <input autoFocus aria-label={`重命名${column.name}`} value={rename.value} onChange={event => setRename({ id: column.id, value: event.target.value })} />
              <button type="submit">确定名称</button><button type="button" onClick={() => setRename(null)}>取消重命名</button>
            </form> : <button type="button" aria-label={`重命名${column.name}`} onClick={() => setRename({ id: column.id, value: column.name })}>重命名</button>}
            <button type="button" aria-label={`上移${column.name}`} disabled={index === 0} onClick={() => apply(() => reorderSummaryField(draft, column.id, index - 1))}>↑</button>
            <button type="button" aria-label={`下移${column.name}`} disabled={index === draft.length - 1} onClick={() => apply(() => reorderSummaryField(draft, column.id, index + 1))}>↓</button>
          </li>)}</ol>
          <form onSubmit={event => { event.preventDefault(); try {
            setDraft(addSummaryField(draft, `custom-${crypto.randomUUID()}`, name)); setName(''); setError('');
          } catch (reason) { setError(String(reason)); } }} className="summary-field-settings-add">
            <label>新字段名称<input value={name} onChange={event => setName(event.target.value)} /></label>
            <button type="submit">添加到目录</button>
          </form>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={close}>{attempted ? '关闭，保留待重试设置' : '取消'}</button>
          <button type="button" disabled={saving || !!rename} onClick={() => void save()}>{saving ? '正在保存…' : '保存字段目录'}</button></footer>
      </>}
    </dialog>
  </>;
}
