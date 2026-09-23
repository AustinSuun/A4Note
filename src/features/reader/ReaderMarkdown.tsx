import { paperNoteImageDocument } from '../../core/paperImageReference';
import { useMarkdownEndSpace } from '../../shared/markdown/useMarkdownEndSpace';
import { useReaderNoteActive, useReaderNoteRequests, useReaderNoteLayoutActions, useReaderNoteCreateAction } from './ReaderNoteActivity';
import { preferredNoteIdFor, rememberPreferredNoteId } from './noteWorkbench';
import { OverviewNoteBadge } from './OverviewNoteBadge';
import { createSummaryNote, editSummary, loadSummary, uploadSummaryImage } from '../../platform/library/summaries';
import { acquireLibraryNoteSession, existingLibraryNoteSession } from '../../platform/library/noteDocuments';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Check, ChevronDown, LoaderCircle, Pencil, Plus } from 'lucide-react';
import type { Note, PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { annotationLabelText, noteSaveStateText } from './readerHelpers';
import { annotationCitationInsert, annotationCitationLabel } from './annotationCitation';
import type { MarkdownLiveEditorHandle } from './MarkdownLiveEditor';
import { MarkdownAuthoringDock } from '../explorer/MarkdownAuthoringDock';
import type { MarkdownTemplate } from '../explorer/markdownTemplates';
import type { NoteDraftPatch, NoteSaveInput } from './types';

const claimedNoteRequests = new WeakSet<NoteDraftPatch>();
const SummaryDocumentEditor = lazy(() => import('../library/SummaryDocumentEditor').then(module => ({ default: module.SummaryDocumentEditor })));

const MarkdownLiveEditor = lazy(() =>
  import('./MarkdownLiveEditor').then((module) => ({ default: module.MarkdownLiveEditor })),
);
const MarkdownReadContent = lazy(() =>
  import('./MarkdownReadContent').then((module) => ({ default: module.MarkdownReadContent })),
);

export function MarkdownReadView({ paper, onNavigateAnnotation }: { paper: PaperDocument; onNavigateAnnotation: (annotationId: string) => void }) {
  const content = paper.notes[0]?.content ?? '';
  const endSpaceRef = useMarkdownEndSpace<HTMLDivElement>();
  return (
    <div className="markdown-reader">
      <div className="markdown-reader-header">
        <div className="panel-title">{zh.reader.noteTitle}</div>
      </div>
      <div ref={endSpaceRef} className="md-body markdown-reader-content">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</div>
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
  focusedAnnotationId = null,
}: {
  paper: PaperDocument;
  draftPatch: NoteDraftPatch | null;
  onDraftPatchConsumed: () => void;
  onSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onCreateNote: () => void | Promise<string | void>;
  onNavigateAnnotation: (annotationId: string) => void;
  focusedAnnotationId?: string | null;
}) {
  const endSpaceRef = useMarkdownEndSpace<HTMLElement>();
  const surfaceActive = useReaderNoteActive();
  const noteLayoutActions = useReaderNoteLayoutActions();
  const createBridge = useReaderNoteCreateAction();
  const acceptsRequests = useReaderNoteRequests();
  const surfaceActiveRef = useRef(surfaceActive); surfaceActiveRef.current = surfaceActive;
  const [session, setSession] = useState(() => {
    const remembered = preferredNoteIdFor(paper.paperId);
    const preferred = paper.notes.find(note => note.id === remembered) ?? paper.notes[0];
    return (preferred && existingLibraryNoteSession(paper.paperId, preferred.id)) || acquireLibraryNoteSession(paper.paperId, preferred, onSave, zh.reader.noteDefaultTitle);
  });
  const { noteId: selectedNoteId, title, content, status: saveState, error: saveError } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [summaryNoteId, setSummaryNoteId] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const editorRef = useRef<MarkdownLiveEditorHandle | null>(null);
  const pendingCitation = useRef('');
  const historyRef = useRef<HTMLDivElement | null>(null);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const historyOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const switchingRef = useRef(false);
  session.setWriter(onSave);
  useEffect(() => { if (surfaceActive) rememberPreferredNoteId(paper.paperId, selectedNoteId); }, [paper.paperId, selectedNoteId, surfaceActive]);
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
      if (!historyRef.current?.contains(event.target as Node)) { setHistoryOpen(false); setRenameOpen(false); }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);
  useEffect(() => {
    if (!surfaceActive || !acceptsRequests || !draftPatch?.append || claimedNoteRequests.has(draftPatch)) return;
    claimedNoteRequests.add(draftPatch);
    const snapshot = session.getSnapshot();
    const prefix = selectedNoteId && selectedNoteId === summaryNoteId ? snapshot.content : snapshot.content.trimEnd();
    session.update(snapshot.title, `${prefix}${draftPatch.append}`);
    setMode('edit'); onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed, session, surfaceActive, acceptsRequests, selectedNoteId, summaryNoteId]);
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
  const openHistory = () => {
    setHistoryOpen(true);
    setRenameOpen(false);
    requestAnimationFrame(() => {
      const selectedIndex = Math.max(0, paper.notes.findIndex(note => note.id === selectedNoteId));
      historyOptionRefs.current[selectedIndex]?.focus();
    });
  };
  const closeHistory = (restoreFocus = false) => {
    setHistoryOpen(false);
    setRenameOpen(false);
    if (restoreFocus) requestAnimationFrame(() => historyTriggerRef.current?.focus());
  };
  const selectNote = async (note: Note, edit = false) => {
    if (switchingRef.current) return;
    if (note.id === selectedNoteId) { closeHistory(true); if (edit) setMode('edit'); return; }
    switchingRef.current = true; setCreating(true); setActionError('');
    try {
      await session.flush();
      setSession(acquireLibraryNoteSession(paper.paperId, note, onSave, zh.reader.noteDefaultTitle));
      closeHistory(); setMode(edit ? 'edit' : 'read');
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
      closeHistory(); setMode('edit');
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
  const focusedAnnotation = paper.annotations.find(item => item.id === focusedAnnotationId) ?? null;
  const focusedCitationLabel = focusedAnnotation
    ? annotationCitationLabel(annotationLabelText(focusedAnnotation.type), zh.reader.annotationPage(focusedAnnotation.page))
    : '';
  const insertTemplate = (template: MarkdownTemplate) => editorRef.current?.insertTemplate(template.source, template.block);
  const insertFormat = (before: string, after: string, placeholder: string) => editorRef.current?.insertMarkdown(before, after, placeholder);
  const insertFocusedCitation = () => {
    if (!focusedAnnotation) return;
    const snippet = annotationCitationInsert(focusedAnnotation.id);
    if (!snippet) return;
    if (mode === 'edit' && editorRef.current) {
      editorRef.current.insertMarkdown('', '', snippet);
      return;
    }
    pendingCitation.current = snippet;
    setMode('edit');
  };
  useEffect(() => {
    if (mode !== 'edit' || !pendingCitation.current) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (!pendingCitation.current) { window.clearInterval(timer); return; }
      if (editorRef.current) {
        editorRef.current.insertMarkdown('', '', pendingCitation.current);
        pendingCitation.current = '';
        window.clearInterval(timer);
      } else if (attempts > 20) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [mode, selectedNoteId]);
  const renameCurrent = async () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle) { setActionError('文档名称不能为空'); return; }
    setCreating(true); setActionError('');
    try {
      updateTitle(nextTitle);
      await session.flush();
      closeHistory(true);
    } catch (error) { setActionError(String(error)); }
    finally { setCreating(false); }
  };
  useEffect(() => {
    if (!createBridge || !surfaceActive) return;
    const create = () => { void createNote(); };
    createBridge.create = create;
    if (createBridge.pending) { createBridge.pending = false; create(); }
    return () => { if (createBridge.create === create) createBridge.create = undefined; };
  });

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
        if (event.key === 'Escape' && historyOpen && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); closeHistory(true); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void saveCurrent();
        }
      }}
    >
      <header className="note-document-header">
        <div className="note-history-shell" ref={historyRef}>
          <button ref={historyTriggerRef} type="button" className={historyOpen ? 'note-document-trigger active' : 'note-document-trigger'}
            onClick={() => historyOpen ? closeHistory() : openHistory()}
            aria-label={`切换论文文档，当前：${title || zh.reader.noteDefaultTitle}`} aria-haspopup="listbox" aria-expanded={historyOpen}>
            <span>{title || zh.reader.noteDefaultTitle}</span><ChevronDown aria-hidden="true" />
          </button>
          {historyOpen && <div className="note-history-popover" onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const options = historyOptionRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
            if (!options.length) return;
            event.preventDefault();
            const current = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown'
              ? (current + 1 + options.length) % options.length : (current - 1 + options.length) % options.length;
            options[next]?.focus();
          }}>
            <div className="note-history-heading"><strong>论文文档</strong><span>{paper.notes.length} 篇</span></div>
            <div className="note-history-list" role="listbox" aria-label="当前论文的文档">
              {paper.notes.length ? paper.notes.map((note, index) => (
                <button key={note.id} ref={element => { historyOptionRefs.current[index] = element; }} type="button" role="option"
                  aria-selected={note.id === selectedNoteId} className={note.id === selectedNoteId ? 'active' : ''}
                  onClick={() => void selectNote(note)} disabled={creating}>
                  <span className="note-history-title note-history-title-with-badge">
                    {note.id === summaryNoteId && <OverviewNoteBadge />}
                    <span className="note-history-title-text">{note.title || zh.reader.noteDefaultTitle}</span>
                  </span>
                  <span className="note-history-excerpt">{noteExcerpt(note.content)}</span>
                  <time>{formatNoteUpdatedAt(note.updatedAt)}</time>
                </button>
              )) : <div className="note-history-empty">当前论文还没有文档</div>}
            </div>
            {renameOpen ? <form className="note-history-rename" onSubmit={(event) => { event.preventDefault(); void renameCurrent(); }}>
              <label htmlFor="reader-note-rename">重命名当前文档</label>
              <input id="reader-note-rename" value={renameValue} onChange={event => setRenameValue(event.target.value)} autoFocus disabled={creating} />
              <div><button type="button" onClick={() => setRenameOpen(false)}>取消</button><button type="submit" disabled={creating || !renameValue.trim()}>保存</button></div>
            </form> : <div className="note-history-actions">
              <button type="button" onClick={() => void createNote()} disabled={creating}><Plus aria-hidden="true" /><span>新建文档</span></button>
              <button type="button" onClick={() => { setRenameValue(title); setRenameOpen(true); }} disabled={creating}><Pencil aria-hidden="true" /><span>重命名当前文档</span></button>
              <button type="button" onClick={() => void openSummary()} disabled={creating || summaryLoading}><BookOpen aria-hidden="true" /><span>{summaryLoading ? '读取总览关系…' : summaryNoteId ? '打开总览笔记' : '新建总览笔记'}</span></button>
            </div>}
          </div>}
        </div>
        <div className="note-document-actions">
          {noteLayoutActions}
          <span className={`note-save-state ${saveState}`} title={noteSaveStateText(saveState)}>
            {saveState === 'saving' ? <LoaderCircle className="spin" aria-hidden="true" /> : saveState === 'saved' ? <Check aria-hidden="true" /> : null}
            {noteSaveStateText(saveState)}
          </span>
          {focusedAnnotation && <button type="button" className="note-citation-insert" onClick={insertFocusedCitation} title={"插入引用：" + focusedCitationLabel} aria-label={"插入引用 " + focusedCitationLabel}>{focusedCitationLabel}</button>}
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
      {(saveError || actionError) && <div className="note-save-error" role="alert">
        <span>{saveError || actionError}</span>
        <button type="button" onClick={() => void saveCurrent()}>重试保存</button>
        <button type="button" onClick={exportDraft}>导出草稿</button>
        <button type="button" onClick={() => {
          if (window.confirm('放弃未保存修改并回到上次保存的内容？建议先导出草稿。')) void session.discard().then(() => setActionError('')).catch((error) => setActionError(String(error)));
        }}>放弃草稿</button>
      </div>}
      {selectedNoteId && selectedNoteId === summaryNoteId && (!sourceMode || mode === 'read') ? <>
        {mode === 'edit' && <MarkdownAuthoringDock open={templateOpen} onOpenChange={setTemplateOpen} onInsert={insertTemplate} onFormat={insertFormat} onImage={() => editorRef.current?.pickImages()} sourceMode={false} onToggleSource={() => setSourceMode(true)} />}
        <Suspense fallback={<div className="note-editor-loading"><LoaderCircle className="spin" aria-hidden="true" /></div>}>
          <SummaryDocumentEditor key={`${paper.paperId}:${selectedNoteId}`} ref={editorRef} paper={paper} scope={`${paper.paperId}:${selectedNoteId}`} source={content} getCurrent={() => session.getSnapshot().content} onChange={updateContent} onBlur={() => void saveCurrent()} onSource={() => { setMode('edit'); setSourceMode(true); }} readOnly={mode !== 'edit'} surfaceActive={surfaceActive} onNavigateAnnotation={onNavigateAnnotation} onAssign={async (plan, stillCurrent) => { await session.flush(); if (!stillCurrent() || session.getSnapshot().paperId !== paper.paperId || session.getSnapshot().noteId !== selectedNoteId) throw new Error('笔记或预览已变化，请重新选择。'); await session.commitContent(plan.baseline, plan.next); }} />
        </Suspense>
      </> : mode === 'edit' ? (
        <>
          <MarkdownAuthoringDock open={templateOpen} onOpenChange={setTemplateOpen} onInsert={insertTemplate} onFormat={insertFormat} onImage={() => editorRef.current?.pickImages()} sourceMode={sourceMode} onToggleSource={() => setSourceMode(current => !current)} />
        <Suspense fallback={<div className="note-editor-loading"><LoaderCircle className="spin" aria-hidden="true" /></div>}>
          <MarkdownLiveEditor documentPath={paperNoteImageDocument(paper.paperId, selectedNoteId ?? 'unsaved')} imageUpload={surfaceActive ? file => uploadSummaryImage(paper.paperId, file) : undefined} key={`${paper.paperId}:${selectedNoteId}`} ref={editorRef} markdown={content} sourceMode={sourceMode} onChange={updateContent} onBlur={() => void saveCurrent()} placeholder={zh.reader.notePlaceholder} />
        </Suspense>
        </>
      ) : (
        <article ref={endSpaceRef} className="md-body markdown-preview note-preview-only">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</article>
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
