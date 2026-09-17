import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';
import { history, undo, isolateHistory } from '@codemirror/commands';
function load(path) {
  const exports = {};
  new Function('exports', ts.transpile(readFileSync(path, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(exports);
  return exports;
}
const { changeTableStructure } = load('src/features/explorer/tableStructure.ts');
const { markdownTemplates } = load('src/features/explorer/markdownTemplates.ts');
const rows = [['名称', '值'], ['a\\|b', '`代码`']];
const align = ['left', 'right'];
const snapshot = JSON.stringify(rows);
let result = changeTableStructure(rows, align, 'add-row', 0, 0);
assert.equal(result, '| 名称 | 值 |\n| :--- | ---: |\n|  |  |\n| a\\|b | `代码` |');
result = changeTableStructure(rows, align, 'add-column', 1, 0);
assert.equal(result, '| 名称 |  | 值 |\n| :--- | --- | ---: |\n| a\\|b |  | `代码` |');
assert.equal(changeTableStructure(rows, align, 'delete-row', 0, 0), null, 'protect header');
assert.equal(changeTableStructure([['one']], [null], 'delete-column', 0, 0), null, 'protect last column');
assert.equal(changeTableStructure(rows, align, 'delete-row', 1, 0), '| 名称 | 值 |\n| :--- | ---: |');
result = changeTableStructure(rows, align, 'delete-column', 0, 1);
assert.equal(result, '| 名称 |\n| :--- |\n| a\\|b |');
assert.equal(JSON.stringify(rows), snapshot, 'do not mutate original cells');
const editor = readFileSync('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8');
const fragment = editor.slice(editor.indexOf('const tableRowPattern'), editor.indexOf('class HeadingFoldWidget'));
const { findTableRegions } = new Function('WidgetType', ts.transpile(fragment + '\nreturn {findTableRegions};', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }))(class {});
let state = EditorState.create({ doc: result, extensions: [history()] });
assert.equal(findTableRegions(state, new Set()).length, 1, 'one-column result must remain renderable');
const original = state.doc.toString();
state = state.update({ changes: { from: 0, to: state.doc.length, insert: changeTableStructure([['名称'], ['a\\|b']], ['left'], 'add-row', 1, 0) }, userEvent: 'input.table-structure', annotations: isolateHistory.of('full') }).state;
assert.notEqual(state.doc.toString(), original);
undo({ state, dispatch: (transaction) => { state = transaction.state; } });
assert.equal(state.doc.toString(), original, 'structural edit can be undone');
assert.equal(new Set(markdownTemplates.map((item) => item.id)).size, markdownTemplates.length);
for (const template of markdownTemplates) {
  assert.ok(template.source.trim());
  assert.equal(typeof template.block, 'boolean');
}
for (const id of ['h1', 'h6', 'tasks', 'table', 'code', 'math', 'footnote', 'image', 'wiki', 'underline', 'callout-INFO']) assert.ok(markdownTemplates.some((item) => item.id === id));
const tableTemplate = markdownTemplates.find((item) => item.id === 'table');
assert.equal(findTableRegions(EditorState.create({ doc: tableTemplate.source }), new Set()).length, 1);
const tab = readFileSync('src/features/explorer/MarkdownResourceTab.tsx', 'utf8');
assert.ok(tab.includes('MarkdownAuthoringDock open={templateOpen}'));
assert.ok(tab.includes('setTemplateOpen(true)'));
assert.ok(!tab.includes('className="markdown-source-tools"'), 'old top formatting toolbar removed');
console.log(`Authoring checks passed: row/column changes, one-column parser, undo, ${markdownTemplates.length} templates and shared dock/menu wiring. Desktop UI not simulated.`);
