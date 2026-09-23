import { useEffect, useRef } from 'react';
import { useShortcutCommands, useShortcutContext, useShortcuts } from '../../shared/shortcuts';
import { modalIsOpen } from '../../shared/shortcuts/dispatcher';
import { createAppShortcutCommands, type AppShortcutOptions } from './appShortcutCommands';
export function useAppShortcuts(activeScene: string, modalOpen: boolean, options: AppShortcutOptions) {
  const latest = useRef(options);
  latest.current = options;
  useShortcutContext(activeScene, modalOpen);
  useShortcutCommands(createAppShortcutCommands(options));
  const store = useShortcuts();
  useEffect(() => {
    let accumulated = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.deltaY === 0) { accumulated = 0; return; }
      if (event.defaultPrevented) { accumulated = 0; return; }
      if (modalOpen || store.recording || modalIsOpen(document)) { event.preventDefault(); accumulated = 0; return; }
      const target = event.target instanceof Element ? event.target : null;
      // PdfReader owns the native, pointer-anchored Ctrl+wheel gesture. Avoid a
      // second zoom here; everywhere else the displayed gesture must still work.
      if (target?.closest('.pdf-document')) { event.preventDefault(); accumulated = 0; return; }
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      accumulated += event.deltaY * unit;
      if (Math.abs(accumulated) < 40) return;
      const delta = accumulated < 0 ? .1 : -.1;
      accumulated = 0;
      const current = latest.current;
      if (activeScene === 'reader' && current.hasPaper && current.pdfMode) current.pdfZoom(delta);
      else current.uiZoom(delta);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => window.removeEventListener('wheel', wheel);
  }, [activeScene, modalOpen, store]);
  return store;
}
