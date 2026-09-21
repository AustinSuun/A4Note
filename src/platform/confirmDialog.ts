import { ask } from '@tauri-apps/plugin-dialog';

const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Blocking yes/no confirmation that works in the desktop build.
 *
 * The Tauri dialog plugin replaces `window.confirm` with an async stub that returns a Promise, so the
 * classic `if (!window.confirm(...)) return;` never waits and is always truthy inside A4 Note. Every
 * confirmation must await this helper instead; the browser build keeps using the native dialog.
 */
export async function confirmDialog(message: string, title = 'A4 Note'): Promise<boolean> {
  if (isDesktop()) {
    try {
      return await ask(message, { title, kind: 'warning', okLabel: '确定', cancelLabel: '取消' });
    } catch {
      return false;
    }
  }
  return window.confirm(message);
}
