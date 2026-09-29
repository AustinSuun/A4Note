import { forwardRef, lazy, Suspense, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaperDocument } from '../../core/types';
import { parseSummaryLayout, type SummaryColumn } from '../../core/librarySummary';
import { summaryDocument, replaceSummaryFreeText, type SummarySegment } from '../../core/summaryDocument';
import { replaceSummaryFieldText, summaryEditorPatch, summaryEditorSelection } from '../../core/summaryEditorPatch';
import { moveSummaryFieldBeside, orderSummarySegments, sameSummaryFieldOrder, visibleSummaryFieldIds } from '../../core/summaryFieldOrder';
import { SummaryAssignmentDialog, type AssignmentDraft, type AssignmentCommit } from './SummaryAssignmentDialog';
import { paperNoteImageDocument } from '../../core/paperImageReference';
import { summaryLayoutSession, uploadSummaryImage } from '../../platform/library/summaries';
import { saveSummaryFieldCatalog } from '../../platform/library/summaryFieldCatalog';
import type { TextDocumentSession } from '../../core/textDocumentSession';
import { SummaryFieldSettings } from './SummaryFieldSettings';
import type { MarkdownLiveEditorHandle } from '../reader/MarkdownLiveEditor';
import './summary-document-editor.css';
const Editor = lazy(() => import('../reader/MarkdownLiveEditor').then(m => ({ default: m.MarkdownLiveEditor })));
const Preview = lazy(() => import('../reader/MarkdownReadContent').then(m => ({ default: m.MarkdownReadContent })));

