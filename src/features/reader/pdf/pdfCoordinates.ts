/** The bitmap, selectable text and annotation overlay share this exact CSS box.
 * Client rects already include scrolling and compositor zoom: never apply DPR
 * or the PDF zoom factor again while converting a client point to percentages.
 */
export function pdfCoordinateLayer(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('.pdf-render-layer')
    ?? element.querySelector<HTMLElement>('.pdf-render-layer')
    ?? element;
}
