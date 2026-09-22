import { shortcutTestRuntime } from './shortcut-test-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
let checks = 0;
const check = (value, expected, label) => { assert.deepEqual(JSON.parse(JSON.stringify(value)), expected, label); checks++; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: id => {
    if (id in mocks) return mocks[id];
    if (id.endsWith('.css')) return {};
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(file), id);
      const resolved = [base, base + '.ts', base + '.tsx'].find(p => fs.existsSync(p));
      if (resolved) return load(resolved, mocks, globals);
    }
    throw new Error(`Unmocked ${id} in ${file}`);
  }, console, Date, JSON, Map, Set, ...globals }, { filename: file });
  return exports;
}
function hooks() {
  const slots = []; let index = 0; let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useLayoutEffect() { index++; },
    useMemo(fn) { index++; return fn(); },
    lazy: () => 'PdfReader', Suspense: 'Suspense',
  };
  return { react, render(fn) { index = 0; effects = []; return fn(); }, flush() { effects.forEach(fn => fn()); effects = []; } };
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function find(node, predicate) {
  if (!node) return;
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } }
  else if (typeof node === 'object') { if (predicate(node)) return node; return find(node.props?.children, predicate); }
}
const zh = { reader: { pageStatus: (p, t) => `${p}/${t}`, fitWidth: 'FIT', zoomOut: 'OUT', zoomReset: 'RESET', zoomIn: 'IN' }, workbench: {} };

// Run the actual registry and application dispatcher (previously extracted App's removed listener).
{
  const runtime = shortcutTestRuntime();
  const { Element, key, store } = runtime;
  for (const kind of ['input', 'textarea', 'select', 'contenteditable', 'cm']) {
    check(key('z', new Element(kind)).events, [], 'text field owns undo');
    check(key('y', new Element(kind)).events, [], 'text field owns redo');
  }
  check(key('z', undefined, { defaultPrevented: true }).events, [], 'respect handled events');
  check(key('z', undefined, { isComposing: true }).events, [], 'respect IME');
  check(key('z').events, ['undo'], 'canvas undo'); check(key('y').events, ['redo'], 'canvas redo');
  check(key('f').events, ['find-pdf'], 'reader search remains in reader');
  store.setContext('library', false);
  check(key('f').events, ['library', 'library-search'], 'library search preserved');
  runtime.dispose();
}

// Page entry: focus protects draft; Enter commits once; Escape cancels; a different paper resets.
{
  const h = hooks(); const jumps = [];
  const { ReaderPageControl } = load('src/features/reader/ReaderPageControl.tsx', { react: h.react, 'react/jsx-runtime': jsx,
    '../../ui/zh': { zh }, '../../workbench/DocumentToolbar': { useDocumentToolbarActive: () => true }, './ReaderNoteActivity': { useReaderNoteActive: () => true } });
  let page = 1, paperId = 'p';
  const render = () => find(h.render(() => ReaderPageControl({ paperId, readerPageState: { currentPage: page, totalPages: 30 }, onJumpToPage: p => jumps.push(p) })), n => n.type === 'input').props;
  let input = render(); h.flush(); input.onFocus(); input.onChange({ target: { value: '23' } }); page = 2; input = render(); h.flush(); input = render();
  check(input.value, '23', 'page change must not overwrite editing');
  input.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {}, currentTarget: { blur: () => input.onBlur() } }); check(jumps, [23], 'one jump for Enter+blur');
  input = render(); input.onFocus(); input.onChange({ target: { value: '29' } }); input = render(); input.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {}, stopPropagation() {}, currentTarget: { blur: () => input.onBlur() } }); check(jumps, [23], 'Escape does not submit');
  input = render(); check(input.value, '2', 'Escape restores current');
  input.onFocus(); input.onChange({ target: { value: '12' } }); paperId = 'other'; page = 1; render(); h.flush(); check(render().value, '1', 'new paper reset');
}

