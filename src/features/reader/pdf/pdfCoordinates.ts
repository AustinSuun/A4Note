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

/** One raw client-to-page sample shared by cursor previews and hit testing.
 * Keep the pixel and percentage coordinates together so the two consumers cannot
 * accidentally measure against different boxes or apply zoom/DPR twice.
 */
export function pdfPointerCoordinates(element: HTMLElement, clientX: number, clientY: number) {
  const layer = pdfCoordinateLayer(element);
  const rect = layer.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)
    || ![rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite)) return null;
  // The DOM rect is in viewport CSS pixels (already zoomed), while the
  // cursor diameter is a local CSS length. Keep both spaces explicit.
  const style = layer.ownerDocument?.defaultView?.getComputedStyle(layer);
  const layoutWidth = Number.parseFloat(style?.width ?? '') || layer.clientWidth || rect.width;
  const layoutHeight = Number.parseFloat(style?.height ?? '') || layer.clientHeight || rect.height;
  const xPx = clientX - rect.left;
  const yPx = clientY - rect.top;
  return {
    layer,
    rect,
    xPx,
    yPx,
    layoutWidth,
    layoutHeight,
    xPercent: (xPx / rect.width) * 100,
    yPercent: (yPx / rect.height) * 100,
    inside: xPx >= 0 && xPx <= rect.width && yPx >= 0 && yPx <= rect.height,
  };
}
