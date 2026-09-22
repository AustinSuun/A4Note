// Annotation layers (fb5e3f2f): frontend layer repository/reducer and race checks.
// Runs the real `useAnnotationLayers` and `useAnnotationHistory` hooks against a simulated React
// lifecycle and an in-memory double of the native layer commands. No desktop APIs, no user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, expected, label) => { assert.deepEqual(JSON.parse(JSON.stringify(value)), expected, label); checks++; };
const ok = (condition, label, detail) => { assert.ok(condition, detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`); checks++; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await tick(); };

function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (id) => {
      if (id in mocks) return mocks[id];
      if (id.endsWith('.css')) return {};
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(file), id);
        const resolved = [base, base + '.ts', base + '.tsx'].find((candidate) => fs.existsSync(candidate));
        if (resolved) return load(resolved, mocks, globals);
      }
      throw new Error(`Unmocked ${id} in ${file}`);
    },
    console, Date, JSON, Map, Set, Math, Promise, Array, Object, Error, ...globals,
  }, { filename: file });
  return exports;
}

/** Minimal hook runtime: state slots, effects flushed on demand, contexts. */
function hooks() {
  const slots = []; let index = 0; let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useLayoutEffect() { index++; },
    useMemo(fn) { index++; return fn(); },
    useCallback(fn) { index++; return fn; },
    createContext(initial) { return { value: initial }; },
    useContext(context) { return context.value; },
  };
  return { react, render(fn) { index = 0; effects = []; return fn(); }, flush() { effects.forEach((fn) => fn()); effects = []; } };
}

const copy = (value) => JSON.parse(JSON.stringify(value));

/** In-memory double of the native layer/annotation commands with the same rules as annotation_layers.rs. */
function nativeDouble() {
  const owners = new Map(); // paperId -> { layers: [], view }
  const disk = new Map(); // annotation id -> row
  const calls = [];
  let gate = null; // pending promise the next list call waits for
  const ownerOf = (paperId) => {
    if (!owners.has(paperId)) {
      const id = `layer-default-${paperId}`;
      owners.set(paperId, { layers: [{ id, ownerKind: 'paper', ownerId: paperId, name: '默认图层', sortOrder: 0, kind: 'default', locked: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], view: { activeLayerId: id, visibleLayerIds: [id] } });
    }
    return owners.get(paperId);
  };
  const withCounts = (paperId) => {
    const owner = ownerOf(paperId);
    const rows = [...disk.values()].filter((row) => row.paper_id === paperId);
    return { ownerKind: 'paper', ownerId: paperId, layers: owner.layers.map((layer) => ({ ...layer, annotationCount: rows.filter((row) => row.layer_id === layer.id).length })), view: copy(owner.view) };
  };
  const repair = (paperId) => {
    const owner = ownerOf(paperId);
    const usable = owner.layers.filter((layer) => !layer.archivedAt);
    if (!usable.some((layer) => layer.id === owner.view.activeLayerId)) owner.view.activeLayerId = usable[0].id;
    owner.view.visibleLayerIds = owner.view.visibleLayerIds.filter((id) => usable.some((layer) => layer.id === id));
    if (!owner.view.visibleLayerIds.includes(owner.view.activeLayerId)) owner.view.visibleLayerIds.unshift(owner.view.activeLayerId);
  };
  const layerById = (layerId) => { for (const [paperId, owner] of owners) { const layer = owner.layers.find((item) => item.id === layerId); if (layer) return { paperId, owner, layer }; } throw new Error('图层不存在或已删除'); };
  let seq = 0;
  const api = {
    calls, disk, owners,
    gateNext(promise) { gate = promise; },
    isTauriRuntime: () => true,
    async listNativeAnnotationLayers(_kind, paperId) { calls.push(['listLayers', paperId]); return withCounts(paperId); },
    async listNativePaperAnnotations(paperId, layerIds) {
      calls.push(['listAnnotations', paperId, [...layerIds]]);
      if (gate) { const wait = gate; gate = null; await wait; }
      return [...disk.values()].filter((row) => row.paper_id === paperId && layerIds.includes(row.layer_id)).map((row) => ({ id: row.id, paperId, fileId: row.file_id, page: row.page, type: row.type, quote: row.quote, comment: row.comment, color: row.color, positionJson: copy(row.position), createdAt: new Date(row.created_at).toISOString(), layerId: row.layer_id }));
    },
    async getNativeAnnotation(paperId, annotationId) { const row = disk.get(annotationId); return row ? { id: row.id, paperId, fileId: row.file_id, page: row.page, type: row.type, quote: row.quote, comment: row.comment, color: row.color, positionJson: copy(row.position), createdAt: new Date(row.created_at).toISOString(), layerId: row.layer_id } : null; },
    async createNativeAnnotationLayer({ ownerId, name, kind, activate, solo }) {
      const owner = ownerOf(ownerId);
      const id = `layer-${++seq}`;
      const attempts = owner.layers.filter((layer) => layer.kind === 'attempt').length;
      owner.layers.push({ id, ownerKind: 'paper', ownerId, name: name || (kind === 'attempt' ? `第 ${attempts + 1} 次学习 · 2026-09-21` : `图层 ${owner.layers.length + 1}`), sortOrder: owner.layers.length, kind, locked: false, archivedAt: null, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' });
      if (activate || solo) owner.view.activeLayerId = id;
      owner.view.visibleLayerIds = solo ? [id] : [...owner.view.visibleLayerIds, id];
      calls.push(['createLayer', ownerId, kind]);
      return withCounts(ownerId);
    },
    async updateNativeAnnotationLayer({ layerId, name, locked, archived }) {
      const { paperId, owner, layer } = layerById(layerId);
      if (name != null) layer.name = name;
      if (locked != null) layer.locked = locked;
      if (archived != null) {
        if (archived && owner.layers.filter((item) => item.id !== layerId && !item.archivedAt).length === 0) throw new Error('不能归档唯一可用的图层');
        layer.archivedAt = archived ? '2026-01-03T00:00:00.000Z' : null;
        if (!archived && !owner.view.visibleLayerIds.includes(layerId)) owner.view.visibleLayerIds.push(layerId);
      }
      repair(paperId);
      calls.push(['updateLayer', layerId, { name, locked, archived }]);
      return withCounts(paperId);
    },
    async reorderNativeAnnotationLayers({ ownerId, layerIds }) { const owner = ownerOf(ownerId); owner.layers.sort((a, b) => layerIds.indexOf(a.id) - layerIds.indexOf(b.id)); owner.layers.forEach((layer, i) => { layer.sortOrder = i; }); return withCounts(ownerId); },
    async setNativeAnnotationLayerView({ ownerId, activeLayerId, visibleLayerIds }) {
      const owner = ownerOf(ownerId);
      const active = owner.layers.find((layer) => layer.id === activeLayerId);
      if (!active || active.archivedAt) throw new Error('活动图层不存在，请重新选择');
      owner.view = { activeLayerId, visibleLayerIds: [...visibleLayerIds] };
      repair(ownerId);
      calls.push(['setView', ownerId, activeLayerId, [...visibleLayerIds]]);
      return withCounts(ownerId);
    },
    async moveNativeAnnotationsToLayer({ annotationIds, targetLayerId }) {
      const { layer } = layerById(targetLayerId);
      if (layer.locked || layer.archivedAt) throw new Error(`图层「${layer.name}」已锁定，不能新增、修改或删除其中的标注`);
      let moved = 0;
      for (const id of annotationIds) { const row = disk.get(id); if (!row) continue; const source = layerById(row.layer_id).layer; if (source.locked) throw new Error(`图层「${source.name}」已锁定，不能新增、修改或删除其中的标注`); if (row.layer_id !== targetLayerId) { row.layer_id = targetLayerId; moved++; } }
      calls.push(['move', [...annotationIds], targetLayerId]);
      return { moved, target_layer_id: targetLayerId };
    },
    async previewNativeAnnotationLayerDelete(layerId) {
      const { paperId, owner, layer } = layerById(layerId);
      const rows = [...disk.values()].filter((row) => row.layer_id === layerId);
      const remaining = owner.layers.filter((item) => item.id !== layerId && !item.archivedAt);
      const reason = !remaining.length ? '这是唯一可用的图层，不能删除；请先新建图层' : layer.locked ? '已锁定' : null;
      return { layerId, name: layer.name, annotationCount: rows.length, referencingNoteCount: 0, moveTargets: withCounts(paperId).layers.filter((item) => item.id !== layerId && !item.archivedAt && !item.locked).map((item) => ({ id: item.id, name: item.name })), deletable: !reason, reason };
    },
    async deleteNativeAnnotationLayer({ layerId, mode, targetLayerId }) {
      const { paperId, owner } = layerById(layerId);
      if (owner.layers.filter((item) => item.id !== layerId && !item.archivedAt).length === 0) throw new Error('这是唯一可用的图层，不能删除');
      for (const [id, row] of disk) { if (row.layer_id === layerId) { if (mode === 'purge') disk.delete(id); else row.layer_id = targetLayerId; } }
      owner.layers = owner.layers.filter((item) => item.id !== layerId);
      repair(paperId);
      calls.push(['deleteLayer', layerId, mode, targetLayerId ?? null]);
      return withCounts(paperId);
    },
    // history hook needs
    async createNativeAnnotation(args) { calls.push(['create', copy(args)]); const id = `anno-${++seq}`; const layer = layerById(args.layerId).layer; if (layer.locked) throw new Error(`图层「${layer.name}」已锁定，不能新增、修改或删除其中的标注`); disk.set(id, { id, paper_id: args.paperId, file_id: args.fileId, page: args.page, type: args.type, quote: args.quote, comment: args.comment, color: args.color, position: copy(args.positionJson), created_at: 1700000000000 + seq, layer_id: args.layerId }); return { id, created_at: 1700000000000 + seq, layer_id: args.layerId }; },
    async restoreNativeAnnotation(a) { calls.push(['restore', copy(a)]); disk.set(a.id, { id: a.id, paper_id: a.paperId, file_id: a.fileId, page: a.page, type: a.type, quote: a.quote, comment: a.comment, color: a.color, position: copy(a.positionJson), created_at: Date.parse(a.createdAt), layer_id: a.layerId }); },
    async deleteNativeAnnotation(id) { calls.push(['delete', id]); disk.delete(id); },
    async updateNativeAnnotationComment() {}, async updateNativeAnnotationColor() {}, async updateNativeAnnotationPosition() {},
  };
  return api;
}

const seedRow = (disk, id, paperId, layerId, page = 1) => disk.set(id, { id, paper_id: paperId, file_id: `file-${paperId}`, page, type: 'highlight', quote: id, comment: '', color: 'yellow', position: { x: 1, y: 2, width: 3, height: 4 }, created_at: 1700000000000, layer_id: layerId });

function layersFixture() {
  const h = hooks();
  const native = nativeDouble();
  const papers = new Map(['one', 'two'].map((id) => [id, { paperId: id, sourceFileId: `file-${id}`, notes: [], annotations: [] }]));
  const core = { documents: { get: (key) => papers.get(key) } };
  const statuses = [];
  let selected = 'one';
  let revision = 0;
  const { useAnnotationLayers } = load(path.resolve('src/features/reader/useAnnotationLayers.ts'), { react: h.react, '../../platform/nativeApi': native, '../../core/types': { defaultAnnotationLayerId: (id) => `layer-default-${id}` } });
  const render = () => h.render(() => useAnnotationLayers({ aster: core, selectedPaper: papers.get(selected) ?? null, setRevision: (value) => { revision = typeof value === 'function' ? value(revision) : value; }, setLibraryStatus: (status) => statuses.push(status) }));
  const step = async () => { let api = render(); h.flush(); await settle(); api = render(); h.flush(); return api; };
  return { h, native, papers, statuses, step, render, select: (id) => { selected = id; }, revisionValue: () => revision };
}

// ---------- layer state: load, generic layers, visibility loads, locks ----------
{
  const f = layersFixture();
  seedRow(f.native.disk, 'old-1', 'one', 'layer-default-one');
  seedRow(f.native.disk, 'old-2', 'one', 'layer-default-one', 2);
  f.papers.get('one').annotations = [{ id: 'old-1', paperId: 'one', fileId: 'file-one', page: 1, type: 'highlight', quote: 'old-1', comment: '', color: 'yellow', positionJson: { x: 1 }, createdAt: '2026-01-01T00:00:00.000Z', layerId: 'layer-default-one' }, { id: 'old-2', paperId: 'one', fileId: 'file-one', page: 2, type: 'highlight', quote: 'old-2', comment: '', color: 'yellow', positionJson: { x: 1 }, createdAt: '2026-01-01T00:00:00.000Z', layerId: 'layer-default-one' }];
  let api = await f.step();
  check(api.layers.map((layer) => layer.id), ['layer-default-one'], 'the default layer is loaded for the selected paper');
  check([api.activeLayer.id, api.visibleLayerIds, api.writeLayerId()], ['layer-default-one', ['layer-default-one'], 'layer-default-one'], 'the default layer is active, visible and writable');
  check(api.layers[0].annotationCount, 2, 'counts come from the native aggregate');

  const created = await api.createLayer({ kind: 'layer' });
  api = await f.step();
  ok(created && created.kind === 'layer' && created.name === '图层 2', 'a new generic layer gets the next concise layer name', created);
  check([api.activeLayer.id, api.visibleLayerIds], [created.id, ['layer-default-one', created.id]], 'a new layer becomes active without hiding existing visible layers');
  check([api.isLayerVisible('layer-default-one'), f.papers.get('one').annotations.length], [true, 2], 'earlier marks stay visible and in memory');
  check(api.writeLayerId(), created.id, 'new marks would go to the new layer');

  const second = await api.createLayer({ kind: 'layer' });
  const third = await api.createLayer({ kind: 'layer' });
  api = await f.step();
  ok(second.name === '图层 3' && third.name === '图层 4', 'consecutive generic layers number themselves', [second.name, third.name]);
  check(api.layers.map((layer) => layer.sortOrder), [0, 1, 2, 3], 'creation order is stable');

  await api.setLayerVisible('layer-default-one', true);
  api = await f.step();
  check(api.visibleLayerIds, ['layer-default-one', created.id, second.id, third.id], 'showing an already visible layer keeps the complete visible set');
  check(f.native.calls.filter((call) => call[0] === 'listAnnotations').length, 0, 'layers whose rows were in the startup payload are not fetched again');
  check(f.papers.get('one').annotations.length, 2, 'no duplicate rows after showing an already loaded layer');

  const denied = await api.setLayerVisible(third.id, false);
  api = await f.step();
  ok(denied === undefined && api.visibleLayerIds.includes(third.id) && f.statuses.at(-1).includes('活动图层必须保持可见'), 'the active layer cannot be hidden', f.statuses.at(-1));

  await api.setLayerLocked(third.id, true);
  api = await f.step();
  check([api.writeLayerId(), api.writeBlockedReason.includes('已锁定')], [null, true], 'a locked active layer blocks new marks with an understandable reason');
  await api.setLayerLocked(third.id, false);
  api = await f.step();
  check(api.writeLayerId(), third.id, 'unlocking restores writes');

  await api.setLayerArchived(second.id, true);
  api = await f.step();
  ok(api.layers.find((layer) => layer.id === second.id).archivedAt && !api.visibleLayerIds.includes(second.id), 'archiving hides the layer and keeps it out of the view');
}

// ---------- on-demand loads with stale responses and paper switches ----------
{
  const f = layersFixture();
  // Layers A and B already exist on disk with rows the client has never seen (hidden at startup).
  const layerRow = (id, name, order) => ({ id, ownerKind: 'paper', ownerId: 'one', name, sortOrder: order, kind: 'layer', locked: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  f.native.owners.set('one', { layers: [layerRow('layer-default-one', '默认图层', 0), layerRow('layer-a', 'A', 1), layerRow('layer-b', 'B', 2)], view: { activeLayerId: 'layer-default-one', visibleLayerIds: ['layer-default-one'] } });
  const a = { id: 'layer-a' }, b = { id: 'layer-b' };
  seedRow(f.native.disk, 'in-a', 'one', a.id);
  seedRow(f.native.disk, 'in-b', 'one', b.id);
  let api = await f.step();
  check([api.layers.length, api.visibleLayerIds], [3, ['layer-default-one']], 'hidden layers are known but not shown');
  check(f.papers.get('one').annotations.map((row) => row.id), [], 'hidden layers were never loaded');
  // Show A (slow response) and B (fast response): the stale A response must not be applied on its own.
  let releaseSlow;
  f.native.gateNext(new Promise((resolve) => { releaseSlow = resolve; }));
  const slow = api.setLayerVisible(a.id, true);
  await tick();
  api = f.render();
  const fast = api.setLayerVisible(b.id, true);
  await settle();
  releaseSlow();
  await Promise.all([slow, fast]);
  api = await f.step();
  check(api.visibleLayerIds.slice().sort(), ['layer-default-one', a.id, b.id].sort(), 'both layers end up visible');
  const loadedIds = f.papers.get('one').annotations.map((row) => row.id).sort();
  check(loadedIds, ['in-a', 'in-b'], 'every visible layer is loaded exactly once even when an earlier response arrives late');
  const listCalls = f.native.calls.filter((call) => call[0] === 'listAnnotations');
  ok(listCalls.length === 2 && listCalls[1][2].includes(a.id), 'the later request also covers the layer whose earlier load was superseded', listCalls);

  // Switching papers while 'one' has pending work never leaks into 'two'.
  f.select('two');
  api = await f.step();
  check([api.paperId, api.layers.map((layer) => layer.id)], ['two', ['layer-default-two']], 'the second paper gets its own default layer state');
  f.select('one');
  api = await f.step();
  check(api.layers.length, 3, 'returning to the first paper restores its cached layers');
}

// ---------- reveal, move, delete ----------
{
  const f = layersFixture();
  let api = await f.step();
  const review = await api.createLayer({ kind: 'layer', activate: false, solo: false });
  api = await f.step();
  seedRow(f.native.disk, 'hidden-mark', 'one', review.id, 7);
  await api.setLayerVisible(review.id, false); api = await f.step();
  const revealed = await api.revealAnnotation('hidden-mark');
  api = await f.step();
  check([revealed?.id, revealed?.page, api.isLayerVisible(review.id)], ['hidden-mark', 7, true], 'revealing an annotation in a hidden layer shows the layer and returns the annotation');
  ok(f.statuses.at(-1).includes('已显示图层'), 'the user is told which layer was shown', f.statuses.at(-1));

  await api.setLayerArchived(review.id, true); api = await f.step();
  const revealedAgain = await api.revealAnnotation('hidden-mark');
  api = await f.step();
  ok(revealedAgain && !api.layers.find((layer) => layer.id === review.id).archivedAt && api.isLayerVisible(review.id), 'revealing into an archived layer restores it first');

  const moved = await api.moveAnnotations(['hidden-mark'], 'layer-default-one');
  api = await f.step();
  check([moved, f.papers.get('one').annotations.find((row) => row.id === 'hidden-mark').layerId, f.native.disk.get('hidden-mark').layer_id], [1, 'layer-default-one', 'layer-default-one'], 'moving keeps the id and changes only the layer, in memory and on disk');
  check(api.layers.find((layer) => layer.id === 'layer-default-one').annotationCount, 1, 'counts refresh after a move');

  const preview = await api.previewDelete('layer-default-one');
  check([preview.annotationCount, preview.deletable, preview.moveTargets.map((layer) => layer.id)], [1, true, [review.id]], 'delete preview reports counts and move targets');
  const onlyLeft = await api.deleteLayer(review.id, 'purge');
  api = await f.step();
  ok(onlyLeft === true && api.layers.length === 1, 'purging an empty layer leaves the default layer');
  const refused = await api.deleteLayer('layer-default-one', 'purge');
  api = await f.step();
  ok(refused === false && api.layers.length === 1 && f.statuses.at(-1).includes('唯一'), 'the last usable layer cannot be deleted and the reason is surfaced');
  const again = await api.createLayer({ kind: 'layer', activate: true, solo: false });
  api = await f.step();
  seedRow(f.native.disk, 'gone-1', 'one', again.id);
  await api.setLayerVisible(again.id, true); api = await f.step();
  const purged = await api.deleteLayer(again.id, 'purge');
  api = await f.step();
  check([purged, f.papers.get('one').annotations.some((row) => row.id === 'gone-1'), api.activeLayer.id], [true, false, 'layer-default-one'], 'purge removes the layer rows from memory and the active layer falls back');
}

// ---------- history: the write layer is captured when the write starts; move is undoable ----------
{
  const h = hooks();
  const native = nativeDouble();
  const paper = { paperId: 'one', sourceFileId: 'file-one', notes: [], annotations: [] };
  const core = { documents: { get: (key) => (key === 'one' ? paper : undefined) }, commands: { execute: () => null } };
  const statuses = [];
  let writeLayer = 'layer-default-one';
  let blocked = null;
  let layerChanges = 0;
  const { useAnnotationHistory } = load(path.resolve('src/features/reader/useAnnotationHistory.ts'), {
    react: h.react,
    '../../platform/nativeApi': native,
    '../../core/types': { defaultAnnotationLayerId: (id) => `layer-default-${id}` },
    './readerSaveErrors': { reportReaderSaveError: () => {} },
    './readerHelpers': { preferredTranslatedFileId: () => 'file-translated' },
  });
  const render = () => h.render(() => useAnnotationHistory({ aster: core, selectedPaper: paper, readerFileMode: 'source', readerTranslatedFileId: '', setReaderFocusedAnnotationId: () => {}, setRevision: () => {}, setLibraryStatus: (status) => statuses.push(status), writeLayerId: () => writeLayer, writeBlockedReason: () => blocked, onLayersChanged: () => { layerChanges++; } }));
  let api = render(); h.flush();
  native.owners.set('one', { layers: [
    { id: 'layer-default-one', ownerKind: 'paper', ownerId: 'one', name: '默认图层', sortOrder: 0, kind: 'default', locked: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'layer-2', ownerKind: 'paper', ownerId: 'one', name: '第 2 次', sortOrder: 1, kind: 'attempt', locked: false, archivedAt: null, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  ], view: { activeLayerId: 'layer-default-one', visibleLayerIds: ['layer-default-one', 'layer-2'] } });
  const draft = { type: 'highlight', quote: 'q', comment: '', color: 'yellow', positionJson: { x: 1, y: 2, width: 3, height: 4 }, page: 1 };
  // Queue a create while the active layer is the default layer, then switch layers before it runs.
  const pending = api.createAnnotation(draft);
  writeLayer = 'layer-2';
  const id = await pending;
  api = render(); h.flush();
  check([native.calls.find((call) => call[0] === 'create')[1].layerId, paper.annotations[0].layerId], ['layer-default-one', 'layer-default-one'], 'the layer captured at call time wins over a later switch');
  ok(layerChanges >= 1, 'layer counts are refreshed after a create');

  writeLayer = null; blocked = '活动图层「第 2 次」已锁定，请解锁或切换到可写图层';
  const refused = await api.createAnnotation(draft).catch((error) => error.message);
  ok(String(refused).includes('已锁定') && native.calls.filter((call) => call[0] === 'create').length === 1, 'a blocked layer refuses the write without a native call and explains why', refused);
  ok(statuses.at(-1).includes('创建标注失败'), 'the failure is reported through the reader status', statuses.at(-1));
  writeLayer = 'layer-2'; blocked = null;

  const movedCount = await api.moveAnnotationsToLayer([id], 'layer-2');
  api = render(); h.flush();
  check([movedCount, paper.annotations[0].layerId, native.disk.get(id).layer_id], [1, 'layer-2', 'layer-2'], 'move updates memory and disk');
  check(api.annotationUndoStack.at(-1).kind, 'move', 'move is an undoable history action');
  await api.undoAnnotationAction();
  api = render(); h.flush();
  check([paper.annotations[0].layerId, native.disk.get(id).layer_id], ['layer-default-one', 'layer-default-one'], 'undo returns the annotation to its previous layer');
  await api.redoAnnotationAction();
  api = render(); h.flush();
  check([paper.annotations[0].layerId, native.disk.get(id).layer_id], ['layer-2', 'layer-2'], 'redo moves it again');

  await api.deleteAnnotation(id);
  api = render(); h.flush();
  writeLayer = 'layer-default-one';
  await api.undoAnnotationAction();
  api = render(); h.flush();
  const restore = native.calls.filter((call) => call[0] === 'restore').at(-1)[1];
  check([restore.layerId, paper.annotations[0].layerId], ['layer-2', 'layer-2'], 'restoring a deleted annotation uses the layer recorded in its snapshot, not the layer active now');
}

// ---------- source contracts: hidden layers never reach the reader ----------
{
  const app = fs.readFileSync('src/ui/App.tsx', 'utf8');
  assert.match(app, /paper=\{withVisibleLayers\(paper\)\}/);
  assert.match(app, /writeLayerId: annotationLayers\.writeLayerId/);
  assert.match(app, /revealAndFocusAnnotation\(annotationId\)/);
  const toolbar = fs.readFileSync('src/features/reader/ReaderToolbar.tsx', 'utf8');
  assert.match(toolbar, /<AnnotationLayerPicker \/>/);
  const list = fs.readFileSync('src/features/reader/AnnotationListPanel.tsx', 'utf8');
  assert.match(list, /annotation-list-layer-group/);
  assert.doesNotMatch(list, /AnnotationLayerManager|managerOpen|管理图层/);
  const picker = fs.readFileSync('src/features/reader/AnnotationLayerPicker.tsx', 'utf8');
  assert.match(picker, /role="radiogroup"/);
  assert.match(picker, /aria-live="polite"/);
  assert.match(picker, /> 新图层<\/button>/);
  assert.match(picker, /onDoubleClick=.*setRenaming/);
  assert.doesNotMatch(picker, /新建学习记录|管理图层|annotation-layer-kind|annotation-layer-count|LockOpen/);
  const popover = fs.readFileSync('src/features/reader/ReaderToolPopover.tsx', 'utf8');
  assert.doesNotMatch(popover, /关闭标注设置|>×<\/button>/);
  const nativeLayers = fs.readFileSync('src-tauri/src/annotation_layers.rs', 'utf8');
  assert.match(nativeLayers, /DEFAULT_LAYER_NAME: &str = "图层 1"/);
  assert.match(nativeLayers, /kind = 'default' AND name = \?3/);
  checks += 14;
}

console.log(`PASS ${checks} annotation layer assertions (simulated React lifecycle + in-memory native double, not desktop E2E).`);
