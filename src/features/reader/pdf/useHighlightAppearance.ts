import { useMemo, useSyncExternalStore } from 'react';
import { HIGHLIGHT_APPEARANCE_KEY, normalizeHighlightAppearance, parseHighlightAppearance, type HighlightAppearance } from './pdfHighlightAppearance';

const changeEvent = 'aster:highlight-appearance';
let volatileValue: string | null = null;
let storageFailed = false;
function snapshot() {
  if (storageFailed) return volatileValue;
  try { return window.localStorage.getItem(HIGHLIGHT_APPEARANCE_KEY); }
  catch { return volatileValue; }
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === HIGHLIGHT_APPEARANCE_KEY || event.key === null) listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(changeEvent, listener); window.removeEventListener('storage', onStorage); };
}
export function useHighlightAppearance() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const appearance = useMemo(() => parseHighlightAppearance(raw), [raw]);
  const setAppearance = (next: HighlightAppearance) => {
    const value = JSON.stringify(normalizeHighlightAppearance(next));
    volatileValue = value;
    try { window.localStorage.setItem(HIGHLIGHT_APPEARANCE_KEY, value); storageFailed = false; }
    catch { storageFailed = true; }
    window.dispatchEvent(new Event(changeEvent));
  };
  return { appearance, setAppearance, storageFailed };
}
