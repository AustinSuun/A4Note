import { useEffect, useState } from 'react';
import type { AnnotationColor, PaperDocument, PositionJson } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { TrashIcon } from './ReaderIcons';
import { annotationPresetColors } from './readerConstants';
import { annotationLabelText, noteSaveStateText, preferredTranslatedFileId } from './readerHelpers';
import type { ReaderSaveState } from './types';

export function AnnotationListPanel({
  paper,
  fileMode,
  translatedFileId,
  focusedAnnotationId,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendToNote,
}: {
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  focusedAnnotationId: string | null;
  onFocusAnnotation: (annotationId: string) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendToNote: (annotationId: string) => void;
}) {
  const activeFileId = fileMode === 'source' ? paper.sourceFileId : preferredTranslatedFileId(paper, translatedFileId);
  const sortedAnnotations = paper.annotations
    .filter((annotation) => !activeFileId || annotation.fileId === activeFileId)
    .sort((a, b) => a.page - b.page || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  if (!sortedAnnotations.length) {
    return <div className="mini-message">{zh.reader.noAnnotations}</div>;
  }
  return (
    <div className="annotation-list">
      {sortedAnnotations.map((annotation) => (
        <AnnotationListItem
          key={annotation.id}
          annotation={annotation}
          focused={focusedAnnotationId === annotation.id}
          onFocusAnnotation={onFocusAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendToNote={onAppendToNote}
        />
      ))}
    </div>
  );
}

function AnnotationListItem({
  annotation,
  focused,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendToNote,
}: {
  annotation: PaperDocument['annotations'][number];
  focused: boolean;
  onFocusAnnotation: (annotationId: string) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendToNote: (annotationId: string) => void;
}) {
  const [commentDraft, setCommentDraft] = useState(annotation.comment);
  const [saveState, setSaveState] = useState<ReaderSaveState>('saved');

  useEffect(() => {
    setCommentDraft(annotation.comment);
    setSaveState('saved');
  }, [annotation.id, annotation.comment]);

  const saveComment = async () => {
    if (commentDraft === annotation.comment && saveState !== 'dirty') {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      await onUpdateAnnotationComment(annotation.id, commentDraft);
      setSaveState('saved');
    } catch (error) {
      console.error('Annotation comment save failed', error);
      setSaveState('error');
    }
  };

  const updateStickyStyle = (patch: PositionJson) => {
    void onUpdateAnnotationPosition(annotation.id, {
      ...annotation.positionJson,
      ...patch,
    });
  };

  return (
    <div className={`annotation-list-item annotation-list-item-${annotation.type} ${focused ? 'focused' : ''}`} onClick={() => onFocusAnnotation(annotation.id)}>
      <div className="annotation-list-meta">
        <span>{zh.reader.annotationPage(annotation.page)}</span>
        <span>{annotationLabelText(annotation.type)}</span>
      </div>
      <button
        type="button"
        className="annotation-delete"
        title={zh.reader.deleteAnnotation}
        onClick={(event) => {
          event.stopPropagation();
          void onDeleteAnnotation(annotation.id);
        }}
      >
        <TrashIcon />
      </button>
      <div className="annotation-list-actions">
        <button
          type="button"
          className="annotation-quote"
          onClick={(event) => {
            event.stopPropagation();
            onAppendToNote(annotation.id);
          }}
        >
          {zh.reader.appendAnnotationToNote}
        </button>
        <div className="annotation-list-color-row" onClick={(event) => event.stopPropagation()}>
          {annotationPresetColors.map((color) => (
            <button
              key={color}
              type="button"
              className={annotation.color === color ? `active ${color}` : color}
              title={color}
              onClick={() => void onUpdateAnnotationColor(annotation.id, color)}
            />
          ))}
          <label className="annotation-color-custom" title={zh.reader.highlight}>
            <input
              type="color"
              value={annotation.color.startsWith('#') ? annotation.color : '#ffc94a'}
              onChange={(event) => {
                const value = event.target.value;
                void onUpdateAnnotationColor(annotation.id, value as AnnotationColor);
              }}
            />
          </label>
        </div>
      </div>
      {annotation.type === 'comment' && (
        <div className="sticky-style-row" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={annotation.positionJson.bold ? 'active' : ''} onClick={() => updateStickyStyle({ bold: !annotation.positionJson.bold })}>
            B
          </button>
          <button type="button" className={annotation.positionJson.italic ? 'active' : ''} onClick={() => updateStickyStyle({ italic: !annotation.positionJson.italic })}>
            I
          </button>
          <select value={Number(annotation.positionJson.fontSize ?? 13)} onChange={(event) => updateStickyStyle({ fontSize: Number(event.target.value) })}>
            {[12, 13, 14, 16, 18].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <input type="color" value={String(annotation.positionJson.textColor ?? '#202822')} onChange={(event) => updateStickyStyle({ textColor: event.target.value })} />
        </div>
      )}
      <textarea
        value={commentDraft}
        placeholder={zh.reader.commentPlaceholder}
        onClick={(event) => event.stopPropagation()}
        onBlur={() => void saveComment()}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void saveComment();
          }
        }}
        onChange={(event) => {
          setCommentDraft(event.target.value);
          setSaveState('dirty');
        }}
      />
      <span className={`annotation-save-state ${saveState}`}>{noteSaveStateText(saveState)}</span>
    </div>
  );
}
