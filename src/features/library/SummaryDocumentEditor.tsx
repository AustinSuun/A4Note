import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { PaperDocument } from '../../core/types';
import { parseSummaryLayout, type SummaryColumn } from '../../core/librarySummary';
import { summaryDocument, replaceSummaryFreeText, type SummarySegment } from '../../core/summaryDocument';
import { replaceSummaryFieldText, summaryEditorPatch } from '../../core/summaryEditorPatch';
import { paperNoteImageDocument } from '../../core/paperImageReference';
import { summaryLayoutSession, uploadSummaryImage } from '../../platform/library/summaries';
import type { MarkdownLiveEditorHandle } from '../reader/MarkdownLiveEditor';
import './summary-document-editor.css';
const Editor = lazy(() => import('../reader/MarkdownLiveEditor').then(m => ({ default: m.MarkdownLiveEditor })));
const Preview = lazy(() => import('../reader/MarkdownReadContent').then(m => ({ default: m.MarkdownReadContent })));

/** A view over the parent's existing document session, never a second note store. */
export function SummaryDocumentEditor({ paper, scope, source, getCurrent, onChange, onBlur, onSource }: {
  paper: PaperDocument; scope: string; source: string; getCurrent: () => string;
  onChange: (value: string) => void; onBlur: () => void; onSource: () => void;
}) {
  const [columns, setColumns] = useState<SummaryColumn[]>([]), [catalogError, setCatalogError] = useState('');
  const [active, setActive] = useState<string | null>(null), [choice, setChoice] = useState(''), [error, setError] = useState('');
  const editor = useRef<MarkdownLiveEditorHandle>(null);
  const parsed = useMemo(() => { try { return { document: summaryDocument(source), error: '' }; } catch (reason) { return { document: null, error: String(reason) }; } }, [source]);
  useEffect(() => {
    let alive = true, stop: (() => void) | undefined;
    void summaryLayoutSession().then(session => {
      if (!alive) return;
      const refresh = () => { try { setColumns(parseSummaryLayout(session.getSnapshot().content).columns); setCatalogError(session.getSnapshot().error || ''); } catch (reason) { setCatalogError(String(reason)); } };
      refresh(); stop = session.subscribe(refresh);
    }).catch(reason => { if (alive) setCatalogError(String(reason)); });
    return () => { alive = false; stop?.(); };
  }, []);
  if (!parsed.document) return <div role="alert" className="summary-warning">{parsed.error}<button type="button" onClick={onSource}>打开高级源码修复</button></div>;
  const document = parsed.document;
  const available = columns.filter(c => !c.source && !document.segments.some(s => s.kind === 'field' && s.id === c.id));
  const label = (segment: SummarySegment, index: number) => segment.kind === 'field' ? columns.find(c => c.id === segment.id)?.name ?? `未登记字段 ${segment.id}` : `自由内容 ${document.segments.slice(0, index + 1).filter(s => s.kind === 'free' && (s.value.trim() || s.key === active || document.segments.length === 1)).length}`;
  const edit = (segment: SummarySegment, value: string) => {
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
  return <div className="summary-document-editor">
    <p className="summary-document-hint">仅明确添加的字段参与总览。自由内容保持原位置，不按标题或相邻字段自动归类。</p>
    {catalogError && <p role="alert">字段目录暂不可用：{catalogError}</p>}
    <div className="summary-document-add">
      <label>添加已有字段<select value={choice} onChange={event => setChoice(event.target.value)} disabled={!!catalogError}>
        <option value="">选择字段（只添加到本篇）</option>{available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <button type="button" disabled={!available.some(c => c.id === choice) || !!catalogError} onClick={() => {
        try { const column = available.find(c => c.id === choice)!; onChange(replaceSummaryFieldText(source, getCurrent(), column, '', true)); setActive(`field:${column.id}`); setChoice(''); setError(''); }
        catch (reason) { setError(String(reason)); }
      }}>添加到本篇</button>
      <button type="button" onClick={() => {
        if (getCurrent() !== source) { setError('笔记已变化，请重试。'); return; }
        const last = document.segments.at(-1);
        if (last?.kind === 'free') setActive(last.key);
        else { const eol = source.includes('\r\n') ? '\r\n' : '\n'; onChange(source + eol); setActive(`free:${source.length}`); }
      }}>在末尾写自由内容</button>
    </div>
    {document.segments.map((segment, index) => {
      if (segment.kind === 'free' && !segment.value.trim() && segment.key !== active && document.segments.length > 1) return null;
      const title = label(segment, index);
      return <section className={`summary-document-section ${segment.kind}`} key={segment.key} data-summary-segment={segment.key}>
        <header><strong>{segment.kind === 'field' ? `总览字段 · ${title}` : title}</strong>
          <button type="button" aria-label={`编辑${title}`} onClick={() => { setActive(segment.key); setError(''); }}>编辑</button>
          {active === segment.key && <button type="button" onClick={() => editor.current?.pickImages()}>添加图片到此区域</button>}
        </header>
        <Suspense fallback={<p>加载编辑器…</p>}>
          {active === segment.key ? <Editor ref={editor} markdown={segment.value} documentPath={paperNoteImageDocument(paper.paperId, scope)} imageUpload={file => uploadSummaryImage(paper.paperId, file)} placeholder={segment.kind === 'field' ? '填写此字段' : '自由记录，不会自动进入字段'} onChange={value => edit(segment, value)} onBlur={onBlur} />
            : <div className="md-body summary-document-preview">{segment.value.trim() ? <Preview markdown={segment.value} paper={paper} onNavigateAnnotation={() => {}} /> : <p>尚未填写</p>}</div>}
        </Suspense>
      </section>;
    })}
    {error && <p role="alert" className="summary-warning">{error}</p>}
  </div>;
}
