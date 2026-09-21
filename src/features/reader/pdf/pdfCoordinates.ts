/** The bitmap, selectable text and annotation overlay share this exact CSS box.
 * Client rects already include scrolling and compositor zoom: never apply DPR
 * or the PDF zoom factor again while converting a client point to percentages.
 */
export function pdfCoordinateLayer(element: HTMLElement): HTMLElement {
  // Defensive: element may be a mock in tests without classList.
  const hasClassList = !!(element as any)?.classList?.contains;
  const hasClosest = typeof (element as any)?.closest === 'function';
  const hasQuery = typeof (element as any)?.querySelector === 'function';
  if (hasClassList && element.classList.contains('pdf-render-layer')) return element;
  if (hasClosest) {
    const insideLayer = element.closest<HTMLElement>('.pdf-render-layer');
    if (insideLayer) return insideLayer;
  }
  if (hasClassList && element.classList.contains('pdf-page')) {
    return hasQuery ? (element.querySelector<HTMLElement>('.pdf-render-layer') ?? element) : element;
  }
  if (hasClosest) {
    const page = element.closest<HTMLElement>('.pdf-page');
    if (page) {
      const q = (page as any).querySelector?.bind(page);
      return q ? (q('.pdf-render-layer') ?? page) : page;
    }
  }
  if (hasQuery) {
    return element.querySelector<HTMLElement>('.pdf-render-layer') ?? element;
  }
  return element;
}
