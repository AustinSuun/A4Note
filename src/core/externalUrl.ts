/**
 * URL whitelist shared by every "open in the system browser" path (card e4c2fa22): summary links,
 * PDF link annotations and future citation links all decide with this one function. Only absolute
 * http(s) URLs are allowed out; `mailto:`, `file:`, `javascript:`, `data:`, custom schemes and
 * relative strings are rejected before any native call. Pure on purpose so the verify scripts can
 * load it without a Tauri runtime.
 */
export type ExternalUrlVerdict =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: 'empty' | 'scheme' | 'malformed'; scheme: string | null };

export const EXTERNAL_URL_REJECTED_MESSAGE = '仅允许打开HTTP/HTTPS链接';

export function inspectExternalUrl(raw: string | null | undefined): ExternalUrlVerdict {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, reason: 'empty', scheme: null };
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'scheme', scheme };
  try {
    const parsed = new URL(text);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return { ok: false, reason: 'malformed', scheme };
    return { ok: true, url: text, host: parsed.hostname };
  } catch {
    return { ok: false, reason: 'malformed', scheme };
  }
}

export function isAllowedExternalUrl(raw: string | null | undefined): boolean {
  return inspectExternalUrl(raw).ok;
}

/** Human message for a rejected URL; names the scheme so a `javascript:` or `file:` link is recognisable. */
export function externalUrlRejectionMessage(verdict: Extract<ExternalUrlVerdict, { ok: false }>): string {
  if (verdict.reason === 'empty') return '链接为空，无法打开';
  if (verdict.reason === 'scheme') return verdict.scheme ? `已阻止打开非 HTTP/HTTPS 链接（${verdict.scheme}:）` : '已阻止打开非 HTTP/HTTPS 链接';
  return '链接格式无效，无法打开';
}
