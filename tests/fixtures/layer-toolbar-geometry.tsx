import { useState } from 'react';
import { createRoot } from 'react-dom/client';
// The dock skin must load before the component pulls in reader-annotation-layers.css: in the
// shipped app bundle the layer entry overrides end up AFTER the dock rules (that is why the
// entry is 64px wide there), and the width battle between the two same-specificity rules is
// order-sensitive. This fixture reproduces that real order.
import '../../src/ui/styles/tokens.css';
import '../../src/ui/styles/base.css';
import '../../src/ui/styles/reader.css';
import '../../src/features/reader/reader-annotation-dock.css';
import { AnnotationLayerPicker } from '../../src/features/reader/AnnotationLayerPicker';
import { AnnotationLayersContext, type AnnotationLayersApi } from '../../src/features/reader/useAnnotationLayers';
import type { AnnotationLayer, AnnotationLayerDeletePreview, AnnotationLayerState } from '../../src/core/types';

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

function ToolSlot({ label, hook, dot }: { label: string; hook: string; dot?: boolean }) {
  return (
    <div className="annotation-tool-slot">
      <button type="button" className="annotation-tool-btn" aria-label={label} data-test-tool={hook} title={label}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
        {dot ? <span className="annotation-tool-color-dot" style={{ background: '#f2c94c' }} /> : null}
      </button>
    </div>
  );
}

function App() {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  return (
    <main className="reader-annotation-dock" style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
      <div className="reader-toolbar-group reader-toolbar-annotations">
        <div className="annotation-toolbar" aria-label="Annotation tools">
          <ToolSlot label="鼠标" hook="cursor" />
          <ToolSlot label="手形拖动" hook="hand" />
          <ToolSlot label="高亮" hook="highlight" dot />
          <ToolSlot label="下划线" hook="underline" dot />
          <ToolSlot label="橡皮擦" hook="eraser" />
          <AnnotationLayersContext.Provider value={api}>
            <AnnotationLayerPicker />
          </AnnotationLayersContext.Provider>
          <div className="annotation-tool-slot">
            <button type="button" className="annotation-tool-btn" aria-label="阅读器快捷键设置" data-test-tool="shortcut" title="阅读器快捷键设置">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10" /></svg>
            </button>
          </div>
        </div>
      </div>
      <p style={{ position: 'absolute', top: -30, left: 0, fontSize: 11, whiteSpace: 'nowrap' }}>隔离组件夹具 · 非安装版 · 非真实资料库</p>
    </main>
  );
}

(window as any).geometryFixture = {
  reset: (count: number, withData: boolean) => setStore(makeStore(count, withData)),
  renameActive: (name: string) => patch({ layers: store.layers.map((layer) => (layer.id === store.activeLayerId ? { ...layer, name } : layer)) }),
  setActive: (layerId: string) => patch({ activeLayerId: layerId }),
  snapshot: () => ({ count: store.layers.length, activeLayerId: store.activeLayerId, names: store.layers.map((layer) => layer.name), counts: store.layers.map((layer) => layer.annotationCount) }),
  log: () => log.map((entry) => entry.slice()),
  clearLog: () => { log.length = 0; },
};

createRoot(document.getElementById('root')!).render(<App />);
