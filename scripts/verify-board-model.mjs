// Task 4093839c phase 1: the board document model is pure and must fail on the previous tree
// (src/core/board/boardModel.ts does not exist there). Also covers the board-aware wiki link resolver.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = (relative) => ts.transpileModule(fs.readFileSync(new URL('../' + relative, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const data = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const model = await import(data(compile('src/core/board/boardModel.ts')));
const wiki = await import(data(compile('src/core/wikiLinks.ts')));
let passed = 0;
const check = async (name, work) => { await work(); passed += 1; console.log('PASS ' + name); };
const {
  createBoardDocument, parseBoardDocument, serializeBoardDocument, withBounds, elementBounds, unionBounds, hitTest, elementsInRect, translateElement, transformElement,
  bindingFor, applyArrowBindings, deleteElements, duplicateElements, bringToFront, sendToBack, appendInkPoint, createHistory, recordHistory, undoHistory, redoHistory,
  linkBoardToPaper, unlinkBoardFromPaper, boardLinkedToPaper, withElements, isBoardPath, boardDisplayName, zoomViewport, screenToWorld, worldToScreen, fitViewport,
  BOARD_MAX_ELEMENTS, BOARD_MAX_INK_POINTS, BOARD_HISTORY_LIMIT,
} = model;

const rect = (id, x, y, w = 100, h = 60, extra = {}) => ({ id, type: 'rect', x, y, w, h, stroke: 'auto', fill: 'transparent', strokeWidth: 2, ...extra });
const arrow = (id, a, b, extra = {}) => withBounds({ id, type: 'arrow', x: 0, y: 0, w: 0, h: 0, stroke: 'auto', fill: 'transparent', strokeWidth: 2, points: [a, b], head: 'end', ...extra });

await check('new document has a stable id, format marker and empty elements', () => {
  const doc = createBoardDocument({ title: 'T', now: '2026-09-28T00:00:00.000Z' });
  assert.equal(doc.format, 'a4board'); assert.equal(doc.version, 1); assert.match(doc.id, /^b_/); assert.deepEqual(doc.elements, []); assert.deepEqual(doc.links, []);
  const again = createBoardDocument({ title: 'T' });
  assert.notEqual(doc.id, again.id);
});

