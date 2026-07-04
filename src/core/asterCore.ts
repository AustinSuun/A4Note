import type {
  Annotation,
  AsterPlugin,
  Command,
  EventHandler,
  ImportDraft,
  PaperDocument,
  ProviderContribution,
  RegisteredPlugin,
  SceneContribution,
  SettingContribution,
} from './types';
import { LocalDocumentRepository, type DocumentRepository } from './documentRepository';

const FALLBACK_TAG = '未分类';

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
        id: `note-${Date.now()}`,
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
    };
    this.documents = [document, ...this.documents];
    this.persist();
    this.events.emit('document.imported', document);
    return document;
  }

  private persist() {
    this.repository.save(this.documents);
  }
}

class AsterSceneRegistry {
  constructor(
    private readonly events: AsterEventBus,
    private scenes: SceneContribution[],
  ) {}

  register(scene: SceneContribution) {
    if (!this.scenes.some((item) => item.id === scene.id)) {
      this.scenes = [...this.scenes, scene];
      this.events.emit('scene.registered', scene);
    }
    return () => {
      this.scenes = this.scenes.filter((item) => item.id !== scene.id);
    };
  }

  list() {
    return this.scenes;
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

export function createAsterCore(documents: PaperDocument[], scenes: SceneContribution[], repository: DocumentRepository = new LocalDocumentRepository()) {
  const initialDocuments = repository.load() ?? documents;
  const events = new AsterEventBus();
  const commands = new AsterCommandRegistry(events);
  const documentStore = new AsterDocumentStore(events, initialDocuments, repository);
  const sceneRegistry = new AsterSceneRegistry(events, scenes);
  const settings = new Map<string, SettingContribution>();
  const metadataSources = new Map<string, ProviderContribution>();
  const translationSources = new Map<string, ProviderContribution>();
  const aiProviders = new Map<string, ProviderContribution>();
  const plugins = new Map<string, RegisteredPlugin>();

  commands.register<{ paperId: string; content: string }, PaperDocument | null>({
    id: 'document.updatePrimaryNote',
    title: 'Update primary markdown note',
    run: ({ paperId, content }) => documentStore.updatePrimaryNote(paperId, content),
  });

  commands.register<{ paperId: string; annotation: Partial<Annotation> }, Annotation | null>({
    id: 'document.addAnnotation',
    title: 'Add PDF annotation',
    run: ({ paperId, annotation }) => documentStore.addAnnotation(paperId, annotation),
  });

  commands.register<ImportDraft, PaperDocument>({
    id: 'document.importFromDraft',
    title: 'Import PDF from confirmed draft',
    run: (draft) => documentStore.importPaper(draft),
  });

  metadataSources.set('crossref', { id: 'crossref', name: 'DOI / Crossref', enabledByDefault: true });
  metadataSources.set('arxiv', { id: 'arxiv', name: 'arXiv', enabledByDefault: true });
  translationSources.set('manual-pdf-binding', { id: 'manual-pdf-binding', name: '手动译文 PDF 绑定', enabledByDefault: true });
  aiProviders.set('local-context-assistant', { id: 'local-context-assistant', name: '本地上下文助手', enabledByDefault: true });

  const registerPlugin = (plugin: AsterPlugin) => {
    if (plugins.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    const disposers: Array<() => void> = [];
    const context = {
      commands: {
        register: <TPayload, TResult>(command: Command<TPayload, TResult>) => {
          const dispose = commands.register(command);
          disposers.push(dispose);
          return dispose;
        },
        execute: <TPayload, TResult>(commandId: string, payload: TPayload) => commands.execute<TPayload, TResult>(commandId, payload),
        list: () => commands.list(),
      },
      events: {
        on: <TPayload>(eventName: string, handler: EventHandler<TPayload>) => {
          const dispose = events.on(eventName, handler);
          disposers.push(dispose);
          return dispose;
        },
      },
      settings,
      metadataSources,
      translationSources,
      aiProviders,
    };
    const pluginDispose = plugin.activate(context);
    if (pluginDispose) disposers.push(pluginDispose);
    const registered = {
      id: plugin.id,
      name: plugin.name,
      dispose: () => {
        while (disposers.length) disposers.pop()?.();
        plugins.delete(plugin.id);
        events.emit('plugin.disposed', { id: plugin.id });
      },
    };
    plugins.set(plugin.id, registered);
    events.emit('plugin.registered', { id: plugin.id, name: plugin.name });
    return registered;
  };

  return {
    version: '0.1.0',
    events,
    commands,
    documents: documentStore,
    scenes: sceneRegistry,
    settings,
    metadataSources,
    translationSources,
    aiProviders,
    plugins,
    registerPlugin,
    library: {
      mode: 'single',
      root: 'AsterData',
      database: 'AsterData/aster.db',
      filesRoot: 'AsterData/files/papers',
      importPolicy: 'copy',
    },
  };
}
