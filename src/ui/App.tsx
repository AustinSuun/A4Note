import { useEffect, useMemo, useRef, useState } from 'react';
import { createAsterCore } from '../core/asterCore';
import { AIChatScene, useChatThreads, type AiReasoningLevel, type AiRunMode, type AiToolProviderId } from '../features/ai';
import { ImportDialog, LibraryScene, TagInput, useImportFlow, type LibrarySortDirection, type LibrarySortKey } from '../features/library';
import {
  ReaderScene,
  createReaderSidePanelDefinitions,
  preferredReaderFile,
  preferredReaderMode,
  preferredTranslatedFileId,
  readerPanelCommandTitle,
  useAnnotationHistory,
  type NoteDraftPatch,
  type ReaderContentMode,
  type ReaderFileMode,
  type ReaderSidePanelDefinition,
} from '../features/reader';
import {
  defaultSettings,
  SettingsScene,
  type AppSettings,
  type PluginSettingValue,
  type PluginSettingValues,
  type SettingsExtensionCounts,
  type SettingsPluginSummary,
} from '../features/settings';
import { CommandPalette, type CommandPaletteItem, type WorkspacePanelDefinition } from '../workbench';
import {
  createLibraryBackup,
  deleteNativePaper,
  getAppDiagnostics,
  getAsterPaths,
  initializeLibrary,
  isTauriRuntime,
  loadNativeDocuments,
  openPaperFile,
  revealPaperFile,
  revealAsterPath,
  restoreLibraryBackup,
  selectBackupFolder,
  updateNativePaperMetadata,
  updateNativePaperTags,
  upsertNativeNote,
  type AppDiagnostics,
  type AsterPaths,
  type PaperFileKind,
} from '../platform/nativeApi';
import type {
  AnnotationColor,
  AiProviderContribution,
  PaperDocument,
  ReaderLayout,
  ReaderSidePanelTab,
  ReaderTool,
  SceneId,
  SettingContribution,
  WorkbenchPanelContribution,
  WorkbenchPanelId,
} from '../core/types';
import { readerPanelTabFromId } from '../core/workbench';
import { baseScenes, seedDocuments } from '../data/seedDocuments';
import { clampNumber, isWorkspacePanelOpen, saveUiState, syncWorkspaceLayouts, usePersistedUiState, type WorkspaceLayoutsByScene } from '../shared/hooks';
import { FALLBACK_TAG, normalizeEditableTags } from './tagInput';
import { zh } from './zh';

type CustomColorState = { value: string };
type ConfirmDialogState = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};
type WorkbenchPanelCommandDefinition = {
  panel: WorkbenchPanelContribution;
  commandId: string;
  title: string;
  group: string;
  readerTab?: ReaderSidePanelTab;
};

const aster = createAsterCore(isTauriRuntime() ? [] : seedDocuments, baseScenes);

const sceneLabels: Record<SceneId, string> = {
  library: zh.scenes.library,
  reader: zh.scenes.reader,
  aiChat: zh.scenes.ai,
};

function appWorkbenchPanelsForScene(sceneId: SceneId, area?: WorkbenchPanelContribution['area']) {
  return aster.workbenchPanels
    .list()
    .filter((panel) => panel.sceneId === sceneId && (!area || panel.area === area))
    .sort((left, right) => left.order - right.order);
}

const readerSidePanelDefinitions: ReaderSidePanelDefinition[] = createReaderSidePanelDefinitions(appWorkbenchPanelsForScene('reader', 'right'));

const librarySidePanelDefinitions: WorkspacePanelDefinition<WorkbenchPanelId>[] = appWorkbenchPanelsForScene('library', 'right').map((panel) => ({
  id: panel.id,
  panel,
  label: libraryPanelLabel(panel.id),
}));

const workbenchPanelCommandDefinitions: WorkbenchPanelCommandDefinition[] = [
  ...appWorkbenchPanelsForScene('library', 'right'),
  ...appWorkbenchPanelsForScene('reader', 'right'),
].map((panel) => ({
  panel,
  commandId: panel.commandId,
  title: workbenchPanelCommandTitle(panel),
  group: panel.sceneId === 'reader' ? zh.command.groupReader : zh.command.groupWorkspace,
  readerTab: readerPanelTabFromId(panel.id) ?? undefined,
}));

function libraryPanelLabel(panelId: WorkbenchPanelId) {
  if (panelId === 'library.details') return zh.library.details;
  return panelId;
}

function workbenchPanelCommandTitle(panel: WorkbenchPanelContribution) {
  const readerTab = readerPanelTabFromId(panel.id);
  if (readerTab) return readerPanelCommandTitle(readerTab);
  if (panel.id === 'library.details') return `打开面板: ${zh.library.details}`;
  return panel.titleKey;
}