await check('serialize → parse round-trips elements, links and identity', () => {
  const doc = createBoardDocument({ title: 'T', id: 'b_fixed', now: '2026-09-28T00:00:00.000Z', links: [{ kind: 'paper', paperId: 'p1', title: 'Paper', linkedAt: 'now' }] });
  const filled = withElements(doc, [rect('r1', 10, 20), arrow('a1', { x: 0, y: 0 }, { x: 50, y: 50 }, { to: { elementId: 'r1', fx: 0.5, fy: 0.5 } }), { id: 'n1', type: 'note', x: 0, y: 0, w: 10, h: 10, stroke: 'transparent', fill: '#fef3c7', strokeWidth: 1, text: '便签\n第二行' }], 'later');
  const text = serializeBoardDocument(filled);
  assert.ok(text.endsWith('\n'));
  const parsed = parseBoardDocument(text);
  assert.ok(parsed.ok, parsed.error);
  assert.equal(parsed.document.id, 'b_fixed'); assert.equal(parsed.document.updatedAt, 'later'); assert.equal(parsed.document.createdAt, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(parsed.document.links, filled.links);
  assert.deepEqual(parsed.document.elements, filled.elements);
  assert.deepEqual(parsed.warnings, []);
});

await check('parse rejects empty, invalid JSON, foreign format, newer version and missing id explicitly', () => {
  assert.equal(parseBoardDocument('').ok, false);
  assert.match(parseBoardDocument('{').error, /JSON/);
  assert.match(parseBoardDocument('[]').error, /顶层/);
  assert.match(parseBoardDocument('{"format":"other"}').error, /a4board/);
  assert.match(parseBoardDocument('{"format":"a4board","version":99,"id":"x"}').error, /版本 99/);
  assert.match(parseBoardDocument('{"format":"a4board","version":1}').error, /id/);
});

await check('parse tolerates unknown elements/links with warnings instead of dropping the board', () => {
  const parsed = parseBoardDocument(JSON.stringify({ format: 'a4board', version: 1, id: 'b', kind: 'galaxy', links: [{ kind: 'web' }], elements: [{ id: 'x', type: 'hologram' }, rect('ok', 0, 0), rect('ok', 1, 1), { id: 'ink0', type: 'ink', points: [] }] }));
  assert.ok(parsed.ok);
  assert.equal(parsed.document.kind, 'whiteboard');
  assert.deepEqual(parsed.document.elements.map((element) => element.id), ['ok']);
  assert.equal(parsed.warnings.length, 5, JSON.stringify(parsed.warnings));
});

await check('element caps are enforced on load', () => {
  const many = Array.from({ length: BOARD_MAX_ELEMENTS + 5 }, (_, index) => rect('e' + index, index, 0));
  const parsed = parseBoardDocument(JSON.stringify({ format: 'a4board', version: 1, id: 'b', elements: many }));
  assert.ok(parsed.ok); assert.equal(parsed.document.elements.length, BOARD_MAX_ELEMENTS); assert.ok(parsed.warnings.some((warning) => warning.includes(String(BOARD_MAX_ELEMENTS))));
  let points = [];
  for (let index = 0; index < BOARD_MAX_INK_POINTS + 50; index += 1) points = appendInkPoint(points, { x: index * 5, y: 0 }, 1);
  assert.equal(points.length, BOARD_MAX_INK_POINTS);
  assert.equal(appendInkPoint([{ x: 0, y: 0 }], { x: 0.5, y: 0 }, 1).length, 1, 'points closer than minDistance are dropped');
});

await check('hit testing prefers the topmost element and respects shapes', () => {
  const elements = [rect('back', 0, 0, 200, 200), { ...rect('circle', 50, 50, 100, 100), id: 'circle', type: 'ellipse' }, arrow('line', { x: 300, y: 0 }, { x: 400, y: 100 })];
  assert.equal(hitTest(elements, { x: 100, y: 100 }).id, 'circle');
  assert.equal(hitTest(elements, { x: 52, y: 52 }).id, 'back', 'ellipse corner is outside the ellipse');
  assert.equal(hitTest(elements, { x: 350, y: 50 }).id, 'line');
  assert.equal(hitTest(elements, { x: 350, y: 70 }, 2), null);
  assert.equal(hitTest(elements, { x: 500, y: 500 }), null);
  const ink = withBounds({ id: 'ink', type: 'ink', x: 0, y: 0, w: 0, h: 0, stroke: 'auto', fill: 'transparent', strokeWidth: 4, points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 600 }] });
  assert.equal(hitTest([ink], { x: 50, y: 501 }).id, 'ink');
  assert.equal(hitTest([ink], { x: 50, y: 560 }), null, 'ink bounding box alone does not hit');
  assert.deepEqual(elementsInRect(elements, { x: 0, y: 0, w: 10, h: 10 }), ['back']);
  assert.deepEqual(elementsInRect(elements, { x: -10, y: -10, w: 500, h: 500 }), ['back', 'circle', 'line']);
});

