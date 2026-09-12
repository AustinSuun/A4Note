import { getCurrentWindow } from '@tauri-apps/api/window';
interface PendingSave { dirty(): boolean; pending?(): boolean; flush(): Promise<void> }
const sessions = new Set<PendingSave>();
let installed = false;
let closing: Promise<void> | null = null;
export async function flushPendingSaves() {
  await Promise.all([...sessions].map((session) => session.flush()));
  if ([...sessions].some((session) => session.dirty())) throw new Error('仍有未保存的笔记或文件操作，请稍后重试。');
}
export function unregisterPendingSave(session: PendingSave) { sessions.delete(session); }
export function registerPendingSave(session: PendingSave) {
  sessions.add(session);
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeunload', (event) => {
    if ([...sessions].some((candidate) => (candidate.pending?.() ?? candidate.dirty()))) { event.preventDefault(); event.returnValue = ''; }
  });
  if ('__TAURI_INTERNALS__' in window) {
    void getCurrentWindow().onCloseRequested((event) => {
      if (![...sessions].some((candidate) => (candidate.pending?.() ?? candidate.dirty()))) return;
      event.preventDefault();
      closing ??= flushPendingSaves().then(() => getCurrentWindow().destroy())
        .catch(() => { window.alert('存在未保存或冲突的笔记，已取消关闭。请返回笔记处理保存错误或导出草稿。'); })
        .finally(() => { closing = null; });
    }).catch(() => { installed = false; });
  }
}