export default function App() {
  const initialDocuments = aster.documents.list();
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const pluginSettingContributions = useMemo(() => Array.from(aster.settings.values()).sort((left, right) => left.id.localeCompare(right.id)), []);
  const [pluginSettingValues, setPluginSettingValues] = useState<PluginSettingValues>(() => loadPluginSettingValues(aster.settings));
  const knownWorkbenchPanelIds = useMemo(() => aster.workbenchPanels.list().map((panel) => panel.id), []);
  const persistedUiState = usePersistedUiState(settings, knownWorkbenchPanelIds);
  const [activeScene, setActiveScene] = useState<SceneId>(persistedUiState.activeScene);
  const [selectedPaperId, setSelectedPaperId] = useState(persistedUiState.selectedPaperId || initialDocuments[0]?.paperId || '');
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>(persistedUiState.readerLayout || settings.defaultReaderLayout);
  const [readerContentMode, setReaderContentMode] = useState<ReaderContentMode>(persistedUiState.readerContentMode || preferredReaderMode(initialDocuments[0] ?? null));
  const initialReaderFileMode = persistedUiState.readerFileMode || preferredReaderFile(initialDocuments[0] ?? null);
  const [readerFileMode, setReaderFileMode] = useState<ReaderFileMode>(initialReaderFileMode);
  const [readerActiveFileKind, setReaderActiveFileKind] = useState<PaperFileKind>(initialReaderFileMode === 'translated' ? 'translated' : 'source');
  const [readerParallelSyncLocked, setReaderParallelSyncLocked] = useState(true);
  const [readerTranslatedFileId, setReaderTranslatedFileId] = useState(persistedUiState.readerTranslatedFileId || initialDocuments[0]?.translatedFileIds[0] || '');
  const [aiProviderId, setAiProviderId] = useState<AiToolProviderId>('codex');
  const [aiModelId, setAiModelId] = useState('gpt-5.5');
  const [aiReasoningLevel, setAiReasoningLevel] = useState<AiReasoningLevel>('extraHigh');
  const [aiPermissionMode, setAiPermissionMode] = useState('autoReview');
  const [aiRunMode, setAiRunMode] = useState<AiRunMode>('fast');
  const [query, setQuery] = useState(persistedUiState.query);
  const [activeTag, setActiveTag] = useState(persistedUiState.activeTag);
  const [workspaceLayouts] = useState<WorkspaceLayoutsByScene>(persistedUiState.workspaceLayouts);
  const [libraryDetailOpen, setLibraryDetailOpen] = useState(isWorkspacePanelOpen(persistedUiState.workspaceLayouts, 'library', 'library.details'));
  const [bulkSelectedPaperIds, setBulkSelectedPaperIds] = useState<string[]>([]);
  const [librarySort, setLibrarySort] = useState<{ key: LibrarySortKey; direction: LibrarySortDirection }>(persistedUiState.librarySort);
  const [activeAnnotationTool, setActiveAnnotationTool] = useState<ReaderTool>('cursor');
  const [activeAnnotationColor, setActiveAnnotationColor] = useState<AnnotationColor>(persistedUiState.readerAnnotationColor);
  const [customAnnotationColor, setCustomAnnotationColor] = useState<CustomColorState>({ value: '#ffc94a' });
  const [readerZoom, setReaderZoom] = useState(persistedUiState.readerZoom);
  const [readerPageState, setReaderPageState] = useState({ currentPage: 1, totalPages: 1 });
  const [readerRequestedPage, setReaderRequestedPage] = useState<number | null>(null);
  const [readerFocusedAnnotationId, setReaderFocusedAnnotationId] = useState<string | null>(null);
  const readerZoomAnchorRef = useRef<{ zoom: number; ratioX: number; ratioY: number; left: number; top: number } | null>(null);
  const librarySearchRef = useRef<HTMLInputElement | null>(null);
  const [readerSidePanelOpen, setReaderSidePanelOpen] = useState(persistedUiState.readerSidePanelOpen);
  const [readerSidePanelTab, setReaderSidePanelTab] = useState<ReaderSidePanelTab>(persistedUiState.readerSidePanelTab);
  const [noteDraftPatch, setNoteDraftPatch] = useState<NoteDraftPatch | null>(null);
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metadataEditOpen, setMetadataEditOpen] = useState(false);
  const [tagsEditOpen, setTagsEditOpen] = useState(false);
  const [bulkTagsEditOpen, setBulkTagsEditOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [libraryStatus, setLibraryStatus] = useState(isTauriRuntime() ? zh.app.initializing : zh.app.browserPreview);
  const [asterPaths, setAsterPaths] = useState<AsterPaths | null>(null);
  const [appDiagnostics, setAppDiagnostics] = useState<AppDiagnostics | null>(null);
  const currentWorkspaceLayouts = useMemo(
    () => syncWorkspaceLayouts(workspaceLayouts, {
      libraryDetailOpen,
      readerSidePanelOpen,
      readerSidePanelTab,
    }),
    [libraryDetailOpen, readerSidePanelOpen, readerSidePanelTab, workspaceLayouts],
  );

  useEffect(() => {
    document.documentElement.dataset.density = settings.density;
    saveAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    savePluginSettingValues(pluginSettingValues);
  }, [pluginSettingValues]);

  useEffect(() => {
    saveUiState({
      activeScene,
      selectedPaperId,
      query,
      activeTag,
      librarySort,
      readerLayout,
      readerContentMode,
      readerFileMode,
      readerTranslatedFileId,
      readerAnnotationColor: activeAnnotationColor,
      readerZoom,
      readerSidePanelOpen,
      readerSidePanelTab,
      workspaceLayouts: currentWorkspaceLayouts,
    });
  }, [
    activeAnnotationColor,
    activeScene,
    activeTag,
    currentWorkspaceLayouts,
    librarySort,
    query,
    readerContentMode,
    readerFileMode,
    readerLayout,
    readerSidePanelOpen,
    readerSidePanelTab,
    readerTranslatedFileId,
    readerZoom,
    selectedPaperId,
  ]);

  const changeReaderFileMode = (mode: ReaderFileMode) => {
    setReaderFileMode(mode);
    if (mode !== 'parallel') {
      setReaderActiveFileKind(mode);
    }
  };

  const refreshNativeDocuments = async (preferredPaperId?: string) => {
    if (!isTauriRuntime()) return;
    const nativeDocuments = await loadNativeDocuments();
    aster.documents.replaceAll(nativeDocuments);
    if (!nativeDocuments.length) {
      setSelectedPaperId('');
      setLibraryStatus(zh.app.readyEmpty);
      setRevision((current) => current + 1);
      return;
    }
    const nextSelected =
      preferredPaperId && nativeDocuments.some((paper) => paper.paperId === preferredPaperId)
        ? preferredPaperId
        : nativeDocuments.some((paper) => paper.paperId === selectedPaperId)
          ? selectedPaperId
          : nativeDocuments[0].paperId;
    setSelectedPaperId(nextSelected);
    const nextPaper = nativeDocuments.find((paper) => paper.paperId === nextSelected) ?? nativeDocuments[0];
    setReaderContentMode(preferredReaderMode(nextPaper));
    const nextReaderFileMode = preferredReaderFile(nextPaper);
    setReaderFileMode(nextReaderFileMode);
    if (nextReaderFileMode !== 'parallel') setReaderActiveFileKind(nextReaderFileMode);
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(nextPaper, current));
    setLibraryStatus(zh.app.loaded(nativeDocuments.length));
    setRevision((current) => current + 1);
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    initializeLibrary()
      .then((paths) => {
        setAsterPaths(paths);
        return refreshNativeDocuments();
      })
      .catch((error) => {
        console.error('Failed to initialize native library', error);
        setLibraryStatus(zh.app.initFailed);
      });
  }, []);

  useEffect(() => {
    if (!settingsOpen || !isTauriRuntime()) return;
    getAsterPaths()
      .then(setAsterPaths)
      .catch((error) => console.error('Failed to load Aster paths', error));
    getAppDiagnostics()
      .then(setAppDiagnostics)
      .catch((error) => console.error('Failed to load app diagnostics', error));
  }, [settingsOpen]);

  const documents = aster.documents.list();
  const selectedPaper = selectedPaperId ? aster.documents.get(selectedPaperId) : documents[0] ?? null;
  const bulkSelectedPapers = bulkSelectedPaperIds.map((paperId) => aster.documents.get(paperId)).filter((paper): paper is PaperDocument => Boolean(paper));
  const tags = aster.documents.allTags();
  const aiProvider = getActiveAiProvider(settings.aiProviderId);
  const settingsAiProviders = Array.from(aster.aiProviders.values());
  const settingsProviders = [...aster.metadataSources.values(), ...aster.translationSources.values(), ...settingsAiProviders];
  const settingsPlugins: SettingsPluginSummary[] = Array.from(aster.plugins.values()).map((plugin) => ({ id: plugin.id, name: plugin.name }));
  const settingsExtensionCounts: SettingsExtensionCounts = {
    commands: aster.commands.list().length,
    settings: aster.settings.size,
    views: aster.workbenchPanels.list().length,
    metadata: aster.metadataSources.size,
    translation: aster.translationSources.size,
    ai: aster.aiProviders.size,
  };
  const annotationFileMode = readerFileMode === 'parallel' ? readerActiveFileKind : readerFileMode;
  const { chatMessages, chatDraft, chatError, getAiThreadContextsForPaper, updateChatDraft, sendChatMessage, resetChatThread } = useChatThreads({
    aster,
    selectedPaper,
    aiProvider,
    refreshNativeDocuments,
  });
  const {
    annotationUndoStack,
    annotationRedoStack,
    undoAnnotationAction,
    redoAnnotationAction,
    createAnnotation,
    updateAnnotationComment,
    updateAnnotationColor,
    updateAnnotationPosition,
    deleteAnnotation,
    clearAnnotationHistory,
  } = useAnnotationHistory({
    aster,
    selectedPaper,
    readerFileMode: annotationFileMode,
    readerTranslatedFileId,
    setReaderFocusedAnnotationId,
    setRevision,
    setLibraryStatus,
  });
  const filteredPapers = useMemo(() => {
    const searched = aster.documents.search(query);
    const tagged = activeTag === 'all' ? searched : searched.filter((paper) => paper.tags.includes(activeTag));
    const sorted = [...tagged].sort((left, right) => comparePaper(left, right, librarySort));
    return sorted;
  }, [activeTag, librarySort, query, revision]);

  useEffect(() => {
    if (activeTag !== 'all' && !tags.includes(activeTag)) {
      setActiveTag('all');
    }
  }, [activeTag, tags]);

  useEffect(() => {
    if (!selectedPaper) return;
    if (readerContentMode === 'pdf' && !selectedPaper.sourcePdf && !selectedPaper.translatedPdfs.length && selectedPaper.notes.length) {
      setReaderContentMode('markdown');
    }
    if (readerContentMode === 'markdown' && !selectedPaper.notes.length && (selectedPaper.sourcePdf || selectedPaper.translatedPdfs.length)) {
      setReaderContentMode('pdf');
    }
    if ((readerFileMode === 'translated' || readerFileMode === 'parallel') && !selectedPaper.translatedPdfs.length) {
      setReaderFileMode(preferredReaderFile(selectedPaper));
    }
    if (readerFileMode !== 'parallel') {
      setReaderActiveFileKind(readerFileMode);
    } else if (readerActiveFileKind === 'translated' && !selectedPaper.translatedPdfs.length) {
      readerFileMode === 'parallel' && setReaderActiveFileKind('source');
    }
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(selectedPaper, current));
  }, [
    readerActiveFileKind,
    readerContentMode,
    readerFileMode,
    selectedPaper?.paperId,
    selectedPaper?.sourcePdf,
    selectedPaper?.translatedPdfs.length,
    selectedPaper?.translatedFileIds.join('|'),
    selectedPaper?.notes.length,
  ]);

  useEffect(() => {
    const anchor = readerZoomAnchorRef.current;
    if (!anchor) return;
    readerZoomAnchorRef.current = null;
    requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLElement>('.pdf-document');
      if (!scroller) return;
      const scale = readerZoom / anchor.zoom;
      scroller.scrollLeft = anchor.ratioX * scale - anchor.left;
      scroller.scrollTop = anchor.ratioY * scale - anchor.top;
    });
  }, [readerZoom]);

  const changeReaderZoom = (nextZoom: number, anchorPoint?: { x: number; y: number }) => {
    const scroller = document.querySelector<HTMLElement>('.pdf-document');
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const left = anchorPoint ? anchorPoint.x - rect.left : rect.width / 2;
      const top = anchorPoint ? anchorPoint.y - rect.top : rect.height / 2;
      readerZoomAnchorRef.current = {
        zoom: readerZoom,
        ratioX: scroller.scrollLeft + left,
        ratioY: scroller.scrollTop + top,
        left,
        top,
      };
    }
    setReaderZoom(nextZoom);
  };

  const fitReaderToWidth = () => {
    const scroller = document.querySelector<HTMLElement>('.pdf-document');
    const page = scroller?.querySelector<HTMLElement>('.pdf-page[data-page]');
    if (!scroller || !page) {
      changeReaderZoom(1.18);
      return;
    }
    const currentWidth = page.getBoundingClientRect().width;
    if (!currentWidth) {
      changeReaderZoom(1.18);
      return;
    }
    const baseWidth = currentWidth / readerZoom;
    const availableWidth = Math.max(scroller.clientWidth - 56, 320);
    const nextZoom = clampNumber(Number((availableWidth / baseWidth).toFixed(2)), 0.7, 2.2);
    changeReaderZoom(nextZoom);
  };

  const setScene = (sceneId: SceneId) => {
    setActiveScene(sceneId);
    setSettingsOpen(false);
  };

  const openCommandPalette = () => {
    setCommandPaletteQuery('');
    setCommandPaletteOpen(true);
  };

  const closeCommandPalette = () => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery('');
  };

  const cleanupAfterPaperDeletion = (deletedPaperIds: string[]) => {
    if (!deletedPaperIds.length) return;
    const deletedSet = new Set(deletedPaperIds);
    const deletedSelectedPaper = selectedPaperId ? deletedSet.has(selectedPaperId) : false;
    setMetadataEditOpen(false);
    setTagsEditOpen(false);
    setBulkTagsEditOpen(false);
    setLibraryDetailOpen(false);
    setBulkSelectedPaperIds((current) => current.filter((paperId) => !deletedSet.has(paperId)));
    setReaderRequestedPage(null);
    setReaderFocusedAnnotationId(null);
    setNoteDraftPatch(null);
    if (deletedSelectedPaper) {
      clearAnnotationHistory();
      if (activeScene === 'reader') {
        setScene('library');
      }
    }
  };

  const selectPaperAfterDeletion = (deletedPaperIds: string[], remainingDocuments: PaperDocument[]) => {
    if (!remainingDocuments.length) {
      setSelectedPaperId('');
      setReaderContentMode('pdf');
      setReaderFileMode('source');
      setReaderActiveFileKind('source');
      setReaderTranslatedFileId('');
      return;
    }
    const deletedSet = new Set(deletedPaperIds);
    const nextSelectedPaper =
      selectedPaperId && !deletedSet.has(selectedPaperId) && remainingDocuments.some((paper) => paper.paperId === selectedPaperId)
        ? selectedPaperId
        : remainingDocuments[0].paperId;
    const nextPaper = remainingDocuments.find((paper) => paper.paperId === nextSelectedPaper) ?? remainingDocuments[0];
    setSelectedPaperId(nextSelectedPaper);
    setReaderContentMode(preferredReaderMode(nextPaper));
    const nextReaderFileMode = preferredReaderFile(nextPaper);
    setReaderFileMode(nextReaderFileMode);
    if (nextReaderFileMode !== 'parallel') setReaderActiveFileKind(nextReaderFileMode);
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(nextPaper, current));
  };

  const openReaderForPaper = (paperId: string) => {
    setSelectedPaperId(paperId);
    setReaderRequestedPage(null);
    setReaderFocusedAnnotationId(null);
    const paper = aster.documents.get(paperId) ?? documents.find((candidate) => candidate.paperId === paperId) ?? null;
    setReaderContentMode(preferredReaderMode(paper));
    const nextReaderFileMode = preferredReaderFile(paper);
    setReaderFileMode(nextReaderFileMode);
    if (nextReaderFileMode !== 'parallel') setReaderActiveFileKind(nextReaderFileMode);
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(paper, current));
    setScene('reader');
  };

  const openReaderPanel = (paperId: string, tab: ReaderSidePanelTab) => {
    openReaderForPaper(paperId);
    setReaderSidePanelTab(tab);
    setReaderSidePanelOpen(true);
  };

  const openReaderRelationsForPaper = (paperId: string) => {
    openReaderPanel(paperId, 'relations');
  };

  const openWorkbenchPanelCommand = (definition: WorkbenchPanelCommandDefinition) => {
    if (!selectedPaper && definition.panel.context === 'paper') return;
    if (definition.panel.id === 'library.details') {
      setScene('library');
      setLibraryDetailOpen(true);
      return;
    }
    if (definition.readerTab && selectedPaper) {
      openReaderPanel(selectedPaper.paperId, definition.readerTab);
    }
  };

  const {
    importOpen,
    importState,
    draft,
    lastImportedPaperTitle,
    setDraft,
    setImportOpen,
    openImportDialog,
    extractDraftForPath,
    choosePdfIntoDraft,
    confirmImport,
    importTranslatedPdf,
  } = useImportFlow({
    aster,
    selectedPaper,
    refreshNativeDocuments,
    openReaderForPaper,
    setSelectedPaperId,
    setReaderContentMode,
    setReaderFileMode: changeReaderFileMode,
    setReaderTranslatedFileId,
    setActiveTag,
    setRevision,
    setLibraryStatus,
  });

  const revealSelectedPaperFile = async (kind: PaperFileKind) => {
    if (!selectedPaper) return;
    if (!isTauriRuntime()) {
      setLibraryStatus(zh.app.browserPreview);
      return;
    }
    try {
      await revealPaperFile({
        paperId: selectedPaper.paperId,
        kind,
        fileId: kind === 'translated' ? preferredTranslatedFileId(selectedPaper, readerTranslatedFileId) : selectedPaper.sourceFileId,
      });
    } catch (error) {
      console.error('Reveal paper file failed', error);
      setLibraryStatus(kind === 'translated' ? zh.library.revealTranslatedFailed : zh.library.revealSourceFailed);
    }
  };

  const openSelectedPaperFile = async (kind: PaperFileKind) => {
    if (!selectedPaper) return;
    if (!isTauriRuntime()) {
      setLibraryStatus(zh.app.browserPreview);
      return;
    }
    try {
      await openPaperFile({
        paperId: selectedPaper.paperId,
        kind,
        fileId: kind === 'translated' ? preferredTranslatedFileId(selectedPaper, readerTranslatedFileId) : selectedPaper.sourceFileId,
      });
    } catch (error) {
      console.error('Open paper file failed', error);
      setLibraryStatus(kind === 'translated' ? zh.library.openTranslatedFailed : zh.library.openSourceFailed);
    }
  };

  const applyAnnotationColor = (color: AnnotationColor) => {
    setActiveAnnotationColor(color);
    if (color.startsWith('#')) {
      setCustomAnnotationColor({ value: color });
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      const readerKey = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && !importOpen && !metadataEditOpen && !tagsEditOpen && !bulkTagsEditOpen) {
        if (readerKey === 'k' || (readerKey === 'p' && event.shiftKey)) {
          event.preventDefault();
          openCommandPalette();
          return;
        }
      }

      if (commandPaletteOpen) return;

      if (!isEditable && !importOpen && !metadataEditOpen && !tagsEditOpen && !bulkTagsEditOpen && activeScene === 'reader') {
        if (readerKey === 'delete' || readerKey === 'backspace') {
          if (readerFocusedAnnotationId) {
            event.preventDefault();
            void deleteAnnotation(readerFocusedAnnotationId);
          }
          return;
        }
        if (readerKey === 'escape') {
          event.preventDefault();
          setReaderFocusedAnnotationId(null);
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey) return;

      if (readerKey === 'z') {
        if (activeScene === 'reader' && event.shiftKey) {
          event.preventDefault();
          redoAnnotationAction();
        } else if (activeScene === 'reader') {
          event.preventDefault();
          undoAnnotationAction();
        }
        return;
      }
      if (readerKey === 'y') {
        if (activeScene === 'reader') {
          event.preventDefault();
          redoAnnotationAction();
        }
        return;
      }

      if (activeScene === 'reader' && readerContentMode === 'pdf') {
        if (readerKey === '=' || readerKey === '+') {
          event.preventDefault();
          changeReaderZoom(Math.min(2.2, Number((readerZoom + 0.1).toFixed(2))));
          return;
        }
        if (readerKey === '-' || readerKey === '_') {
          event.preventDefault();
          changeReaderZoom(Math.max(0.7, Number((readerZoom - 0.1).toFixed(2))));
          return;
        }
        if (readerKey === '0') {
          event.preventDefault();
          fitReaderToWidth();
          return;
        }
        const toolByKey: Partial<Record<string, ReaderTool>> = {
          m: 'cursor',
          h: 'highlight',
          u: 'underline',
          b: 'area',
          t: 'text',
          p: 'ink',
          e: 'eraser',
          r: 'rect',
          a: 'arrow',
        };
        const nextTool = toolByKey[readerKey];
        if (nextTool) {
          event.preventDefault();
          setActiveAnnotationTool(nextTool);
          return;
        }
      }

      if (event.key === '1') {
        event.preventDefault();
        setScene('library');
        return;
      }
      if (event.key === '2') {
        event.preventDefault();
        setScene('reader');
        return;
      }
      if (event.key === '3') {
        event.preventDefault();
        setScene('aiChat');
        return;
      }

      if (isEditable || importOpen || metadataEditOpen || tagsEditOpen || bulkTagsEditOpen) return;

      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openImportDialog();
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setScene('library');
        requestAnimationFrame(() => librarySearchRef.current?.focus());
        return;
      }
      if (event.key === 'Enter' && selectedPaper) {
        event.preventDefault();
        openReaderForPaper(selectedPaper.paperId);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeScene, annotationRedoStack, annotationUndoStack, bulkTagsEditOpen, commandPaletteOpen, importOpen, metadataEditOpen, readerContentMode, readerFocusedAnnotationId, readerZoom, selectedPaper?.paperId, tagsEditOpen, deleteAnnotation, fitReaderToWidth, redoAnnotationAction, undoAnnotationAction]);

  const saveNote = async (content: string) => {
    if (!selectedPaper) return;
    if (isTauriRuntime()) {
      await upsertNativeNote({
        paperId: selectedPaper.paperId,
        noteId: selectedPaper.notes[0]?.id,
        title: selectedPaper.notes[0]?.title ?? '闃呰绗旇',
        content,
      });
      await refreshNativeDocuments(selectedPaper.paperId);
      return;
    }
    aster.commands.execute('document.updatePrimaryNote', { paperId: selectedPaper.paperId, content });
    setRevision((current) => current + 1);
  };

  const createNoteAndSwitch = async () => {
    if (!selectedPaper) return;
    await saveNote(zh.reader.notePlaceholder);
    setReaderContentMode('markdown');
  };

  const savePaperMetadata = async (paper: PaperDocument) => {
    if (isTauriRuntime()) {
      try {
        await updateNativePaperMetadata({
          paperId: paper.paperId,
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          venue: paper.venue,
          doi: paper.doi,
        });
        await refreshNativeDocuments(paper.paperId);
        setMetadataEditOpen(false);
        setLibraryStatus(zh.app.saveSuccess);
      } catch (error) {
        console.error('Paper metadata update failed', error);
        setLibraryStatus(zh.app.saveFailed);
      }
      return;
    }
    const localPaper = aster.documents.get(paper.paperId);
    if (localPaper) {
      Object.assign(localPaper, {
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
      });
      setRevision((current) => current + 1);
    }
    setMetadataEditOpen(false);
  };

  const savePaperTags = async (paperId: string, tags: string[]) => {
    if (isTauriRuntime()) {
      try {
        await updateNativePaperTags({ paperId, tags });
        await refreshNativeDocuments(paperId);
        setTagsEditOpen(false);
        setLibraryStatus(zh.app.saveSuccess);
      } catch (error) {
        console.error('Paper tags update failed', error);
        setLibraryStatus(zh.app.saveFailed);
      }
      return;
    }
    const localPaper = aster.documents.get(paperId);
    if (localPaper) {
      localPaper.tags = normalizeEditableTags(tags);
      setRevision((current) => current + 1);
    }
    setTagsEditOpen(false);
  };

  const saveBulkPaperTags = async (paperIds: string[], tags: string[]) => {
    const normalized = normalizeEditableTags(tags);
    if (isTauriRuntime()) {
      try {
        for (const paperId of paperIds) {
          await updateNativePaperTags({ paperId, tags: normalized });
        }
        await refreshNativeDocuments(paperIds[0]);
        setBulkTagsEditOpen(false);
        setBulkSelectedPaperIds([]);
        setLibraryStatus(zh.library.bulkTagsSaved(paperIds.length));
      } catch (error) {
        console.error('Bulk paper tags update failed', error);
        setLibraryStatus(zh.app.saveFailed);
      }
      return;
    }
    for (const paperId of paperIds) {
      const localPaper = aster.documents.get(paperId);
      if (localPaper) localPaper.tags = normalized;
    }
    setBulkTagsEditOpen(false);
    setBulkSelectedPaperIds([]);
    setRevision((current) => current + 1);
  };

  const deleteSelectedPaper = async () => {
    if (!selectedPaper) return;
    setConfirmDialog({
      title: zh.library.deleteConfirmTitle,
      message: zh.library.confirmDelete(selectedPaper.title),
      detail: selectedPaper.title,
      confirmLabel: zh.library.delete,
      danger: true,
      onConfirm: () => executeDeleteSelectedPaper(selectedPaper.paperId),
    });
  };

  const executeDeleteSelectedPaper = async (paperId: string) => {
    if (isTauriRuntime()) {
      try {
        await deleteNativePaper(paperId);
        await refreshNativeDocuments();
        cleanupAfterPaperDeletion([paperId]);
        setLibraryStatus(zh.app.deleteSuccess);
      } catch (error) {
        console.error('Paper delete failed', error);
        setLibraryStatus(zh.app.deleteFailed);
      }
      return;
    }
    const remainingDocuments = documents.filter((paper) => paper.paperId !== paperId);
    aster.documents.replaceAll(remainingDocuments);
    cleanupAfterPaperDeletion([paperId]);
    selectPaperAfterDeletion([paperId], remainingDocuments);
    setRevision((current) => current + 1);
  };

  const deleteBulkSelectedPapers = async () => {
    const paperIds = bulkSelectedPaperIds.filter((paperId) => aster.documents.get(paperId));
    if (!paperIds.length) return;
    const papers = paperIds.map((paperId) => aster.documents.get(paperId)).filter((paper): paper is PaperDocument => Boolean(paper));
    setConfirmDialog({
      title: zh.library.bulkDeleteConfirmTitle,
      message: zh.library.confirmBulkDelete(paperIds.length),
      detail: formatConfirmPaperList(papers),
      confirmLabel: zh.library.bulkDelete,
      danger: true,
      onConfirm: () => executeDeleteBulkSelectedPapers(paperIds),
    });
  };

  const executeDeleteBulkSelectedPapers = async (paperIds: string[]) => {
    if (isTauriRuntime()) {
      try {
        for (const paperId of paperIds) {
          await deleteNativePaper(paperId);
        }
        await refreshNativeDocuments();
        cleanupAfterPaperDeletion(paperIds);
        setLibraryStatus(zh.library.bulkDeleteSuccess(paperIds.length));
      } catch (error) {
        console.error('Bulk paper delete failed', error);
        setLibraryStatus(zh.app.deleteFailed);
      }
      return;
    }
    const remainingDocuments = documents.filter((paper) => !paperIds.includes(paper.paperId));
    aster.documents.replaceAll(remainingDocuments);
    cleanupAfterPaperDeletion(paperIds);
    selectPaperAfterDeletion(paperIds, remainingDocuments);
    setRevision((current) => current + 1);
  };

  const copyLibraryExport = async (format: 'markdown' | 'csv') => {
    if (!filteredPapers.length) return;
    const content = format === 'markdown' ? formatPapersAsMarkdown(filteredPapers) : formatPapersAsCsv(filteredPapers);
    try {
      await navigator.clipboard.writeText(content);
      setLibraryStatus(format === 'markdown' ? zh.library.copyMarkdownSuccess(filteredPapers.length) : zh.library.copyCsvSuccess(filteredPapers.length));
    } catch (error) {
      console.error('Library export copy failed', error);
      setLibraryStatus(zh.library.copyFailed);
    }
  };

  const copySelectedBibtex = async () => {
    if (!selectedPaper) return;
    try {
      await navigator.clipboard.writeText(formatPaperAsBibtex(selectedPaper));
      setLibraryStatus(zh.library.copyBibtexSuccess(selectedPaper.title));
    } catch (error) {
      console.error('BibTeX copy failed', error);
      setLibraryStatus(zh.library.copyFailed);
    }
  };

  const copyBulkBibtex = async () => {
    const papers = bulkSelectedPaperIds.map((paperId) => aster.documents.get(paperId)).filter((paper): paper is PaperDocument => Boolean(paper));
    if (!papers.length) return;
    try {
      await navigator.clipboard.writeText(formatPapersAsBibtex(papers));
      setLibraryStatus(zh.library.copyBulkBibtexSuccess(papers.length));
    } catch (error) {
      console.error('Bulk BibTeX copy failed', error);
      setLibraryStatus(zh.library.copyFailed);
    }
  };

  const appendAnnotationToNote = (annotationId: string) => {
    if (!selectedPaper) return;
    const annotation = selectedPaper.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    setNoteDraftPatch({
      append: `\n\n@annotation(${annotation.id})\n`,
    });
    setReaderSidePanelOpen(true);
    setReaderSidePanelTab('notes');
  };

  const confirmResetChatThread = (paperId: string) => {
    const paper = aster.documents.get(paperId);
    if (!paper) return;
    setConfirmDialog({
      title: zh.ai.resetConfirmTitle,
      message: zh.ai.confirmReset,
      detail: paper.title,
      confirmLabel: zh.ai.newThread,
      danger: true,
      onConfirm: () => resetChatThread(paperId),
    });
  };

  const restoreBackupFromSettings = async () => {
    if (!isTauriRuntime()) {
      setLibraryStatus(zh.settings.restoreUnavailable);
      return;
    }
    const selected = await selectBackupFolder();
    if (!selected) return;
    setConfirmDialog({
      title: zh.settings.restoreConfirmTitle,
      message: zh.settings.confirmRestore,
      detail: selected,
      confirmLabel: zh.settings.restoreBackup,
      danger: true,
      onConfirm: () => executeRestoreBackupFromSettings(selected),
    });
  };

  const executeRestoreBackupFromSettings = async (selected: string) => {
    try {
      const result = await restoreLibraryBackup(selected);
      await refreshNativeDocuments();
      setActiveTag('all');
      setQuery('');
      setBulkSelectedPaperIds([]);
      setLibraryDetailOpen(false);
      setSettingsOpen(false);
      setScene('library');
      setLibraryStatus(zh.settings.restoreSuccess(result.safety_backup_path));
    } catch (error) {
      console.error('Restore backup failed', error);
      setLibraryStatus(zh.settings.restoreFailed);
      throw error;
    }
  };

  const appCommands = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'library.importPdf',
        title: zh.command.importPdf,
        group: zh.command.groupLibrary,
        shortcut: 'Ctrl+O',
        run: openImportDialog,
      },
      {
        id: 'library.search',
        title: zh.command.searchLibrary,
        group: zh.command.groupLibrary,
        shortcut: 'Ctrl+F',
        run: () => {
          setScene('library');
          requestAnimationFrame(() => librarySearchRef.current?.focus());
        },
      },
      {
        id: 'scene.library',
        title: zh.command.openLibrary,
        group: zh.command.groupScenes,
        shortcut: 'Ctrl+1',
        run: () => setScene('library'),
      },
      {
        id: 'scene.reader',
        title: zh.command.openReader,
        group: zh.command.groupScenes,
        shortcut: 'Ctrl+2',
        disabled: !selectedPaper,
        run: () => selectedPaper && openReaderForPaper(selectedPaper.paperId),
      },
      {
        id: 'scene.ai',
        title: zh.command.openAi,
        group: zh.command.groupScenes,
        shortcut: 'Ctrl+3',
        run: () => setScene('aiChat'),
      },
      {
        id: 'settings.open',
        title: zh.command.openSettings,
        group: zh.command.groupWorkspace,
        run: () => setSettingsOpen(true),
      },
      ...workbenchPanelCommandDefinitions.map<CommandPaletteItem>((definition) => ({
        id: definition.commandId,
        title: definition.title,
        group: definition.group,
        disabled: definition.panel.context === 'paper' && !selectedPaper,
        run: () => openWorkbenchPanelCommand(definition),
      })),
      ...aster.commands
        .list()
        .filter((command) => command.visibleInPalette)
        .map<CommandPaletteItem>((command) => ({
          id: `registered.${command.id}`,
          title: command.title,
          group: command.group ?? (command.source?.startsWith('plugin:') ? '插件' : zh.command.groupWorkspace),
          shortcut: command.shortcut,
          run: () => {
            try {
              aster.commands.execute(command.id, undefined);
            } catch (error) {
              console.error('Palette command failed', error);
              setLibraryStatus(zh.app.actionFailed);
            }
          },
        })),
    ],
    [selectedPaper?.paperId],
  );

  return (
    <div className="app-shell">
      <nav className="scene-rail" aria-label="场景导航">
        <div className="scene-buttons">
          {aster.scenes.list().map((scene) => (
            <button
              key={scene.id}
              className={activeScene === scene.id ? 'scene-button active' : 'scene-button'}
              type="button"
              title={`${sceneLabels[scene.id]} Ctrl+${scene.key}`}
              onClick={() => setScene(scene.id)}
            >
              <SceneIcon id={scene.id} />
              <span className="scene-button-label">{sceneLabels[scene.id]}</span>
            </button>
          ))}
        </div>
        <div className="scene-utility-buttons">
          <button className={commandPaletteOpen ? 'scene-button active' : 'scene-button'} type="button" title={zh.command.openShortcut} onClick={openCommandPalette}>
            <CommandIcon />
          </button>
          <button className={settingsOpen ? 'scene-button settings active' : 'scene-button settings'} type="button" title={zh.scenes.settings} onClick={() => setSettingsOpen((value) => !value)}>
            <SettingsIcon />
          </button>
        </div>
      </nav>

      <main className="workspace">
        <div className={settingsOpen ? 'scene-host hidden' : 'scene-host'}>
          <div className={activeScene === 'library' ? 'scene-frame active' : 'scene-frame hidden'} aria-hidden={activeScene !== 'library'}>
            <LibraryScene
              papers={filteredPapers}
              selectedPaper={selectedPaper}
              tags={tags}
              activeTag={activeTag}
              query={query}
              sort={librarySort}
              status={libraryStatus}
              lastImportedPaperTitle={lastImportedPaperTitle}
              detailOpen={libraryDetailOpen}
              aiThreadContexts={selectedPaper ? getAiThreadContextsForPaper(selectedPaper.paperId) : []}
              bulkSelectedPaperIds={bulkSelectedPaperIds}
              searchInputRef={librarySearchRef}
              sidePanels={librarySidePanelDefinitions}
              onQueryChange={setQuery}
              onSelectPaper={setSelectedPaperId}
              onBulkSelectionChange={setBulkSelectedPaperIds}
              onOpenPaper={openReaderForPaper}
              onSelectTag={setActiveTag}
              onSortChange={setLibrarySort}
              onDetailOpenChange={setLibraryDetailOpen}
              onOpenImport={openImportDialog}
              onOpenReader={() => selectedPaper && openReaderForPaper(selectedPaper.paperId)}
              onOpenRelations={() => selectedPaper && openReaderRelationsForPaper(selectedPaper.paperId)}
              onOpenTranslationImport={importTranslatedPdf}
              onRevealSourcePdf={() => void revealSelectedPaperFile('source')}
              onRevealTranslatedPdf={() => void revealSelectedPaperFile('translated')}
              onOpenSourcePdfExternal={() => void openSelectedPaperFile('source')}
              onOpenTranslatedPdfExternal={() => void openSelectedPaperFile('translated')}
              onOpenMetadataEdit={() => setMetadataEditOpen(true)}
              onOpenTagsEdit={() => setTagsEditOpen(true)}
              onOpenBulkTagsEdit={() => setBulkTagsEditOpen(true)}
              onBulkDelete={() => void deleteBulkSelectedPapers()}
              onDeletePaper={deleteSelectedPaper}
              onCopyMarkdown={() => void copyLibraryExport('markdown')}
              onCopyCsv={() => void copyLibraryExport('csv')}
              onCopyBibtex={() => void copySelectedBibtex()}
              onCopyBulkBibtex={() => void copyBulkBibtex()}
            />
          </div>
          <div className={activeScene === 'reader' ? 'scene-frame active' : 'scene-frame hidden'} aria-hidden={activeScene !== 'reader'}>
            {selectedPaper ? (
              <ReaderScene
                paper={selectedPaper}
                layout={readerLayout}
                contentMode={readerContentMode}
                fileMode={readerFileMode}
                translatedFileId={readerTranslatedFileId}
                activeParallelFileKind={readerActiveFileKind}
                parallelSyncLocked={readerParallelSyncLocked}
                activeAnnotationTool={activeAnnotationTool}
                zoom={readerZoom}
                requestedPage={readerRequestedPage}
                sidePanelOpen={readerSidePanelOpen}
                sidePanelTab={readerSidePanelTab}
                aiThreadContexts={getAiThreadContextsForPaper(selectedPaper.paperId)}
                sidePanels={readerSidePanelDefinitions}
                onLayoutChange={(layout) => {
                  setReaderLayout(layout);
                  setSettings((current) => ({ ...current, defaultReaderLayout: layout }));
                  if (layout === 'note') {
                    setReaderSidePanelOpen(true);
                    setReaderSidePanelTab('notes');
                  }
                  if (layout === 'ai') {
                    setReaderSidePanelOpen(true);
                    setReaderSidePanelTab('chat');
                  }
                  if (layout === 'focus') {
                    setReaderSidePanelOpen(false);
                  }
                }}
                onContentModeChange={setReaderContentMode}
                onFileModeChange={changeReaderFileMode}
                onTranslatedFileIdChange={setReaderTranslatedFileId}
                onActiveParallelFileKindChange={setReaderActiveFileKind}
                onParallelSyncLockedChange={setReaderParallelSyncLocked}
                onSelectAnnotationTool={setActiveAnnotationTool}
                onSelectAnnotationColor={setActiveAnnotationColor}
                customAnnotationColor={customAnnotationColor.value}
                onCustomAnnotationColorChange={(value) => setCustomAnnotationColor({ value })}
                onZoomChange={changeReaderZoom}
                onFitWidth={fitReaderToWidth}
                onSidePanelOpenChange={setReaderSidePanelOpen}
                onSidePanelTabChange={(tab) => {
                  setReaderSidePanelTab(tab);
                  setReaderSidePanelOpen(true);
                }}
                onCreateAnnotation={createAnnotation}
                onUpdateAnnotationComment={updateAnnotationComment}
                onUpdateAnnotationPosition={updateAnnotationPosition}
                onUpdateAnnotationColor={updateAnnotationColor}
                onDeleteAnnotation={deleteAnnotation}
                readerPageState={readerPageState}
                focusedAnnotationId={readerFocusedAnnotationId}
                activeAnnotationColor={activeAnnotationColor}
                onReaderStateChange={setReaderPageState}
                onFocusAnnotation={setReaderFocusedAnnotationId}
                onJumpToPage={(page) => setReaderRequestedPage(page)}
                onNoteSave={saveNote}
                onCreateNote={createNoteAndSwitch}
                noteDraftPatch={noteDraftPatch}
                onNoteDraftPatchConsumed={() => setNoteDraftPatch(null)}
                onAppendAnnotationToNote={appendAnnotationToNote}
              />
            ) : (
              <EmptyScene title={zh.reader.noPaperTitle} description={zh.reader.noPaperDescription} action={zh.library.importPdf} onAction={openImportDialog} />
            )}
          </div>
          <div className={activeScene === 'aiChat' ? 'scene-frame active' : 'scene-frame hidden'} aria-hidden={activeScene !== 'aiChat'}>
            {selectedPaper ? (
              <AIChatScene
                papers={documents}
                selectedPaper={selectedPaper}
                messages={chatMessages}
                draft={chatDraft}
                error={chatError}
                providerId={aiProviderId}
                modelId={aiModelId}
                reasoningLevel={aiReasoningLevel}
                permissionMode={aiPermissionMode}
                runMode={aiRunMode}
                onSelectPaper={setSelectedPaperId}
                onDraftChange={(draft) => updateChatDraft(selectedPaper.paperId, draft)}
                onAiProviderChange={setAiProviderId}
                onAiModelChange={setAiModelId}
                onAiReasoningChange={setAiReasoningLevel}
                onAiPermissionChange={setAiPermissionMode}
                onAiRunModeChange={setAiRunMode}
                onSend={() => void sendChatMessage(selectedPaper.paperId)}
                onReset={() => confirmResetChatThread(selectedPaper.paperId)}
              />
            ) : (
              <EmptyScene title={zh.ai.noPaperTitle} description={zh.ai.noPaperDescription} action={zh.library.importPdf} onAction={openImportDialog} />
            )}
          </div>
        </div>
        {settingsOpen && (
          <div className="scene-frame active settings-frame" aria-hidden={false}>
            <SettingsScene
              settings={settings}
              pluginSettings={pluginSettingContributions}
              pluginSettingValues={pluginSettingValues}
              paths={asterPaths}
              diagnostics={appDiagnostics}
              aiProviders={settingsAiProviders}
              providers={settingsProviders}
              plugins={settingsPlugins}
              extensionCounts={settingsExtensionCounts}
              onChange={setSettings}
              onPluginSettingChange={(settingId, value) => setPluginSettingValues((current) => ({ ...current, [settingId]: value }))}
              onRefreshPaths={() => {
                void getAsterPaths().then(setAsterPaths);
                void getAppDiagnostics().then(setAppDiagnostics);
              }}
              onRevealPath={(kind) => revealAsterPath(kind)}
              onCreateBackup={createLibraryBackup}
              onRestoreBackup={restoreBackupFromSettings}
            />
          </div>
        )}
      </main>

      {importOpen && (
        <ImportDialog
          draft={draft}
          suggestions={tags}
          state={importState}
          settings={settings}
          onChangeDraft={setDraft}
          onSelectPdf={choosePdfIntoDraft}
          onRegenerate={() => extractDraftForPath(draft.originalPath)}
          onClose={() => setImportOpen(false)}
          onConfirm={confirmImport}
        />
      )}
      {metadataEditOpen && selectedPaper && <MetadataEditDialog paper={selectedPaper} onClose={() => setMetadataEditOpen(false)} onSave={savePaperMetadata} />}
      {tagsEditOpen && selectedPaper && <TagsEditDialog paper={selectedPaper} suggestions={tags} onClose={() => setTagsEditOpen(false)} onSave={savePaperTags} />}
      {bulkTagsEditOpen && bulkSelectedPapers.length > 0 && (
        <BulkTagsDialog papers={bulkSelectedPapers} suggestions={tags} onClose={() => setBulkTagsEditOpen(false)} onSave={saveBulkPaperTags} />
      )}
      {commandPaletteOpen && (
        <CommandPalette commands={appCommands} query={commandPaletteQuery} onQueryChange={setCommandPaletteQuery} onClose={closeCommandPalette} labels={zh.command} />
      )}
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </div>
  );
}

