// Private keys and decrypted passwords never enter the repository or command logs.
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
export async function signingEnvironment() {
  const env = { ...process.env };
  if (env.TAURI_SIGNING_PRIVATE_KEY) return env; // GitHub Secrets / explicit publisher configuration.
  if (process.platform !== 'win32') throw new Error('Set TAURI_SIGNING_PRIVATE_KEY for signing.');
  const directory = path.join(homedir(), '.tauri', 'A4Note-updater');
  const key = path.join(directory, 'signing.key');
  const password = path.join(directory, 'password.dpapi');
  await access(key); await access(password);
  const command = "$s=ConvertTo-SecureString (Get-Content -Raw -LiteralPath $env:A4NOTE_SIGNING_PASSWORD_FILE); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env: { ...env, A4NOTE_SIGNING_PASSWORD_FILE: password }, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout.trim()) throw new Error('Cannot decrypt local signing password. Use the original Windows account or configure signing environment variables.');
  env.TAURI_SIGNING_PRIVATE_KEY = key;
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = result.stdout.trim();
  return env;
}
