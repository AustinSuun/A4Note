import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import type { DragDraft } from './types';

/** Keep the live draft synchronous: Escape followed immediately by mouseup must not save a stale render. */
export function usePdfShapeDraft(documentKey: string, tool: string) {
  const [draft, renderDraft] = useState<DragDraft | null>(null);
  const current = useRef<DragDraft | null>(null);
  const setDraft = useCallback((next: SetStateAction<DragDraft | null>) => {
    const value = typeof next === 'function' ? next(current.current) : next;
    current.current = value;
    renderDraft(value);
  }, []);
  const cancel = useCallback(() => {
    if (!current.current) return false;
    setDraft(null);
    return true;
  }, [setDraft]);
  const takeDraft = useCallback(() => {
    const value = current.current;
    if (value) setDraft(null);
    return value;
  }, [setDraft]);

  // A draft belongs to one document/tool. Never apply it to the next active resource.
  useLayoutEffect(() => { cancel(); }, [documentKey, tool, cancel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      // Inline annotation editors and other input widgets own their Escape behavior.
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return;
      if (cancel()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', cancel);
      current.current = null;
    };
  }, [cancel]);
  return { draft, setDraft, takeDraft };
}
