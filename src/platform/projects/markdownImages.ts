import { invoke } from '@tauri-apps/api/core';
/** Backend independently validates bytes, dimensions, document and workspace confinement. */
export async function uploadMarkdownImage(documentPath: string, file: File): Promise<string> {
  if (!documentPath) throw new Error('请先保存Markdown文档。');
  if (!file.size || file.size > 3 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择3MB以内的PNG、JPEG或WebP图片。');
  return invoke<string>('import_markdown_image', { documentPath, mime: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
}
