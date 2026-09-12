import type { AsterPluginManifest, PluginPermission } from './types';

export type PluginTrust = 'builtin' | 'trusted' | 'untrusted' | 'blocked';

export interface PluginSecurityPolicy {
  trustedSigners: ReadonlySet<string>;
  trustedKeys: ReadonlyMap<string, JsonWebKey>;
  revokedSigners: ReadonlySet<string>;
  allowUntrustedLocal: boolean;
  allowedPermissions: ReadonlySet<PluginPermission>;
  /** Package ids whose detached signature was verified during import. */
  verifiedPluginIds?: ReadonlySet<string>;
}

export const defaultPluginSecurityPolicy: PluginSecurityPolicy = {
  trustedSigners: new Set(),
  trustedKeys: new Map(),
  revokedSigners: new Set(),
  allowUntrustedLocal: false,
  allowedPermissions: new Set(['commands', 'events', 'settings', 'workbench', 'providers', 'resources', 'scenes']),
  verifiedPluginIds: new Set(),
};

export function pluginTrust(manifest: AsterPluginManifest, policy: PluginSecurityPolicy = defaultPluginSecurityPolicy): PluginTrust {
  if (manifest.distribution === 'builtin') return 'builtin';
  if (manifest.signer && policy.revokedSigners.has(manifest.signer)) return 'blocked';
  if (manifest.permissions.some((permission) => !policy.allowedPermissions.has(permission))) return 'blocked';
  if (!manifest.integritySha256 || !manifest.signature || !manifest.signer) return policy.allowUntrustedLocal ? 'untrusted' : 'blocked';
  if (manifest.distribution === 'local' && policy.verifiedPluginIds?.has(manifest.id)) return 'trusted';
  return policy.trustedSigners.has(manifest.signer) ? 'trusted' : 'blocked';
}

export function rotateTrustedKey(policy: PluginSecurityPolicy, signer: string, publicKey: JsonWebKey): PluginSecurityPolicy {
  const trustedKeys = new Map(policy.trustedKeys); trustedKeys.set(signer, publicKey);
  const trustedSigners = new Set(policy.trustedSigners); trustedSigners.add(signer);
  const revokedSigners = new Set(policy.revokedSigners); revokedSigners.delete(signer);
  return { ...policy, trustedKeys, trustedSigners, revokedSigners };
}

export function revokeSigner(policy: PluginSecurityPolicy, signer: string): PluginSecurityPolicy {
  const revokedSigners = new Set(policy.revokedSigners); revokedSigners.add(signer);
  return { ...policy, revokedSigners };
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyPluginIntegrity(data: string | ArrayBuffer, expectedSha256: string) {
  const expected = expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  return (await sha256Hex(data)) === expected;
}

export async function verifyPluginSignature(data: string | ArrayBuffer, signatureBase64: string, publicKey: JsonWebKey) {
  try {
    const key = await globalThis.crypto.subtle.importKey('jwk', publicKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(signatureBase64), (character) => character.charCodeAt(0));
    const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return await globalThis.crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, payload);
  } catch {
    return false;
  }
}

export async function verifyPluginPackage(data: string | ArrayBuffer, manifest: { integritySha256?: string; signature?: string; signer?: string }, policy: PluginSecurityPolicy = defaultPluginSecurityPolicy) {
  if (!manifest.integritySha256 || !manifest.signature || !manifest.signer || policy.revokedSigners.has(manifest.signer) || !policy.trustedSigners.has(manifest.signer)) return false;
  const key = policy.trustedKeys.get(manifest.signer);
  if (!key || !(await verifyPluginIntegrity(data, manifest.integritySha256))) return false;
  return verifyPluginSignature(data, manifest.signature, key);
}
