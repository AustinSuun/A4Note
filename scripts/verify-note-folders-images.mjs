import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path, imports = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpile(readFileSync(path, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(exports, name => {
    if (!(name in imports)) throw new Error(`Unmocked dependency ${name}`);
    return imports[name];
  });
  return exports;
}
const imageSource = load('src/features/explorer/noteImageSource.ts');
const { resolveNoteImagePath: resolve, canPreviewNoteImage, directNoteImage } = imageSource;
for (const [source, expected] of [
  ['./assets/a.png', 'D:/notes/assets/a.png'],
  ['../图 片/a%20b.png', 'D:/图 片/a b.png'],
  ['<assets/a b.png>', 'D:/notes/assets/a b.png'],
  ['assets\\a.png', 'D:/notes/assets/a.png'],
  ['a\\(b\\).png', 'D:/notes/a(b).png'],
  ['assets/a.png#preview', 'D:/notes/assets/a.png'],
  ['assets/a%23b.png', 'D:/notes/assets/a#b.png'],
  ['C:\\photos\\p.jpg', 'C:/photos/p.jpg'],
]) assert.equal(resolve('D:\\notes\\note.md', source)?.path, expected);
assert.equal(resolve('D:/other/note.md', 'assets/a.png')?.path, 'D:/other/assets/a.png');
for (const source of ['javascript:alert(1)', 'file:///D:/secret.png', '//host/share/a.png', '\\\\host\\a.png', 'data:text/html,x', '../secret.txt', 'x.png:stream', '../../../a.png', '%00.png']) {
  assert.equal(resolve('D:/notes/note.md', source), null, source);
  assert.equal(canPreviewNoteImage('D:/notes/note.md', source), false, source);
}
assert.equal(canPreviewNoteImage('', './a.png'), false);
assert.equal(resolve('\\\\server\\share\\note.md', './a.png'), null, 'UNC base must not become a local /server path');
assert.equal(resolve('D:/notes/\u0000note.md', './a.png'), null);
assert.equal(directNoteImage('https://example.com/no-extension'), true);
assert.equal(directNoteImage('data:image/png;base64,AA=='), true);
const model = load('src/features/markdown/noteFolderModel.ts');
const projects = [
  { id: 'builtin', kind: 'builtin', rootPath: 'library:', name: '论文库' },
  { id: 'a', kind: 'folder', rootPath: 'D:\\notes\\', name: '旧项目别名' },
  { id: 'a2', kind: 'folder', rootPath: 'd:/NOTES', name: '重复路径' },
  { id: 'b', kind: 'folder', rootPath: 'E:/脑图', name: '脑图' },
];
const state = { projects, activeWorkspaceId: 'w2', workspaces: [
  { id: 'w1', projectId: 'a', name: '默认工作区', tabs: [{ id: 'paper', kind: 'pdf' }], createdAt: '2025-01-01' },
  { id: 'w2', projectId: 'a', name: '工作区2', tabs: [{ id: 'note', kind: 'markdown' }], createdAt: '2025-01-02' },
  { id: 'wb', projectId: 'b', createdAt: '2025-01-03' },
] };
const before = JSON.stringify(state);
const folders = model.noteFolders(projects);
assert.equal(folders.length, 2, 'exclude builtin and dedupe Windows paths');
assert.equal(folders[0].name, 'notes', 'folder basename, not legacy workspace label');
assert.deepEqual(folders[0].projectIds, ['a', 'a2']);
assert.equal(model.noteFolderWorkspace(state, folders[0]).id, 'w2', 'reuse active legacy note backing workspace');
assert.equal(model.noteFolderWorkspace(state, folders[0], 'w1').id, 'w1', 'remember selected backing workspace');
assert.equal(model.noteFolderWorkspace(state, folders[0], 'wb').id, 'w2', 'reject preference from another folder');
assert.equal(model.noteFolderWorkspace({...state, activeWorkspaceId: 'missing'}, folders[0], 'deleted').id, 'w1');
assert.equal(JSON.stringify(state), before, 'do not delete/rename/move legacy workspaces, tabs, or paper data');
assert.deepEqual(model.readNoteFolderPreferences('[]'), {});
assert.deepEqual(model.readNoteFolderPreferences('{"a":"w1","bad":42}'), { a: 'w1' });
// Actual loader: in-flight dedupe, base directory, error eviction, no HTTP/local confusion.
let reads = 0; let requested = ''; let finish;
const platform = { isTauriRuntime: () => true, readFileBytes: path => { reads++; requested = path; return new Promise(resolve => { finish = resolve; }); } };
const { loadNoteImage } = load('src/features/explorer/noteImageLoader.ts', { '../../platform/projects': platform, './noteImageSource': imageSource });
const one = loadNoteImage('D:/notes/n.md', './assets/a.png');
const two = loadNoteImage('D:/notes/n.md', './assets/a.png');
assert.equal(one, two); assert.equal(reads, 1); assert.equal(requested, 'D:/notes/assets/a.png');
finish([137,80,78,71]); assert.match(await one, /^data:image\/png;base64,/);
const next = loadNoteImage('D:/notes/n.md', './assets/a.png'); assert.equal(reads, 2, 'completed reads are not retained forever'); finish([]); await assert.rejects(next);
assert.equal(await loadNoteImage('D:/notes/n.md', 'https://example.com/a.png'), 'https://example.com/a.png'); assert.equal(reads, 2);
await assert.rejects(loadNoteImage('D:/notes/n.md', '../secret.txt'));
const noDesktop = load('src/features/explorer/noteImageLoader.ts', { '../../platform/projects': { ...platform, isTauriRuntime: () => false }, './noteImageSource': imageSource });
await assert.rejects(noDesktop.loadNoteImage('D:/notes/n.md', './a.png'));
const editor = readFileSync('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8');
assert.ok(editor.includes('imagePathCompartment.current.reconfigure(noteDocumentPath.of(documentPath))'));
assert.ok(editor.includes('if (disposed) return;'));
assert.ok(editor.includes('destroy(dom: HTMLElement) { imageDisposers.get(dom)?.();'));
const hook = readFileSync('src/features/markdown/useNoteFolderWorkspaces.tsx', 'utf8');
assert.ok(hook.includes("activeScene === 'markdown'"));
assert.ok(hook.includes('epoch === requestEpoch.current'));
assert.ok(hook.includes('return () => { requestEpoch.current += 1; };'));
assert.ok(hook.includes('if (!selected || !isCurrent()) return;'));
assert.ok(hook.includes('<select disabled={pending}'));
assert.ok(!/store\.(removeWorkspace|removeProject|renameWorkspace|moveTab)\(/.test(hook));
console.log('Note folder/image regression passed: relative/encoded/Unicode/parent paths, disallowed paths/schemes, shared loader dedupe/errors, folder projection/legacy state preservation, and integration guards. No real files modified.');
