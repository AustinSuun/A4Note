import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
export const ReaderNoteLayoutActions = createContext<ReactNode>(null);
export const useReaderNoteLayoutActions = () => useContext(ReaderNoteLayoutActions);
export const ReaderNoteActivity = createContext(true);
export const ReaderNoteRequests = createContext(true);
export const useReaderNoteRequests = () => useContext(ReaderNoteRequests);
export const useReaderNoteActive = () => useContext(ReaderNoteActivity);
/** Keep CodeMirror and its undo/selection state, without allowing hidden request consumers. */
export function RetainedReaderNote({ active, children }: { active: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const scroll = useRef(new Map<HTMLElement, { top: number; left: number }>());
  const previouslyActive = useRef(false);
  useLayoutEffect(() => {
    if (active && !previouslyActive.current) {
      for (const [element, position] of scroll.current) {
        if (root.current?.contains(element)) { element.scrollTop = position.top; element.scrollLeft = position.left; }
        else scroll.current.delete(element);
      }
      if (!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
        const target = focus.current?.isConnected && root.current?.contains(focus.current) ? focus.current : root.current?.querySelector<HTMLElement>('.cm-content, textarea, .note-document-trigger, button');
        target?.focus({ preventScroll: true });
      }
    }
    previouslyActive.current = active;
  }, [active]);
  return <ReaderNoteActivity.Provider value={active}><ReaderNoteRequests.Provider value={active}>
    <div ref={root} className="reader-retained-note" hidden={!active} inert={!active} aria-hidden={!active}
      onFocusCapture={event => { if (active) focus.current = event.target as HTMLElement; }}
      onScrollCapture={event => {
        if (!active || !(event.target instanceof HTMLElement)) return;
        for (const element of scroll.current.keys()) { if (!root.current?.contains(element)) scroll.current.delete(element); }
        const element = event.target; scroll.current.set(element, { top: element.scrollTop, left: element.scrollLeft });
      }}>{children}</div>
  </ReaderNoteRequests.Provider></ReaderNoteActivity.Provider>;
}
