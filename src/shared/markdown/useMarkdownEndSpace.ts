import { useCallback, type RefCallback, type RefObject } from 'react';
import { observeMarkdownEndSpace } from './markdownScrollSpace';

/** React 19 callback-ref cleanup also handles edit/read switches and hidden tab remounts. */
export function useMarkdownEndSpace<T extends HTMLElement>(existing?: RefObject<T | null>): RefCallback<T> {
  return useCallback((node: T | null) => {
    if (existing) existing.current = node;
    if (!node) return;
    const dispose = observeMarkdownEndSpace(node);
    return () => {
      dispose();
      if (existing?.current === node) existing.current = null;
    };
  }, [existing]);
}
