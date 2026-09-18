import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8');
function load(path, mocks, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: id => {
    if (!(id in mocks)) throw new Error(`Unmocked dependency: ${id}`);
    return mocks[id];
  }, console: { error() {} }, ...globals }, { filename: path });
  return exports;
}

// Exercise the real translation-import action without dialogs, disk writes or real papers.
let selected = 'fixture.pdf', fail = false;
const events = [];
const noop = () => {};
const native = {
  selectPdfFile: async () => selected,
  importTranslatedPdfToLibrary: async () => {
    events.push('import'); if (fail) throw new Error('fixture failure');
    return { file_id: 'translated-fixture' };
  },
};
const { useImportFlow } = load('src/features/library/useImportFlow.ts', {
  react: { useState: initial => [typeof initial === 'function' ? initial() : initial, noop] },
  '../../core/asterCore': { createImportDraft: () => ({}) },
  '../reader': {}, '../../platform/nativeApi': native, '../../ui/tagInput': {},
  '../../ui/zh': { zh: { library: { translationImportFailed: 'fixture import failed' } } },
});
const props = {
  aster: {}, selectedPaper: { paperId: 'fixture-paper' },
  refreshNativeDocuments: async id => events.push(`refresh:${id}`),
  setReaderContentMode: value => events.push(`content:${value}`),
  setReaderFileMode: value => events.push(`mode:${value}`),
  setReaderTranslatedFileId: value => events.push(`file:${value}`),
  setLibraryStatus: value => events.push(`status:${value}`),
  openReaderForPaper: noop, setSelectedPaperId: noop, setActiveTag: noop, setRevision: noop,
};
await useImportFlow(props).importTranslatedPdf();
assert.deepEqual(events, ['import', 'refresh:fixture-paper', 'content:pdf', 'mode:translated', 'file:translated-fixture', 'status:']);
events.length = 0; fail = true;
await useImportFlow(props).importTranslatedPdf();
assert.deepEqual(events, ['import', 'status:fixture import failed']);
events.length = 0; selected = null;
await useImportFlow(props).importTranslatedPdf();
assert.deepEqual(events, []);
await useImportFlow({ ...props, selectedPaper: null }).importTranslatedPdf();
assert.deepEqual(events, []);

// DOM listener contract; actual Portal/SVG hit-testing and CSS geometry are browser-tested separately.
class Element {
  constructor(interactive = false) { this.interactive = interactive; }
  closest(selector) { assert.ok(selector.includes('button')); return this.interactive ? this : null; }
}
class HTMLElement extends Element {
  constructor() { super(); this.offsetHeight = this.clientHeight = 30; this.offsetWidth = this.clientWidth = 100; }
  getBoundingClientRect() { return { top: 0, left: 0 }; }
}
const listeners = new Map();
const root = { contains: target => target !== outside,
  addEventListener(type, fn, capture) { assert.equal(capture, true); listeners.set(type, fn); },
  removeEventListener(type, fn, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), fn); listeners.delete(type); },
};
const outside = new Element();
const commands = [];
const { bindWindowTitlebarGestures } = load('src/workbench/windowTitlebarGestures.ts', {}, { Element, HTMLElement });
const dispose = bindWindowTitlebarGestures(root, command => commands.push(command));
function emit(type, target = new HTMLElement(), extra = {}) {
  const event = { target, button: 0, detail: type === 'dblclick' ? 2 : 1, clientX: 5, clientY: 5, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
  listeners.get(type)(event); return event;
}
assert.equal(emit('mousedown').defaultPrevented, true);
emit('dblclick');
assert.deepEqual(commands, ['start_dragging', 'toggle_maximize']);
for (const type of ['mousedown', 'dblclick']) {
  emit(type, new Element(true)); emit(type, outside); emit(type, new HTMLElement(), { button: 2 });
}
emit('mousedown', new HTMLElement(), { detail: 2 });
assert.deepEqual(commands, ['start_dragging', 'toggle_maximize']);
const scrolling = new HTMLElement();
Object.assign(scrolling, { offsetHeight: 40, clientHeight: 30, scrollWidth: 500, clientWidth: 100, clientTop: 0 });
assert.equal(emit('mousedown', scrolling, { clientY: 35 }).defaultPrevented, false);
dispose(); assert.equal(listeners.size, 0);

const chrome = read('src/workbench/WindowTitleBar.tsx');
assert.match(chrome, /bindWindowTitlebarGestures\(titlebar/);
assert.match(chrome, /ref=\{titlebarRef\}/);
assert.doesNotMatch(chrome, /onMouseDown=\{handleTitlebarMouseDown\}/);
const css = read('src/features/reader/reader-annotation-dock.css');
const page = css.match(/\.reader-page-overlay\.page-jump-shell \{([^}]+)\}/)[1];
assert.match(page, /top: 4px; left: 6px/);
assert.match(page, /background: transparent/); assert.match(page, /box-shadow: none/);
assert.match(page, /border: 0/); assert.match(page, /--ui-caption-font-size/);
assert.match(css, /\.pdf-document-content::after/); assert.match(css, /height: 120px/);
assert.doesNotMatch(css, /padding-bottom:\s*76px/);
console.log('Reader chrome regression passed: import success/error/cancel, titlebar gesture guards/cleanup/scrollbars, page styling and end clearance. No native operations.');
