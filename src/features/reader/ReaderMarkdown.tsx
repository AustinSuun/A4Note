import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PaperDocument } from '../../core/types';
import { zh } from '../../ui/zh';
import { annotationLabelText, noteSaveStateText } from './readerHelpers';
import type { NoteDraftPatch, ReaderSaveState } from './types';

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

export function MarkdownEmptyState({ onCreateNote }: { onCreateNote: () => void | Promise<void> }) {
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
  onNavigateAnnotation,
}: {
  paper: PaperDocument;
  draftPatch: NoteDraftPatch | null;
  onDraftPatchConsumed: () => void;
  onSave: (content: string) => void | Promise<void>;
  onNavigateAnnotation: (annotationId: string) => void;
}) {
  const source = paper.notes[0]?.content ?? '';
  const [content, setContent] = useState(source);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saveState, setSaveState] = useState<ReaderSaveState>('saved');
  useEffect(() => setContent(source), [paper.paperId, paper.notes[0]?.id, source]);

  useEffect(() => {
    if (!draftPatch?.append) return;
    setContent((current) => `${current.trimEnd()}${draftPatch.append}`);
    setSaveState('dirty');
    setMode('edit');
    onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed]);

  useEffect(() => {
    if (content === source) {
      setSaveState('saved');
      return;
    }
    setSaveState('dirty');
    const timer = window.setTimeout(() => {
      void saveCurrent(content);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [content, source]);

  const saveCurrent = async (nextContent = content) => {
    if (nextContent === source && saveState !== 'dirty') {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      await onSave(nextContent);
      setSaveState('saved');
    } catch (error) {
      console.error('Note save failed', error);
      setSaveState('error');
    }
  };

  return (
    <div className="note-workspace">
      <div className="note-toolbar">
        <div className="panel-title">{zh.reader.noteTitle}</div>
        <div className="segmented compact note-mode-switch">
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            {zh.reader.noteEdit}
          </button>
          <button type="button" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            {zh.reader.notePreview}
          </button>
        </div>
      </div>
      <div className="note-status-row">
        <span className={`note-save-state ${saveState}`}>{noteSaveStateText(saveState)}</span>
        <button type="button" className="subtle-button rounded-button" onClick={() => void saveCurrent()} disabled={saveState === 'saving'}>
          {zh.reader.saveNote}
        </button>
      </div>
      {mode === 'edit' ? (
        <textarea className="note-editor" value={content} onChange={(event) => setContent(event.target.value)} onBlur={() => void saveCurrent()} placeholder={zh.reader.notePlaceholder} />
      ) : (
        <div className="markdown-preview note-preview-only">{renderMarkdownWithAnnotationRefs(content, paper, onNavigateAnnotation)}</div>
      )}
    </div>
  );
}

function renderMarkdownWithAnnotationRefs(markdown: string, paper: PaperDocument, onNavigateAnnotation: (annotationId: string) => void) {
  const lines = markdown.split('\n');
  const nodes: ReactElement[] = [];
  let listItems: ReactElement[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(<ul key={`list-${nodes.length}`}>{listItems}</ul>);
    listItems = [];
  };

  lines.forEach((line, index) => {
    if (line.startsWith('- ')) {
      listItems.push(<li key={`li-${index}`}>{renderInlineMarkdown(line.slice(2), paper, onNavigateAnnotation)}</li>);
      return;
    }
    flushList();
    if (line.startsWith('## ')) {
      nodes.push(<h4 key={index}>{renderInlineMarkdown(line.slice(3), paper, onNavigateAnnotation)}</h4>);
      return;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h3 key={index}>{renderInlineMarkdown(line.slice(2), paper, onNavigateAnnotation)}</h3>);
      return;
    }
    if (line.startsWith('> ')) {
      nodes.push(<blockquote key={index}>{renderInlineMarkdown(line.slice(2), paper, onNavigateAnnotation)}</blockquote>);
      return;
    }
    if (line.trim()) {
      nodes.push(<p key={index}>{renderInlineMarkdown(line, paper, onNavigateAnnotation)}</p>);
      return;
    }
    nodes.push(<br key={index} />);
  });
  flushList();
  return nodes;
}

function renderInlineMarkdown(text: string, paper: PaperDocument, onNavigateAnnotation: (annotationId: string) => void) {
  const annotationReferencePattern = /@annotation\(([^)]+)\)/g;
  const parts: Array<string | ReactElement> = [];
  let cursor = 0;
  for (const match of text.matchAll(annotationReferencePattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const annotationId = match[1].trim();
    const annotation = paper.annotations.find((item) => item.id === annotationId);
    parts.push(
      <button key={`${annotationId}-${matchIndex}`} type="button" className="annotation-reference" onClick={() => annotation && onNavigateAnnotation(annotation.id)}>
        {annotation ? `${annotationLabelText(annotation.type)} · ${zh.reader.annotationPage(annotation.page)}` : `@annotation(${annotationId})`}
      </button>,
    );
    cursor = matchIndex + match[0].length;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.length ? parts : text;
}
