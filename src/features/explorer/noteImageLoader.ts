import { paperImageReference } from '../../core/paperImageReference';
import { summaryImage } from '../../platform/library/summaries';
import { isTauriRuntime, readFileBytes } from '../../platform/projects';
import { directNoteImage, resolveNoteImagePath } from './noteImageSource';
const pending = new Map<string, Promise<string>>();
/** Deduplicate only in-flight reads; do not retain large data URLs or stale file contents. */
export function loadNoteImage(documentPath: string, source: string): Promise<string> {
  if (directNoteImage(source)) return Promise.resolve(source.trim());
  const managed = paperImageReference(documentPath, source);
  if (managed) {
    const key = `paper:${managed.paperId}:${managed.name}`;
    const existing = pending.get(key); if (existing) return existing;
    const request = summaryImage(managed.paperId, managed.name).then(blob => blob.arrayBuffer()).then(buffer => {
      const bytes = new Uint8Array(buffer), chunks: string[] = [];
      for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
      const mime = managed.name.endsWith('.png') ? 'image/png' : managed.name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      return `data:${mime};base64,${btoa(chunks.join(''))}`;
    }).finally(() => pending.delete(key));
    pending.set(key, request); return request;
  }
  const target = resolveNoteImagePath(documentPath, source);
  if (!target) return Promise.reject(new Error('图片路径或格式不受支持'));
  if (!isTauriRuntime()) return Promise.reject(new Error('本地图片需要在桌面应用中打开'));
  const existing = pending.get(target.path);
  if (existing) return existing;
  const request = readFileBytes(target.path).then(bytes => {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('图片为空或超过20MB');
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.slice(i, i + 0x8000)));
    return `data:${target.mime};base64,${btoa(chunks.join(''))}`;
  }).finally(() => pending.delete(target.path));
  pending.set(target.path, request);
  return request;
}
