import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, FileClock, LoaderCircle, Pencil, Plus } from 'lucide-react';
import type { Note, PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { noteSaveStateText } from './readerHelpers';
import type { MarkdownLiveEditorHandle } from './MarkdownLiveEditor';
import type { NoteDraftPatch, NoteSaveInput, ReaderSaveState } from './types';

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
      <div className="markdown-reader-content">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</div>
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
  const firstNote = paper.notes[0] ?? null;
  const [selectedNoteId, setSelectedNoteId] = useState(firstNote?.id ?? '');
  const selectedNote = paper.notes.find((note) => note.id === selectedNoteId) ?? null;
  const [title, setTitle] = useState(firstNote?.title ?? zh.reader.noteDefaultTitle);
  const [content, setContent] = useState(firstNote?.content ?? '');
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [saveState, setSaveState] = useState<ReaderSaveState>('saved');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const editorRef = useRef<MarkdownLiveEditorHandle | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const selectedNoteIdRef = useRef(selectedNoteId);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const persistedRef = useRef({ noteId: firstNote?.id ?? '', title: firstNote?.title ?? zh.reader.noteDefaultTitle, content: firstNote?.content ?? '' });

  useEffect(() => {
    const stillExists = paper.notes.some((note) => note.id === selectedNoteIdRef.current);
    if (stillExists || !paper.notes.length) return;
    setSelectedNoteId(paper.notes[0].id);
  }, [paper.paperId, paper.notes]);

  useEffect(() => {
    if (!selectedNote) return;
    selectedNoteIdRef.current = selectedNote.id;
    titleRef.current = selectedNote.title;
    contentRef.current = selectedNote.content;
    persistedRef.current = { noteId: selectedNote.id, title: selectedNote.title, content: selectedNote.content };
    setTitle(selectedNote.title);
    setContent(selectedNote.content);
    setSaveState('saved');
    editorRef.current?.setMarkdown(selectedNote.content);
  }, [paper.paperId, selectedNote?.id]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!draftPatch?.append) return;
    setContent((current) => {
      const nextContent = `${current.trimEnd()}${draftPatch.append}`;
      contentRef.current = nextContent;
      editorRef.current?.setMarkdown(nextContent);
      return nextContent;
    });
    setSaveState('dirty');
    setMode('edit');
    onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed]);

  useEffect(() => {
    const persisted = persistedRef.current;
    if (content === persisted.content && title === persisted.title) {
      setSaveState('saved');
      return;
    }
    setSaveState('dirty');
    const timer = window.setTimeout(() => {
      void saveCurrent(title, content);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [content, title]);

  const saveCurrent = async (nextTitle = title, nextContent = content) => {
    const persisted = persistedRef.current;
    if (nextContent === persisted.content && nextTitle === persisted.title) {
      setSaveState('saved');
      return persisted.noteId;
    }
    setSaveState('saving');
    const noteIdAtSave = selectedNoteIdRef.current || undefined;
    try {
      const savedNoteId = await onSave({ noteId: noteIdAtSave, title: nextTitle, content: nextContent });
      const resolvedNoteId = savedNoteId || noteIdAtSave || '';
      if (resolvedNoteId && !selectedNoteIdRef.current) {
        selectedNoteIdRef.current = resolvedNoteId;
        setSelectedNoteId(resolvedNoteId);
      }
      persistedRef.current = { noteId: resolvedNoteId, title: nextTitle, content: nextContent };
      const unchangedSinceSave = titleRef.current === nextTitle && contentRef.current === nextContent;
      setSaveState(unchangedSinceSave ? 'saved' : 'dirty');
      return resolvedNoteId;
    } catch (error) {
      console.error('Note save failed', error);
      setSaveState('error');
      return undefined;
    }
  };

  const selectNote = async (note: Note) => {
    await saveCurrent();
    selectedNoteIdRef.current = note.id;
    setSelectedNoteId(note.id);
    setHistoryOpen(false);
    setMode('read');
  };

  const createNote = async () => {
    await saveCurrent();
    setCreating(true);
    try {
      const noteId = await onCreateNote();
      if (noteId) {
        selectedNoteIdRef.current = noteId;
        setSelectedNoteId(noteId);
      }
      setHistoryOpen(false);
      setMode('edit');
      requestAnimationFrame(() => editorRef.current?.focus());
    } finally {
      setCreating(false);
    }
  };

  const updateTitle = (nextTitle: string) => {
    titleRef.current = nextTitle;
    setTitle(nextTitle);
  };

  const updateContent = (nextContent: string) => {
    contentRef.current = nextContent;
    setContent(nextContent);
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
                    <button key={note.id} type="button" className={note.id === selectedNoteId ? 'active' : ''} onClick={() => void selectNote(note)}>
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
      {mode === 'edit' ? (
        <Suspense fallback={<div className="note-editor-loading"><LoaderCircle className="spin" aria-hidden="true" /></div>}>
          <MarkdownLiveEditor ref={editorRef} markdown={content} onChange={updateContent} onBlur={() => void saveCurrent()} placeholder={zh.reader.notePlaceholder} />
        </Suspense>
      ) : (
        <article className="markdown-preview note-preview-only">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</article>
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
