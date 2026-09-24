import { useLayoutEffect, type RefObject } from 'react';

/** A floating dock must reserve its real height and never grow over the note header. */
export function useNoteDockBounds(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const dock = ref.current, workspace = dock?.closest<HTMLElement>('.note-workspace');
    const actions = dock?.querySelector<HTMLElement>('.markdown-authoring-actions');
    if (!dock || !workspace || !actions) return;
    const header = workspace.querySelector<HTMLElement>('.note-document-header');
    const measure = () => {
      const height = Math.max(24, Math.floor((workspace.clientHeight - (header?.offsetHeight ?? 0) - 20) / 2));
      dock.style.setProperty('--note-dock-max-height', `${height}px`);
      const bottom = parseFloat(getComputedStyle(dock).bottom) || 0;
      workspace.style.setProperty('--note-dock-inset', `${actions.offsetHeight + bottom + 16}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace); observer.observe(actions); if (header) observer.observe(header);
    return () => { observer.disconnect(); workspace.style.removeProperty('--note-dock-inset'); };
  }, [ref]);
}
