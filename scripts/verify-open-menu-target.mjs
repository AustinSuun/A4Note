// bcabb18d: the title bar「打开 ▾」menu exists only for a concrete file and acts on that file.
// Run: node --experimental-strip-types scripts/verify-open-menu-target.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  displayWidth,
  isInsideFolder,
  middleEllipsisPath,
  openMenuFileKind,
  openMenuSourceFromTab,
  resolveOpenMenuTarget,
} from '../src/workbench/openMenuTarget.ts';

const root = 'D:\\Notes\\研究';
const resolveTab = (tab, reader, projectRoot = root) => resolveOpenMenuTarget(openMenuSourceFromTab(tab, reader), { projectRoot });
const visible = (resolution) => {
  assert.equal(resolution.visible, true, `expected a target, got ${JSON.stringify(resolution)}`);
  return resolution.target;
};

// Markdown: reveal + open the file itself in VS Code; project entry kept because it is inside the folder project.
const md = visible(resolveTab({ kind: 'file', title: '读书笔记.md', state: { path: `${root}\\notes\\读书笔记.md` } }));
assert.equal(md.fileKind, 'markdown');
assert.equal(md.name, '读书笔记.md');
assert.deepEqual(md.reveal, { type: 'path', path: `${root}\\notes\\读书笔记.md` });
assert.equal(md.vscodePath, `${root}\\notes\\读书笔记.md`);
assert.equal(md.projectVSCodePath, root);
assert.equal(md.displayPath, `${root}\\notes\\读书笔记.md`);

// Workspace PDF (a file tab, not a library paper): reveal only, no VS Code.
const pdf = visible(resolveTab({ kind: 'file', state: { path: 'E:/papers/attention.pdf' } }));
assert.equal(pdf.fileKind, 'pdf');
assert.equal(pdf.vscodePath, null);
assert.equal(pdf.projectVSCodePath, null, 'outside the folder project → no project entry');
assert.deepEqual(pdf.reveal, { type: 'path', path: 'E:/papers/attention.pdf' });

// Library paper in the reader: revealed through the library by paper id + file id, never by a guessed path.
const paper = visible(resolveTab({ kind: 'tool', title: '使用指南' }, {
  paperId: 'paper-1',
  paper: { paperId: 'paper-1', title: '使用指南', sourcePdf: 'C:\\Users\\a\\AppData\\Roaming\\aster\\library\\guide.pdf', sourceFileId: 'file-9' },
}));
assert.equal(paper.fileKind, 'pdf');
assert.deepEqual(paper.reveal, { type: 'paper', paperId: 'paper-1', fileId: 'file-9' });
assert.equal(paper.vscodePath, null);
assert.equal(paper.name, 'guide.pdf');
assert.match(paper.displayPath, /guide\.pdf$/);

// Board (.a4board, file tab or plugin tab): reveal, VS Code hidden.
for (const kind of ['file', 'plugin:a4.whiteboard']) {
  const board = visible(resolveTab({ kind, state: { path: `${root}\\未命名白板.a4board` } }));
  assert.equal(board.fileKind, 'board');
  assert.equal(board.vscodePath, null, `${kind}: VS Code must be hidden for boards`);
  assert.equal(board.projectVSCodePath, root);
}

// HTML: text-like, VS Code opens the file.
const html = visible(resolveTab({ kind: 'file', state: { uri: 'file:///D:/Notes/%E7%A0%94%E7%A9%B6/site/index.html' } }));
assert.equal(html.fileKind, 'html');
assert.equal(html.vscodePath, html.reveal.path);
assert.match(html.reveal.path, /^D:[\\/]Notes[\\/]研究[\\/]site[\\/]index\.html$/);

// Image: reveal only.
const image = visible(resolveTab({ kind: 'file', state: { path: `${root}\\figs\\plot.PNG` } }));
assert.equal(image.fileKind, 'image');
assert.equal(image.vscodePath, null);

// Plain text / code files open in VS Code too.
assert.equal(visible(resolveTab({ kind: 'file', state: { path: '/home/u/a/data.json' } })).vscodePath, '/home/u/a/data.json');

// Pages that are not a file: nothing is rendered.
assert.deepEqual(resolveTab({ kind: 'tool', title: '总览', key: 'tool:overview' }, { paperId: null }), { visible: false, reason: 'scene' }, 'overview');
assert.deepEqual(resolveTab({ kind: 'tool', title: '文献库' }, { paperId: null }), { visible: false, reason: 'scene' }, 'library list');
assert.deepEqual(resolveTab(null), { visible: false, reason: 'no-tab' }, 'no tab');
assert.deepEqual(resolveTab(undefined), { visible: false, reason: 'no-tab' });
for (const kind of ['agent', 'terminal', 'diff']) assert.deepEqual(resolveTab({ kind, state: { path: 'D:/x.md' } }), { visible: false, reason: 'session' }, kind);

