import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './reader-responsive-toolbar.css';

/** Measure available titlebar space, not the window: the sidebar can consume most of it. */
export function ReaderResponsiveToolbar({ children, label }: { children: ReactNode; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const host = root.current, content = full.current;
    if (!host || !content) return;
    const measure = () => {
      if (!host.getClientRects().length) return;
      const bar = content.firstElementChild as HTMLElement | null;
      setCompact(content.getBoundingClientRect().width > host.getBoundingClientRect().width + .5
        || Boolean(bar && bar.scrollHeight > bar.clientHeight + 1));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host); observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!compact) {
      if (popup.current?.contains(document.activeElement)) full.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      setOpen(false);
    }
  }, [compact]);
  useLayoutEffect(() => {
    if (!open || !compact) return;
    const anchor = trigger.current, panel = popup.current;
    if (!anchor || !panel) return;
    const place = () => {
      if (!anchor.getClientRects().length) { setOpen(false); return; }
      // Account for CSS zoom as well as native/browser zoom. Portal coordinates use body CSS pixels.
      const scale = panel.offsetWidth ? panel.getBoundingClientRect().width / panel.offsetWidth : 1;
      panel.style.maxWidth = `${Math.max(1, window.innerWidth - 16) / scale}px`;
      panel.style.maxHeight = `${Math.max(1, window.innerHeight - 16) / scale}px`;
      const a = anchor.getBoundingClientRect(), p = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - p.width - 8)) / scale}px`;
      panel.style.top = `${Math.max(8, Math.min(a.bottom + 6, window.innerHeight - p.height - 8)) / scale}px`;
      panel.style.visibility = 'visible';
    };
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) setOpen(false);
    };
    place(); panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(anchor); observer.observe(panel);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, compact]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={root} className="reader-responsive-toolbar" data-compact={compact}>
    <div ref={full} className="reader-responsive-full" aria-hidden={compact || undefined} inert={compact}>{children}</div>
    {compact && <button ref={trigger} className="reader-responsive-trigger" type="button" aria-label={`阅读工具：${label}`} title="阅读工具：文件模式与缩放" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}><span>{label}</span><span aria-hidden="true">⋯</span></button>}
    {open && compact && createPortal(<div ref={popup} className="reader-responsive-popover" role="dialog" aria-label="阅读工具" style={{ visibility: 'hidden' }}
      onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="reader-responsive-heading"><strong>阅读工具</strong><button type="button" aria-label="关闭阅读工具" onClick={close}>×</button></div>
      {children}
    </div>, document.body)}
  </div>;
}
