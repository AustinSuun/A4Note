import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createAsterCore, createImportDraft } from '../core/asterCore';
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import {
  createLibraryBackup,
  createNativeAnnotation,
  deleteNativeAnnotation,
  deleteNativePaper,
  appendNativeAiMessage,
  clearNativeAiThreads,
  extractPdfMetadata,
  getAppDiagnostics,
  getAsterPaths,
  importPdfToLibrary,
  importTranslatedPdfToLibrary,
  initializeLibrary,
  isTauriRuntime,
  listNativeAiThreads,
  loadNativeDocuments,
  nativeMetadataToImportDraft,
  openPaperFile,
  revealPaperFile,
  revealAsterPath,
  restoreLibraryBackup,
  selectBackupFolder,
  selectPdfFile,
  updateNativeAnnotationColor,
  updateNativeAnnotationComment,
  updateNativeAnnotationPosition,
  updateNativePaperMetadata,
  updateNativePaperTags,
  upsertNativeNote,
  restoreNativeAnnotation,
  type AppDiagnostics,
  type AsterPaths,
  type PaperFileKind,
} from '../core/nativeApi';
import { renderMarkdown } from '../core/markdown';
import { buildPaperRelationView, getObjectNavigationTarget, type AnnotationTrace, type ObjectNavigationTarget } from '../core/relations';
import type {
  AnnotationColor,
  AnnotationDraft,
  AnnotationType,
  ImportDraft,
  KnowledgeObject,
  PaperDocument,
  PositionJson,
  ReaderLayout,
  ReaderSidePanelTab,
  ReaderTool,
  Relation,
  SceneId,
  WorkbenchPanelContribution,
} from '../core/types';
import { getWorkbenchPanelsForScene, isReaderPanelTab, readerPanelTabFromId } from '../core/workbench';
import { baseScenes, seedDocuments } from '../data/seedDocuments';
import { addTag, FALLBACK_TAG, getTagSuggestions, normalizeEditableTags, removeTag } from './tagInput';
import { zh } from './zh';

const PdfReader = lazy(() => import('./PdfReader'));

type ImportState = 'idle' | 'selecting' | 'extracting' | 'ready' | 'importing' | 'error';
type ReaderContentMode = 'pdf' | 'markdown';
type CustomColorState = { value: string };
type LibrarySortKey = 'title' | 'authors' | 'year' | 'venue';
type LibrarySortDirection = 'asc' | 'desc';
type LocalChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
type LocalChatThread = { threadId?: string; messages: LocalChatMessage[]; draft: string; loading?: boolean; error?: string };
type NoteDraftPatch = { append?: string };
type AnnotationHistoryAction =
  | { kind: 'create'; annotation: PaperDocument['annotations'][number] }
  | { kind: 'delete'; annotation: PaperDocument['annotations'][number] }
  | { kind: 'updateComment'; annotationId: string; previous: string; next: string }
  | { kind: 'updateColor'; annotationId: string; previous: string; next: string }
  | { kind: 'updatePosition'; annotationId: string; previous: PositionJson; next: PositionJson };
type ConfirmDialogState = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};
type AppCommandItem = {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};
type ReaderSidePanelDefinition = {
  id: ReaderSidePanelTab;
  panel: WorkbenchPanelContribution;
  commandId: string;
  label: string;
  commandTitle: string;
  icon: () => ReactNode;
};
type InterfaceDensity = 'compact' | 'comfortable';
type MetadataSourcePreference = 'crossrefFirst' | 'arxivFirst' | 'localOnly';
const annotationPresetColors = ['yellow', 'green', 'blue', 'purple'] as const;
type AppSettings = {
  density: InterfaceDensity;
  defaultReaderLayout: ReaderLayout;
  metadataSourcePreference: MetadataSourcePreference;
  onlineMetadataEnabled: boolean;
};
type PersistedUiState = {
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
};

const defaultSettings: AppSettings = {
  density: 'compact',
  defaultReaderLayout: 'focus',
  metadataSourcePreference: 'crossrefFirst',
  onlineMetadataEnabled: true,
};

const aster = createAsterCore(isTauriRuntime() ? [] : seedDocuments, baseScenes);

const layoutPresets: Array<{ id: ReaderLayout; label: string }> = [
  { id: 'focus', label: zh.reader.focusLayout },
  { id: 'note', label: zh.reader.noteLayout },
  { id: 'ai', label: zh.reader.aiLayout },
];

const annotationTools: Array<{ id: ReaderTool; label: string }> = [
  { id: 'cursor', label: zh.reader.cursor },
  { id: 'highlight', label: zh.reader.highlight },
  { id: 'comment', label: zh.reader.comment },
  { id: 'underline', label: zh.reader.underline },
  { id: 'area', label: zh.reader.area },
];

const sceneLabels: Record<SceneId, string> = {
  library: zh.scenes.library,
  reader: zh.scenes.reader,
  aiChat: zh.scenes.ai,
};

const readerSidePanelDefinitions: ReaderSidePanelDefinition[] = [
  ...getWorkbenchPanelsForScene('reader', 'right')
    .map((panel) => {
      const id = readerPanelTabFromId(panel.id);
      return id ? { id, panel, commandId: panel.commandId, label: readerPanelLabel(id), commandTitle: readerPanelCommandTitle(id), icon: readerPanelIcon(panel.icon) } : null;
    })
    .filter((panel): panel is ReaderSidePanelDefinition => Boolean(panel)),
];

function readerPanelLabel(tab: ReaderSidePanelTab) {
  const labels: Record<ReaderSidePanelTab, string> = {
    notes: zh.reader.panelNotes,
    annotations: zh.reader.panelAnnotations,
    chat: zh.reader.panelChat,
    relations: zh.reader.panelRelations,
  };
  return labels[tab];
}

function readerPanelCommandTitle(tab: ReaderSidePanelTab) {
  const labels: Record<ReaderSidePanelTab, string> = {
    notes: zh.command.openNotesPanel,
    annotations: zh.command.openAnnotationsPanel,
    chat: zh.command.openChatPanel,
    relations: zh.command.openRelationsPanel,
  };
  return labels[tab];
}

function readerPanelIcon(icon: WorkbenchPanelContribution['icon']): () => ReactNode {
  const icons: Record<string, () => ReactNode> = {
    notes: NotesIcon,
    annotations: AnnotationsIcon,
    chat: ChatIcon,
    relations: RelationsIcon,
  };
  return icons[icon] ?? NotesIcon;
}

function preferredReaderMode(paper: PaperDocument | null): ReaderContentMode {
  if (!paper) return 'pdf';
  if (paper.sourcePdf || paper.translatedPdfs.length) return 'pdf';
  if (paper.notes.length) return 'markdown';
  return 'pdf';
}

function preferredReaderFile(paper: PaperDocument | null): PaperFileKind {
  if (!paper) return 'source';
  return paper.sourcePdf ? 'source' : paper.translatedPdfs.length ? 'translated' : 'source';
}

function preferredTranslatedFileId(paper: PaperDocument | null, currentFileId = '') {
  if (!paper?.translatedFileIds.length) return '';
  return currentFileId && paper.translatedFileIds.includes(currentFileId) ? currentFileId : paper.translatedFileIds[0];
}

function normalizeImportDraftForConfirm(draft: ImportDraft): ImportDraft {
  const title = draft.title.trim() || titleFromPath(draft.originalPath) || zh.importDialog.untitledDocument;
  const year = typeof draft.year === 'number' && draft.year >= 1000 && draft.year <= 9999 ? draft.year : '';
  return {
    ...draft,
    title,
    authors: draft.authors.trim(),
    year,
    venue: draft.venue.trim(),
    doi: draft.doi.trim(),
    tags: normalizeEditableTags(draft.tags),
  };
}

function titleFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() ?? '';
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function App() {
  const initialDocuments = aster.documents.list();
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const persistedUiState = useMemo(() => loadUiState(), []);
  const [activeScene, setActiveScene] = useState<SceneId>(persistedUiState.activeScene);
  const [selectedPaperId, setSelectedPaperId] = useState(persistedUiState.selectedPaperId || initialDocuments[0]?.paperId || '');
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>(persistedUiState.readerLayout || settings.defaultReaderLayout);
  const [readerContentMode, setReaderContentMode] = useState<ReaderContentMode>(persistedUiState.readerContentMode || preferredReaderMode(initialDocuments[0] ?? null));
  const [readerFileMode, setReaderFileMode] = useState<PaperFileKind>(persistedUiState.readerFileMode || preferredReaderFile(initialDocuments[0] ?? null));
  const [readerTranslatedFileId, setReaderTranslatedFileId] = useState(persistedUiState.readerTranslatedFileId || initialDocuments[0]?.translatedFileIds[0] || '');
  const [query, setQuery] = useState(persistedUiState.query);
  const [activeTag, setActiveTag] = useState(persistedUiState.activeTag);
  const [libraryDetailOpen, setLibraryDetailOpen] = useState(false);
  const [bulkSelectedPaperIds, setBulkSelectedPaperIds] = useState<string[]>([]);
  const [librarySort, setLibrarySort] = useState<{ key: LibrarySortKey; direction: LibrarySortDirection }>(persistedUiState.librarySort);
  const [activeAnnotationTool, setActiveAnnotationTool] = useState<ReaderTool>('cursor');
  const [activeAnnotationColor, setActiveAnnotationColor] = useState<AnnotationColor>('yellow');
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
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationHistoryAction[]>([]);
  const [annotationRedoStack, setAnnotationRedoStack] = useState<AnnotationHistoryAction[]>([]);
  const [chatState, setChatState] = useState<Record<string, LocalChatThread>>({});
  const [revision, setRevision] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metadataEditOpen, setMetadataEditOpen] = useState(false);
  const [tagsEditOpen, setTagsEditOpen] = useState(false);
  const [bulkTagsEditOpen, setBulkTagsEditOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [draft, setDraft] = useState<ImportDraft>(() => createImportDraft(''));
  const [libraryStatus, setLibraryStatus] = useState(isTauriRuntime() ? zh.app.initializing : zh.app.browserPreview);
  const [lastImportedPaperTitle, setLastImportedPaperTitle] = useState('');
  const [asterPaths, setAsterPaths] = useState<AsterPaths | null>(null);
  const [appDiagnostics, setAppDiagnostics] = useState<AppDiagnostics | null>(null);
  const deletingAnnotationIdsRef = useRef(new Set<string>());
  const annotationPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    document.documentElement.dataset.density = settings.density;
    saveAppSettings(settings);
  }, [settings]);

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
    });
  }, [activeAnnotationColor, activeScene, activeTag, librarySort, query, readerContentMode, readerFileMode, readerLayout, readerSidePanelOpen, readerSidePanelTab, readerTranslatedFileId, readerZoom, selectedPaperId]);

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
    setReaderFileMode(preferredReaderFile(nextPaper));
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
    if (readerFileMode === 'translated' && !selectedPaper.translatedPdfs.length) {
      setReaderFileMode(preferredReaderFile(selectedPaper));
    }
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(selectedPaper, current));
  }, [readerContentMode, readerFileMode, selectedPaper?.paperId, selectedPaper?.sourcePdf, selectedPaper?.translatedPdfs.length, selectedPaper?.translatedFileIds.join('|'), selectedPaper?.notes.length]);

  useEffect(() => {
    if (!selectedPaper || !isTauriRuntime()) return;
    let cancelled = false;
    setChatState((current) => ({
      ...current,
      [selectedPaper.paperId]: {
        threadId: current[selectedPaper.paperId]?.threadId,
        messages: current[selectedPaper.paperId]?.messages ?? createDefaultChatMessages(selectedPaper),
        draft: current[selectedPaper.paperId]?.draft ?? '',
        loading: true,
      },
    }));
    listNativeAiThreads(selectedPaper.paperId)
      .then((threads) => {
        if (cancelled) return;
        const latest = threads[0];
        setChatState((current) => ({
          ...current,
          [selectedPaper.paperId]: {
            threadId: latest?.id,
            messages: latest?.messages.length ? latest.messages.map(nativeAiMessageToLocal) : createDefaultChatMessages(selectedPaper),
            draft: current[selectedPaper.paperId]?.draft ?? '',
            loading: false,
          },
        }));
      })
      .catch((error) => {
        console.error('Failed to load AI thread', error);
        if (cancelled) return;
        setChatState((current) => ({
          ...current,
          [selectedPaper.paperId]: {
            threadId: current[selectedPaper.paperId]?.threadId,
            messages: current[selectedPaper.paperId]?.messages ?? createDefaultChatMessages(selectedPaper),
            draft: current[selectedPaper.paperId]?.draft ?? '',
            loading: false,
          },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPaper?.paperId]);

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

  const persistHistoryAction = (action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    if (!isTauriRuntime()) return;
    try {
      if (action.kind === 'create') {
        if (direction === 'undo') void queueAnnotationPersistence(() => deleteNativeAnnotation(action.annotation.id).then(() => undefined));
        else void queueAnnotationPersistence(() => restoreNativeAnnotation(action.annotation).then(() => undefined));
        return;
      }
      if (action.kind === 'delete') {
        if (direction === 'undo') void queueAnnotationPersistence(() => restoreNativeAnnotation(action.annotation).then(() => undefined));
        else void queueAnnotationPersistence(() => deleteNativeAnnotation(action.annotation.id).then(() => undefined));
        return;
      }
      if (action.kind === 'updateComment') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationComment({ annotationId: action.annotationId, comment: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
        return;
      }
      if (action.kind === 'updateColor') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationColor({ annotationId: action.annotationId, color: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
        return;
      }
      if (action.kind === 'updatePosition') {
        void queueAnnotationPersistence(() =>
          updateNativeAnnotationPosition({ annotationId: action.annotationId, positionJson: direction === 'undo' ? action.previous : action.next }).then(() => undefined),
        );
      }
    } catch (error) {
      console.error('Annotation history persistence failed', error);
    }
  };

  const queueAnnotationPersistence = (operation: () => Promise<void>) => {
    const next = annotationPersistenceQueueRef.current.then(operation, operation);
    annotationPersistenceQueueRef.current = next.catch((error) => {
      console.error('Queued annotation persistence failed', error);
    });
    return next;
  };

  const applyAnnotationHistoryAction = (action: AnnotationHistoryAction, direction: 'undo' | 'redo') => {
    if (action.kind === 'create') {
      if (direction === 'undo') removeLocalAnnotation(action.annotation);
      else restoreAnnotation(action.annotation);
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'delete') {
      if (direction === 'undo') restoreAnnotation(action.annotation);
      else removeLocalAnnotation(action.annotation);
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updateComment') {
      updateLocalAnnotation(action.annotationId, { comment: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updateColor') {
      updateLocalAnnotation(action.annotationId, { color: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
      return;
    }
    if (action.kind === 'updatePosition') {
      updateLocalAnnotation(action.annotationId, { positionJson: direction === 'undo' ? action.previous : action.next });
      persistHistoryAction(action, direction);
    }
  };

  const undoAnnotationAction = () => {
    const action = annotationUndoStack[annotationUndoStack.length - 1];
    if (!action) return;
    setAnnotationUndoStack((current) => current.slice(0, -1));
    setAnnotationRedoStack((current) => [...current.slice(-39), action]);
    applyAnnotationHistoryAction(action, 'undo');
  };

  const redoAnnotationAction = () => {
    const action = annotationRedoStack[annotationRedoStack.length - 1];
    if (!action) return;
    setAnnotationRedoStack((current) => current.slice(0, -1));
    setAnnotationUndoStack((current) => [...current.slice(-39), action]);
    applyAnnotationHistoryAction(action, 'redo');
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
      setAnnotationUndoStack([]);
      setAnnotationRedoStack([]);
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
    setReaderFileMode(preferredReaderFile(nextPaper));
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(nextPaper, current));
  };

  const openReaderForPaper = (paperId: string) => {
    setSelectedPaperId(paperId);
    setReaderRequestedPage(null);
    setReaderFocusedAnnotationId(null);
    const paper = aster.documents.get(paperId) ?? documents.find((candidate) => candidate.paperId === paperId) ?? null;
    setReaderContentMode(preferredReaderMode(paper));
    setReaderFileMode(preferredReaderFile(paper));
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

  const openImportDialog = () => {
    setDraft(createImportDraft(''));
    setImportState('idle');
    setImportOpen(true);
  };

  const extractDraftForPath = async (path: string) => {
    if (!path) return;
    if (!isTauriRuntime()) {
      setDraft(createImportDraft(path));
      setImportState('ready');
      return;
    }
    setImportState('extracting');
    try {
      const metadata = await extractPdfMetadata(path);
      setDraft(nativeMetadataToImportDraft(path, metadata));
      setImportState('ready');
    } catch (error) {
      console.error('Metadata extraction failed', error);
      setDraft({ ...createImportDraft(path), extractionWarnings: [zh.importDialog.error] });
      setImportState('error');
    }
  };

  const choosePdfIntoDraft = async () => {
    setImportState('selecting');
    if (!isTauriRuntime()) {
      await extractDraftForPath('retrieval-augmented-generation-2020.pdf');
      return;
    }
    try {
      const selected = await selectPdfFile();
      if (!selected) {
        setImportState(draft.originalPath ? 'ready' : 'idle');
        return;
      }
      await extractDraftForPath(selected);
    } catch (error) {
      console.error('Failed to open PDF dialog', error);
      setDraft((current) => ({
        ...current,
        extractionWarnings: [zh.importDialog.openFailed],
      }));
      setImportState('error');
    }
  };

  const confirmImport = async () => {
    if (!draft.originalPath.trim()) {
      setLibraryStatus(zh.app.chooseFirst);
      setImportState('error');
      return;
    }
    const normalizedDraft = normalizeImportDraftForConfirm(draft);
    setDraft(normalizedDraft);
    setImportState('importing');
    if (isTauriRuntime()) {
      try {
        const imported = await importPdfToLibrary(normalizedDraft);
        const targetPaperId = imported.existing_paper_id || imported.paper_id;
        await refreshNativeDocuments(targetPaperId);
        setActiveTag('all');
        setImportOpen(false);
        setLastImportedPaperTitle(imported.duplicate ? '' : normalizedDraft.title || imported.paper_id);
        setLibraryStatus(imported.duplicate ? zh.app.importDuplicate : zh.app.importSuccess);
        openReaderForPaper(targetPaperId);
        return;
      } catch (error) {
        console.error('PDF import failed', error);
        setLibraryStatus(zh.app.importFailed);
        setDraft((current) => ({
          ...current,
          extractionWarnings: [...(current.extractionWarnings ?? []), zh.importDialog.importFailedInline],
        }));
        setImportState('error');
        return;
      }
    }
    const imported = aster.commands.execute<ImportDraft, PaperDocument>('document.importFromDraft', normalizedDraft);
    setLastImportedPaperTitle(imported.title);
    setSelectedPaperId(imported.paperId);
    setReaderContentMode(preferredReaderMode(imported));
    setReaderFileMode(preferredReaderFile(imported));
    setReaderTranslatedFileId(preferredTranslatedFileId(imported));
    setActiveTag('all');
    setImportOpen(false);
    setRevision((current) => current + 1);
  };

  const importTranslatedPdf = async () => {
    if (!selectedPaper) return;
    try {
      const selected = await selectPdfFile();
      if (!selected) return;
      const imported = await importTranslatedPdfToLibrary({ paperId: selectedPaper.paperId, originalPath: selected, language: 'zh' });
      await refreshNativeDocuments(selectedPaper.paperId);
      setReaderContentMode('pdf');
      setReaderFileMode('translated');
      setReaderTranslatedFileId(imported.file_id);
      setLibraryStatus(zh.library.translationImported);
    } catch (error) {
      console.error('Translated PDF import failed', error);
      setLibraryStatus(zh.library.translationImportFailed);
    }
  };

  const createAnnotation = async (annotation: AnnotationDraft & { page: number }) => {
    if (!selectedPaper) return;
    const fileId = readerFileMode === 'translated' ? preferredTranslatedFileId(selectedPaper, readerTranslatedFileId) : selectedPaper.sourceFileId;
    if (isTauriRuntime() && fileId) {
      try {
        const { page, ...annotationPayload } = annotation;
        const created = await createNativeAnnotation({ paperId: selectedPaper.paperId, fileId, page, ...annotationPayload });
        const localPaper = aster.documents.get(selectedPaper.paperId);
        const nextAnnotation = {
          id: created.id,
          paperId: selectedPaper.paperId,
          fileId,
          page,
          ...annotationPayload,
          createdAt: new Date().toISOString(),
        };
        if (localPaper && !localPaper.annotations.some((item) => item.id === created.id)) {
          localPaper.annotations.push(nextAnnotation);
          localPaper.annotations.sort((left, right) => left.page - right.page || (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
        }
        pushAnnotationHistory({ kind: 'create', annotation: cloneAnnotation(nextAnnotation) });
        setRevision((current) => current + 1);
        return created.id;
      } catch (error) {
        console.error('Annotation create failed', error);
        setLibraryStatus(zh.reader.annotationCreateFailed);
        throw error;
      }
    }
    const created = aster.commands.execute<unknown, { id: string } | null>('document.addAnnotation', { paperId: selectedPaper.paperId, annotation });
    if (created?.id) {
      const localPaper = aster.documents.get(selectedPaper.paperId);
      const createdAnnotation = localPaper?.annotations.find((item) => item.id === created.id);
      if (createdAnnotation) pushAnnotationHistory({ kind: 'create', annotation: cloneAnnotation(createdAnnotation) });
    }
    setRevision((current) => current + 1);
    return created?.id;
  };

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

  const pushAnnotationHistory = (action: AnnotationHistoryAction) => {
    setAnnotationUndoStack((current) => [...current.slice(-39), action]);
    setAnnotationRedoStack([]);
  };

  const restoreAnnotation = (annotation: PaperDocument['annotations'][number]) => {
    const paper = aster.documents.get(annotation.paperId);
    if (!paper || paper.annotations.some((item) => item.id === annotation.id)) return;
    paper.annotations = [...paper.annotations, cloneAnnotation(annotation)].sort((a, b) => a.page - b.page || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    setReaderFocusedAnnotationId(annotation.id);
    setRevision((current) => current + 1);
  };

  const removeLocalAnnotation = (annotation: PaperDocument['annotations'][number]) => {
    const paper = aster.documents.get(annotation.paperId);
    if (!paper) return;
    paper.annotations = paper.annotations.filter((item) => item.id !== annotation.id);
    setReaderFocusedAnnotationId((current) => (current === annotation.id ? null : current));
    setRevision((current) => current + 1);
  };

  const updateLocalAnnotation = (annotationId: string, patch: Partial<PaperDocument['annotations'][number]>) => {
    const paper = selectedPaper ? aster.documents.get(selectedPaper.paperId) : null;
    const annotation = paper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const safePatch = patch.positionJson ? { ...patch, positionJson: clonePositionJson(patch.positionJson) } : patch;
    Object.assign(annotation, safePatch);
    setReaderFocusedAnnotationId(annotationId);
    setRevision((current) => current + 1);
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

  const updateAnnotationComment = async (annotationId: string, comment: string) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousComment = annotation.comment ?? '';
    if (previousComment === comment) return;
    pushAnnotationHistory({ kind: 'updateComment', annotationId, previous: previousComment, next: comment });
    annotation.comment = comment;
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationComment({ annotationId, comment }).then(() => undefined));
        return;
      } catch (error) {
        annotation.comment = previousComment;
        setRevision((current) => current + 1);
        console.error('Annotation comment update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const updateAnnotationColor = async (annotationId: string, color: AnnotationColor) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousColor = annotation.color ?? '';
    if (previousColor === color) return;
    pushAnnotationHistory({ kind: 'updateColor', annotationId, previous: previousColor, next: color });
    annotation.color = color;
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationColor({ annotationId, color }).then(() => undefined));
        return;
      } catch (error) {
        annotation.color = previousColor;
        setRevision((current) => current + 1);
        console.error('Annotation color update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const updateAnnotationPosition = async (annotationId: string, positionJson: PositionJson) => {
    if (!selectedPaper) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const annotation = localPaper?.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    const previousPosition = clonePositionJson(annotation.positionJson);
    const nextPosition = clonePositionJson(positionJson);
    if (JSON.stringify(previousPosition) === JSON.stringify(nextPosition)) return;
    pushAnnotationHistory({ kind: 'updatePosition', annotationId, previous: clonePositionJson(previousPosition), next: clonePositionJson(nextPosition) });
    annotation.positionJson = clonePositionJson(nextPosition);
    setRevision((current) => current + 1);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => updateNativeAnnotationPosition({ annotationId, positionJson: nextPosition }).then(() => undefined));
        return;
      } catch (error) {
        annotation.positionJson = clonePositionJson(previousPosition);
        setRevision((current) => current + 1);
        console.error('Annotation position update failed', error);
        setLibraryStatus(zh.reader.annotationSaveFailed);
        throw error;
      }
    }
  };

  const applyAnnotationColor = (color: AnnotationColor) => {
    setActiveAnnotationColor(color);
    if (color.startsWith('#')) {
      setCustomAnnotationColor({ value: color });
    }
  };

  const deleteAnnotation = async (annotationId: string) => {
    if (!selectedPaper) return;
    if (deletingAnnotationIdsRef.current.has(annotationId)) return;
    const localPaper = aster.documents.get(selectedPaper.paperId);
    const removedAnnotation = localPaper?.annotations.find((annotation) => annotation.id === annotationId) ?? null;
    if (!removedAnnotation) return;
    const removedSnapshot = cloneAnnotation(removedAnnotation);
    deletingAnnotationIdsRef.current.add(annotationId);
    if (isTauriRuntime()) {
      try {
        await queueAnnotationPersistence(() => deleteNativeAnnotation(annotationId).then(() => undefined));
      } catch (error) {
        console.error('Annotation delete failed', error);
        setLibraryStatus(zh.reader.annotationDeleteFailed);
        deletingAnnotationIdsRef.current.delete(annotationId);
        throw error;
      }
    }
    pushAnnotationHistory({ kind: 'delete', annotation: removedSnapshot });
    if (localPaper) {
      localPaper.annotations = localPaper.annotations.filter((annotation) => annotation.id !== annotationId);
      setReaderFocusedAnnotationId((current) => (current === annotationId ? null : current));
      setRevision((current) => current + 1);
    }
    deletingAnnotationIdsRef.current.delete(annotationId);
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
          k: 'comment',
          b: 'area',
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
        title: selectedPaper.notes[0]?.title ?? '阅读笔记',
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
    const quote = annotation.quote && annotation.quote !== annotationLabelText(annotation.type) ? `\n> ${annotation.quote}` : '';
    const comment = annotation.comment ? `\n- 备注：${annotation.comment}` : '';
    setNoteDraftPatch({
      append: `\n\n## 第 ${annotation.page} 页 · ${annotationLabelText(annotation.type)}${quote}${comment}\n`,
    });
    setReaderSidePanelOpen(true);
    setReaderSidePanelTab('notes');
  };

  const selectedChatState = selectedPaper ? chatState[selectedPaper.paperId] : undefined;
  const chatMessages = selectedChatState?.messages ?? createDefaultChatMessages(selectedPaper);
  const chatDraft = selectedChatState?.draft ?? '';
  const chatError = selectedChatState?.error ?? '';

  const updateChatDraft = (paperId: string, draft: string) => {
    setChatState((current) => ({
      ...current,
      [paperId]: {
        messages: current[paperId]?.messages ?? createDefaultChatMessages(aster.documents.get(paperId)),
        draft,
        error: '',
      },
    }));
  };

  const sendChatMessage = async (paperId: string) => {
    const paper = aster.documents.get(paperId);
    const currentThread = chatState[paperId];
    const draft = (currentThread?.draft ?? '').trim();
    if (!paper || !draft) return;
    const assistantReply = buildLocalAssistantReply(paper, draft);
    const nextMessages = [
      ...(currentThread?.messages ?? createDefaultChatMessages(paper)),
      { id: `user-${Date.now()}`, role: 'user' as const, content: draft },
      { id: `assistant-${Date.now() + 1}`, role: 'assistant' as const, content: assistantReply },
    ];
    setChatState((current) => ({
      ...current,
      [paperId]: {
        threadId: currentThread?.threadId,
        messages: nextMessages,
        draft: '',
        error: '',
      },
    }));
    if (isTauriRuntime()) {
      try {
        const userSaved = await appendNativeAiMessage({ paperId, threadId: currentThread?.threadId, role: 'user', content: draft });
        const assistantSaved = await appendNativeAiMessage({ paperId, threadId: userSaved.thread_id, role: 'assistant', content: assistantReply });
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: assistantSaved.thread_id,
            messages: nextMessages,
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: '',
          },
        }));
        await refreshNativeDocuments(paperId);
      } catch (error) {
        console.error('Failed to persist AI messages', error);
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: current[paperId]?.threadId,
            messages: current[paperId]?.messages ?? nextMessages,
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: zh.ai.saveFailed,
          },
        }));
      }
    }
  };

  const resetChatThread = async (paperId: string) => {
    const paper = aster.documents.get(paperId);
    if (!paper) return;
    if (isTauriRuntime()) {
      try {
        await clearNativeAiThreads(paperId);
        await refreshNativeDocuments(paperId);
      } catch (error) {
        console.error('Failed to clear AI thread', error);
        setChatState((current) => ({
          ...current,
          [paperId]: {
            threadId: current[paperId]?.threadId,
            messages: current[paperId]?.messages ?? createDefaultChatMessages(paper),
            draft: current[paperId]?.draft ?? '',
            loading: false,
            error: zh.ai.resetFailed,
          },
        }));
        throw error;
      }
    }
    setChatState((current) => ({
      ...current,
      [paperId]: {
        threadId: undefined,
        messages: createDefaultChatMessages(paper),
        draft: '',
        error: '',
      },
    }));
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

  const appCommands = useMemo<AppCommandItem[]>(
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
      ...readerSidePanelDefinitions.map<AppCommandItem>((panel) => ({
        id: panel.commandId,
        title: panel.commandTitle,
        group: zh.command.groupReader,
        disabled: !selectedPaper,
        run: () => {
          if (selectedPaper) openReaderPanel(selectedPaper.paperId, panel.id);
        },
      })),
    ],
    [selectedPaper?.paperId],
  );

  return (
    <div className="app-shell">
      <nav className="scene-rail" aria-label="科研场景">
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
              bulkSelectedPaperIds={bulkSelectedPaperIds}
              searchInputRef={librarySearchRef}
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
                activeAnnotationTool={activeAnnotationTool}
                zoom={readerZoom}
                requestedPage={readerRequestedPage}
                sidePanelOpen={readerSidePanelOpen}
                sidePanelTab={readerSidePanelTab}
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
                onFileModeChange={setReaderFileMode}
                onTranslatedFileIdChange={setReaderTranslatedFileId}
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
                onSelectPaper={setSelectedPaperId}
                onDraftChange={(draft) => updateChatDraft(selectedPaper.paperId, draft)}
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
              paths={asterPaths}
              diagnostics={appDiagnostics}
              onChange={setSettings}
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
      {commandPaletteOpen && <CommandPalette commands={appCommands} query={commandPaletteQuery} onQueryChange={setCommandPaletteQuery} onClose={closeCommandPalette} />}
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </div>
  );
}

function CommandPalette({
  commands,
  query,
  onQueryChange,
  onClose,
}: {
  commands: AppCommandItem[];
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = useMemo(() => {
    if (!normalizedQuery) return commands;
    return commands.filter((command) => [command.title, command.group, command.shortcut ?? ''].join(' ').toLowerCase().includes(normalizedQuery));
  }, [commands, normalizedQuery]);
  const activeCommand = filteredCommands[activeIndex] ?? filteredCommands[0] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  const runCommand = (command: AppCommandItem | null) => {
    if (!command || command.disabled) return;
    command.run();
    onClose();
  };

  return (
    <div className="modal-backdrop command-backdrop" onMouseDown={onClose}>
      <section className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-input-row">
          <CommandIcon />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(filteredCommands.length - 1, 0)));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                runCommand(activeCommand);
              }
            }}
            placeholder={zh.command.placeholder}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-list" role="listbox" aria-label={zh.command.title}>
          {filteredCommands.length ? (
            filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === activeIndex ? 'command-item active' : 'command-item'}
                disabled={command.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span>
                  <strong>{command.title}</strong>
                  <em>{command.group}</em>
                </span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </button>
            ))
          ) : (
            <div className="command-empty">{zh.command.empty}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function LibraryScene({
  papers,
  selectedPaper,
  tags,
  activeTag,
  query,
  sort,
  status,
  lastImportedPaperTitle,
  detailOpen,
  bulkSelectedPaperIds,
  searchInputRef,
  onQueryChange,
  onSelectPaper,
  onBulkSelectionChange,
  onOpenPaper,
  onSelectTag,
  onSortChange,
  onDetailOpenChange,
  onOpenImport,
  onOpenReader,
  onOpenRelations,
  onOpenTranslationImport,
  onRevealSourcePdf,
  onRevealTranslatedPdf,
  onOpenSourcePdfExternal,
  onOpenTranslatedPdfExternal,
  onOpenMetadataEdit,
  onOpenTagsEdit,
  onOpenBulkTagsEdit,
  onBulkDelete,
  onDeletePaper,
  onCopyMarkdown,
  onCopyCsv,
  onCopyBibtex,
  onCopyBulkBibtex,
}: {
  papers: PaperDocument[];
  selectedPaper: PaperDocument | null;
  tags: string[];
  activeTag: string;
  query: string;
  sort: { key: LibrarySortKey; direction: LibrarySortDirection };
  status: string;
  lastImportedPaperTitle: string;
  detailOpen: boolean;
  bulkSelectedPaperIds: string[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onSelectPaper: (paperId: string) => void;
  onBulkSelectionChange: (paperIds: string[]) => void;
  onOpenPaper: (paperId: string) => void;
  onSelectTag: (tag: string) => void;
  onSortChange: (sort: { key: LibrarySortKey; direction: LibrarySortDirection }) => void;
  onDetailOpenChange: (open: boolean) => void;
  onOpenImport: () => void;
  onOpenReader: () => void;
  onOpenRelations: () => void;
  onOpenTranslationImport: () => void;
  onRevealSourcePdf: () => void;
  onRevealTranslatedPdf: () => void;
  onOpenSourcePdfExternal: () => void;
  onOpenTranslatedPdfExternal: () => void;
  onOpenMetadataEdit: () => void;
  onOpenTagsEdit: () => void;
  onOpenBulkTagsEdit: () => void;
  onBulkDelete: () => void;
  onDeletePaper: () => void;
  onCopyMarkdown: () => void;
  onCopyCsv: () => void;
  onCopyBibtex: () => void;
  onCopyBulkBibtex: () => void;
}) {
  const selectedIndex = selectedPaper ? papers.findIndex((paper) => paper.paperId === selectedPaper.paperId) : -1;
  const selectedSet = useMemo(() => new Set(bulkSelectedPaperIds), [bulkSelectedPaperIds]);
  const allVisibleSelected = papers.length > 0 && papers.every((paper) => selectedSet.has(paper.paperId));

  const toggleSort = (key: LibrarySortKey) => {
    if (sort.key === key) {
      onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
      return;
    }
    onSortChange({ key, direction: key === 'year' ? 'desc' : 'asc' });
  };

  const handleTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!papers.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, papers.length - 1);
      onSelectPaper(papers[nextIndex].paperId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
      onSelectPaper(papers[nextIndex].paperId);
      return;
    }
    if (event.key === 'Enter' && selectedPaper) {
      event.preventDefault();
      onOpenPaper(selectedPaper.paperId);
    }
  };

  const toggleBulkPaper = (paperId: string) => {
    onBulkSelectionChange(selectedSet.has(paperId) ? bulkSelectedPaperIds.filter((id) => id !== paperId) : [...bulkSelectedPaperIds, paperId]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onBulkSelectionChange(bulkSelectedPaperIds.filter((paperId) => !papers.some((paper) => paper.paperId === paperId)));
      return;
    }
    onBulkSelectionChange(Array.from(new Set([...bulkSelectedPaperIds, ...papers.map((paper) => paper.paperId)])));
  };

  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.library.title}</h1>
          <p className="scene-description">{zh.library.subtitle}</p>
          <p className="library-status">{status}</p>
          <p className="library-status">{zh.library.shortcutsHint}</p>
          {lastImportedPaperTitle ? <p className="import-next-step">最近导入：{lastImportedPaperTitle}，已自动进入阅读场景。</p> : null}
        </div>
        <button type="button" className="primary import-primary rounded-button" onClick={onOpenImport}>
          {zh.library.importPdf}
        </button>
      </header>
      <div className="library-layout">
        <section className="library-main">
          <div className="search-strip">
            <input ref={searchInputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={zh.library.search} />
          </div>
          <div className="library-actions">
            <span>{selectedPaper ? `${zh.library.selected(selectedPaper.title)} · ${selectedIndex + 1}/${papers.length}` : zh.library.noSelection}</span>
            <div>
              <button type="button" onClick={onOpenReader} disabled={!selectedPaper}>
                {zh.library.openReader}
              </button>
              <button type="button" onClick={() => onDetailOpenChange(!detailOpen)} disabled={!selectedPaper}>
                {detailOpen ? zh.library.hideDetails : zh.library.details}
              </button>
              <button type="button" onClick={onOpenRelations} disabled={!selectedPaper}>
                {zh.library.viewRelations}
              </button>
              <button type="button" onClick={onOpenTranslationImport} disabled={!selectedPaper}>
                {zh.library.importTranslationPdf}
              </button>
              <button type="button" onClick={onOpenMetadataEdit} disabled={!selectedPaper}>
                {zh.library.edit}
              </button>
              <button type="button" onClick={onOpenTagsEdit} disabled={!selectedPaper}>
                {zh.library.tagsEdit}
              </button>
              <button type="button" onClick={onCopyBibtex} disabled={!selectedPaper}>
                {zh.library.copyBibtex}
              </button>
              <button type="button" onClick={onCopyMarkdown} disabled={!papers.length}>
                {zh.library.copyMarkdown}
              </button>
              <button type="button" onClick={onCopyCsv} disabled={!papers.length}>
                {zh.library.copyCsv}
              </button>
              <button type="button" className="danger" onClick={onDeletePaper} disabled={!selectedPaper}>
                {zh.library.delete}
              </button>
            </div>
          </div>
          <p className="table-hint">{zh.library.openHint}</p>
          {bulkSelectedPaperIds.length > 0 && (
            <div className="bulk-actions">
              <span>{zh.library.bulkSelected(bulkSelectedPaperIds.length)}</span>
              <div>
                <button type="button" onClick={onOpenBulkTagsEdit}>
                  {zh.library.bulkEditTags}
                </button>
                <button type="button" onClick={onCopyBulkBibtex}>
                  {zh.library.copyBibtex}
                </button>
                <button type="button" className="danger" onClick={onBulkDelete}>
                  {zh.library.bulkDelete}
                </button>
                <button type="button" onClick={() => onBulkSelectionChange([])}>
                  {zh.library.clearSelection}
                </button>
              </div>
            </div>
          )}
          {papers.length ? (
            <div className="paper-table-wrap" tabIndex={0} onKeyDown={handleTableKeyDown}>
              <table className="paper-table">
                <thead>
                  <tr>
                    <th className="select-col">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={zh.library.selectAll} />
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('title')}>
                        {zh.library.tableTitle}
                        <SortIndicator active={sort.key === 'title'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('authors')}>
                        {zh.library.tableAuthors}
                        <SortIndicator active={sort.key === 'authors'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('year')}>
                        {zh.library.tableYear}
                        <SortIndicator active={sort.key === 'year'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('venue')}>
                        {zh.library.tableVenue}
                        <SortIndicator active={sort.key === 'venue'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>{zh.library.tableTags}</th>
                  </tr>
                </thead>
                <tbody>
                  {papers.map((paper) => (
                    <tr
                      key={paper.paperId}
                      className={paper.paperId === selectedPaper?.paperId ? 'selected' : ''}
                      onClick={() => onSelectPaper(paper.paperId)}
                      onDoubleClick={() => onOpenPaper(paper.paperId)}
                    >
                      <td className="select-col" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedSet.has(paper.paperId)} onChange={() => toggleBulkPaper(paper.paperId)} aria-label={zh.library.selectPaper(paper.title)} />
                      </td>
                      <td className="title-cell">{paper.title}</td>
                      <td>{paper.authors || zh.library.unknownAuthors}</td>
                      <td>{paper.year || '-'}</td>
                      <td>{paper.venue || zh.library.unknownVenue}</td>
                      <td>
                        <div className="tag-row compact-tags">
                          {paper.tags.slice(0, 3).map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LibraryEmptyState hasQuery={Boolean(query || activeTag !== 'all')} onOpenImport={onOpenImport} />
          )}
        </section>
        {detailOpen && selectedPaper ? (
          <LibraryDetailPanel
            paper={selectedPaper}
            onClose={() => onDetailOpenChange(false)}
            onOpenReader={onOpenReader}
            onOpenRelations={onOpenRelations}
            onOpenTranslationImport={onOpenTranslationImport}
            onRevealSourcePdf={onRevealSourcePdf}
            onRevealTranslatedPdf={onRevealTranslatedPdf}
            onOpenSourcePdfExternal={onOpenSourcePdfExternal}
            onOpenTranslatedPdfExternal={onOpenTranslatedPdfExternal}
            onOpenMetadataEdit={onOpenMetadataEdit}
            onOpenTagsEdit={onOpenTagsEdit}
            onCopyBibtex={onCopyBibtex}
          />
        ) : (
          <aside className="soft-panel tag-panel">
            <div className="panel-title">{zh.library.tags}</div>
            <div className="tag-wall">
              <button className={activeTag === 'all' ? 'active' : ''} type="button" onClick={() => onSelectTag('all')}>
                {zh.library.all}
              </button>
              {tags.map((tag) => (
                <button key={tag} className={activeTag === tag ? 'active' : ''} type="button" onClick={() => onSelectTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function LibraryDetailPanel({
  paper,
  onClose,
  onOpenReader,
  onOpenRelations,
  onOpenTranslationImport,
  onRevealSourcePdf,
  onRevealTranslatedPdf,
  onOpenSourcePdfExternal,
  onOpenTranslatedPdfExternal,
  onOpenMetadataEdit,
  onOpenTagsEdit,
  onCopyBibtex,
}: {
  paper: PaperDocument;
  onClose: () => void;
  onOpenReader: () => void;
  onOpenRelations: () => void;
  onOpenTranslationImport: () => void;
  onRevealSourcePdf: () => void;
  onRevealTranslatedPdf: () => void;
  onOpenSourcePdfExternal: () => void;
  onOpenTranslatedPdfExternal: () => void;
  onOpenMetadataEdit: () => void;
  onOpenTagsEdit: () => void;
  onCopyBibtex: () => void;
}) {
  const relationView = useMemo(() => buildPaperRelationView(paper), [paper]);
  return (
    <aside className="soft-panel library-detail-panel">
      <div className="detail-panel-header">
        <div className="panel-title">{zh.library.details}</div>
        <button type="button" className="drawer-close" onClick={onClose} title={zh.reader.closePanel}>
          ×
        </button>
      </div>
      <h2>{paper.title}</h2>
      <div className="detail-muted">{paper.authors || zh.library.unknownAuthors}</div>
      <div className="detail-meta-grid">
        <DetailItem label={zh.library.tableYear} value={paper.year || '-'} />
        <DetailItem label={zh.library.tableVenue} value={paper.venue || zh.library.unknownVenue} />
        <DetailItem label={zh.editDialog.doi} value={paper.doi || '-'} />
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.files}</div>
        <div className="binding-row">
          <span>{zh.reader.sourcePdf}</span>
          <strong>{paper.sourcePdf ? zh.library.bound : zh.library.unbound}</strong>
          <button type="button" onClick={onRevealSourcePdf} disabled={!paper.sourcePdf}>
            {zh.library.revealFile}
          </button>
          <button type="button" onClick={onOpenSourcePdfExternal} disabled={!paper.sourcePdf}>
            {zh.library.openExternal}
          </button>
        </div>
        <div className="binding-row">
          <span>{zh.reader.translatedPdf}</span>
          <strong>{paper.translatedPdfs.length ? zh.library.translationCount(paper.translatedPdfs.length) : zh.library.unbound}</strong>
          <button type="button" onClick={onRevealTranslatedPdf} disabled={!paper.translatedPdfs.length}>
            {zh.library.revealFile}
          </button>
          <button type="button" onClick={onOpenTranslatedPdfExternal} disabled={!paper.translatedPdfs.length}>
            {zh.library.openExternal}
          </button>
        </div>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.bindings}</div>
        <div className="binding-stats">
          <span>{zh.library.noteCount(paper.notes.length)}</span>
          <span>{zh.library.annotationCount(paper.annotations.length)}</span>
          <span>{zh.library.aiThreadCount(paper.aiThreads.length)}</span>
        </div>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.relations}</div>
        <div className="binding-stats">
          <span>{zh.library.objectCount(relationView.graph.objects.length)}</span>
          <span>{zh.library.relationCount(relationView.graph.relations.length)}</span>
          <span>{zh.library.fileObjectCount(relationView.files.length)}</span>
        </div>
        <RelationSection title={zh.library.relationPreview}>
          {relationView.previewRelations.length ? (
            relationView.previewRelations.map(({ relation, source, target, annotationTrace }) => (
              <RelationRow
                key={relation.id}
                label={relationTypeLabel(relation.type)}
                value={formatRelationEndpoints(source, target, relation)}
                meta={formatRelationMeta(relation, annotationTrace)}
              />
            ))
          ) : (
            <div className="mini-message">{zh.library.relationPreviewEmpty}</div>
          )}
          {relationView.previewMoreCount > 0 ? <div className="detail-muted">{zh.library.relationMore(relationView.previewMoreCount)}</div> : null}
        </RelationSection>
      </div>
      <div className="detail-section">
        <div className="panel-title">{zh.library.tags}</div>
        <div className="tag-row detail-tags">
          {paper.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="detail-actions">
        <button type="button" className="primary rounded-button" onClick={onOpenReader}>
          {zh.library.openReader}
        </button>
        <button type="button" onClick={onOpenRelations}>
          {zh.library.viewRelations}
        </button>
        <button type="button" onClick={onOpenTranslationImport}>
          {zh.library.importTranslationPdf}
        </button>
        <button type="button" onClick={onOpenMetadataEdit}>
          {zh.library.edit}
        </button>
        <button type="button" onClick={onOpenTagsEdit}>
          {zh.library.tagsEdit}
        </button>
        <button type="button" onClick={onCopyBibtex}>
          {zh.library.copyBibtex}
        </button>
      </div>
    </aside>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function relationTypeLabel(type: Relation['type']) {
  switch (type) {
    case 'attached_file':
      return '绑定文件';
    case 'has_note':
      return '绑定笔记';
    case 'annotates':
      return '标注文件';
    case 'excerpted_from':
      return '摘录来源';
    case 'discusses':
      return 'AI 讨论';
    case 'derived_from':
      return '来源关系';
    case 'contains':
      return '包含';
    case 'cites':
      return '引用';
    case 'links_to':
      return '链接';
    case 'related_to':
      return '相关';
    case 'generated_from':
      return '生成来源';
    case 'version_of':
      return '版本';
    case 'tagged_with':
      return '标签';
    default:
      return type;
  }
}

function formatRelationEndpoints(source: KnowledgeObject | null, target: KnowledgeObject | null, relation: Relation) {
  return `${source?.title ?? relation.sourceObjectId} -> ${target?.title ?? relation.targetObjectId}`;
}

function formatRelationMeta(relation: Relation, annotationTrace: AnnotationTrace | null = null) {
  const meta: string[] = [];
  if (typeof relation.metadata.fileKind === 'string') {
    meta.push(relation.metadata.fileKind === 'translated' ? zh.reader.translatedPdf : zh.reader.sourcePdf);
  }
  const page = annotationTrace?.page ?? relation.metadata.page;
  if (typeof page === 'number') {
    meta.push(zh.reader.annotationPage(page));
  }
  if (typeof relation.metadata.annotationType === 'string') {
    meta.push(annotationLabelText(relation.metadata.annotationType as AnnotationType));
  }
  if (annotationTrace?.noteLinks.length) {
    meta.push(zh.library.noteCount(annotationTrace.noteLinks.length));
  }
  return meta.join(' · ');
}

function SortIndicator({ active, direction }: { active: boolean; direction: LibrarySortDirection }) {
  return <span className={active ? 'sort-indicator active' : 'sort-indicator'}>{direction === 'asc' ? '↑' : '↓'}</span>;
}

function LibraryEmptyState({ hasQuery, onOpenImport }: { hasQuery: boolean; onOpenImport: () => void }) {
  return (
    <div className="library-empty">
      <h2>{hasQuery ? zh.library.noMatchTitle : zh.library.emptyTitle}</h2>
      <p>{hasQuery ? zh.library.noMatchDescription : zh.library.emptyDescription}</p>
      {!hasQuery && (
        <button type="button" className="primary import-empty-button rounded-button" onClick={onOpenImport}>
          {zh.library.importPdf}
        </button>
      )}
    </div>
  );
}

function ReaderScene({
  paper,
  layout,
  contentMode,
  fileMode,
  translatedFileId,
  activeAnnotationTool,
  activeAnnotationColor,
  zoom,
  requestedPage,
  sidePanelOpen,
  sidePanelTab,
  onLayoutChange,
  onContentModeChange,
  onFileModeChange,
  onTranslatedFileIdChange,
  onSelectAnnotationTool,
  onSelectAnnotationColor,
  customAnnotationColor,
  onCustomAnnotationColorChange,
  onZoomChange,
  onFitWidth,
  onSidePanelOpenChange,
  onSidePanelTabChange,
  onCreateAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  readerPageState,
  focusedAnnotationId,
  onReaderStateChange,
  onFocusAnnotation,
  onJumpToPage,
  onNoteSave,
  onCreateNote,
  noteDraftPatch,
  onNoteDraftPatchConsumed,
  onAppendAnnotationToNote,
}: {
  paper: PaperDocument;
  layout: ReaderLayout;
  contentMode: ReaderContentMode;
  fileMode: PaperFileKind;
  translatedFileId: string;
  activeAnnotationTool: ReaderTool;
  zoom: number;
  requestedPage: number | null;
  sidePanelOpen: boolean;
  sidePanelTab: ReaderSidePanelTab;
  onLayoutChange: (layout: ReaderLayout) => void;
  onContentModeChange: (mode: ReaderContentMode) => void;
  onFileModeChange: (mode: PaperFileKind) => void;
  onTranslatedFileIdChange: (fileId: string) => void;
  onSelectAnnotationTool: (type: ReaderTool) => void;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  customAnnotationColor: string;
  onCustomAnnotationColorChange: (color: string) => void;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
  onFitWidth: () => void;
  onSidePanelOpenChange: (open: boolean) => void;
  onSidePanelTabChange: (tab: ReaderSidePanelTab) => void;
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  readerPageState: { currentPage: number; totalPages: number };
  focusedAnnotationId: string | null;
  activeAnnotationColor: AnnotationColor;
  onReaderStateChange: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation: (annotationId: string | null) => void;
  onJumpToPage: (page: number) => void;
  onNoteSave: (content: string) => void | Promise<void>;
  onCreateNote: () => void | Promise<void>;
  noteDraftPatch: NoteDraftPatch | null;
  onNoteDraftPatchConsumed: () => void;
  onAppendAnnotationToNote: (annotationId: string) => void;
}) {
  const canShowPdf = Boolean(paper.sourcePdf || paper.translatedPdfs.length);
  const canShowMarkdown = Boolean(paper.notes.length);
  const hasTranslatedPdf = Boolean(paper.translatedPdfs.length);
  const currentTranslatedFileId = preferredTranslatedFileId(paper, translatedFileId);
  const [pageInput, setPageInput] = useState(String(readerPageState.currentPage));

  const navigateRelationTarget = (target: ObjectNavigationTarget | null) => {
    if (!target) return;
    if (target.kind === 'pdf_file') {
      onContentModeChange('pdf');
      if (target.fileKind === 'translated') {
        onTranslatedFileIdChange(target.fileId);
      }
      onFileModeChange(target.fileKind);
      return;
    }
    if (target.kind === 'note') {
      onContentModeChange('markdown');
      onSidePanelTabChange('notes');
      return;
    }
    if (target.kind === 'annotation') {
      onContentModeChange('pdf');
      if (paper.translatedFileIds.includes(target.fileId)) {
        onTranslatedFileIdChange(target.fileId);
        onFileModeChange('translated');
      } else {
        onFileModeChange('source');
      }
      if (target.page) onJumpToPage(target.page);
      onFocusAnnotation(target.annotationId);
      onSidePanelTabChange('annotations');
      return;
    }
    if (target.kind === 'ai_thread') {
      onSidePanelTabChange('chat');
    }
  };

  useEffect(() => {
    setPageInput(String(readerPageState.currentPage));
  }, [readerPageState.currentPage, paper.paperId]);

  return (
    <section className="scene active">
      <header className="reader-toolbar">
        <div className="reader-title-block">
          <h1>{zh.reader.title}</h1>
        </div>
        <div className="reader-header-tools">
          <div className="reader-header-row">
            <div className="segmented compact">
              <button className={contentMode === 'pdf' ? 'active' : ''} type="button" onClick={() => onContentModeChange('pdf')} disabled={!canShowPdf}>
                {zh.reader.pdfMode}
              </button>
              <button className={contentMode === 'markdown' ? 'active' : ''} type="button" onClick={() => onContentModeChange('markdown')} disabled={!canShowMarkdown}>
                {zh.reader.markdownMode}
              </button>
            </div>
            {contentMode === 'pdf' && (
              <div className="segmented compact">
                <button className={fileMode === 'source' ? 'active' : ''} type="button" onClick={() => onFileModeChange('source')} disabled={!paper.sourcePdf}>
                  {zh.reader.sourcePdf}
                </button>
                <button className={fileMode === 'translated' ? 'active' : ''} type="button" onClick={() => onFileModeChange('translated')} disabled={!hasTranslatedPdf}>
                  {zh.reader.translatedPdf}
                </button>
              </div>
            )}
            {contentMode === 'pdf' && fileMode === 'translated' && paper.translatedFileIds.length > 1 && (
              <select
                className="translated-file-select"
                value={currentTranslatedFileId}
                onChange={(event) => {
                  onTranslatedFileIdChange(event.target.value);
                  onFileModeChange('translated');
                }}
                title={zh.reader.translatedFileSelect}
              >
                {paper.translatedFileIds.map((fileId, index) => (
                  <option key={fileId} value={fileId}>
                    {zh.reader.translatedFileOption(index + 1)}
                  </option>
                ))}
              </select>
            )}
            {contentMode === 'pdf' && (
              <div className="annotation-tools compact-toolbar">
                {annotationTools.map((tool) => (
                  <button key={tool.id} className={activeAnnotationTool === tool.id ? 'active' : ''} type="button" onClick={() => onSelectAnnotationTool(tool.id)} title={tool.label}>
                    <AnnotationToolIcon id={tool.id} />
                  </button>
                ))}
                <div className="annotation-color-switch" title="颜色">
                  {annotationPresetColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={activeAnnotationColor === color ? `active ${color}` : color}
                      onClick={() => onSelectAnnotationColor(color)}
                      aria-label={color}
                    />
                  ))}
                  <label className="annotation-color-custom" title="自定义颜色">
                    <input
                      type="color"
                      value={activeAnnotationColor.startsWith('#') ? activeAnnotationColor : customAnnotationColor}
                      onChange={(event) => {
                        const value = event.target.value;
                        onCustomAnnotationColorChange(value);
                        onSelectAnnotationColor(value as AnnotationColor);
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="segmented compact">
              {layoutPresets.map((preset) => (
                <button key={preset.id} className={layout === preset.id ? 'active' : ''} type="button" onClick={() => onLayoutChange(preset.id)}>
                  {preset.label}
                </button>
              ))}
            </div>
            {contentMode === 'pdf' && (
              <div className="segmented compact zoom-controls">
                <button type="button" onClick={() => onZoomChange(Math.max(0.7, Number((zoom - 0.1).toFixed(2))))} title={zh.reader.zoomOut}>
                  <ZoomOutIcon />
                </button>
                <span className="zoom-value">{Math.round(zoom * 100)}%</span>
                <button type="button" className="page-jump-button" onClick={() => onZoomChange(1)} title={zh.reader.fitWidth}>
                  100%
                </button>
                <div className="page-jump-shell" title={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}>
                  <input
                    value={pageInput}
                    onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      const nextPage = Math.max(1, Math.min(readerPageState.totalPages, Number(pageInput) || readerPageState.currentPage));
                      setPageInput(String(nextPage));
                      onJumpToPage(nextPage);
                    }}
                  />
                  <span>/ {readerPageState.totalPages}</span>
                </div>
                <button type="button" onClick={onFitWidth} title={zh.reader.fitWidth}>
                  <FitWidthIcon />
                </button>
                <button type="button" onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))} title={zh.reader.zoomIn}>
                  <ZoomInIcon />
                </button>
              </div>
            )}
            <div className="segmented compact panel-controls">
              {readerSidePanelDefinitions.map((panel) => {
                const PanelIcon = panel.icon;
                return (
                  <button
                    key={panel.id}
                    className={sidePanelOpen && sidePanelTab === panel.id ? 'active' : ''}
                    type="button"
                    onClick={() => onSidePanelTabChange(panel.id)}
                    title={panel.label}
                  >
                    <PanelIcon />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>
      <div className={sidePanelOpen ? 'reader-layout drawer-open' : 'reader-layout'}>
        <article className="pdf-canvas">
          {contentMode === 'pdf' ? (
            <Suspense fallback={<div className="reader-loading">正在加载阅读器...</div>}>
              <PdfReader
                paper={paper}
                fileKind={fileMode}
                fileId={fileMode === 'translated' ? currentTranslatedFileId : paper.sourceFileId}
                activeTool={activeAnnotationTool}
                zoom={zoom}
                activeAnnotationColor={activeAnnotationColor}
                onZoomChange={onZoomChange}
                requestedPage={requestedPage}
                onCreateAnnotation={onCreateAnnotation}
                onUpdateAnnotationComment={onUpdateAnnotationComment}
                onUpdateAnnotationPosition={onUpdateAnnotationPosition}
                onUpdateAnnotationColor={onUpdateAnnotationColor}
                onDeleteAnnotation={onDeleteAnnotation}
                onAppendAnnotationToNote={onAppendAnnotationToNote}
                onReaderStateChange={onReaderStateChange}
                onFocusAnnotation={onFocusAnnotation}
                focusedAnnotationId={focusedAnnotationId}
              />
            </Suspense>
          ) : canShowMarkdown ? (
            <MarkdownReadView paper={paper} />
          ) : (
            <MarkdownEmptyState onCreateNote={onCreateNote} />
          )}
        </article>
        {sidePanelOpen && (
          <WorkspacePanelHost
            panels={readerSidePanelDefinitions}
            activePanelId={sidePanelTab}
            className="reader-side-drawer"
            closeTitle={zh.reader.closePanel}
            onActivePanelChange={onSidePanelTabChange}
            onClose={() => onSidePanelOpenChange(false)}
            renderPanel={(tab) => (
              <ReaderSidePanelContent
                tab={tab}
                paper={paper}
                fileMode={fileMode}
                translatedFileId={currentTranslatedFileId}
                focusedAnnotationId={focusedAnnotationId}
                noteDraftPatch={noteDraftPatch}
                onNoteDraftPatchConsumed={onNoteDraftPatchConsumed}
                onNoteSave={onNoteSave}
                onFocusAnnotation={onFocusAnnotation}
                onUpdateAnnotationComment={onUpdateAnnotationComment}
                onUpdateAnnotationPosition={onUpdateAnnotationPosition}
                onUpdateAnnotationColor={onUpdateAnnotationColor}
                onDeleteAnnotation={onDeleteAnnotation}
                onAppendAnnotationToNote={onAppendAnnotationToNote}
                onNavigateRelationTarget={navigateRelationTarget}
              />
            )}
          />
        )}
      </div>
    </section>
  );
}

function WorkspacePanelHost<TPanelId extends string>({
  panels,
  activePanelId,
  className = '',
  closeTitle,
  onActivePanelChange,
  onClose,
  renderPanel,
}: {
  panels: Array<{ id: TPanelId; label: string; panel?: WorkbenchPanelContribution }>;
  activePanelId: TPanelId;
  className?: string;
  closeTitle: string;
  onActivePanelChange: (panelId: TPanelId) => void;
  onClose: () => void;
  renderPanel: (panelId: TPanelId) => ReactNode;
}) {
  return (
    <aside className={`workspace-panel-host ${className}`.trim()}>
      <div className="workspace-panel-header">
        <div className="segmented compact workspace-panel-tabs">
          {panels.map((panel) => (
            <button key={panel.id} className={activePanelId === panel.id ? 'active' : ''} type="button" onClick={() => onActivePanelChange(panel.id)}>
              {panel.label}
            </button>
          ))}
        </div>
        <button type="button" className="workspace-panel-close" onClick={onClose} title={closeTitle}>
          ×
        </button>
      </div>
      <div className="workspace-panel-content">{renderPanel(activePanelId)}</div>
    </aside>
  );
}

function ReaderSidePanelContent({
  tab,
  paper,
  fileMode,
  translatedFileId,
  focusedAnnotationId,
  noteDraftPatch,
  onNoteDraftPatchConsumed,
  onNoteSave,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onNavigateRelationTarget,
}: {
  tab: ReaderSidePanelTab;
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  focusedAnnotationId: string | null;
  noteDraftPatch: NoteDraftPatch | null;
  onNoteDraftPatchConsumed: () => void;
  onNoteSave: (content: string) => void | Promise<void>;
  onFocusAnnotation: (annotationId: string | null) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onNavigateRelationTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  if (tab === 'notes') {
    return <MarkdownNotePanel paper={paper} draftPatch={noteDraftPatch} onDraftPatchConsumed={onNoteDraftPatchConsumed} onSave={onNoteSave} />;
  }
  if (tab === 'annotations') {
    return (
      <AnnotationListPanel
        paper={paper}
        fileMode={fileMode}
        translatedFileId={translatedFileId}
        focusedAnnotationId={focusedAnnotationId}
        onFocusAnnotation={(annotationId) => onFocusAnnotation(annotationId)}
        onUpdateAnnotationComment={onUpdateAnnotationComment}
        onUpdateAnnotationPosition={onUpdateAnnotationPosition}
        onUpdateAnnotationColor={onUpdateAnnotationColor}
        onDeleteAnnotation={onDeleteAnnotation}
        onAppendToNote={onAppendAnnotationToNote}
      />
    );
  }
  if (tab === 'chat') {
    return <ReaderChatPanel paper={paper} />;
  }
  return <RelationPanel paper={paper} fileMode={fileMode} translatedFileId={translatedFileId} onNavigateTarget={onNavigateRelationTarget} />;
}

function MarkdownReadView({ paper }: { paper: PaperDocument }) {
  const content = paper.notes[0]?.content ?? '';
  return (
    <div className="markdown-reader">
      <div className="markdown-reader-header">
        <div className="panel-title">{zh.reader.noteTitle}</div>
      </div>
      <div className="markdown-reader-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
    </div>
  );
}

function MarkdownEmptyState({ onCreateNote }: { onCreateNote: () => void | Promise<void> }) {
  return (
    <div className="markdown-empty">
      <h2>{zh.reader.markdownEmptyTitle}</h2>
      <p>{zh.reader.markdownEmptyDescription}</p>
      <button type="button" className="primary import-empty-button rounded-button" onClick={() => void onCreateNote()}>
        {zh.reader.createNote}
      </button>
    </div>
  );
}

function MarkdownNotePanel({
  paper,
  draftPatch,
  onDraftPatchConsumed,
  onSave,
}: {
  paper: PaperDocument;
  draftPatch: NoteDraftPatch | null;
  onDraftPatchConsumed: () => void;
  onSave: (content: string) => void | Promise<void>;
}) {
  const source = paper.notes[0]?.content ?? '';
  const [content, setContent] = useState(source);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  useEffect(() => setContent(source), [paper.paperId, paper.notes[0]?.id, source]);

  useEffect(() => {
    if (!draftPatch?.append) return;
    setContent((current) => `${current.trimEnd()}${draftPatch.append}`);
    setSaveState('dirty');
    setMode('edit');
    onDraftPatchConsumed();
  }, [draftPatch, onDraftPatchConsumed]);

  useEffect(() => {
    if (content === source) {
      setSaveState('saved');
      return;
    }
    setSaveState('dirty');
    const timer = window.setTimeout(() => {
      void saveCurrent(content);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [content, source]);

  const saveCurrent = async (nextContent = content) => {
    if (nextContent === source && saveState !== 'dirty') {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      await onSave(nextContent);
      setSaveState('saved');
    } catch (error) {
      console.error('Note save failed', error);
      setSaveState('error');
    }
  };

  return (
    <div className="note-workspace">
      <div className="note-toolbar">
        <div className="panel-title">{zh.reader.noteTitle}</div>
        <div className="segmented compact note-mode-switch">
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            {zh.reader.noteEdit}
          </button>
          <button type="button" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            {zh.reader.notePreview}
          </button>
        </div>
      </div>
      <div className="note-status-row">
        <span className={`note-save-state ${saveState}`}>{noteSaveStateText(saveState)}</span>
        <button type="button" className="subtle-button rounded-button" onClick={() => void saveCurrent()} disabled={saveState === 'saving'}>
          {zh.reader.saveNote}
        </button>
      </div>
      {mode === 'edit' ? (
        <textarea className="note-editor" value={content} onChange={(event) => setContent(event.target.value)} onBlur={() => void saveCurrent()} placeholder={zh.reader.notePlaceholder} />
      ) : (
        <div className="markdown-preview note-preview-only" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      )}
    </div>
  );
}

function noteSaveStateText(state: 'saved' | 'dirty' | 'saving' | 'error') {
  if (state === 'saving') return zh.reader.noteSaving;
  if (state === 'dirty') return zh.reader.noteUnsaved;
  if (state === 'error') return zh.reader.noteSaveError;
  return zh.reader.noteSaved;
}

function AnnotationListPanel({
  paper,
  fileMode,
  translatedFileId,
  focusedAnnotationId,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendToNote,
}: {
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  focusedAnnotationId: string | null;
  onFocusAnnotation: (annotationId: string) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendToNote: (annotationId: string) => void;
}) {
  const activeFileId = fileMode === 'source' ? paper.sourceFileId : preferredTranslatedFileId(paper, translatedFileId);
  const sortedAnnotations = paper.annotations
    .filter((annotation) => !activeFileId || annotation.fileId === activeFileId)
    .sort((a, b) => a.page - b.page || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  if (!sortedAnnotations.length) {
    return <div className="mini-message">{zh.reader.noAnnotations}</div>;
  }
  return (
    <div className="annotation-list">
      {sortedAnnotations.map((annotation) => (
        <AnnotationListItem
          key={annotation.id}
          annotation={annotation}
          focused={focusedAnnotationId === annotation.id}
          onFocusAnnotation={onFocusAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendToNote={onAppendToNote}
        />
      ))}
    </div>
  );
}

function AnnotationListItem({
  annotation,
  focused,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendToNote,
}: {
  annotation: PaperDocument['annotations'][number];
  focused: boolean;
  onFocusAnnotation: (annotationId: string) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendToNote: (annotationId: string) => void;
}) {
  const [commentDraft, setCommentDraft] = useState(annotation.comment);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');

  useEffect(() => {
    setCommentDraft(annotation.comment);
    setSaveState('saved');
  }, [annotation.id, annotation.comment]);

  const saveComment = async () => {
    if (commentDraft === annotation.comment && saveState !== 'dirty') {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      await onUpdateAnnotationComment(annotation.id, commentDraft);
      setSaveState('saved');
    } catch (error) {
      console.error('Annotation comment save failed', error);
      setSaveState('error');
    }
  };

  const updateStickyStyle = (patch: PositionJson) => {
    void onUpdateAnnotationPosition(annotation.id, {
      ...annotation.positionJson,
      ...patch,
    });
  };

  return (
    <div className={`annotation-list-item ${focused ? 'focused' : ''}`} onClick={() => onFocusAnnotation(annotation.id)}>
      <div className="annotation-list-meta">
        <span>{zh.reader.annotationPage(annotation.page)}</span>
        <span>{annotationLabelText(annotation.type)}</span>
      </div>
      <button
        type="button"
        className="annotation-delete"
        title={zh.reader.deleteAnnotation}
        onClick={(event) => {
          event.stopPropagation();
          void onDeleteAnnotation(annotation.id);
        }}
      >
        <TrashIcon />
      </button>
      <button
        type="button"
        className="annotation-quote"
        onClick={(event) => {
          event.stopPropagation();
          onAppendToNote(annotation.id);
        }}
      >
        {zh.reader.appendAnnotationToNote}
      </button>
      <div className="annotation-list-color-row" onClick={(event) => event.stopPropagation()}>
        {annotationPresetColors.map((color) => (
          <button
            key={color}
            type="button"
            className={annotation.color === color ? `active ${color}` : color}
            title={color}
            onClick={() => void onUpdateAnnotationColor(annotation.id, color)}
          />
        ))}
        <label className="annotation-color-custom" title="自定义颜色">
          <input
            type="color"
            value={annotation.color.startsWith('#') ? annotation.color : '#ffc94a'}
            onChange={(event) => {
              const value = event.target.value;
              void onUpdateAnnotationColor(annotation.id, value as AnnotationColor);
            }}
          />
        </label>
      </div>
      {annotation.type === 'comment' && (
        <div className="sticky-style-row" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={annotation.positionJson.bold ? 'active' : ''} onClick={() => updateStickyStyle({ bold: !annotation.positionJson.bold })}>
            B
          </button>
          <button type="button" className={annotation.positionJson.italic ? 'active' : ''} onClick={() => updateStickyStyle({ italic: !annotation.positionJson.italic })}>
            I
          </button>
          <select value={Number(annotation.positionJson.fontSize ?? 13)} onChange={(event) => updateStickyStyle({ fontSize: Number(event.target.value) })}>
            {[12, 13, 14, 16, 18].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <input type="color" value={String(annotation.positionJson.textColor ?? '#202822')} onChange={(event) => updateStickyStyle({ textColor: event.target.value })} />
        </div>
      )}
      <textarea
        value={commentDraft}
        placeholder={zh.reader.commentPlaceholder}
        onClick={(event) => event.stopPropagation()}
        onBlur={() => void saveComment()}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void saveComment();
          }
        }}
        onChange={(event) => {
          setCommentDraft(event.target.value);
          setSaveState('dirty');
        }}
      />
      <span className={`annotation-save-state ${saveState}`}>{noteSaveStateText(saveState)}</span>
    </div>
  );
}

function ReaderChatPanel({ paper }: { paper: PaperDocument }) {
  return (
    <>
      <div className="panel-title">{zh.reader.aiAssist}</div>
      <div className="mini-message">{zh.reader.aiContextBound(paper.annotations.length)}</div>
      <div className="mini-message">{zh.ai.providerHint}</div>
    </>
  );
}

function RelationPanel({
  paper,
  fileMode,
  translatedFileId,
  onNavigateTarget,
}: {
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  onNavigateTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  const currentFileId = fileMode === 'translated' ? preferredTranslatedFileId(paper, translatedFileId) : paper.sourceFileId;
  const relationView = useMemo(() => buildPaperRelationView(paper, { currentFileId }), [paper, currentFileId]);
  const annotationById = useMemo(() => new Map(paper.annotations.map((annotation) => [annotation.id, annotation])), [paper.annotations]);
  const currentFileAnnotations = relationView.currentFileAnnotations
    .map((trace) => ({
      trace,
      annotation: annotationById.get(String(trace.annotation.metadata.originalId)),
    }))
    .filter((item): item is { trace: AnnotationTrace; annotation: PaperDocument['annotations'][number] } => Boolean(item.annotation));

  return (
    <div className="relation-panel">
      <div>
        <div className="panel-title">{zh.reader.panelRelations}</div>
        <p className="detail-muted">{zh.reader.relationSummary(relationView.graph.objects.length, relationView.graph.relations.length)}</p>
      </div>
      <RelationSection title={zh.reader.relationFiles}>
        {relationView.files.map(({ object }) => (
          <RelationRow
            key={object.id}
            label={String(object.metadata.fileKind) === 'translated' ? zh.reader.translatedPdf : zh.reader.sourcePdf}
            value={object.title}
            meta={String(object.metadata.path || '')}
            onClick={() => onNavigateTarget(getObjectNavigationTarget(object))}
          />
        ))}
      </RelationSection>
      <RelationSection title={zh.reader.relationNotes}>
        {relationView.notes.length ? (
          relationView.notes.map(({ object }) => (
            <RelationRow
              key={object.id}
              label={object.title}
              value={String(object.metadata.format || 'Markdown')}
              meta={object.summary || ''}
              onClick={() => onNavigateTarget(getObjectNavigationTarget(object))}
            />
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoNotes}</div>
        )}
      </RelationSection>
      <RelationSection title={zh.reader.relationAnnotations}>
        {currentFileAnnotations.length ? (
          currentFileAnnotations.slice(0, 12).map(({ trace, annotation }) => (
            <button key={annotation.id} type="button" className="relation-row clickable" onClick={() => onNavigateTarget(getObjectNavigationTarget(trace.annotation))}>
              <span>{zh.reader.annotationPage(annotation.page)}</span>
              <strong>{annotation.quote || annotation.comment || annotationLabelText(annotation.type)}</strong>
              <em>{annotationLabelText(annotation.type)}</em>
            </button>
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoAnnotations}</div>
        )}
        {currentFileAnnotations.length > 12 && <div className="detail-muted">{zh.reader.relationMoreAnnotations(currentFileAnnotations.length - 12)}</div>}
      </RelationSection>
      <RelationSection title={zh.reader.relationAiThreads}>
        {relationView.aiThreads.length ? (
          relationView.aiThreads.map(({ object }) => (
            <RelationRow key={object.id} label={object.title} value={zh.ai.provider} meta={String(object.metadata.originalId || '')} onClick={() => onNavigateTarget(getObjectNavigationTarget(object))} />
          ))
        ) : (
          <div className="mini-message">{zh.reader.relationNoAi}</div>
        )}
      </RelationSection>
    </div>
  );
}

function RelationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relation-section">
      <div className="relation-section-title">{title}</div>
      <div className="relation-section-body">{children}</div>
    </section>
  );
}

function RelationRow({ label, value, meta, onClick }: { label: string; value: string; meta?: string; onClick?: () => void }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value || '-'}</strong>
      {meta ? <em>{meta}</em> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="relation-row clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className="relation-row">
      {content}
    </div>
  );
}

function annotationLabelText(type: AnnotationType) {
  if (type === 'comment') return zh.reader.commentLabel;
  if (type === 'underline') return zh.reader.underlineLabel;
  if (type === 'area') return zh.reader.areaLabel;
  return zh.reader.highlightLabel;
}

function clonePositionJson(positionJson: PositionJson): PositionJson {
  return JSON.parse(JSON.stringify(positionJson)) as PositionJson;
}

function cloneAnnotation(annotation: PaperDocument['annotations'][number]): PaperDocument['annotations'][number] {
  return {
    ...annotation,
    positionJson: clonePositionJson(annotation.positionJson),
  };
}

function AIChatScene({
  papers,
  selectedPaper,
  messages,
  draft,
  error,
  onSelectPaper,
  onDraftChange,
  onSend,
  onReset,
}: {
  papers: PaperDocument[];
  selectedPaper: PaperDocument;
  messages: LocalChatMessage[];
  draft: string;
  error: string;
  onSelectPaper: (paperId: string) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onReset: () => void;
}) {
  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.ai.title}</h1>
          <p className="scene-description">{zh.ai.subtitle}</p>
        </div>
        <div className="provider-pill">{zh.ai.provider}</div>
      </header>
      <div className="ai-layout">
        <aside className="soft-panel chat-list">
          {papers.map((paper) => (
            <button key={paper.paperId} className={paper.paperId === selectedPaper.paperId ? 'chat-item active' : 'chat-item'} type="button" onClick={() => onSelectPaper(paper.paperId)}>
              <strong>{paper.title}</strong>
              <span>{zh.ai.boundTopics(paper.aiThreads.length)}</span>
            </button>
          ))}
        </aside>
        <section className="chat-room">
          <div className="context-banner">
            <div>
              {zh.ai.context}: {selectedPaper.title} / {readerPdfStatusLabel(selectedPaper)}
            </div>
            <button type="button" className="subtle-banner-button rounded-button" onClick={onReset}>
              {zh.ai.newThread}
            </button>
          </div>
          <div className="messages">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'message user' : 'message'}>
                {message.content}
              </div>
            ))}
          </div>
          {error && <div className="chat-error">{error}</div>}
          <div className="prompt-bar">
            <input
              value={draft}
              placeholder={zh.ai.input}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <button type="button" className="primary rounded-button" onClick={onSend} disabled={!draft.trim()}>
              {zh.ai.send}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function ImportDialog({
  draft,
  suggestions,
  state,
  settings,
  onChangeDraft,
  onSelectPdf,
  onRegenerate,
  onClose,
  onConfirm,
}: {
  draft: ImportDraft;
  suggestions: string[];
  state: ImportState;
  settings: AppSettings;
  onChangeDraft: (draft: ImportDraft) => void;
  onSelectPdf: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [enrichState, setEnrichState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const update = (field: keyof ImportDraft, value: string) => {
    onChangeDraft({ ...draft, [field]: field === 'year' ? Number(value) || '' : value, extractionSource: 'manual' });
  };
  const enrichOnline = async () => {
    setEnrichState('loading');
    try {
      const enriched = await enrichImportDraftOnline(draft, settings.metadataSourcePreference);
      onChangeDraft({
        ...draft,
        ...enriched,
        tags: draft.tags,
        extractionSource: 'manual',
        metadataSource: enriched.metadataSource,
        extractionWarnings: [...(draft.extractionWarnings ?? []), zh.importDialog.onlineSuccess(enriched.metadataSource)],
      });
      setEnrichState('success');
    } catch (error) {
      console.error('Online metadata enrichment failed', error);
      onChangeDraft({
        ...draft,
        extractionWarnings: [...(draft.extractionWarnings ?? []), zh.importDialog.onlineFailed],
      });
      setEnrichState('error');
    }
  };
  const sourceLabel = draft.extractionSource === 'pdf_text' ? zh.importDialog.sourcePdfText : draft.extractionSource === 'manual' ? zh.importDialog.sourceManual : zh.importDialog.sourceFilename;
  return (
    <div className="modal-backdrop">
      <section className="import-dialog import-dialog-large">
        <header>
          <div>
            <p className="eyebrow">{zh.importDialog.eyebrow}</p>
            <h2>{zh.importDialog.title}</h2>
          </div>
          <button type="button" className="rounded-button subtle-button" onClick={onClose}>
            {zh.importDialog.close}
          </button>
        </header>
        <div className="import-steps">
          <div className={draft.originalPath ? 'import-step done' : 'import-step active'}>{zh.importDialog.selectStep}</div>
          <div className={state === 'extracting' ? 'import-step active' : draft.originalPath ? 'import-step done' : 'import-step'}>{zh.importDialog.extractStep}</div>
          <div className={state === 'ready' || state === 'error' ? 'import-step active' : 'import-step'}>{zh.importDialog.confirmStep}</div>
        </div>
        <div className="pdf-select-block">
          <div>
            <strong>{draft.originalPath ? zh.importDialog.selectedFile : zh.importDialog.noFile}</strong>
            <span>{draft.originalPath || zh.importDialog.idle}</span>
          </div>
          <button type="button" className="primary choose-pdf-button rounded-button" onClick={() => void onSelectPdf()} disabled={state === 'selecting' || state === 'extracting' || state === 'importing'}>
            {draft.originalPath ? zh.importDialog.chooseAnother : zh.importDialog.choosePdf}
          </button>
        </div>
        <div className={`import-status ${state}`}>
          <span>{importStatusText(state)}</span>
          {draft.originalPath && <strong>{sourceLabel}</strong>}
        </div>
        <div className="import-grid">
          <label className="wide">
            {zh.importDialog.titleField}
            <input value={draft.title} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label>
            {zh.importDialog.authors}
            <input value={draft.authors} onChange={(event) => update('authors', event.target.value)} placeholder={zh.importDialog.optional} />
          </label>
          <label>
            {zh.importDialog.year}
            <input value={draft.year} onChange={(event) => update('year', event.target.value)} />
          </label>
          <label>
            {zh.importDialog.venue}
            <input value={draft.venue} onChange={(event) => update('venue', event.target.value)} placeholder={zh.importDialog.optional} />
          </label>
          <label>
            {zh.importDialog.doi}
            <input value={draft.doi} onChange={(event) => update('doi', event.target.value)} placeholder={zh.importDialog.optionalDoi} />
          </label>
          <label className="wide">
            {zh.importDialog.tags}
            <TagInput
              value={draft.tags}
              suggestions={suggestions}
              placeholder={zh.importDialog.tagsPlaceholder}
              onChange={(tags) =>
                onChangeDraft({
                  ...draft,
                  tags,
                  extractionSource: 'manual',
                })
              }
            />
          </label>
        </div>
        {!!draft.extractionWarnings?.length && (
          <div className="import-warnings">
            {draft.extractionWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
        <div className="import-hint">{zh.importDialog.hint}</div>
        <footer>
          <button type="button" className="rounded-button subtle-button" onClick={() => void onRegenerate()} disabled={!draft.originalPath || state === 'extracting' || state === 'importing'}>
            {zh.importDialog.regenerate}
          </button>
          <button
            type="button"
            className="rounded-button subtle-button"
            onClick={() => void enrichOnline()}
            disabled={!draft.originalPath || !settings.onlineMetadataEnabled || settings.metadataSourcePreference === 'localOnly' || enrichState === 'loading' || state === 'importing'}
            title={!settings.onlineMetadataEnabled || settings.metadataSourcePreference === 'localOnly' ? zh.importDialog.onlineDisabled : zh.importDialog.onlineEnrich}
          >
            {enrichState === 'loading' ? zh.importDialog.onlineLoading : zh.importDialog.onlineEnrich}
          </button>
          <button type="button" className="primary rounded-button" onClick={onConfirm} disabled={!draft.originalPath || state === 'extracting' || state === 'importing'}>
            {state === 'importing' ? zh.importDialog.importing : zh.importDialog.confirm}
          </button>
        </footer>
      </section>
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

function TagInput({
  value,
  suggestions,
  placeholder,
  onChange,
}: {
  value: string[];
  suggestions: string[];
  placeholder: string;
  onChange: (tags: string[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const normalizedValue = useMemo(() => normalizeEditableTags(value), [value]);
  const suggestionItems = useMemo(() => getTagSuggestions(suggestions, normalizedValue, input), [suggestions, normalizedValue, input]);
  const realTags = normalizedValue.filter((tag) => tag !== FALLBACK_TAG);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [input, suggestionItems.length]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const commitTag = (raw: string) => {
    const next = addTag(normalizedValue, raw);
    onChange(next);
    setInput('');
    setOpen(false);
    setHighlightedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!suggestionItems.length) return;
      setOpen(true);
      setHighlightedIndex((current) => (current + 1) % suggestionItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!suggestionItems.length) return;
      setOpen(true);
      setHighlightedIndex((current) => (current - 1 + suggestionItems.length) % suggestionItems.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && suggestionItems[highlightedIndex]) {
        commitTag(suggestionItems[highlightedIndex]);
        return;
      }
      if (input.trim()) {
        commitTag(input);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Backspace' && !input && realTags.length) {
      onChange(removeTag(normalizedValue, realTags[realTags.length - 1]));
    }
  };

  return (
    <div className="tag-input" ref={rootRef}>
      <div className="tag-input-shell" onClick={() => inputRef.current?.focus()}>
        {normalizedValue.map((tag) => (
          <span className={tag === FALLBACK_TAG ? 'tag-chip muted' : 'tag-chip'} key={tag}>
            <span>{tag}</span>
            {tag !== FALLBACK_TAG && (
              <button type="button" className="tag-remove" onClick={() => onChange(removeTag(normalizedValue, tag))} aria-label={`删除标签 ${tag}`}>
                ×
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </div>
      {open && suggestionItems.length > 0 && (
        <div className="tag-suggestions">
          {suggestionItems.map((tag, index) => (
            <button
              key={tag}
              type="button"
              className={index === highlightedIndex ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function importStatusText(state: ImportState) {
  if (state === 'selecting') return '正在等待选择 PDF...';
  if (state === 'extracting') return zh.importDialog.extracting;
  if (state === 'ready') return zh.importDialog.ready;
  if (state === 'error') return zh.importDialog.error;
  if (state === 'importing') return zh.importDialog.importing;
  return zh.importDialog.idle;
}

async function enrichImportDraftOnline(draft: ImportDraft, preference: MetadataSourcePreference): Promise<Partial<ImportDraft> & { metadataSource: string }> {
  if (preference === 'localOnly') throw new Error('Online metadata disabled');
  const arxivId = findArxivId([draft.doi, draft.title, draft.originalPath].join(' '));
  if (preference === 'arxivFirst' && arxivId) {
    const arxiv = await fetchArxivMetadata(arxivId);
    if (arxiv) return arxiv;
  }
  const crossref = await fetchCrossrefMetadata(draft);
  if (crossref) return crossref;
  if (arxivId) {
    const arxiv = await fetchArxivMetadata(arxivId);
    if (arxiv) return arxiv;
  }
  throw new Error('No online metadata found');
}

async function fetchCrossrefMetadata(draft: ImportDraft): Promise<(Partial<ImportDraft> & { metadataSource: string }) | null> {
  const doi = draft.doi.trim();
  const endpoint = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : `https://api.crossref.org/works?rows=1&query.title=${encodeURIComponent(draft.title.trim())}`;
  if (!doi && !draft.title.trim()) return null;
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data = await response.json();
  const work = doi ? data?.message : data?.message?.items?.[0];
  if (!work) return null;
  const title = Array.isArray(work.title) ? work.title[0] : '';
  if (!doi && !isLikelySameTitle(draft.title, title)) return null;
  const authors = Array.isArray(work.author)
    ? work.author
        .slice(0, 8)
        .map((author: { given?: string; family?: string }) => [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ')
    : '';
  const year = work.published?.['date-parts']?.[0]?.[0] ?? work.created?.['date-parts']?.[0]?.[0] ?? '';
  const venue = Array.isArray(work['container-title']) ? work['container-title'][0] : '';
  return {
    title: title || draft.title,
    authors: authors || draft.authors,
    year: typeof year === 'number' ? year : draft.year,
    venue: venue || draft.venue,
    doi: work.DOI || draft.doi,
    metadataSource: 'Crossref',
  };
}

async function fetchArxivMetadata(arxivId: string): Promise<(Partial<ImportDraft> & { metadataSource: string }) | null> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
  if (!response.ok) return null;
  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entry = doc.querySelector('entry');
  if (!entry) return null;
  const title = entry.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const authors = Array.from(entry.querySelectorAll('author > name'))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(', ');
  const published = entry.querySelector('published')?.textContent ?? '';
  const year = Number(published.slice(0, 4)) || '';
  return {
    title,
    authors,
    year,
    venue: 'arXiv',
    doi: `arXiv:${arxivId}`,
    metadataSource: 'arXiv',
  };
}

function findArxivId(text: string) {
  const match = text.match(/(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] ?? '';
}

function isLikelySameTitle(inputTitle: string, candidateTitle: string) {
  const inputWords = normalizedTitleWords(inputTitle);
  const candidateWords = normalizedTitleWords(candidateTitle);
  if (inputWords.length < 2 || candidateWords.length < 2) return Boolean(candidateTitle);
  const candidateSet = new Set(candidateWords);
  const overlap = inputWords.filter((word) => candidateSet.has(word)).length;
  return overlap >= Math.min(2, inputWords.length);
}

function normalizedTitleWords(title: string) {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(word));
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

function defaultUiState(settings = defaultSettings): PersistedUiState {
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
  };
}

function loadUiState(): PersistedUiState {
  const fallback = defaultUiState(loadAppSettings());
  try {
    const raw = localStorage.getItem('aster.uiState');
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
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
      readerSidePanelOpen: typeof parsed.readerSidePanelOpen === 'boolean' ? parsed.readerSidePanelOpen : fallback.readerSidePanelOpen,
      readerSidePanelTab: isReaderSidePanelTab(parsed.readerSidePanelTab) ? parsed.readerSidePanelTab : fallback.readerSidePanelTab,
    };
  } catch {
    return fallback;
  }
}

function saveUiState(state: PersistedUiState) {
  localStorage.setItem('aster.uiState', JSON.stringify(state));
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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readerPdfStatusLabel(paper: PaperDocument) {
  if (paper.translatedPdfs.length) return zh.reader.translatedPdf;
  if (paper.sourcePdf) return zh.reader.sourcePdf;
  return zh.ai.noPdf;
}

function createDefaultChatMessages(paper: PaperDocument | null | undefined): LocalChatMessage[] {
  if (!paper) return [];
  return [
    { id: `system-${paper.paperId}`, role: 'assistant', content: zh.ai.systemMessage(paper.annotations.length) },
    { id: `hint-${paper.paperId}`, role: 'assistant', content: zh.ai.providerHint },
  ];
}

function nativeAiMessageToLocal(message: { id: string; role: string; content: string }): LocalChatMessage {
  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
  };
}

function buildLocalAssistantReply(paper: PaperDocument, prompt: string) {
  const tags = paper.tags.length ? paper.tags.join(' / ') : '未分类';
  const note = paper.notes[0]?.content?.split('\n').slice(0, 3).join(' ').trim() || '当前还没有阅读笔记。';
  return `已绑定文献：${paper.title}\n标签：${tags}\n标注数：${paper.annotations.length}\n\n你的问题：${prompt}\n\n当前会先基于本地文献、标签、笔记和标注组织上下文，并把对话保存到本地资料库。参考笔记：${note}`;
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
  const lines = ['# Aster 文献清单', '', `导出数量：${papers.length}`, ''];
  papers.forEach((paper, index) => {
    lines.push(`## ${index + 1}. ${paper.title || '未命名文献'}`);
    lines.push(`- 作者：${paper.authors || zh.library.unknownAuthors}`);
    lines.push(`- 年份：${paper.year || '-'}`);
    lines.push(`- 来源：${paper.venue || zh.library.unknownVenue}`);
    if (paper.doi) lines.push(`- DOI：${paper.doi}`);
    lines.push(`- 标签：${paper.tags.length ? paper.tags.join('、') : FALLBACK_TAG}`);
    lines.push(`- 笔记：${paper.notes.length} 条`);
    lines.push(`- 标注：${paper.annotations.length} 条`);
    lines.push(`- 译文 PDF：${paper.translatedPdfs.length} 份`);
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
    .split(/,|;|\band\b|、/i)[0]
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
    .split(/;|、/)
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

function numberDiagnostic(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

function SettingsScene({
  settings,
  paths,
  diagnostics,
  onChange,
  onRefreshPaths,
  onRevealPath,
  onCreateBackup,
  onRestoreBackup,
}: {
  settings: AppSettings;
  paths: AsterPaths | null;
  diagnostics: AppDiagnostics | null;
  onChange: (settings: AppSettings) => void;
  onRefreshPaths: () => void | Promise<void>;
  onRevealPath: (kind: 'root' | 'database' | 'files' | 'backups') => void | Promise<void>;
  onCreateBackup: () => Promise<{ backup_path: string }>;
  onRestoreBackup: () => Promise<void>;
}) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const [copyStatus, setCopyStatus] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopyStatus(zh.settings.pathCopied);
      window.setTimeout(() => setCopyStatus(''), 1600);
    } catch {
      setCopyStatus(zh.settings.pathCopyFailed);
    }
  };
  const copyDiagnostics = async () => {
    const lines = [
      `Aster diagnostics`,
      `${zh.settings.productName}: ${diagnostics?.product_name ?? 'Aster'}`,
      `${zh.settings.version}: ${diagnostics?.version ?? '0.1.0'}`,
      `${zh.settings.identifier}: ${diagnostics?.identifier ?? 'app.aster.research'}`,
      `${zh.settings.platform}: ${diagnostics?.platform ?? zh.settings.pathUnavailable}`,
      `${zh.settings.dataRoot}: ${diagnostics?.data_root ?? paths?.root ?? zh.settings.pathUnavailable}`,
      `${zh.settings.databasePath}: ${paths?.database ?? zh.settings.pathUnavailable}`,
      `${zh.settings.filesPath}: ${paths?.files_root ?? zh.settings.pathUnavailable}`,
      `${zh.settings.paperCount}: ${diagnostics?.paper_count ?? '-'}`,
      `${zh.settings.sourcePdfCount}: ${diagnostics?.source_pdf_count ?? '-'}`,
      `${zh.settings.translatedPdfCount}: ${diagnostics?.translated_pdf_count ?? '-'}`,
      `${zh.settings.noteCount}: ${diagnostics?.note_count ?? '-'}`,
      `${zh.settings.annotationCount}: ${diagnostics?.annotation_count ?? '-'}`,
      `${zh.settings.aiThreadCount}: ${diagnostics?.ai_thread_count ?? '-'}`,
      `${zh.settings.missingFileCount}: ${diagnostics?.missing_file_count ?? '-'}`,
      `${zh.settings.databaseSize}: ${formatBytes(diagnostics?.database_size_bytes)}`,
      `${zh.settings.filesSize}: ${formatBytes(diagnostics?.files_size_bytes)}`,
      `${zh.settings.density}: ${settings.density}`,
      `${zh.settings.defaultReaderLayout}: ${settings.defaultReaderLayout}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyStatus(zh.settings.diagnosticsCopied);
      window.setTimeout(() => setCopyStatus(''), 1600);
    } catch {
      setCopyStatus(zh.settings.pathCopyFailed);
    }
  };
  const createBackup = async () => {
    setBackupBusy(true);
    setBackupStatus('');
    try {
      const result = await onCreateBackup();
      setBackupStatus(`${zh.settings.backupCreated}：${result.backup_path}`);
    } catch {
      setBackupStatus(zh.settings.backupFailed);
    } finally {
      setBackupBusy(false);
    }
  };
  const restoreBackup = async () => {
    setRestoreBusy(true);
    setBackupStatus('');
    try {
      await onRestoreBackup();
    } catch {
      setBackupStatus(zh.settings.restoreFailed);
    } finally {
      setRestoreBusy(false);
    }
  };
  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.settings.title}</h1>
          <p className="scene-description">{zh.settings.subtitle}</p>
        </div>
      </header>
      <div className="settings-grid">
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.language}</div>
          <p>{zh.settings.chinese}</p>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.density}</div>
          <div className="settings-control-row">
            <button type="button" className={settings.density === 'compact' ? 'active' : ''} onClick={() => update('density', 'compact')}>
              {zh.settings.compact}
            </button>
            <button type="button" className={settings.density === 'comfortable' ? 'active' : ''} onClick={() => update('density', 'comfortable')}>
              {zh.settings.comfortable}
            </button>
          </div>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.defaultReaderLayout}</div>
          <select value={settings.defaultReaderLayout} onChange={(event) => update('defaultReaderLayout', event.target.value as ReaderLayout)}>
            {layoutPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.metadataSources}</div>
          <select value={settings.metadataSourcePreference} onChange={(event) => update('metadataSourcePreference', event.target.value as MetadataSourcePreference)}>
            <option value="crossrefFirst">{zh.settings.crossrefFirst}</option>
            <option value="arxivFirst">{zh.settings.arxivFirst}</option>
            <option value="localOnly">{zh.settings.localOnly}</option>
          </select>
          <label className="settings-check">
            <input type="checkbox" checked={settings.onlineMetadataEnabled} onChange={(event) => update('onlineMetadataEnabled', event.target.checked)} />
            {zh.settings.enableOnlineMetadata}
          </label>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.library}</div>
          <p>{zh.settings.localLibrary}</p>
          <div className="settings-paths">
            <PathRow label={zh.settings.libraryRoot} value={paths?.root ?? zh.settings.pathUnavailable} onCopy={copyPath} />
            <PathRow label={zh.settings.databasePath} value={paths?.database ?? zh.settings.pathUnavailable} onCopy={copyPath} />
            <PathRow label={zh.settings.filesPath} value={paths?.files_root ?? zh.settings.pathUnavailable} onCopy={copyPath} />
          </div>
          <div className="settings-control-row settings-path-actions">
            <button type="button" onClick={() => void onRevealPath('root')} disabled={!paths}>
              {zh.settings.openLibraryRoot}
            </button>
            <button type="button" onClick={() => void onRevealPath('files')} disabled={!paths}>
              {zh.settings.openFilesPath}
            </button>
            <button type="button" onClick={() => void onRevealPath('backups')} disabled={!paths}>
              {zh.settings.openBackupsPath}
            </button>
            <button type="button" onClick={() => void onRefreshPaths()}>
              {zh.settings.refreshPaths}
            </button>
            {copyStatus && <span>{copyStatus}</span>}
          </div>
          <div className="settings-backup-row">
            <button type="button" className="primary rounded-button" onClick={() => void createBackup()} disabled={backupBusy || !paths}>
              {backupBusy ? zh.settings.backupRunning : zh.settings.createBackup}
            </button>
            <button type="button" className="rounded-button" onClick={() => void restoreBackup()} disabled={restoreBusy || !paths}>
              {restoreBusy ? zh.settings.restoreRunning : zh.settings.restoreBackup}
            </button>
            {backupStatus && <span title={backupStatus}>{backupStatus}</span>}
          </div>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.plugins}</div>
          <p>{zh.settings.extensionSummary}</p>
          <div className="extension-status-grid">
            <ExtensionStatus label={zh.settings.extensionCommands} value={aster.commands.list().length} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionEvents} value="document.*" status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionSettings} value={aster.settings.size} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionViews} value={aster.scenes.list().length} status={zh.settings.extensionReserved} />
            <ExtensionStatus label={zh.settings.extensionMetadata} value={aster.metadataSources.size} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionTranslation} value={aster.translationSources.size} status={zh.settings.extensionEnabled} />
            <ExtensionStatus label={zh.settings.extensionAi} value={aster.aiProviders.size} status={zh.settings.extensionEnabled} />
          </div>
          <div className="provider-section">
            <span>{zh.settings.builtInProviders}</span>
            <div className="provider-list">
              {[...aster.metadataSources.values(), ...aster.translationSources.values(), ...aster.aiProviders.values()].map((provider) => (
                <span key={provider.id} className="provider-chip" title={provider.id}>
                  {provider.name}
                </span>
              ))}
            </div>
          </div>
          <div className="provider-section">
            <span>{aster.plugins.size ? zh.settings.pluginCount(aster.plugins.size) : zh.settings.noRegisteredPlugins}</span>
            <div className="provider-list">
              {aster.plugins.size ? (
                [...aster.plugins.values()].map((plugin) => (
                  <span key={plugin.id} className="provider-chip" title={plugin.id}>
                    {plugin.name}
                  </span>
                ))
              ) : (
                <span className="provider-chip muted">{zh.settings.extensionLocalOnly}</span>
              )}
            </div>
          </div>
        </div>
        <div className="soft-panel">
          <div className="panel-title">{zh.settings.about}</div>
          <div className="diagnostics-grid">
            <DiagnosticItem label={zh.settings.productName} value={diagnostics?.product_name ?? 'Aster'} />
            <DiagnosticItem label={zh.settings.version} value={diagnostics?.version ?? '0.1.0'} />
            <DiagnosticItem label={zh.settings.identifier} value={diagnostics?.identifier ?? 'app.aster.research'} />
            <DiagnosticItem label={zh.settings.platform} value={diagnostics?.platform ?? zh.settings.pathUnavailable} />
            <DiagnosticItem label={zh.settings.dataRoot} value={diagnostics?.data_root ?? paths?.root ?? zh.settings.pathUnavailable} />
            <DiagnosticItem label={zh.settings.paperCount} value={numberDiagnostic(diagnostics?.paper_count)} />
            <DiagnosticItem label={zh.settings.sourcePdfCount} value={numberDiagnostic(diagnostics?.source_pdf_count)} />
            <DiagnosticItem label={zh.settings.translatedPdfCount} value={numberDiagnostic(diagnostics?.translated_pdf_count)} />
            <DiagnosticItem label={zh.settings.noteCount} value={numberDiagnostic(diagnostics?.note_count)} />
            <DiagnosticItem label={zh.settings.annotationCount} value={numberDiagnostic(diagnostics?.annotation_count)} />
            <DiagnosticItem label={zh.settings.aiThreadCount} value={numberDiagnostic(diagnostics?.ai_thread_count)} />
            <DiagnosticItem label={zh.settings.missingFileCount} value={numberDiagnostic(diagnostics?.missing_file_count)} />
            <DiagnosticItem label={zh.settings.databaseSize} value={formatBytes(diagnostics?.database_size_bytes)} />
            <DiagnosticItem label={zh.settings.filesSize} value={formatBytes(diagnostics?.files_size_bytes)} />
          </div>
          <div className="settings-control-row settings-path-actions">
            <button type="button" onClick={() => void copyDiagnostics()}>
              {zh.settings.copyDiagnostics}
            </button>
            {copyStatus && <span>{copyStatus}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function ExtensionStatus({ label, value, status }: { label: string; value: string | number; status: string }) {
  return (
    <div className="extension-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{status}</em>
    </div>
  );
}

function PathRow({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void | Promise<void> }) {
  const canCopy = value && value !== zh.settings.pathUnavailable;
  return (
    <div className="settings-path-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
      <button type="button" onClick={() => void onCopy(value)} disabled={!canCopy}>
        {zh.settings.copyPath}
      </button>
    </div>
  );
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

function AnnotationToolIcon({ id }: { id: ReaderTool }) {
  if (id === 'cursor') return <Icon path="M6 4.5 16.5 15H11l-2 4-3-11.5Z" />;
  if (id === 'comment') return <Icon path="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />;
  if (id === 'underline') return <Icon path="M7 5v5a5 5 0 0 0 10 0V5M6 19h12" />;
  if (id === 'area') return <Icon path="M7 7h10v10H7zM4 10h2M18 10h2M10 4v2M10 18v2" />;
  return <Icon path="M5 14.5 11.5 8 14 10.5 19 5.5 17.5 4 14 7.5 11.5 5 5 11.5Z" />;
}

function NotesIcon() {
  return <Icon path="M7 4h10a2 2 0 0 1 2 2v14H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Zm1 13h11M9 8h6M9 11h7" />;
}

function AnnotationsIcon() {
  return <Icon path="M5 15 15 5l4 4L9 19H5v-4Zm10-10 4 4M6 21h12" />;
}

function ChatIcon() {
  return <Icon path="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />;
}

function RelationsIcon() {
  return <Icon path="M8 7a3 3 0 1 0 0 .1M16 17a3 3 0 1 0 0 .1M17 6.5a2.5 2.5 0 1 0 0 .1M10.5 8.5l3.2 5.1M10.5 6.7l4-.4M9.8 15.6l3.4 1.1" />;
}

function TrashIcon() {
  return <Icon path="M6 7h12M10 7V5h4v2M8 7l.8 12h6.4L16 7M10.5 10v6M13.5 10v6" />;
}

function ZoomOutIcon() {
  return <Icon path="M11 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm6 10 3 3M9 11h4" />;
}

function ZoomInIcon() {
  return <Icon path="M11 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm6 10 3 3M11 9v4M9 11h4" />;
}

function FitWidthIcon() {
  return <Icon path="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M8 12h8" />;
}
