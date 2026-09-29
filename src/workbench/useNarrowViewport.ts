import { useEffect, useState } from 'react';
import { WORKBENCH_SIDEBAR_NARROW_QUERY } from './sidebarVisibility';

function matchesNow(query: string) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/**
 * Tracks the workbench narrow breakpoint with the same media-query engine CSS
 * uses, so the result follows window resizes *and* the root `zoom` used for
 * UI scaling (App.tsx writes `documentElement.style.zoom`). `matchMedia`
 * change events are not guaranteed to fire for a style-attribute zoom change,
 * so the root style attribute is observed as well.
 */
export function useNarrowViewport(query: string = WORKBENCH_SIDEBAR_NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setNarrow(window.matchMedia(query).matches);
    update();
    media.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      media.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [query]);

  return narrow;
}
