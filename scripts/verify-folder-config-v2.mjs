import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function moduleAt(path, imports) {
  const source = fs.readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => { if (!(id in imports)) throw Error(id); return imports[id]; }, module, module.exports);
  return module.exports;
}
const reads = [], writes = [];
globalThis.localStorage = {
  getItem(key) { reads.push(key); return key === 'a4note.folderWorkbench.v2' ? 'new-snapshot' : 'old-snapshot'; },
  setItem(key, value) { writes.push([key, value]); },
};
const storeModule = moduleAt('src/workbench/workspaceStore.ts', { '../core/workspace': { deserializeWorkbenchState: raw => raw } });
assert.equal(storeModule.createWorkbenchStore().getState(), 'new-snapshot');
assert.deepEqual(reads, ['a4note.folderWorkbench.v2']);
let desktop = true, snapshot = null, fail = false;
const saves = [];
const api = moduleAt('src/platform/workbench/workbenchStorageApi.ts', {
  '@tauri-apps/api/core': { invoke: async (command, args) => {
    if (command === 'load_workbench_state') { if (fail) throw Error('mock unavailable'); return snapshot; }
    assert.equal(command, 'save_workbench_state'); saves.push(args.request.snapshot);
  } },
  '../projects': { isTauriRuntime: () => desktop },
});
const initial = await api.createWorkbenchStorage();
assert.equal(initial.read(), null);
assert.equal(saves.length, 0, 'No migration write from a legacy key');
assert.deepEqual(reads, ['a4note.folderWorkbench.v2'], 'Desktop adapter never consults legacy browser storage');
snapshot = 'new-desktop-snapshot';
const storage = await api.createWorkbenchStorage();
assert.equal(storage.read(), snapshot);
storage.write('first'); storage.write('latest');
await new Promise(resolve => setTimeout(resolve, 320));
assert.deepEqual(saves, ['latest']);
fail = true; const warn = console.warn; console.warn = () => {};
try { assert.equal(await api.createWorkbenchStorage(), null); } finally { console.warn = warn; }
assert.equal(storeModule.createWorkbenchStore().getState(), 'new-snapshot', 'Failure fallback stays in new namespace');
desktop = false; assert.equal(await api.createWorkbenchStorage(), null);
assert(reads.every(key => key === 'a4note.folderWorkbench.v2'));
const hook = fs.readFileSync('src/features/markdown/useNoteFolderWorkspaces.tsx', 'utf8');
assert(hook.includes('a4note.notes.folderWorkspaces.v2'));
assert(!hook.includes('a4note.notes.folderWorkspaces.v1'));
assert.deepEqual(writes, [], 'No cleanup of old or real storage');
console.log('Folder config v2 passed: fresh namespace, no legacy migration, desktop load/debounce, fallback isolation. Mock storage only.');
