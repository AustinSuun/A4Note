import { useEffect, useState } from 'react';
import type { AnnotationColor, PaperDocument, PositionJson } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { TrashIcon } from './ReaderIcons';
import { annotationPresetColors } from './readerConstants';
import { annotationLabelText, noteSaveStateText, preferredTranslatedFileId } from './readerHelpers';
import type { ReaderSaveState } from './types';
import { useAnnotationLayersContext } from './useAnnotationLayers';
import './reader-annotation-layers.css';

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
  const layers = useAnnotationLayersContext();
  const [layerFilter, setLayerFilter] = useState<string>('');
  const sortedAnnotations = paper.annotations
    .filter((annotation) => !activeFileId || annotation.fileId === activeFileId)
    .filter((annotation) => !layerFilter || annotation.layerId === layerFilter)
    .sort((a, b) => a.page - b.page || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  // Layers are only offered when the layer system is available for this paper (Tauri or the local store).
  const visibleLayers = layers?.state ? layers.layers.filter((layer) => !layer.archivedAt && layers.isLayerVisible(layer.id)) : [];
  const writableTargets = layers?.state ? layers.layers.filter((layer) => !layer.archivedAt && !layer.locked) : [];
  const toolbar = layers?.state ? (
    <div className="annotation-list-toolbar" role="group" aria-label="标注图层筛选">
      <label>
        图层
        <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)} aria-label="按图层筛选标注列表">
          <option value="">全部可见图层（{visibleLayers.length}）</option>
          {visibleLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}（{layer.annotationCount}）</option>)}
        </select>
      </label>
    </div>
  ) : null;
  if (!sortedAnnotations.length) {
    return <>{toolbar}<div className="mini-message">{zh.reader.noAnnotations}</div></>;
  }
  const renderItem = (annotation: PaperDocument['annotations'][number]) => (
        <AnnotationListItem
          key={annotation.id}
          annotation={annotation}
          focused={focusedAnnotationId === annotation.id}
          layerName={layers?.state ? layers.layerName(annotation.layerId) : null}
          layerLocked={layers?.state ? layers.layers.find((layer) => layer.id === annotation.layerId)?.locked ?? false : false}
          moveTargets={writableTargets.filter((layer) => layer.id !== annotation.layerId)}
          onMoveToLayer={layers ? (annotationId, layerId) => void layers.moveAnnotations([annotationId], layerId) : undefined}
          onFocusAnnotation={onFocusAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendToNote={onAppendToNote}
        />
  );
  // Several visible layers: group rows by layer so each mark's origin (first read, attempt 2, …) is obvious.
  const grouped = layers?.state && !layerFilter && visibleLayers.length > 1;
  return (
    <>
      {toolbar}
      <div className="annotation-list">
        {grouped
          ? visibleLayers.map((layer) => {
            const items = sortedAnnotations.filter((annotation) => annotation.layerId === layer.id);
            if (!items.length) return null;
            return (
              <section key={layer.id} className="annotation-list-layer-group" aria-label={`图层 ${layer.name}`} data-layer-id={layer.id}>
                <h4 className="annotation-list-layer-heading">
                  <span>{layer.name}</span>
                  {layer.locked && <span className="annotation-list-layer-badge">已锁定</span>}
                  <span className="annotation-layer-count">{items.length}</span>
                </h4>
                {items.map(renderItem)}
              </section>
            );
          })
          : sortedAnnotations.map(renderItem)}
      </div>
    </>
  );
}

function AnnotationListItem({
  annotation,
  focused,
  layerName,
  layerLocked,
  moveTargets,
  onMoveToLayer,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendToNote,
}: {
  annotation: PaperDocument['annotations'][number];
  focused: boolean;
  layerName: string | null;
  layerLocked: boolean;
  moveTargets: Array<{ id: string; name: string }>;
  onMoveToLayer?: (annotationId: string, layerId: string) => void;
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
        {layerName && <span className="annotation-list-layer-badge" title={layerLocked ? '所在图层已锁定' : '所在图层'}>{layerName}{layerLocked ? ' · 锁定' : ''}</span>}
        {onMoveToLayer && moveTargets.length > 0 && !layerLocked && (
          <select
            className="annotation-list-move"
            value=""
            aria-label="移动到图层"
            title="移动到其他图层（保留标注 id 与笔记引用）"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => { event.stopPropagation(); if (event.target.value) onMoveToLayer(annotation.id, event.target.value); }}
          >
            <option value="">移到…</option>
            {moveTargets.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
          </select>
        )}
      </div>
      {annotation.quote ? <p className="annotation-list-quote">{annotation.quote}</p> : null}
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
