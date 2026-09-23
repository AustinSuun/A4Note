// Unit host for the real TS dispatcher. This is not a browser/desktop substitute.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
export function shortcutTestRuntime() {
  class Hub {
    listeners = new Map();
    addEventListener(type, fn) { const list = this.listeners.get(type) ?? new Set(); list.add(fn); this.listeners.set(type, list); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, fields = {}) {
      const event = { key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
        defaultPrevented: false, getModifierState: () => false, preventDefault() { this.defaultPrevented = true; }, ...fields };
      for (const fn of this.listeners.get(type) ?? []) fn(event);
      return event;
    }
  }
  class Element {
    constructor(kind = '') { this.kind = kind; this.isContentEditable = kind === 'contenteditable'; }
    isConnected = true;
    matches() { return ['input', 'textarea', 'select'].includes(this.kind); }
    closest(selector) { return selector.includes('.cm-editor') && this.kind === 'cm' ? this : null; }
    getBoundingClientRect() { return { width: 100, height: 100 }; }
  }
  const doc = new Hub(), win = new Hub();
  Object.assign(doc, { activeElement: null, visibilityState: 'visible', focused: true, hasFocus: () => doc.focused, modals: [], querySelectorAll: () => doc.modals });
  win.document = doc;
  const timers = new Map(); let clock = 0, timerId = 0;
  const globals = { Element, HTMLElement: Element, getComputedStyle: () => ({ visibility: 'visible' }),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const cache = new Map();
  function load(file) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
      exports, console, ...globals, require: id => load(path.resolve(path.dirname(file), id + '.ts')),
    }, { filename: file });
    return exports;
  }
  const { ShortcutStore } = load('src/shared/shortcuts/store.ts');
  const { attachShortcutDispatcher } = load('src/shared/shortcuts/dispatcher.ts');
  const { createAppShortcutCommands } = load('src/ui/shortcuts/appShortcutCommands.ts');
  const persisted = new Map();
  const storage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) };
  const store = new ShortcutStore(storage), events = [];
  const action = name => () => { events.push(name); };
  const options = { scenes: [{ id: 'library', label: '文献库', key: '2' }], hasPaper: true, pdfMode: true, hasSourcePdf: true, hasTranslatedPdf: true, focusedAnnotation: true, canUndo: true, canRedo: true,
    palette: action('palette'), openScene: action('scene'), importPdf: action('import'), librarySearch: () => events.push('library', 'library-search'),
    pdfSearch: action('find-pdf'), undo: action('undo'), redo: action('redo'), deleteAnnotation: action('delete'), cancel: () => { events.push('cancel'); return true; },
    selectTool: tool => events.push(tool), selectReaderFileMode: mode => events.push(`mode-${mode}`), pdfZoom: action('pdf-zoom'), fitWidth: action('fit'), uiZoom: action('ui-zoom') };
  const commands = createAppShortcutCommands(options);
  store.register('app', commands); store.setContext('reader', false);
  const dispose = attachShortcutDispatcher(store, win);
  function key(key, target = new Element(), extra = {}) {
    events.length = 0;
    const event = win.emit('keydown', { key, target, ctrlKey: true, ...extra });
    return { events: [...events], event };
  }
  return { Element, doc, win, store, key, events, commands, options, storage, persisted, ShortcutStore, dispose,
    advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } } };
}
