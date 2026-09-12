export type SceneId = 'overview' | 'library' | 'reader' | 'aiChat' | 'markdown';
export type SceneScope = 'research' | 'workspace' | 'custom';
export type SceneSource = 'builtin' | `plugin:${string}`;
/**
 * Controls how a scene-owned sidebar is placed in the workbench. `scene`
 * keeps the scene navigator visible, `contextual` appends the sidebar below
 * it, and `workspace` replaces the navigator with the scene's own workspace.
 */
export type SceneSidebarMode = 'scene' | 'contextual' | 'workspace' | 'none';
export type ReaderLayout = 'focus' | 'note' | 'ai';
export type ReaderSidePanelTab = 'notes' | 'chat' | 'cite' | 'annotations' | 'relations';
export type AnnotationType = 'highlight' | 'comment' | 'underline' | 'area' | 'text' | 'ink' | 'rect' | 'arrow';
export type ReaderTool = 'cursor' | 'eraser' | AnnotationType;
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'purple' | `#${string}`;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type PositionJson = Record<string, JsonValue>;
export type ObjectType =
  | 'paper'
  | 'pdf_file'
  | 'note'
  | 'annotation'
  | 'excerpt'
  | 'topic'
  | 'project'
  | 'course'
  | 'web_clip'
  | 'ai_thread'
  | 'ai_message'
  | 'plugin_object';
export type RelationType =
  | 'contains'
  | 'attached_file'
  | 'has_note'
  | 'annotates'
  | 'excerpted_from'
  | 'cites'
  | 'links_to'
  | 'related_to'
  | 'generated_from'
  | 'discusses'
  | 'tagged_with'
  | 'derived_from'
  | 'version_of';
export type RelationDirection = 'directed' | 'bidirectional';

export interface KnowledgeObject {
  id: string;
  type: ObjectType;
  title: string;
  summary?: string;
  metadata: Record<string, JsonValue>;
  source: 'sqlite' | 'seed' | 'manual' | 'ai' | 'builtin' | `plugin:${string}`;
  createdAt?: string;
  updatedAt?: string;
}

