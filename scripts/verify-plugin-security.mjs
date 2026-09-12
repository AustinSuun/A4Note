import assert from 'node:assert/strict';
import { createPluginCatalog, setPluginEnabled, upsertPluginCatalogEntry } from '../src/core/pluginCatalog.ts';
import { defaultPluginSecurityPolicy, pluginTrust, revokeSigner, rotateTrustedKey, verifyPluginIntegrity, verifyPluginPackage } from '../src/core/pluginSecurity.ts';
import { fetchPluginMarketIndex, loadPluginMarketCache, mergeMarketIndex, parsePluginMarketIndex, savePluginMarketCache } from '../src/core/pluginMarket.ts';
import { parsePluginPackageEnvelope } from '../src/core/pluginImport.ts';
import { parsePluginManifest } from '../src/core/types.ts';

const builtin = parsePluginManifest({ id: 'sample.plugin', name: 'Sample', version: '1.0.0', distribution: 'builtin', permissions: ['commands'] });
assert.equal(pluginTrust(builtin), 'builtin');
const digest = await (await import('node:crypto')).webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('package'));
const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
const local = { ...builtin, id: 'local.plugin', distribution: 'local', integritySha256: hash, signature: 'detached-signature', signer: 'dev-key' };
assert.equal(pluginTrust(local, { ...defaultPluginSecurityPolicy, trustedSigners: new Set(['dev-key']) }), 'trusted');
assert.equal(await verifyPluginIntegrity('package', hash), true);
assert.equal(await verifyPluginIntegrity('tampered', hash), false);
const packageEnvelope = parsePluginPackageEnvelope({
  schema: 1,
  manifest: { ...local, integritySha256: hash, distribution: 'local' },
  payload: 'package',
});
assert.equal(packageEnvelope.manifest.id, 'local.plugin');
assert.equal(packageEnvelope.payload, 'package');
assert.throws(() => parsePluginPackageEnvelope({ schema: 1, manifest: builtin, payload: 'package' }), /只能导入/);
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const signatureBytes = new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keyPair.privateKey, new TextEncoder().encode('package')));
const signature = Buffer.from(signatureBytes).toString('base64');
const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
assert.equal(await verifyPluginPackage('package', local, { ...defaultPluginSecurityPolicy, trustedSigners: new Set(['dev-key']), trustedKeys: new Map([['dev-key', publicKey]]) }), false);
assert.equal(await verifyPluginPackage('package', { ...local, signature }, { ...defaultPluginSecurityPolicy, trustedSigners: new Set(['dev-key']), trustedKeys: new Map([['dev-key', publicKey]]) }), true);
const rotated = rotateTrustedKey(defaultPluginSecurityPolicy, 'dev-key', publicKey);
assert.equal(pluginTrust(local, rotated), 'trusted');
assert.equal(pluginTrust(local, revokeSigner(rotated, 'dev-key')), 'blocked');
const marketIndex = parsePluginMarketIndex({ schema: 1, generatedAt: '2026-08-15T00:00:00Z', records: [{ id: 'market.demo', name: 'Demo', version: '1.0.0', description: 'demo', packageUrl: 'https://example.invalid/demo.zip', integritySha256: hash, signature: 'sig', signer: 'dev-key', permissions: ['commands'] }] });
assert.equal(mergeMarketIndex({ entries: [] }, marketIndex).entries[0].source, 'market');
const fetched = await fetchPluginMarketIndex('https://market.invalid/index.json', async () => new Response(JSON.stringify(marketIndex), { status: 200 }));
assert.equal(fetched.records.length, 1);
const storage = new Map();
const storageApi = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
savePluginMarketCache({ url: 'https://market.invalid/index.json', fetchedAt: '2026-08-15T00:00:00Z', index: marketIndex }, storageApi);
assert.equal(loadPluginMarketCache(storageApi).index.records[0].id, 'market.demo');
const catalog = createPluginCatalog([{ id: 'local.plugin', name: 'Local', version: '1.0.0', description: '', source: 'local', trust: 'trusted', permissions: ['commands'], enabled: false }]);
const enabled = setPluginEnabled(catalog, 'local.plugin', true);
assert.equal(enabled.entries[0].enabled, true);
assert.equal(setPluginEnabled({ entries: [{ ...enabled.entries[0], trust: 'blocked' }] }, 'local.plugin', false).entries[0].enabled, true);
assert.equal(upsertPluginCatalogEntry(enabled, { ...enabled.entries[0], version: '1.1.0' }).entries[0].version, '1.1.0');
console.log('verify-plugin-security: ok');
