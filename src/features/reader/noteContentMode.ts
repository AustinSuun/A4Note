import { useEffect, useRef, useState } from 'react';

export type NoteContentMode = 'edit' | 'read';

/** Content mode of the reader note surface: live edit vs rendered reading.

    Every open starts in live edit. A fresh mount already defaults to 'edit',
    and a retained panel that becomes active again resets to 'edit', so a
    manual switch to reading only lasts for the current open. The layout
    workbench (split / floating / writing / reading) never touches this
    state; read-only, conflict and draft-safety rules live in the session. */
export function useNoteContentMode(active: boolean): [NoteContentMode, (mode: NoteContentMode) => void] {
  const [mode, setMode] = useState<NoteContentMode>('edit');
  const wasActive = useRef(active);
  useEffect(() => {
    const previouslyActive = wasActive.current;
    wasActive.current = active;
    if (active && !previouslyActive) setMode('edit');
  }, [active]);
  return [mode, setMode];
}
