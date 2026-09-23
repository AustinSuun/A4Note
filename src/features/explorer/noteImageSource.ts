import { paperImageReference } from '../../core/paperImageReference';
/** Resolve image paths without changing the Markdown destination. No arbitrary schemes/UNC. */
const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
export function directNoteImage(source: string) {
  return /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon)[;,]|blob:)/i.test(source.trim());
}
export function resolveNoteImagePath(documentPath: string, source: string): { path: string; mime: string } | null {
  let destination = source.trim().replace(/^<([\s\S]*)>$/, '$1');
  if (!destination || directNoteImage(destination)) return null;
  // URL fragments/query strings are not part of the on-disk name. Encoded #/? remain valid filename text.
  destination = destination.split(/[?#]/)[0];
  try { destination = decodeURIComponent(destination); } catch { return null; }
  destination = destination.replace(/\\([ ()])/g, '$1').replace(/\\/g, '/');
  const doc = documentPath.replace(/\\/g, '/');
  if (!doc || doc.startsWith('//') || /[\x00-\x1f]/.test(doc) || /[\x00-\x1f]/.test(destination) || destination.startsWith('//') || /^(?![a-z]:\/)[a-z][\w+.-]*:/i.test(destination)) return null;
  const mime = imageTypes[destination.split('.').pop()?.toLowerCase() ?? ''];
  if (!mime) return null;
  const base = doc.slice(0, doc.lastIndexOf('/') + 1);
  let joined = /^[a-z]:\//i.test(destination) ? destination : destination.startsWith('/') ? (/^[a-z]:/i.exec(doc)?.[0] ?? '') + destination : base + destination;
  const root = /^[a-z]:\//i.exec(joined)?.[0] ?? (joined.startsWith('/') ? '/' : '');
  if (!root) return null;
  const segments: string[] = [];
  for (const segment of joined.slice(root.length).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!segments.length) return null; segments.pop(); }
    else { if (segment.includes(':')) return null; segments.push(segment); }
  }
  joined = root + segments.join('/');
  return { path: joined, mime };
}
export function canPreviewNoteImage(documentPath: string, source: string) {
  return directNoteImage(source) || Boolean(paperImageReference(documentPath, source)) || Boolean(resolveNoteImagePath(documentPath, source));
}
