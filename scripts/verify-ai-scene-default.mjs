import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url), modules = new Map();
// Execute production core/seed modules without a browser, native APIs or disk repository.
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} }; modules.set(file, mod);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', source)(specifier => specifier.startsWith('.') ? load(path.resolve(path.dirname(file), specifier + '.ts')) : require(specifier), mod, mod.exports);
  return mod.exports;
}
const { createAsterCore } = load('src/core/asterCore.ts');
const { baseScenes, seedDocuments } = load('src/data/seedDocuments.ts');
const app = fs.readFileSync('src/ui/App.tsx', 'utf8');
const loader = app.slice(app.indexOf('function loadDisabledPluginIds()'), app.indexOf('function seedLibraryFolders('));
const loadDisabled = new Function('localStorage', ts.transpile(loader + '\nreturn loadDisabledPluginIds();', { target: ts.ScriptTarget.ES2022 }));
const startup = app.slice(app.indexOf('const aster = createAsterCore('), app.indexOf('/** The built-in library project'));
const start = new Function('createAsterCore', 'isTauriRuntime', 'seedDocuments', 'baseScenes', 'HttpSyncApi', 'createDesktopSyncCoordinator', 'loadLocalPlugins', 'loadDisabledPluginIds', 'parseDeclarativePluginPayloadText', ts.transpile(startup + '\nreturn { aster, disabled: [...persistedDisabledPluginIds] };', { target: ts.ScriptTarget.ES2022 }));
function storage(entries = []) {
  const map = new Map(entries);
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
function boot(store) {
  return start((docs, scenes) => createAsterCore(docs, scenes, { load: () => null, save: () => assert.fail('startup must not write documents') }), () => true, seedDocuments, baseScenes, class {}, () => ({}), () => [], () => loadDisabled(store), () => assert.fail('no imported plugin fixture'));
}
function assertAi(aster, enabled) {
  assert.equal(aster.plugins.has('ai.core'), enabled);
  assert.equal(aster.scenes.list().some(s => s.id === 'aiChat'), enabled);
  assert.equal(aster.sceneViews.list().some(s => s.id === 'ai.core.view'), enabled);
  assert.equal(aster.sceneSidebars.list().some(s => s.id === 'ai.sessions'), enabled);
  assert.equal(aster.scenes.list().some(s => s.key === '4'), enabled, 'shortcut uses live scenes');
  assert.ok(aster.pluginDefinitions.has('ai.core'), 'plugin stays available for manual enable');
  assert.ok(aster.scenes.listDefinitions().some(s => s.id === 'aiChat'), 'disabled scene metadata stays discoverable');
}
const fresh = storage(), first = boot(fresh);
assert.deepEqual(first.disabled, ['ai.core']); assertAi(first.aster, false);
for (const id of ['overview.core', 'library.core', 'reader.core', 'markdown.core']) assert.ok(first.aster.plugins.has(id));
assert.equal(baseScenes.find(s => s.id === 'aiChat').enabledByDefault, false);
assert.equal(first.aster.scenes.listDefinitions().find(s => s.id === 'aiChat').enabledByDefault, false);
// Other startup effects can create legacy markers; persist the original snapshot.
fresh.setItem('aster.uiState', '{}'); fresh.setItem('aster.disabledPlugins', JSON.stringify(first.disabled));
assertAi(boot(fresh).aster, false);
assert.equal(first.aster.setPluginEnabled('ai.core', true), true); assertAi(first.aster, true);
fresh.setItem('aster.disabledPlugins', '[]'); assertAi(boot(fresh).aster, true);
assert.equal(first.aster.setPluginEnabled('ai.core', false), true); assertAi(first.aster, false);
fresh.setItem('aster.disabledPlugins', '["ai.core"]'); assertAi(boot(fresh).aster, false);
assertAi(boot(storage([['aster.disabledPlugins', '[]']])).aster, true);
assertAi(boot(storage([['aster.disabledPlugins', '["ai.core"]']])).aster, false);
const readerOff = boot(storage([['aster.disabledPlugins', '["reader.core"]']]));
assertAi(readerOff.aster, true); assert.equal(readerOff.aster.plugins.has('reader.core'), false);
for (const key of ['aster.uiState', 'aster.settings', 'aster.pluginSettings', 'aster.sidebarCollapsed', 'aster.sidebarWidth', 'aster.localPlugins']) assertAi(boot(storage([[key, '{}']])).aster, true);
assert.deepEqual(loadDisabled(storage([['aster.disabledPlugins', '["ai.core",42,"ai.core","reader.core"]']])), ['ai.core', 'reader.core']);
for (const value of ['', '{broken', '{}', 'null']) assert.deepEqual(loadDisabled(storage([['aster.disabledPlugins', value]])), [], 'preserve legacy invalid-record fallback');
assert.deepEqual(loadDisabled({ getItem() { throw new Error('storage unavailable'); } }), ['ai.core']);
assert.match(app, /useState<string\[\]>\(\(\) => \[\.\.\.persistedDisabledPluginIds\]\)/, 'React state must reuse the same startup decision');
assert.match(app, /const sidebarScenes:[^\n]*aster\.scenes\.list\(\)/);
assert.match(app, /localStorage\.setItem\('aster.disabledPlugins', JSON\.stringify\(disabledPluginIds\)\)/);
console.log('PASS AI scene defaults: clean install disabled before first render (plugin/scene/view/sidebar/shortcut), manual enable+restart, existing enabled/disabled/legacy profiles preserved, malformed/storage fallback, other plugins unchanged. Memory-only core/startup test; not native installer acceptance.');
