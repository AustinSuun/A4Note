import type {
  Annotation,
  AiProviderContribution,
  AsterPlugin,
  Command,
  EventHandler,
  ImportDraft,
  PaperDocument,
  ProviderContribution,
  RegisteredPlugin,
  SceneContribution,
  SceneSidebarRegistration,
  SceneViewRegistration,
  SettingContribution,
  WorkbenchPanelContribution,
  ResourceOpenerContribution,
  PluginPermission,
} from './types';
import { validatePluginManifest } from './types';
import { LocalDocumentRepository, type DocumentRepository } from './documentRepository';
import { createLibraryPlugin } from './libraryPlugin';
import { createMarkdownPlugin } from './markdownPlugin';
import { builtinScenePluginId, createBuiltinScenePlugin } from './builtinScenePlugins';
import { createOverviewPlugin } from './overviewPlugin';
import { createReaderPlugin } from './readerPlugin';
import { createAiPlugin } from './aiPlugin';
import { defaultPluginSecurityPolicy, pluginTrust, type PluginSecurityPolicy } from './pluginSecurity';
import { createDeclarativePlugin, parseDeclarativePluginPayload, parseDeclarativePluginPayloadText, type DeclarativePluginPayload } from './declarativePlugin';

const FALLBACK_TAG = '未分类';

function createNoteId() {
  const uniquePart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `note-${uniquePart}`;
}

class AsterEventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<TPayload>(eventName: string, handler: EventHandler<TPayload>) {
    const handlers = this.listeners.get(eventName) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.listeners.set(eventName, handlers);
    return () => this.off(eventName, handler);
  }

  off<TPayload>(eventName: string, handler: EventHandler<TPayload>) {
    this.listeners.get(eventName)?.delete(handler as EventHandler);
  }

  emit<TPayload>(eventName: string, payload: TPayload) {
    this.listeners.get(eventName)?.forEach((handler) => handler(payload));
  }
}

class AsterCommandRegistry {
  private commands = new Map<string, Command<any, any>>();

  constructor(private readonly events: AsterEventBus) {}

  register<TPayload, TResult>(command: Command<TPayload, TResult>) {
    this.commands.set(command.id, command);
    this.events.emit('command.registered', command);
    return () => this.commands.delete(command.id);
  }

