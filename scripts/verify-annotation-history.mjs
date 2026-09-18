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
// Real hook, simulated React lifecycle and native writes. No user documents or desktop APIs.
const copy = value => JSON.parse(JSON.stringify(value));
const seed = (id = 'a', paperId = 'one') => ({ id, paperId, fileId: 'file-' + paperId, page: 1, type: 'highlight', quote: '', color: '#ffff00', comment: 'old', positionJson: { x: 1, y: 2 }, createdAt: '2026-09-18' });
function fixture() {
  const h = hooks(), papers = new Map(['one', 'two'].map(id => [id, { paperId: id, sourceFileId: 'file-' + id, annotations: [seed(id === 'one' ? 'a' : 'b', id)] }]));
  const disk = new Map([...papers.values()].flatMap(p => p.annotations).map(a => [a.id, copy(a)]));
  const calls = [], notices = [], focus = []; let selected = 'one', api, failure = false, gate, id = 0, nativeMode = true;
  const write = async (kind, args, commit) => {
    calls.push({ kind, args: copy(args) });
    if (gate) { const wait = gate; gate = null; await wait; }
    if (failure) { failure = false; throw Error('write denied'); }
    return commit();
  };
  const native = {
    isTauriRuntime: () => nativeMode,
    createNativeAnnotation: args => write('create', args, () => { const a = { ...copy(args), id: 'new-' + ++id }; disk.set(a.id, a); return a; }),
    restoreNativeAnnotation: a => write('restore', a, () => disk.set(a.id, copy(a))),
    deleteNativeAnnotation: annotationId => write('delete', annotationId, () => disk.delete(annotationId)),
    updateNativeAnnotationComment: args => write('comment', args, () => { disk.get(args.annotationId).comment = args.comment; }),
    updateNativeAnnotationColor: args => write('color', args, () => { disk.get(args.annotationId).color = args.color; }),
    updateNativeAnnotationPosition: args => write('position', args, () => { disk.get(args.annotationId).positionJson = copy(args.positionJson); }),
  };
  const core = { documents: { get: key => papers.get(key) }, commands: { execute: (_command, args) => { const a = { ...copy(args.annotation), paperId: args.paperId, id: 'web-' + ++id }; papers.get(args.paperId).annotations.push(a); return a; } } };
  const { useAnnotationHistory } = load('src/features/reader/useAnnotationHistory.ts', { react: h.react, '../../platform/nativeApi': native, './readerHelpers': { preferredTranslatedFileId: () => 'translated' }, './readerSaveErrors': { reportReaderSaveError: (paper, message) => notices.push({ paper, message }) } }, { console: { error() {} } });
  const render = () => { api = h.render(() => useAnnotationHistory({ aster: core, selectedPaper: papers.get(selected), readerFileMode: 'source', readerTranslatedFileId: '', setReaderFocusedAnnotationId: value => focus.push(value), setRevision() {}, setLibraryStatus() {} })); h.flush(); return api; };
  render();
  return { get api() { return api; }, render, papers, disk, calls, notices, focus,
    select(key) { selected = key; return render(); }, fail() { failure = true; }, web() { nativeMode = false; },
    hold() { let resolve; gate = new Promise(r => resolve = r); return resolve; },
    annotation(key = 'one') { return papers.get(key).annotations[0]; },
  };
}

