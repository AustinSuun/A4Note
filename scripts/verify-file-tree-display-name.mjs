import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks = 0;
const eq = (value, expected, label) => { assert.equal(value, expected, label); checks++; };
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => { if (id in mocks) return mocks[id]; throw Error('Unmocked dependency: ' + id); }, ...globals });
  return exports;
}
const helper = load('src/features/explorer/fileTreeDisplayName.ts');
for (const [name, directory, expected] of [
  ['Markdown 样式测试.md', false, 'Markdown 样式测试'], ['AAA模板.MD', false, 'AAA模板'],
  ['测试.Md', false, '测试'], ['版本.v2.md', false, '版本.v2'], ['🎨 主题.md', false, '🎨 主题'],
  ['.hidden.md', false, '.hidden'], ['notes.md.md', false, 'notes.md'],
  ['Markdown.md.backup-2026', false, 'Markdown.md'], ['image.png', false, 'image'],
  ['notes.txt', false, 'notes'], ['notes.markdown', false, 'notes'], ['notes.mdx', false, 'notes'],
  ['folder.md', true, 'folder.md'], ['folder.MD', true, 'folder.MD'], ['.md', false, '.md'], ['', false, ''], ['README', false, 'README'],
]) {
  const entry = Object.freeze({ name, is_directory: directory, path: '/notes/' + name });
  eq(helper.fileTreeDisplayName(entry), expected, 'display boundary: ' + name);
  eq(entry.name, name, 'name must not be mutated');
}
// Tags are explicit types, never guessed MIME types. Unknown/extensionless files remain distinguishable.
for (const [name, expectedName, label, tone] of [
  ['report.PDF', 'report', 'PDF', 'pdf'], ['image.PnG', 'image', 'PNG', 'image'],
  ['data.json', 'data', 'JSON', 'data'], ['sheet.xlsx', 'sheet', 'XLSX', 'data'],
  ['slides.pptx', 'slides', 'PPTX', 'document'], ['film.mp4', 'film', 'MP4', 'media'],
  ['archive.tar.gz', 'archive', 'TAR.GZ', 'archive'], ['package.ZIP', 'package', 'ZIP', 'archive'],
  ['code.py', 'code', 'PY', 'code'], ['note.md.backup-2026-09-18T00.00.00', 'note.md', 'BACKUP', 'other'],
  ['file.unknown-long-extension', 'file', 'UNKNOWN-LONG-EXTENSION', 'other'],
  ['README', 'README', 'FILE', 'other'], ['.gitignore', '.gitignore', 'FILE', 'other'],
  ['.settings.json', '.settings', 'JSON', 'data'], ['.md', '.md', 'FILE', 'other'],
  ['file.constructor', 'file', 'CONSTRUCTOR', 'other'], ['file.__proto__', 'file', '__PROTO__', 'other'],
]) {
  const entry = Object.freeze({ name, is_directory: false });
  const result = helper.fileTreePresentation(entry);
  eq(result.name, expectedName, 'badge stem'); eq(result.badge.label, label, 'badge text'); eq(result.badge.tone, tone, 'bounded color category');
  eq(entry.name, name, 'presentation never renames original file');
}
eq(helper.fileTreePresentation({name:'note.MD',is_directory:false}).badge, null, 'MD remains badge-free');
eq(helper.fileTreePresentation({name:'folder.pdf',is_directory:true}).badge, null, 'directories never acquire a file badge');
// Execute the actual component render/click callbacks with synthetic directory state.
// React effects/native listing are not run; this is not desktop E2E.
const entries = [
  { name: '笔记.md', path: '/notes/笔记.md', is_directory: false },
  { name: 'folder.md', path: '/notes/folder.md', is_directory: true },
  { name: '笔记.md.backup-2026', path: '/notes/笔记.md.backup-2026', is_directory: false },
  { name: 'image.png', path: '/notes/image.png', is_directory: false },
];
let cursor = 0; const slots = []; const opened = [];
const react = {
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = i === 0 ? { '/notes': { loading: false, error: '', entries, truncated: false } } : typeof initial === 'function' ? initial() : initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
  useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
  useEffect() { cursor++; }, useCallback(fn) { cursor++; return fn; },
};
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const { FileTreePanel } = load('src/features/explorer/FileTreePanel.tsx', {
  react, 'react/jsx-runtime': jsx, 'react-dom': { createPortal: child => child }, './file-tree-types.css': {},
  'lucide-react': new Proxy({}, { get: (_target, key) => key }),
  '../../platform/projects': { listDirectoryEntries: () => { throw Error('must not read real files'); } },
  '../../shared/tree': { TreeGuides: 'TreeGuides', FolderDraftRow: 'FolderDraftRow' },
  '../../core/treeExpansion': { toggleTreeExpansion: () => [] },
  '../../ui/zh': { zh: { workbench: new Proxy({}, { get: (_target, key) => key }) } },
  './fileTreeDisplayName': helper,
}, { window: { innerWidth: 1000, innerHeight: 800 }, document: { body: {} }, console });
const find = (node, test) => {
  if (!node) return undefined;
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, test); if (match) return match; } }
  else if (typeof node === 'object') { if (test(node)) return node; return find(node.props?.children, test); }
};
const render = () => { cursor = 0; return FileTreePanel({ rootPath: '/notes', activePath: entries[0].path, onOpenFile: entry => opened.push(entry), onRenameFile() {} }); };
let tree = render();
for (const [index, label] of [[0, '笔记'], [1, 'folder.md'], [2, '笔记.md'], [3, 'image']]) {
  const entry = entries[index]; const row = find(tree, n => n.type === 'button' && n.props?.['data-file-path'] === entry.path);
  assert.ok(row); checks++;
  eq(find(row, n => n.props?.className === 'file-tree-name').props.children, label, 'actual JSX label');
  eq(row.props.title, entry.path, 'hover retains full path');
  const badge = find(row, n => n.props?.className === 'file-tree-type');
  eq(badge?.props.children ?? null, [null, null, 'BACKUP', 'PNG'][index], 'actual JSX type badge');
  if (badge) eq(badge.props['aria-label'], '文件类型：' + badge.props.children, 'type not conveyed by color alone');
  if (!entry.is_directory) { row.props.onClick(); eq(opened.at(-1), entry, 'open receives original entry identity'); }
}
const row = find(tree, n => n.type === 'button' && n.props?.['data-file-path'] === entries[0].path);
eq(row.props['aria-current'], 'page', 'active identity uses original path');
row.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 100 }); tree = render();
const rename = find(tree, n => n.type === 'button' && find(n.props?.children, child => child.type === 'span' && child.props.children === 'fileRename'));
assert.ok(rename, 'rename action retained'); checks++;
rename.props.onClick(); tree = render();
eq(find(tree, n => n.props?.className === 'file-tree-rename-input').props.value, '笔记', 'rename still edits stem');
eq(find(tree, n => n.props?.className === 'file-tree-rename-extension').props.children, '.md', 'rename still indicates true extension');
find(tree, n => n.props?.className === 'tree-edit-cancel').props.onClick(); tree = render();
const pngRow = find(tree, n => n.type === 'button' && n.props?.['data-file-path'] === entries[3].path);
pngRow.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 100 }); tree = render();
eq(find(tree, n => n.props?.className === 'file-tree-context-menu'), undefined, 'existing non-Markdown context-menu policy is unchanged');
console.log(`PASS ${checks} file-tree display/identity assertions; synthetic component state, no native file operations.`);
