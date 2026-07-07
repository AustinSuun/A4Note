import { useEffect, useState } from 'react';
import type { PaperDocument } from '../../core/types';
import { renderMarkdown } from '../../core/markdown';
import { zh } from '../../ui/zh';
import { noteSaveStateText } from './readerHelpers';
import type { NoteDraftPatch, ReaderSaveState } from './types';

export function MarkdownReadView({ paper }: { paper: PaperDocument }) {
  const content = paper.notes[0]?.content ?? '';
  return (
    <div className="markdown-reader">
      <div className="markdown-reader-header">
        <div className="panel-title">{zh.reader.noteTitle}</div>
      </div>
      <div className="markdown-reader-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
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
}: {
  paper: PaperDocument;
  draftPatch: NoteDraftPatch | null;
  onDraftPatchConsumed: () => void;
  onSave: (content: string) => void | Promise<void>;
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
        <div className="markdown-preview note-preview-only" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      )}
    </div>
  );
}