// Actual resource component with a simulated native persistence boundary.
{
  const h = hooks(); let failRead = false, failWrite = false, release; let calls = 0;
  const native = { isTauriRuntime: () => true,
    listNativeResourceAnnotations: async () => { if (failRead) throw Error('read denied'); return [{ id: 'a', resource_id: 'r', page: 1, annotation_type: 'highlight', quote: 'q', comment: '', color: 'yellow', position_json: '{}', created_at: Date.now() }]; },
    updateNativeResourceAnnotationColor: async () => { calls++; if (failWrite) throw Error('write denied'); await new Promise(r => release = r); },
    deleteNativeResourceAnnotation: async () => { if (failWrite) throw Error('delete denied'); },
  };
  let fitted = false;
  const { PdfResourceTab } = load('src/features/reader/PdfResourceTab.tsx', { react: h.react, 'react/jsx-runtime': jsx,
    '../../ui/zh': { zh }, '../../platform/nativeApi': native, '../../platform/projects': {}, './pdf/pdfSource': { resourcePdfSource: () => ({}) },
    './pdf/pdfZoomAnchor': {}, './pdf/types': { defaultReaderToolSettings: {} }, './ReaderIcons': {}, './readerNavigation': { pdfFitWidth: () => { fitted = true; return 0.73; } },
  });
  let tree; const render = () => tree = h.render(() => PdfResourceTab({ path: 'fixture.pdf', name: 'fixture', resourceId: 'r' }));
  const pdf = () => find(tree, n => n.type === 'PdfReader').props;
  render(); h.flush(); await tick(); render(); check(pdf().annotations[0].color, 'yellow', 'loaded');
  failWrite = true; await assert.rejects(pdf().onUpdateAnnotationColor('a', 'blue')); render(); check(pdf().annotations[0].color, 'yellow', 'failed write does not lie');
  await assert.rejects(pdf().onDeleteAnnotation('a')); render(); check(pdf().annotations.length, 1, 'failed delete keeps annotation');
  failWrite = false;
  const first = pdf().onUpdateAnnotationColor('a', 'blue'); const second = pdf().onUpdateAnnotationColor('a', 'green'); await tick(); check(calls, 2, 'second write waits'); release(); await first; await tick(); check(calls, 3, 'second write starts after first'); release(); await second; render(); check(pdf().annotations[0].color, 'green', 'latest successful write wins');
  // Trigger the real load effect in a fresh instance with failure.
  const h2 = hooks(); const { PdfResourceTab: Resource2 } = load('src/features/reader/PdfResourceTab.tsx', { react: h2.react, 'react/jsx-runtime': jsx, '../../ui/zh': { zh }, '../../platform/nativeApi': native, '../../platform/projects': {}, './pdf/pdfSource': { resourcePdfSource: () => ({}) }, './pdf/pdfZoomAnchor': {}, './pdf/types': { defaultReaderToolSettings: {} }, './ReaderIcons': {}, './readerNavigation': {} });
  failRead = true; const render2 = () => h2.render(() => Resource2({ path: 'f', name: 'f', resourceId: 'r' })); render2(); h2.flush(); await tick(); const failed = render2();
  assert.ok(find(failed, n => n.props?.role === 'alert')); checks++;
  check(find(failed, n => n.type === 'PdfReader').props.annotationsEnabled, false, 'load failure disables writes');
  failRead = false; find(failed, n => n.type === 'button' && n.props.children === '重试读取标注').props.onClick(); render2(); h2.flush(); await tick(); check(find(render2(), n => n.type === 'PdfReader').props.annotationsEnabled, true, 'retry restores annotations');
}

// Geometry, literal Unicode search, multi-fragment terms, whitespace and bounded results.
{
  const { pdfFitWidth } = load('src/features/reader/readerNavigation.ts', {}, { getComputedStyle: () => ({ paddingLeft: '12px', paddingRight: '12px' }) });
  const scroller = (width, base) => ({ clientWidth: width, querySelector: () => ({ dataset: { baseWidth: String(base) } }) });
  check(pdfFitWidth(scroller(1200, 600)), 1.94, 'wide fit'); check(pdfFitWidth(scroller(480, 600)), 0.74, 'narrow fit');
  check(pdfFitWidth(scroller(480, 900)), 0.49, 'landscape fit'); check(pdfFitWidth(scroller(0, 600)), null, 'hidden root no fit');
  check(pdfFitWidth(scroller(480, 0)), null, 'invalid metadata no fit');
  check(pdfFitWidth(scroller(20, 600)), 0.2, 'minimum'); check(pdfFitWidth(scroller(9000, 600)), 5, 'maximum');
  const { findPdfMatches } = load('src/features/reader/pdf/pdfSearch.ts');
  const item = (text, x = 0, y = 0, width = 10) => ({ text, x, y, width, height: 2, fontSize: 12 });
  const pages = [{ pageNumber: 1, textItems: [item('Hello'), item('World', 12), item('中文', 0, 10), item('检索', 10, 10)] }, { pageNumber: 2, textItems: [item('HELLO [a+b].')] }];
  check(findPdfMatches(pages, 'hello').matches.map(m => m.page), [1, 2], 'cross-page case insensitive');
  check(findPdfMatches(pages, 'Hello World').matches[0].indices, [0, 1], 'fragment whitespace');
  check(findPdfMatches(pages, '中文检索').matches[0].indices, [2, 3], 'adjacent Chinese fragments');
  check(findPdfMatches(pages, '[a+b].').matches.length, 1, 'regex metacharacters are literal');
  check(findPdfMatches(pages, '   ').matches.length, 0, 'blank query');
  check(findPdfMatches([{ pageNumber: 1, textItems: [item('aaa')] }], 'a', 2).truncated, true, 'bounded search');
}

