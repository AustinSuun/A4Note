import { PdfHighlightLayer } from './PdfHighlightLayer';
import type { MouseEvent } from 'react';
import type { AnnotationColor, PaperDocument, PositionJson, ReaderTool } from '../../../core/types';
import {
  annotationColor,
  highlightPositionStyle,
  positionStyle,
  underlinePositionStyle,
} from './pdfAnnotationHelpers';
import { normalizeBox } from './pdfGeometry';
import { arrowPositionFromDrag } from './pdfInteraction';
import { AnnotationMark } from './AnnotationMark';
import type { AnnotationMarkModel, AnnotationResizeHandle, DraftAnnotationPreview, DragDraft, InkDraft, InlineTextEditorState, ReaderToolSettings, TextAnnotationStylePatch } from './types';

export function AnnotationOverlay({
  annotations,
  drafts,
  selectionPreview = [],
  dragDraft,
  inkDraft,
  activeTool,
  activeAnnotationColor,
  toolSettings,
  onSelectAnnotation,
  onBeginStickyDrag,
  onBeginAnnotationResize,
  onEditStickyAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onUpdateTextStyle,
  inlineTextEditor,
  onCommitInlineText,
  onInlineEditorReady,
  onInlineEditorLayout,
  focusedAnnotationId,
}: {
  annotations: PaperDocument['annotations'];
  drafts: DraftAnnotationPreview[];
  /** Live text-selection band(s): painted by the highlight layer only, never as interactive marks. */
  selectionPreview?: readonly AnnotationMarkModel[];
  dragDraft: DragDraft | null;
  inkDraft: InkDraft | null;
  activeTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  toolSettings: ReaderToolSettings;
  onSelectAnnotation: (annotationId: string) => void;
  onBeginStickyDrag: (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => void;
  onBeginAnnotationResize: (annotationId: string, pageNumber: number, handle: AnnotationResizeHandle, event: MouseEvent<HTMLElement>) => void;
  onEditStickyAnnotation: (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => void;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onUpdateTextStyle?: (annotationId: string, patch: TextAnnotationStylePatch) => void | Promise<void>;
  /** Inline text editing session for this page, if any. */
  inlineTextEditor?: InlineTextEditorState | null;
  onCommitInlineText?: (text: string, element: HTMLDivElement) => void;
  onInlineEditorReady?: (element: HTMLDivElement | null) => void;
  onInlineEditorLayout?: (element: HTMLDivElement) => void;
  focusedAnnotationId: string | null;
}) {
  const dragPosition = dragDraft && activeTool !== 'cursor' && activeTool !== 'comment' && activeTool !== 'text' && activeTool !== 'ink' && activeTool !== 'eraser' && activeTool !== 'arrow' && activeTool !== 'rect' ? normalizeBox(dragDraft) : null;
  const arrowPreview = dragDraft && activeTool === 'arrow'
    ? {
        id: 'arrow-draft',
        page: dragDraft.page,
        type: 'arrow' as const,
        color: activeAnnotationColor,
        comment: '',
        quote: '',
        positionJson: {
          ...arrowPositionFromDrag(dragDraft),
          arrowStyle: toolSettings.arrowStyle,
          arrowEnding: toolSettings.arrowEnding,
          strokeWidth: toolSettings.arrowStrokeWidth,
        },
      }
    : null;
  const shapePreview = dragDraft && activeTool === 'rect'
    ? {
        id: 'shape-draft',
        page: dragDraft.page,
        type: 'rect' as const,
        color: activeAnnotationColor,
        comment: '',
        quote: '',
        positionJson: {
          ...normalizeBox(dragDraft),
          shapeKind: toolSettings.shapeKind,
          fillEnabled: toolSettings.shapeFillEnabled,
          strokeWidth: toolSettings.shapeStrokeWidth,
        },
      }
    : null;
  const inkPreview = inkDraft
    ? {
        id: 'ink-draft',
        page: inkDraft.page,
        type: 'ink' as const,
        color: activeAnnotationColor,
        comment: '',
        quote: '',
        positionJson: {
          ...inkPositionFromPoints(inkDraft.points),
          strokeWidth: toolSettings.inkStrokeWidth,
        },
      }
    : null;
  const newTextPreview: AnnotationMarkModel | null = inlineTextEditor && !inlineTextEditor.annotationId
    ? {
        page: inlineTextEditor.page,
        type: 'text',
        color: inlineTextEditor.color,
        comment: '',
        quote: '',
        positionJson: inlineTextEditor.positionJson,
      }
    : null;
  const rangeSelectionActive = activeTool === 'highlight' || activeTool === 'underline';
  const highlightAnnotations: AnnotationMarkModel[] = [...annotations, ...drafts, ...selectionPreview];
  if (dragPosition && dragDraft && activeTool === 'highlight') {
    highlightAnnotations.push({ id: 'highlight-drag-preview', page: dragDraft.page, type: 'highlight',
      color: activeAnnotationColor, quote: '', comment: '', positionJson: dragPosition });
  }
  return (
    <>
    <PdfHighlightLayer annotations={highlightAnnotations} />
    <div className="annotation-overlay" data-reader-layer="annotations" aria-label="PDF annotation layer">
      {annotations.map((annotation) => (
        <AnnotationMark
          key={annotation.id}
          annotation={annotation}
          onSelectAnnotation={onSelectAnnotation}
          onBeginStickyDrag={onBeginStickyDrag}
          onBeginAnnotationResize={onBeginAnnotationResize}
          onEditStickyAnnotation={onEditStickyAnnotation}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          onUpdateTextStyle={onUpdateTextStyle}
          inlineEditor={inlineTextEditor?.annotationId === annotation.id ? inlineTextEditor : null}
          onCommitInlineText={onCommitInlineText}
          onInlineEditorReady={onInlineEditorReady}
          onInlineEditorLayout={onInlineEditorLayout}
          focused={focusedAnnotationId === annotation.id}
          eraserActive={activeTool === 'eraser'}
          rangeSelectionActive={rangeSelectionActive}
        />
      ))}
      {newTextPreview && (
        <AnnotationMark
          key="inline-text-draft"
          annotation={newTextPreview}
          draft
          inlineEditor={inlineTextEditor}
          onCommitInlineText={onCommitInlineText}
          onInlineEditorReady={onInlineEditorReady}
          onInlineEditorLayout={onInlineEditorLayout}
        />
      )}
      {drafts.map((annotation) => (
        <AnnotationMark key={annotation.id} annotation={annotation} draft />
      ))}
      {inkPreview && <AnnotationMark annotation={inkPreview} draft />}
      {arrowPreview && <AnnotationMark annotation={arrowPreview} draft />}
      {shapePreview && <AnnotationMark annotation={shapePreview} draft />}
      {dragPosition && activeTool !== 'cursor' && activeTool !== 'hand' && activeTool !== 'comment' && activeTool !== 'text' && activeTool !== 'ink' && activeTool !== 'eraser' && activeTool !== 'rect' && (
        <div
          className={`annotation-mark ${activeTool} ${annotationColor(activeTool)} draft drag-preview`}
          style={activeTool === 'underline' ? underlinePositionStyle(dragPosition) : activeTool === 'highlight' ? highlightPositionStyle(dragPosition) : positionStyle(dragPosition)}
        />
      )}
    </div>
    </>
  );
}

function inkPositionFromPoints(points: InkDraft['points']): PositionJson {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(Math.max(...xs) - x, 0.1);
  const height = Math.max(Math.max(...ys) - y, 0.1);
  return { x, y, width, height, points };
}
