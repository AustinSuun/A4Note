import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';

/** One pointer transaction for the separator and the bookmark. Values are layout
 * pixels; client deltas are normalized for CSS UI zoom. Pointerup flushes the
 * final sample even when it precedes the next animation frame. */
export function useReaderDrawerGesture(options: {
  resize?: { width: number; maximum: number; onChange: (width: number) => void };
  onLongPress?: () => void;
}) {
  const latest = useRef(options); latest.current = options;
  const cancel = useRef<(() => void) | null>(null);
  const suppressed = useRef(false);
  useEffect(() => () => cancel.current?.(), []);
  return {
    consumeClick: () => suppressed.current,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      cancel.current?.(); suppressed.current = false;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      const handle = event.currentTarget, id = event.pointerId;
      const x = event.clientX, y = event.clientY, resize = latest.current.resize;
      const shell = handle.closest<HTMLElement>('.reader-workspace-shell');
      const scale = shell && shell.offsetWidth ? shell.getBoundingClientRect().width / shell.offsetWidth : 1;
      let frame = 0, moved = false, longPressed = false, ended = false, next = resize?.width ?? 0;
      const previousSelect = document.body.style.userSelect;
      let timer = latest.current.onLongPress ? window.setTimeout(() => {
        timer = 0; longPressed = true; suppressed.current = true; latest.current.onLongPress?.();
      }, 400) : 0;
      const clearTimer = () => { if (timer) clearTimeout(timer); timer = 0; };
      const value = (clientX: number) => Math.max(300, Math.min(resize!.maximum, resize!.width + (x - clientX) / scale));
      const apply = () => { frame = 0; if (resize) latest.current.resize?.onChange(next); };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== id || ended || longPressed) return;
        if (!moved && Math.hypot(e.clientX - x, e.clientY - y) >= 4) {
          moved = true; clearTimer(); suppressed.current = true;
          if (resize) { document.body.style.userSelect = 'none'; if (shell) shell.dataset.noteResizing = 'true'; }
        }
        if (!moved || !resize) return;
        next = value(e.clientX); if (!frame) frame = requestAnimationFrame(apply);
      };
      const cleanup = () => {
        ended = true; clearTimer(); if (frame) cancelAnimationFrame(frame);
        document.body.style.userSelect = previousSelect;
        if (shell) delete shell.dataset.noteResizing;
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', abort); handle.removeEventListener('lostpointercapture', abort);
        window.removeEventListener('keydown', key);
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        cancel.current = null;
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== id || ended) return;
        move(e); if (moved && resize) { next = value(e.clientX); if (frame) cancelAnimationFrame(frame); flushSync(apply); void shell?.offsetWidth; }
        cleanup();
      };
      const abort = () => { if (ended) return; suppressed.current = true; cleanup(); if (moved && resize) latest.current.resize?.onChange(resize.width); };
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); abort(); } };
      handle.setPointerCapture(id); cancel.current = cleanup;
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', abort); handle.addEventListener('lostpointercapture', abort);
      window.addEventListener('keydown', key);
    },
  };
}
