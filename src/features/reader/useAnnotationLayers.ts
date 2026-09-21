import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { createAsterCore } from '../../core/asterCore';
import type { Annotation, AnnotationLayer, AnnotationLayerDeletePreview, AnnotationLayerState, PaperDocument } from '../../core/types';
import {
  createNativeAnnotationLayer,
  deleteNativeAnnotationLayer,
  getNativeAnnotation,
  isTauriRuntime,
  listNativeAnnotationLayers,
  listNativePaperAnnotations,
  moveNativeAnnotationsToLayer,
  previewNativeAnnotationLayerDelete,
  reorderNativeAnnotationLayers,
  setNativeAnnotationLayerView,
  updateNativeAnnotationLayer,
} from '../../platform/nativeApi';

type AsterCore = ReturnType<typeof createAsterCore>;
const defaultAnnotationLayerId = (ownerId: string) => `layer-default-${ownerId}`;

/** Per-owner cache: the layer state plus the layers whose annotations are already in memory. */
type OwnerCache = { state: AnnotationLayerState; loaded: Set<string>; token: number };

export type CreateLayerOptions = { kind: 'layer' | 'attempt'; name?: string; activate?: boolean; solo?: boolean };

export type AnnotationLayersApi = {
  paperId: string | null;
  state: AnnotationLayerState | null;
  layers: AnnotationLayer[];
  activeLayer: AnnotationLayer | null;
  visibleLayerIds: string[];
  isLayerVisible: (layerId: string) => boolean;
  layerName: (layerId: string) => string;
  /** Layer new marks go to right now, or null (with `writeBlockedReason`) when the active layer refuses writes. */
  writeLayerId: () => string | null;
  writeBlockedReason: string | null;
  setActiveLayer: (layerId: string) => Promise<void>;
  setLayerVisible: (layerId: string, visible: boolean) => Promise<void>;
  showOnlyLayer: (layerId: string) => Promise<void>;
  createLayer: (options: CreateLayerOptions) => Promise<AnnotationLayer | null>;
  renameLayer: (layerId: string, name: string) => Promise<void>;
  setLayerLocked: (layerId: string, locked: boolean) => Promise<void>;
  setLayerArchived: (layerId: string, archived: boolean) => Promise<void>;
  reorderLayers: (layerIds: string[]) => Promise<void>;
  moveAnnotations: (annotationIds: string[], targetLayerId: string) => Promise<number>;
  previewDelete: (layerId: string) => Promise<AnnotationLayerDeletePreview | null>;
  deleteLayer: (layerId: string, mode: 'move' | 'purge', targetLayerId?: string) => Promise<boolean>;
  /** Makes the layer of an annotation visible (loading it if needed) and returns the annotation. */
  revealAnnotation: (annotationId: string) => Promise<Annotation | null>;
  /** Re-reads layer counts after annotations were created, deleted or moved. */
  refresh: () => Promise<void>;
  /** Ids of the in-memory annotations of one layer, read from the store (not from a filtered view). */
  annotationIdsInLayer: (layerId: string) => string[];
  managerOpen: boolean;
  setManagerOpen: (open: boolean) => void;
  busy: boolean;
  error: string | null;
};

export const AnnotationLayersContext = createContext<AnnotationLayersApi | null>(null);

export function useAnnotationLayersContext() {
  return useContext(AnnotationLayersContext);
}

const compareAnnotations = (a: Annotation, b: Annotation) => a.page - b.page || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

function localState(paperId: string): AnnotationLayerState {
  const id = defaultAnnotationLayerId(paperId);
  const now = new Date().toISOString();
  return {
    ownerKind: 'paper',
    ownerId: paperId,
    layers: [{ id, ownerKind: 'paper', ownerId: paperId, name: '默认图层', sortOrder: 0, kind: 'default', locked: false, archivedAt: null, createdAt: now, updatedAt: now, annotationCount: 0 }],
    view: { activeLayerId: id, visibleLayerIds: [id] },
  };
}