// Normal annotation work remains internal: every tool may save concurrently without a progress/status notice.
{
  const h = hooks(); const { useReaderSaveQueue } = load('src/features/reader/useReaderSaveQueue.tsx', { react: h.react, 'react/jsx-runtime': jsx });
  let queue; const render = () => queue = h.render(() => useReaderSaveQueue('normal-operations'));
  render(); h.flush();
  const releases = [];
  const labels = ['保存高亮', '保存下划线', '保存笔迹', '擦除笔迹', '保存文字', '保存图形', '保存箭头', '移动标注', '调整标注大小'];
  const pending = labels.map((label, index) => queue.run(label, () => new Promise(resolve => releases.push(resolve)), undefined, `annotation-${index}`));
  render();
  check(queue.feedback.props.children.length, 0, 'all annotation tools hide normal-operation progress');
  assert.equal(find(queue.feedback, node => node.props?.role === 'status'), undefined, 'normal saves never expose a status row'); checks++;
  releases.forEach(resolve => resolve());
  await Promise.all(pending); render();
  check(queue.feedback.props.children.length, 0, 'rapid normal saves leave no queued notice');
}

// Delayed and out-of-order parent/native publications cannot displace the newest optimistic geometry.
{
  const {
    annotationPositionsEqual,
    createOptimisticAnnotationPosition,
    discardOptimisticAnnotationPosition,
    reconcileOptimisticAnnotationPosition,
  } = load('src/features/reader/pdf/annotationPositionOptimism.ts');
  const original = { x: 10, y: 20, width: 22, nested: { edge: [1, 2] } };
  const firstPosition = { ...original, x: 30, y: 35 };
  const secondPosition = { ...original, x: 55, y: 62 };
  const first = createOptimisticAnnotationPosition(1, firstPosition);
  const second = createOptimisticAnnotationPosition(2, secondPosition);
  check(annotationPositionsEqual(original, { width: 22, nested: { edge: [1, 2] }, y: 20, x: 10 }), true, 'position equality ignores key order');
  assert.equal(reconcileOptimisticAnnotationPosition(second, original), second, 'old committed geometry cannot clear latest drag'); checks++;
  assert.equal(reconcileOptimisticAnnotationPosition(second, first.positionJson), second, 'out-of-order first completion cannot clear second drag'); checks++;
  assert.equal(discardOptimisticAnnotationPosition(second, first.revision), second, 'discarding older failure cannot revert newer drag'); checks++;
  assert.equal(reconcileOptimisticAnnotationPosition(second, second.positionJson), undefined, 'matching latest completion settles optimism'); checks++;
  assert.equal(discardOptimisticAnnotationPosition(first, first.revision), undefined, 'explicit discard restores committed geometry'); checks++;
}

// Retryable retained draft jobs: initial failure, retry deduplication, success and discard.
{
  const h = hooks(); const { useReaderSaveQueue } = load('src/features/reader/useReaderSaveQueue.tsx', { react: h.react, 'react/jsx-runtime': jsx });
  let queue; const render = () => queue = h.render(() => useReaderSaveQueue('source'));
  render(); h.flush(); let attempts = 0, finish;
  check(await queue.run('保存标注', async () => { attempts++; if (attempts === 1) throw Error('denied'); await new Promise(r => finish = r); }), false, 'failure retained');
  render(); assert.ok(find(queue.feedback, n => n.props?.role === 'alert')); checks++;
  const retry = find(queue.feedback, n => n.type === 'button' && n.props.children === '重试').props.onClick;
  retry(); retry(); check(attempts, 2, 'double retry is deduplicated'); finish(); await tick(); render(); check(queue.feedback.props.children.length, 0, 'success clears feedback');
  let discarded = false; await queue.run('草稿', async () => { throw Error('fail'); }, () => discarded = true); render();
  find(queue.feedback, n => n.type === 'button' && n.props.children === '放弃未保存标注').props.onClick(); check(discarded, true, 'explicit discard removes retained preview');
}