// Every history action must keep model/stacks unchanged while pending or on failure.
for (const kind of ['comment', 'color', 'position', 'create', 'delete']) {
  const f = fixture();
  const draft = { type: 'highlight', quote: '', comment: '', page: 1, color: '#00ff00', positionJson: { x: 3, y: 4 } };
  const mutate = () => kind === 'comment' ? f.api.updateAnnotationComment('a', 'new') : kind === 'color' ? f.api.updateAnnotationColor('a', '#ff0000') : kind === 'position' ? f.api.updateAnnotationPosition('a', { x: 9, y: 8 }) : kind === 'create' ? f.api.createAnnotation(draft) : f.api.deleteAnnotation('a');
  const initial = copy(f.papers.get('one').annotations);
  f.fail(); await assert.rejects(mutate(), /write denied/); checks++;
  check(f.papers.get('one').annotations, initial, kind + ': failed edit keeps model');
  check(f.render().annotationUndoStack.length, 0, kind + ': failed edit creates no history');
  const release = f.hold(), pending = mutate(); await tick();
  check(f.papers.get('one').annotations, initial, kind + ': pending edit keeps model');
  release(); await pending; f.render();
  check(f.api.annotationUndoStack.length, 1, kind + ': success pushes history');
  const changed = copy(f.papers.get('one').annotations);
  f.fail(); check(await f.api.undoAnnotationAction(), false, kind + ': rejected undo is safely consumed'); f.render();
  check(f.papers.get('one').annotations, changed, kind + ': failed undo keeps model');
  check([f.api.annotationUndoStack.length, f.api.annotationRedoStack.length], [1, 0], kind + ': failed undo keeps stacks');
  const releaseUndo = f.hold(), undo = f.api.undoAnnotationAction(); await tick();
  check(f.papers.get('one').annotations, changed, kind + ': pending undo keeps model');
  releaseUndo(); check(await undo, true, kind + ': retry undo succeeds'); f.render();
  check(f.papers.get('one').annotations, initial, kind + ': undo restores original model');
  check([f.api.annotationUndoStack.length, f.api.annotationRedoStack.length], [0, 1], kind + ': undo moves one entry');
  f.fail(); check(await f.api.redoAnnotationAction(), false, kind + ': redo failure safely consumed'); f.render();
  check(f.papers.get('one').annotations, initial, kind + ': failed redo keeps model');
  check([f.api.annotationUndoStack.length, f.api.annotationRedoStack.length], [0, 1], kind + ': failed redo keeps stacks');
  check(await f.api.redoAnnotationAction(), true, kind + ': redo retry succeeds'); f.render();
  check(f.papers.get('one').annotations, changed, kind + ': redo restores changed model');
  check(f.papers.get('one').annotations.map(a => [a.id, a.comment ?? '', a.color, a.positionJson]), [...f.disk.values()].filter(a => a.paperId === 'one').map(a => [a.id, a.comment ?? '', a.color, a.positionJson]), kind + ': model matches mock disk');
  check(f.notices.length, 3, kind + ': each failure visible');
}

