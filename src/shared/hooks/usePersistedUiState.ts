import { useMemo } from 'react';
import type { LibrarySortDirection, LibrarySortKey } from '../../features/library';
import { defaultSettings, type AppSettings } from '../../features/settings';
import type { ReaderContentMode } from '../../features/reader';
import type { PaperFileKind } from '../../platform/nativeApi';
import type { AnnotationColor, ReaderLayout, ReaderSidePanelTab, SceneId, WorkbenchPanelId, WorkspaceLayoutState } from '../../core/types';
import { isReaderPanelTab, readerPanelIdFromTab, readerPanelTabFromId } from '../../core/workbench';

export type WorkspaceLayoutsByScene = Record<SceneId, WorkspaceLayoutState>;

export type PersistedUiState = {
  activeScene: SceneId;
  selectedPaperId: string;
  query: string;
  activeTag: string;
  librarySort: { key: LibrarySortKey; direction: LibrarySortDirection };
  readerLayout: ReaderLayout;
  readerContentMode: ReaderContentMode;
  readerFileMode: PaperFileKind;
  readerTranslatedFileId: string;
  readerAnnotationColor: AnnotationColor;
  readerZoom: number;
  readerSidePanelOpen: boolean;
  readerSidePanelTab: ReaderSidePanelTab;
  workspaceLayouts: WorkspaceLayoutsByScene;
};

export function usePersistedUiState(settings: AppSettings, knownWorkbenchPanelIds: readonly WorkbenchPanelId[]) {
  return useMemo(() => loadUiState(settings, knownWorkbenchPanelIds), [knownWorkbenchPanelIds, settings]);
}

export function defaultWorkspaceLayouts(): WorkspaceLayoutsByScene {
  return {
    library: createWorkspaceLayout('library', undefined, []),
    reader: createWorkspaceLayout('reader', 'reader.notes', []),
    aiChat: createWorkspaceLayout('aiChat', undefined, []),
  };
}

export function syncWorkspaceLayouts(
  layouts: WorkspaceLayoutsByScene,
  state: { libraryDetailOpen: boolean; readerSidePanelOpen: boolean; readerSidePanelTab: ReaderSidePanelTab },
): WorkspaceLayoutsByScene {
  const readerPanelId = readerPanelIdFromTab(state.readerSidePanelTab);
  return {
    ...layouts,
    library: createWorkspaceLayout('library', 'library.details', state.libraryDetailOpen ? ['library.details'] : []),
    reader: createWorkspaceLayout('reader', readerPanelId, state.readerSidePanelOpen ? [readerPanelId] : []),
  };
}

export function isWorkspacePanelOpen(layouts: WorkspaceLayoutsByScene, sceneId: SceneId, panelId: WorkbenchPanelId) {
  return layouts[sceneId]?.openPanelIds.includes(panelId) ?? false;
}

export function saveUiState(state: PersistedUiState) {
  localStorage.setItem('aster.uiState', JSON.stringify(state));
}

function createWorkspaceLayout(sceneId: SceneId, activePanelId: WorkbenchPanelId | undefined, openPanelIds: WorkbenchPanelId[]): WorkspaceLayoutState {
  return {
    sceneId,
    activePanelId,
    openPanelIds,
    collapsedAreas: [],
  };
}

function normalizeWorkspaceLayouts(value: unknown, fallback: WorkspaceLayoutsByScene, knownWorkbenchPanelIds: readonly WorkbenchPanelId[]): WorkspaceLayoutsByScene {
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Partial<Record<SceneId, Partial<WorkspaceLayoutState>>>;
  return {
    library: normalizeWorkspaceLayout('library', candidate.library, fallback.library, knownWorkbenchPanelIds),
    reader: normalizeWorkspaceLayout('reader', candidate.reader, fallback.reader, knownWorkbenchPanelIds),
    aiChat: normalizeWorkspaceLayout('aiChat', candidate.aiChat, fallback.aiChat, knownWorkbenchPanelIds),
  };
}

function normalizeWorkspaceLayout(
  sceneId: SceneId,
  value: Partial<WorkspaceLayoutState> | undefined,
  fallback: WorkspaceLayoutState,
  knownWorkbenchPanelIds: readonly WorkbenchPanelId[],
): WorkspaceLayoutState {
  if (!value || typeof value !== 'object') return fallback;
  const activePanelId = isWorkbenchPanelId(value.activePanelId, knownWorkbenchPanelIds) ? value.activePanelId : fallback.activePanelId;
  const openPanelIds = Array.isArray(value.openPanelIds) ? value.openPanelIds.filter((panelId) => isWorkbenchPanelId(panelId, knownWorkbenchPanelIds)) : fallback.openPanelIds;
  const collapsedAreas = Array.isArray(value.collapsedAreas) ? value.collapsedAreas.filter(isWorkbenchArea) : fallback.collapsedAreas;
  return { sceneId, activePanelId, openPanelIds, collapsedAreas };
}

