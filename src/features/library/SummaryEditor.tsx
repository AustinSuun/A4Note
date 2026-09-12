import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PaperDocument } from '../../core/types';
import type { TextDocumentSession } from '../../core/textDocumentSession';
import { summaryFields, updateSummaryField, type SummaryColumn } from '../../core/librarySummary';
import { reloadSummary, revealSummaryPath, uploadSummaryImage } from '../../platform/library/summaries';
export function SummaryEditor({ paper, column, session, onClose }: { paper: PaperDocument; column?: SummaryColumn; session: TextDocumentSession; onClose: () => void }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  let text = snapshot.content;
  try { if (column) text = summaryFields(snapshot.content).get(column.id)?.value ?? ''; } catch { /* full Markdown mode is always available in the parent */ }
  useEffect(() => () => { void session.flush().catch(() => {}); }, [session]);
  const update = (value: string) => {
    try { session.update(column ? updateSummaryField(session.getSnapshot().content, column, value) : value); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const save = async (close = false) => {
    setBusy(true); setError('');
    try { await session.flush(); if (close) onClose(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const download = () => { const url = URL.createObjectURL(new Blob([session.getSnapshot().content], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = '总结-草稿.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <div className="summary-backdrop"><section className="summary-editor" role="dialog" aria-modal="true" aria-label="编辑总结" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
    if (event.key === 'Escape') { event.stopPropagation(); if (busy) return; if (session.dirty()) setError('请保存后关闭，或明确放弃草稿。'); else onClose(); }
  }}>
    <header><strong>{column?.name ?? '完整 Markdown 总结'}</strong><span>{paper.title}</span><button type="button" disabled={busy} onClick={() => void save(true)}>保存并关闭</button></header>
    <p className="summary-help">独立总结 · 不覆盖阅读笔记 · {snapshot.status === 'error' ? '保存失败 / 存在冲突' : session.dirty() ? '有未保存修改' : '已保存到 MD'}{column?.id === 'online' ? ' · 手填已确认的上线日期，未知留空，不使用出版年份推测。' : ''}</p>
    {!column && <p className="summary-help">可自由编辑 Markdown；单元格由 a4-summary 注释标记关联。请保留字段标记，其他段落与未知元数据不会被表格覆盖。</p>}
    <textarea autoFocus aria-label="总结内容" value={text} onChange={event => update(event.target.value)} spellCheck={false} />
    <div className="summary-editor-tools">
      {(!column || ['image','mixed'].includes(column.kind)) && <label className="summary-upload">添加图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return; setBusy(true);
        try { const relative = await uploadSummaryImage(paper.paperId, file); const current = column ? summaryFields(session.getSnapshot().content).get(column.id)?.value ?? '' : session.getSnapshot().content; update(current + `\n\n![结构图](${relative})\n`); }
        catch (e) { setError(String(e)); } finally { setBusy(false); }
      }} /></label>}
      {column?.kind === 'note' && <select aria-label="引用已有笔记" defaultValue="" onChange={event => { if (event.target.value) update(`[阅读笔记](a4note-note:${event.target.value})`); }}><option value="">选择已有笔记（只引用，不复制）</option>{paper.notes.map(note => <option key={note.id} value={note.id}>{note.title || '未命名笔记'}</option>)}</select>}
      <button type="button" onClick={download}>导出完整草稿</button><button type="button" onClick={() => void revealSummaryPath(snapshot.path).catch(e => setError(String(e)))}>定位 MD 文件</button>
      <button type="button" disabled={busy} onClick={() => setDiscard(true)}>放弃草稿 / 重新读取</button>
    </div>
    {discard && <div className="summary-warning">将放弃未保存内容并读取磁盘文件。建议先导出草稿。<button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await reloadSummary(session, paper.paperId); setDiscard(false); setError(''); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>确认放弃并重新读取</button><button type="button" disabled={busy} onClick={async () => { await session.settle(); session.reload(session.getSnapshot().baseline); onClose(); }}>仅放弃草稿并关闭（不写盘）</button><button type="button" onClick={() => setDiscard(false)}>保留草稿</button></div>}
    {(error || snapshot.error) && <div role="alert" className="summary-warning">{error || snapshot.error}</div>}
    <footer><span className="summary-help">{snapshot.path}</span><button type="button" disabled={busy} onClick={() => void save()}>保存 / 重试（Ctrl+S）</button></footer>
  </section></div>;
}
