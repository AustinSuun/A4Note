import type * as pdfjsLib from 'pdfjs-dist';
import type { AnnotationDraft, AnnotationType, PositionJson } from '../../../core/types';

export type PdfStatus = 'loading' | 'ready' | 'placeholder' | 'error';

export type PageMeta = {
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  pdfPage: pdfjsLib.PDFPageProxy;
  textItems: TextItemBox[];
};

export type TextItemBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

export type RectBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArrowStyle = 'solid' | 'dashed' | 'double';
export type ArrowEnding = 'arrow' | 'line';

export type EraserShape = 'round' | 'square';

export type ShapeKind = 'rect' | 'ellipse';

export type ReaderToolSettings = {
  inkStrokeWidth: number;
  eraserSize: number;
  eraserShape: EraserShape;
  arrowStyle: ArrowStyle;
  arrowEnding: ArrowEnding;
  arrowStrokeWidth: number;
  textBold: boolean;
  textItalic: boolean;
  textBorderColor: string;
  textBackgroundColor: string;
  shapeKind: ShapeKind;
  shapeFillEnabled: boolean;
  shapeStrokeWidth: number;
};

export const defaultReaderToolSettings: ReaderToolSettings = {
  inkStrokeWidth: 4,
  eraserSize: 18,
  eraserShape: 'round',
  arrowStyle: 'solid',
  arrowEnding: 'arrow',
  arrowStrokeWidth: 3.4,
  textBold: false,
  textItalic: false,
  textBorderColor: '#ffffff',
  textBackgroundColor: 'transparent',
  shapeKind: 'rect',
  shapeFillEnabled: false,
  shapeStrokeWidth: 2.4,
};

export type DraftAnnotationPreview = (AnnotationDraft & { page: number }) & { id: string };

export type AnnotationMarkModel = {
  id?: string;
  page: number;
  type: AnnotationType;
  color: string;
  comment: string;
  quote: string;
  positionJson: PositionJson;
};

export type DragDraft = {
  page: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

export type InkDraft = {
  page: number;
  points: Array<{ x: number; y: number }>;
};

export type CommentPopover = {
  annotationId?: string;
  annotationType?: 'comment' | 'text';
  page: number;
  x: number;
  y: number;
  leftPx: number;
  topPx: number;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  positionJson?: PositionJson;
};

export type StickyDrag = {
  annotationId: string;
  page: number;
  offsetX: number;
  offsetY: number;
};

export type StickyDragPreview = {
  annotationId: string;
  page: number;
  positionJson: PositionJson;
};

export type ReaderFlash = {
  page: number;
  kind: 'page-jump' | 'annotation';
};
