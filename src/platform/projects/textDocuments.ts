import { invoke } from '@tauri-apps/api/core';
import { registerPendingSave, unregisterPendingSave } from '../pendingSaves';
import { TextDocumentSession, type TextDocumentSnapshot } from '../../core/textDocumentSession';

const sessions = new Map<string, Promise<TextDocumentSession>>();
function key(path: string) { const normalized = path.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized; }
const draftKey = (path: string) => `a4note.markdown.draft:${key(path)}`;
function persistDraft(snapshot: TextDocumentSnapshot) {
  if (snapshot.content === snapshot.baseline) localStorage.removeItem(draftKey(snapshot.path));
  else localStorage.setItem(draftKey(snapshot.path), JSON.stringify({ baseline: snapshot.baseline, content: snapshot.content }));
}
async function read(path: string) {
  const file = await invoke<{ content: string; binary: boolean }>('read_text_file', { request: { path } });
  if (file.binary) throw new Error('该文件不是可编辑的 UTF-8 文本。');
  return file.content;
}
const openSessions: TextDocumentSession[] = [];
export function acquireTextDocument(path: string, access?: { read(path: string): Promise<string>; write(path: string, content: string, expected: string): Promise<void> }): Promise<TextDocumentSession> {
  const readFile = access?.read ?? read;
  const write = access?.write ?? ((filePath: string, content: string, expected: string) => invoke<void>('write_text_file', { request: { path: filePath, content, expected_content: expected } }));
  const existing = sessions.get(key(path));
  if (existing) return existing.then(async (session) => {
    if (access) session.setWriter(write);
    if (!session.pending()) {
      const baseline = session.getSnapshot().baseline;
      const disk = await readFile(session.getSnapshot().path);
      if (!session.pending() && session.getSnapshot().baseline === baseline && disk !== baseline) session.reload(disk);
    }
    return session;
  });
  const loading = readFile(path).then((baseline) => {
    let draft: { baseline: string; content: string } | undefined;
    try { const value = JSON.parse(localStorage.getItem(draftKey(path)) ?? 'null'); if (typeof value?.baseline === 'string' && typeof value?.content === 'string') draft = value; } catch { /* no recovery cache */ }
    const session = new TextDocumentSession(path, baseline, {
      write,
      draft: persistDraft,
    }, draft?.content);
    if (draft && draft.content !== baseline) {
      session.fail(draft.baseline === baseline ? '已恢复未保存的本地草稿，请检查后点击重试保存。' : '已恢复本地草稿，但磁盘文件也发生过修改。请先导出草稿，再重新加载磁盘版本进行合并。');
      if (draft.baseline !== baseline) {
        // Keep the original expected version so Retry cannot overwrite external changes.
        const recovered = new TextDocumentSession(path, draft.baseline, { write, draft: persistDraft }, draft.content);
        recovered.fail(session.getSnapshot().error); openSessions.push(recovered); registerPendingSave(recovered); return recovered;
      }
    }
    openSessions.push(session); registerPendingSave(session);
    return session;
  }).catch((error) => { sessions.delete(key(path)); throw error; });
  sessions.set(key(path), loading);
  return loading;
}
export async function reloadTextDocument(session: TextDocumentSession) {
  await session.settle();
  const content = session.getSnapshot().content;
  const disk = await read(session.getSnapshot().path);
  if (session.getSnapshot().content !== content) throw new Error('重新加载期间产生了新编辑，已保留草稿，请稍后重试。');
  session.reload(disk);
}

/** File tree rename/move/delete must settle pending writes before changing paths. */
let mutationQueue: Promise<unknown> = Promise.resolve();
export function mutateTextDocumentPath<T>(source: string, operation: () => Promise<T>, destination: (result: T) => string | null): Promise<T> {
  const result = mutationQueue.then(() => performMutation(source, operation, destination));
  mutationQueue = result.catch(() => {});
  return result;
}
async function performMutation<T>(source: string, operation: () => Promise<T>, destination: (result: T) => string | null): Promise<T> {
  await Promise.allSettled(sessions.values());
  const root = key(source);
  const affected = openSessions.filter((session) => { const path = key(session.getSnapshot().path); return path === root || path.startsWith(root + '/'); });
  try {
    for (const session of affected) await session.pause();
    const result = await operation();
    const nextRoot = destination(result);
    for (const session of affected) {
      const oldPath = session.getSnapshot().path;
      sessions.delete(key(oldPath));
      if (nextRoot !== null) {
        const suffix = oldPath.replace(/\\/g, '/').slice(source.replace(/\\/g, '/').replace(/\/+$/, '').length);
        const nextPath = nextRoot + suffix;
        session.resume(nextPath);
        sessions.set(key(nextPath), Promise.resolve(session));
        try {
          persistDraft(session.getSnapshot());
          if (key(oldPath) !== key(nextPath)) localStorage.removeItem(draftKey(oldPath));
        } catch { session.fail('文件已移动，但草稿缓存不可用，请保持窗口打开并完成保存。'); }
      } else {
        // Deletion is explicit; retain any edits that arrived while the delete was running.
        session.resume();
        if (session.dirty()) session.fail('文件已删除，新增内容仍保留在本地草稿中。');
        else { openSessions.splice(openSessions.indexOf(session), 1); unregisterPendingSave(session); }
      }
    }
    return result;
  } finally { affected.forEach((session) => session.resume()); }
}
