import type { RefObject } from 'react';
import { useShortcutCommands, elementIsVisible } from '../../shared/shortcuts';
import { NOTE_WORKBENCH_COMMAND_LIST, NOTE_WORKBENCH_COMMANDS } from './noteWorkbench';
import type { ShortcutBinding } from '../../core/shortcuts';

/** Reader tabs contribute commands; only the application dispatcher listens to keys. */
export function useReaderWritingShortcuts(root: RefObject<HTMLDivElement | null>, runCommand: (command: string) => void) {
  useShortcutCommands(NOTE_WORKBENCH_COMMAND_LIST.map((item) => {
    const parts = item.default.split('+');
    const binding: ShortcutBinding = { type: 'keyboard', key: parts.at(-1)!, ctrl: true, alt: true };
    return { id: item.id, title: item.title, group: '阅读笔记', scope: { kind: 'scene' as const, sceneId: 'reader' },
      defaultBindings: item.id === NOTE_WORKBENCH_COMMANDS.focus ? [binding, { ...binding, key: 'Enter' }] : [binding],
      allowInEditable: true,
      isVisible: () => elementIsVisible(root.current),
      isEnabled: () => elementIsVisible(root.current),
      execute: () => { if (!elementIsVisible(root.current)) return false; runCommand(item.id); },
    };
  }));
}
