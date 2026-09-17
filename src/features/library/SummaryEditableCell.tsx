import { useEffect, useRef, useState, type ReactNode } from 'react';
import { summaryFields, updateSummaryField, type SummaryColumn } from '../../core/librarySummary';
import type { TextDocumentSession } from '../../core/textDocumentSession';
import { editSummary } from '../../platform/library/summaries';

type Draft = { path?: string; baseline: string; value: string; applied?: string };
// Keep interrupted edits across virtual-row unmounts; local recovery also survives restart.
const drafts = new Map<string, Draft>();
function readDraft(key: string): Draft | undefined {
  if (drafts.has(key)) return drafts.get(key);
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value.baseline === 'string' && typeof value.value === 'string') {
      const draft = { path: typeof value.path === 'string' ? value.path : undefined, baseline: value.baseline, value: value.value, applied: typeof value.applied === 'string' ? value.applied : undefined };
      drafts.set(key, draft); return draft;
    }
  } catch { /* A malformed recovery record must not overwrite Markdown. */ }
}
export function SummaryEditableCell({ paperId, column, value, unavailable, onRepair, children }: {
  paperId: string; column: SummaryColumn; value: string; unavailable?: string;
  onRepair: () => void; children: ReactNode;
}) {
  const key = `a4note.summary-cell:${encodeURIComponent(paperId)}:${column.id}`;
  const [editing, setEditing] = useState(false), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [recovery, setRecovery] = useState(() => !!readDraft(key));
  const session = useRef<TextDocumentSession | null>(null), input = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true), working = useRef(false), composing = useRef(false), pendingBlur = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (editing && !busy) input.current?.focus({ preventScroll: true }); }, [editing, busy]);
  const remember = (draft: Draft) => {
    drafts.set(key, draft); setRecovery(true);
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setError('草稿暂存在内存中，请保持应用打开并完成保存。'); }
  };
  const begin = async () => {
    if (working.current || editing || unavailable) return;
    working.current = true; setBusy(true); setError('');
    try {
      const opened = await editSummary(paperId);
      if (!alive.current) return;
      const current = summaryFields(opened.getSnapshot().content).get(column.id)?.value ?? '';
      session.current = opened;
      const path = opened.getSnapshot().path;
      const recovered = readDraft(key);
      if (recovered && (recovered.path ? recovered.path !== path : path.startsWith('summary-note://'))) throw new Error('此草稿属于旧总览来源，不会写入新总结笔记。请先导出，确认后放弃旧草稿再编辑。');
      const draft = recovered ? { ...recovered, path } : { path, baseline: current, value: current };
      drafts.set(key, draft); setText(draft.value); setEditing(true);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const commit = async () => {
    if (composing.current) { pendingBlur.current = true; return; }
    const opened = session.current, draft = drafts.get(key);
    if (working.current || !opened || !draft) return;
    working.current = true; setBusy(true); setError('');
    try {
      const snapshot = opened.getSnapshot();
      if (draft.path !== snapshot.path) throw new Error('草稿来源不匹配，已停止写入。');
      const current = summaryFields(snapshot.content).get(column.id)?.value ?? '';
      if (current !== draft.baseline && current !== draft.value && current !== draft.applied) throw new Error('此字段已在 MD 中修改，未覆盖。请保留草稿并在完整 MD 中核对。');
      if (current !== draft.value) opened.update(updateSummaryField(snapshot.content, column, draft.value));
      const applied = { ...draft, applied: draft.value }; remember(applied);
      await opened.flush();
      if (opened.getSnapshot().status === 'error' || opened.dirty()) throw new Error(opened.getSnapshot().error || 'MD 尚未完成保存，请重试。');
      // An older async save must not remove a newer edit recovered after virtualization.
      if (drafts.get(key) === applied) {
        drafts.delete(key); try { localStorage.removeItem(key); } catch { /* Disk content is already saved. */ }
        if (alive.current) { setRecovery(false); setEditing(false); setError(''); }
      }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const cancel = () => {
    if (working.current) return;
    if (drafts.get(key)?.applied !== undefined && session.current?.dirty()) { setError('此草稿已进入 MD 保存会话，请重试保存或在完整 MD 中处理。'); return; }
    drafts.delete(key); try { localStorage.removeItem(key); } catch { /* Memory state remains usable. */ }
    setRecovery(false); setEditing(false); setError('');
  };
  const exportDraft = () => {
    const url = URL.createObjectURL(new Blob([drafts.get(key)?.value ?? text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '总览单元格草稿.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className={`summary-cell ${editing ? 'is-editing' : ''}`} data-summary-field={column.id} tabIndex={editing ? -1 : 0}
    aria-label={`${column.name}，双击或按 Enter 原位编辑`} onDoubleClick={() => void begin()}
    onKeyDown={event => { if (!editing && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void begin(); } }}>
    {editing ? <>
      <textarea ref={input} aria-label={`编辑${column.name}`} value={text} disabled={busy} spellCheck={false}
        onChange={event => { const draft = drafts.get(key); if (!draft) return; setText(event.target.value); remember({ ...draft, value: event.target.value }); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => {
          composing.current = false;
          const draft = drafts.get(key); if (draft) { setText(event.currentTarget.value); remember({ ...draft, value: event.currentTarget.value }); }
          if (pendingBlur.current) { pendingBlur.current = false; void commit(); }
        }}
        onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) void commit(); }}
        onKeyDown={event => {
          event.stopPropagation(); if (composing.current || event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); cancel(); }
          else if ((event.key === 'Enter' && !event.shiftKey) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) { event.preventDefault(); void commit(); }
        }} />
      <div className="summary-cell-edit-actions"><button type="button" disabled={busy} onClick={() => void commit()}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={cancel}>取消</button></div>
    </> : unavailable ? <button type="button" className="summary-warning" onClick={onRepair}>{unavailable}</button> : <>{busy ? <span className="summary-muted">打开中…</span> : children}{recovery && <button type="button" className="summary-cell-draft" onClick={() => void begin()}>继续草稿</button>}</>}
    {error && <div className="summary-cell-error" role="alert">{error}<button type="button" onClick={exportDraft}>导出草稿</button><button type="button" onClick={onRepair}>完整 MD</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('放弃这份单元格草稿？建议先导出。不会修改已保存内容。')) cancel(); }}>放弃单元格草稿</button></div>}
  </div>;
}
