import { useCaptureLibraryUpdates } from '../features/library';
import { flushPendingSaves } from '../platform/pendingSaves';
import { isLibrarySmartView, selectLibraryView } from '../core/libraryViews';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, LayoutDashboard, Settings as SettingsGlyph } from 'lucide-react';
import { createAsterCore } from '../core/asterCore';
import { AgentSessionPanel, useAgentProviders } from '../features/agents';
import { useChatThreads, type AiReasoningLevel, type AiRunMode, type AiToolProviderId } from '../features/ai';
import { DiffResourceTab, FileTab, FileTreePanel, TerminalResourceTab } from '../features/explorer';
import { ImportDialog, TagInput, useImportFlow, usePaperState, type LibrarySortDirection, type LibrarySortKey } from '../features/library';
import {
  createBuiltinSceneUiContributions,
  resolveSceneUiContributions,
  type BuiltinSceneUiRuntime,
} from './sceneAdapters';
import {
  ReaderScene,
  createReaderSidePanelDefinitions,
  preferredReaderFile,
  preferredReaderMode,
  preferredTranslatedFileId,
  readerPanelCommandTitle,
  useAnnotationHistory,
  type NoteDraftPatch,
  type NoteSaveInput,
  type ReaderContentMode,
  type ReaderFileMode,
  type PdfZoomAnchor,
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
  type SyncSettingsState,
  type PluginMarketSettingsState,
  type LocalPluginSummary,
} from '../features/settings';
import {
  CommandPalette,
  ProjectSidebar,
  TabHost,
  WorkbenchShell,
  WORKBENCH_SIDEBAR_MAX_WIDTH,
  WORKBENCH_SIDEBAR_MIN_WIDTH,
  WorkbenchTopBar,
  createSceneSidebarViewRegistry,
  createSceneViewRegistry,
  createWorkbenchPanelViewRegistry,
  createResourceViewRegistry,
  type WorkbenchPanelViewContribution,
  useWorkbench,
  type CommandPaletteItem,
  type SidebarOpenItem,
  type SidebarSceneItem,
  type TabHostItem,
  type SceneViewContext,
  type WorkspacePanelDefinition,
} from '../workbench';
import {
  createDirectory, renameDirectory, deleteEmptyDirectory,
  createTextFile,
  deleteTextFile,
  describeProjectFolder,
  openPathInVSCode,
  renameTextFile,
  revealPath,
  selectProjectFolder,
} from '../platform/projects';
import { closeAgentSession } from '../platform/agentCli';
import {
  createLibraryBackup,
  createNativeFolder,
  deleteNativePaper,
  deleteNativeFolder,
  getAppDiagnostics,
  getAsterPaths,
  initializeLibrary,
  isTauriRuntime,
  loadNativeDocuments,
  listNativeFolders,
  moveNativePapersToFolder,
  openPaperFile,
  revealPaperFile,
  revealAsterPath,
  renameNativeFolder,
  restoreLibraryBackup,
  restartAfterLibraryRestore,
  selectPluginPackage,
  selectBackupFolder,
  updateNativePaperMetadata,
  updateNativePaperTags,
  upsertNativeNote,
  type AppDiagnostics,
  type AsterPaths,
  type PaperFileKind,
} from '../platform/nativeApi';
import type { AgentPermissionMode, AgentProviderId, WorkspaceTab, WorkspaceTabKind } from '../core/workspace';
import { inferResourceKind, normalizeResourceUri, resourceTabKey, resolveResourceOpener } from '../core/resources';
import type {
  AnnotationColor,
  AiProviderContribution,
  LibraryFolder,
  PaperDocument,
  ReaderLayout,
  ReaderSidePanelTab,
  ReaderTool,
  SceneId,
  SceneContribution,
  SettingContribution,
  WorkbenchPanelContribution,
  WorkbenchPanelId,
} from '../core/types';
import { readerPanelTabFromId } from '../core/workbench';
import { fetchPluginMarketIndex, loadPluginMarketCache, savePluginMarketCache } from '../core/pluginMarket';
import { parsePluginPackageEnvelope } from '../core/pluginImport';
import { parseDeclarativePluginPayloadText } from '../core/declarativePlugin';
import { defaultPluginSecurityPolicy, rotateTrustedKey, verifyPluginPackage } from '../core/pluginSecurity';
import { readTextFilePreview } from '../platform/projects';
import { movePath } from '../platform/projects';
import type { DirectoryEntry, TextFilePreview } from '../platform/projects';
import { createDesktopSyncCoordinator, HttpSyncApi, loadSyncOutbox, loadSyncState } from '../platform/sync';
import type { SyncAuthResult } from '../platform/sync';
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
};

const aster = createAsterCore(isTauriRuntime() ? [] : seedDocuments, baseScenes);
const syncApi = new HttpSyncApi();
const syncCoordinator = createDesktopSyncCoordinator(syncApi);

// Apply persisted plugin switches before React's first render. This keeps the
// scene, view and sidebar registries on one lifecycle snapshot and prevents a
// transient "view not connected" state during startup.
const persistedLocalPlugins = loadLocalPlugins();
const persistedDisabledPluginIds = new Set(loadDisabledPluginIds());
for (const plugin of persistedLocalPlugins) {
  if (!plugin.payload || plugin.status === 'blocked') continue;
  try {
    parseDeclarativePluginPayloadText(plugin.payload);
    aster.registerDeclarativePlugin({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version ?? '0.0.0',
      distribution: plugin.distribution ?? 'local',
      permissions: plugin.permissions ?? ['scenes'],
      integritySha256: plugin.integritySha256,
      signature: plugin.signature,
      signer: plugin.signer,
    }, plugin.payload);
    // Imported package state is persisted separately from the runtime map.
    // Respect both the current summary and the legacy disabled-id list before
    // the first React render so disabled plugins never flash into the UI.
    if (plugin.enabled === false || persistedDisabledPluginIds.has(plugin.id)) {
      aster.setPluginEnabled(plugin.id, false);
    }
  } catch (error) {
    console.warn(`Skipped invalid local plugin ${plugin.id}`, error);
  }
}
for (const pluginId of persistedDisabledPluginIds) aster.setPluginEnabled(pluginId, false);

/** The built-in library project has no folder on disk, so it gets a sentinel root. */
const BUILTIN_PROJECT_ROOT = 'aster://library';
const TOOL_TAB_PREFIX = 'tool:';
const READER_PAPER_TAB_PREFIX = `${TOOL_TAB_PREFIX}reader:paper:`;
const DEFAULT_PLUGIN_MARKET_URL = 'https://market.a4note.app/index.json';

/**
 * Keep first-party React adapters stable between ordinary UI renders while
 * still giving them the latest App state. Object spread is used by several
 * feature adapters, so the proxy mirrors enumerable keys as well as values.
 */
