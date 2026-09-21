import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampFloatingRect,
  clampSplitRatio,
  loadNoteWorkbenchPrefs,
  resolveNoteWorkbenchMode,
  saveNoteWorkbenchPrefs,
  type FloatingCardRect,
  type NoteWorkbenchMode,
  type NoteWorkbenchPrefs,
} from './noteWorkbench';

/** Per-paper note workbench state: mode, split ratio and floating card geometry.
    Preferences are stored per paper, so switching papers never carries geometry over. */
export function useNoteWorkbench(paperId: string, available: number) {
  const [prefs, setPrefs] = useState<NoteWorkbenchPrefs>(() => loadNoteWorkbenchPrefs(paperId));
  const loadedFor = useRef(paperId);

  useEffect(() => {
    if (loadedFor.current === paperId) return;
    loadedFor.current = paperId;
    setPrefs(loadNoteWorkbenchPrefs(paperId));
  }, [paperId]);

  useEffect(() => {
    saveNoteWorkbenchPrefs(paperId, prefs);
  }, [paperId, prefs]);

  const resolved = useMemo(() => resolveNoteWorkbenchMode(prefs, available), [prefs, available]);

  const setMode = useCallback((mode: NoteWorkbenchMode) => {
    setPrefs((current) => ({
      ...current,
      mode,
      /* leaving a wide mode restores where the reader came from; choosing one remembers it */
      previousMode: current.mode === mode ? current.previousMode : current.mode,
      wideMode: mode === 'split' || mode === 'writing' ? mode : current.wideMode,
    }));
  }, []);

  /** Escape / 收起: back to the mode in use before the current one, keeping the wide preference. */
  const restoreMode = useCallback(() => {
    setPrefs((current) => {
      const target = current.previousMode === current.mode || current.previousMode === 'writing' ? 'split' : current.previousMode;
      return { ...current, mode: target, previousMode: current.mode === 'reading' ? current.previousMode : current.mode };
    });
  }, []);

  const setActiveNote = useCallback((noteId: string | null) => {
    setPrefs((current) => (current.activeNoteId === noteId ? current : { ...current, activeNoteId: noteId }));
  }, []);

  const setSplitRatio = useCallback((ratio: number) => {
    setPrefs((current) => (current.splitRatio === clampSplitRatio(ratio) ? current : { ...current, splitRatio: clampSplitRatio(ratio) }));
  }, []);

  const setFloatingRect = useCallback((rect: FloatingCardRect) => {
    setPrefs((current) => ({ ...current, floating: clampFloatingRect(rect) }));
  }, []);

  return {
    prefs,
    mode: resolved.mode,
    requestedMode: resolved.requested,
    temporary: resolved.temporary,
    setMode,
    restoreMode,
    setActiveNote,
    setSplitRatio,
    setFloatingRect,
  };
}
