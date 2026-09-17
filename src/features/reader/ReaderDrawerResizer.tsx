import { useEffect, useRef } from 'react';
export function ReaderDrawerResizer({ width, maximum, onChange }: { width: number; maximum: number; onChange: (width: number) => void }) {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  return <div className="reader-drawer-resize-handle" role="separator" aria-label="调整笔记侧栏宽度" aria-orientation="vertical"
    aria-valuemin={300} aria-valuemax={maximum} aria-valuenow={Math.round(width)} tabIndex={0}
    onDoubleClick={() => onChange(420)} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 60 : 20)); }
      if (event.key === 'Home') { event.preventDefault(); onChange(300); }
      if (event.key === 'End') { event.preventDefault(); onChange(maximum); }
    }} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); cancel.current?.();
      const handle = event.currentTarget, id = event.pointerId, startX = event.clientX, startWidth = width;
      let frame = 0, next = width;
      const previous = document.body.style.userSelect;
      document.body.style.userSelect = 'none'; handle.setPointerCapture(id);
      const apply = () => { frame = 0; onChange(next); };
      const move = (e: PointerEvent) => { if (e.pointerId !== id) return; next = Math.max(300, Math.min(maximum, startWidth + startX - e.clientX)); if (!frame) frame = requestAnimationFrame(apply); };
      const cleanup = () => {
        if (frame) cancelAnimationFrame(frame);
        document.body.style.userSelect = previous;
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', abort); handle.removeEventListener('lostpointercapture', abort);
        window.removeEventListener('keydown', key);
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        cancel.current = null;
      };
      const end = (e: PointerEvent) => { if (e.pointerId !== id) return; cleanup(); onChange(next); };
      const abort = () => { cleanup(); onChange(startWidth); };
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); abort(); } };
      cancel.current = cleanup;
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', abort); handle.addEventListener('lostpointercapture', abort); window.addEventListener('keydown', key);
    }} />;
}
