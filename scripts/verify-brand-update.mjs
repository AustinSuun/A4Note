import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => fs.readFileSync(path, 'utf8');
const badge = read('src/features/settings/BrandUpdateNotice.tsx');
const menu = read('src/features/settings/BrandUpdateMenu.tsx');
assert.match(badge, /if \(!state.version\) return null/);
assert.match(badge, /current.version \|\|/);
assert.match(badge, /if \(!isTauriRuntime\(\)\) return/);
assert.match(badge, /6 \* 60 \* 60 \* 1000/);
assert.doesNotMatch(badge, /void (downloadUpdate|installUpdate)\(/);
assert.match(menu, /disabled={!confirmed \|\| busy}/);
assert.match(menu, /dialog.showModal\(\)/);
assert.match(menu, /onCancel=/);
assert.match(menu, /onMouseDown={event => event.stopPropagation\(\)}/);
assert.match(read('src/ui/App.tsx'), /brandAccessory={<BrandUpdateNotice \/>}/);
const events = [];
let downloadFails = false, saveFails = false, noUpdate = false;
const candidate = { version: '9.9.9', body: 'Test release', close: async () => {},
  download: async cb => { events.push('download'); cb({ event: 'Started', data: { contentLength: 100 } }); cb({ event: 'Progress', data: { chunkLength: 100 } }); if (downloadFails) throw Error('signature'); },
  install: async () => { events.push('install'); } };
const mocks = {
  '@tauri-apps/plugin-updater': { check: async () => noUpdate ? null : candidate },
  '@tauri-apps/api/app': { getVersion: async () => '1.0.0' },
  '../pendingSaves': { flushPendingSaves: async () => { events.push('flush'); if (saveFails) throw Error('save conflict'); } },
  '../projects': { isTauriRuntime: () => true, openExternalUrl: async url => events.push(url) },
};
const context = { exports: {}, require: name => { assert.ok(mocks[name]); return mocks[name]; }, document: { body: { inert: false } } };
vm.runInNewContext(ts.transpileModule(read('src/platform/updater/index.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const api = context.exports;
await api.checkForUpdates(); assert.equal(api.updateSnapshot().version, '9.9.9'); assert.deepEqual(events, []);
await api.installUpdate(); assert.deepEqual(events, []);
downloadFails = true; await api.downloadUpdate(); assert.equal(api.updateSnapshot().downloaded, false);
await api.installUpdate(); assert.ok(!events.includes('install'));
downloadFails = false; await api.downloadUpdate(); assert.equal(api.updateSnapshot().downloaded, true);
assert.equal(api.updateSnapshot().received, 100);
saveFails = true; await api.installUpdate(); assert.ok(!events.includes('install')); assert.equal(context.document.body.inert, false);
saveFails = false; await api.installUpdate(); assert.deepEqual(events.slice(-2), ['flush', 'install']); assert.equal(context.document.body.inert, false);
await api.openReleases(); assert.equal(events.at(-1), 'https://github.com/AustinSuun/A4Note/releases/latest');
noUpdate = true; await api.checkForUpdates(); assert.equal(api.updateSnapshot().version, undefined); assert.equal(api.updateSnapshot().phase, 'latest');
console.log('Brand update wiring assertions and mocked updater safety tests passed (no native operations).');