await check('translate and transform keep points and boxes consistent', () => {
  const moved = translateElement(rect('r', 10, 10), 5, -5);
  assert.deepEqual([moved.x, moved.y], [15, 5]);
  const line = translateElement(arrow('a', { x: 0, y: 0 }, { x: 10, y: 20 }), 1, 1);
  assert.deepEqual(line.points, [{ x: 1, y: 1 }, { x: 11, y: 21 }]); assert.deepEqual([line.x, line.y, line.w, line.h], [1, 1, 10, 20]);
  const scaled = transformElement(rect('r', 0, 0, 100, 50), { x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 200, h: 25 });
  assert.deepEqual([scaled.w, scaled.h], [200, 25]);
  const flipped = transformElement(rect('r', 0, 0, 100, 50), { x: 0, y: 0, w: 100, h: 50 }, { x: 100, y: 0, w: -100, h: 50 });
  assert.ok(flipped.w >= 0 && flipped.h >= 0, 'boxes never go negative');
  const scaledArrow = transformElement(arrow('a', { x: 0, y: 0 }, { x: 100, y: 0 }), { x: 0, y: 0, w: 100, h: 1 }, { x: 0, y: 0, w: 50, h: 1 });
  assert.deepEqual(scaledArrow.points[1], { x: 50, y: 0 });
  assert.deepEqual(unionBounds([elementBounds(rect('a', 0, 0, 10, 10)), elementBounds(rect('b', 20, 20, 10, 10))]), { x: 0, y: 0, w: 30, h: 30 });
  assert.equal(unionBounds([]), null);
});

await check('arrow bindings follow their shapes, drop with deleted targets and survive duplication', () => {
  const box = rect('box', 100, 100, 100, 100);
  const binding = bindingFor([box], { x: 150, y: 100 });
  assert.deepEqual(binding, { elementId: 'box', fx: 0.5, fy: 0 });
  assert.equal(bindingFor([box], { x: 500, y: 500 }), undefined);
  assert.equal(bindingFor([box], { x: 150, y: 150 }, 'box'), undefined, 'an arrow never binds to the excluded element');
  const bound = arrow('a', { x: 0, y: 0 }, { x: 150, y: 100 }, { to: binding });
  const movedBox = translateElement(box, 50, 0);
  const followed = applyArrowBindings([movedBox, bound]).find((element) => element.id === 'a');
  assert.deepEqual(followed.points[1], { x: 200, y: 100 });
  const orphaned = deleteElements([movedBox, bound], new Set(['box']));
  assert.equal(orphaned.length, 1); assert.equal(orphaned[0].to, undefined, 'binding to a deleted element is removed, arrow stays');
  const { elements, ids } = duplicateElements([box, bound], new Set(['box', 'a']));
  assert.equal(elements.length, 4); assert.equal(ids.length, 2);
  const copyArrow = elements.find((element) => element.type === 'arrow' && element.id !== 'a');
  const copyBox = elements.find((element) => element.type === 'rect' && element.id !== 'box');
  assert.equal(copyArrow.to.elementId, copyBox.id, 'duplicated arrow binds to the duplicated box');
  const single = duplicateElements([box, bound], new Set(['a']));
  assert.equal(single.elements[2].to, undefined, 'a connector copied without its target is unbound so the copy does not snap back');
});

await check('z-order helpers move only the requested ids', () => {
  const list = [rect('a', 0, 0), rect('b', 0, 0), rect('c', 0, 0)];
  assert.deepEqual(bringToFront(list, new Set(['a'])).map((element) => element.id), ['b', 'c', 'a']);
  assert.deepEqual(sendToBack(list, new Set(['c'])).map((element) => element.id), ['c', 'a', 'b']);
});

await check('history undo/redo with coalescing and a bounded past', () => {
  let history = createHistory();
  const s0 = []; const s1 = [rect('a', 0, 0)]; const s2 = [rect('a', 5, 0)]; const s3 = [rect('a', 9, 0)];
  history = recordHistory(history, s0);
  history = recordHistory(history, s1, 'nudge');
  history = recordHistory(history, s2, 'nudge');
  assert.equal(history.past.length, 2, 'same-key edits coalesce into one step');
  const undone = undoHistory(history, s3);
  assert.deepEqual(undone.elements, s1); assert.equal(undone.history.future.length, 1);
  const redone = redoHistory(undone.history, undone.elements);
  assert.deepEqual(redone.elements, s3);
  assert.equal(undoHistory(createHistory(), s0), null); assert.equal(redoHistory(createHistory(), s0), null);
  let big = createHistory();
  for (let index = 0; index < BOARD_HISTORY_LIMIT + 20; index += 1) big = recordHistory(big, [rect('x', index, 0)]);
  assert.equal(big.past.length, BOARD_HISTORY_LIMIT);
  const branched = recordHistory(undone.history, s1);
  assert.equal(branched.future.length, 0, 'a new edit clears redo');
});

