import { useReaderNoteActive, useReaderNoteRequests } from './ReaderNoteActivity';
import { OverviewNoteBadge } from './OverviewNoteBadge';
import { createSummaryNote, editSummary, loadSummary } from '../../platform/library/summaries';
import { acquireLibraryNoteSession, existingLibraryNoteSession } from '../../platform/library/noteDocuments';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Check, Files, LoaderCircle, Pencil, Plus } from 'lucide-react';
import type { Note, PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { noteSaveStateText } from './readerHelpers';
import type { MarkdownLiveEditorHandle } from './MarkdownLiveEditor';
import type { NoteDraftPatch, NoteSaveInput } from './types';

const claimedNoteRequests = new WeakSet<NoteDraftPatch>();
const preferredNoteByPaper = new Map<string, string>();

const MarkdownLiveEditor = lazy(() =>
  import('./MarkdownLiveEditor').then((module) => ({ default: module.MarkdownLiveEditor })),
);
const MarkdownReadContent = lazy(() =>
  import('./MarkdownReadContent').then((module) => ({ default: module.MarkdownReadContent })),
);

export function MarkdownReadView({ paper, onNavigateAnnotation }: { paper: PaperDocument; onNavigateAnnotation: (annotationId: string) => void }) {
  const content = paper.notes[0]?.content ?? '';
  return (
    <div className="markdown-reader">
      <div className="markdown-reader-header">
        <div className="panel-title">{zh.reader.noteTitle}</div>
      </div>
      <div className="md-body markdown-reader-content">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</div>
    </div>
  );
}

export function MarkdownEmptyState({ onCreateNote }: { onCreateNote: () => void | Promise<string | void> }) {
  return (
    <div className="markdown-empty">
      <h2>{zh.reader.markdownEmptyTitle}</h2>
      <p>{zh.reader.markdownEmptyDescription}</p>
      <button type="button" className="primary import-empty-button rounded-button" onClick={() => void onCreateNote()}>
        {zh.reader.createNote}
      </button>
    </div>
  );
}

export function MarkdownNotePanel({
  paper,
  draftPatch,
  onDraftPatchConsumed,
  onSave,
  onCreateNote,
  onNavigateAnnotation,
}: {
  paper: PaperDocument;
  draftPatch: NoteDraftPatch | null;
  onDraftPatchConsumed: () => void;
  onSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onCreateNote: () => void | Promise<string | void>;
  onNavigateAnnotation: (annotationId: string) => void;
}) {
  const surfaceActive = useReaderNoteActive();
  const acceptsRequests = useReaderNoteRequests();
  const surfaceActiveRef = useRef(surfaceActive); surfaceActiveRef.current = surfaceActive;
  const [session, setSession] = useState(() => {
    const preferred = paper.notes.find(note => note.id === preferredNoteByPaper.get(paper.paperId)) ?? paper.notes[0];
    return (preferred && existingLibraryNoteSession(paper.paperId, preferred.id)) || acquireLibraryNoteSession(paper.paperId, preferred, onSave, zh.reader.noteDefaultTitle);
  });
  const { noteId: selectedNoteId, title, content, status: saveState, error: saveError } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [summaryNoteId, setSummaryNoteId] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const editorRef = useRef<MarkdownLiveEditorHandle | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const switchingRef = useRef(false);
  session.setWriter(onSave);
  useEffect(() => { if (surfaceActive) preferredNoteByPaper.set(paper.paperId, selectedNoteId); }, [paper.paperId, selectedNoteId, surfaceActive]);
  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    void loadSummary(paper.paperId, true).then(async file => {
      if (file.noteId) await editSummary(paper.paperId);
      if (active) setSummaryNoteId(file.noteId ?? null);
    }).catch(error => { if (active) setActionError(String(error)); }).finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [paper.paperId, paper.notes]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);
  useEffect(() => {
    if (!surfaceActive || !acceptsRequests || !draftPatch?.append || claimedNoteRequests.has(draftPatch)) return;
    claimedNoteRequests.add(draftPatch);
    const snapshot = session.getSnapshot();
    session.update(snapshot.title, `${snapshot.content.trimEnd()}${draftPatch.append}`);
    setMode('edit'); onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed, session, surfaceActive, acceptsRequests]);
  useEffect(() => {
    if (!surfaceActive || saveState !== 'dirty') return;
    const timer = window.setTimeout(() => { void session.flush().catch(() => {}); }, 900);
    return () => window.clearTimeout(timer);
  }, [session, title, content, saveState, surfaceActive]);
  useEffect(() => () => {
    // Panel/tab switches must not discard the 900ms debounce window. On failure
    // the registered session and synchronous recovery draft remain available.
    if (session.getSnapshot().status !== 'error') void session.flush().catch(() => {});
  }, [session]);
  useEffect(() => {
    if (surfaceActive) return;
    setHistoryOpen(false);
    if (session.getSnapshot().status !== 'error') void session.flush().catch(() => {});
  }, [surfaceActive, session]);
  const saveCurrent = () => session.flush().catch(() => {});
  const selectNote = async (note: Note, edit = false) => {
    if (switchingRef.current) return;
    if (note.id === selectedNoteId) { if (edit) setMode('edit'); return; }
    switchingRef.current = true; setCreating(true); setActionError('');
    try {
      await session.flush();
      setSession(acquireLibraryNoteSession(paper.paperId, note, onSave, zh.reader.noteDefaultTitle));
      setHistoryOpen(false); setMode(edit ? 'edit' : 'read');
    } catch { /* Keep the current draft and show its error; never switch on failure. */ }
    finally { switchingRef.current = false; setCreating(false); }
  };
  const createNote = async () => {
    if (switchingRef.current) return;
    switchingRef.current = true; setCreating(true); setActionError('');
    try {
      await session.flush();
      const noteId = await onCreateNote();
      if (!noteId) throw new Error('新建笔记未返回ID');
      const number = paper.notes.length + 1;
      const nextTitle = number === 1 ? zh.reader.noteDefaultTitle : zh.reader.noteNumberedTitle(number);
      const next = paper.notes.find((note) => note.id === noteId) ?? { id: noteId, title: nextTitle, content: `# ${nextTitle}\n\n` };
      setSession(acquireLibraryNoteSession(paper.paperId, next, onSave, zh.reader.noteDefaultTitle));
      setHistoryOpen(false); setMode('edit');
      requestAnimationFrame(() => { if (surfaceActiveRef.current) editorRef.current?.focus(); });
    } catch (error) { setActionError(String(error)); }
    finally { switchingRef.current = false; setCreating(false); }
  };
  useEffect(() => {
    const request = draftPatch?.openNote;
    if (!surfaceActive || !acceptsRequests || !draftPatch || !request || request.paperId !== paper.paperId || creating || switchingRef.current || claimedNoteRequests.has(draftPatch)) return;
    // The reader can mount both document and side-panel editors. A request is
    // claimed once, including under StrictMode, so one click cannot create two notes.
    claimedNoteRequests.add(draftPatch);
    onDraftPatchConsumed();
    if (request.create) { void createNote(); return; }
    const note = paper.notes.find(item => item.id === request.noteId);
    if (note) void selectNote(note, true); else setActionError('这篇笔记已不存在，请重新选择。');
  }, [draftPatch, paper.paperId, paper.notes, creating, onDraftPatchConsumed, surfaceActive, acceptsRequests]);
  const openSummary = async () => {
    if (switchingRef.current) return;
    if (!summaryNoteId && !window.confirm('新建空白总结笔记并将本论文总览切换为该笔记的字段？旧总览MD原样保留，不复制、不迁移，普通笔记不受影响。')) return;
    switchingRef.current = true; setCreating(true); setActionError('');
    try {
      await session.flush();
      const file = summaryNoteId ? await loadSummary(paper.paperId, true) : await createSummaryNote(paper.paperId);
      if (!file.noteId) throw new Error('未找到指定总结笔记');
      await editSummary(paper.paperId);
      const next = existingLibraryNoteSession(paper.paperId, file.noteId) ?? acquireLibraryNoteSession(paper.paperId, { id: file.noteId, title: file.title ?? '总结笔记', content: file.content }, onSave, '总结笔记');
      next.setWriter(onSave); setSession(next);
      setSummaryNoteId(file.noteId); setHistoryOpen(false); setMode('edit');
    } catch (error) { setActionError(String(error)); }
    finally { switchingRef.current = false; setCreating(false); }
  };
  const updateTitle = (next: string) => session.update(next, session.getSnapshot().content);
  const updateContent = (next: string) => session.update(session.getSnapshot().title, next);
  const exportDraft = () => {
    const snapshot = session.getSnapshot();
    const url = URL.createObjectURL(new Blob([snapshot.content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '阅读笔记-未保存草稿.md'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      className="note-workspace"
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && historyOpen && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setHistoryOpen(false); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void saveCurrent();
        }
      }}
    >
      <header className="note-document-header">
        <input
          className="note-title-input"
          value={title}
          onChange={(event) => updateTitle(event.target.value)}
          onBlur={() => void saveCurrent()}
          placeholder={zh.reader.noteTitlePlaceholder}
          aria-label={zh.reader.noteTitlePlaceholder}
        />
        <div className="note-document-actions">
          <div className="note-history-shell" ref={historyRef}>
            <button
              type="button"
              className={historyOpen ? 'note-icon-button active' : 'note-icon-button'}
              onClick={() => setHistoryOpen((current) => !current)}
              title={`论文笔记 · ${paper.notes.length}`}
              aria-label={`论文笔记 · ${paper.notes.length}`}
              aria-expanded={historyOpen}
            >
              <Files aria-hidden="true" />
              <span className="note-count-badge">{paper.notes.length}</span>
            </button>
            {historyOpen && (
              <div className="note-history-popover">
                <div className="note-history-heading">
                  <strong>论文笔记</strong>
                  <span>{paper.notes.length} 篇</span>
                </div>
                <div className="note-history-list">
                  {paper.notes.length ? paper.notes.map((note) => (
                    <button key={note.id} type="button" className={note.id === selectedNoteId ? 'active' : ''} onClick={() => void selectNote(note)} disabled={creating}>
                      <span className="note-history-title note-history-title-with-badge">
                        {note.id === summaryNoteId && <OverviewNoteBadge />}
                        <span className="note-history-title-text">{note.title || zh.reader.noteDefaultTitle}</span>
                      </span>
                      <span className="note-history-excerpt">{noteExcerpt(note.content)}</span>
                      <time>{formatNoteUpdatedAt(note.updatedAt)}</time>
                    </button>
                  )) : <div className="note-history-empty">{zh.reader.noteEmpty}</div>}
                </div>
              </div>
            )}
          </div>
          <button type="button" className="note-icon-button" onClick={() => void createNote()} disabled={creating} title={zh.reader.noteNew} aria-label={zh.reader.noteNew}>
            {creating ? <LoaderCircle className="spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
          <div className="note-view-switch" role="group" aria-label={zh.reader.noteReadingMode}>
            <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')} title={zh.reader.noteEditingMode} aria-label={zh.reader.noteEditingMode}>
              <Pencil aria-hidden="true" />
            </button>
            <button type="button" className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')} title={zh.reader.noteReadingMode} aria-label={zh.reader.noteReadingMode}>
              <BookOpen aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <div className="note-meta-row">
        <span className="note-overview-identity">{selectedNoteId === summaryNoteId
          ? <><OverviewNoteBadge /><span>与总览字段关联</span></>
          : 'Markdown · 普通笔记'}</span>
        <button type="button" className="summary-note-entry" disabled={creating || summaryLoading} onClick={() => void openSummary()}>
          {summaryLoading ? '读取总览关系…' : summaryNoteId ? '打开总览笔记' : '新建总览笔记'}
        </button>
        <span className={`note-save-state ${saveState}`}>
          {saveState === 'saving' ? <LoaderCircle className="spin" aria-hidden="true" /> : saveState === 'saved' ? <Check aria-hidden="true" /> : null}
          {noteSaveStateText(saveState)}
        </span>
      </div>
      {(saveError || actionError) && <div className="note-save-error" role="alert">
        <span>{saveError || actionError}</span>
        <button type="button" onClick={() => void saveCurrent()}>重试保存</button>
        <button type="button" onClick={exportDraft}>导出草稿</button>
        <button type="button" onClick={() => {
          if (window.confirm('放弃未保存修改并回到上次保存的内容？建议先导出草稿。')) void session.discard().then(() => setActionError('')).catch((error) => setActionError(String(error)));
        }}>放弃草稿</button>
      </div>}
      {mode === 'edit' ? (
        <Suspense fallback={<div className="note-editor-loading"><LoaderCircle className="spin" aria-hidden="true" /></div>}>
          <MarkdownLiveEditor key={selectedNoteId} ref={editorRef} markdown={content} onChange={updateContent} onBlur={() => void saveCurrent()} placeholder={zh.reader.notePlaceholder} />
        </Suspense>
      ) : (
        <article className="md-body markdown-preview note-preview-only">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</article>
      )}
    </div>
  );
}

function noteExcerpt(content: string) {
  return content
    .replace(/@annotation\([^)]+\)/g, '标注引用')
    .replace(/[#>*_`\-[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 54) || '空白笔记';
}

function formatNoteUpdatedAt(updatedAt?: string) {
  if (!updatedAt) return '';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function renderMarkdownWithAnnotationRefs(markdown: string, paper: PaperDocument, onNavigateAnnotation: (annotationId: string) => void) {
  return (
    <Suspense fallback={<div className="note-editor-loading"><LoaderCircle className="spin" aria-hidden="true" /></div>}>
      <MarkdownReadContent markdown={markdown} paper={paper} onNavigateAnnotation={onNavigateAnnotation} />
    </Suspense>
  );
}
