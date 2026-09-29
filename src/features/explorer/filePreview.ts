/**
 * What a generic file tab can show for a path, and the limits and security
 * settings used for it. Pure: no DOM, so it is unit-tested directly.
 */

export type FilePreviewKind = 'image' | 'html' | 'text';

/** Same ceiling as Markdown's local images (`noteImageLoader`). */
export const IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
/** Rendered HTML reads the whole file; above this the tab stays in source view. */
export const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const htmlExtensions = new Set(['html', 'htm']);

export function fileExtension(path: string) {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileBaseName(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

export function filePreviewKind(path: string): FilePreviewKind {
  const extension = fileExtension(path);
  if (imageExtensions.has(extension)) return 'image';
  if (htmlExtensions.has(extension)) return 'html';
  return 'text';
}

export function isSvgPath(path: string) {
  return fileExtension(path) === 'svg';
}

/**
 * `sandbox=""` applies every restriction: no scripts, no same-origin access,
 * no forms, no popups, no top navigation. Scripts are not offered as an option.
 */
export const HTML_PREVIEW_SANDBOX = '';

/**
 * Written into the previewed document only (the app's global CSP is untouched).
 * Everything defaults to 'none'; images, styles, fonts and media may come from
 * data: URLs (inlined local images) or absolute http(s) URLs, the same remote
 * policy as Markdown images. Scripts, frames, objects, fetch/XHR and form
 * submission stay blocked even if the sandbox were loosened.
 */
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  'img-src data: http: https:',
  "style-src 'unsafe-inline' data: http: https:",
  'font-src data: http: https:',
  'media-src data: http: https:',
  "form-action 'none'",
].join('; ');

export type DecodedHtml =
  | { ok: true; text: string; encoding: string; declared: boolean }
  | { ok: false; reason: 'encoding'; declared: string | null };

/** `<meta charset>` / `http-equiv="Content-Type"` in the first 1024 bytes (HTML's prescan window). */
export function sniffHtmlCharset(bytes: Uint8Array): string | null {
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 1024); i += 1) head += String.fromCharCode(bytes[i]);
  const direct = /<meta[^>]*?\scharset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  if (direct) return direct[1].toLowerCase();
  const equiv = /<meta[^>]*?content\s*=\s*["'][^"']*charset\s*=\s*([\w.:-]+)/i.exec(head);
  return equiv ? equiv[1].toLowerCase() : null;
}

function decoderFor(label: string) {
  try { return new TextDecoder(label); } catch { return null; }
}

/**
 * BOM first, then a declared charset (so GBK/Shift_JIS pages render), then
 * strict UTF-8. An undeclared non-UTF-8 file is reported instead of being
 * shown as mojibake.
 */
export function decodeHtmlBytes(bytes: Uint8Array): DecodedHtml {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { ok: true, text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', declared: true };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { ok: true, text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', declared: true };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { ok: true, text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', declared: true };
  const declared = sniffHtmlCharset(bytes);
  const declaredDecoder = declared ? decoderFor(declared) : null;
  if (declaredDecoder) return { ok: true, text: declaredDecoder.decode(bytes), encoding: declaredDecoder.encoding, declared: true };
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', declared: false };
  } catch {
    return { ok: false, reason: 'encoding', declared };
  }
}

export type HtmlViewMode = 'preview' | 'source';
const viewModeKey = 'a4note.filePreview.htmlMode.v1';
const viewModeLimit = 200;

/** The last preview/source choice per HTML file (most recent 200 files). */
export function readHtmlViewMode(path: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): HtmlViewMode {
  try {
    const modes = JSON.parse(storage?.getItem(viewModeKey) ?? '{}') as Record<string, unknown>;
    return modes[path] === 'source' ? 'source' : 'preview';
  } catch {
    return 'preview';
  }
}

export function writeHtmlViewMode(path: string, mode: HtmlViewMode, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
  if (!storage) return;
  try {
    const modes = JSON.parse(storage.getItem(viewModeKey) ?? '{}') as Record<string, HtmlViewMode>;
    delete modes[path];
    modes[path] = mode;
    const entries = Object.entries(modes).slice(-viewModeLimit);
    storage.setItem(viewModeKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private mode / quota: the choice simply is not remembered.
  }
}

function safeStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
