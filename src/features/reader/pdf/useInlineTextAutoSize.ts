import { useLayoutEffect, useRef } from 'react';
import type { InlineTextEditor } from './types';

export function nextInlineTextHeight(client: number, scroll: number, page: number, current: number): number | null {
  if (![client, scroll, page, current].every(Number.isFinite) || page <= 0 || client < 0 || scroll <= client + 1) return null;
  const next = (scroll + 2) / page * 100;
  return next > current + 0.05 ? next : null;
}

/** Recheck wrapping after width/font/zoom changes, not only after an input event.
 * All measurements use layout CSS pixels: getBoundingClientRect includes CSS
 * zoom while scrollHeight does not, which otherwise underestimates at125% UI.
 * Only grow the edit draft; never rewrite saved geometry on viewing/cancelling.
 */
export function useInlineTextAutoSize(editor: InlineTextEditor | null, onResize: (height: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const measure = () => {
    if (!editor || !ref.current) return;
    const textarea = ref.current.querySelector<HTMLTextAreaElement>('.inline-text-editor');
    const page = ref.current.closest<HTMLElement>('.pdf-page');
    if (!textarea || !page) return;
    const height = nextInlineTextHeight(textarea.clientHeight, textarea.scrollHeight, page.clientHeight, Number(editor.positionJson.height ?? 0));
    if (height !== null) onResize(height);
  };
  useLayoutEffect(() => {
    if (!editor || !ref.current) return;
    const textarea = ref.current.querySelector<HTMLTextAreaElement>('.inline-text-editor');
    const page = ref.current.closest<HTMLElement>('.pdf-page');
    if (!textarea || !page) return;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const observer = new ResizeObserver(schedule);
    observer.observe(textarea);
    observer.observe(page);
    measure();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [editor, onResize]);
  // Children report scrollHeight+2 even when text fits. Ignore that proposed
  // value and check real overflow, avoiding 2px inflation on every keystroke.
  return { ref, measure };
}
