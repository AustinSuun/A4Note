import { useEffect, type RefObject } from 'react';
import { NOTE_WORKBENCH_COMMANDS } from './noteWorkbench';
/* Single reader key listener. Every binding dispatches a shared registry command id so
   the scoped shortcut resolver can take over without a second listener being added. */
export function useReaderWritingShortcuts(root: RefObject<HTMLDivElement | null>, runCommand: (command: string) => void) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const element = root.current;
      if (!element || !element.getClientRects().length || event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
      if (getComputedStyle(element).visibility !== 'visible' || element.closest('[inert], [aria-hidden="true"]')) return;
      // Never intercept modal authoring/consent or browser/OS combinations.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const command =
        key === 'n' ? NOTE_WORKBENCH_COMMANDS.toggle
        : key === 'q' ? NOTE_WORKBENCH_COMMANDS.quickCapture
        : event.key === 'Enter' ? NOTE_WORKBENCH_COMMANDS.focus
        : key === '2' ? NOTE_WORKBENCH_COMMANDS.split
        : key === '3' ? NOTE_WORKBENCH_COMMANDS.focus
        : key === '4' ? NOTE_WORKBENCH_COMMANDS.floating
        : key === 'p' ? NOTE_WORKBENCH_COMMANDS.pdfFocus
        : null;
      if (!command) return;
      event.preventDefault();
      runCommand(command);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [root, runCommand]);
}
