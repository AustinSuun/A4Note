/**
 * Back stack for PDF link jumps (card e4c2fa22). Pure functions over an immutable array so the rules
 * are testable without a DOM:
 *   - every link jump pushes the position it left (`pushLinkOrigin`), newest last, capped;
 *   - the 「返回」 button shows the newest entry and pops it (`popLinkOrigin`);
 *   - when the reader scrolls back near the newest origin on its own, that entry is dismissed without a
 *     click (`dismissReturnedOrigins`), repeatedly, so the button never offers a "return" to where you are.
 * "Near" (`isNearLinkOrigin`): same visible page and within `PDF_LINK_RETURN_RATIO` of the viewport height,
 * or the origin's first visible line is inside the current viewport.
 */
import type { PdfScrollAnchor } from './types';

export type PdfLinkOrigin = {
  page: number;
  scrollTop: number;
  /** Zoom-independent copy of `scrollTop`; used when the zoom changed after the jump. */
  anchor: PdfScrollAnchor;
  zoom: number;
  time: number;
};

export type PdfLinkViewportState = { page: number; scrollTop: number; viewportHeight: number };

export const PDF_LINK_HISTORY_LIMIT = 32;
export const PDF_LINK_RETURN_RATIO = 0.4;

export function pushLinkOrigin(stack: readonly PdfLinkOrigin[], origin: PdfLinkOrigin): PdfLinkOrigin[] {
  const next = [...stack, origin];
  return next.length > PDF_LINK_HISTORY_LIMIT ? next.slice(next.length - PDF_LINK_HISTORY_LIMIT) : next;
}

export function popLinkOrigin(stack: readonly PdfLinkOrigin[]): { stack: PdfLinkOrigin[]; origin: PdfLinkOrigin | null } {
  if (!stack.length) return { stack: [], origin: null };
  return { stack: stack.slice(0, -1), origin: stack[stack.length - 1] };
}

export function topLinkOrigin(stack: readonly PdfLinkOrigin[]): PdfLinkOrigin | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/** `originScrollTop` is the origin's scroll offset at the *current* zoom (callers re-derive it from the
 * anchor when the zoom changed); it defaults to the recorded value. */
export function isNearLinkOrigin(origin: PdfLinkOrigin, view: PdfLinkViewportState, originScrollTop: number = origin.scrollTop): boolean {
  if (!(view.viewportHeight > 0) || !Number.isFinite(originScrollTop) || !Number.isFinite(view.scrollTop)) return false;
  const distance = Math.abs(view.scrollTop - originScrollTop);
  if (origin.page === view.page && distance <= PDF_LINK_RETURN_RATIO * view.viewportHeight) return true;
  return originScrollTop >= view.scrollTop && originScrollTop <= view.scrollTop + view.viewportHeight;
}

/** Drops every trailing origin the viewport has returned to. Returns the same array when nothing changes. */
export function dismissReturnedOrigins(
  stack: readonly PdfLinkOrigin[],
  view: PdfLinkViewportState,
  resolveScrollTop: (origin: PdfLinkOrigin) => number = (origin) => origin.scrollTop,
): readonly PdfLinkOrigin[] {
  let end = stack.length;
  while (end > 0 && isNearLinkOrigin(stack[end - 1], view, resolveScrollTop(stack[end - 1]))) end -= 1;
  return end === stack.length ? stack : stack.slice(0, end);
}