function MetadataEditDialog({ paper, onClose, onSave }: { paper: PaperDocument; onClose: () => void; onSave: (paper: PaperDocument) => void | Promise<void> }) {
  const [form, setForm] = useState({
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
  });
  const update = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: field === 'year' ? Number(value) || '' : value }));
  };
  return (
    <div className="modal-backdrop">
      <section className="import-dialog edit-dialog">
        <header>
          <h2>{zh.editDialog.title}</h2>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.close}
          </button>
        </header>
        <div className="import-grid">
          <label className="wide">
            {zh.editDialog.paperTitle}
            <input value={form.title} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label>
            {zh.editDialog.authors}
            <input value={form.authors} onChange={(event) => update('authors', event.target.value)} />
          </label>
          <label>
            {zh.editDialog.year}
            <input value={form.year} onChange={(event) => update('year', event.target.value)} />
          </label>
          <label>
            {zh.editDialog.venue}
            <input value={form.venue} onChange={(event) => update('venue', event.target.value)} />
          </label>
          <label>
            {zh.editDialog.doi}
            <input value={form.doi} onChange={(event) => update('doi', event.target.value)} />
          </label>
        </div>
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.cancel}
          </button>
          <button type="button" className="primary rounded-button" onClick={() => void onSave({ ...paper, ...form })}>
            {zh.editDialog.save}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TagsEditDialog({
  paper,
  suggestions,
  onClose,
  onSave,
}: {
  paper: PaperDocument;
  suggestions: string[];
  onClose: () => void;
  onSave: (paperId: string, tags: string[]) => void | Promise<void>;
}) {
  const [tags, setTags] = useState(normalizeEditableTags(paper.tags));
  useEffect(() => {
    setTags(normalizeEditableTags(paper.tags));
  }, [paper.paperId, paper.tags]);
  return (
    <div className="modal-backdrop">
      <section className="import-dialog edit-dialog">
        <header>
          <h2>{zh.editDialog.tagsTitle}</h2>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.close}
          </button>
        </header>
        <div className="import-grid">
          <label className="wide">
            {zh.editDialog.tags}
            <TagInput value={tags} suggestions={suggestions} placeholder={zh.importDialog.tagsPlaceholder} onChange={setTags} />
          </label>
        </div>
        <div className="import-hint">{zh.editDialog.tagsHint}</div>
        <div className="tag-row editable-preview">
          {tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.cancel}
          </button>
          <button type="button" className="primary rounded-button" onClick={() => void onSave(paper.paperId, tags)}>
            {zh.editDialog.save}
          </button>
        </footer>
      </section>
    </div>
  );
}

