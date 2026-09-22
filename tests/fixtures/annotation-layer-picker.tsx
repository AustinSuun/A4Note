import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnotationLayerPicker } from '../../src/features/reader/AnnotationLayerPicker';
import { AnnotationLayersContext, type AnnotationLayersApi } from '../../src/features/reader/useAnnotationLayers';
import type { AnnotationLayer, AnnotationLayerDeletePreview, AnnotationLayerState } from '../../src/core/types';
// Only the styles the layer UI actually consumes: importing the whole application stylesheet made
// the dev-server transform dominate the run on a loaded machine.
import '../../src/ui/styles/tokens.css';
import '../../src/ui/styles/base.css';
import '../../src/features/reader/reader-annotation-dock.css';

/*
 * Isolated fixture for the annotation layer quick picker contract (f6b927bb). It renders the real
 * component with real application CSS against an in-memory layer API, so the browser checks can
 * measure DOM, styles and focus without touching the desktop runtime or any real library.
 */

const now = '2026-09-22T00:00:00.000Z';
const makeLayer = (index: number, count = 0, name?: string): AnnotationLayer => ({
  id: `layer-${index}`,
  ownerKind: 'paper',
  ownerId: 'fixture-paper',
  name: name ?? (index === 1 ? '图层 1' : `第 ${index} 次学习记录 · 2026-09-22`),
  sortOrder: index,
  kind: index === 1 ? 'default' : 'attempt',
  locked: false,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  annotationCount: count,
});

type Store = { layers: AnnotationLayer[]; activeLayerId: string; visibleLayerIds: string[] };
const makeStore = (count: number, withData: boolean): Store => {
  const layers = Array.from({ length: count }, (_, index) => makeLayer(index + 1, withData && index === 2 ? 3 : 0));
  return { layers, activeLayerId: layers[0].id, visibleLayerIds: layers.map((layer) => layer.id) };
};

const log: unknown[][] = [];
let store: Store = makeStore(12, false);
let rerender: () => void = () => {};
const setStore = (next: Store) => { store = next; rerender(); };
const patch = (change: Partial<Store>) => setStore({ ...store, ...change });

const api: AnnotationLayersApi = {
  paperId: 'fixture-paper',
  get state(): AnnotationLayerState {
    return { ownerKind: 'paper', ownerId: 'fixture-paper', layers: store.layers, view: { activeLayerId: store.activeLayerId, visibleLayerIds: store.visibleLayerIds } };
  },
  get layers() { return store.layers; },
  get activeLayer() { return store.layers.find((layer) => layer.id === store.activeLayerId) ?? null; },
  get visibleLayerIds() { return store.visibleLayerIds; },
  isLayerVisible: (layerId) => store.visibleLayerIds.includes(layerId),
  layerName: (layerId) => store.layers.find((layer) => layer.id === layerId)?.name ?? '',
  writeLayerId: () => store.activeLayerId,
  writeBlockedReason: null,
  setActiveLayer: async (layerId) => { log.push(['setActiveLayer', layerId]); patch({ activeLayerId: layerId }); },
  setLayerVisible: async (layerId, visible) => {
    log.push(['setLayerVisible', layerId, visible]);
    patch({ visibleLayerIds: visible ? [...store.visibleLayerIds, layerId] : store.visibleLayerIds.filter((id) => id !== layerId) });
  },
  showOnlyLayer: async (layerId) => { log.push(['showOnlyLayer', layerId]); patch({ visibleLayerIds: [layerId] }); },
  createLayer: async (options) => {
    log.push(['createLayer', options]);
    const index = store.layers.length + 1;
    const layer = makeLayer(index, 0, options.name ?? `图层 ${index}`);
    setStore({ layers: [...store.layers, layer], activeLayerId: layer.id, visibleLayerIds: [...store.visibleLayerIds, layer.id] });
    return layer;
  },
  renameLayer: async (layerId, name) => { log.push(['renameLayer', layerId, name]); patch({ layers: store.layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer)) }); },
  setLayerLocked: async (layerId, locked) => { log.push(['setLayerLocked', layerId, locked]); patch({ layers: store.layers.map((layer) => (layer.id === layerId ? { ...layer, locked } : layer)) }); },
  setLayerArchived: async (layerId, archived) => { log.push(['setLayerArchived', layerId, archived]); },
  reorderLayers: async (layerIds) => { log.push(['reorderLayers', layerIds]); },
  moveAnnotations: async (annotationIds, targetLayerId) => { log.push(['moveAnnotations', annotationIds, targetLayerId]); return annotationIds.length; },
  previewDelete: async (layerId) => {
    log.push(['previewDelete', layerId]);
    const layer = store.layers.find((item) => item.id === layerId);
    if (!layer) return null;
    const moveTargets = store.layers.filter((item) => item.id !== layerId && !item.archivedAt);
    const preview: AnnotationLayerDeletePreview = {
      layerId,
      name: layer.name,
      annotationCount: layer.annotationCount,
      referencingNoteCount: layer.annotationCount > 0 ? 1 : 0,
      moveTargets,
      deletable: moveTargets.length > 0,
      reason: moveTargets.length > 0 ? null : '这是唯一可用的图层，不能删除；请先新建图层',
    };
    return preview;
  },
  deleteLayer: async (layerId, mode, targetLayerId) => {
    log.push(['deleteLayer', layerId, mode, targetLayerId ?? null]);
    if (!store.layers.some((layer) => layer.id === layerId)) return false;
    const remaining = store.layers.filter((layer) => layer.id !== layerId && !layer.archivedAt);
    if (!remaining.length) return false;
    const activeLayerId = store.activeLayerId === layerId ? remaining[0].id : store.activeLayerId;
    const visibleLayerIds = store.visibleLayerIds.filter((id) => id !== layerId);
    setStore({
      layers: store.layers.filter((layer) => layer.id !== layerId),
      activeLayerId,
      visibleLayerIds: visibleLayerIds.includes(activeLayerId) ? visibleLayerIds : [activeLayerId, ...visibleLayerIds],
    });
    return true;
  },
  revealAnnotation: async () => null,
  refresh: async () => { log.push(['refresh']); },
  annotationIdsInLayer: () => [],
  busy: false,
  error: null,
};

function App() {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  return (
    <main className="reader-annotation-dock" style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
      <div className="reader-toolbar-annotations">
        <div className="annotation-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="annotation-tool-btn" data-test-tool="before" aria-label="上一个工具">◀</button>
          <AnnotationLayersContext.Provider value={api}>
            <AnnotationLayerPicker />
          </AnnotationLayersContext.Provider>
          <button type="button" className="annotation-tool-btn" data-test-tool="after" aria-label="下一个工具">▶</button>
        </div>
      </div>
      <p style={{ position: 'absolute', top: -30, left: 0, fontSize: 11, whiteSpace: 'nowrap' }}>隔离组件夹具 · 非安装版 · 非真实资料库</p>
    </main>
  );
}

(window as any).pickerFixture = {
  reset: (count: number, withData: boolean) => setStore(makeStore(count, withData)),
  renameActive: (name: string) => patch({ layers: store.layers.map((layer) => (layer.id === store.activeLayerId ? { ...layer, name } : layer)) }),
  setActive: (layerId: string) => patch({ activeLayerId: layerId }),
  snapshot: () => ({ count: store.layers.length, activeLayerId: store.activeLayerId, names: store.layers.map((layer) => layer.name), counts: store.layers.map((layer) => layer.annotationCount) }),
  log: () => log.map((entry) => entry.slice()),
  clearLog: () => { log.length = 0; },
};

createRoot(document.getElementById('root')!).render(<App />);
