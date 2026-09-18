import type { PdfZoomAnchor } from './types';

/** Capture the visible pane center, never the mouse or the full document midpoint. */
export function capturePdfCenterAnchor(scroller: HTMLElement): PdfZoomAnchor | null {
  const content = scroller.querySelector<HTMLElement>('.pdf-document-content');
  if (!content) return null;
  const viewport = scroller.getBoundingClientRect();
  const rect = content.getBoundingClientRect();
  const x = viewport.left + scroller.clientLeft + scroller.clientWidth / 2;
  const y = viewport.top + scroller.clientTop + scroller.clientHeight / 2;
  const anchor: PdfZoomAnchor = {
    x, y,
    // The viewport-wide grid can have oversized pages overflowing it: do not
    // clamp this point to the grid width when already scrolled horizontally.
    contentX: x - rect.left,
    contentY: y - rect.top,
    contentOriginX: rect.left - viewport.left + scroller.scrollLeft,
    contentOriginY: rect.top - viewport.top + scroller.scrollTop,
  };
  let distance = Infinity;
  for (const page of scroller.querySelectorAll<HTMLElement>('.pdf-page[data-page]')) {
    const bounds = page.getBoundingClientRect();
    const number = Number(page.dataset.page);
    if (!(bounds.width > 0 && bounds.height > 0 && Number.isInteger(number) && number > 0)) continue;
    const nearestY = Math.max(bounds.top, Math.min(bounds.bottom, y));
    const nextDistance = Math.abs(y - nearestY);
    if (nextDistance >= distance) continue;
    distance = nextDistance;
    const nearestX = Math.max(bounds.left, Math.min(bounds.right, x));
    anchor.pageAnchor = {
      page: number,
      xRatio: (nearestX - bounds.left) / bounds.width,
      yRatio: (nearestY - bounds.top) / bounds.height,
      offsetX: x - nearestX,
      offsetY: y - nearestY,
    };
    if (distance === 0) break;
  }
  return anchor;
}

/** Keep the same point of the same page at the center after page layout changes.
 * A document-wide scale alone incorrectly scales centering margins and page gaps.
 */
export function restorePdfPageAnchor(scroller: HTMLElement, anchor: PdfZoomAnchor): boolean {
  const point = anchor.pageAnchor;
  if (!point || !Number.isInteger(point.page)) return false;
  const page = scroller.querySelector<HTMLElement>(`.pdf-page[data-page="${point.page}"]`);
  if (!page) return false;
  const rect = page.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const viewport = scroller.getBoundingClientRect();
  const x = viewport.left + scroller.clientLeft + scroller.clientWidth / 2;
  const y = viewport.top + scroller.clientTop + scroller.clientHeight / 2;
  const left = scroller.scrollLeft + rect.left + point.xRatio * rect.width + point.offsetX - x;
  const top = scroller.scrollTop + rect.top + point.yRatio * rect.height + point.offsetY - y;
  scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, left));
  scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, top));
  return true;
}