// Missing / unusable paths never produce a menu that would reveal the wrong place.
assert.deepEqual(resolveTab({ kind: 'file', title: 'x.md', state: {} }), { visible: false, reason: 'no-local-path' }, 'missing path');
assert.deepEqual(resolveTab({ kind: 'file', state: { path: '   ' } }), { visible: false, reason: 'no-local-path' }, 'blank path');
assert.deepEqual(resolveTab({ kind: 'file', state: { path: 'notes/x.md' } }), { visible: false, reason: 'no-local-path' }, 'relative path');
assert.deepEqual(resolveTab({ kind: 'plugin:x', state: { uri: 'aster://paper/1' } }), { visible: false, reason: 'no-local-path' }, 'non-file uri');
assert.deepEqual(resolveTab({ kind: 'tool' }, { paperId: 'p', paper: { paperId: 'p', sourcePdf: '', sourceFileId: '' } }), { visible: false, reason: 'paper-without-file' });
assert.deepEqual(resolveTab({ kind: 'tool' }, { paperId: 'p', paper: null }), { visible: false, reason: 'paper-without-file' }, 'unknown paper');

// Target key changes with the file (the TopBar closes an open menu on change).
assert.notEqual(md.key, image.key);

// Helpers.
assert.equal(openMenuFileKind('a/b/C.MARKDOWN'), 'markdown');
assert.equal(openMenuFileKind('x.htm'), 'html');
assert.equal(openMenuFileKind('noext'), 'file');
assert.equal(isInsideFolder('d:/notes/研究/a.md', 'D:\\Notes\\研究\\'), true);
assert.equal(isInsideFolder('D:\\Notes\\研究2\\a.md', root), false, 'sibling folder with same prefix');
assert.equal(middleEllipsisPath('D:\\short.md'), 'D:\\short.md');
const long = `D:\\WorkSpace\\${'很长的目录名\\'.repeat(12)}最终文件名称.md`;
const elided = middleEllipsisPath(long, 72);
assert.ok(displayWidth(elided) <= 72, `elided width ${displayWidth(elided)}`);
assert.ok(elided.startsWith('D:\\WorkSpace'), elided);
assert.ok(elided.endsWith('最终文件名称.md'), elided);
assert.ok(elided.includes('…'));
// Width, not length: a 69-character Chinese path is ~100 columns wide and must be elided.
const deep = 'D:\\Fixture\\研究笔记\\资料 目录\\第一层 很长的目录名称\\第二层 很长的目录名称\\第三层\\一个相当长的笔记文件名称用于测试.md';
assert.ok(deep.length < 72 && displayWidth(deep) > 72);
const deepElided = middleEllipsisPath(deep);
assert.ok(deepElided.includes('…') && displayWidth(deepElided) <= 72 && deepElided.endsWith('一个相当长的笔记文件名称用于测试.md') && deepElided.startsWith('D:\\Fixture'), deepElided);
assert.equal(middleEllipsisPath('C:\\a\\' + 'x'.repeat(100) + '.md', 40).length, 40, 'ASCII: exactly max columns');

// TopBar/App wiring: the menu is conditional and no longer targets the project root.
const topBar = fs.readFileSync('src/workbench/WorkbenchTopBar.tsx', 'utf8');
assert.doesNotMatch(topBar, /canBrowseFolder|onRevealFolder/, 'old project-level props must be gone');
assert.match(topBar, /\{openTarget && \(\s*<div className="workbench-open-menu"/, 'menu rendered only with a target');
assert.doesNotMatch(topBar, /disabled=\{!/, 'no disabled placeholder trigger');
const app = fs.readFileSync('src/ui/App.tsx', 'utf8');
assert.doesNotMatch(app, /revealPath\(folderProjectPath\)|openPathInVSCode\(folderProjectPath\)/, 'App must not reveal/open the project root from the title bar');
assert.match(app, /openTarget=\{openMenuTarget\}/);
assert.doesNotMatch(app, /openMenuTarget[^\n]*sidebar/i, 'no coupling with sidebar state');

console.log('Open menu target passed: md/pdf/paper/board/html/image/text show a file-bound menu (VS Code only for text kinds, project entry only inside the folder project); overview/library/no tab/sessions/missing or relative paths render nothing; middle ellipsis keeps head and file name.');
