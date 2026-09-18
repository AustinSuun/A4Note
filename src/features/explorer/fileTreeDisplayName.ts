type EntryLabel = { name: string; is_directory: boolean };
export type FileTreeTypeTone = 'pdf' | 'image' | 'document' | 'data' | 'media' | 'archive' | 'code' | 'other';
export interface FileTreePresentation {
  name: string;
  badge: { label: string; extension: string; tone: FileTreeTypeTone } | null;
}
const types: Record<string, FileTreeTypeTone> = {
  pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', bmp: 'image', ico: 'image', heic: 'image', tif: 'image', tiff: 'image',
  txt: 'document', doc: 'document', docx: 'document', rtf: 'document', odt: 'document', ppt: 'document', pptx: 'document', epub: 'document',
  csv: 'data', xls: 'data', xlsx: 'data', ods: 'data', json: 'data', yaml: 'data', yml: 'data', xml: 'data', sqlite: 'data', db: 'data',
  mp3: 'media', wav: 'media', flac: 'media', ogg: 'media', m4a: 'media', mp4: 'media', mov: 'media', mkv: 'media', webm: 'media', avi: 'media',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive', 'tar.gz': 'archive', 'tar.bz2': 'archive', 'tar.xz': 'archive', 'tar.zst': 'archive',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', rs: 'code', go: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', css: 'code', html: 'code', sh: 'code', sql: 'code', mdx: 'code', markdown: 'document',
};
/** Presentation only. The original entry/path remains the identity for every operation. */
export function fileTreePresentation(entry: EntryLabel): FileTreePresentation {
  if (entry.is_directory) return { name: entry.name, badge: null };
  // Timestamped backups are not Markdown notes. Keep a visible BACKUP distinction.
  const match = /\.(backup(?:[-_].+)?|tar\.(?:gz|bz2|xz|zst))$/i.exec(entry.name)
    ?? /\.([^.\\/\s]+)$/.exec(entry.name);
  if (!match || match.index === 0 || !entry.name.slice(0, match.index).trim()) {
    return { name: entry.name, badge: { label: 'FILE', extension: '', tone: 'other' } };
  }
  const extension = match[1];
  const kind = extension.toLowerCase();
  const name = entry.name.slice(0, match.index);
  if (kind === 'md') return { name, badge: null };
  const backup = /^backup(?:[-_]|$)/i.test(extension);
  return { name, badge: { label: backup ? 'BACKUP' : extension.toUpperCase(), extension, tone: Object.hasOwn(types, kind) ? types[kind] : 'other' } };
}
export function fileTreeDisplayName(entry: EntryLabel): string {
  return fileTreePresentation(entry).name;
}
