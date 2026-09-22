import { useShortcutCommands, useShortcutContext, useShortcuts } from '../../shared/shortcuts';
import { createAppShortcutCommands, type AppShortcutOptions } from './appShortcutCommands';
export function useAppShortcuts(activeScene: string, modalOpen: boolean, options: AppShortcutOptions) {
  useShortcutContext(activeScene, modalOpen);
  useShortcutCommands(createAppShortcutCommands(options));
  return useShortcuts();
}
