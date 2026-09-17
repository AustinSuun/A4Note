import { useLayoutEffect, useRef, type RefObject } from 'react';
import { scrollAnchorFromContainer, scrollTopFromAnchor } from './pdf/pdfInteraction';
import type { PdfScrollAnchor } from './pdf/types';
type Position = { anchor: PdfScrollAnchor; left: number };
/** Layout-only restoration: explicit page/annotation/zoom/source changes reset the anchor. */
export function useReaderLayoutPosition(root: RefObject<HTMLDivElement | null>, navigationKey: string, layoutKey: string) {
  const positions = useRef(new Map<HTMLElement, Position>());
  const previous = useRef({ navigationKey, layoutKey });
  const restoring = useRef(false);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const capture = (event: Event) => {
      const element = event.target;
      if (restoring.current || !(element instanceof HTMLElement) || !element.matches('[data-reader-layer="pdf-document"]') || element.closest('[aria-hidden="true"]')) return;
      if (element.clientHeight && element.querySelector('.pdf-page[data-page]')) positions.current.set(element, { anchor: scrollAnchorFromContainer(element), left: element.scrollLeft });
    };
    container.addEventListener('scroll', capture, true);
    return () => { container.removeEventListener('scroll', capture, true); positions.current.clear(); };
  }, [root]);
  useLayoutEffect(() => {
    const prior = previous.current; previous.current = { navigationKey, layoutKey };
    if (navigationKey !== prior.navigationKey) { positions.current.clear(); return; }
    if (layoutKey === prior.layoutKey) return;
    const container = root.current;
    if (!container) return;
    restoring.current = true;
    let frame = 0;
    const restore = () => {
      for (const [element, position] of positions.current) {
        if (!container.contains(element)) { positions.current.delete(element); continue; }
        if (!element.clientHeight || element.closest('[aria-hidden="true"]') || !element.querySelector('.pdf-page[data-page]')) continue;
        element.scrollTop = scrollTopFromAnchor(element, position.anchor);
        element.scrollLeft = position.left;
      }
    };
    const release = () => { cancelAnimationFrame(frame); restoring.current = false; };
    restore(); frame = requestAnimationFrame(() => { restore(); restoring.current = false; });
    container.addEventListener('wheel', release, { capture: true, once: true });
    container.addEventListener('pointerdown', release, { capture: true, once: true });
    return () => { release(); container.removeEventListener('wheel', release, true); container.removeEventListener('pointerdown', release, true); };
  }, [root, navigationKey, layoutKey]);
}