export interface Relation {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  type: RelationType;
  direction: RelationDirection;
  metadata: Record<string, JsonValue>;
  createdBy: 'user' | 'system' | 'ai' | `plugin:${string}`;
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeGraphSnapshot {
  rootObjectId: string;
  objects: KnowledgeObject[];
  relations: Relation[];
}

export interface SceneContribution {
  /** Built-in ids are stable; plugins may contribute their own namespaced ids. */
  id: string;
  label: string;
  icon: string;
  key: string;
  pluginId?: string;
  scope?: SceneScope;
  source?: SceneSource;
  enabledByDefault?: boolean;
  /** Whether the scene owns persistent/open document items below its entry. */
  supportsOpenItems?: boolean;
  /** How the workbench should place the scene's sidebar contribution. */
  sidebarMode?: SceneSidebarMode;
  /** Optional contribution id for the scene-specific sidebar panel. */
  defaultSidebarPanel?: string;
  /** Resource kinds that this scene can open or provide contextual navigation for. */
  resourceKinds?: string[];
}

/**
 * Serializable, host-rendered UI for verified third-party plugins.  The
 * payload is deliberately a small data protocol rather than executable
 * React/HTML so a signed plugin cannot inject arbitrary code into the app.
 */
export type PluginViewBlock =
  | { type: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'link'; text: string; href: string };

export interface DeclarativeViewRenderer {
  kind: 'declarative';
  title?: string;
  description?: string;
  blocks: PluginViewBlock[];
}

/** React-free identity for a scene's main view. The UI host resolves the id to
 * a renderer, while the plugin lifecycle owns registration and disposal. */
export interface SceneViewRegistration {
  id: string;
  sceneId: string;
  pluginId: string;
  renderer?: DeclarativeViewRenderer;
}

/** React-free identity for a scene-owned contextual sidebar. */
export interface SceneSidebarRegistration {
  id: string;
  sceneId: string;
  pluginId: string;
  renderer?: DeclarativeViewRenderer;
}

export type WorkbenchArea = 'left' | 'right' | 'bottom' | 'center';
export type WorkbenchPanelSource = 'core' | `plugin:${string}`;
export type WorkbenchPanelContext = 'global' | 'paper' | 'selection' | 'workspace';
export type WorkbenchPanelId =
  | 'library.details'
  | 'reader.notes'
  | 'reader.annotations'
  | 'reader.chat'
  | 'reader.relations'
  | 'reader.cite'
  | `plugin:${string}`;

export interface WorkbenchPanelContribution {
  id: WorkbenchPanelId;
  sceneId: string;
  area: WorkbenchArea;
  commandId: string;
  titleKey: string;
  icon: string;
  order: number;
  source: WorkbenchPanelSource;
  context: WorkbenchPanelContext;
  defaultOpen?: boolean;
  renderer?: DeclarativeViewRenderer;
}

export interface WorkspaceLayoutState {
  sceneId: SceneId;
  activePanelId?: WorkbenchPanelId;
  openPanelIds: WorkbenchPanelId[];
  collapsedAreas: WorkbenchArea[];
}

export interface Note {
  id: string;
  paperId: string;
  title: string;
  content: string;
  format: 'markdown';
  updatedAt?: string;
}

export interface Annotation {
  id: string;
  paperId: string;
  /** Paper annotations use fileId; generic Resource annotations use resourceId. */
  fileId: string;
  resourceId?: string;
  page: number;
  type: AnnotationType;
  quote: string;
  comment: string;
  color: string;
  positionJson: PositionJson;
  createdAt?: string;
}

export interface AnnotationDraft {
  type: AnnotationType;
  quote: string;
  comment: string;
  color: string;
  positionJson: PositionJson;
}

export interface PaperDocument {
  paperId: string;
  title: string;
  authors: string;
  year: number | '';
  venue: string;
  doi: string;
  folderId: string;
  sourceFileId: string;
  sourcePdf: string;
  translatedFileIds: string[];
  translatedPdfs: string[];
  tags: string[];
  notes: Note[];
  annotations: Annotation[];
  aiThreads: string[];
  metadataSource: string;
  createdAt?: string;
  lastViewedAt?: string;
  isRead?: boolean;
  isFavorite?: boolean;
}

/** A persistent library folder. `parentId` is null for a top-level folder. */
export interface LibraryFolder {
  folderId: string;
  name: string;
  parentId: string | null;
  paperCount?: number;
}

export interface ImportDraft {
  title: string;
  authors: string;
  year: number | '';
  venue: string;
  doi: string;
  tags: string[];
  originalPath: string;
  sourceFileId?: string;
  libraryPath?: string;
  metadataSource: string;
  extractionSource?: 'pdf_text' | 'filename' | 'manual';
  extractionWarnings?: string[];
}

export interface Command<TPayload = unknown, TResult = unknown> {
  id: string;
  title: string;
  group?: string;
  source?: 'core' | `plugin:${string}`;
  shortcut?: string;
  visibleInPalette?: boolean;
  run: (payload: TPayload) => TResult;
}

export type EventHandler<TPayload = unknown> = (payload: TPayload) => void;

export interface SettingContribution {
  id: string;
  title: string;
  defaultValue: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  pluginId?: string;
  sceneId?: string;
  description?: string;
}

export interface ProviderContribution {
  id: string;
  name: string;
  enabledByDefault?: boolean;
}

export interface AiProviderContribution extends ProviderContribution {
  kind: 'local' | 'cli' | 'api';
  status: 'available' | 'planned' | 'disabled';
  description?: string;
  modelLabel?: string;
  supportsStreaming?: boolean;
  supportsContextObjects?: boolean;
}

export interface AiProviderRunRequest {
  provider: AiProviderContribution;
  paper: PaperDocument;
  graph: KnowledgeGraphSnapshot;
  prompt: string;
}

export interface AiProviderRunResult {
  providerId: string;
  content: string;
  fallbackUsed: boolean;
  usedContext: {
    rootObjectId: string;
    paperId: string;
    objectIds: string[];
    relationIds: string[];
    noteIds: string[];
    annotationIds: string[];
    tags: string[];
  };
}

export interface AiThreadContext {
  threadId: string;
  providerId: string;
  prompt: string;
  objectIds: string[];
  relationIds: string[];
  createdAt?: string;
}

export interface AsterPluginContext {
  /** Permissions granted by the host after manifest validation. */
  permissions: ReadonlySet<PluginPermission>;
  commands: {
    register: <TPayload, TResult>(command: Command<TPayload, TResult>) => () => void;
    execute: <TPayload, TResult>(commandId: string, payload: TPayload) => TResult;
    list: () => Command<any, any>[];
  };
  events: {
    on: <TPayload>(eventName: string, handler: EventHandler<TPayload>) => () => void;
  };
  settings: {
    register: (setting: SettingContribution) => () => void;
    /** Backward-compatible map-style registration for older built-in plugins. */
    set: (settingId: string, setting: SettingContribution) => () => void;
    list: () => SettingContribution[];
  };
  workbenchPanels: {
    register: (panel: WorkbenchPanelContribution) => () => void;
    list: () => WorkbenchPanelContribution[];
  };
  scenes: {
    register: (scene: SceneContribution) => () => void;
    list: () => SceneContribution[];
  };
  sceneViews: {
    register: (view: SceneViewRegistration) => () => void;
    get: (sceneId: string) => SceneViewRegistration | undefined;
    list: () => SceneViewRegistration[];
  };
  sceneSidebars: {
    register: (sidebar: SceneSidebarRegistration) => () => void;
    get: (panelId: string) => SceneSidebarRegistration | undefined;
    list: () => SceneSidebarRegistration[];
  };
  resourceOpeners: {
    register: (opener: ResourceOpenerContribution) => () => void;
    /** Read-only compatibility lookup for host diagnostics and older integrations. */
    get: (openerId: string) => ResourceOpenerContribution | undefined;
    has: (openerId: string) => boolean;
    list: () => ResourceOpenerContribution[];
  };
  metadataSources: Map<string, ProviderContribution>;
  translationSources: Map<string, ProviderContribution>;
  aiProviders: Map<string, AiProviderContribution>;
}

export interface AsterPlugin {
  id: string;
  name: string;
  manifest?: AsterPluginManifest;
  activate: (context: AsterPluginContext) => void | (() => void);
}

export type PluginPermission = 'commands' | 'events' | 'settings' | 'workbench' | 'providers' | 'resources' | 'scenes';

export interface AsterPluginManifest {
  id: string;
  name: string;
  version: string;
  permissions: PluginPermission[];
  distribution?: 'builtin' | 'local' | 'market';
  integritySha256?: string;
  signature?: string;
  signer?: string;
}

export function parsePluginManifest(input: unknown): AsterPluginManifest {
  if (typeof input !== 'object' || input === null) throw new Error('Plugin manifest must be an object');
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.version !== 'string' || !Array.isArray(raw.permissions)) {
    throw new Error('Plugin manifest requires id, name, version and permissions');
  }
  const manifest = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    permissions: raw.permissions,
    distribution: raw.distribution as AsterPluginManifest['distribution'],
    integritySha256: typeof raw.integritySha256 === 'string' ? raw.integritySha256 : undefined,
    signature: typeof raw.signature === 'string' ? raw.signature : undefined,
    signer: typeof raw.signer === 'string' ? raw.signer : undefined,
  };
  if (manifest.distribution !== undefined && manifest.distribution !== 'builtin' && manifest.distribution !== 'local' && manifest.distribution !== 'market') {
    throw new Error(`Unknown plugin distribution: ${manifest.id}`);
  }
  if (!/^[-a-z0-9]+(?:\.[-a-z0-9]+)*$/.test(manifest.id)) throw new Error(`Invalid plugin id: ${manifest.id}`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error(`Invalid plugin version: ${manifest.id}`);
  const allowed = new Set<PluginPermission>(['commands', 'events', 'settings', 'workbench', 'providers', 'resources', 'scenes']);
  const permissions = Array.from(new Set(manifest.permissions));
  if (permissions.some((permission): permission is string => typeof permission !== 'string' || !allowed.has(permission as PluginPermission))) throw new Error(`Unknown plugin permission: ${manifest.id}`);
  return { ...manifest, permissions: permissions as PluginPermission[] };
}

