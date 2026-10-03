import { invoke } from '@tauri-apps/api/core';
import { EXTERNAL_URL_REJECTED_MESSAGE, inspectExternalUrl } from '../core/externalUrl';

export { EXTERNAL_URL_REJECTED_MESSAGE, externalUrlRejectionMessage, inspectExternalUrl, isAllowedExternalUrl } from '../core/externalUrl';
export type { ExternalUrlVerdict } from '../core/externalUrl';

/**
 * The only door out of the app for a URL. Summary links and PDF link annotations both call this, so
 * the http(s) whitelist (core/externalUrl.ts) is applied once, in front of the `open_external_url` IPC.
 */
export function openExternalUrl(url: string): Promise<void> {
  const verdict = inspectExternalUrl(url);
  if (!verdict.ok) return Promise.reject(new Error(EXTERNAL_URL_REJECTED_MESSAGE));
  return invoke<void>('open_external_url', { request: { path: verdict.url } });
}
