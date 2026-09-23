import { useLayoutEffect, useRef, useState } from 'react';
import type { NoteWorkbenchMode } from './noteWorkbench';

export const NOTE_PANEL_MOTION_MS = 220;

export type NotePanelPresencePhase = 'hidden' | 'entering' | 'entered' | 'exiting';

export type NotePanelPresence = {
  phase: NotePanelPresencePhase;
  mode: Exclude<NoteWorkbenchMode, 'reading'>;
};

const visualMode = (mode: NoteWorkbenchMode): NotePanelPresence['mode'] => mode === 'reading' ? 'split' : mode;

/** Retains the last visible note layout long enough for a compositor-only exit.
 *  It also gives every mode change a fresh enter phase without unmounting the editor. */
export function useNotePanelPresence(visible: boolean, mode: NoteWorkbenchMode): NotePanelPresence {
  const generation = useRef(0);
  const [presence, setPresence] = useState<NotePanelPresence>(() => ({
    phase: visible ? 'entered' : 'hidden',
    mode: visualMode(mode),
  }));

  useLayoutEffect(() => {
    const currentGeneration = ++generation.current;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;
    let timer = 0;

    if (visible) {
      const nextMode = visualMode(mode);
      setPresence({ phase: reducedMotion ? 'entered' : 'entering', mode: nextMode });
      if (!reducedMotion) {
        frame = window.requestAnimationFrame(() => {
          if (generation.current !== currentGeneration) return;
          setPresence(current => current.mode === nextMode ? { ...current, phase: 'entered' } : current);
        });
      }
    } else {
      setPresence(current => current.phase === 'hidden'
        ? current
        : { ...current, phase: reducedMotion ? 'hidden' : 'exiting' });
      if (!reducedMotion) {
        timer = window.setTimeout(() => {
          if (generation.current !== currentGeneration) return;
          setPresence(current => ({ ...current, phase: 'hidden' }));
        }, NOTE_PANEL_MOTION_MS);
      }
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [visible, mode]);

  return presence;
}
