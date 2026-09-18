import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpile(readFileSync(path, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }))(exports, name => name.endsWith('.css') ? {} : (imports[name] ?? require(name)));
  return exports;
}
const helpers = load('src/shared/markdown/imageLayout.ts');
const { readImageTitle, withImageLayout, imageSourceTitle } = helpers;
const layout = { width: 60, align: 'center' };
for (const raw of ['![](https://example.com/a.png)', '![说明](data:image/png;base64,AA== "图片说明")', '![x](https://example.com/a.png \'a "quote"\')']) {
  const changed = withImageLayout(raw, layout);
  assert.deepEqual(readImageTitle(imageSourceTitle(changed)).layout, layout);
  assert.equal(readImageTitle(imageSourceTitle(changed)).caption, imageSourceTitle(raw));
  const node = unified().use(remarkParse).parse(changed).children[0].children[0];
  assert.equal(node.type, 'image');
  assert.deepEqual(readImageTitle(node.title).layout, layout);
  assert.equal(withImageLayout(changed, layout), changed, 'idempotent');
  assert.equal(readImageTitle(imageSourceTitle(withImageLayout(changed, null))).caption, imageSourceTitle(raw));
}
const html = '<img src="https://example.com/a.png" alt="说明" title="图 &quot;1&quot;" loading="lazy">';
const changedHtml = withImageLayout(html, layout);
assert.ok(changedHtml.includes('loading="lazy"'));
assert.equal(readImageTitle(imageSourceTitle(changedHtml)).caption, '图 "1"');
assert.equal(readImageTitle('note [a4note-image:999:center]').layout, undefined);
assert.equal(readImageTitle(imageSourceTitle(withImageLayout('![](https://x/a)', { width: -10, align: 'right' }))).layout.width, 10);
const tab = readFileSync('src/features/explorer/MarkdownResourceTab.tsx', 'utf8');
const normalizer = tab.slice(tab.indexOf('function normalizeEmbeddedMarkdown('), tab.indexOf('function headingText('));
const normalize = new Function(ts.transpile(normalizer + '\nreturn normalizeEmbeddedMarkdown;', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }))();
const htmlNode = unified().use(remarkParse).parse(normalize(changedHtml)).children[0].children[0];
assert.deepEqual(readImageTitle(htmlNode.title).layout, layout, 'HTML reading normalization preserves layout');
const { MarkdownFigure } = load('src/shared/markdown/MarkdownFigure.tsx', { './imageLayout': helpers });
const rendered = renderToStaticMarkup(createElement(MarkdownFigure, { src: 'https://example.com/a.png', title: '图 [a4note-image:60:right]' }));
assert.ok(rendered.includes('width:60%')); assert.ok(rendered.includes('margin-left:auto;margin-right:0'));
assert.ok(rendered.includes('markdown-figcaption')); assert.ok(!rendered.includes('a4note-image:'), 'metadata not displayed as caption');
const { markdownTemplates } = load('src/features/explorer/markdownTemplates.ts');
const table = markdownTemplates.find(t => t.id === 'table').source;
const ast = unified().use(remarkParse).use(remarkGfm).parse(table);
assert.equal(ast.children[0].type, 'table');
assert.equal(ast.children[0].children.length, 3);
for (const row of ast.children[0].children) for (const cell of row.children) assert.equal(cell.children.length, 0);
assert.ok(!tab.includes('| 列 1 |')); assert.ok(!table.includes('内容'));
// Execute the actual image widget with real CodeMirror state/history and a minimal DOM.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.attrs = {}; this.classList = { add() {}, toggle() {} }; this.isConnected = false; }
  get valueAsNumber() { return this.value?.trim() ? Number(this.value) : NaN; }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  fire(type, overrides = {}) { this.listeners[type]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...overrides }); }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return { width: this.tag === 'img' ? 300 : 600, left: 0, right: 600 }; }
  closest() { return { getBoundingClientRect: () => ({ width: 600 }) }; }
  contains(node) { return this === node || this.children.some(c => c.contains(node)); }
  querySelector() { return null; }
}
const document = { createElement: tag => new Element(tag), createElementNS: (namespaceURI, tag) => Object.assign(new Element(tag), { namespaceURI }), activeElement: null };
const window = { requestAnimationFrame() {} };
const source = readFileSync('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8');
const fragment = source.slice(source.indexOf('const openImageTools'), source.indexOf('class MarkdownLinkWidget'));
const compiled = ts.transpile(fragment + '\nreturn ImageWidget;', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
let completeLocal;
const localRead = () => new Promise(resolve => { completeLocal = resolve; });
const ImageWidget = new Function('directNoteImage', 'loadNoteImage', 'imageDisposers', 'WidgetType', 'document', 'window', 'HTMLElement', 'imageSourceTitle', 'readImageTitle', 'withImageLayout', 'isolateHistory', 'undo', 'redo', 'requestPreviewLayoutMeasure', compiled)(load('src/features/explorer/noteImageSource.ts').directNoteImage, localRead, new WeakMap(), class {}, document, window, Element, imageSourceTitle, readImageTitle, withImageLayout, isolateHistory, undo, redo, view => view.requestMeasure());
const raw = '![](https://example.com/a.png)';
let state = EditorState.create({ doc: 'before\n' + raw + '\nafter', extensions: [history()] });
let writes = 0;
const view = { get state() { return state; }, dispatch(spec) { writes++; state = spec.state ?? state.update(spec).state; }, requestMeasure() {}, focus() {}, dom: new Element('div') };
function widget() { const line = state.doc.line(2); return new ImageWidget('https://example.com/a.png', '', line.from, line.to, line.text).toDOM(view); }
let wrap = widget(); let tools = wrap.children[1];
assert.equal(tools.children[1].hidden, true);
tools.children[0].fire('click'); assert.equal(tools.children[1].hidden, false);
const action = (wrap, id) => {
  const find = node => node.dataset.imageAction === id ? node : node.children.map(find).find(Boolean);
  return find(wrap);
};
action(wrap, 'smaller').fire('click');
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 40);
assert.equal(state.selection.main.head, 0, 'toolbar must not select source');
wrap = widget(); assert.equal(wrap.children[1].children[1].hidden, false, 'rebuild keeps panel open');
action(wrap, 'right').fire('click');
assert.deepEqual(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout, { width: 40, align: 'right' });
undo(view); assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.align, 'left');
redo(view); assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.align, 'right');
wrap = widget(); action(wrap, 'reset').fire('click');
assert.deepEqual(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout, { width: 100, align: 'right' }, 'fill keeps alignment');
wrap = widget(); action(wrap, 'center').fire('click');
assert.deepEqual(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout, { width: 100, align: 'center' });
wrap = widget(); action(wrap, 'smaller').fire('click');
assert.deepEqual(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout, { width: 90, align: 'center' });
wrap = widget(); let width = action(wrap, 'width');
assert.equal(width.placeholder, '原图'); assert.equal(width.value, '90');
width.value = '63'; width.fire('keydown', { key: 'Enter' });
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 63);
wrap = widget(); width = action(wrap, 'width'); width.value = '120'; width.fire('keydown', { key: 'Enter' });
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 100);
wrap = widget(); width = action(wrap, 'width'); width.value = '3'; width.fire('keydown', { key: 'Enter' });
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 10);
wrap = widget(); width = action(wrap, 'width'); width.value = '45.6'; width.fire('keydown', { key: 'Enter' });
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 46);
wrap = widget(); width = action(wrap, 'width'); width.value = ''; width.fire('keydown', { key: 'Enter' });
assert.equal(width.value, '46');
width.value = '88'; width.fire('keydown', { key: 'Escape' }); assert.equal(width.value, '46');
width.value = '40'; action(wrap, 'larger').fire('click');
assert.equal(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout.width, 50);
wrap = widget(); action(wrap, 'reset').fire('click'); assert.deepEqual(readImageTitle(imageSourceTitle(state.doc.line(2).text)).layout, { width: 100, align: 'center' });
assert.ok(rendered.includes('markdown-image-corner-action'));
assert.ok(source.includes('cm-md-image-tools-toggle markdown-image-corner-action'));
wrap = widget(); state = state.update({ changes: { from: 0, insert: 'moved' } }).state;
const before = writes; action(wrap, 'larger').fire('click'); assert.equal(writes, before, 'stale source must not be overwritten');
state = EditorState.create({ doc: 'before\n' + raw, extensions: [EditorState.readOnly.of(true)] });
assert.equal(widget().children.length, 1, 'no mutation controls in read-only state');
const localRaw = '![](assets/a.png)';
const localWidget = new ImageWidget('assets/a.png', '', 0, localRaw.length, localRaw, false, 'D:/notes/n.md');
const localDom = localWidget.toDOM(view);
assert.equal(localDom.children[0].src, undefined, 'do not send relative filesystem URL to webview');
const localStatus = localDom.children[1];
completeLocal('data:image/png;base64,AA==');
await Promise.resolve();
assert.equal(localDom.children[0].src, 'data:image/png;base64,AA==');
assert.equal(localStatus.removed, true);
const abandoned = localWidget.toDOM(view);
localWidget.destroy(abandoned);
completeLocal('data:image/png;base64,OLD=');
await Promise.resolve();
assert.equal(abandoned.children[0].src, undefined, 'late read after widget destruction must not update old DOM');
assert.deepEqual(readImageTitle(imageSourceTitle(withImageLayout('![](<assets/a b.png>)', layout))).layout, layout);
console.log('Image layout checks passed: empty GFM tables, metadata/caption roundtrip, HTML normalization, React read rendering, widget actions, panel reopening, undo/redo, stale-source and read-only guards. Mock DOM only; desktop geometry not simulated.');