{
  const f = fixture(), release = f.hold();
  const first = f.api.updateAnnotationComment('a', 'first'); const second = f.api.updateAnnotationComment('a', 'second');
  const undo = f.api.undoAnnotationAction(); await tick();
  check(f.calls.length, 1, 'edit and undo share one queue'); release(); await Promise.all([first, second, undo]); f.render();
  check(f.annotation().comment, 'first', 'queued undo uses successful second edit history');
  check(f.disk.get('a').comment, 'first', 'serial write order matches model');
  check(f.api.annotationUndoStack[0].previous, 'old', 'first edit captures initial value');
  await f.api.redoAnnotationAction(); f.render();
  await Promise.all([f.api.undoAnnotationAction(), f.api.undoAnnotationAction()]); f.render();
  check(f.annotation().comment, 'old', 'rapid undo consumes different stack entries');
  check(f.api.annotationRedoStack.length, 2, 'rapid undo retains both redo entries');
  f.fail(); await assert.rejects(f.api.updateAnnotationComment('a', 'failed'), /write denied/);
  check(f.render().annotationRedoStack.length, 2, 'failed branch edit preserves redo');
  await f.api.updateAnnotationComment('a', 'branch'); check(f.render().annotationRedoStack.length, 0, 'successful branch edit clears redo');
}
{
  const f = fixture(), release = f.hold(); f.fail();
  const first = f.api.updateAnnotationComment('a', 'bad').catch(() => {});
  const second = f.api.updateAnnotationComment('a', 'good'); await tick(); release(); await Promise.all([first, second]); f.render();
  check(f.annotation().comment, 'good', 'failed earlier edit cannot roll back newer edit');
  check(f.api.annotationUndoStack[0].previous, 'old', 'queued edit snapshots last committed value, not failed value');
  check(f.api.annotationUndoStack.length, 1, 'only successful queued edit in history');
}
{
  const f = fixture(); await f.api.updateAnnotationComment('a', 'new'); f.render();
  const release = f.hold(), undo = f.api.undoAnnotationAction(); await tick(); f.select('two');
  release(); await undo;
  check(f.annotation('two').comment, 'old', 'late undo never changes new paper');
  check(f.focus.length, 0, 'late undo does not steal current paper focus');
  check(f.render().annotationRedoStack.length, 0, 'late completion never populates another paper history');
  f.select('one'); check(f.api.annotationRedoStack.length, 1, 'paper-local redo preserved on return');
  const releaseEdit = f.hold(), edit = f.api.updateAnnotationComment('a', 'accepted');
  const queuedUndo = f.api.undoAnnotationAction(); await tick(); f.select('two'); releaseEdit(); await edit;
  check(await queuedUndo, false, 'not-started history shortcut cancelled after paper switch');
  check(f.annotation('one').comment, 'accepted', 'accepted edit still saves to original paper');
}
{
  const f = fixture(); await f.api.updateAnnotationComment('a', 'new'); f.render();
  const release = f.hold(), undo = f.api.undoAnnotationAction(); await tick(); f.api.clearAnnotationHistory(); f.render();
  release(); await undo; f.render();
  check([f.api.annotationUndoStack.length, f.api.annotationRedoStack.length], [0, 0], 'clear generation cannot be repopulated by late completion');
  check(f.disk.get('a').comment, f.annotation().comment, 'clear during in-flight undo does not diverge model and mock disk');
}
{
  const f = fixture(), position = { x: 3, y: 4 }; const release = f.hold();
  const p = f.api.updateAnnotationPosition('a', position); position.x = 999; await tick(); release(); await p; f.render();
  check(f.annotation().positionJson.x, 3, 'position snapshots caller mutation');
  f.annotation().positionJson.x = 123; await f.api.undoAnnotationAction(); await f.api.redoAnnotationAction();
  check(f.annotation().positionJson.x, 3, 'position history snapshots model mutation');
  await Promise.all([f.api.deleteAnnotation('a'), f.api.deleteAnnotation('a')]);
  check(f.calls.filter(c => c.kind === 'delete').length, 1, 'duplicate delete issues one write');
}
{
  const f = fixture(); for (let i = 0; i < 43; i++) await f.api.updateAnnotationComment('a', String(i));
  check(f.render().annotationUndoStack.length, 40, 'history capped at forty per paper');
  const calls = f.calls.length; await f.api.updateAnnotationComment('a', '42');
  check(f.calls.length, calls, 'no-op skips native write');
  f.web(); await f.api.updateAnnotationColor('a', '#111111'); await f.api.undoAnnotationAction();
  check(f.annotation().color, '#ffff00', 'browser mode retains local history behavior');
  check(f.calls.length, calls, 'browser mode does not call native writes');
}
{
  const f = fixture(), release = f.hold(); const save = f.api.updateAnnotationComment('a', 'refreshed'); await tick();
  f.papers.set('one', copy(f.papers.get('one'))); f.render(); release(); await save;
  check(f.annotation().comment, 'refreshed', 'commit resolves refreshed document object after native write');
  const count = f.calls.length;
  await assert.rejects(f.api.updateAnnotationComment('missing', 'value'), /标注已移除/); checks++;
  check(f.calls.length, count, 'missing annotation does not issue native write or false success');
}
{
  const f = fixture(), unhandled = []; const receive = error => unhandled.push(error);
  process.on('unhandledRejection', receive);
  try { f.fail(); void f.api.updateAnnotationColor('a', '#abcdef'); await tick(); await tick();
    check(unhandled.length, 0, 'ignored toolbar promise has an attached rejection handler');
    check(f.notices.length, 1, 'ignored promise failure still displays notification');
    check(f.annotation().color, '#ffff00', 'ignored promise failure retains saved model');
  } finally { process.off('unhandledRejection', receive); }
}
console.log(`PASS ${checks} annotation history behavior assertions (mock native boundary, not desktop E2E).`);
