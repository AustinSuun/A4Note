import type * as pdfjsLib from 'pdfjs-dist';
import type { AnnotationColor, AnnotationDraft, AnnotationType, PositionJson } from '../../../core/types';
import { defaultAnnotationToolSettings, type AnnotationToolSettings } from '../../annotationTools';

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
  /** Quantized on-screen reading direction of the run; absent means left-to-right. */
  orientation?: TextOrientation;
  /** Generic family pdf.js resolved for the run's PDF font. The transparent text layer lays the
   * run out in a substitute of this family so its glyph advances stay close to the painted
   * glyphs; absent when pdf.js reported none (older page metas, unusual fonts). */
  fontFamily?: TextFontFamily;
};

/** Generic CSS families pdf.js assigns to PDF fonts (`TextStyle.fontFamily`). */
export type TextFontFamily = 'serif' | 'sans-serif' | 'monospace';

/** Clockwise quarter turns of a text run on screen: 0 reads left→right, 90 top→bottom (page /Rotate 90), 180 right→left, 270 bottom→top. */
export type TextOrientation = 0 | 90 | 180 | 270;

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

export type PdfScrollAnchor = {
  page: number;
  pageProgress: number;
};

/** Zoom gesture anchor used to restore the same PDF point after layout. */
export type PdfZoomAnchor = {
  pageAnchor?: { page: number; xRatio: number; yRatio: number; offsetX: number; offsetY: number };
  x: number;
  y: number;
  contentX: number;
  contentY: number;
  contentOriginX: number;
  contentOriginY: number;
};

/**
 * Task 97fcfb6c: the reader's tool settings ARE the shared annotation tool settings – one
 * store, one storage key, one set of defaults; the whiteboard reads and writes the same values.
 */
export type ReaderToolSettings = AnnotationToolSettings;
export const defaultReaderToolSettings: ReaderToolSettings = defaultAnnotationToolSettings;

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

/** In-place editing session for a text annotation (task 540986ab): no settings popover, the page box itself is the input. */
export type InlineTextEditorState = {
  /** Undefined while creating; the new annotation is only persisted when the editor finishes with text. */
  annotationId?: string;
  page: number;
  /** Text shown when the editor opens; the live value lives in the DOM until commit. */
  text: string;
  /** Percent geometry and style used for a new box; edits reuse the annotation's own positionJson. */
  positionJson: PositionJson;
  color: AnnotationColor;
};

export type TextAnnotationStylePatch = Partial<{
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
}>;

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
  /** Geometry the drag started from when it differs from the stored one (measured auto-sized text boxes). */
  positionJson?: PositionJson;
};

export type StickyDragPreview = {
  annotationId: string;
  page: number;
  positionJson: PositionJson;
};

export type AnnotationResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type AnnotationResize = {
  annotationId: string;
  page: number;
  handle: AnnotationResizeHandle;
  origin: RectBox;
  minWidth: number;
  minHeight: number;
  /** Base geometry/style for the resized result (text boxes become fixed-width here). */
  positionJson?: PositionJson;
};

export type ReaderFlash = {
  page: number;
  kind: 'page-jump' | 'annotation';
};