export function validatePluginManifest(plugin: AsterPlugin): AsterPluginManifest {
  const manifest = plugin.manifest ?? {
    id: plugin.id,
    name: plugin.name,
    version: '0.0.0-dev',
    permissions: ['commands', 'events', 'settings', 'workbench', 'providers', 'resources', 'scenes'] as PluginPermission[],
    distribution: 'builtin' as const,
  };
  const parsed = parsePluginManifest(manifest);
  if (parsed.id !== plugin.id || parsed.name !== plugin.name) throw new Error(`Plugin manifest identity mismatch: ${plugin.id}`);
  return parsed;
}

export interface ResourceOpenerContribution {
  id: string;
  kind: string;
  title: string;
  /** Owning scene used for routing the resource into the workbench. */
  sceneId?: string;
  /** Workbench tab kind produced by this opener (`plugin:*` is allowed). */
  tabKind?: string;
  /** Higher priority openers win when more than one plugin handles a kind. */
  priority?: number;
  /** Optional file extensions (with or without a leading dot) handled by this opener. */
  extensions?: string[];
  /** Optional URI schemes handled by this opener, e.g. `aster` or `plugin`. */
  schemes?: string[];
  pluginId?: string;
  /** Optional host-rendered view for plugin-owned resource tabs. The renderer
   * is declarative so local/market plugins never execute arbitrary UI code. */
  renderer?: DeclarativeViewRenderer;
  open?: (input: { uri: string; title?: string }) => {
    kind?: string;
    title?: string;
    state?: Record<string, JsonValue>;
  } | void;
}

export interface RegisteredPlugin {
  id: string;
  name: string;
  version?: string;
  trust?: 'builtin' | 'trusted' | 'untrusted' | 'blocked';
  permissions?: PluginPermission[];
  dispose: () => void;
}