  execute<TPayload, TResult>(commandId: string, payload: TPayload): TResult {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Command not found: ${commandId}`);
    this.events.emit('command.executed', { commandId, payload });
    return command.run(payload) as TResult;
  }

  list() {
    return Array.from(this.commands.values());
  }
}

class AsterDocumentStore {
  constructor(
    private readonly events: AsterEventBus,
    private documents: PaperDocument[],
    private readonly repository: DocumentRepository,
  ) {}

  list() {
    return this.documents;
  }

  replaceAll(documents: PaperDocument[]) {
    this.documents = documents;
    this.persist();
    this.events.emit('document.store.replaced', documents);
  }

  get(paperId: string) {
    return this.documents.find((document) => document.paperId === paperId) ?? null;
  }

  moveToFolder(paperIds: string[], folderId: string | null) {
    const selected = new Set(paperIds);
    let changed = false;
    this.documents = this.documents.map((document) => {
      if (!selected.has(document.paperId) || document.folderId === (folderId ?? 'library')) return document;
      changed = true;
      return { ...document, folderId: folderId ?? 'library' };
    });
    if (changed) {
      this.persist();
      this.events.emit('document.folders.updated', { paperIds, folderId });
    }
    return changed;
  }

  search(query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.documents;
    return this.documents.filter((document) =>
      [document.paperId, document.title, document.authors, document.year, document.venue, document.doi, document.notes.map((note) => note.content).join(' '), document.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }

  allTags() {
    return Array.from(new Set(this.documents.flatMap((document) => document.tags))).sort((a, b) => a.localeCompare(b));
  }

  updatePrimaryNote(paperId: string, content: string) {
    const document = this.get(paperId);
    if (!document) return null;
    if (!document.notes.length) {
      document.notes.push({
        id: createNoteId(),
        paperId,
        title: '阅读笔记',
        content,
        format: 'markdown',
        updatedAt: new Date().toISOString(),
      });
    } else {
      document.notes[0] = { ...document.notes[0], content, updatedAt: new Date().toISOString() };
    }
    this.persist();
    this.events.emit('document.note.updated', { paperId, note: document.notes[0] });
    return document;
  }

  upsertNote(paperId: string, input: { noteId?: string; title: string; content: string }) {
    const document = this.get(paperId);
    if (!document) return null;
    if (input.noteId && this.documents.some((owner) => owner.paperId !== paperId && owner.notes.some((note) => note.id === input.noteId))) {
      throw new Error('笔记不属于当前文献，拒绝覆盖');
    }
    const now = new Date().toISOString();
    const noteIndex = input.noteId ? document.notes.findIndex((note) => note.id === input.noteId) : -1;
    const note = {
      id: noteIndex >= 0 ? document.notes[noteIndex].id : input.noteId || createNoteId(),
      paperId,
      title: input.title,
      content: input.content,
      format: 'markdown' as const,
      updatedAt: now,
    };
    if (noteIndex >= 0) document.notes[noteIndex] = note;
    else document.notes.unshift(note);
    this.persist();
    this.events.emit('document.note.updated', { paperId, note });
    return note;
  }

  addAnnotation(paperId: string, annotation: Partial<Annotation>) {
    const document = this.get(paperId);
    if (!document) return null;
    const nextAnnotation: Annotation = {
      id: `anno-${Date.now()}`,
      paperId,
      fileId: annotation.fileId ?? document.sourceFileId,
      page: annotation.page ?? 1,
      type: annotation.type ?? 'highlight',
      quote: annotation.quote ?? '',
      comment: annotation.comment ?? '',
      color: annotation.color ?? 'yellow',
      positionJson: annotation.positionJson ?? { x: 18, y: 28, width: 48, height: 6 },
      createdAt: new Date().toISOString(),
    };
    document.annotations.push(nextAnnotation);
    this.persist();
    this.events.emit('document.annotation.created', { paperId, annotation: nextAnnotation });
    return nextAnnotation;
  }

  importPaper(draft: ImportDraft) {
    const tags = normalizeTags(draft.tags);
    const paperId = `paper-${Date.now()}`;
    const sourceFileId = `file-${Date.now()}`;
    const document: PaperDocument = {
      paperId,
      title: draft.title || '未命名论文',
      authors: draft.authors || '未知作者',
      year: draft.year || new Date().getFullYear(),
      venue: draft.venue || '未知来源',
      doi: draft.doi,
      folderId: 'library',
      sourceFileId: draft.sourceFileId || sourceFileId,
      sourcePdf: draft.libraryPath || `AsterData/files/papers/${paperId}/source.pdf`,
      translatedFileIds: [],
      translatedPdfs: [],
      tags,
      notes: [],
      annotations: [],
      aiThreads: [],
      metadataSource: draft.metadataSource,
      createdAt: new Date().toISOString(),
      isRead: false,
      isFavorite: false,
    };
    this.documents = [document, ...this.documents];
    this.persist();
    this.events.emit('document.imported', document);
    return document;
  }

  updateState(paperId: string, patch: Partial<Pick<PaperDocument, 'isRead' | 'isFavorite' | 'lastViewedAt'>>) {
    const index = this.documents.findIndex((document) => document.paperId === paperId);
    if (index < 0) return null;
    this.documents[index] = { ...this.documents[index], ...patch };
    this.persist();
    this.events.emit('document.state.updated', { paperId, ...patch });
    return this.documents[index];
  }

  updateLastViewedAt(paperId: string) {
    const document = this.get(paperId);
    if (!document) return null;
    const index = this.documents.findIndex((doc) => doc.paperId === paperId);
    if (index >= 0) {
      this.documents[index] = { ...document, lastViewedAt: new Date().toISOString() };
      this.persist();
      this.events.emit('document.viewed', { paperId, lastViewedAt: this.documents[index].lastViewedAt });
      return this.documents[index];
    }
    return null;
  }

  toggleRead(paperId: string) {
    const document = this.get(paperId);
    if (!document) return null;
    const index = this.documents.findIndex((doc) => doc.paperId === paperId);
    if (index >= 0) {
      const newReadState = !document.isRead;
      this.documents[index] = { ...document, isRead: newReadState };
      this.persist();
      this.events.emit('document.read.toggled', { paperId, isRead: newReadState });
      return this.documents[index];
    }
    return null;
  }

  toggleFavorite(paperId: string) {
    const document = this.get(paperId);
    if (!document) return null;
    const index = this.documents.findIndex((doc) => doc.paperId === paperId);
    if (index >= 0) {
      const newFavoriteState = !document.isFavorite;
      this.documents[index] = { ...document, isFavorite: newFavoriteState };
      this.persist();
      this.events.emit('document.favorite.toggled', { paperId, isFavorite: newFavoriteState });
      return this.documents[index];
    }
    return null;
  }

  private persist() {
    this.repository.save(this.documents);
  }
}

class AsterSceneRegistry {
  private definitions = new Map<string, SceneContribution>();

  constructor(
    private readonly events: AsterEventBus,
    private scenes: SceneContribution[],
  ) {
    scenes.forEach((scene) => this.definitions.set(scene.id, scene));
  }

  register(scene: SceneContribution) {
    if (!scene.id.trim()) throw new Error('Scene id cannot be empty');
    const normalized: SceneContribution = {
      ...scene,
      source: scene.source ?? 'builtin',
      scope: scene.scope ?? 'custom',
      enabledByDefault: scene.enabledByDefault ?? true,
    };
    if (this.scenes.some((item) => item.id === normalized.id)) {
      throw new Error(`Scene already registered: ${normalized.id}`);
    }
    this.scenes = [...this.scenes, normalized];
    // Keep a stable catalog entry after disposal. The settings surface needs
    // to show disabled scenes so the user can enable their owning plugin again.
    this.definitions.set(normalized.id, normalized);
    this.events.emit('scene.registered', normalized);
    return () => {
      this.scenes = this.scenes.filter((item) => item.id !== normalized.id);
      this.events.emit('scene.disposed', normalized);
    };
  }

  list() {
    return this.scenes;
  }

  /** All known scene metadata, including scenes owned by disabled plugins. */
  listDefinitions() {
    return Array.from(this.definitions.values()).sort((left, right) => left.id.localeCompare(right.id));
  }
}

class AsterSceneViewRegistry {
  private views = new Map<string, SceneViewRegistration>();

  constructor(private readonly events: AsterEventBus) {}

  register(view: SceneViewRegistration) {
    if (!view.id.trim() || !view.sceneId.trim() || !view.pluginId.trim()) {
      throw new Error('Scene view contribution requires id, sceneId and pluginId');
    }
    if (this.views.has(view.id)) throw new Error(`Scene view already registered: ${view.id}`);
    if (Array.from(this.views.values()).some((candidate) => candidate.sceneId === view.sceneId)) {
      throw new Error(`Scene view already registered for scene: ${view.sceneId}`);
    }
    this.views.set(view.id, view);
    this.events.emit('scene.view.registered', view);
    return () => {
      if (!this.views.delete(view.id)) return;
      this.events.emit('scene.view.disposed', view);
    };
  }

  get(sceneId: string) {
    return Array.from(this.views.values()).find((view) => view.sceneId === sceneId);
  }

  list() {
    return Array.from(this.views.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId));
  }
}

class AsterSceneSidebarRegistry {
  private sidebars = new Map<string, SceneSidebarRegistration>();

  constructor(private readonly events: AsterEventBus) {}

  register(sidebar: SceneSidebarRegistration) {
    if (!sidebar.id.trim() || !sidebar.sceneId.trim() || !sidebar.pluginId.trim()) {
      throw new Error('Scene sidebar contribution requires id, sceneId and pluginId');
    }
    if (this.sidebars.has(sidebar.id)) throw new Error(`Scene sidebar already registered: ${sidebar.id}`);
    this.sidebars.set(sidebar.id, sidebar);
    this.events.emit('scene.sidebar.registered', sidebar);
    return () => {
      if (!this.sidebars.delete(sidebar.id)) return;
      this.events.emit('scene.sidebar.disposed', sidebar);
    };
  }

  get(panelId: string) {
    return this.sidebars.get(panelId);
  }

  list() {
    return Array.from(this.sidebars.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId) || left.id.localeCompare(right.id));
  }
}

export function createImportDraft(filePath: string): ImportDraft {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const titleGuess = fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const yearMatch = fileName.match(/\b(19|20)\d{2}\b/);
  return {
    title: titleGuess || '未命名论文',
    authors: '',
    year: yearMatch ? Number(yearMatch[0]) : '',
    venue: '',
    doi: '',
    tags: [FALLBACK_TAG],
    originalPath: filePath,
    metadataSource: 'filename',
    extractionSource: 'filename',
    extractionWarnings: filePath ? [] : ['尚未选择 PDF 文件。'],
  };
}

class AsterWorkbenchPanelRegistry {
  private panels = new Map<string, WorkbenchPanelContribution>();

  constructor(
    private readonly events: AsterEventBus,
    initialPanels: WorkbenchPanelContribution[],
  ) {
    initialPanels.forEach((panel) => this.panels.set(panel.id, panel));
  }

  register(panel: WorkbenchPanelContribution) {
    if (this.panels.has(panel.id)) throw new Error(`Workbench panel already registered: ${panel.id}`);
    this.panels.set(panel.id, panel);
    this.events.emit('workbench.panel.registered', panel);
    return () => {
      this.panels.delete(panel.id);
      this.events.emit('workbench.panel.disposed', panel);
    };
  }

  list() {
    return Array.from(this.panels.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId) || left.area.localeCompare(right.area) || left.order - right.order);
  }
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || tag === FALLBACK_TAG) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
  }
  return cleaned.length ? cleaned : [FALLBACK_TAG];
}

/**
 * Keep the legacy map-shaped provider API while making writes lifecycle-aware.
 * The host owns the backing map; a plugin receives a facade that can only add
 * and remove its own contributions. Every successful `set` gets a disposer so
 * disabling the plugin cannot leave a stale provider/source in the host.
 */
function createPluginOwnedContributionMap<T extends { id: string }>(
  target: Map<string, T>,
  disposers: Array<() => void>,
  requirePermission: (permission: PluginPermission) => void,
): Map<string, T> {
  const ownedValues = new Map<string, T>();
  let facade: Map<string, T>;
  facade = new Proxy(target, {
    get(source, property) {
      if (property === 'set') {
        return (key: string, value: T) => {
          requirePermission('providers');
          if (source.has(key) && !ownedValues.has(key)) {
            throw new Error(`Contribution already registered: ${key}`);
          }
          source.set(key, value);
          ownedValues.set(key, value);
          const dispose = () => {
            if (ownedValues.get(key) !== value) return;
            ownedValues.delete(key);
            if (source.get(key) === value) source.delete(key);
          };
          disposers.push(dispose);
          return facade;
        };
      }
      if (property === 'delete') {
        return (key: string) => {
          requirePermission('providers');
          if (!ownedValues.has(key)) return false;
          ownedValues.delete(key);
          return source.delete(key);
        };
      }
      if (property === 'clear') {
        return () => {
          requirePermission('providers');
          for (const key of ownedValues.keys()) source.delete(key);
          ownedValues.clear();
        };
      }
      const value = Reflect.get(source, property, source);
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
  return facade;
}

export function createAsterCore(documents: PaperDocument[], scenes: SceneContribution[], repository: DocumentRepository = new LocalDocumentRepository(), securityPolicy: PluginSecurityPolicy = defaultPluginSecurityPolicy) {
  const initialDocuments = repository.load() ?? documents;
  const events = new AsterEventBus();
  const commands = new AsterCommandRegistry(events);
  const documentStore = new AsterDocumentStore(events, initialDocuments, repository);
  // Scenes start empty and are populated only by plugin activation below. The
  // `scenes` argument remains as a compatibility input for seed metadata and
  // tests, but no longer bypasses the plugin lifecycle.
  const sceneRegistry = new AsterSceneRegistry(events, []);
  // Workbench panels are plugin contributions. Keep the static definition in
  // `core/workbench.ts` as a compatibility catalogue, but do not preload it;
  // disabling its owning plugin must remove every panel at runtime.
  const workbenchPanels = new AsterWorkbenchPanelRegistry(events, []);
  const sceneViews = new AsterSceneViewRegistry(events);
  const sceneSidebars = new AsterSceneSidebarRegistry(events);
  const settings = new Map<string, SettingContribution>();
  const metadataSources = new Map<string, ProviderContribution>();
  const translationSources = new Map<string, ProviderContribution>();
  const aiProviders = new Map<string, AiProviderContribution>();
  const plugins = new Map<string, RegisteredPlugin>();
  const pluginDefinitions = new Map<string, AsterPlugin>();
  // Reserved first-party ids cannot be replaced by an imported package.
  const builtinPluginIds = new Set(['overview.core', 'library.core', 'reader.core', 'ai.core', 'markdown.core']);
  const resourceOpenerRegistry = new Map<string, ResourceOpenerContribution>();
  const verifiedPluginIds = new Set<string>();
  const runtimeSecurityPolicy: PluginSecurityPolicy = { ...securityPolicy, verifiedPluginIds };

  commands.register<{ paperId: string; content: string }, PaperDocument | null>({
    id: 'document.updatePrimaryNote',
    title: 'Update primary markdown note',
    source: 'core',
    run: ({ paperId, content }) => documentStore.updatePrimaryNote(paperId, content),
  });

  commands.register<{ paperId: string; noteId?: string; title: string; content: string }, PaperDocument['notes'][number] | null>({
    id: 'document.upsertNote',
    title: 'Create or update markdown note',
    source: 'core',
    run: ({ paperId, ...input }) => documentStore.upsertNote(paperId, input),
  });

  commands.register<{ paperId: string; annotation: Partial<Annotation> }, Annotation | null>({
    id: 'document.addAnnotation',
    title: 'Add PDF annotation',
    source: 'core',
    run: ({ paperId, annotation }) => documentStore.addAnnotation(paperId, annotation),
  });

  commands.register<ImportDraft, PaperDocument>({
    id: 'document.importFromDraft',
    title: 'Import PDF from confirmed draft',
    source: 'core',
    run: (draft) => documentStore.importPaper(draft),
  });

  commands.register<{ paperId: string }, PaperDocument | null>({
    id: 'document.updateLastViewedAt',
    title: 'Update last viewed timestamp',
    source: 'core',
    run: ({ paperId }) => documentStore.updateLastViewedAt(paperId),
  });

  commands.register<{ paperId: string }, PaperDocument | null>({
    id: 'document.toggleRead',
    title: 'Toggle read status',
    source: 'core',
    run: ({ paperId }) => documentStore.toggleRead(paperId),
  });

  commands.register<{ paperId: string }, PaperDocument | null>({
    id: 'document.toggleFavorite',
    title: 'Toggle favorite status',
    source: 'core',
    run: ({ paperId }) => documentStore.toggleFavorite(paperId),
  });

  metadataSources.set('crossref', { id: 'crossref', name: 'DOI / Crossref', enabledByDefault: true });
  metadataSources.set('arxiv', { id: 'arxiv', name: 'arXiv', enabledByDefault: true });
  translationSources.set('manual-pdf-binding', { id: 'manual-pdf-binding', name: '手动译文 PDF 绑定', enabledByDefault: true });
  aiProviders.set('local-context-assistant', {
    id: 'local-context-assistant',
    name: '本地上下文助手',
    kind: 'local',
    status: 'available',
    modelLabel: 'A4 Note Local Context',
    description: '使用当前文献、笔记、标注和标签生成本地上下文回复。',
    supportsContextObjects: true,
    supportsStreaming: false,
    enabledByDefault: true,
  });
  aiProviders.set('codex-cli', {
    id: 'codex-cli',
    name: 'Codex CLI',
    kind: 'cli',
    status: 'planned',
    modelLabel: 'Codex',
    description: '预留通过本地 Codex CLI 处理知识对象上下文的 Provider。',
    supportsContextObjects: true,
    supportsStreaming: true,
  });
  aiProviders.set('claude-code-cli', {
    id: 'claude-code-cli',
    name: 'Claude Code CLI',
    kind: 'cli',
    status: 'planned',
    modelLabel: 'Claude Code',
    description: '预留通过 Claude Code CLI 接入本地工作区上下文的 Provider。',
    supportsContextObjects: true,
    supportsStreaming: true,
  });

  const activatePlugin = (plugin: AsterPlugin) => {
    if (plugins.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    const manifest = validatePluginManifest(plugin);
    const trust = pluginTrust(manifest, runtimeSecurityPolicy);
    if (trust === 'blocked') throw new Error(`Plugin blocked by security policy: ${plugin.id}`);
    const permissions = new Set(manifest.permissions);
    const requirePermission = (permission: import('./types').PluginPermission) => {
      if (!permissions.has(permission)) throw new Error(`Plugin ${plugin.id} lacks permission: ${permission}`);
    };
    const assertOwnedContribution = (declaredPluginId: string | undefined, kind: string) => {
      if (declaredPluginId && declaredPluginId !== plugin.id) {
        throw new Error(`Plugin ${plugin.id} cannot register ${kind} owned by ${declaredPluginId}`);
      }
    };
    const disposers: Array<() => void> = [];
    const pluginMetadataSources = createPluginOwnedContributionMap(metadataSources, disposers, requirePermission);
    const pluginTranslationSources = createPluginOwnedContributionMap(translationSources, disposers, requirePermission);
    const pluginAiProviders = createPluginOwnedContributionMap(aiProviders, disposers, requirePermission);
    const context = {
      permissions,
      commands: {
        register: <TPayload, TResult>(command: Command<TPayload, TResult>) => {
          requirePermission('commands');
          const dispose = commands.register({ ...command, source: `plugin:${plugin.id}` });
          disposers.push(dispose);
          return dispose;
        },
        execute: <TPayload, TResult>(commandId: string, payload: TPayload) => commands.execute<TPayload, TResult>(commandId, payload),
        list: () => commands.list(),
      },
      events: {
        on: <TPayload>(eventName: string, handler: EventHandler<TPayload>) => {
          requirePermission('events');
          const dispose = events.on(eventName, handler);
          disposers.push(dispose);
          return dispose;
        },
      },
      settings: {
        register: (setting: SettingContribution) => {
          requirePermission('settings');
          assertOwnedContribution(setting.pluginId, 'setting');
          if (settings.has(setting.id)) throw new Error(`Setting already registered: ${setting.id}`);
          const normalized = { ...setting, pluginId: setting.pluginId ?? plugin.id };
          settings.set(normalized.id, normalized);
          events.emit('setting.registered', normalized);
          const dispose = () => {
            settings.delete(normalized.id);
            events.emit('setting.disposed', normalized);
          };
          disposers.push(dispose);
          return dispose;
        },
        set: (settingId: string, setting: SettingContribution) => {
          return context.settings.register({ ...setting, id: settingId });
        },
        list: () => Array.from(settings.values()).sort((left, right) => left.id.localeCompare(right.id)),
      },
      workbenchPanels: {
        register: (panel: WorkbenchPanelContribution) => {
          requirePermission('workbench');
          if (panel.source !== `plugin:${plugin.id}`) {
            throw new Error(`Plugin ${plugin.id} cannot register workbench panel owned by ${panel.source}`);
          }
          const dispose = workbenchPanels.register(panel);
          disposers.push(dispose);
          return dispose;
        },
        list: () => workbenchPanels.list(),
      },
      scenes: {
        register: (scene: SceneContribution) => {
          requirePermission('scenes');
          assertOwnedContribution(scene.pluginId, 'scene');
          const dispose = sceneRegistry.register({ ...scene, pluginId: scene.pluginId ?? plugin.id, source: `plugin:${plugin.id}` });
          disposers.push(dispose);
          return dispose;
        },
        list: () => sceneRegistry.list(),
      },
      sceneViews: {
        register: (view: SceneViewRegistration) => {
          requirePermission('scenes');
          assertOwnedContribution(view.pluginId, 'scene view');
          const dispose = sceneViews.register({ ...view, pluginId: view.pluginId ?? plugin.id });
          disposers.push(dispose);
          return dispose;
        },
        get: (sceneId: string) => sceneViews.get(sceneId),
        list: () => sceneViews.list(),
      },
      sceneSidebars: {
        register: (sidebar: SceneSidebarRegistration) => {
          requirePermission('scenes');
          assertOwnedContribution(sidebar.pluginId, 'scene sidebar');
          const dispose = sceneSidebars.register({ ...sidebar, pluginId: sidebar.pluginId ?? plugin.id });
          disposers.push(dispose);
          return dispose;
        },
        get: (panelId: string) => sceneSidebars.get(panelId),
        list: () => sceneSidebars.list(),
      },
      resourceOpeners: {
        register: (opener: ResourceOpenerContribution) => {
          requirePermission('resources');
          assertOwnedContribution(opener.pluginId, 'resource opener');
          const normalized = {
            ...opener,
            pluginId: opener.pluginId ?? plugin.id,
            priority: Number.isFinite(opener.priority) ? opener.priority : 0,
          };
          if (resourceOpenerRegistry.has(normalized.id)) throw new Error(`Resource opener already registered: ${normalized.id}`);
          resourceOpenerRegistry.set(normalized.id, normalized);
          events.emit('resource.opener.registered', normalized);
          const dispose = () => {
            if (!resourceOpenerRegistry.delete(normalized.id)) return;
            events.emit('resource.opener.disposed', normalized);
          };
          disposers.push(dispose);
          return dispose;
        },
        get: (openerId: string) => resourceOpenerRegistry.get(openerId),
        has: (openerId: string) => resourceOpenerRegistry.has(openerId),
        list: () => Array.from(resourceOpenerRegistry.values()).sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)),
      },
      metadataSources: pluginMetadataSources,
      translationSources: pluginTranslationSources,
      aiProviders: pluginAiProviders,
    };
    let pluginDispose: void | (() => void);
    try {
      pluginDispose = plugin.activate(context);
      if (pluginDispose) disposers.push(pluginDispose);
    } catch (error) {
      while (disposers.length) {
        try { disposers.pop()?.(); } catch { /* one failed cleanup must not leak the rest */ }
      }
      events.emit('plugin.failed', { id: plugin.id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    const registered = {
      id: plugin.id,
      name: plugin.name,
      version: manifest.version,
      trust,
      permissions: manifest.permissions,
      dispose: () => {
        let firstError: unknown;
        while (disposers.length) {
          try { disposers.pop()?.(); } catch (error) { firstError ??= error; }
        }
        plugins.delete(plugin.id);
        events.emit('plugin.disposed', { id: plugin.id });
        if (firstError) events.emit('plugin.disposeFailed', { id: plugin.id, error: firstError instanceof Error ? firstError.message : String(firstError) });
      },
    };
    plugins.set(plugin.id, registered);
    events.emit('plugin.registered', { id: plugin.id, name: plugin.name });
    return registered;
  };

  const registerPlugin = (plugin: AsterPlugin) => {
    if (pluginDefinitions.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    pluginDefinitions.set(plugin.id, plugin);
    try {
      return activatePlugin(plugin);
    } catch (error) {
      pluginDefinitions.delete(plugin.id);
      throw error;
    }
  };

  /** Install a definition without activating it. */
  const installPluginDefinition = (plugin: AsterPlugin) => {
    if (pluginDefinitions.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    pluginDefinitions.set(plugin.id, plugin);
    return plugin;
  };

  /** Register a package only after the host has verified its detached signature. */
  const registerDeclarativePlugin = (manifest: import('./types').AsterPluginManifest, payload: DeclarativePluginPayload | string) => {
    const parsedManifest = validatePluginManifest({ id: manifest.id, name: manifest.name, manifest, activate: () => undefined });
    if (parsedManifest.distribution !== 'local' && parsedManifest.distribution !== 'market') throw new Error('仅允许注册已验证的本地或市场插件');
    if (builtinPluginIds.has(parsedManifest.id) || pluginDefinitions.get(parsedManifest.id)?.manifest?.distribution === 'builtin') {
      throw new Error(`外部插件不能覆盖内置插件: ${parsedManifest.id}`);
    }
    const parsed = typeof payload === 'string' ? parseDeclarativePluginPayloadText(payload) : parseDeclarativePluginPayload(payload);
    verifiedPluginIds.add(parsedManifest.id);
    try {
      return registerPlugin(createDeclarativePlugin(parsedManifest, parsed));
    } catch (error) {
      verifiedPluginIds.delete(parsedManifest.id);
      throw error;
    }
  };

  const reloadDeclarativePlugin = (manifest: import('./types').AsterPluginManifest, payload: DeclarativePluginPayload | string) => {
    // Validate the update before taking the currently active plugin offline.
    const parsedManifest = validatePluginManifest({ id: manifest.id, name: manifest.name, manifest, activate: () => undefined });
    if (parsedManifest.distribution !== 'local' && parsedManifest.distribution !== 'market') throw new Error('仅允许注册已验证的本地或市场插件');
    if (builtinPluginIds.has(parsedManifest.id) || pluginDefinitions.get(parsedManifest.id)?.manifest?.distribution === 'builtin') {
      throw new Error(`外部插件不能覆盖内置插件: ${parsedManifest.id}`);
    }
    const parsedPayload = typeof payload === 'string' ? parseDeclarativePluginPayloadText(payload) : parseDeclarativePluginPayload(payload);
    const oldDefinition = pluginDefinitions.get(parsedManifest.id);
    const oldRegistered = plugins.get(parsedManifest.id);
    // Updating a disabled plugin must not implicitly enable it. A new import
    // keeps the historical active-by-default behavior.
    const wasEnabled = oldDefinition ? Boolean(oldRegistered) : true;
    const oldWasVerified = verifiedPluginIds.has(parsedManifest.id);
    oldRegistered?.dispose();
    pluginDefinitions.delete(parsedManifest.id);
    try {
      const nextDefinition = createDeclarativePlugin(parsedManifest, parsedPayload);
      verifiedPluginIds.add(parsedManifest.id);
      installPluginDefinition(nextDefinition);
      return wasEnabled ? activatePlugin(nextDefinition) : undefined;
    } catch (error) {
      if (oldDefinition) {
        pluginDefinitions.set(parsedManifest.id, oldDefinition);
        if (oldWasVerified) verifiedPluginIds.add(parsedManifest.id);
        else verifiedPluginIds.delete(parsedManifest.id);
        if (wasEnabled) {
          try { activatePlugin(oldDefinition); } catch { /* preserve original update error */ }
        }
      } else {
        verifiedPluginIds.delete(parsedManifest.id);
      }
      throw error;
    }
  };

  const setPluginEnabled = (pluginId: string, enabled: boolean) => {
    const plugin = pluginDefinitions.get(pluginId);
    if (!plugin) return false;
    const registered = plugins.get(pluginId);
    if (!enabled) {
      registered?.dispose();
      return true;
    }
    if (registered) return true;
    activatePlugin(plugin);
    return true;
  };

  const sceneMetadata = new Map(scenes.map((scene) => [scene.id, scene]));
  const builtinSceneDefinitions: Array<{ id: string; pluginId: string; create: (scene?: SceneContribution) => AsterPlugin }> = [
    { id: 'overview', pluginId: 'overview.core', create: createOverviewPlugin },
    { id: 'library', pluginId: 'library.core', create: createLibraryPlugin },
    { id: 'reader', pluginId: 'reader.core', create: createReaderPlugin },
    { id: 'aiChat', pluginId: 'ai.core', create: createAiPlugin },
    { id: 'markdown', pluginId: 'markdown.core', create: createMarkdownPlugin },
  ];
  const registeredBuiltinPluginIds = new Set<string>();
  for (const definition of builtinSceneDefinitions) {
    registerPlugin(definition.create(sceneMetadata.get(definition.id)));
    registeredBuiltinPluginIds.add(definition.pluginId);
  }
  // Any non-first-party scene passed by an embedding host is still normalized
  // into a builtin wrapper, while known scene/plugin ids above stay singletons.
  for (const scene of scenes) {
    const pluginId = scene.pluginId ?? builtinScenePluginId(scene.id);
    if (registeredBuiltinPluginIds.has(pluginId) || builtinSceneDefinitions.some((definition) => definition.id === scene.id)) continue;
    registerPlugin(createBuiltinScenePlugin(scene));
    registeredBuiltinPluginIds.add(pluginId);
  }

  return {
    version: '0.1.0',
    events,
    commands,
    documents: documentStore,
    scenes: sceneRegistry,
    sceneViews,
    sceneSidebars,
    workbenchPanels,
    settings,
    metadataSources,
    translationSources,
    aiProviders,
    resourceOpeners: {
      register: (opener: ResourceOpenerContribution) => {
        const normalized = {
          ...opener,
          pluginId: opener.pluginId,
          priority: Number.isFinite(opener.priority) ? opener.priority : 0,
        };
        if (resourceOpenerRegistry.has(normalized.id)) throw new Error(`Resource opener already registered: ${normalized.id}`);
        resourceOpenerRegistry.set(normalized.id, normalized);
        events.emit('resource.opener.registered', normalized);
        return () => {
          if (!resourceOpenerRegistry.delete(normalized.id)) return;
          events.emit('resource.opener.disposed', normalized);
        };
      },
      get: (openerId: string) => resourceOpenerRegistry.get(openerId),
      has: (openerId: string) => resourceOpenerRegistry.has(openerId),
      list: () => Array.from(resourceOpenerRegistry.values()).sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)),
    },
    plugins,
    pluginDefinitions,
    registerPlugin,
    registerDeclarativePlugin,
    reloadDeclarativePlugin,
    setPluginEnabled,
    library: {
      mode: 'single',
      root: 'AsterData',
      database: 'AsterData/aster.db',
      filesRoot: 'AsterData/files/papers',
      importPolicy: 'copy',
    },
  };
}
