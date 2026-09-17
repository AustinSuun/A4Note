import { useEffect, type RefObject } from 'react';
export function useReaderWritingShortcuts(root: RefObject<HTMLDivElement | null>, toggleNotes: () => void, toggleWriting: () => void) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const element = root.current;
      if (!element || !element.getClientRects().length || event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
      if (getComputedStyle(element).visibility !== 'visible' || element.closest('[inert], [aria-hidden="true"]')) return;
      // Never intercept modal authoring/consent or browser/OS combinations.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); toggleNotes(); }
      if (event.key === 'Enter') { event.preventDefault(); toggleWriting(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [root, toggleNotes, toggleWriting]);
}