function isWorkbenchPanelId(value: unknown, knownWorkbenchPanelIds: readonly WorkbenchPanelId[]): value is WorkbenchPanelId {
  if (typeof value !== 'string') return false;
  return value.startsWith('plugin:') || knownWorkbenchPanelIds.includes(value as WorkbenchPanelId);
}

function isWorkbenchArea(value: unknown): value is WorkspaceLayoutState['collapsedAreas'][number] {
  return value === 'left' || value === 'right' || value === 'bottom' || value === 'center';
}

function defaultUiState(settings = defaultSettings): PersistedUiState {
  const workspaceLayouts = defaultWorkspaceLayouts();
  return {
    activeScene: 'library',
    selectedPaperId: '',
    query: '',
    activeTag: 'all',
    librarySort: { key: 'year', direction: 'desc' },
    readerLayout: settings.defaultReaderLayout,
    readerContentMode: 'pdf',
    readerFileMode: 'source',
    readerTranslatedFileId: '',
    readerAnnotationColor: 'yellow',
    readerZoom: 1.18,
    readerSidePanelOpen: false,
    readerSidePanelTab: 'notes',
    workspaceLayouts,
  };
}

function loadUiState(settings: AppSettings, knownWorkbenchPanelIds: readonly WorkbenchPanelId[]): PersistedUiState {
  const fallback = defaultUiState(settings);
  try {
    const raw = localStorage.getItem('aster.uiState');
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
    const hasWorkspaceLayouts = Boolean(parsed.workspaceLayouts && typeof parsed.workspaceLayouts === 'object');
    const workspaceLayouts = normalizeWorkspaceLayouts(parsed.workspaceLayouts, fallback.workspaceLayouts, knownWorkbenchPanelIds);
    const parsedReaderSidePanelTab = isReaderSidePanelTab(parsed.readerSidePanelTab) ? parsed.readerSidePanelTab : fallback.readerSidePanelTab;
    const workspaceReaderTab = workspaceLayouts.reader.activePanelId ? readerPanelTabFromId(workspaceLayouts.reader.activePanelId) : null;
    const readerSidePanelTab = workspaceReaderTab ?? parsedReaderSidePanelTab;
    const readerSidePanelOpen = hasWorkspaceLayouts
      ? isWorkspacePanelOpen(workspaceLayouts, 'reader', readerPanelIdFromTab(readerSidePanelTab))
      : typeof parsed.readerSidePanelOpen === 'boolean'
        ? parsed.readerSidePanelOpen
        : fallback.readerSidePanelOpen;
    return {
      activeScene: isSceneId(parsed.activeScene) ? parsed.activeScene : fallback.activeScene,
      selectedPaperId: typeof parsed.selectedPaperId === 'string' ? parsed.selectedPaperId : fallback.selectedPaperId,
      query: typeof parsed.query === 'string' ? parsed.query : fallback.query,
      activeTag: typeof parsed.activeTag === 'string' ? parsed.activeTag : fallback.activeTag,
      librarySort: isLibrarySort(parsed.librarySort) ? parsed.librarySort : fallback.librarySort,
      readerLayout: isReaderLayout(parsed.readerLayout) ? parsed.readerLayout : fallback.readerLayout,
      readerContentMode: parsed.readerContentMode === 'markdown' || parsed.readerContentMode === 'pdf' ? parsed.readerContentMode : fallback.readerContentMode,
      readerFileMode: parsed.readerFileMode === 'translated' || parsed.readerFileMode === 'source' ? parsed.readerFileMode : fallback.readerFileMode,
      readerTranslatedFileId: typeof parsed.readerTranslatedFileId === 'string' ? parsed.readerTranslatedFileId : fallback.readerTranslatedFileId,
      readerAnnotationColor:
        parsed.readerAnnotationColor === 'yellow' ||
        parsed.readerAnnotationColor === 'green' ||
        parsed.readerAnnotationColor === 'blue' ||
        parsed.readerAnnotationColor === 'purple'
          ? parsed.readerAnnotationColor
          : fallback.readerAnnotationColor,
      readerZoom: typeof parsed.readerZoom === 'number' && Number.isFinite(parsed.readerZoom) ? clampNumber(parsed.readerZoom, 0.7, 2.2) : fallback.readerZoom,
      readerSidePanelOpen,
      readerSidePanelTab,
      workspaceLayouts,
    };
  } catch {
    return fallback;
  }
}

function isSceneId(value: unknown): value is SceneId {
  return value === 'library' || value === 'reader' || value === 'aiChat';
}

function isReaderLayout(value: unknown): value is ReaderLayout {
  return value === 'focus' || value === 'note' || value === 'ai';
}

function isReaderSidePanelTab(value: unknown): value is ReaderSidePanelTab {
  return isReaderPanelTab(value);
}

function isLibrarySort(value: unknown): value is PersistedUiState['librarySort'] {
  if (!value || typeof value !== 'object') return false;
  const sort = value as { key?: unknown; direction?: unknown };
  return (sort.key === 'title' || sort.key === 'authors' || sort.key === 'year' || sort.key === 'venue') && (sort.direction === 'asc' || sort.direction === 'desc');
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
