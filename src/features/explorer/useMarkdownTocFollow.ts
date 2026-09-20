import { useEffect, useRef, type RefObject } from 'react';

export function headingAtLine<T extends { id: string; lineNumber: number }>(headings: readonly T[], line: number | null, fallback: string | null) {
  if (line == null) return fallback;
  let id = fallback;
  for (const heading of headings) {
    if (heading.lineNumber > line) break;
    id = heading.id;
  }
  return id;
}

export function localScrollTop(scroller: HTMLElement, targetY: number, margin = 56) {
  const rect = scroller.getBoundingClientRect();
  const scale = rect.height / (scroller.offsetHeight || rect.height || 1);
  return Math.max(0, scroller.scrollTop + (targetY - rect.top) / (scale || 1) - margin);
}

export function tocScrollBehavior(win: Window): ScrollBehavior {
  return win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

type Options = {
  enabled: boolean;
  sessionKey: string;
  scrollerRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  resolveActive: (anchorY: number) => string | null;
  onActive: (id: string | null) => void;
};

/** Scroll only the list itself. Never call row.scrollIntoView, which can move
 * ancestor document panes. The directory is navigation, not editor content. */
export function installTocFollow(scroller: HTMLElement, list: HTMLElement, resolveActive: Options['resolveActive'], onActive: Options['onActive']) {
  const win = scroller.ownerDocument.defaultView!;
  let frame = 0;
  let holdUntil = 0;
  let manualUntil = 0;
  let lastId: string | null = null;
  const now = () => win.performance.now();
  const centerIfHidden = (id: string | null) => {
    if (!id || now() < manualUntil) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-toc-heading-id]')).find(node => node.dataset.tocHeadingId === id);
    if (!row || !row.getClientRects().length) return;
    const viewport = list.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const scale = viewport.height / (list.offsetHeight || viewport.height || 1);
    if (bounds.top >= viewport.top + 8 * scale && bounds.bottom <= viewport.bottom - 8 * scale) return;
    list.scrollTo({ top: Math.max(0, list.scrollTop + ((bounds.top + bounds.bottom - viewport.top - viewport.bottom) / 2) / (scale || 1)), behavior: tocScrollBehavior(win) });
  };
  const sync = () => {
    frame = 0;
    if (!scroller.getClientRects().length || !list.getClientRects().length) return;
    list.style.setProperty('--markdown-toc-end-space', `${Math.ceil(list.clientHeight / 2)}px`);
    if (now() < holdUntil) return;
    const rect = scroller.getBoundingClientRect();
    const scale = rect.height / (scroller.offsetHeight || rect.height || 1);
    // Use the upper reading band rather than waiting for a heading to leave
    // the top edge. At the actual end, include the final short section too.
    const atEnd = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    const anchorY = rect.top + (atEnd ? scroller.clientHeight - 1 : scroller.clientHeight * .35) * (scale || 1);
    const id = resolveActive(anchorY);
    if (id !== lastId) { lastId = id; onActive(id); }
    centerIfHidden(id);
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(sync); };
  const manualList = () => { manualUntil = now() + 2000; };
  const interrupt = () => { holdUntil = 0; schedule(); };
  const interruptKey = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt();
  };
  scroller.addEventListener('scroll', schedule, { capture: true, passive: true });
  scroller.addEventListener('wheel', interrupt, { passive: true });
  scroller.addEventListener('touchstart', interrupt, { passive: true });
  scroller.addEventListener('keydown', interruptKey);
  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.addEventListener(type, manualList, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(list); resize.observe(scroller);
  for (const child of Array.from(scroller.children)) resize.observe(child);
  const mutations = new MutationObserver(schedule);
  mutations.observe(scroller, { childList: true, subtree: true, characterData: true });
  win.addEventListener('resize', schedule);
  schedule();
  return {
    navigate(id: string) {
      // Keep the clicked heading selected while the body passes other headings.
      holdUntil = now() + 1200;
      manualUntil = 0;
      lastId = id;
      onActive(id);
      centerIfHidden(id);
    },
    destroy() {
      win.cancelAnimationFrame(frame);
      resize.disconnect(); mutations.disconnect();
      scroller.removeEventListener('scroll', schedule, true);
      scroller.removeEventListener('wheel', interrupt);
      scroller.removeEventListener('touchstart', interrupt);
      scroller.removeEventListener('keydown', interruptKey);
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.removeEventListener(type, manualList);
      win.removeEventListener('resize', schedule);
      list.style.removeProperty('--markdown-toc-end-space');
    },
  };
}

export function useMarkdownTocFollow(options: Options) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<ReturnType<typeof installTocFollow> | null>(null);
  useEffect(() => {
    const { scrollerRef, listRef } = latest.current;
    if (!options.enabled || !scrollerRef.current || !listRef.current) return;
    const instance = installTocFollow(scrollerRef.current, listRef.current,
      y => latest.current.resolveActive(y), id => latest.current.onActive(id));
    controller.current = instance;
    return () => { instance.destroy(); if (controller.current === instance) controller.current = null; };
  }, [options.enabled, options.sessionKey]);
  return (id: string) => controller.current?.navigate(id);
}
