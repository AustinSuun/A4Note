import type { RectBox } from './types';

export type SelectionPopupPlacement = 'above' | 'below';

/** Anchor of the quick-action popup in the page's percentage space. */
export type SelectionPopupAnchor = {
  x: number;
  y: number;
  placement: SelectionPopupPlacement;
};

/** Popup height plus the gap to the line, in page-local CSS pixels (see `.selection-popup`). */
export const SELECTION_POPUP_CLEARANCE_PX = 56;
/** Half of the popup width plus a margin, in page-local CSS pixels: keeps it inside the page. */
export const SELECTION_POPUP_HALF_WIDTH_PX = 40;

/** Where the quick-action popup hangs off a text selection.
 *
 * The anchor is expressed in the page's percentage space and rendered inside the page's render
 * layer, so it moves with the page under any PDF zoom, root (UI) zoom, device scale or scroll —
 * the same space the live preview band and the saved highlight/underline use. Client pixels and
 * layout pixels must never be mixed here: the old popup subtracted the scroller's client rect from
 * the pointer and wrote the result as a CSS length inside a zoomed root, which drifted by
 * (zoom − 1) × distance from the scroller origin plus the scroller padding.
 *
 * The popup sits above the first selected line, horizontally over the pointer when the pointer
 * is on that line (clamped to the line), otherwise over the line's middle. When the first line is
 * too close to the page top for the popup to fit, it hangs below the last line instead. `pagePx`
 * is the page's layout size, used only for those pixel-sized clearances. */
export function selectionPopupAnchor(
  segments: readonly RectBox[],
  pointer: { x: number; y: number } | null,
  pagePx: { width?: number; height: number },
  clearancePx = SELECTION_POPUP_CLEARANCE_PX,
): SelectionPopupAnchor | null {
  const lines = segments.filter((segment) => [segment.x, segment.y, segment.width, segment.height].every(Number.isFinite) && segment.width > 0 && segment.height > 0);
  if (!lines.length) return null;
  const first = lines.reduce((top, segment) => (segment.y < top.y ? segment : top));
  const last = lines.reduce((bottom, segment) => (segment.y + segment.height > bottom.y + bottom.height ? segment : bottom));
  const fitsAbove = !(pagePx.height > 0) || (first.y / 100) * pagePx.height >= clearancePx;
  const line = fitsAbove ? first : last;
  const pointerOnLine = pointer !== null && pointer.y >= line.y - line.height && pointer.y <= line.y + line.height * 2;
  const wanted = pointerOnLine ? pointer.x : line.x + line.width / 2;
  const margin = pagePx.width && pagePx.width > 0 ? (SELECTION_POPUP_HALF_WIDTH_PX / pagePx.width) * 100 : 0;
  const x = clampTo(clampTo(wanted, line.x, line.x + line.width), margin, 100 - margin);
  return fitsAbove
    ? { x, y: line.y, placement: 'above' }
    : { x, y: line.y + line.height, placement: 'below' };
}

function clampTo(value: number, min: number, max: number) {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}