export function useAnnotationLayers({
  aster,
  selectedPaper,
  setRevision,
  setLibraryStatus,
}: {
  aster: AsterCore;
  selectedPaper: PaperDocument | null;
  setRevision: (value: number | ((current: number) => number)) => void;
  setLibraryStatus: (status: string) => void;
}): AnnotationLayersApi {
  const paperId = selectedPaper?.paperId ?? null;
  const cache = useRef(new Map<string, OwnerCache>());
  const [, setLocalRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const publish = () => {
    if (!mounted.current) return;
    setLocalRevision((current) => current + 1);
    setRevision((current) => current + 1);
  };

  const document = (id: string) => aster.documents.get(id);

  /** Merges freshly loaded rows into the in-memory paper without duplicating ids or touching other layers. */
  const mergeAnnotations = (id: string, rows: Annotation[]) => {
    const paper = document(id);
    if (!paper) return;
    const known = new Set(paper.annotations.map((annotation) => annotation.id));
    const added = rows.filter((row) => !known.has(row.id));
    if (!added.length) return;
    paper.annotations = [...paper.annotations, ...added].sort(compareAnnotations);
  };

  const countsFromMemory = (id: string, state: AnnotationLayerState): AnnotationLayerState => {
    if (isTauriRuntime()) return state;
    const paper = document(id);
    return {
      ...state,
      layers: state.layers.map((layer) => ({ ...layer, annotationCount: paper ? paper.annotations.filter((annotation) => annotation.layerId === layer.id).length : 0 })),
    };
  };

  /** Applies a new state for `id`; layers that became visible are loaded before the UI sees them. */
  const applyState = async (id: string, state: AnnotationLayerState, entry?: OwnerCache) => {
    const current = entry ?? cache.current.get(id);
    const token = (current?.token ?? 0) + 1;
    const loaded = new Set(current?.loaded ?? []);
    const next: OwnerCache = { state: countsFromMemory(id, state), loaded, token };
    cache.current.set(id, next);
    const missing = state.view.visibleLayerIds.filter((layerId) => !loaded.has(layerId));
    if (missing.length && isTauriRuntime()) {
      const rows = await listNativePaperAnnotations(id, missing);
      // A later state change for the same owner supersedes this load; never write stale rows over it.
      if (cache.current.get(id)?.token !== token) return;
      mergeAnnotations(id, rows);
    }
    for (const layerId of missing) loaded.add(layerId);
    publish();
  };

  const load = async (id: string) => {
    const paper = document(id);
    if (!paper) return;
    if (!isTauriRuntime()) {
      const state = localState(id);
      const entry: OwnerCache = { state: countsFromMemory(id, state), loaded: new Set(state.view.visibleLayerIds), token: 1 };
      cache.current.set(id, entry);
      publish();
      return;
    }
    try {
      const state = await listNativeAnnotationLayers('paper', id);
      // The startup payload already carried the visible layers' annotations.
      const entry: OwnerCache = { state, loaded: new Set(state.view.visibleLayerIds), token: 1 };
      cache.current.set(id, entry);
      publish();
    } catch (loadError) {
      report('读取标注图层', loadError);
    }
  };

  useEffect(() => {
    if (paperId && !cache.current.has(paperId)) void load(paperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const report = (label: string, failure: unknown) => {
    const message = `${label}失败：${failure instanceof Error ? failure.message : String(failure)}`;
    console.error(message, failure);
    if (!mounted.current) return;
    setError(message);
    setLibraryStatus(message);
  };

  /** Runs one layer mutation for the current owner; results for an owner that is no longer selected are still cached but never mis-applied. */
  const mutate = async <T,>(label: string, operation: (id: string, entry: OwnerCache) => Promise<T>): Promise<T | null> => {
    const id = paperId;
    const entry = id ? cache.current.get(id) : undefined;
    if (!id || !entry) return null;
    setBusy(true);
    setError(null);
    try {
      return await operation(id, entry);
    } catch (failure) {
      report(label, failure);
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const entry = paperId ? cache.current.get(paperId) : undefined;
  const state = entry?.state ?? null;
  const layers = state?.layers ?? [];
  const activeLayer = state ? layers.find((layer) => layer.id === state.view.activeLayerId) ?? null : null;
  const visibleLayerIds = state?.view.visibleLayerIds ?? [];
  const visibleSet = useMemo(() => new Set(visibleLayerIds), [visibleLayerIds.join('|')]);
  const writeBlockedReason = !activeLayer
    ? (paperId ? '标注图层尚未就绪' : null)
    : activeLayer.archivedAt
      ? `活动图层「${activeLayer.name}」已归档，请选择其他图层`
      : activeLayer.locked
        ? `活动图层「${activeLayer.name}」已锁定，请解锁或切换到可写图层`
        : null;

  const setView = (label: string, activeLayerId: string, visible: string[]) =>
    mutate(label, async (id, current) => {
      if (isTauriRuntime()) {
        await applyState(id, await setNativeAnnotationLayerView({ ownerKind: 'paper', ownerId: id, activeLayerId, visibleLayerIds: visible }), current);
      } else {
        const unique = Array.from(new Set(visible.includes(activeLayerId) ? visible : [activeLayerId, ...visible]));
        await applyState(id, { ...current.state, view: { activeLayerId, visibleLayerIds: unique } }, current);
      }
    }).then(() => undefined);

  const api: AnnotationLayersApi = {
    paperId,
    state,
    layers,
    activeLayer,
    visibleLayerIds,
    isLayerVisible: (layerId) => visibleSet.has(layerId),
    layerName: (layerId) => layers.find((layer) => layer.id === layerId)?.name ?? '未知图层',
    writeLayerId: () => (activeLayer && !activeLayer.locked && !activeLayer.archivedAt ? activeLayer.id : null),
    writeBlockedReason,
    setActiveLayer: (layerId) => {
      const target = layers.find((layer) => layer.id === layerId);
      if (!target || !state) return Promise.resolve();
      if (target.archivedAt) { setLibraryStatus(`图层「${target.name}」已归档，不能设为活动图层`); return Promise.resolve(); }
      return setView('切换活动图层', layerId, state.view.visibleLayerIds.includes(layerId) ? state.view.visibleLayerIds : [...state.view.visibleLayerIds, layerId]);
    },
    setLayerVisible: (layerId, visible) => {
      if (!state) return Promise.resolve();
      if (!visible && layerId === state.view.activeLayerId) { setLibraryStatus('活动图层必须保持可见；请先切换活动图层'); return Promise.resolve(); }
      const next = visible ? Array.from(new Set([...state.view.visibleLayerIds, layerId])) : state.view.visibleLayerIds.filter((id) => id !== layerId);
      return setView(visible ? '显示图层' : '隐藏图层', state.view.activeLayerId, next);
    },
    showOnlyLayer: (layerId) => setView('只显示该图层', layerId, [layerId]),
    createLayer: (options) =>
      mutate(options.kind === 'attempt' ? '新建学习记录' : '新建图层', async (id, current) => {
        const activate = options.activate ?? true;
        const solo = options.solo ?? options.kind === 'attempt';
        if (isTauriRuntime()) {
          const next = await createNativeAnnotationLayer({ ownerKind: 'paper', ownerId: id, name: options.name, kind: options.kind, activate, solo });
          const created = next.layers.find((layer) => !current.state.layers.some((known) => known.id === layer.id)) ?? null;
          if (created) current.loaded.add(created.id); // A brand-new layer has nothing to fetch.
          await applyState(id, next, current);
          return created;
        }
        const now = new Date().toISOString();
        const attempts = current.state.layers.filter((layer) => layer.kind === 'attempt').length;
        const created: AnnotationLayer = {
          id: `layer-${Math.random().toString(36).slice(2, 10)}`, ownerKind: 'paper', ownerId: id,
          name: options.name?.trim() || (options.kind === 'attempt' ? `第 ${attempts + 1} 次学习 · ${now.slice(0, 10)}` : `图层 ${current.state.layers.length + 1}`),
          sortOrder: current.state.layers.length, kind: options.kind, locked: false, archivedAt: null, createdAt: now, updatedAt: now, annotationCount: 0,
        };
        current.loaded.add(created.id);
        const view = current.state.view;
        await applyState(id, {
          ...current.state,
          layers: [...current.state.layers, created],
          view: { activeLayerId: activate || solo ? created.id : view.activeLayerId, visibleLayerIds: solo ? [created.id] : [...view.visibleLayerIds, created.id] },
        }, current);
        return created;
      }),
    renameLayer: (layerId, name) =>
      mutate('重命名图层', async (id, current) => {
        if (!name.trim()) throw new Error('图层名称不能为空');
        if (isTauriRuntime()) await applyState(id, await updateNativeAnnotationLayer({ layerId, name: name.trim() }), current);
        else await applyState(id, { ...current.state, layers: current.state.layers.map((layer) => (layer.id === layerId ? { ...layer, name: name.trim() } : layer)) }, current);
      }).then(() => undefined),
    setLayerLocked: (layerId, locked) =>
      mutate(locked ? '锁定图层' : '解锁图层', async (id, current) => {
        if (isTauriRuntime()) await applyState(id, await updateNativeAnnotationLayer({ layerId, locked }), current);
        else await applyState(id, { ...current.state, layers: current.state.layers.map((layer) => (layer.id === layerId ? { ...layer, locked } : layer)) }, current);
      }).then(() => undefined),
    setLayerArchived: (layerId, archived) =>
      mutate(archived ? '归档图层' : '恢复图层', async (id, current) => {
        if (isTauriRuntime()) { await applyState(id, await updateNativeAnnotationLayer({ layerId, archived }), current); return; }
        const usable = current.state.layers.filter((layer) => layer.id !== layerId && !layer.archivedAt);
        if (archived && !usable.length) throw new Error('不能归档唯一可用的图层，请先新建一个图层');
        const view = current.state.view;
        const activeLayerId = archived && view.activeLayerId === layerId ? usable[0].id : view.activeLayerId;
        const visible = archived ? view.visibleLayerIds.filter((id) => id !== layerId) : Array.from(new Set([...view.visibleLayerIds, layerId]));
        await applyState(id, {
          ...current.state,
          layers: current.state.layers.map((layer) => (layer.id === layerId ? { ...layer, archivedAt: archived ? new Date().toISOString() : null } : layer)),
          view: { activeLayerId, visibleLayerIds: visible.includes(activeLayerId) ? visible : [activeLayerId, ...visible] },
        }, current);
      }).then(() => undefined),
    reorderLayers: (layerIds) =>
      mutate('调整图层顺序', async (id, current) => {
        if (isTauriRuntime()) { await applyState(id, await reorderNativeAnnotationLayers({ ownerKind: 'paper', ownerId: id, layerIds }), current); return; }
        const order = new Map(layerIds.map((layerId, index) => [layerId, index]));
        await applyState(id, { ...current.state, layers: [...current.state.layers].map((layer) => ({ ...layer, sortOrder: order.get(layer.id) ?? layer.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder) }, current);
      }).then(() => undefined),
    moveAnnotations: async (annotationIds, targetLayerId) => {
      const moved = await mutate('移动标注到图层', async (id, current) => {
        const target = current.state.layers.find((layer) => layer.id === targetLayerId);
        if (!target) throw new Error('目标图层不存在');
        if (target.locked || target.archivedAt) throw new Error(`图层「${target.name}」${target.archivedAt ? '已归档' : '已锁定'}，不能接收标注`);
        let count = annotationIds.length;
        if (isTauriRuntime()) count = (await moveNativeAnnotationsToLayer({ annotationIds, targetLayerId })).moved;
        const paper = document(id);
        if (paper) {
          const ids = new Set(annotationIds);
          // The id, geometry and timestamps stay; only the layer membership changes.
          paper.annotations = paper.annotations.map((annotation) => (ids.has(annotation.id) ? { ...annotation, layerId: targetLayerId } : annotation));
        }
        const refreshed = isTauriRuntime() ? await listNativeAnnotationLayers('paper', id) : current.state;
        current.loaded.add(targetLayerId);
        await applyState(id, refreshed, current);
        return count;
      });
      return moved ?? 0;
    },
    previewDelete: (layerId) =>
      mutate('读取图层删除影响', async (id, current) => {
        if (isTauriRuntime()) return previewNativeAnnotationLayerDelete(layerId);
        const layer = current.state.layers.find((item) => item.id === layerId);
        if (!layer) throw new Error('图层不存在');
        const paper = document(id);
        const ids = new Set((paper?.annotations ?? []).filter((annotation) => annotation.layerId === layerId).map((annotation) => annotation.id));
        const remaining = current.state.layers.filter((item) => item.id !== layerId && !item.archivedAt);
        const reason = !remaining.length ? '这是唯一可用的图层，不能删除；请先新建图层' : layer.locked ? `图层「${layer.name}」已锁定，请先解锁再删除` : null;
        return {
          layerId, name: layer.name, annotationCount: ids.size,
          referencingNoteCount: (paper?.notes ?? []).filter((note) => Array.from(ids).some((annotationId) => note.content.includes(`@annotation(${annotationId})`))).length,
          moveTargets: remaining.filter((item) => !item.locked), deletable: !reason, reason,
        };
      }),
    deleteLayer: async (layerId, mode, targetLayerId) => {
      const done = await mutate('删除图层', async (id, current) => {
        const paper = document(id);
        if (isTauriRuntime()) {
          const next = await deleteNativeAnnotationLayer({ layerId, mode, targetLayerId });
          if (paper) {
            paper.annotations = mode === 'purge'
              ? paper.annotations.filter((annotation) => annotation.layerId !== layerId)
              : paper.annotations.map((annotation) => (annotation.layerId === layerId && targetLayerId ? { ...annotation, layerId: targetLayerId } : annotation));
          }
          if (targetLayerId) current.loaded.add(targetLayerId);
          current.loaded.delete(layerId);
          await applyState(id, next, current);
          return true;
        }
        const remaining = current.state.layers.filter((item) => item.id !== layerId && !item.archivedAt);
        if (!remaining.length) throw new Error('这是唯一可用的图层，不能删除；请先新建图层');
        if (mode === 'move' && !targetLayerId) throw new Error('请选择接收标注的目标图层');
        if (paper) {
          paper.annotations = mode === 'purge'
            ? paper.annotations.filter((annotation) => annotation.layerId !== layerId)
            : paper.annotations.map((annotation) => (annotation.layerId === layerId ? { ...annotation, layerId: targetLayerId! } : annotation));
        }
        const view = current.state.view;
        const activeLayerId = view.activeLayerId === layerId ? remaining[0].id : view.activeLayerId;
        const visible = view.visibleLayerIds.filter((item) => item !== layerId);
        await applyState(id, {
          ...current.state,
          layers: current.state.layers.filter((item) => item.id !== layerId),
          view: { activeLayerId, visibleLayerIds: visible.includes(activeLayerId) ? visible : [activeLayerId, ...visible] },
        }, current);
        return true;
      });
      return done ?? false;
    },
    revealAnnotation: async (annotationId) => {
      const result = await mutate('定位标注', async (id, current) => {
        const paper = document(id);
        let annotation = paper?.annotations.find((item) => item.id === annotationId) ?? null;
        if (!annotation && isTauriRuntime()) {
          annotation = await getNativeAnnotation(id, annotationId);
          if (annotation && paper) mergeAnnotations(id, [annotation]);
        }
        if (!annotation) return null;
        const layer = current.state.layers.find((item) => item.id === annotation!.layerId);
        if (layer?.archivedAt) {
          // An archived layer cannot be shown; restore it first so the reference has a visible target.
          const restored = isTauriRuntime() ? await updateNativeAnnotationLayer({ layerId: layer.id, archived: false }) : { ...current.state, layers: current.state.layers.map((item) => (item.id === layer.id ? { ...item, archivedAt: null } : item)) };
          await applyState(id, restored, current);
          setLibraryStatus(`已恢复并显示归档图层「${layer.name}」以定位标注`);
        }
        const latest = cache.current.get(id) ?? current;
        if (!latest.state.view.visibleLayerIds.includes(annotation.layerId)) {
          const visible = [...latest.state.view.visibleLayerIds, annotation.layerId];
          if (isTauriRuntime()) await applyState(id, await setNativeAnnotationLayerView({ ownerKind: 'paper', ownerId: id, activeLayerId: latest.state.view.activeLayerId, visibleLayerIds: visible }), latest);
          else await applyState(id, { ...latest.state, view: { ...latest.state.view, visibleLayerIds: visible } }, latest);
          setLibraryStatus(`已显示图层「${layer?.name ?? '未知图层'}」以定位标注`);
        }
        return annotation;
      });
      return result ?? null;
    },
    managerOpen,
    setManagerOpen,
    annotationIdsInLayer: (layerId) => (paperId ? document(paperId)?.annotations ?? [] : []).filter((annotation) => annotation.layerId === layerId).map((annotation) => annotation.id),
    refresh: () =>
      mutate('刷新图层', async (id, current) => {
        const next = isTauriRuntime() ? await listNativeAnnotationLayers('paper', id) : current.state;
        await applyState(id, next, current);
      }).then(() => undefined),
    busy,
    error,
  };
  return api;
}