function createLiveRuntimeObjectProxy<K extends keyof BuiltinSceneUiRuntime>(
  runtimeRef: { current: BuiltinSceneUiRuntime | null },
  key: K,
): BuiltinSceneUiRuntime[K] {
  // `readerResource` is optional in the runtime contract, while Proxy itself
  // requires an object target. The proxy returns `undefined` for that key
  // until the host supplies it.
  const target = {} as object;
  return new Proxy(target, {
    get(_target, property) {
      const value = runtimeRef.current?.[key];
      return value && typeof value === 'object'
        ? Reflect.get(value, property)
        : undefined;
    },
    has(_target, property) {
      const value = runtimeRef.current?.[key];
      return Boolean(value && typeof value === 'object' && property in value);
    },
    ownKeys() {
      const value = runtimeRef.current?.[key];
      return value && typeof value === 'object' ? Reflect.ownKeys(value) : [];
    },
    getOwnPropertyDescriptor(_target, property) {
      const value = runtimeRef.current?.[key];
      if (!value || typeof value !== 'object') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  }) as BuiltinSceneUiRuntime[K];
}

function createLiveBuiltinSceneUiRuntimeProxy(
  runtimeRef: { current: BuiltinSceneUiRuntime | null },
): BuiltinSceneUiRuntime {
  const proxy = {} as BuiltinSceneUiRuntime;
  const objectKeys: Array<keyof BuiltinSceneUiRuntime> = [
    'overview',
    'library',
    'librarySidebar',
    'reader',
    'readerSidebar',
    'ai',
    'markdown',
    'libraryPanel',
    'readerPanel',
    'readerResource',
  ];
  for (const key of objectKeys) {
    Object.defineProperty(proxy, key, {
      enumerable: true,
      configurable: false,
      get: () => createLiveRuntimeObjectProxy(runtimeRef, key),
    });
  }
  Object.defineProperty(proxy, 'panels', {
    enumerable: true,
    configurable: false,
    get: () => runtimeRef.current?.panels ?? [],
  });
  return proxy;
}
function sceneLabelFor(sceneId: string) {
  return aster.scenes.list().find((scene) => scene.id === sceneId)?.label
    ?? aster.scenes.listDefinitions().find((scene) => scene.id === sceneId)?.label
    ?? sceneId;
}

// Legacy UI-state contract: function toolTabKey(sceneId: SceneId)
function toolTabKey(sceneId: SceneId): string;
function toolTabKey(sceneId: string): string;
function toolTabKey(sceneId: string) {
  return `${TOOL_TAB_PREFIX}${sceneId}`;
}

function readerPaperTabKey(paperId: string) {
  return `${READER_PAPER_TAB_PREFIX}${paperId}`;
}

function paperIdFromReaderTabKey(key: string) {
  return key.startsWith(READER_PAPER_TAB_PREFIX) ? key.slice(READER_PAPER_TAB_PREFIX.length) : null;
}

function sceneFromToolTabKey(key: string): SceneId | null {
  if (paperIdFromReaderTabKey(key)) return 'reader';
  // Workspaces created before the workbench tab contract used the bare scene
  // id (for example `overview`) instead of `tool:overview`. Accept both forms
  // so restoring an existing workspace never falls back to the plugin stub.
  const sceneId = key.startsWith(TOOL_TAB_PREFIX) ? key.slice(TOOL_TAB_PREFIX.length) : key;
  return aster.scenes.listDefinitions().some((scene) => scene.id === sceneId) ? (sceneId as SceneId) : null;
}

function tabStateString(tab: WorkspaceTab, field: string, fallback = '') {
  const value = tab.state[field];
  return typeof value === 'string' ? value : fallback;
}

function normalizeFilesystemPath(path: string) {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

function isPathWithin(sourcePath: string, candidatePath: string) {
  const source = normalizeFilesystemPath(sourcePath);
  const candidate = normalizeFilesystemPath(candidatePath);
  return candidate === source || candidate.startsWith(`${source}\\`) || candidate.startsWith(`${source}/`);
}

function remapMovedPath(path: string, sourcePath: string, destinationPath: string) {
  if (!isPathWithin(sourcePath, path)) return path;
  const source = sourcePath.replace(/[\\/]+$/, '');
  const destination = destinationPath.replace(/[\\/]+$/, '');
  const suffix = path.slice(source.length).replace(/^[/\\]+/, '');
  if (!suffix) return destinationPath;
  const separator = destination.includes('\\') ? '\\' : '/';
  return `${destination}${separator}${suffix}`;
}

function fileNameFromPath(path: string) {
  return path.replace(/^.*[\\/]/, '');
}

const RESOURCE_HOST_STATE_KEYS = new Set(['path', 'name', 'uri', 'resourceKind', 'sceneId', 'openerId']);

/** Keep opener extensions namespaced to their own state; routing stays host-owned. */
function safeResourceOpenerState(state?: Record<string, import('../core/types').JsonValue>) {
  return Object.fromEntries(
    Object.entries(state ?? {}).filter(([key]) => !RESOURCE_HOST_STATE_KEYS.has(key)),
  ) as Record<string, import('../core/types').JsonValue>;
}

function isResourceWorkspaceTabKind(kind: WorkspaceTabKind) {
  return kind === 'pdf' || kind === 'markdown' || kind === 'file' || kind.startsWith('plugin:');
}

function resourceOpenerForUri(uri: string, resourceKind?: string) {
  return resolveResourceOpener({
    uri,
    resourceKind,
    openers: aster.resourceOpeners.list(),
    scenes: aster.scenes.list(),
    isPluginActive: (pluginId) => aster.plugins.has(pluginId),
  });
}

function sceneForResource(uri: string, resourceKind?: string): SceneId | null {
  const effectiveKind = resourceKind ?? inferResourceKind(uri);
  const opener = resourceOpenerForUri(uri, effectiveKind);
  if (opener?.sceneId) {
    const scene = aster.scenes.list().find((candidate) => candidate.id === opener.sceneId);
    if (scene && (!scene.pluginId || aster.plugins.has(scene.pluginId))) return scene.id as SceneId;
  }
  return aster.scenes.list().find((scene) => (!scene.pluginId || aster.plugins.has(scene.pluginId)) && scene.resourceKinds?.includes(effectiveKind))?.id as SceneId | undefined ?? null;
}

function sceneForWorkspaceTab(tab: WorkspaceTab): SceneId | null {
  if (tab.kind === 'tool') return sceneFromToolTabKey(tab.key);
  // New resource tabs persist the scene that owned their opener. Keep this
  // identity authoritative across plugin reloads and extension collisions;
  // only legacy tabs without it should be inferred from their URI below.
  const persistedSceneId = tabStateString(tab, 'sceneId');
  if (persistedSceneId && aster.scenes.listDefinitions().some((scene) => scene.id === persistedSceneId)) {
    return persistedSceneId as SceneId;
  }
  // Resource-backed tabs belong to the scene that contributed their resource
  // kind. This keeps PDF/Markdown (and future plugin resource kinds) on the
  // same lifecycle as their opener and contextual sidebar.
  if (tab.kind === 'pdf' || tab.kind === 'markdown' || tab.kind === 'file' || tab.kind.startsWith('plugin:')) {
    const resourceKind = tabStateString(tab, 'resourceKind', tab.kind);
    return sceneForResource(tabStateString(tab, 'uri', tabStateString(tab, 'path')), resourceKind) ?? null;
  }
  if (tab.kind === 'agent') return 'aiChat';
  return 'overview';
}

function tabStateNumber(tab: WorkspaceTab, field: string, fallback: number) {
  const value = tab.state[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function appWorkbenchPanelsForScene(sceneId: SceneId, area?: WorkbenchPanelContribution['area']) {
  return aster.workbenchPanels
    .list()
    .filter((panel) => panel.sceneId === sceneId && (!area || panel.area === area))
    .sort((left, right) => left.order - right.order);
}

function librarySidePanelDefinitionsForRuntime(): WorkspacePanelDefinition<WorkbenchPanelId>[] {
  // Compatibility marker for the panel contribution contract: ...appWorkbenchPanelsForScene('library', 'right')
  return appWorkbenchPanelsForScene('library', 'right').map((panel) => ({
    id: panel.id,
    panel,
    label: libraryPanelLabel(panel.id),
  }));
}

function readerSidePanelDefinitionsForRuntime(): ReaderSidePanelDefinition[] {
  // Compatibility marker for the panel contribution contract: ...appWorkbenchPanelsForScene('reader', 'right')
  return createReaderSidePanelDefinitions(appWorkbenchPanelsForScene('reader', 'right'));
}

function workbenchPanelCommandDefinitionsForRuntime(): WorkbenchPanelCommandDefinition[] {
  const scenes = new Map(aster.scenes.list().map((scene) => [scene.id, scene]));
  return aster.workbenchPanels
    .list()
    .filter((panel) => {
      const scene = scenes.get(panel.sceneId);
      return Boolean(scene && (!scene.pluginId || aster.plugins.has(scene.pluginId)));
    })
    .map((panel) => {
      const scene = scenes.get(panel.sceneId);
      return {
        panel,
        commandId: panel.commandId,
        title: workbenchPanelCommandTitle(panel),
        group: scene ? `${zh.command.groupScenes} · ${scene.label}` : zh.command.groupWorkspace,
      };
    });
}

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
  const [pluginRuntimeVersion, setPluginRuntimeVersion] = useState(0);
  const pluginSettingContributions = useMemo(() => Array.from(aster.settings.values()).sort((left, right) => left.id.localeCompare(right.id)), [pluginRuntimeVersion]);
  const [pluginSettingValues, setPluginSettingValues] = useState<PluginSettingValues>(() => loadPluginSettingValues(aster.settings));
  const knownWorkbenchPanelIds = useMemo(() => aster.workbenchPanels.list().map((panel) => panel.id), [pluginRuntimeVersion]);
  const readerSidePanelDefinitions = useMemo(readerSidePanelDefinitionsForRuntime, [pluginRuntimeVersion]);
  const librarySidePanelDefinitions = useMemo(librarySidePanelDefinitionsForRuntime, [pluginRuntimeVersion]);
  const workbenchPanelCommandDefinitions = useMemo(workbenchPanelCommandDefinitionsForRuntime, [pluginRuntimeVersion]);
  const persistedUiState = usePersistedUiState(settings, knownWorkbenchPanelIds);
  const workbench = useWorkbench();
  const { store: workbenchStore, workspace: activeWorkspaceRecord, activeProject, tabs: workspaceTabs, activeTab, resources: workbenchResources } = workbench;
  const { providers: agentProviders, loading: agentProvidersLoading, refresh: refreshAgentProviders } = useAgentProviders();
  const [addProjectPending, setAddProjectPending] = useState(false);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  // A scene may promote its contextual sidebar into a full scene workspace.
  // This is transient navigation state; the active scene and its plugin
  // contribution remain the source of truth for what can be shown here.
  const [sidebarWorkspaceOpen, setSidebarWorkspaceOpen] = useState(false);
  const activeScene = activeTab ? sceneForWorkspaceTab(activeTab) : null;
  const sceneCatalog = aster.scenes.list();
  // Active scenes drive navigation and rendering. The stable definitions
  // catalog also contains scenes owned by disabled plugins, so Settings can
  // always offer a way to re-enable them.
  const sceneDefinitions = aster.scenes.listDefinitions();
  // Keep the last valid scene as workspace context. Closing the final resource
  // tab (or opening a file without a registered opener) can leave no scene that
  // can be derived from the active tab, but the scene sidebar still belongs to
  // the scene the user was working in.
  const lastSceneRef = useRef<SceneId>(persistedUiState.activeScene);
  if (activeScene) lastSceneRef.current = activeScene;
  const sidebarSceneId = activeScene ?? lastSceneRef.current;
  // Keep the last contribution snapshot for compatibility with lifecycle
  // callbacks that need to resolve a scene after its plugin is disposed.
  const sceneDefinitionsRef = useRef(new Map<string, SceneContribution>());
  sceneDefinitions.forEach((scene) => {
    sceneDefinitionsRef.current.set(scene.id, scene);
  });
  const availableSceneIds = sceneCatalog
    .filter((scene) => !scene.pluginId || aster.plugins.has(scene.pluginId))
    .map((scene) => scene.id);
  const sceneSettingsCatalog = sceneDefinitions;
  // Legacy UI-state contract: const [visibleSceneIds, setVisibleSceneIds] = useState<SceneId[]>(persistedUiState.visibleSceneIds)
  const [visibleSceneIds, setVisibleSceneIds] = useState<string[]>(() => {
    // Migrate existing installations so the new standalone Markdown scene is
    // visible once. Later user choices are preserved by persisted UI state.
    const migrationKey = 'aster.markdown-scene-visible';
    const migrated = localStorage.getItem(migrationKey) === '1';
    if (!migrated) {
      localStorage.setItem(migrationKey, '1');
      return Array.from(new Set([...persistedUiState.visibleSceneIds, 'markdown']));
    }
    return persistedUiState.visibleSceneIds;
  });
  useEffect(() => {
    // A missing active tab is a valid empty-workspace state. Preserve the
    // user's explicit sidebar choice while the last tab is being closed; the
    // retained scene context below still supplies the correct workspace view.
    if (!activeScene) return;
    const scene = sceneDefinitions.find((candidate) => candidate.id === activeScene);
    setSidebarWorkspaceOpen(scene?.sidebarMode === 'workspace');
  }, [activeScene, sceneDefinitions.map((scene) => `${scene.id}:${scene.sidebarMode ?? 'scene'}`).join('|')]);
  const [uiZoom, setUiZoom] = useState(persistedUiState.uiZoom);
  const [selectedPaperId, setSelectedPaperId] = useState(persistedUiState.selectedPaperId || initialDocuments[0]?.paperId || '');
  const [recentPaperIds, setRecentPaperIds] = useState<string[]>(persistedUiState.recentPaperIds);
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>(persistedUiState.readerLayout || settings.defaultReaderLayout);
  const [readerContentMode, setReaderContentMode] = useState<ReaderContentMode>('pdf');
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
  const [activeFolderId, setActiveFolderId] = useState(persistedUiState.activeFolderId);
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>(() => seedLibraryFolders(initialDocuments));
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
  const readerZoomAnchorRef = useRef<(PdfZoomAnchor & { zoom: number; left: number; top: number }) | null>(null);
  const librarySearchRef = useRef<HTMLInputElement | null>(null);
  const [readerSidePanelOpen, setReaderSidePanelOpen] = useState(persistedUiState.readerSidePanelOpen);
  const [readerSidePanelTab, setReaderSidePanelTab] = useState<ReaderSidePanelTab>(persistedUiState.readerSidePanelTab);
  const [noteDraftPatch, setNoteDraftPatch] = useState<NoteDraftPatch | null>(null);
  const [revision, setRevision] = useState(0);
  const [markdownTreeRevision, setMarkdownTreeRevision] = useState(0);
  const [restoreRestartPath, setRestoreRestartPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'appearance' | 'library' | 'plugins' | 'sync' | 'about'>('general');
  const [disabledPluginIds, setDisabledPluginIds] = useState<string[]>(loadDisabledPluginIds);
  const [syncUser, setSyncUser] = useState<SyncAuthResult['user'] | null>(null);
  const [syncState, setSyncState] = useState<SyncSettingsState>({ supported: isTauriRuntime(), authenticated: false, pendingOperations: 0 });
  const [pluginMarket, setPluginMarket] = useState<PluginMarketSettingsState>(() => {
    const cached = loadPluginMarketCache();
    return {
      url: cached?.url ?? DEFAULT_PLUGIN_MARKET_URL,
      fetchedAt: cached?.fetchedAt,
      generatedAt: cached?.index.generatedAt,
      records: cached?.index.records ?? [],
    };
  });
  const [localPlugins, setLocalPlugins] = useState<LocalPluginSummary[]>(() => loadLocalPlugins());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [metadataEditOpen, setMetadataEditOpen] = useState(false);
  const [tagsEditOpen, setTagsEditOpen] = useState(false);
  const [bulkTagsEditOpen, setBulkTagsEditOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  // Built-in React adapters are owned by the plugin lifecycle, not by every
  // ordinary state render. Keep the latest host inputs in a ref and expose a
  // stable proxy to adapters so their identities survive UI updates.
  const builtinSceneUiRuntimeRef = useRef<BuiltinSceneUiRuntime | null>(null);
  const builtinSceneUiRuntimeProxy = useMemo(
    () => createLiveBuiltinSceneUiRuntimeProxy(builtinSceneUiRuntimeRef),
    [],
  );
  const workbenchPanelViewRegistryRef = useRef<ReturnType<typeof createWorkbenchPanelViewRegistry> | null>(null);
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
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = settings.fontFamily;
    document.documentElement.style.setProperty('--ui-font-size', `${settings.interfaceFontSize}px`);
    document.documentElement.dataset.documentFont = settings.documentFontFamily;
    document.documentElement.dataset.codeFont = settings.codeFontFamily;
    const markdownDocumentFontSize = pluginSettingValues['markdown.documentFontSize'];
    const documentFontSize = typeof markdownDocumentFontSize === 'number' && Number.isFinite(markdownDocumentFontSize)
      ? Math.min(48, Math.max(10, markdownDocumentFontSize))
      : 20;
    document.documentElement.style.setProperty('--document-font-size', `${documentFontSize}px`);
    document.documentElement.dataset.documentLineHeight = settings.documentLineHeight;
    const markdownLayout = pluginSettingValues['markdown.documentLayout'];
    document.documentElement.dataset.documentLayout = markdownLayout === 'narrow' || markdownLayout === 'fluid' ? markdownLayout : settings.documentLayout;
    const markdownTitleAlignment = pluginSettingValues['markdown.titleAlignment'];
    document.documentElement.dataset.markdownTitleAlign = markdownTitleAlignment === 'center' || markdownTitleAlignment === 'right' || markdownTitleAlignment === 'left'
      ? markdownTitleAlignment
      : 'left';
    const markdownParagraphIndent = pluginSettingValues['markdown.paragraphIndent'];
    if (markdownParagraphIndent === true) {
      document.documentElement.dataset.markdownParagraphIndent = 'true';
    } else {
      delete document.documentElement.dataset.markdownParagraphIndent;
    }
    saveAppSettings(settings);
  }, [pluginSettingValues, settings]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-zoom', String(uiZoom));
    document.documentElement.style.zoom = `${Math.round(uiZoom * 100)}%`;
    return () => {
      document.documentElement.style.zoom = '';
      document.documentElement.style.removeProperty('--ui-zoom');
    };
  }, [uiZoom]);

  useEffect(() => {
    localStorage.setItem('aster.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('aster.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  // Registries are intentionally framework-free. Subscribe at the host boundary
  // so any plugin lifecycle change (including future external plugin hosts) makes
  // the React contribution resolver recompute immediately.
  useEffect(() => {
    const lifecycleEvents = [
      'plugin.registered',
      'plugin.disposed',
      'scene.registered',
      'scene.disposed',
      'scene.view.registered',
      'scene.view.disposed',
      'scene.sidebar.registered',
      'scene.sidebar.disposed',
      'workbench.panel.registered',
      'workbench.panel.disposed',
      'setting.registered',
      'setting.disposed',
      'resource.opener.registered',
      'resource.opener.disposed',
    ];
    const dispose = lifecycleEvents.map((eventName) => aster.events.on(eventName, () => {
      setPluginRuntimeVersion((current) => current + 1);
    }));
    return () => dispose.forEach((cleanup) => cleanup());
  }, []);

  // Core registers built-in plugins before React mounts, while imported
  // plugins may be restored by the desktop bootstrap immediately around the
  // first render. Re-read the registries after mount so a restored workbench
  // never remains on the placeholder scene because its first snapshot was
  // captured before the lifecycle bridge subscribed.
  useEffect(() => {
    setPluginRuntimeVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    localStorage.setItem('aster.disabledPlugins', JSON.stringify(disabledPluginIds));
  }, [disabledPluginIds]);

  useEffect(() => {
    // Visibility is a user preference, independent from plugin lifecycle. Keep
    // a disabled plugin's scene id here so re-enabling it restores its entry;
    // only scenes that are no longer known (for example after uninstall) are
    // removed from the preference list.
    const knownSceneIds = new Set(sceneDefinitions.map((scene) => scene.id));
    setVisibleSceneIds((current) => {
      const next = current.filter((id) => knownSceneIds.has(id));
      return next.length ? next : (availableSceneIds[0] ? [availableSceneIds[0]] : []);
    });
    if (activeScene && !availableSceneIds.includes(activeScene)) {
      const fallbackScene = availableSceneIds[0];
      if (fallbackScene) setScene(fallbackScene);
    }
  }, [activeScene, availableSceneIds.join('|'), sceneDefinitions.map((scene) => scene.id).join('|')]);

  useEffect(() => {
    savePluginSettingValues(pluginSettingValues);
  }, [pluginSettingValues]);

  useEffect(() => {
    saveUiState({
      activeScene: lastSceneRef.current,
      visibleSceneIds,
      uiZoom,
      selectedPaperId,
      recentPaperIds,
      query,
      activeTag,
      activeFolderId,
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
    activeFolderId,
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
    recentPaperIds,
    selectedPaperId,
    uiZoom,
    visibleSceneIds,
  ]);

  const changeReaderFileMode = (mode: ReaderFileMode) => {
    setReaderFileMode(mode);
    if (mode !== 'parallel') {
      setReaderActiveFileKind(mode);
    }
  };

  const refreshNativeDocuments = async (preferredPaperId?: string, preserveReaderMode = false) => {
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
    if (!preserveReaderMode) setReaderContentMode(preferredReaderMode(nextPaper));
    const nextReaderFileMode = preferredReaderFile(nextPaper);
    setReaderFileMode(nextReaderFileMode);
    if (nextReaderFileMode !== 'parallel') setReaderActiveFileKind(nextReaderFileMode);
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(nextPaper, current));
    setLibraryStatus(zh.app.loaded(nativeDocuments.length));
    setRevision((current) => current + 1);
  };

  useCaptureLibraryUpdates(async () => {
    const documents = await loadNativeDocuments();
    aster.documents.replaceAll(documents);
    setRevision(current => current + 1);
  });

  const refreshNativeFolders = async () => {
    if (!isTauriRuntime()) return;
    try {
      setLibraryFolders(await listNativeFolders());
    } catch (error) {
      console.error('Failed to load library folders', error);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    initializeLibrary()
      .then((paths) => {
        setAsterPaths(paths);
        return Promise.all([refreshNativeDocuments(), refreshNativeFolders()]);
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
      .catch((error) => console.error('Failed to load A4 Note paths', error));
    getAppDiagnostics()
      .then(setAppDiagnostics)
      .catch((error) => console.error('Failed to load app diagnostics', error));
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen || !isTauriRuntime()) return;
    loadSyncState()
      .then((state) => setSyncState((current) => ({
        ...current,
        supported: true,
        pendingOperations: current.pendingOperations,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
      })))
      .catch((error) => setSyncState((current) => ({ ...current, supported: true, lastError: error instanceof Error ? error.message : String(error) })));
  }, [settingsOpen]);

  const documents = aster.documents.list();
  const selectedPaper = selectedPaperId ? aster.documents.get(selectedPaperId) : documents[0] ?? null;
  const bulkSelectedPapers = bulkSelectedPaperIds.map((paperId) => aster.documents.get(paperId)).filter((paper): paper is PaperDocument => Boolean(paper));
  const tags = aster.documents.allTags();
  const aiProvider = getActiveAiProvider(settings.aiProviderId);
  const settingsAiProviders = Array.from(aster.aiProviders.values());
  const settingsProviders = [...aster.metadataSources.values(), ...aster.translationSources.values(), ...settingsAiProviders];
  const settingsPlugins: SettingsPluginSummary[] = Array.from(aster.pluginDefinitions.values()).map((plugin) => {
    const registered = aster.plugins.get(plugin.id);
    return { id: plugin.id, name: plugin.name, version: plugin.manifest?.version, trust: registered?.trust ?? (plugin.manifest?.distribution === 'builtin' ? 'builtin' : 'blocked'), enabled: Boolean(registered) };
  });
  const settingsExtensionCounts: SettingsExtensionCounts = {
    commands: aster.commands.list().length,
    settings: aster.settings.size,
    // Scene views and contextual sidebars are plugin contributions too. Keep
    // this count tied to their live registries so disabling a scene plugin is
    // reflected immediately in the plugin management surface.
    views: aster.sceneViews.list().length + aster.sceneSidebars.list().length,
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
  const paperState = usePaperState(aster, () => setRevision((current) => current + 1), setLibraryStatus);
  const selectLibraryFolder = (folderId: string) => {
    setActiveFolderId(folderId);
    if (folderId === 'recently-viewed' || folderId === 'recently-imported') {
      setLibrarySort({ key: folderId === 'recently-viewed' ? 'lastViewedAt' : 'createdAt', direction: 'desc' });
    } else if (librarySort.key === 'createdAt' || librarySort.key === 'lastViewedAt') {
      setLibrarySort({ key: 'year', direction: 'desc' });
    }
  };
  const filteredPapers = useMemo(() => {
    const searched = aster.documents.search(query);
    const searchIds = new Set(searched.map((paper) => paper.paperId));
    const foldered = selectLibraryView(aster.documents.list(), activeFolderId).filter((paper) => searchIds.has(paper.paperId));
    const tagged = activeTag === 'all' ? foldered : foldered.filter((paper) => paper.tags.includes(activeTag));
    const sorted = [...tagged].sort((left, right) => comparePaper(left, right, librarySort));
    return sorted;
  }, [activeFolderId, activeTag, librarySort, query, revision]);

  useEffect(() => {
    if (activeTag !== 'all' && !tags.includes(activeTag)) {
      setActiveTag('all');
    }
  }, [activeTag, tags]);

  useEffect(() => {
    if (!isLibrarySmartView(activeFolderId) && !libraryFolders.some((folder) => folder.folderId === activeFolderId)) {
      setActiveFolderId('all');
    }
  }, [activeFolderId, libraryFolders]);

  useEffect(() => {
    if (!selectedPaper) return;
    if (readerContentMode !== 'pdf') setReaderContentMode('pdf');
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

  useLayoutEffect(() => {
    const anchor = readerZoomAnchorRef.current;
    if (!anchor) return;
    readerZoomAnchorRef.current = null;
    // Parallel reading mounts two PDF containers. The active pane owns the
    // zoom gesture and must also receive the post-layout scroll correction;
    // selecting the first container would move the inactive pane instead.
    const scroller = document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-keepalive-pane.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.pdf-document');
    if (!scroller) return;
    const content = scroller.querySelector<HTMLElement>('.pdf-document-content');
    // The parent layout effect may run before PdfReader's cleanup effect. Clear
    // the compositor-only preview first so measurements below describe the
    // committed page layout, never the old transformed rectangle.
    content?.style.removeProperty('transform');
    content?.style.removeProperty('transform-origin');
    const scale = readerZoom / anchor.zoom;
    const maxLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const maxTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const scrollerRect = scroller.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    // Re-read the post-layout content origin. Horizontal centering can move
    // the document when a zoom crosses the viewport-width threshold.
    const contentOriginX = contentRect
      ? contentRect.left - scrollerRect.left + scroller.scrollLeft
      : anchor.contentOriginX;
    const contentOriginY = contentRect
      ? contentRect.top - scrollerRect.top + scroller.scrollTop
      : anchor.contentOriginY;
    const nextLeft = contentOriginX + anchor.contentX * scale - anchor.left;
    const nextTop = contentOriginY + anchor.contentY * scale - anchor.top;
    scroller.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    scroller.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
  }, [readerZoom]);

  const changeReaderZoom = (nextZoom: number, anchorPoint?: PdfZoomAnchor) => {
    const scroller = document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-keepalive-pane.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.pdf-document');
    if (scroller && nextZoom !== readerZoom) {
      const rect = scroller.getBoundingClientRect();
      const left = anchorPoint ? anchorPoint.x - rect.left : rect.width / 2;
      const top = anchorPoint ? anchorPoint.y - rect.top : rect.height / 2;
      const content = scroller.querySelector<HTMLElement>('.pdf-document-content');
      const contentRect = content?.getBoundingClientRect();
      const contentOriginX = anchorPoint?.contentOriginX
        ?? (contentRect ? contentRect.left - rect.left + scroller.scrollLeft : 0);
      const contentOriginY = anchorPoint?.contentOriginY
        ?? (contentRect ? contentRect.top - rect.top + scroller.scrollTop : 0);
      const contentX = anchorPoint?.contentX
        ?? (contentRect ? scroller.scrollLeft + left - contentOriginX : scroller.scrollLeft + left);
      const contentY = anchorPoint?.contentY
        ?? (contentRect ? scroller.scrollTop + top - contentOriginY : scroller.scrollTop + top);
      readerZoomAnchorRef.current = {
        x: anchorPoint?.x ?? rect.left + left,
        y: anchorPoint?.y ?? rect.top + top,
        zoom: readerZoom,
        contentX,
        contentY,
        contentOriginX,
        contentOriginY,
        left,
        top,
      };
    }
    setReaderZoom(nextZoom);
  };

  const fitReaderToWidth = () => {
    const scroller = document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-keepalive-pane.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.workbench-tab-frame.active .pdf-document')
      ?? document.querySelector<HTMLElement>('.pdf-document');
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

  const folderProjectPath = activeProject && activeProject.kind === 'folder' ? activeProject.rootPath : null;

  /** First run seeds the built-in library project so a workspace always exists. */
  useEffect(() => {
    if (workbenchStore.getState().projects.length > 0) return;
    const project = workbenchStore.createProject({
      rootPath: BUILTIN_PROJECT_ROOT,
      name: zh.workbench.builtinProjectName,
      kind: 'builtin',
      workspaceName: zh.workbench.builtinWorkspaceName,
    });
    const seeded = workbenchStore.getState().workspaces.find((workspace) => workspace.projectId === project.id);
    if (seeded) workbenchStore.activateWorkspace(seeded.id);
  }, [workbenchStore]);

  const initialTabOpenedRef = useRef(false);
  useEffect(() => {
    if (initialTabOpenedRef.current || !activeWorkspaceRecord) return;
    initialTabOpenedRef.current = true;
    if (activeWorkspaceRecord.tabs.length > 0) return;
    workbenchStore.openTab(activeWorkspaceRecord.id, {
      kind: 'tool',
      key: toolTabKey(persistedUiState.activeScene),
      title: sceneLabelFor(persistedUiState.activeScene),
    });
  }, [activeWorkspaceRecord, persistedUiState.activeScene, workbenchStore]);

  const ensureWorkspaceId = () => {
    if (activeWorkspaceRecord) return activeWorkspaceRecord.id;
    const fallback = workbenchStore.getState().workspaces[0];
    if (!fallback) return null;
    workbenchStore.activateWorkspace(fallback.id);
    return fallback.id;
  };

  const ensureContextualSidebar = (sceneId: string, workspaceId: string) => {
    const scene = aster.scenes.list().find((candidate) => candidate.id === sceneId);
    if ((scene?.sidebarMode === 'contextual' || scene?.sidebarMode === 'workspace') && scene.defaultSidebarPanel) {
      workbenchStore.setWorkspaceLayout(workspaceId, { fileTreeVisible: true });
    }
  };

  const setScene = (sceneId: string) => {
    const scene = aster.scenes.list().find((candidate) => candidate.id === sceneId);
    if (!scene) return;
    if (scene?.pluginId && !aster.plugins.has(scene.pluginId)) return;
    setSettingsOpen(false);
    setActiveFileTabId(null);
    setSidebarWorkspaceOpen(scene.sidebarMode === 'workspace');
    setVisibleSceneIds((current) => (current.includes(sceneId) ? current : [...current, sceneId]));
    const workspaceId = ensureWorkspaceId();
    if (!workspaceId) return;
    ensureContextualSidebar(sceneId, workspaceId);
    // Compatibility contract: scene title comes from the plugin registry. A
    // pre-workbench snapshot may contain a bare `overview`-style key; migrate
    // that tab in place instead of opening a duplicate canonical tab.
    const canonicalKey = toolTabKey(sceneId);
    const workspaceTabs = workbenchStore.getState().workspaces.find((workspace) => workspace.id === workspaceId)?.tabs ?? [];
    const canonicalTab = workspaceTabs.find((tab) => tab.kind === 'tool' && tab.key === canonicalKey);
    if (canonicalTab) {
      workbenchStore.setActiveTab(canonicalTab.id);
      return;
    }
    const legacyTab = workspaceTabs.find((tab) => tab.kind === 'tool' && tab.key === sceneId);
    if (legacyTab) {
      workbenchStore.rekeyTab(legacyTab.id, canonicalKey, sceneLabelFor(sceneId));
      workbenchStore.setActiveTab(legacyTab.id);
      return;
    }
    workbenchStore.openTab(workspaceId, { kind: 'tool', key: toolTabKey(sceneId), title: sceneLabelFor(sceneId) });
  };

  /**
   * Close a resource tab without losing the workspace that owns it. The core
   * store intentionally selects an adjacent tab after close; for a focused
   * PDF/Markdown/resource tab that adjacent tab may belong to another scene.
   * Prefer the owning scene's canonical tool tab when it exists.
   */
  const closeWorkspaceTab = (tabId: string) => {
    const currentState = workbenchStore.getState();
    const workspace = currentState.workspaces.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId));
    const tab = workspace?.tabs.find((candidate) => candidate.id === tabId);
    if (!workspace || !tab) return;
    const wasActive = workspace.activeTabId === tabId;
    const isReaderDocumentTab = tab.kind === 'tool' && Boolean(paperIdFromReaderTabKey(tab.key));
    const sceneId = isResourceWorkspaceTabKind(tab.kind) || isReaderDocumentTab ? sceneForWorkspaceTab(tab) : null;
    workbenchStore.closeTab(tabId);
    if (!wasActive || !sceneId) return;
    const updatedWorkspace = workbenchStore.getState().workspaces.find((candidate) => candidate.id === workspace.id);
    const canonicalTab = updatedWorkspace?.tabs.find((candidate) => candidate.kind === 'tool' && candidate.key === toolTabKey(sceneId));
    if (canonicalTab) {
      setActiveFileTabId(null);
      workbenchStore.setActiveTab(canonicalTab.id);
    }
  };

  const addProjectFolder = async () => {
    setAddProjectPending(true);
    try {
      const selected = await selectProjectFolder();
      if (!selected) return;
      const info = await describeProjectFolder(selected);
      if (!info.exists || !info.is_directory) {
        setLibraryStatus(zh.workbench.addProjectFailed);
        return;
      }
      const project = workbenchStore.createProject({ rootPath: info.path, name: info.name, kind: 'folder' });
      const workspace = workbenchStore.getState().workspaces.find((candidate) => candidate.projectId === project.id);
      if (!workspace) return;
      workbenchStore.activateWorkspace(workspace.id);
      workbenchStore.setWorkspaceLayout(workspace.id, { fileTreeVisible: true });
    } catch (error) {
      console.error('Add project folder failed', error);
      setLibraryStatus(zh.workbench.addProjectFailed);
    } finally {
      setAddProjectPending(false);
    }
  };

  const toggleFileTree = () => {
    if (!activeWorkspaceRecord) return;
    const activeSceneDefinition = activeScene
      ? sceneDefinitions.find((scene) => scene.id === activeScene)
      : undefined;
    if (activeSceneDefinition?.sidebarMode === 'workspace') {
      setSidebarWorkspaceOpen((current) => !current);
      return;
    }
    workbenchStore.setWorkspaceLayout(activeWorkspaceRecord.id, {
      fileTreeVisible: !activeWorkspaceRecord.layout.fileTreeVisible,
    });
  };

  /**
   * Every file tab goes through the resource registry, so one path cannot open two
   * tabs. The tab kind follows the resource kind: a `.pdf` gets the reader (PDF-0),
   * everything else the text/binary preview. Both use the same `resourceTabKey`, so
   * a path already open as `file` cannot also open as `pdf`.
   */
  const openFileTab = (path: string, name: string) => {
    const workspaceId = ensureWorkspaceId();
    if (!workspaceId) return;
    setSettingsOpen(false);
    const uri = normalizeResourceUri(path);
    const inferredResourceKind = inferResourceKind(uri);
    const opener = resourceOpenerForUri(uri, inferredResourceKind);
    const resourceKind = opener?.kind ?? inferredResourceKind;
    const storedResourceKind = (opener?.pluginId && !resourceKind.startsWith('plugin:')
      ? `plugin:${resourceKind}`
      : resourceKind) as import('../core/resources').ResourceKind;
    const openerResult = opener?.open?.({ uri, title: name });
    const openerRecord = openerResult && typeof openerResult === 'object' ? openerResult as {
      kind?: string;
      title?: string;
      state?: Record<string, import('../core/types').JsonValue>;
    } : undefined;
    const requestedTabKind = openerRecord?.kind ?? opener?.tabKind;
    // A plugin-owned renderer must stay on a plugin tab. Otherwise a plugin
    // that happens to use a built-in tab kind (for example `markdown`) would
    // be silently rendered by the host's legacy branch and its contribution
    // would never be visible.
    const pluginTabKind = opener?.renderer && opener.pluginId
      ? `plugin:${opener.pluginId}` as const
      : null;
    const tabKind: WorkspaceTabKind = pluginTabKind ?? (requestedTabKind === 'pdf' || requestedTabKind === 'markdown' || requestedTabKind === 'file'
      || requestedTabKind === 'terminal' || requestedTabKind === 'diff' || requestedTabKind === 'agent' || requestedTabKind === 'tool'
      ? requestedTabKind
      : opener?.pluginId ? `plugin:${opener.pluginId}` : 'file');
    const resource = workbenchStore.registerResource({
      uri,
      kind: storedResourceKind,
      title: name,
      projectId: activeProject?.kind === 'folder' ? activeProject.id : undefined,
    });
    // Keep the scene that was active before opening this resource as a
    // fallback for files without a registered opener (for example PNGs opened
    // from the Markdown file tree). Such tabs still belong to the current
    // workspace scene and must return to its sidebar when closed.
    const openingSceneId = activeScene ?? lastSceneRef.current;
    const resourceSceneId = sceneForResource(uri, resourceKind)
      ?? (sceneDefinitions.some((scene) => scene.id === openingSceneId) ? openingSceneId : null);
    if (resourceSceneId) {
      // Resource tabs are children of their owning scene. Ensure the scene's
      // canonical tool tab exists before opening the resource, so closing the
      // last file returns to that scene instead of an unrelated tab (usually
      // Overview) and its scene picker sidebar.
      setScene(resourceSceneId);
      setVisibleSceneIds((current) => (current.includes(resourceSceneId) ? current : [...current, resourceSceneId]));
      const resourceScene = sceneDefinitions.find((scene) => scene.id === resourceSceneId);
      setSidebarWorkspaceOpen(resourceScene?.sidebarMode === 'workspace');
      ensureContextualSidebar(resourceSceneId, workspaceId);
    }
    const openedTab = workbenchStore.openTab(workspaceId, {
      kind: tabKind,
      key: resourceTabKey(uri),
      title: openerRecord?.title ?? name,
      resourceId: resource?.id,
      state: {
        // Opener state is extensible, but the host owns routing metadata. Put
        // it first so a plugin cannot accidentally replace the URI, kind,
        // opener or scene used to restore and render this tab.
        ...safeResourceOpenerState(openerRecord?.state),
        path,
        name: openerRecord?.title ?? name,
        uri,
        resourceKind: storedResourceKind,
        ...(resourceSceneId ? { sceneId: resourceSceneId } : {}),
        ...(opener?.id ? { openerId: opener.id } : {}),
      },
    });
    // Explicitly focus the returned tab as well. This keeps file-tree clicks
    // reliable when an existing workspace was restored with a stale active id.
    if (openedTab) {
      workbenchStore.setActiveTab(openedTab.id);
      setActiveFileTabId(openedTab.id);
    }
  };

  const agentProviderLabel = (providerId: string) => agentProviders.find((provider) => provider.id === providerId)?.label ?? providerId;

  const createAgentSessionTab = (providerId: string) => {
    const workspaceId = ensureWorkspaceId();
    if (!workspaceId) return;
    const session = workbenchStore.createAgentSession({ workspaceId, providerId: providerId as AgentProviderId });
    if (!session) return;
    setSettingsOpen(false);
    workbenchStore.openTab(workspaceId, {
      kind: 'agent',
      key: `agent:${session.id}`,
      title: zh.workbench.agentSessionTitle(agentProviderLabel(providerId)),
      sessionId: session.id,
    });
    ensureContextualSidebar('aiChat', workspaceId);
  };

  const confirmRemoveProject = (projectId: string) => {
    const project = workbenchStore.getState().projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    setConfirmDialog({
      title: zh.workbench.removeProjectTitle,
      message: zh.workbench.removeProjectMessage(project.name),
      confirmLabel: zh.workbench.confirmRemove,
      onConfirm: () => workbenchStore.removeProject(projectId),
    });
  };

  const confirmRemoveWorkspace = (workspaceId: string) => {
    const workspace = workbenchStore.getState().workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return;
    setConfirmDialog({
      title: zh.workbench.removeWorkspaceTitle,
      message: zh.workbench.removeWorkspaceMessage(workspace.name),
      confirmLabel: zh.workbench.confirmDelete,
      danger: true,
      onConfirm: () => workbenchStore.removeWorkspace(workspaceId),
    });
  };

  const confirmRemoveAgentSession = (sessionId: string, title: string) => {
    setConfirmDialog({
      title: zh.workbench.agentRemoveSessionTitle,
      message: zh.workbench.agentRemoveSessionMessage(title),
      confirmLabel: zh.workbench.confirmDelete,
      danger: true,
      onConfirm: () => {
        // Deleting the record has to end the process too, or the CLI keeps running
        // with nothing left in the UI able to stop it.
        if (isTauriRuntime()) void closeAgentSession(sessionId).catch(() => undefined);
        workbenchStore.removeAgentSession(sessionId);
      },
    });
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
    setRecentPaperIds((current) => current.filter((paperId) => !deletedSet.has(paperId)));
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

  const focusReaderPaper = (paperId: string) => {
    // Both opening a paper and revisiting an existing reader tab count as a view.
    paperState.update(paperId, 'viewed');
    setSelectedPaperId(paperId);
    setRecentPaperIds((current) => [paperId, ...current.filter((id) => id !== paperId)].slice(0, 8));
    setReaderRequestedPage(null);
    setReaderFocusedAnnotationId(null);
    const paper = aster.documents.get(paperId) ?? documents.find((candidate) => candidate.paperId === paperId) ?? null;
    setReaderContentMode(preferredReaderMode(paper));
    const nextReaderFileMode = preferredReaderFile(paper);
    setReaderFileMode(nextReaderFileMode);
    if (nextReaderFileMode !== 'parallel') setReaderActiveFileKind(nextReaderFileMode);
    setReaderTranslatedFileId((current) => preferredTranslatedFileId(paper, current));
  };

  const openReaderForPaper = (paperId: string) => {
    focusReaderPaper(paperId);
    setSettingsOpen(false);
    setSidebarWorkspaceOpen(true);
    setVisibleSceneIds((current) => (current.includes('reader') ? current : [...current, 'reader']));
    const workspaceId = ensureWorkspaceId();
    const paper = aster.documents.get(paperId) ?? documents.find((candidate) => candidate.paperId === paperId) ?? null;
    if (!workspaceId) {
      setScene('reader');
      return;
    }
    // Keep a stable scene tab alongside the paper tab. Without it, closing the
    // final reader document selects the previous scene tab and collapses the
    // reader workspace sidebar.
    setScene('reader');
    workbenchStore.openTab(workspaceId, {
      kind: 'tool',
      key: readerPaperTabKey(paperId),
      title: paper?.title ?? sceneLabelFor('reader'),
      state: { paperId },
    });
    ensureContextualSidebar('reader', workspaceId);
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
    const panelView = workbenchPanelViewRegistryRef.current?.get(definition.panel.id);
    panelView?.open?.({ panel: definition.panel, sceneId: definition.panel.sceneId, selectedPaper });
    setScene(definition.panel.sceneId);
  };

  const {
    importOpen,
    importState,
    draft,
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

      // Match VS Code's global UI zoom shortcuts. These run before reader
      // zoom so the same shortcut is predictable in every scene.
      if (readerKey === '=' || readerKey === '+') {
        event.preventDefault();
        setUiZoom((current) => clampNumber(Number((current + 0.1).toFixed(2)), 0.8, 1.4));
        return;
      }
      if (readerKey === '-' || readerKey === '_') {
        event.preventDefault();
        setUiZoom((current) => clampNumber(Number((current - 0.1).toFixed(2)), 0.8, 1.4));
        return;
      }
      if (readerKey === '0') {
        event.preventDefault();
        setUiZoom(1);
        return;
      }

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

      const sceneShortcut = aster.scenes.list().find((scene) => scene.key === event.key
        && visibleSceneIds.includes(scene.id)
        && (!scene.pluginId || aster.plugins.has(scene.pluginId)));
      if (sceneShortcut) {
        event.preventDefault();
        if (sceneShortcut.id === 'reader' && selectedPaper) openReaderForPaper(selectedPaper.paperId);
        else setScene(sceneShortcut.id);
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
  }, [activeScene, annotationRedoStack, annotationUndoStack, bulkTagsEditOpen, commandPaletteOpen, visibleSceneIds, importOpen, metadataEditOpen, readerContentMode, readerFocusedAnnotationId, readerZoom, selectedPaper?.paperId, tagsEditOpen, deleteAnnotation, fitReaderToWidth, openReaderForPaper, redoAnnotationAction, undoAnnotationAction]);

  const saveNote = async ({ noteId, title, content, expected }: NoteSaveInput) => {
    if (!selectedPaper) throw new Error('未选择文献，笔记尚未保存');
    if (isTauriRuntime()) {
      const result = await upsertNativeNote({
        paperId: selectedPaper.paperId,
        noteId,
        title,
        content,
        expected,
      });
      // Apply only this note. A late full-library refresh must not select the old
      // paper again or replace another note's newer in-memory draft.
      try {
        aster.commands.execute('document.upsertNote', { paperId: selectedPaper.paperId, noteId: result.id, title, content });
      } catch (error) {
        // SQLite already committed. The store updates memory before persisting
        // its optional browser cache; a quota error must not report DB save failure.
        console.warn('笔记已保存到资料库，但浏览器缓存写入失败', error);
        setLibraryStatus('笔记已保存到资料库；浏览器缓存空间不足，重启后将从资料库读取。');
      }
      setRevision((current) => current + 1);
      return result.id;
    }
    const currentNote = aster.documents.get(selectedPaper.paperId)?.notes.find((note) => note.id === noteId);
    if (expected && currentNote && (expected.title !== currentNote.title || expected.content !== currentNote.content)
      && (title !== currentNote.title || content !== currentNote.content)) {
      throw new Error('笔记已修改，拒绝覆盖，请先导出草稿进行合并');
    }
    const note = aster.commands.execute<NoteSaveInput & { paperId: string }, PaperDocument['notes'][number] | null>(
      'document.upsertNote',
      { paperId: selectedPaper.paperId, noteId, title, content },
    );
    setRevision((current) => current + 1);
    return note?.id;
  };

  const createNoteAndSwitch = async () => {
    if (!selectedPaper) return;
    const noteNumber = selectedPaper.notes.length + 1;
    const title = noteNumber === 1 ? zh.reader.noteDefaultTitle : zh.reader.noteNumberedTitle(noteNumber);
    const noteId = await saveNote({ title, content: `# ${title}\n\n` });
    return noteId;
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
      await flushPendingSaves();
      const result = await restoreLibraryBackup(selected);
      if (result.restart_required) {
        setSettingsOpen(false);
        setRestoreRestartPath(result.safety_backup_path);
        return;
      }
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
      ...sceneCatalog
        .filter((scene) => visibleSceneIds.includes(scene.id) && (!scene.pluginId || aster.plugins.has(scene.pluginId)))
        .map<CommandPaletteItem>((scene) => ({
          id: `scene.${scene.id}`,
          title: `打开${scene.label}`,
          group: zh.command.groupScenes,
          shortcut: scene.key ? `Ctrl+${scene.key}` : undefined,
          disabled: scene.id === 'reader' && !selectedPaper,
          run: () => {
            if (scene.id === 'reader' && selectedPaper) {
              openReaderForPaper(selectedPaper.paperId);
              return;
            }
            setScene(scene.id);
          },
        })),
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
    [visibleSceneIds, openImportDialog, pluginRuntimeVersion, sceneCatalog, selectedPaper?.paperId, workbenchPanelCommandDefinitions, commandPaletteOpen],
  );

  const sidebarScenes: SidebarSceneItem[] = aster.scenes.list().filter((scene) => visibleSceneIds.includes(scene.id) && (!scene.pluginId || aster.plugins.has(scene.pluginId))).map((scene) => ({
    id: scene.id,
    label: scene.label || sceneLabelFor(scene.id),
    hint: `${scene.label || sceneLabelFor(scene.id)} Ctrl+${scene.key}`,
    scope: scene.scope,
    source: scene.source,
    icon: <SceneIcon id={scene.id} />,
  }));

  // A reader tab owns the document identified by its key.  TabHost keeps the
  // resulting component mounted, so selecting another tab cannot replace an
  // already-open PDF with the globally selected paper.
  const renderReaderNode = (paper: PaperDocument | null, panelViews: WorkbenchPanelViewContribution[] = []) => paper ? (
    <ReaderScene
      paper={paper}
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
      aiThreadContexts={getAiThreadContextsForPaper(paper.paperId)}
      sidePanels={readerSidePanelDefinitions}
      panelViews={panelViews}
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
  );

  const createMarkdownNoteIn = async (directoryPath: string) => {
    const baseName = '未命名.md';
    for (let index = 0; index < 100; index += 1) {
      const name = index === 0 ? baseName : `未命名 ${index + 1}.md`;
      const path = `${directoryPath.replace(/[\\/]$/, '')}\\${name}`;
      try {
        await createTextFile(path, '# 新建笔记\n\n');
        openFileTab(path, name);
        setMarkdownTreeRevision((current) => current + 1);
        return;
      } catch (error) {
        if (index === 99) setLibraryStatus(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const createMarkdownFolderIn = async (directoryPath: string, name: string) => {
    await createDirectory(directoryPath, name);
  };

  const markdownTabsForPath = (path: string) => {
    const targetUri = normalizeResourceUri(path);
    return workbenchStore.getState().workspaces
      .flatMap((workspace) => workspace.tabs)
      .filter((tab) => normalizeResourceUri(tabStateString(tab, 'uri', tabStateString(tab, 'path'))) === targetUri);
  };

  const executeDeleteMarkdownFile = async (entry: DirectoryEntry) => {
    try {
      if (entry.is_directory) await deleteEmptyDirectory(folderProjectPath ?? '', entry.path);
      else await deleteTextFile(entry.path);
      const deletedTabs = markdownTabsForPath(entry.path);
      deletedTabs.forEach((tab) => closeWorkspaceTab(tab.id));
      setActiveFileTabId((current) => deletedTabs.some((tab) => tab.id === current) ? null : current);
      setMarkdownTreeRevision((current) => current + 1);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteMarkdownFile = (entry: DirectoryEntry) => {
    setConfirmDialog({
      title: zh.workbench.fileDelete,
      message: `确定删除“${entry.name}”吗？`,
      detail: entry.is_directory ? '只允许删除空文件夹；非空目录将拒绝删除，不会删除其中的笔记。' : '文件内容将从磁盘移除。',
      confirmLabel: zh.workbench.fileDelete,
      danger: true,
      onConfirm: () => executeDeleteMarkdownFile(entry),
    });
  };

  const renameMarkdownFile = async (entry: DirectoryEntry, newStem: string) => {
    try {
      const renamed = entry.is_directory ? await renameDirectory(folderProjectPath ?? '', entry.path, newStem) : await renameTextFile(entry.path, newStem);
      const renamedTabs = workbenchStore.getState().workspaces.flatMap(workspace => workspace.tabs).filter(tab => isPathWithin(entry.path, tabStateString(tab, 'path', tabStateString(tab, 'uri'))));
      renamedTabs.forEach(tab => {
        const oldPath = tabStateString(tab, 'path', tabStateString(tab, 'uri'));
        const nextPath = remapMovedPath(oldPath, entry.path, renamed.path);
        const nextName = normalizeFilesystemPath(oldPath) === normalizeFilesystemPath(entry.path) ? renamed.name : tabStateString(tab, 'name', tab.title);
        const uri = normalizeResourceUri(nextPath);
        workbenchStore.rekeyTab(tab.id, resourceTabKey(uri), nextName);
        workbenchStore.updateTabState(tab.id, { path: nextPath, name: nextName, uri });
        if (tab.resourceId) workbenchStore.updateResource(tab.resourceId, { uri, title: nextName });
      });
      setMarkdownTreeRevision((current) => current + 1);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const moveMarkdownEntry = async (entry: DirectoryEntry, destinationDirectory: string) => {
    try {
      const moved = await movePath(entry.path, destinationDirectory);
      const movedTabs = workbenchStore.getState().workspaces
        .flatMap((workspace) => workspace.tabs)
        .filter((tab) => isPathWithin(entry.path, tabStateString(tab, 'path', tabStateString(tab, 'uri'))));
      movedTabs.forEach((tab) => {
        const currentPath = tabStateString(tab, 'path', tabStateString(tab, 'uri'));
        const nextPath = remapMovedPath(currentPath, entry.path, moved.path);
        const nextName = normalizeFilesystemPath(currentPath) === normalizeFilesystemPath(entry.path)
          ? moved.name
          : tabStateString(tab, 'name', tab.title) || fileNameFromPath(nextPath);
        const uri = normalizeResourceUri(nextPath);
        workbenchStore.rekeyTab(tab.id, resourceTabKey(uri), nextName);
        workbenchStore.updateTabState(tab.id, { path: nextPath, name: nextName, uri });
        if (tab.resourceId) workbenchStore.updateResource(tab.resourceId, { uri, title: nextName });
      });
      setMarkdownTreeRevision((current) => current + 1);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const revealMarkdownFile = async (entry: DirectoryEntry) => {
    try {
      await revealPath(entry.path);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : zh.app.actionFailed);
    }
  };

  const activeMarkdownPath = activeTab
    && (activeTab.kind === 'markdown' || activeTab.kind === 'file')
    && /\.(?:md|markdown|mdx)$/i.test(tabStateString(activeTab, 'path'))
    ? tabStateString(activeTab, 'path')
    : undefined;

  const markdownFileTree = folderProjectPath ? (
    <FileTreePanel
      key={markdownTreeRevision}
      rootPath={folderProjectPath}
      onOpenFile={(entry) => openFileTab(entry.path, entry.name)}
      onDeleteFile={(entry) => void deleteMarkdownFile(entry)}
      onRenameFile={renameMarkdownFile}
      onRevealFile={(entry) => void revealMarkdownFile(entry)}
      onMoveEntry={moveMarkdownEntry}
      onCreateFile={createMarkdownNoteIn}
      onCreateFolder={createMarkdownFolderIn}
      activePath={activeMarkdownPath}
    />
  ) : null;
  const readerOpenItems = workspaceTabs
    .filter((tab) => sceneForWorkspaceTab(tab) === 'reader' && (tab.kind === 'pdf' || (tab.kind === 'tool' && Boolean(paperIdFromReaderTabKey(tab.key)))))
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      hint: tab.kind === 'pdf' ? tabStateString(tab, 'path', tab.title) : tab.title,
      active: activeTab?.id === tab.id,
    }));
  // Core plugins register React-free identities. The host supplies trusted
  // first-party adapters through one feature-owned factory, then intersects
  // them with the live plugin registry before exposing them to the workbench.
  builtinSceneUiRuntimeRef.current = {
    overview: {
      isActive: activeScene === 'overview',
      papers: documents,
      recentPaperIds,
      onOpenPaper: openReaderForPaper,
      onOpenLibrary: () => setScene('library'),
      onOpenImport: openImportDialog,
    },
    library: {
      papers: filteredPapers,
      folders: libraryFolders,
      selectedPaper,
      tags,
      activeTag,
      activeFolderId,
      query,
      sort: librarySort,
      detailOpen: libraryDetailOpen,
      aiThreadContexts: selectedPaper ? getAiThreadContextsForPaper(selectedPaper.paperId) : [],
      bulkSelectedPaperIds,
      searchInputRef: librarySearchRef,
      sidePanels: librarySidePanelDefinitions,
      onQueryChange: setQuery,
      onSelectPaper: setSelectedPaperId,
      onBulkSelectionChange: setBulkSelectedPaperIds,
      onMovePapersToFolder: async (paperIds, folderId) => {
        if (!paperIds.length) return;
        try {
          // The native API uses null for the built-in library root while the
          // UI keeps the stable `library` folder id for filtering.
          if (isTauriRuntime()) {
            await moveNativePapersToFolder(paperIds, folderId === 'library' ? null : folderId);
          }
          aster.documents.moveToFolder(paperIds, folderId);
          setRevision((current) => current + 1);
          setBulkSelectedPaperIds([]);
          if (isTauriRuntime()) await refreshNativeDocuments(undefined, true);
        } catch (error) {
          setLibraryStatus(error instanceof Error ? error.message : String(error));
        }
      },
      onOpenPaper: openReaderForPaper,
      onSelectTag: setActiveTag,
      onSelectFolder: selectLibraryFolder,
      onSortChange: setLibrarySort,
      onDetailOpenChange: setLibraryDetailOpen,
      onOpenImport: openImportDialog,
      onOpenReader: () => selectedPaper && openReaderForPaper(selectedPaper.paperId),
      onOpenRelations: () => selectedPaper && openReaderRelationsForPaper(selectedPaper.paperId),
      onOpenTranslationImport: importTranslatedPdf,
      onRevealSourcePdf: () => void revealSelectedPaperFile('source'),
      onRevealTranslatedPdf: () => void revealSelectedPaperFile('translated'),
      onOpenSourcePdfExternal: () => void openSelectedPaperFile('source'),
      onOpenTranslatedPdfExternal: () => void openSelectedPaperFile('translated'),
      onOpenMetadataEdit: () => setMetadataEditOpen(true),
      onOpenTagsEdit: () => setTagsEditOpen(true),
      onOpenBulkTagsEdit: () => setBulkTagsEditOpen(true),
      onBulkDelete: () => void deleteBulkSelectedPapers(),
      onDeletePaper: deleteSelectedPaper,
      onCopyMarkdown: () => void copyLibraryExport('markdown'),
      onCopyCsv: () => void copyLibraryExport('csv'),
      onCopyBibtex: () => void copySelectedBibtex(),
      onCopyBulkBibtex: () => void copyBulkBibtex(),
    },
    librarySidebar: {
      papers: documents,
      folders: libraryFolders,
      activeFolderId,
      activeTag,
      tags,
      selectedPaperId,
      onOpenPaper: openReaderForPaper,
      onMovePapersToFolder: async (paperIds, folderId) => {
        if (!paperIds.length) return;
        try {
          if (isTauriRuntime()) {
            await moveNativePapersToFolder(paperIds, folderId === 'library' ? null : folderId);
          }
          aster.documents.moveToFolder(paperIds, folderId);
          setRevision((current) => current + 1);
          if (isTauriRuntime()) await refreshNativeDocuments(undefined, true);
        } catch (error) {
          setLibraryStatus(error instanceof Error ? error.message : String(error));
        }
      },
      onSelectFolder: selectLibraryFolder,
      onSelectTag: setActiveTag,
      onSelectPaper: setSelectedPaperId,
      onCreateFolder: async (name, parentId) => {
        try {
          if (!isTauriRuntime()) {
            const folderId = `folder-${Date.now()}`;
            setLibraryFolders((current) => [...current, { folderId, name, parentId, paperCount: 0 }]);
            return;
          }
          const folder = await createNativeFolder({ name, parentId });
          setLibraryFolders((current) => [...current, folder]);
        } catch (error) {
          setLibraryStatus(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
      onRenameFolder: async (folderId, name) => {
        try {
          if (!isTauriRuntime()) {
            setLibraryFolders((current) => current.map((folder) => folder.folderId === folderId ? { ...folder, name } : folder));
            return;
          }
          await renameNativeFolder(folderId, name);
          setLibraryFolders((current) => current.map((folder) => folder.folderId === folderId ? { ...folder, name } : folder));
        } catch (error) {
          setLibraryStatus(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
      onDeleteFolder: async (folderId) => {
        try {
          if (!isTauriRuntime()) {
            const removed = new Set([folderId]);
            let changed = true;
            while (changed) {
              changed = false;
              libraryFolders.forEach((folder) => { if (folder.parentId && removed.has(folder.parentId) && !removed.has(folder.folderId)) { removed.add(folder.folderId); changed = true; } });
            }
            const deletedFolder = libraryFolders.find((folder) => folder.folderId === folderId);
            const fallbackFolderId = deletedFolder?.parentId ?? 'library';
            const reassignedDocuments = documents.map((paper) => removed.has(paper.folderId || 'library') ? { ...paper, folderId: fallbackFolderId } : paper);
            aster.documents.replaceAll(reassignedDocuments);
            setLibraryFolders((current) => current.filter((folder) => !removed.has(folder.folderId)));
            setActiveFolderId((current) => removed.has(current) ? 'all' : current);
            setRevision((current) => current + 1);
            return;
          }
          await deleteNativeFolder(folderId);
          await Promise.all([refreshNativeDocuments(), refreshNativeFolders()]);
        } catch (error) {
          setLibraryStatus(error instanceof Error ? error.message : String(error));
        }
      },
    },
    reader: {
      getPaper: ({ tab }) => {
        const paperId = paperIdFromReaderTabKey(tab.key);
        // The canonical Reader scene tab is intentionally document-less. Do
        // not fall back to the globally selected/recent library paper here:
        // after closing the final PDF, Reader must show its empty state until
        // the user explicitly opens a PDF again.
        return paperId ? aster.documents.get(paperId) ?? null : null;
      },
      emptyView: <EmptyScene title={zh.reader.noPaperTitle} description={zh.reader.noPaperDescription} action={zh.library.importPdf} onAction={openImportDialog} />,
      render: (paper, _context, panelViews) => renderReaderNode(paper, panelViews),
    },
    readerSidebar: {
      openItems: readerOpenItems,
      onSelectItem: (tabId) => {
        setSettingsOpen(false);
        setActiveFileTabId(null);
        const tab = workspaceTabs.find((candidate) => candidate.id === tabId);
        const paperId = tab ? paperIdFromReaderTabKey(tab.key) : null;
        if (paperId) focusReaderPaper(paperId);
        workbenchStore.setActiveTab(tabId);
      },
      onCloseItem: closeWorkspaceTab,
    },
    ai: {
      view: selectedPaper ? {
        papers: documents,
        selectedPaper,
        messages: chatMessages,
        draft: chatDraft,
        error: chatError,
        providerId: aiProviderId,
        modelId: aiModelId,
        reasoningLevel: aiReasoningLevel,
        permissionMode: aiPermissionMode,
        runMode: aiRunMode,
        onSelectPaper: setSelectedPaperId,
        onDraftChange: (draft) => updateChatDraft(selectedPaper.paperId, draft),
        onAiProviderChange: setAiProviderId,
        onAiModelChange: setAiModelId,
        onAiReasoningChange: setAiReasoningLevel,
        onAiPermissionChange: setAiPermissionMode,
        onAiRunModeChange: setAiRunMode,
        onSend: () => void sendChatMessage(selectedPaper.paperId),
        onReset: () => confirmResetChatThread(selectedPaper.paperId),
      } : null,
      emptyView: <EmptyScene title={zh.ai.noPaperTitle} description={zh.ai.noPaperDescription} action={zh.library.importPdf} onAction={openImportDialog} />,
      sidebar: {
        papers: documents,
        selectedPaperId: selectedPaper?.paperId ?? null,
        onSelectPaper: setSelectedPaperId,
      },
    },
    markdown: {
      view: { rootPath: folderProjectPath, projectName: activeProject?.name ?? 'Markdown', showFileTree: false },
      sidebar: markdownFileTree ?? <p className="workbench-sidebar-hint">请先打开一个项目文件夹。</p>,
      resource: {
        onOpenFile: openFileTab,
        onRenamed: (tabId, file) => {
          const uri = normalizeResourceUri(file.path);
          workbenchStore.rekeyTab(tabId, resourceTabKey(uri), file.name);
          workbenchStore.updateTabState(tabId, { path: file.path, name: file.name, uri });
          const renamedTab = workbenchStore.getState().workspaces
            .flatMap((workspace) => workspace.tabs)
            .find((tab) => tab.id === tabId);
          if (renamedTab?.resourceId) workbenchStore.updateResource(renamedTab.resourceId, { uri, title: file.name });
          setMarkdownTreeRevision((current) => current + 1);
        },
      },
    },
    panels: aster.workbenchPanels.list(),
    libraryPanel: {
      paper: selectedPaper,
      aiThreadContexts: selectedPaper ? getAiThreadContextsForPaper(selectedPaper.paperId) : [],
      onOpen: () => setLibraryDetailOpen(true),
      onOpenReader: () => selectedPaper && openReaderForPaper(selectedPaper.paperId),
      onOpenRelations: () => selectedPaper && openReaderRelationsForPaper(selectedPaper.paperId),
      onOpenTranslationImport: importTranslatedPdf,
      onRevealSourcePdf: () => void revealSelectedPaperFile('source'),
      onRevealTranslatedPdf: () => void revealSelectedPaperFile('translated'),
      onOpenSourcePdfExternal: () => void openSelectedPaperFile('source'),
      onOpenTranslatedPdfExternal: () => void openSelectedPaperFile('translated'),
      onOpenMetadataEdit: () => setMetadataEditOpen(true),
      onOpenTagsEdit: () => setTagsEditOpen(true),
      onCopyBibtex: () => void copySelectedBibtex(),
      stateBusy: selectedPaper ? paperState.busyIds.has(selectedPaper.paperId) : false,
      onToggleRead: () => { if (selectedPaper) paperState.update(selectedPaper.paperId, 'read'); },
      onToggleFavorite: () => { if (selectedPaper) paperState.update(selectedPaper.paperId, 'favorite'); },
    },
    readerPanel: {
      onOpen: (tab) => {
        setReaderSidePanelTab(tab);
        setReaderSidePanelOpen(true);
      },
      aiThreadContexts: selectedPaper ? getAiThreadContextsForPaper(selectedPaper.paperId) : [],
      fileMode: readerFileMode === 'parallel' ? readerActiveFileKind : readerFileMode,
      translatedFileId: readerTranslatedFileId,
      focusedAnnotationId: readerFocusedAnnotationId,
      noteDraftPatch,
      onNoteDraftPatchConsumed: () => setNoteDraftPatch(null),
      onNoteSave: saveNote,
      onCreateNote: createNoteAndSwitch,
      onFocusAnnotation: setReaderFocusedAnnotationId,
      onUpdateAnnotationComment: updateAnnotationComment,
      onUpdateAnnotationPosition: updateAnnotationPosition,
      onUpdateAnnotationColor: updateAnnotationColor,
      onDeleteAnnotation: deleteAnnotation,
      onAppendAnnotationToNote: appendAnnotationToNote,
      onNavigateAnnotation: (annotationId) => {
        const annotation = selectedPaper?.annotations.find((item) => item.id === annotationId);
        if (!annotation || !selectedPaper) return;
        setReaderRequestedPage(annotation.page);
        setReaderFocusedAnnotationId(annotationId);
      },
      onNavigateRelationTarget: (target) => {
        if (!target) return;
        if (target.kind === 'ai_thread') setReaderSidePanelTab('chat');
        if (target.kind === 'annotation') {
          setReaderRequestedPage(target.page ?? null);
          setReaderFocusedAnnotationId(target.annotationId);
          setReaderSidePanelTab('annotations');
        }
      },
    },
    readerResource: {
      onStateChange: (tabId, state) => workbenchStore.updateTabState(tabId, state),
    },
  };
  const sceneUiContributions = useMemo(
    () => createBuiltinSceneUiContributions(builtinSceneUiRuntimeProxy),
    [builtinSceneUiRuntimeProxy, pluginRuntimeVersion],
  );
  const resolvedSceneUi = useMemo(
    () => resolveSceneUiContributions(
      {
        views: aster.sceneViews.list(),
        sidebars: aster.sceneSidebars.list(),
        panels: aster.workbenchPanels.list(),
        resourceOpeners: aster.resourceOpeners.list(),
      },
      sceneUiContributions,
      (pluginId) => aster.plugins.has(pluginId),
    ),
    [pluginRuntimeVersion, sceneUiContributions],
  );
  // Surface broken plugin/UI bindings in diagnostics instead of leaving a
  // silent placeholder that gives no indication which contribution failed.
  useEffect(() => {
    if (resolvedSceneUi.diagnostics.length > 0) {
      console.warn('[scene-ui] unresolved plugin contributions', resolvedSceneUi.diagnostics);
    }
  }, [resolvedSceneUi.diagnostics.join('|')]);
  const workbenchPanelViewRegistry = useMemo(
    () => createWorkbenchPanelViewRegistry(resolvedSceneUi.panelViews),
    [resolvedSceneUi.panelViews],
  );
  workbenchPanelViewRegistryRef.current = workbenchPanelViewRegistry;
  const sceneViewRegistry = useMemo(() => {
    // The resolver is authoritative when a live registration exists. Include
    // active first-party candidates as a startup bridge for old persisted
    // workspaces whose registration event happened before the React host was
    // mounted. The scene-id map also prevents duplicate registry entries.
    const viewsByScene = new Map(resolvedSceneUi.views.map((view) => [view.sceneId, view]));
    for (const view of sceneUiContributions.views) {
      if (!aster.plugins.has(view.pluginId) || viewsByScene.has(view.sceneId)) continue;
      viewsByScene.set(view.sceneId, view);
    }
    return createSceneViewRegistry(Array.from(viewsByScene.values()));
  }, [resolvedSceneUi.views, sceneUiContributions.views]);
  const sceneSidebarViewRegistry = useMemo(() => {
    const sidebarsById = new Map(resolvedSceneUi.sidebars.map((sidebar) => [sidebar.id, sidebar]));
    for (const sidebar of sceneUiContributions.sidebars) {
      if (!aster.plugins.has(sidebar.pluginId) || sidebarsById.has(sidebar.id)) continue;
      sidebarsById.set(sidebar.id, sidebar);
    }
    return createSceneSidebarViewRegistry(Array.from(sidebarsById.values()));
  }, [resolvedSceneUi.sidebars, sceneUiContributions.sidebars]);
  const resourceViewRegistry = useMemo(() => createResourceViewRegistry(resolvedSceneUi.resourceViews), [resolvedSceneUi.resourceViews]);
  // Keep first-party adapters available during workspace restoration. Older
  // persisted tabs can briefly render before the lifecycle event that caused
  // the resolver snapshot arrives; this fallback still checks the owning
  // plugin, so it cannot revive a disabled plugin's UI.
  const resolveSceneViewForRender = (sceneId: string) => {
    const resolved = sceneViewRegistry.get(sceneId);
    if (resolved) return resolved;
    const fallback = sceneUiContributions.views.find((view) => view.sceneId === sceneId);
    return fallback && aster.plugins.has(fallback.pluginId) ? fallback : undefined;
  };
  const resolveSceneSidebarForRender = (panelId: string, sceneId: string) => {
    const resolved = sceneSidebarViewRegistry.get(panelId);
    if (resolved) return resolved;
    const fallback = sceneUiContributions.sidebars.find((sidebar) => sidebar.id === panelId && sidebar.sceneId === sceneId);
    return fallback && aster.plugins.has(fallback.pluginId) ? fallback : undefined;
  };
  const activeSidebarSceneId = sidebarSceneId;
  const activeSidebarScene = activeSidebarSceneId ? sceneCatalog.find((candidate) => candidate.id === activeSidebarSceneId) : undefined;
  const activeSidebarView = activeSidebarScene?.defaultSidebarPanel
    ? resolveSceneSidebarForRender(activeSidebarScene.defaultSidebarPanel, activeSidebarScene.id)
    : undefined;
  const activeSceneUsesWorkspaceSidebar = activeSidebarScene?.sidebarMode === 'workspace';
  // Every scene-owned sidebar is rendered through the contribution registry.
  // Contextual sidebars follow the workspace layout; a scene workspace is
  // explicitly opened by selecting that scene (or its resource) and replaces
  // the scene navigator for the left column.
  const contextualSidebar = activeSidebarView && activeWorkspaceRecord && (
    activeSceneUsesWorkspaceSidebar
      ? sidebarWorkspaceOpen
      : activeWorkspaceRecord.layout.fileTreeVisible
  )
    ? activeSidebarView.render({ sceneId: activeSidebarSceneId ?? activeSidebarView.sceneId, panelId: activeSidebarView.id })
    : null;
  const sidebarTreeVisible = activeSceneUsesWorkspaceSidebar
    ? sidebarWorkspaceOpen
    : Boolean(activeSidebarView && activeWorkspaceRecord?.layout.fileTreeVisible);

  const refreshSyncSettings = async (patch: Partial<SyncSettingsState> = {}) => {
    if (!isTauriRuntime()) return;
    try {
      const [state, outbox] = await Promise.all([loadSyncState(), loadSyncOutbox(200)]);
      setSyncState((current) => ({
        ...current,
        ...patch,
        supported: true,
        pendingOperations: outbox.length,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
      }));
    } catch (error) {
      setSyncState((current) => ({ ...current, ...patch, lastError: error instanceof Error ? error.message : String(error) }));
    }
  };

  const loginSync = async (username: string, password: string) => {
    if (!isTauriRuntime() || !username.trim() || !password) return;
    setSyncState((current) => ({ ...current, busy: true, lastError: undefined }));
    try {
      const result = await syncApi.login(username.trim(), password);
      setSyncUser(result.user);
      await refreshSyncSettings({ authenticated: true, username: result.user.username, busy: false });
    } catch (error) {
      setSyncState((current) => ({ ...current, busy: false, lastError: error instanceof Error ? error.message : String(error) }));
    }
  };

  const logoutSync = async () => {
    setSyncState((current) => ({ ...current, busy: true }));
    try {
      await syncApi.logout();
    } finally {
      setSyncUser(null);
      setSyncState({ supported: isTauriRuntime(), authenticated: false, pendingOperations: 0, busy: false });
    }
  };

  const runSync = async () => {
    if (!isTauriRuntime() || !syncUser) return;
    setSyncState((current) => ({ ...current, busy: true, lastError: undefined }));
    try {
      const summary = await syncCoordinator.runOnce();
      await refreshSyncSettings({ busy: false, lastError: undefined, lastSuccessAt: new Date().toISOString() });
      setLibraryStatus(`同步完成：上传 ${summary.pushed}，拉取 ${summary.pulled}`);
      await refreshNativeDocuments(undefined, true);
    } catch (error) {
      await refreshSyncSettings({ busy: false, lastError: error instanceof Error ? error.message : String(error) });
    }
  };

  const refreshPluginMarket = async () => {
    const url = pluginMarket.url.trim();
    if (!url) return;
    setPluginMarket((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const index = await fetchPluginMarketIndex(url);
      const fetchedAt = new Date().toISOString();
      savePluginMarketCache({ url, fetchedAt, index });
      setPluginMarket({ url, fetchedAt, generatedAt: index.generatedAt, records: index.records, loading: false });
    } catch (error) {
      setPluginMarket((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const importPluginPackage = async () => {
    if (!isTauriRuntime()) {
      setPluginMarket((current) => ({ ...current, error: '插件包导入仅支持桌面版。' }));
      return;
    }
    const packagePath = await selectPluginPackage();
    if (!packagePath) return;
    try {
      const preview: TextFilePreview = await readTextFilePreview(packagePath);
      if (preview.binary || preview.truncated) throw new Error('插件包必须是可完整读取的 JSON 包。');
      const envelope = parsePluginPackageEnvelope(JSON.parse(preview.content));
      const officialRecord = pluginMarket.records.find((record) =>
        record.id === envelope.manifest.id && record.version === envelope.manifest.version && record.signer === envelope.manifest.signer,
      );
      if (!officialRecord?.publicKey || officialRecord.integritySha256 !== envelope.manifest.integritySha256) {
        throw new Error('插件不在当前官方市场索引中，或包版本与官方摘要不一致。');
      }
      const importPolicy = pluginMarket.records.reduce((policy, record) => {
        return record.publicKey ? rotateTrustedKey(policy, record.signer, record.publicKey) : policy;
      }, defaultPluginSecurityPolicy);
      const verified = await verifyPluginPackage(envelope.payload, envelope.manifest, importPolicy);
      if (!verified) throw new Error('插件签名或完整性校验失败，或签名者不在官方信任列表中。');
      const imported: LocalPluginSummary = {
        id: envelope.manifest.id,
        name: envelope.manifest.name,
        version: envelope.manifest.version,
        trust: 'trusted',
        source: 'local',
        packagePath,
        status: 'verified',
        enabled: true,
        payload: envelope.payload,
        permissions: envelope.manifest.permissions,
        distribution: envelope.manifest.distribution === 'market' ? 'market' : 'local',
        integritySha256: envelope.manifest.integritySha256,
        signature: envelope.manifest.signature,
        signer: envelope.manifest.signer,
      };
      // The payload has already passed market/signature/integrity checks. The
      // core still validates the declarative protocol before registering it.
      // An existing package id is an update and must use the reload lifecycle.
      aster.reloadDeclarativePlugin(envelope.manifest, envelope.payload);
      setLocalPlugins((current) => {
        const next = [...current.filter((plugin) => plugin.id !== imported.id), imported];
        saveLocalPlugins(next);
        return next;
      });
      setPluginMarket((current) => ({ ...current, error: undefined }));
    } catch (error) {
      setPluginMarket((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  /** Toggle plugin lifecycle without changing scene-entry visibility. */
  const toggleScenePlugin = (pluginId: string, enabled: boolean) => {
    const pluginSceneIds = Array.from(sceneDefinitionsRef.current.values())
      .filter((scene) => scene.pluginId === pluginId)
      .map((scene) => scene.id);
    // Capture ownership before disposal: once an opener is removed, its
    // resource kind may resolve to another active scene and would otherwise
    // escape cleanup during plugin deactivation.
    const pluginOpenerIds = new Set(
      aster.resourceOpeners.list()
        .filter((opener) => opener.pluginId === pluginId)
        .map((opener) => opener.id),
    );
    // A plugin owns tabs in every workspace, not only the currently active one.
    // Capture the complete set before disposal because opener/scene lookup is
    // intentionally lifecycle-aware and would stop resolving after disable.
    const ownedTabIds = !enabled
      ? workbenchStore.getState().workspaces
        .flatMap((workspace) => workspace.tabs)
        .filter((tab) => pluginSceneIds.includes(sceneForWorkspaceTab(tab) ?? '')
          || pluginOpenerIds.has(tabStateString(tab, 'openerId'))
          || (tab.kind.startsWith('plugin:') && tab.kind.slice('plugin:'.length) === pluginId))
        .map((tab) => tab.id)
      : [];
    const fallback = !enabled && activeScene && pluginSceneIds.includes(activeScene)
      ? aster.scenes.list().find((scene) => !pluginSceneIds.includes(scene.id) && (!scene.pluginId || aster.plugins.has(scene.pluginId)))
      : undefined;
    if (!aster.setPluginEnabled(pluginId, enabled)) return false;
    setLocalPlugins((current) => {
      const next = current.map((plugin) => plugin.id === pluginId ? { ...plugin, enabled } : plugin);
      if (next.some((plugin) => plugin.id === pluginId)) saveLocalPlugins(next);
      return next;
    });
    setDisabledPluginIds((current) => enabled
      ? current.filter((id) => id !== pluginId)
      : (current.includes(pluginId) ? current : [...current, pluginId]));
    if (!enabled) {
      ownedTabIds.forEach((tabId) => workbenchStore.closeTab(tabId));
      if (pluginSceneIds.includes('library')) setLibraryDetailOpen(false);
      if (pluginSceneIds.includes('reader')) setReaderSidePanelOpen(false);
      if (fallback) setScene(fallback.id);
    }
    setPluginRuntimeVersion((current) => current + 1);
    return true;
  };

  const settingsNode = (
    <div className="workbench-overlay" role="region" aria-label={zh.scenes.settings}>
      <SettingsScene
        settings={settings}
        initialSection={settingsSection}
        pluginSettings={pluginSettingContributions}
        pluginSettingValues={pluginSettingValues}
        paths={asterPaths}
        diagnostics={appDiagnostics}
        aiProviders={settingsAiProviders}
        providers={settingsProviders}
        plugins={settingsPlugins}
        extensionCounts={settingsExtensionCounts}
        scenes={sceneSettingsCatalog}
        enabledSceneIds={visibleSceneIds}
        sync={syncState}
        onChange={setSettings}
        onToggleScene={(sceneId, enabled) => {
          const scene = sceneDefinitionsRef.current.get(sceneId);
          if (!scene?.pluginId) return;
          try {
            toggleScenePlugin(scene.pluginId, enabled);
          } catch (error) {
            console.error('Scene plugin state change failed', error);
            setLibraryStatus('场景插件状态切换失败');
          }
        }}
        onTogglePlugin={(pluginId, enabled) => {
          try {
            toggleScenePlugin(pluginId, enabled);
          } catch (error) {
            console.error('Plugin state change failed', error);
            setLibraryStatus('插件状态切换失败。');
          }
        }}
        onSync={runSync}
        onSyncLogin={loginSync}
        onSyncLogout={logoutSync}
        onPluginSettingChange={(settingId, value) => setPluginSettingValues((current) => ({ ...current, [settingId]: value }))}
        onRefreshPaths={() => {
          void getAsterPaths().then(setAsterPaths);
          void getAppDiagnostics().then(setAppDiagnostics);
        }}
        onRevealPath={(kind) => revealAsterPath(kind)}
        onCreateBackup={async () => { await flushPendingSaves(); return createLibraryBackup(); }}
        onRestoreBackup={restoreBackupFromSettings}
        market={pluginMarket}
        onMarketUrlChange={(url) => setPluginMarket((current) => ({ ...current, url, error: undefined }))}
        onRefreshMarket={refreshPluginMarket}
        localPlugins={localPlugins}
        onImportPlugin={importPluginPackage}
      />
    </div>
  );
  const dialogsNode = (
    <>
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
      {restoreRestartPath && <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.4)' }} onKeyDownCapture={(event) => event.stopPropagation()}>
        <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-restart-title" style={{ background: 'var(--bg-primary, white)', padding: 24, maxWidth: 560, borderRadius: 12 }}>
          <h2 id="restore-restart-title">恢复完成，请重启应用</h2>
          <p>旧会话已停止写入，避免自动保存覆盖恢复的数据。重启后继续使用。</p>
          <p style={{ overflowWrap: 'anywhere' }}>恢复前安全备份：{restoreRestartPath}</p>
          <button type="button" autoFocus onClick={() => void restartAfterLibraryRestore().catch((error) => window.alert(`重启失败，请手动关闭并重新打开应用：${String(error)}`))}>重启应用</button>
        </section>
      </div>}
    </>
  );

  const resolveResourceContextForTab = (tab: WorkspaceTab) => {
    const openerId = tabStateString(tab, 'openerId');
    const uri = tabStateString(tab, 'uri', tabStateString(tab, 'path'));
    const resourceKind = tabStateString(tab, 'resourceKind', tab.kind);
    const sceneId = sceneForWorkspaceTab(tab);
    // A persisted opener id is authoritative. Do not fall back to URI matching
    // when it has disappeared, otherwise disabling a plugin could route an old
    // tab into a different plugin that happens to handle the same extension.
    const opener = openerId
      ? aster.resourceOpeners.get(openerId)
      : (uri ? resourceOpenerForUri(uri, resourceKind) : undefined);
    const view = opener ? resourceViewRegistry.get(opener.id) : undefined;
    return { openerId, uri, resourceKind, sceneId, opener, view };
  };

  /** One tab kind per branch; resource tabs are routed through plugin adapters. */
  const renderTabContent = (tab: WorkspaceTab): ReactNode => {
    if (tab.kind === 'tool') {
      const scene = sceneFromToolTabKey(tab.key);
      const sceneView = scene ? resolveSceneViewForRender(scene) : undefined;
      if (scene && sceneView) return sceneView.render({ sceneId: scene, tab });
      const contribution = scene ? sceneDefinitions.find((candidate) => candidate.id === scene) : undefined;
      const diagnostic = scene
        ? resolvedSceneUi.diagnostics.find((entry) => entry.includes(`(${scene})`))
        : undefined;
      const description = contribution?.pluginId && !aster.plugins.has(contribution.pluginId)
        ? '此场景所属插件已停用，请在设置中重新启用。'
        : '此插件场景已安装，但视图贡献尚未接入。';
      return <EmptyScene title={contribution?.label ?? '插件场景'} description={description} action="返回总览" onAction={() => setScene('overview')} />;
    }
    if (tab.kind === 'agent' && tab.sessionId) {
      const session = workbench.agentSessions.find((candidate) => candidate.id === tab.sessionId);
      if (!session) return null;
      return (
        <AgentSessionPanel
          session={session}
          provider={agentProviders.find((provider) => provider.id === session.providerId) ?? null}
          detecting={agentProvidersLoading}
          onPermissionModeChange={(mode: AgentPermissionMode) => workbenchStore.updateAgentSession(session.id, { permissionMode: mode })}
          onStatusChange={(status) => workbenchStore.updateAgentSession(session.id, { status })}
          onProviderSessionId={(providerSessionId) => workbenchStore.updateAgentSession(session.id, { providerSessionId })}
          onRedetect={() => void refreshAgentProviders()}
          onRemove={() => confirmRemoveAgentSession(session.id, tab.title)}
          resources={workbenchResources}
        />
      );
    }
    if (isResourceWorkspaceTabKind(tab.kind)) {
      const resource = resolveResourceContextForTab(tab);
      if (resource.opener && resource.view) {
        return resource.view.render({ opener: resource.opener, tab, sceneId: sceneForWorkspaceTab(tab) });
      }
      // A plain file without an opener is intentionally the only host-owned
      // fallback. PDF/Markdown and plugin tabs expose a diagnostic when their
      // owning plugin or adapter is unavailable.
      if (tab.kind === 'file' && !resource.openerId && !resource.opener) {
        return <FileTab path={tabStateString(tab, 'path')} name={tabStateString(tab, 'name', tab.title)} />;
      }
      const ownerPluginId = resource.opener?.pluginId
        ?? (resource.sceneId ? sceneDefinitionsRef.current.get(resource.sceneId)?.pluginId : undefined)
        ?? (tab.kind.startsWith('plugin:') ? tab.kind.slice('plugin:'.length) : undefined);
      const disabled = ownerPluginId ? !aster.plugins.has(ownerPluginId) : false;
      const diagnostic = resource.openerId && resolvedSceneUi.missingResourceViewIds.includes(resource.openerId)
        ? `Resource opener ${resource.openerId} has no active host view adapter.`
        : disabled
          ? `Plugin ${ownerPluginId} is disabled. Re-enable it in Settings to restore this resource.`
          : resource.openerId
            ? `Resource opener ${resource.openerId} is unavailable.`
            : 'No resource opener is registered for this tab.';
      return (
        <EmptyScene
          title={tab.title || 'Plugin resource'}
          description={diagnostic}
          action="Return to Overview"
          onAction={() => setScene('overview')}
        />
      );
    }
    if (tab.kind === 'terminal') {
      return <TerminalResourceTab cwd={tabStateString(tab, 'cwd', tabStateString(tab, 'path'))} name={tabStateString(tab, 'name', tab.title)} />;
    }
    if (tab.kind === 'diff') {
      return <DiffResourceTab leftPath={tabStateString(tab, 'leftPath')} rightPath={tabStateString(tab, 'rightPath')} name={tabStateString(tab, 'name', tab.title)} />;
    }
    return null;
  };

  const sidebarOpenItems: SidebarOpenItem[] = workspaceTabs
    // Resource files are navigated from the file directory. Keep their tabs
    // mounted in the host so switching files preserves state, but do not show
    // them as children of an unrelated scene such as Overview. Reader tabs are
    // owned by the Reader workspace sidebar, so they must not be duplicated
    // beneath the global scene navigator.
    .filter((tab) => sceneForWorkspaceTab(tab) !== 'reader' && (tab.kind !== 'file' && tab.kind !== 'markdown') && (tab.kind !== 'tool' || Boolean(paperIdFromReaderTabKey(tab.key))))
    .map((tab) => ({
      id: tab.id,
      sceneId: sceneForWorkspaceTab(tab) ?? 'overview',
      title: tab.title,
      hint: tab.kind === 'file' || tab.kind === 'pdf' ? tabStateString(tab, 'path', tab.title) : tab.title,
    }));

  const hostItems: TabHostItem[] = workspaceTabs.map((tab) => ({ id: tab.id, content: renderTabContent(tab) }));
  const hostActiveTabId = activeFileTabId ?? activeTab?.id ?? null;

  return (
    <WorkbenchShell
      sidebar={
        <ProjectSidebar
          labels={zh.workbench}
          projects={workbench.projects}
          workspaces={workbench.workspaces}
          sessions={workbench.agentSessions}
          activeProjectId={activeProject?.id ?? null}
          activeWorkspaceId={activeWorkspaceRecord?.id ?? null}
          scenes={sidebarScenes}
          selectedSceneIds={visibleSceneIds}
          activeSceneId={activeScene}
          activeOpenItemId={activeTab && sidebarOpenItems.some((item) => item.id === activeTab.id) ? activeTab.id : null}
          openItems={sidebarOpenItems}
          addProjectPending={addProjectPending}
          settingsActive={settingsOpen}
          commandIcon={<CommandIcon />}
          settingsIcon={<SettingsGlyph size={16} strokeWidth={1.9} aria-hidden="true" />}
          contextualSidebar={contextualSidebar}
          contextualSidebarLabel={activeSidebarScene?.label}
          sidebarWorkspaceOpen={sidebarWorkspaceOpen && Boolean(activeSceneUsesWorkspaceSidebar)}
          onOpenScene={setScene}
          onToggleScene={(sceneId) => {
            setVisibleSceneIds((current) => {
              const selectedSceneId = sceneId;
              const next = current.includes(selectedSceneId) ? current.filter((id) => id !== selectedSceneId) : [...current, selectedSceneId];
              return next.length > 0 ? next : current;
            });
          }}
          onSelectAllScenes={() => setVisibleSceneIds(availableSceneIds)}
          onSelectOpenItem={(tabId) => {
            setSettingsOpen(false);
            setActiveFileTabId(null);
            const tab = workspaceTabs.find((candidate) => candidate.id === tabId);
            const readerPaperId = tab ? paperIdFromReaderTabKey(tab.key) : null;
            if (readerPaperId) focusReaderPaper(readerPaperId);
            workbenchStore.setActiveTab(tabId);
          }}
          onCloseOpenItem={closeWorkspaceTab}
          onAddProject={() => void addProjectFolder()}
          onActivateWorkspace={(workspaceId) => workbenchStore.activateWorkspace(workspaceId)}
          onCreateWorkspace={(projectId) => workbenchStore.createWorkspace({ projectId })}
          onRenameWorkspace={(workspaceId, name) => workbenchStore.renameWorkspace(workspaceId, name)}
          onRemoveProject={confirmRemoveProject}
          onRemoveWorkspace={confirmRemoveWorkspace}
          onOpenCommandPalette={openCommandPalette}
          onOpenSettings={() => {
            setSettingsSection('general');
            setSettingsOpen((current) => !current);
          }}
        />
      }
      topBar={
        <WorkbenchTopBar
          labels={zh.workbench}
          project={activeProject}
          workspace={activeWorkspaceRecord}
          workspaces={workbench.workspaces}
          fileTreeVisible={sidebarTreeVisible}
          canToggleFileTree={Boolean(activeSidebarView && activeWorkspaceRecord)}
          canBrowseFolder={Boolean(folderProjectPath) || Boolean(activeSidebarView)}
          providers={agentProviders}
          providersLoading={agentProvidersLoading}
          status={libraryStatus && activeScene !== 'library' ? <span className="workbench-status-text">{libraryStatus}</span> : null}
          onToggleFileTree={toggleFileTree}
          onOpenInVSCode={() => folderProjectPath && void openPathInVSCode(folderProjectPath)}
          onRevealFolder={() => folderProjectPath && void revealPath(folderProjectPath)}
          onCreateAgentSession={createAgentSessionTab}
          onActivateWorkspace={(workspaceId) => workbenchStore.activateWorkspace(workspaceId)}
          onCreateWorkspace={(projectId) => workbenchStore.createWorkspace({ projectId })}
          onRemoveWorkspace={confirmRemoveWorkspace}
        />
      }
      explorer={null}
      content={
        <TabHost
          items={hostItems}
          activeTabId={hostActiveTabId}
          fallback={
            activeWorkspaceRecord ? (
              <EmptyScene
                title={zh.workbench.noTabTitle}
                description={zh.workbench.noTabDescription}
                action={sceneLabelFor('library')}
                onAction={() => setScene('library')}
              />
            ) : (
              <EmptyScene
                title={zh.workbench.noWorkspaceTitle}
                description={zh.workbench.noWorkspaceDescription}
                action={zh.workbench.addProject}
                onAction={() => void addProjectFolder()}
              />
            )
          }
        />
      }
      overlay={settingsOpen ? settingsNode : null}
      dialogs={dialogsNode}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      leadingAction={sidebarWorkspaceOpen && activeSceneUsesWorkspaceSidebar ? (
        <button
          type="button"
          className="window-titlebar-leading-action-button"
          title={zh.workbench.backToScenes}
          aria-label={zh.workbench.backToScenes}
          onClick={() => setSidebarWorkspaceOpen(false)}
        >
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          <span>{zh.workbench.backToScenes}</span>
        </button>
      ) : null}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={setSidebarWidth}
    />
  );
}

function loadDisabledPluginIds() {
  try {
    const raw = localStorage.getItem('aster.disabledPlugins');
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string'))) : [];
  } catch {
    return [];
  }
}

function seedLibraryFolders(documents: PaperDocument[]): LibraryFolder[] {
  const knownNames: Record<string, string> = { library: '默认资料库', method: '方法类', writing: '写作素材' };
  const folders = new Map<string, LibraryFolder>();
  documents.forEach((paper) => {
    const folderId = paper.folderId || 'library';
    if (!folders.has(folderId)) folders.set(folderId, { folderId, name: knownNames[folderId] ?? folderId, parentId: 'library', paperCount: 0 });
    const folder = folders.get(folderId)!;
    folder.paperCount = (folder.paperCount ?? 0) + 1;
  });
  const root = folders.get('library') ?? { folderId: 'library', name: '默认资料库', parentId: null, paperCount: 0 };
  root.parentId = null;
  folders.set('library', root);
  return Array.from(folders.values());
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
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { interfaceFontSize?: number | string };
    const legacyInterfaceSizes: Record<string, number> = { small: 13, medium: 14, large: 15 };
    const rawInterfaceFontSize = typeof parsed.interfaceFontSize === 'number' && Number.isFinite(parsed.interfaceFontSize)
      ? parsed.interfaceFontSize
      : legacyInterfaceSizes[String(parsed.interfaceFontSize)] ?? defaultSettings.interfaceFontSize;
    const interfaceFontSize = Math.min(32, Math.max(10, rawInterfaceFontSize));
    return { ...defaultSettings, ...parsed, interfaceFontSize };
  } catch {
    return defaultSettings;
  }
}

function clampSettingNumber(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function saveAppSettings(settings: AppSettings) {
  localStorage.setItem('aster.settings', JSON.stringify(settings));
}

function loadSidebarCollapsed() {
  try {
    return localStorage.getItem('aster.sidebarCollapsed') === 'true';
  } catch {
    return false;
  }
}

function loadSidebarWidth() {
  try {
    const parsed = Number(localStorage.getItem('aster.sidebarWidth'));
    return Number.isFinite(parsed) ? clampNumber(parsed, WORKBENCH_SIDEBAR_MIN_WIDTH, WORKBENCH_SIDEBAR_MAX_WIDTH) : WORKBENCH_SIDEBAR_MIN_WIDTH;
  } catch {
    return WORKBENCH_SIDEBAR_MIN_WIDTH;
  }
}

function loadLocalPlugins(): LocalPluginSummary[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('aster.localPlugins') ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is LocalPluginSummary => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.packagePath === 'string')) : [];
  } catch {
    return [];
  }
}

function saveLocalPlugins(plugins: LocalPluginSummary[]) {
  localStorage.setItem('aster.localPlugins', JSON.stringify(plugins));
}

function loadPluginSettingValues(settings: Map<string, SettingContribution>): PluginSettingValues {
  const defaults = defaultPluginSettingValues(settings);
  try {
    const raw = localStorage.getItem('aster.pluginSettings');
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    if (!Object.hasOwn(parsed, 'markdown.documentFontSize')) {
      const legacySettings = JSON.parse(localStorage.getItem('aster.settings') ?? '{}') as { documentFontSize?: number | string };
      const legacyDocumentSizes: Record<string, number> = { small: 18, medium: 20, large: 22 };
      const legacyValue = legacySettings.documentFontSize;
      if (typeof legacyValue === 'number' && Number.isFinite(legacyValue)) parsed['markdown.documentFontSize'] = legacyValue;
      else if (typeof legacyValue === 'string' && legacyDocumentSizes[legacyValue]) parsed['markdown.documentFontSize'] = legacyDocumentSizes[legacyValue];
    }
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
  const lines = ['# A4 Note Library Export', '', `Count: ${papers.length}`, ''];
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

function SceneIcon({ id }: { id: string }) {
  if (id === 'overview') return <LayoutDashboard />;
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