function BulkTagsDialog({
  papers,
  suggestions,
  onClose,
  onSave,
}: {
  papers: PaperDocument[];
  suggestions: string[];
  onClose: () => void;
  onSave: (paperIds: string[], tags: string[]) => void | Promise<void>;
}) {
  const sharedTags = commonTags(papers);
  const [tags, setTags] = useState(normalizeEditableTags(sharedTags));
  return (
    <div className="modal-backdrop">
      <section className="import-dialog edit-dialog">
        <header>
          <div>
            <h2>{zh.library.bulkTagsTitle}</h2>
            <p className="scene-description">{zh.library.bulkSelected(papers.length)}</p>
          </div>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.close}
          </button>
        </header>
        <div className="import-grid">
          <label className="wide">
            {zh.editDialog.tags}
            <TagInput value={tags} suggestions={suggestions} placeholder={zh.importDialog.tagsPlaceholder} onChange={setTags} />
          </label>
        </div>
        <div className="import-hint">{zh.library.bulkTagsHint}</div>
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.editDialog.cancel}
          </button>
          <button type="button" className="primary rounded-button" onClick={() => void onSave(papers.map((paper) => paper.paperId), tags)}>
            {zh.editDialog.save}
          </button>
        </footer>
      </section>
    </div>
  );
}

