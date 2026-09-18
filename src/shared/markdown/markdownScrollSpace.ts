/** Space is relative to the actual reading pane, not the desktop/window height. */
export function markdownEndSpace(height: number): number {
  return Number.isFinite(height) && height > 0 ? Math.round(height * 0.4) : 0;
}
export function markdownCaretScrollDelta(top: number, bottom: number, viewportTop: number, height: number): number {
  if (!(height > 0)) return 0;
  const lower = viewportTop + height - markdownEndSpace(height);
  const upper = viewportTop + Math.min(24, height * 0.1);
  return bottom > lower ? bottom - lower : top < upper ? top - upper : 0;
}
export function markdownScrollHost(element: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return document.scrollingElement as HTMLElement;
}
/** Layout-only tail space. Never inserts text or changes the editor selection/history. */
export function observeMarkdownEndSpace(element: HTMLElement, viewport = markdownScrollHost(element), changed?: () => void) {
  const property = '--markdown-end-space';
  const previous = element.style.getPropertyValue(property);
  let last = '';
  const measure = () => {
    const height = viewport.clientHeight;
    if (!height) return; // Keep the last valid size while a keep-alive tab/drawer is hidden.
    const value = `${markdownEndSpace(height)}px`;
    if (value === last) return;
    last = value;
    element.style.setProperty(property, value);
    changed?.();
  };
  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  measure();
  return () => {
    observer.disconnect();
    if (element.style.getPropertyValue(property) === last) {
      if (previous) element.style.setProperty(property, previous);
      else element.style.removeProperty(property);
    }
  };
}
