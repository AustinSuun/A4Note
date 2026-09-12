import { invoke } from '@tauri-apps/api/core';
import { acquireTextDocument } from '../projects/textDocuments';
import type { TextDocumentSession } from '../../core/textDocumentSession';
export interface SummaryFile { path: string; content: string; exists: boolean }
const sessions = new Map<string, TextDocumentSession>();
const cache = new Map<string, SummaryFile>();
const staleSessions = new Set<string>();
let cacheBytes = 0;
const loading = new Map<string, Promise<SummaryFile>>();
const listeners = new Set<(paperId: string) => void>();
let active = 0;
const waiters: Array<() => void> = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>(resolve => waiters.push(resolve));
  else active++;
  try { return await work(); } finally { const next = waiters.shift(); if (next) next(); else active--; }
}
function remember(id: string, value: SummaryFile) {
  cacheBytes -= (cache.get(id)?.content.length ?? 0) * 2;
  cache.delete(id); cache.set(id, value); cacheBytes += value.content.length * 2;
  while (cache.size > 128 || cacheBytes > 8 * 1024 * 1024) { const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.content.length * 2; cache.delete(oldest); }
}
export function onSummaryChange(listener: (paperId: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function loadSummary(paperId: string, refresh = false): Promise<SummaryFile> {
  refresh ||= staleSessions.has(paperId);
  if (!refresh && sessions.has(paperId)) {
    const s = sessions.get(paperId)!.getSnapshot(); return { path: s.path, content: s.content, exists: true };
  }
  const current = cache.get(paperId);
  if (!refresh && current) { remember(paperId, current); return current; }
  const running = loading.get(paperId); if (running) return running;
  const baseline = sessions.get(paperId)?.getSnapshot().baseline;
  const promise = limited(() => invoke<SummaryFile>('read_paper_summary', { paperId })).then(file => {
    const session = sessions.get(paperId);
    staleSessions.delete(paperId);
    if (session && !session.pending() && session.getSnapshot().baseline === baseline) session.reload(file.content);
    const result = session ? { ...file, content: session.getSnapshot().content } : file;
    remember(paperId, result); return result;
  }).finally(() => loading.delete(paperId));
  loading.set(paperId, promise); return promise;
}
export function invalidateSummaryPreviews() { cache.clear(); cacheBytes = 0; sessions.forEach((_session, id) => staleSessions.add(id)); }
export async function editSummary(paperId: string): Promise<TextDocumentSession> {
  const file = await invoke<SummaryFile>('ensure_paper_summary', { paperId });
  const session = await acquireTextDocument(file.path, {
    read: () => invoke<SummaryFile>('read_paper_summary', { paperId }).then(result => { if (!result.exists) throw new Error('总结文件已删除，请重新打开。'); return result.content; }),
    write: (path, content, expected) => {
      if (path !== file.path) return Promise.reject(new Error('总结路径发生变化，请导出草稿后重新打开总结。'));
      return invoke<void>('save_paper_summary', { paperId, content, expectedContent: expected });
    },
  });
  if (!sessions.has(paperId)) session.subscribe(() => { const snapshot = session.getSnapshot(); remember(paperId, { path: snapshot.path, content: snapshot.content, exists: true }); listeners.forEach(listener => listener(paperId)); });
  sessions.set(paperId, session); return session;
}
export async function reloadSummary(session: TextDocumentSession, paperId: string) {
  await session.settle(); const before = session.getSnapshot().content;
  const file = await invoke<SummaryFile>('read_paper_summary', { paperId });
  if (!file.exists) throw new Error('总结文件已删除。请先导出草稿，不会自动重建。');
  if (session.getSnapshot().content !== before) throw new Error('加载期间产生了新编辑，已保留草稿。');
  session.reload(file.content);
}
export async function summaryLayoutSession(): Promise<TextDocumentSession> {
  const file = await invoke<SummaryFile>('read_summary_layout');
  return acquireTextDocument(file.path, {
    read: () => invoke<SummaryFile>('read_summary_layout').then(value => value.content),
    write: (_path, content, expected) => invoke<void>('save_summary_layout', { content, expectedContent: expected }),
  });
}
export async function uploadSummaryImage(paperId: string, file: File): Promise<string> {
  if (file.size > 3 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择3MB以内的PNG、JPEG或WebP图片');
  const bitmap = await createImageBitmap(file);
  const pixels = bitmap.width * bitmap.height; bitmap.close();
  if (pixels > 16_000_000) throw new Error('图片尺寸过大，请先缩小到1600万像素以内');
  return invoke<string>('import_summary_image', { paperId, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
}
export async function summaryImage(paperId: string, name: string): Promise<Blob> {
  const bytes = await limited(() => invoke<number[]>('read_summary_image', { paperId, name }));
  const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return new Blob([new Uint8Array(bytes)], { type });
}
export function revealSummaryPath(path: string): Promise<void> { return invoke<void>('reveal_path', { request: { path } }); }
export function openSummaryUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('仅允许打开HTTP/HTTPS链接'));
  return invoke<void>('open_external_url', { request: { path: url } });
}
