import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flipTransform, type FlipBox } from './noteEnterMotion';
import type { NoteWorkbenchMode } from './noteWorkbench';

const measure = (element: HTMLElement): FlipBox => {
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
};

/** Keeps a note-panel mode switch continuous. While the panel stays visible and only its
 *  layout changes (docked column ⇄ floating card ⇄ writing sheet) the drawer is painted for
 *  one frame at its previous box via a FLIP transform, then released so the shared
 *  transform transition carries it to the new box. Fresh entrances and exits are left to the
 *  presence CSS; reduced motion skips the trick entirely.
 *  `geometryKey` must change whenever the panel box can change without a mode change (card
 *  drags/resizes, column width, container size) so the remembered box stays current. */
export function useNoteLayoutFlip(
  containerRef: RefObject<HTMLElement | null>,
  mode: NoteWorkbenchMode,
  visible: boolean,
  geometryKey: string,
) {
  const lastBox = useRef<FlipBox | null>(null);
  const lastMode = useRef<NoteWorkbenchMode>(mode);
  useLayoutEffect(() => {
    const shell = containerRef.current;
    const drawer = shell?.querySelector<HTMLElement>(':scope > .reader-workspace-drawer');
    const previousMode = lastMode.current;
    lastMode.current = mode;
    if (!shell || !drawer || !visible || mode === 'reading') { lastBox.current = null; return; }
    const box = measure(drawer);
    const first = lastBox.current;
    lastBox.current = box;
    if (!first || previousMode === mode || previousMode === 'reading') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const transform = flipTransform(first, box);
    if (!transform) return;
    const controls = shell.querySelector<HTMLElement>(':scope > .reader-note-floating-controls');
    const targets = [drawer, controls].filter((element): element is HTMLElement => Boolean(element));
    shell.dataset.noteFlip = 'true';
    for (const element of targets) { element.style.transformOrigin = '0 0'; element.style.transform = transform; }
    void drawer.offsetWidth;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        delete shell.dataset.noteFlip;
        for (const element of targets) { element.style.transform = ''; element.style.transformOrigin = ''; }
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      delete shell.dataset.noteFlip;
      for (const element of targets) { element.style.transform = ''; element.style.transformOrigin = ''; }
    };
  }, [containerRef, mode, visible, geometryKey]);
}
