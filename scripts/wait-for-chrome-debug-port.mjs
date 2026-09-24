import { readFileSync } from 'node:fs';
import path from 'node:path';

// Chrome creates this file before releasing its Windows write handle. Presence alone
// is not readiness. Retry only absent/busy or incomplete startup data, never permissions.
export async function waitForChromeDebugPort(profile, {
  attempts = 150, intervalMs = 100, readFile = readFileSync,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('Invalid Chrome readiness retry budget');
  }
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const lines = readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
      lastError = undefined;
      const port = Number(lines[0]);
      if (/^\d+$/.test(lines[0]) && Number.isInteger(port) && port > 0 && port <= 65535
        && /^\/devtools\/browser\/[^\s]+$/.test(lines[1] ?? '')) return port;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Chrome DevToolsActivePort not readable/complete after ${attempts} attempts`, { cause: lastError });
}
