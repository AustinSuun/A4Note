import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep tool settings outside the horizontally scrolling toolbar and clipped title bar. */
export function ReaderToolPopover({ children, onClose, title = '标注设置', headerAction }: { children: ReactNode; onClose: () => void; title?: string; headerAction?: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 40, maxWidth: 0, maxHeight: 0, ready: false });
  useLayoutEffect(() => {
    const slot = anchor.current?.parentElement;
    const node = popup.current;
    if (!slot || !node) return;
    const place = () => {
      const rect = slot.getBoundingClientRect();
      if (!slot.isConnected || !slot.getClientRects().length) { close.current(); return; }
      // DOMRects use viewport coordinates; fixed offsets use the portal's zoomed
      // CSS coordinate space. Include every ancestor, not only documentElement.
      let zoom = 1;
      for (let element: HTMLElement | null = node; element; element = element.parentElement) {
        const value = Number.parseFloat(getComputedStyle(element).zoom);
        if (Number.isFinite(value) && value > 0) zoom *= value;
      }
      const availableWidth = Math.max(1, window.innerWidth - 16);
      const availableHeight = Math.max(1, window.innerHeight - 16);
      const bounds = node.getBoundingClientRect();
      const width = Math.min(bounds.width, availableWidth);
      const height = Math.min(bounds.height, availableHeight);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + height + 12 <= window.innerHeight;
      const top = Math.max(8, Math.min(below ? rect.bottom + 6 : rect.top - height - 6, window.innerHeight - height - 8));
      setPosition({ left: left / zoom, top: top / zoom, maxWidth: availableWidth / zoom, maxHeight: availableHeight / zoom, ready: true });
    };
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !slot.contains(event.target as Node)) close.current();
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(node);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, []);
  // A visibility:hidden element cannot receive focus. Wait for the first visible commit,
  // not every placement update, so scrolling/resizing never steals the user's focus.
  useLayoutEffect(() => {
    if (position.ready) popup.current?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled)')?.focus({ preventScroll: true });
  }, [position.ready]);
  return <><span ref={anchor} hidden />{createPortal(<div ref={popup} className="reader-tool-popover" role="dialog" aria-label="标注工具设置"
    style={{ left: position.left, top: position.top, boxSizing: 'border-box', maxWidth: position.ready ? position.maxWidth : undefined, maxHeight: position.ready ? position.maxHeight : undefined, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); anchor.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); close.current(); } }}>
    <div className="reader-tool-popover-heading"><strong>{title}</strong>{headerAction}</div>
    {children}
  </div>, document.body)}</>;
}