/** A view over the parent's existing document session, never a second note store. */
type Props = {
  paper: PaperDocument; scope: string; source: string; getCurrent: () => string;
  onChange: (value: string) => void; onBlur: () => void; onSource: () => void;
  readOnly?: boolean; surfaceActive?: boolean; onNavigateAnnotation?: (id: string) => void;
  onAssign?: AssignmentCommit;
};
export const SummaryDocumentEditor = forwardRef<MarkdownLiveEditorHandle, Props>(function SummaryDocumentEditor({ paper, scope, source, getCurrent, onChange, onBlur, onSource, readOnly = false, surfaceActive = true, onNavigateAnnotation = () => {}, onAssign }, forwardedRef) {
  const [columns, setColumns] = useState<SummaryColumn[]>([]), [catalogError, setCatalogError] = useState('');
  const [active, setActive] = useState<string | null>(null), [choice, setChoice] = useState(''), [error, setError] = useState('');
  const editor = useRef<MarkdownLiveEditorHandle>(null);
  const focusPending = useRef(false);
  const catalog = useRef<TextDocumentSession | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDraft | null>(null);
  // Global field sorting: pointer drag from a handle (or ↑/↓ on it) rewrites only the catalog order, never a note.
  const [drag, setDrag] = useState<{ id: string; over: string | null; side: 'before' | 'after' } | null>(null);
  const [sorting, setSorting] = useState(false), [notice, setNotice] = useState('');
  const dragRef = useRef<{ id: string; pointerId: number; over: string | null; side: 'before' | 'after'; y: number; frame: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(false), context = useRef({ scope, readOnly, surfaceActive, getCurrent });
  context.current = { scope, readOnly, surfaceActive, getCurrent };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useImperativeHandle(forwardedRef, () => {
    const perform = (action: (target: MarkdownLiveEditorHandle) => void) => {
      if (readOnly || !surfaceActive) return;
      if (assignment) { setError('请先完成或取消归类预览。'); return; }
      if (editor.current) action(editor.current);
      else setError('请先点击要编辑的字段或自由区域，待编辑器加载后重试格式、模板或引用操作。');
    };
    return {
      pickImages: () => perform(target => target.pickImages()),
      setMarkdown: value => perform(target => target.setMarkdown(value)),
      focus: () => perform(target => target.focus()),
      hasSelection: () => !readOnly && surfaceActive && !assignment && (editor.current?.hasSelection() ?? false),
      getSelection: () => !readOnly && surfaceActive && !assignment ? editor.current?.getSelection() ?? null : null,
      insertMarkdown: (before, after, placeholder) => perform(target => target.insertMarkdown(before, after, placeholder)),
      insertTemplate: (value, block) => perform(target => target.insertTemplate(value, block)),
      clearFormatting: () => perform(target => target.clearFormatting()),
    };
  }, [readOnly, surfaceActive, assignment]);
  const parsed = useMemo(() => { try { return { document: summaryDocument(source), error: '' }; } catch (reason) { return { document: null, error: String(reason) }; } }, [source]);
  // Direct editing: the chosen region mounts the shared editor lazily, so move focus once it exists (bounded retry, never a blind timer).
  // Always wait for the next frame: focusing inside the same commit would target a CodeMirror view that dev StrictMode is about to recreate.
  useEffect(() => {
    if (!active || !focusPending.current) return;
    let frame = 0, tries = 0;
    const tick = () => {
      if (!alive.current || !focusPending.current) return;
      const host = globalThis.document.querySelector(`[data-summary-segment="${CSS.escape(active)}"] .cm-content`);
      if (host && editor.current) { editor.current.focus(); focusPending.current = false; return; }
      if (++tries < 120) frame = requestAnimationFrame(tick);
      else focusPending.current = false;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useEffect(() => {
    let alive = true, stop: (() => void) | undefined;
    void summaryLayoutSession().then(session => {
      if (!alive) return;
      catalog.current = session;
      const refresh = () => { try { setColumns(parseSummaryLayout(session.getSnapshot().content).columns); setCatalogError(session.getSnapshot().error || ''); } catch (reason) { setCatalogError(String(reason)); } };
      refresh(); stop = session.subscribe(refresh);
    }).catch(reason => { if (alive) setCatalogError(String(reason)); });
    return () => { alive = false; catalog.current = null; stop?.(); };
  }, []);
  const commitOrder = async (id: string, target: string, side: 'before' | 'after') => {
    const session = catalog.current;
    if (!session || sorting) return;
    const baseline = columns;
    const known = session.getSnapshot();
    try {
      const next = moveSummaryFieldBeside(baseline, id, target, side);
      if (sameSummaryFieldOrder(baseline, next)) return;
      setSorting(true); setError('');
      await saveSummaryFieldCatalog(session, next, baseline);
      const name = (fieldId: string) => next.find(column => column.id === fieldId)?.name ?? fieldId;
      if (alive.current) setNotice(`已更新全局字段顺序：${name(id)} 现在位于 ${name(target)} 之${side === 'before' ? '前' : '后'}（第 ${next.findIndex(column => column.id === id) + 1} / ${next.length} 位）。`);
    } catch (reason) {
      // Nothing reached disk under our expected content: drop the rejected draft so every view shows the last known saved order.
      const now = session.getSnapshot();
      if (now.baseline === known.baseline && now.content !== known.content) session.update(known.content);
      if (alive.current) setError(`字段顺序未保存，已恢复原顺序：${String(reason)}`);
    } finally { if (alive.current) setSorting(false); }
  };
  const dropTarget = (clientY: number, dragged: string): { over: string | null; side: 'before' | 'after' } => {
    const container = root.current;
    if (!container) return { over: null, side: 'after' };
    const cards = [...container.querySelectorAll<HTMLElement>('[data-summary-field]')].filter(card => card.dataset.summaryField !== dragged);
    let over: string | null = null, side: 'before' | 'after' = 'after';
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (clientY < box.top + box.height / 2) { over = card.dataset.summaryField ?? null; side = 'before'; break; }
      over = card.dataset.summaryField ?? null; side = 'after';
    }
    return { over, side };
  };
  const endDrag = (commit: boolean) => {
    const state = dragRef.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    dragRef.current = null;
    setDrag(null);
    if (commit && state.over) void commitOrder(state.id, state.over, state.side);
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || dragRef.current || sorting) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, over: null, side: 'after', y: event.clientY, frame: 0 };
    setDrag({ id, over: null, side: 'after' }); setNotice(''); setError('');
    // Auto-scroll the surface while the pointer rests near an edge, so long notes stay sortable without lifting the finger.
    const tick = () => {
      const state = dragRef.current, container = root.current;
      if (!state || !container) return;
      const box = container.getBoundingClientRect(), margin = 36;
      if (state.y < box.top + margin && container.scrollTop > 0) container.scrollTop -= Math.min(14, (box.top + margin - state.y) / 2 + 2);
      else if (state.y > box.bottom - margin) container.scrollTop += Math.min(14, (state.y - (box.bottom - margin)) / 2 + 2);
      state.frame = requestAnimationFrame(tick);
    };
    dragRef.current.frame = requestAnimationFrame(tick);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    state.y = event.clientY;
    const target = dropTarget(event.clientY, state.id);
    if (target.over !== state.over || target.side !== state.side) { state.over = target.over; state.side = target.side; setDrag({ id: state.id, over: target.over, side: target.side }); }
  };
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); endDrag(false); } };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [drag]);
  if (!parsed.document) return <div role="alert" className="summary-warning">{parsed.error}<button type="button" onClick={onSource}>打开高级源码修复</button></div>;
  const document = parsed.document;
  const available = columns.filter(c => !c.source && !document.segments.some(s => s.kind === 'field' && s.id === c.id));
  const label = (segment: SummarySegment, index: number) => segment.kind === 'field' ? columns.find(c => c.id === segment.id)?.name ?? `未登记字段 ${segment.id}` : `自由内容 ${document.segments.slice(0, index + 1).filter(s => s.kind === 'free' && (s.value.trim() || s.key === active || document.segments.length === 1)).length}`;
  const canEdit = !readOnly && surfaceActive;
  const ordered = orderSummarySegments(document.segments, columns);
  const sortable = canEdit && !catalogError && !!catalog.current ? visibleSummaryFieldIds(document.segments, columns) : [];
  const canSort = sortable.length > 1;
  const activate = (segment: SummarySegment) => {
    if (!canEdit || segment.kind === 'technical') return;
    if (assignment) { setError('请先完成或取消归类预览。'); return; }
    focusPending.current = true; setActive(segment.key); setError('');
  };
  const edit = (segment: SummarySegment, value: string) => {
    if (readOnly || !surfaceActive || segment.kind === 'technical') return;
    if (value === segment.value) return;
    try {
      let nextValue = summaryEditorPatch(segment.value, value);
      let next: string;
      if (segment.kind === 'field') next = replaceSummaryFieldText(source, getCurrent(), { id: segment.id, name: label(segment, 0) }, nextValue);
      else {
        // Keep the structural line boundary before the next marker out of the user's way.
        if (segment.end < source.length && nextValue && !nextValue.endsWith('\n')) nextValue += source.includes('\r\n') ? '\r\n' : '\n';
        next = replaceSummaryFreeText(document, getCurrent(), segment.key, nextValue);
      }
      onChange(next); setError('');
    } catch (reason) { editor.current?.setMarkdown(segment.value); setError(`${String(reason)} 本次修改未应用，原文已保留。`); }
  };
  return <div ref={root} className={`summary-document-editor${drag ? ' sorting' : ''}`}>
    {catalogError && <p role="alert" className="summary-warning">字段目录暂不可用：{catalogError}</p>}
    {canEdit ? <div className="summary-document-add" role="group" aria-label="字段与自由内容">
      <div className="summary-document-add-group">
        <span className="summary-document-add-label">字段</span>
        <SummaryFieldSettings columns={columns} disabled={!catalog.current} triggerLabel="新建或管理字段" onSave={async (next, baseline) => {
          const session = catalog.current;
          if (!session) throw new Error('字段目录尚未加载。');
          await saveSummaryFieldCatalog(session, next, baseline);
          const added = next.filter(column => !baseline.some(old => old.id === column.id));
          if (added.length === 1) setChoice(added[0].id);
        }} />
        <label className="summary-document-add-pick"><span className="summary-document-sr">添加已有字段</span><select aria-label="添加已有字段" value={choice} onChange={event => setChoice(event.target.value)} disabled={!!catalogError}>
          <option value="">{available.length ? '选择要添加的字段…' : '没有可添加的字段'}</option>{available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <button type="button" disabled={!available.some(c => c.id === choice) || !!catalogError} onClick={() => {
          try { const column = available.find(c => c.id === choice)!; onChange(replaceSummaryFieldText(source, getCurrent(), column, '', true)); focusPending.current = true; setActive(`field:${column.id}`); setChoice(''); setError(''); }
          catch (reason) { setError(String(reason)); }
        }}>添加到本篇</button>
      </div>
      <div className="summary-document-add-group">
        <span className="summary-document-add-label">自由内容</span>
        <button type="button" onClick={() => {
          if (getCurrent() !== source) { setError('笔记已变化，请重试。'); return; }
          const last = document.segments.at(-1);
          focusPending.current = true;
          if (last?.kind === 'free') setActive(last.key);
          else { const eol = source.includes('\r\n') ? '\r\n' : '\n'; onChange(source + eol); setActive(`free:${source.length}`); }
        }}>在末尾写自由内容</button>
      </div>
      <p className="summary-document-hint">仅明确添加的字段参与总览；新建字段先保存到全局目录，再“添加到本篇”，不会补写其他笔记。自由内容保持原位置，不会自动归入字段。点击任一区域即可直接编辑；字段卡片按全局字段顺序显示，拖动左侧把手（或聚焦把手后按 ↑/↓）会调整所有总览笔记共用的顺序，不改写任何笔记正文。</p>
    </div> : <p className="summary-document-hint">仅明确添加的字段参与总览。自由内容保持原位置，不按标题或相邻字段自动归类。</p>}
    {ordered.map(segment => {
      const index = document.segments.indexOf(segment);
      if (segment.kind === 'technical') return null;
      if (segment.kind === 'free' && !segment.value.trim() && segment.key !== active && document.segments.length > 1) return null;
      const title = label(segment, index);
      const editing = canEdit && active === segment.key;
      const fieldId = segment.kind === 'field' ? segment.id : null;
      const sortIndex = fieldId ? sortable.indexOf(fieldId) : -1;
      const handle = canSort && sortIndex >= 0;
      const lifted = drag?.id === fieldId, dropBefore = drag && drag.over === fieldId && drag.side === 'before', dropAfter = drag && drag.over === fieldId && drag.side === 'after';
      const rank = fieldId ? columns.findIndex(column => column.id === fieldId) : -1;
      return <section className={`summary-document-section ${segment.kind}${editing ? ' editing' : ''}${handle ? ' sortable' : ''}${lifted ? ' lifted' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''}`} key={segment.key}
        data-summary-segment={segment.key} data-summary-field={handle ? fieldId! : undefined} data-editing={editing || undefined}>
        <header>
          {handle && <button type="button" className="summary-document-handle" aria-disabled={sorting || undefined} aria-busy={sorting || undefined}
            aria-label={`拖动排序 ${title}，全局第 ${rank + 1} / ${columns.length} 位；按 ↑ 或 ↓ 移动`} title="拖动或按 ↑/↓ 调整全局字段顺序（对所有总览笔记生效）"
            onPointerDown={event => startDrag(event, fieldId!)} onPointerMove={moveDrag}
            onPointerUp={event => { if (dragRef.current?.pointerId === event.pointerId) endDrag(true); }}
            onPointerCancel={() => endDrag(false)} onLostPointerCapture={() => { if (dragRef.current) endDrag(false); }}
            onClick={event => event.preventDefault()}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault(); event.stopPropagation();
              if (sorting) return;
              const neighbour = sortable[sortIndex + (event.key === 'ArrowUp' ? -1 : 1)];
              if (!neighbour) { setNotice(event.key === 'ArrowUp' ? `${title} 已在本篇最前。` : `${title} 已在本篇最后。`); return; }
              void commitOrder(fieldId!, neighbour, event.key === 'ArrowUp' ? 'before' : 'after');
            }}>
            <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="3" cy="3" r="1.4" /><circle cx="7" cy="3" r="1.4" /><circle cx="3" cy="8" r="1.4" /><circle cx="7" cy="8" r="1.4" /><circle cx="3" cy="13" r="1.4" /><circle cx="7" cy="13" r="1.4" /></svg>
          </button>}
          <strong>{segment.kind === 'field' ? <><span className="summary-document-kind">字段</span>{title}</> : title}</strong>
          {editing && <span className="summary-document-status" aria-live="polite">编辑中</span>}
          {editing && <div className="summary-document-section-tools">
            <button type="button" onClick={() => editor.current?.pickImages()}>添加图片到此区域</button>
            {segment.kind === 'free' && onAssign && <button type="button" disabled={!!catalogError} onMouseDown={event => event.preventDefault()} onClick={() => {
              try {
                if (source !== getCurrent()) throw new Error('笔记已变化，请重新选择。');
                const selected = editor.current?.getSelection();
                if (!selected) throw new Error('请在当前自由区域中明确选择一段文字。');
                const raw = summaryEditorSelection(segment.value, selected);
                if (!raw.text.trim()) throw new Error('不能归类空白选区。');
                setAssignment({ scope, baseline: source, selection: { from: segment.start + raw.from, to: segment.start + raw.to, text: raw.text } }); setError('');
              } catch (reason) { setError(String(reason)); }
            }}>归类选中文本</button>}
            {segment.kind === 'free' && !onAssign && <small>此来源暂不支持归类事务。</small>}
          </div>}
        </header>
        <Suspense fallback={<p className="summary-document-hint">加载编辑器…</p>}>
          {editing ? <Editor ref={editor} markdown={segment.value} documentPath={paperNoteImageDocument(paper.paperId, scope)} imageUpload={file => uploadSummaryImage(paper.paperId, file)} placeholder={segment.kind === 'field' ? '填写此字段' : '自由记录，不会自动进入字段'} onChange={value => edit(segment, value)} onBlur={onBlur} />
            : <div className={`md-body summary-document-preview${canEdit ? ' editable' : ''}${segment.value.trim() ? '' : ' empty'}`}
              role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : undefined} aria-label={canEdit ? `编辑${title}` : undefined}
              onClick={event => {
                if (!canEdit) return;
                const target = event.target as HTMLElement;
                // Links, embedded controls and a deliberate text selection keep their own behaviour; everything else starts editing in place.
                const control = target.closest('a, button, input, select, textarea, summary, [role="button"], [data-annotation-ref]');
                if (control && control !== event.currentTarget) return;
                if (window.getSelection()?.toString()) return;
                activate(segment);
              }}
              onKeyDown={event => {
                if (!canEdit || event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'F2') { event.preventDefault(); activate(segment); }
              }}>
              {segment.value.trim() ? <Preview markdown={segment.value} paper={paper} onNavigateAnnotation={onNavigateAnnotation} /> : <p className="summary-document-empty">{canEdit ? '尚未填写，点击开始输入' : '尚未填写'}</p>}
            </div>}
        </Suspense>
      </section>;
    })}
    <p className="summary-document-notice" aria-live="polite">{notice}</p>
    {error && <p role="alert" className="summary-warning">{error}{/源码/.test(error) && <button type="button" onClick={onSource}>打开源码修复</button>}</p>}
    {assignment && onAssign && !readOnly && surfaceActive && <SummaryAssignmentDialog draft={assignment} columns={columns} commit={onAssign}
      valid={() => alive.current && context.current.scope === assignment.scope && !context.current.readOnly && context.current.surfaceActive && context.current.getCurrent() === assignment.baseline && !!catalog.current && !catalog.current.pending() && !catalog.current.getSnapshot().error}
      onClose={fieldId => { setAssignment(null); if (fieldId) setActive(`field:${fieldId}`); requestAnimationFrame(() => editor.current?.focus()); }} />}
  </div>;
});