await check('paper links are idempotent and stored in the board document', () => {
  const doc = createBoardDocument({ title: 'T' });
  const linked = linkBoardToPaper(doc, { paperId: 'p1', title: 'Paper 1' }, 'now');
  assert.equal(linked.links.length, 1); assert.equal(linkBoardToPaper(linked, { paperId: 'p1', title: 'x' }), linked, 'same paper is not linked twice');
  assert.ok(boardLinkedToPaper(linked, 'p1')); assert.ok(!boardLinkedToPaper(linked, 'p2'));
  const unlinked = unlinkBoardFromPaper(linked, 'p1');
  assert.equal(unlinked.links.length, 0); assert.equal(unlinkBoardFromPaper(unlinked, 'p1'), unlinked);
  assert.equal(linked.id, unlinked.id, 'identity never changes');
});

await check('paths and names', () => {
  assert.ok(isBoardPath('C:\\notes\\x.a4board')); assert.ok(isBoardPath('/n/x.A4BOARD')); assert.ok(!isBoardPath('x.md'));
  assert.equal(boardDisplayName('计划.a4board'), '计划'); assert.equal(boardDisplayName('.a4board'), '未命名白板');
});

await check('viewport math keeps the anchor fixed while zooming and fits content', () => {
  const viewport = { x: 100, y: 50, zoom: 1 };
  const anchor = { x: 300, y: 200 };
  const before = screenToWorld(viewport, anchor);
  const zoomed = zoomViewport(viewport, 2, anchor);
  assert.deepEqual(screenToWorld(zoomed, anchor), before);
  assert.deepEqual(worldToScreen(zoomed, before), anchor);
  assert.equal(zoomViewport(viewport, 100, anchor).zoom, 8); assert.equal(zoomViewport(viewport, 0.001, anchor).zoom, 0.1);
  const fit = fitViewport({ x: 0, y: 0, w: 1000, h: 500 }, { width: 500, height: 500 });
  assert.ok(fit.zoom < 1 && fit.zoom > 0.3);
  assert.deepEqual(fitViewport(null, { width: 400, height: 300 }), { x: 200, y: 150, zoom: 1 });
});

// Wiki links: `[[name.a4board]]` resolves a board; `[[name]]` still means a note.
const tree = {
  'D:/vault': [
    { path: 'D:/vault/计划.a4board', name: '计划.a4board', is_directory: false, extension: 'a4board' },
    { path: 'D:/vault/计划.md', name: '计划.md', is_directory: false, extension: 'md' },
    { path: 'D:/vault/sub', name: 'sub', is_directory: true, extension: '' },
  ],
  'D:/vault/sub': [
    { path: 'D:/vault/sub/深处.a4board', name: '深处.a4board', is_directory: false, extension: 'a4board' },
  ],
};
const list = async (path) => { const key = path.replace(/\\/g, '/'); if (!tree[key]) throw new Error('目录不存在：' + path); return { entries: tree[key], truncated: false }; };
const from = 'D:/vault/note.md';
await check('wiki link with .a4board extension resolves the board file', async () => {
  const entry = await wiki.resolveWikiLink('D:/vault', from, '计划.a4board', list);
  assert.equal(entry.path, 'D:/vault/计划.a4board');
});
await check('wiki link without extension still resolves the note of the same stem', async () => {
  const entry = await wiki.resolveWikiLink('D:/vault', from, '计划', list);
  assert.equal(entry.path, 'D:/vault/计划.md');
});
await check('relative board links and vault-wide board search behave like notes', async () => {
  assert.equal((await wiki.resolveWikiLink('D:/vault', from, 'sub/深处.a4board', list)).path, 'D:/vault/sub/深处.a4board');
  await assert.rejects(() => wiki.resolveWikiLink('D:/vault', from, 'sub/缺失.a4board', list), /未找到/);
});
console.log(JSON.stringify({ passed }));
