import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => fs.readFileSync(path, 'utf8');
function load(path, mocks) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id in mocks ? mocks[id] : require(id) }, { filename: path });
  return exports;
}
const { WorkbenchTopBar } = load('src/workbench/WorkbenchTopBar.tsx', {
  './DocumentToolbar': { useDocumentToolbar: () => ({ enabled: true, setControlsHost() {}, setSaveHost() {} }) },
});
for (const status of ['译文 PDF 已绑定到当前文献。', '初始化失败', '保存成功', '已加载 8 篇本地文献。', '']) {
  const html = renderToStaticMarkup(React.createElement(WorkbenchTopBar, {
    labels: {}, project: null, workspace: null, workspaces: [], providers: [], canBrowseFolder: true,
    workspaceBreadcrumb: React.createElement('span', null, 'content'), status,
  }));
  assert.doesNotMatch(html, /workbench-topbar-status|workbench-status-text|role="status"/);
  if (status) assert.ok(!html.includes(status));
  assert.match(html, /content/); assert.match(html, /workbench-document-controls/);
  assert.match(html, /workbench-document-save/); assert.match(html, /打开/);
}
const mounted = ['source', 'translated'].map(fileKind => ({ key: `p:${fileKind}:${fileKind}`, paperId: 'p', fileKind, fileId: fileKind }));
const { ReaderDocumentPane } = load('src/features/reader/ReaderDocumentPane.tsx', {
  react: { ...React, useState: () => [mounted, () => {}], lazy: () => props => React.createElement('div', { className: 'pdf-reader-surface', 'data-file': props.source.kind }) },
  '../../ui/zh': { zh: { reader: { sourcePdf: '原文', translatedPdf: '译文' } } },
  './ReaderMarkdown': { MarkdownEmptyState: () => null, MarkdownNotePanel: () => null },
  './pdf/pdfSource': { paperPdfSource: (_, kind) => ({ kind }) },
  './pdf/pdfInteraction': { scrollTopFromAnchor: () => 0 },
});
for (const fileMode of ['source', 'translated', 'parallel']) {
  const html = renderToStaticMarkup(React.createElement(ReaderDocumentPane, {
    paper: { paperId: 'p', sourcePdf: 'source.pdf', sourceFileId: 'source', notes: [], annotations: [] },
    contentMode: 'pdf', fileMode, currentTranslatedFileId: 'translated', activeParallelFileKind: 'source',
  }));
  assert.doesNotMatch(html, /pdf-parallel-header/);
  assert.match(html, /aria-label="原文"/); assert.match(html, /aria-label="译文"/);
  assert.equal((html.match(/class="pdf-reader-surface"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-hidden="false"/g) ?? []).length, fileMode === 'parallel' ? 2 : 1);
}
const app = read('src/ui/App.tsx');
assert.doesNotMatch(app, /status=\{libraryStatus/);
assert.doesNotMatch(read('src/workbench/WorkbenchTopBar.tsx'), /status\??:\s*ReactNode/);
const readerCss = read('src/ui/styles/reader.css');
assert.doesNotMatch(readerCss, /pdf-parallel-header/);
assert.match(readerCss, /\.pdf-keepalive-stage\.parallel \.pdf-keepalive-pane\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/);
assert.doesNotMatch(read('src/ui/styles/workbench.css'), /workbench-topbar-status|workbench-status-text/);
console.log('Reader label cleanup passed: real TopBar SSR ignores stale messages, controls retained, source/translation/parallel panes have no header and keep identity/visibility, grid has no reserved header row.');
