import { acquireLibraryNoteSession } from '../../platform/library/noteDocuments';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Check, FileClock, LoaderCircle, Pencil, Plus } from 'lucide-react';
import type { Note, PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { noteSaveStateText } from './readerHelpers';
import type { MarkdownLiveEditorHandle } from './MarkdownLiveEditor';
import type { NoteDraftPatch, NoteSaveInput } from './types';

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
  const [session, setSession] = useState(() => acquireLibraryNoteSession(paper.paperId, paper.notes[0], onSave, zh.reader.noteDefaultTitle));
  const { noteId: selectedNoteId, title, content, status: saveState, error: saveError } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const editorRef = useRef<MarkdownLiveEditorHandle | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const switchingRef = useRef(false);
  session.setWriter(onSave);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);
  useEffect(() => {
    if (!draftPatch?.append) return;
    const snapshot = session.getSnapshot();
    session.update(snapshot.title, `${snapshot.content.trimEnd()}${draftPatch.append}`);
    setMode('edit'); onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed, session]);
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = window.setTimeout(() => { void session.flush().catch(() => {}); }, 900);
    return () => window.clearTimeout(timer);
  }, [session, title, content, saveState]);
  useEffect(() => () => {
    // Panel/tab switches must not discard the 900ms debounce window. On failure
    // the registered session and synchronous recovery draft remain available.
    if (session.getSnapshot().status !== 'error') void session.flush().catch(() => {});
  }, [session]);
  const saveCurrent = () => session.flush().catch(() => {});
  const selectNote = async (note: Note) => {
    if (switchingRef.current || note.id === selectedNoteId) return;
    switchingRef.current = true; setCreating(true); setActionError('');
    try {
      await session.flush();
      setSession(acquireLibraryNoteSession(paper.paperId, note, onSave, zh.reader.noteDefaultTitle));
      setHistoryOpen(false); setMode('read');
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
      requestAnimationFrame(() => editorRef.current?.focus());
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
              title={zh.reader.noteHistory}
              aria-label={zh.reader.noteHistory}
              aria-expanded={historyOpen}
            >
              <FileClock aria-hidden="true" />
              {paper.notes.length > 1 && <span className="note-count-badge">{paper.notes.length}</span>}
            </button>
            {historyOpen && (
              <div className="note-history-popover">
                <div className="note-history-heading">
                  <strong>{zh.reader.noteHistory}</strong>
                  <span>{zh.reader.noteHistoryCount(paper.notes.length)}</span>
                </div>
                <div className="note-history-list">
                  {paper.notes.length ? paper.notes.map((note) => (
                    <button key={note.id} type="button" className={note.id === selectedNoteId ? 'active' : ''} onClick={() => void selectNote(note)} disabled={creating}>
                      <span className="note-history-title">{note.title || zh.reader.noteDefaultTitle}</span>
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
        <span>Markdown</span>
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
