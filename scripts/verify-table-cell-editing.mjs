import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';
const source = readFileSync('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8');
const fragment = source.slice(source.indexOf('function splitTableRow('), source.indexOf('class HeadingFoldWidget'));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; }
  get childNodes() { return this.children; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() {}
  fire(type, overrides = {}) { this.listeners[type]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...overrides }); }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if ((selector === 'th, td' && ['th', 'td'].includes(child.tag)) || (selector === '.cm-md-table-widget' && child.className?.includes('cm-md-table-widget'))) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}
const document = { createElement: (tag) => new Element(tag), createTextNode: (text) => Object.assign(new Element('#text'), { textContent: text }) };
const compiled = ts.transpile(fragment + '\nreturn { splitTableRow, TableWidget, renderTableCell };', { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
const { splitTableRow, TableWidget, renderTableCell } = new Function('WidgetType', 'document', compiled)(class {}, document);
assert.deepEqual(splitTableRow('| a\\|b | c |', 0).map((c) => c.text), ['a\\|b', 'c']);
assert.equal(splitTableRow('|  | x |', 0)[0].text, '');
assert.equal(splitTableRow('| a\\\\| b |', 0).length, 2);
const cell = new Element('td');
renderTableCell(cell, '`## 标题`');
assert.equal(cell.children[1].tag, 'code');
assert.equal(cell.children[1].textContent, '## 标题');
renderTableCell(cell, '<img src=x onerror=alert(1)>');
assert.equal(cell.children[0].tag, '#text');
function fixture() {
  let state = EditorState.create({ doc: 'before\n\n| a | b |\n| --- | --- |\n| c | d |\n\nafter', selection: { anchor: 0 } });
  const header = state.doc.line(3), row = state.doc.line(5);
  const region = { from: header.from, to: row.to, firstLine: 3, lastLine: 5, align: [null, null], rows: [{ line: 3, cells: splitTableRow(header.text, header.from) }, { line: 5, cells: splitTableRow(row.text, row.from) }] };
  let writes = 0;
  const view = { get state() { return state; }, dispatch(spec) { writes++; state = state.update(spec).state; }, focus() {}, dom: new Element('div') };
  const widget = new TableWidget(region), wrap = widget.toDOM(view);
  view.dom.append(wrap);
  const td = wrap.querySelectorAll('th, td')[2];
  td.fire('mousedown');
  assert.equal(writes, 0, 'cell press must not dispatch a source selection');
  td.fire('click');
  assert.equal(td.children[0].className, 'cm-md-table-cell-placeholder');
  const input = td.children[1];
  assert.equal(input.tag, 'input');
  return { input, view, writes: () => writes };
}
let f = fixture();
f.input.value = '中文 | 单元格';
f.input.fire('blur');
assert.match(f.view.state.doc.toString(), /中文 \\\| 单元格/);
assert.equal(f.writes(), 1);
assert.equal(f.view.state.selection.main.head, 0);
f.input.fire('blur');
assert.equal(f.writes(), 1, 'commit once');
f = fixture(); f.input.value = 'cancel'; f.input.fire('keydown', { key: 'Escape' }); assert.equal(f.writes(), 0);
f = fixture(); f.input.value = '中文'; f.input.fire('compositionstart'); f.input.fire('keydown', { key: 'Enter' }); assert.equal(f.writes(), 0); f.input.fire('compositionend'); f.input.fire('keydown', { key: 'Enter' }); assert.equal(f.writes(), 1);
f = fixture(); f.input.value = 'next'; f.input.fire('keydown', { key: 'Tab' }); assert.equal(f.writes(), 1);
assert.ok(source.includes('activeLine === region.firstLine - 1'));
assert.ok(source.includes('activeLine === region.lastLine + 1'));
console.log('Table cell regression checks passed (mock DOM; desktop interaction still requires validation).');
