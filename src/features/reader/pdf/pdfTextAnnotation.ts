import type { CSSProperties } from 'react';
import type { PositionJson } from '../../../core/types';

/**
 * Text annotations created after this change store their font size in page units:
 * the value is the CSS pixel size at 100% zoom and scales with the PDF zoom, so a
 * label keeps the same proportion to the page text at 100%, 200% or 335%.
 * Older annotations without `fontUnit` keep their legacy fixed-pixel font.
 */
export const TEXT_FONT_UNIT_PAGE = 'page';
export const TEXT_DEFAULT_FONT_SIZE = 24;
export const TEXT_FONT_SIZE_OPTIONS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64];
export const TEXT_LINE_HEIGHT = 1.3;
/** Widest a fresh box may grow before wrapping, as a share of the page width. */
export const TEXT_MAX_WIDTH_PERCENT = 60;
/** Distance kept from the right and bottom page edges, in percent of the page. */
export const TEXT_EDGE_MARGIN_PERCENT = 1.5;
/** Minimum width of an auto-sized box, expressed in multiples of the font size. */
export const TEXT_MIN_WIDTH_EM = 3;
export const TEXT_ZOOM_VAR = '--pdf-display-zoom';

export type TextAnnotationLayout = {
  fontSize: number;
  fontUnit: 'page' | 'px';
  autoWidth: boolean;
  maxWidth: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  borderColor: string;
  backgroundColor: string;
};

export function textAnnotationLayout(position: PositionJson): TextAnnotationLayout {
  const fontUnit = position.fontUnit === TEXT_FONT_UNIT_PAGE ? 'page' : 'px';
  return {
    fontSize: Math.max(numberValue(position.fontSize, 24), 2),
    fontUnit,
    autoWidth: fontUnit === 'page' && position.autoWidth !== false,
    maxWidth: clampPercent(numberValue(position.maxWidth, TEXT_MAX_WIDTH_PERCENT), 4, 100),
    bold: Boolean(position.bold),
    italic: Boolean(position.italic),
    textColor: String(position.textColor ?? '#202822'),
    borderColor: String(position.borderColor ?? '#ffffff'),
    backgroundColor: String(position.backgroundColor ?? 'transparent'),
  };
}

/** CSS length for a text size in the given unit; page units follow the zoom variable set on the render layer. */
export function textLength(value: number, fontUnit: 'page' | 'px') {
  return fontUnit === 'page' ? `calc(var(${TEXT_ZOOM_VAR}, 1) * ${value}px)` : `${value}px`;
}

/** Typography shared by the rendered label and the inline editor so entering edit mode never moves a glyph. */
export function textTypographyStyle(layout: TextAnnotationLayout): CSSProperties {
  return {
    fontSize: textLength(layout.fontSize, layout.fontUnit),
    lineHeight: TEXT_LINE_HEIGHT,
    fontWeight: layout.bold ? 700 : 500,
    fontStyle: layout.italic ? 'italic' : 'normal',
    color: layout.textColor,
    padding: `${textLength(3, layout.fontUnit)} ${textLength(6, layout.fontUnit)}`,
  };
}

/** Box geometry of a text annotation: auto boxes hug their content, fixed boxes keep the user width but never clip. */
export function textBoxStyle(position: PositionJson, layout: TextAnnotationLayout): CSSProperties {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const base: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    height: 'auto',
    outline: `1.5px solid ${layout.borderColor === 'transparent' ? 'rgba(255,255,255,.01)' : layout.borderColor}`,
    background: layout.backgroundColor === 'transparent' ? 'transparent' : layout.backgroundColor,
  };
  if (layout.autoWidth) {
    return {
      ...base,
      width: 'auto',
      minWidth: textLength(layout.fontSize * TEXT_MIN_WIDTH_EM, layout.fontUnit),
      maxWidth: `${Math.min(layout.maxWidth, Math.max(100 - x - TEXT_EDGE_MARGIN_PERCENT, 4))}%`,
    };
  }
  return {
    ...base,
    width: `${Math.max(numberValue(position.width, 22), 1)}%`,
    minHeight: `${Math.max(numberValue(position.height, 0), 0)}%`,
  };
}

export type InlineTextPlacementInput = {
  x: number;
  y: number;
  pageWidthPx: number;
  pageHeightPx: number;
  fontPx: number;
};

/**
 * Where a new box may sit. Near the right edge the anchor moves left so at least a
 * few characters fit before wrapping; the bottom is handled after measuring.
 */
export function placeNewTextBox({ x, y, pageWidthPx, fontPx }: InlineTextPlacementInput) {
  const minWidthPercent = pageWidthPx > 0 ? ((fontPx * TEXT_MIN_WIDTH_EM * 2) / pageWidthPx) * 100 : 8;
  const rightLimit = 100 - TEXT_EDGE_MARGIN_PERCENT;
  let left = clampPercent(x, 0, rightLimit);
  if (rightLimit - left < minWidthPercent) left = Math.max(0, rightLimit - minWidthPercent);
  const maxWidth = Math.min(TEXT_MAX_WIDTH_PERCENT, Math.max(rightLimit - left, minWidthPercent));
  return { x: left, y: clampPercent(y, 0, 100 - TEXT_EDGE_MARGIN_PERCENT), maxWidth };
}

/** Keep a measured box inside the page: shift up/left instead of clipping. */
export function clampTextBoxToPage(position: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(Math.max(position.width, 0.1), 100);
  const height = Math.min(Math.max(position.height, 0.1), 100);
  const x = clampPercent(position.x, 0, Math.max(100 - width, 0));
  const yLimit = Math.max(100 - TEXT_EDGE_MARGIN_PERCENT - height, 0);
  const y = position.y + height > 100 - TEXT_EDGE_MARGIN_PERCENT ? clampPercent(position.y, 0, yLimit) : clampPercent(position.y, 0, Math.max(100 - height, 0));
  return { x, y, width, height };
}

/** Percent geometry of an element inside its PDF render layer. */
export function percentBoxOf(element: HTMLElement, layer: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  if (!(layerRect.width > 0 && layerRect.height > 0)) return null;
  return {
    x: ((rect.left - layerRect.left) / layerRect.width) * 100,
    y: ((rect.top - layerRect.top) / layerRect.height) * 100,
    width: (rect.width / layerRect.width) * 100,
    height: (rect.height / layerRect.height) * 100,
  };
}

/** Editor text → stored comment: normalise line breaks and editor artefacts, drop trailing blank lines. */
export function normalizeInlineText(raw: string) {
  return raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\n+$/, '');
}

export function roundPercent(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clampPercent(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Local copy of pdfGeometry.numberValue so this module stays free of pdf.js for the Node verifier. */
function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