function commonTags(papers: PaperDocument[]) {
  if (!papers.length) return [];
  return papers[0].tags.filter((tag) => papers.every((paper) => paper.tags.includes(tag)));
}

function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmDialogState; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await dialog.onConfirm();
      onClose();
    } catch (error) {
      console.error('Confirmation action failed', error);
      setError(zh.app.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="import-dialog edit-dialog confirm-dialog">
        <header>
          <div>
            <h2>{dialog.title}</h2>
            <p className="scene-description">{dialog.message}</p>
            {dialog.detail && <code className="confirm-detail">{dialog.detail}</code>}
          </div>
          <button type="button" className="rounded-button subtle-button" onClick={onClose} disabled={busy}>
            {zh.editDialog.close}
          </button>
        </header>
        {error && <div className="confirm-error">{error}</div>}
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={onClose} disabled={busy}>
            {zh.editDialog.cancel}
          </button>
          <button type="button" className={dialog.danger ? 'primary rounded-button danger-confirm' : 'primary rounded-button'} onClick={() => void confirm()} disabled={busy}>
            {dialog.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('aster.settings');
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
}

function saveAppSettings(settings: AppSettings) {
  localStorage.setItem('aster.settings', JSON.stringify(settings));
}

function loadPluginSettingValues(settings: Map<string, SettingContribution>): PluginSettingValues {
  const defaults = defaultPluginSettingValues(settings);
  try {
    const raw = localStorage.getItem('aster.pluginSettings');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizePluginSettingValues(settings, parsed, defaults);
  } catch {
    return defaults;
  }
}

function defaultPluginSettingValues(settings: Map<string, SettingContribution>): PluginSettingValues {
  return Object.fromEntries([...settings.values()].map((setting) => [setting.id, setting.defaultValue]));
}

function normalizePluginSettingValues(settings: Map<string, SettingContribution>, value: Record<string, unknown>, fallback: PluginSettingValues): PluginSettingValues {
  const normalized: PluginSettingValues = { ...fallback };
  for (const setting of settings.values()) {
    const candidate = value[setting.id];
    if (typeof setting.defaultValue === 'boolean') {
      normalized[setting.id] = typeof candidate === 'boolean' ? candidate : setting.defaultValue;
    } else if (typeof setting.defaultValue === 'number') {
      normalized[setting.id] = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : setting.defaultValue;
    } else {
      normalized[setting.id] = typeof candidate === 'string' ? candidate : setting.defaultValue;
    }
  }
  return normalized;
}

function savePluginSettingValues(values: PluginSettingValues) {
  localStorage.setItem('aster.pluginSettings', JSON.stringify(values));
}

function getActiveAiProvider(providerId: string): AiProviderContribution {
  return aster.aiProviders.get(providerId) ?? aster.aiProviders.get(defaultSettings.aiProviderId) ?? [...aster.aiProviders.values()][0];
}

function comparePaper(left: PaperDocument, right: PaperDocument, sort: { key: LibrarySortKey; direction: LibrarySortDirection }) {
  const factor = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'year') {
    const leftYear = typeof left.year === 'number' ? left.year : -1;
    const rightYear = typeof right.year === 'number' ? right.year : -1;
    if (leftYear !== rightYear) return (leftYear - rightYear) * factor;
    return left.title.localeCompare(right.title, 'zh-CN') * factor;
  }
  const leftValue = (left[sort.key] || '').toString().trim().toLocaleLowerCase();
  const rightValue = (right[sort.key] || '').toString().trim().toLocaleLowerCase();
  return leftValue.localeCompare(rightValue, 'zh-CN') * factor;
}

function formatPapersAsMarkdown(papers: PaperDocument[]) {
  const lines = ['# Aster Library Export', '', `Count: ${papers.length}`, ''];
  papers.forEach((paper, index) => {
    lines.push(`## ${index + 1}. ${paper.title || zh.importDialog.untitledDocument}`);
    lines.push(`- Authors: ${paper.authors || zh.library.unknownAuthors}`);
    lines.push(`- Year: ${paper.year || '-'}`);
    lines.push(`- Venue: ${paper.venue || zh.library.unknownVenue}`);
    if (paper.doi) lines.push(`- DOI: ${paper.doi}`);
    lines.push(`- Tags: ${paper.tags.length ? paper.tags.join(', ') : FALLBACK_TAG}`);
    lines.push(`- Notes: ${paper.notes.length}`);
    lines.push(`- Annotations: ${paper.annotations.length}`);
    lines.push(`- Translated PDFs: ${paper.translatedPdfs.length}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatPapersAsCsv(papers: PaperDocument[]) {
  const header = ['title', 'authors', 'year', 'venue', 'doi', 'tags', 'notes', 'annotations', 'translated_pdfs'];
  const rows = papers.map((paper) => [
    paper.title,
    paper.authors,
    paper.year || '',
    paper.venue,
    paper.doi,
    paper.tags.join('; '),
    paper.notes.length,
    paper.annotations.length,
    paper.translatedPdfs.length,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function formatPaperAsBibtex(paper: PaperDocument) {
  const key = citationKey(paper);
  const fields = [
    ['title', paper.title || 'Untitled'],
    ['author', bibtexAuthors(paper.authors)],
    ['year', paper.year || ''],
    ['journal', paper.venue || ''],
    ['doi', normalizedDoi(paper.doi)],
  ].filter(([, value]) => String(value).trim());
  const body = fields.map(([name, value]) => `  ${name} = {${escapeBibtex(String(value))}}`).join(',\n');
  return `@article{${key},\n${body}\n}`;
}

function formatPapersAsBibtex(papers: PaperDocument[]) {
  return papers.map(formatPaperAsBibtex).join('\n\n');
}

function formatConfirmPaperList(papers: PaperDocument[]) {
  const visible = papers.slice(0, 5).map((paper) => `- ${paper.title}`);
  const remaining = papers.length - visible.length;
  return remaining > 0 ? [...visible, zh.library.morePapers(remaining)].join('\n') : visible.join('\n');
}

function citationKey(paper: PaperDocument) {
  const firstAuthor = (paper.authors || 'aster')
    .split(/,|;|\band\b|&/i)[0]
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase() || 'aster';
  const year = paper.year || 'nd';
  const titleWord = (paper.title || 'paper')
    .split(/[^a-zA-Z0-9]+/)
    .find((word) => word.length > 3)
    ?.toLowerCase() || 'paper';
  return `${firstAuthor}${year}${titleWord}`;
}

function bibtexAuthors(authors: string) {
  return authors
    .split(/;|,/)
    .map((author) => author.trim())
    .filter(Boolean)
    .join(' and ');
}

function normalizedDoi(doi: string) {
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
}

function escapeBibtex(value: string) {
  return value.replace(/[{}]/g, '').replace(/\\/g, '\\textbackslash{}');
}

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function EmptyScene({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
  return (
    <section className="scene active">
      <div className="library-empty">
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" className="primary import-empty-button rounded-button" onClick={onAction}>
          {action}
        </button>
      </div>
    </section>
  );
}

function SceneIcon({ id }: { id: SceneId }) {
  if (id === 'reader') return <Icon path="M5 6.5c2.2-1.2 4.4-1.2 6.5 0v11c-2.1-1.2-4.3-1.2-6.5 0v-11Zm6.5 0c2.1-1.2 4.3-1.2 6.5 0v11c-2.2-1.2-4.4-1.2-6.5 0v-11Z" />;
  if (id === 'aiChat') return <Icon path="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />;
  return <Icon path="M6 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Zm1 12.5A1.5 1.5 0 0 0 8.5 18H18M8 7h7M8 10h6" />;
}

function SettingsIcon() {
  return <Icon path="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.2 2.3 1.3 1-1.3 1a7.5 7.5 0 0 1-.5 1.2l.4 1.6-1.6.9-1.2-1a7 7 0 0 1-1.2.7l-.2 1.6h-1.8l-.2-1.6a7 7 0 0 1-1.2-.7l-1.2 1-1.6-.9.4-1.6a7.5 7.5 0 0 1-.5-1.2l-1.3-1 1.3-1a7.5 7.5 0 0 1 .5-1.2l-.4-1.6 1.6-.9 1.2 1a7 7 0 0 1 1.2-.7l.2-1.6h1.8l.2 1.6a7 7 0 0 1 1.2.7l1.2-1 1.6.9-.4 1.6c.2.4.4.8.5 1.2Z" />;
}

function CommandIcon() {
  return <Icon path="M5 7h14M5 12h14M5 17h14M8 5v4M16 10v4M11 15v4" />;
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
