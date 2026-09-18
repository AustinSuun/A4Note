/** Request search only in the focused/active visible PDF, never in a hidden retained tab. */
export function requestPdfFind() {
  const visible = (node: HTMLElement | null) => node && node.getClientRects().length > 0
    && !node.closest('[inert], [aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden';
  const focused = document.activeElement?.closest<HTMLElement>('.pdf-reader-surface') ?? null;
  const candidates = [focused,
    ...document.querySelectorAll<HTMLElement>('.workbench-tab-frame.active .pdf-keepalive-pane.active .pdf-reader-surface'),
    ...document.querySelectorAll<HTMLElement>('.workbench-tab-frame.active .pdf-reader-surface'),
    ...document.querySelectorAll<HTMLElement>('.pdf-reader-surface')];
  const surface = candidates.find(visible);
  surface?.dispatchEvent(new Event('reader-find'));
  return Boolean(surface);
}

/** Read stable page base width, not a wheel-preview transformed bounding box. */
export function pdfFitWidth(scroller: HTMLElement, currentPage = 1): number | null {
  const page = scroller.querySelector<HTMLElement>(`.pdf-page[data-page="${currentPage}"]`)
    ?? scroller.querySelector<HTMLElement>('.pdf-page[data-page]');
  const base = Number(page?.dataset.baseWidth);
  if (!Number.isFinite(base) || base <= 0 || scroller.clientWidth <= 0) return null;
  const style = getComputedStyle(scroller);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(0.2, Math.min(5, Math.floor(Math.max(1, scroller.clientWidth - padding - 8) / base * 100) / 100));
}
