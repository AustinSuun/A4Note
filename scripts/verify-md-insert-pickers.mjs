import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: key => { assert.ok(key in imports, key); return imports[key]; }, console });
  return exports;
}
const base = { react: React, 'react/jsx-runtime': jsx };
const table = load('src/features/explorer/DockTablePicker.tsx', base);
for (const [r, c] of [[1, 1], [3, 3], [8, 12], [30, 12]]) {
  const lines = table.tableMarkdown(r, c).split('\n');
  assert.equal(lines.length, r + 1, 'selected rows include the header, not the delimiter');
  assert.equal(lines[1].split('---').length - 1, c);
  assert.equal(lines.filter(line => line.includes('---')).length, 1);
  for (const line of lines) assert.equal(line.split('|').length - 1, c + 1);
}
assert.equal(table.tableMarkdown(100, 100), table.tableMarkdown(30, 12));
assert.equal(table.tableMarkdown(0, NaN), table.tableMarkdown(1, 1));
const language = load('src/features/explorer/DockCodeLanguagePicker.tsx', base);
const templates = load('src/features/explorer/markdownTemplates.ts');
const options = load('src/features/explorer/DockInsertOptions.tsx', {
  ...base, './DockTablePicker': table, './DockCodeLanguagePicker': language,
  './markdownTemplates': templates, './dock-insert-pickers.css': {},
});
const render = kind => renderToStaticMarkup(React.createElement(options.DockInsertOptions, { kind, onInsert() {}, onFormat() {}, onClose() {} }));
const grid = render('table');
assert.equal((grid.match(/role="gridcell"/g) ?? []).length, 96);
assert.equal((grid.match(/aria-selected="true"/g) ?? []).length, 9);
assert.match(grid, /含 1 行表头/); assert.doesNotMatch(grid, /type="number"/);
const code = render('code');
assert.match(code, /role="combobox"/); assert.match(code, /aria-label="代码块语言"/);
assert.match(code, /纯文本/); assert.doesNotMatch(code, /<select|<label/);
assert.match(code, /插入代码块/);
const css = readFileSync('src/features/explorer/dock-insert-pickers.css', 'utf8');
assert.match(css, /\.dock-code-list \.dock-code-option[^}]*font-size: 12px/s);
assert.match(css, /65vh - 126px/); assert.match(css, /65vh - 154px/);
console.log('Markdown insert pickers passed: exact table dimensions/header, bounds, real component SSR, accessible language control and compact typography.');