// Superseded retry closures must never replay an old edit, even before React paints.
{
  const h = hooks(); const { useReaderSaveQueue } = load('src/features/reader/useReaderSaveQueue.tsx', { react: h.react, 'react/jsx-runtime': jsx });
  let queue, scope = 'first', attempts = 0;
  const render = () => queue = h.render(() => useReaderSaveQueue(scope));
  render(); h.flush();
  await queue.run('old', async () => { attempts++; throw Error('fail'); }, undefined, 'a'); render();
  const staleRetry = find(queue.feedback, n => n.type === 'button' && n.props.children === '重试').props.onClick;
  await queue.run('new', async () => {}, undefined, 'a'); render();
  check(queue.feedback.props.children.length, 0, 'new successful edit supersedes failed retry');
  staleRetry(); await tick(); check(attempts, 1, 'detached stale retry cannot replay');
  await queue.run('other', async () => { throw Error('fail'); }, undefined, 'b');
  await queue.run('new a', async () => {}, undefined, 'a'); render();
  check(queue.feedback.props.children.length, 1, 'unrelated annotation failure is retained');
  scope = 'second'; render(); h.flush(); render();
  check(queue.feedback.props.children.length, 0, 'source switch clears old jobs');
}

// Dispatch and render the real paper-scoped notification, including dismiss and cleanup.
{
  const h = hooks(), target = new EventTarget();
  const globals = { window: target, CustomEvent };
  const errors = load('src/features/reader/readerSaveErrors.ts', {}, globals);
  const { ReaderSaveErrorNotice } = load('src/features/reader/ReaderSaveErrorNotice.tsx', { react: h.react, 'react/jsx-runtime': jsx }, globals);
  let paperId = 'one'; const render = () => h.render(() => ReaderSaveErrorNotice({ paperId }));
  render(); h.flush();
  errors.reportReaderSaveError('two', 'wrong'); check(render(), null, 'ignore another paper');
  errors.reportReaderSaveError('one', 'write failed'); const notice = render();
  check(notice.props.role, 'alert', 'active paper gets visible alert');
  assert.ok(find(notice, n => n.type === 'span').props.children.some(text => String(text).includes('未确认保存成功'))); checks++;
  find(notice, n => n.type === 'button').props.onClick(); check(render(), null, 'dismiss works');
  paperId = 'two'; render(); h.flush(); errors.reportReaderSaveError('one', 'late');
  check(render(), null, 'old paper listener is removed');
}

// Execute the real comment save function to prove draft retention and single creation.
{
  const source = fs.readFileSync('src/features/reader/pdf/PdfReader.tsx', 'utf8');
  const start = source.indexOf('  const saveComment = async () => {');
  const end = source.indexOf('  const saveAnnotationDraft', start);
  const code = ts.transpileModule(source.slice(start, end) + ';globalThis.save=saveComment;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const popover = { text: 'important draft', x: 1, y: 2, page: 1, annotationType: 'text' };
  let fail = true, creates = 0, closes = 0, release;
  const context = { commentPopover: popover, commentSavingRef: { current: false }, source: { key: 's' }, sourceKeyRef: { current: 's' },
    setCommentSaving() {}, setCommentSaveError: value => context.error = value,
    setCommentPopover: fn => { if (fn(popover) === null) closes++; },
    buildAnnotationDraft: (type, position, color) => ({ type, positionJson: position, color }), activeAnnotationColor: 'yellow', zh: { reader: { textLabel: 'Text' } },
    onCreateAnnotation: async draft => { creates++; assert.equal(draft.comment, 'important draft'); if (fail) throw Error('write denied'); await new Promise(r => release = r); },
    onUpdateAnnotationComment: () => { throw Error('creation must not issue redundant second write'); },
  };
  vm.createContext(context); vm.runInContext(code, context);
  await context.save(); check(closes, 0, 'failed text save leaves editor open'); assert.match(context.error, /内容已保留/); checks++;
  check(context.commentSavingRef.current, false, 'failed save unlocks retry');
  fail = false; const pending = context.save(); await context.save(); check(creates, 2, 'pending text save cannot double submit');
  release(); await pending; check(closes, 1, 'only successful save closes editor');
}

console.log(`PASS ${checks} reader priority behavior assertions; simulated React/native boundaries, not desktop E2E.`);
