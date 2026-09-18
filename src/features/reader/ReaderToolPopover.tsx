import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep tool settings outside the horizontally scrolling toolbar and clipped title bar. */
export function ReaderToolPopover({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 40, ready: false });
  useLayoutEffect(() => {
    const slot = anchor.current?.parentElement;
    const node = popup.current;
    if (!slot || !node) return;
    const place = () => {
      const rect = slot.getBoundingClientRect();
      if (!slot.isConnected || !slot.getClientRects().length) { close.current(); return; }
      const width = node.offsetWidth, height = node.offsetHeight;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      setPosition({ left, top, ready: true });
    };
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !slot.contains(event.target as Node)) close.current();
    };
    place();
    node.querySelector<HTMLElement>('input,button,select')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(node);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, []);
  return <><span ref={anchor} hidden />{createPortal(<div ref={popup} className="reader-tool-popover" role="dialog" aria-label="标注工具设置"
    style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); anchor.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); close.current(); } }}>
    <div className="reader-tool-popover-heading"><strong>标注设置</strong><button type="button" aria-label="关闭标注设置" onClick={() => { anchor.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); close.current(); }}>×</button></div>
    {children}
  </div>, document.body)}</>;
}
