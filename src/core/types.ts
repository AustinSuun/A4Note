export type SceneId = 'library' | 'reader' | 'aiChat';
export type ReaderLayout = 'focus' | 'note' | 'ai';
export type ReaderSidePanelTab = 'notes' | 'annotations' | 'chat' | 'relations';
export type AnnotationType = 'highlight' | 'comment' | 'underline' | 'area';
export type ReaderTool = 'cursor' | AnnotationType;
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
  id: SceneId;
  label: string;
  icon: string;
  key: string;
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
  | `plugin:${string}`;

export interface WorkbenchPanelContribution {
  id: WorkbenchPanelId;
  sceneId: SceneId;
  area: WorkbenchArea;
  commandId: string;
  titleKey: string;
  icon: string;
  order: number;
  source: WorkbenchPanelSource;
  context: WorkbenchPanelContext;
  defaultOpen?: boolean;
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
  fileId: string;
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
  commands: {
    register: <TPayload, TResult>(command: Command<TPayload, TResult>) => () => void;
    execute: <TPayload, TResult>(commandId: string, payload: TPayload) => TResult;
    list: () => Command<any, any>[];
  };
  events: {
    on: <TPayload>(eventName: string, handler: EventHandler<TPayload>) => () => void;
  };
  settings: Map<string, SettingContribution>;
  workbenchPanels: {
    register: (panel: WorkbenchPanelContribution) => () => void;
    list: () => WorkbenchPanelContribution[];
  };
  metadataSources: Map<string, ProviderContribution>;
  translationSources: Map<string, ProviderContribution>;
  aiProviders: Map<string, AiProviderContribution>;
}

export interface AsterPlugin {
  id: string;
  name: string;
  activate: (context: AsterPluginContext) => void | (() => void);
}

export interface RegisteredPlugin {
  id: string;
  name: string;
  dispose: () => void;
}
