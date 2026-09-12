import type {
  AsterPlugin,
  AsterPluginManifest,
  DeclarativeViewRenderer,
  PluginViewBlock,
  SceneContribution,
  SettingContribution,
  WorkbenchPanelContribution,
} from './types';

/** Versioned, JSON-only payload accepted from third-party plugin packages. */
export interface DeclarativePluginPayload {
  schema: 1;
  scenes?: Array<{
    scene: SceneContribution;
    view?: DeclarativeViewRenderer;
    sidebar?: { id: string; renderer: DeclarativeViewRenderer };
    panels?: Array<Omit<WorkbenchPanelContribution, 'source'> & { id: `plugin:${string}` }>;
    settings?: SettingContribution[];
    resourceOpeners?: Array<{
      id: `plugin:${string}`;
      kind: string;
      title: string;
      sceneId?: string;
      tabKind?: string;
      priority?: number;
      extensions?: string[];
      schemes?: string[];
      renderer?: DeclarativeViewRenderer;
    }>;
  }>;
}

const allowedBlockTypes = new Set<PluginViewBlock['type']>(['heading', 'paragraph', 'text', 'list', 'link']);

/** Parse and normalize the payload before it reaches the plugin lifecycle. */
export function parseDeclarativePluginPayload(input: unknown): DeclarativePluginPayload {
  if (!isRecord(input) || input.schema !== 1 || !Array.isArray(input.scenes)) {
    throw new Error('插件运行时协议必须是 declarative-v1 场景包');
  }
  const scenes = input.scenes.map((raw, index) => parseSceneEntry(raw, index));
  if (!scenes.length) throw new Error('插件至少需要贡献一个场景');
  return { schema: 1, scenes };
}

export function parseDeclarativePluginPayloadText(payload: string) {
  try {
    return parseDeclarativePluginPayload(JSON.parse(payload));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('插件运行时 payload 不是有效 JSON');
    throw error;
  }
}

/** Turn a validated JSON payload into a normal host plugin. No code is eval'ed. */
export function createDeclarativePlugin(manifest: AsterPluginManifest, payload: DeclarativePluginPayload): AsterPlugin {
  return {
    id: manifest.id,
    name: manifest.name,
    manifest,
    activate: (context) => {
      const disposers: Array<() => void> = [];
      for (const entry of payload.scenes ?? []) {
        disposers.push(context.scenes.register({ ...entry.scene, pluginId: manifest.id, source: `plugin:${manifest.id}` }));
        if (entry.view) {
          disposers.push(context.sceneViews.register({
            id: `${manifest.id}.view.${entry.scene.id}`,
            sceneId: entry.scene.id,
            pluginId: manifest.id,
            renderer: entry.view,
          }));
        }
        if (entry.sidebar) {
          disposers.push(context.sceneSidebars.register({
            id: entry.sidebar.id,
            sceneId: entry.scene.id,
            pluginId: manifest.id,
            renderer: entry.sidebar.renderer,
          }));
        }
        for (const panel of entry.panels ?? []) {
          disposers.push(context.workbenchPanels.register({ ...panel, source: `plugin:${manifest.id}` }));
        }
        for (const setting of entry.settings ?? []) {
          disposers.push(context.settings.register({ ...setting, pluginId: manifest.id, sceneId: setting.sceneId ?? entry.scene.id }));
        }
        for (const opener of entry.resourceOpeners ?? []) {
          disposers.push(context.resourceOpeners.register({
            ...opener,
            sceneId: opener.sceneId ?? entry.scene.id,
            pluginId: manifest.id,
          }));
        }
      }
      return () => disposers.reverse().forEach((dispose) => dispose());
    },
  };
}

function parseSceneEntry(input: unknown, index: number) {
  if (!isRecord(input) || !isRecord(input.scene)) throw new Error(`插件场景 ${index + 1} 缺少 scene`);
  let scene = parseScene(input.scene, index);
  const view = input.view === undefined ? undefined : parseRenderer(input.view, `场景 ${scene.id} 视图`);
  let sidebar: { id: string; renderer: DeclarativeViewRenderer } | undefined;
  if (input.sidebar !== undefined) {
    if (!isRecord(input.sidebar) || typeof input.sidebar.id !== 'string' || !input.sidebar.id.trim()) throw new Error(`场景 ${scene.id} 侧栏无效`);
    sidebar = { id: input.sidebar.id, renderer: parseRenderer(input.sidebar.renderer, `场景 ${scene.id} 侧栏`) };
  }
  // Bind a contextual sidebar to its scene by default. Explicit references
  // must point to the sidebar declared by this scene entry.
  if (sidebar) {
    if (scene.defaultSidebarPanel && scene.defaultSidebarPanel !== sidebar.id) {
      throw new Error(`场景 ${scene.id} 默认侧栏必须指向 ${sidebar.id}`);
    }
    scene = { ...scene, defaultSidebarPanel: sidebar.id };
  } else if (scene.defaultSidebarPanel) {
    throw new Error(`场景 ${scene.id} 引用了未定义的默认侧栏`);
  }
  const panels = input.panels === undefined ? undefined : parsePanels(input.panels, scene.id);
  const settings = input.settings === undefined ? undefined : parseSettings(input.settings, scene.id);
  const resourceOpeners = input.resourceOpeners === undefined ? undefined : parseResourceOpeners(input.resourceOpeners, scene.id);
  return { scene, view, sidebar, panels, settings, resourceOpeners };
}

function parseResourceOpeners(input: unknown, sceneId: string) {
  if (!Array.isArray(input)) throw new Error(`场景 ${sceneId} resourceOpeners 必须是数组`);
  return input.slice(0, 16).map((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.kind !== 'string' || typeof raw.title !== 'string') {
      throw new Error(`场景 ${sceneId} 资源打开器 ${index + 1} 无效`);
    }
    if (!raw.id.startsWith('plugin:')) throw new Error(`插件资源打开器 ID 必须以 plugin: 开头`);
    if (raw.sceneId !== undefined && raw.sceneId !== sceneId) throw new Error(`资源打开器必须绑定当前场景: ${sceneId}`);
    return {
      id: raw.id as `plugin:${string}`,
      kind: limitText(raw.kind, 80),
      title: limitText(raw.title, 120),
      sceneId,
      tabKind: typeof raw.tabKind === 'string' ? limitText(raw.tabKind, 80) : undefined,
      extensions: parseMatchers(raw.extensions, 32),
      schemes: parseMatchers(raw.schemes, 16),
      priority: typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 0,
      renderer: raw.renderer === undefined ? undefined : parseRenderer(raw.renderer, `场景 ${sceneId} 资源打开器 ${index + 1}`),
    };
  });
}

function parseMatchers(input: unknown, max: number) {
  if (!Array.isArray(input)) return undefined;
  const values = input
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => limitText(value.trim().replace(/^\./, '').replace(/:$/, '').toLowerCase(), 80));
  return Array.from(new Set(values)).slice(0, max);
}

function parseScene(input: Record<string, unknown>, index: number): SceneContribution {
  for (const key of ['id', 'label', 'icon', 'key']) if (typeof input[key] !== 'string' || !String(input[key]).trim()) throw new Error(`插件场景 ${index + 1} 缺少 ${key}`);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(input.id as string)) throw new Error(`插件场景 ID 无效: ${input.id}`);
  return {
    id: input.id as string,
    label: limitText(input.label as string, 80),
    icon: limitText(input.icon as string, 8),
    key: limitText(input.key as string, 8),
    scope: input.scope === 'research' || input.scope === 'workspace' || input.scope === 'custom' ? input.scope : 'custom',
    sidebarMode: input.sidebarMode === 'contextual' || input.sidebarMode === 'workspace' || input.sidebarMode === 'scene' || input.sidebarMode === 'none' ? input.sidebarMode : 'scene',
    defaultSidebarPanel: typeof input.defaultSidebarPanel === 'string' ? input.defaultSidebarPanel : undefined,
    supportsOpenItems: input.supportsOpenItems === true,
    resourceKinds: Array.isArray(input.resourceKinds) ? input.resourceKinds.filter((kind): kind is string => typeof kind === 'string').slice(0, 16) : undefined,
    enabledByDefault: input.enabledByDefault !== false,
  };
}

function parseRenderer(input: unknown, label: string): DeclarativeViewRenderer {
  if (!isRecord(input) || input.kind !== 'declarative' || !Array.isArray(input.blocks)) throw new Error(`${label}必须使用 declarative 渲染器`);
  const blocks = input.blocks.map((block, index) => parseBlock(block, `${label}第 ${index + 1} 项`));
  return {
    kind: 'declarative',
    title: typeof input.title === 'string' ? limitText(input.title, 120) : undefined,
    description: typeof input.description === 'string' ? limitText(input.description, 240) : undefined,
    blocks,
  };
}

function parseBlock(input: unknown, label: string): PluginViewBlock {
  if (!isRecord(input) || typeof input.type !== 'string' || !allowedBlockTypes.has(input.type as PluginViewBlock['type'])) throw new Error(`${label}类型不受支持`);
  if (input.type === 'list') {
    if (!Array.isArray(input.items)) throw new Error(`${label}缺少 items`);
    return { type: 'list', items: input.items.filter((item): item is string => typeof item === 'string').slice(0, 100).map((item) => limitText(item, 500)) };
  }
  if (typeof input.text !== 'string') throw new Error(`${label}缺少 text`);
  if (input.type === 'link') {
    if (typeof input.href !== 'string' || !/^https?:\/\//i.test(input.href)) throw new Error(`${label}仅允许 http/https 链接`);
    return { type: 'link', text: limitText(input.text, 500), href: input.href.slice(0, 2000) };
  }
  if (input.type === 'heading') return { type: 'heading', text: limitText(input.text, 500), level: input.level === 1 || input.level === 3 ? input.level : 2 };
  return { type: input.type as 'paragraph' | 'text', text: limitText(input.text, 1000) };
}

function parsePanels(input: unknown, sceneId: string) {
  if (!Array.isArray(input)) throw new Error(`场景 ${sceneId} panels 必须是数组`);
  return input.slice(0, 16).map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`场景 ${sceneId} 面板 ${index + 1} 无效`);
    const required = ['id', 'area', 'commandId', 'titleKey', 'icon', 'order', 'context'];
    for (const key of required) if (raw[key] === undefined) throw new Error(`场景 ${sceneId} 面板缺少 ${key}`);
    if (typeof raw.id !== 'string' || !raw.id.startsWith('plugin:')) throw new Error(`插件面板 ID 必须以 plugin: 开头`);
    if (!['left', 'right', 'bottom', 'center'].includes(String(raw.area))) throw new Error(`插件面板区域无效`);
    if (!['global', 'paper', 'selection', 'workspace'].includes(String(raw.context))) throw new Error(`插件面板上下文无效`);
    return {
      id: raw.id as `plugin:${string}`,
      sceneId,
      area: raw.area as WorkbenchPanelContribution['area'],
      commandId: limitText(String(raw.commandId), 100),
      titleKey: limitText(String(raw.titleKey), 120),
      icon: limitText(String(raw.icon), 32),
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : index,
      context: raw.context as WorkbenchPanelContribution['context'],
      defaultOpen: raw.defaultOpen === true,
      renderer: parseRenderer(raw.renderer, `场景 ${sceneId} 面板 ${index + 1}`),
    };
  });
}

function parseSettings(input: unknown, sceneId: string) {
  if (!Array.isArray(input)) throw new Error(`场景 ${sceneId} settings 必须是数组`);
  return input.slice(0, 64).map((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') throw new Error(`场景 ${sceneId} 设置 ${index + 1} 无效`);
    if (!raw.id.startsWith(`${sceneId}.`)) throw new Error(`插件设置 ID 必须以场景 ID 开头`);
    const value = raw.defaultValue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`插件设置默认值无效: ${raw.id}`);
    return {
      id: raw.id,
      title: limitText(raw.title, 120),
      defaultValue: value as string | number | boolean,
      description: typeof raw.description === 'string' ? limitText(raw.description, 240) : undefined,
      options: Array.isArray(raw.options) ? raw.options.slice(0, 32).filter((option): option is { value: string; label: string } => isRecord(option) && typeof option.value === 'string' && typeof option.label === 'string').map((option) => ({ value: limitText(option.value, 100), label: limitText(option.label, 120) })) : undefined,
      sceneId,
    } satisfies SettingContribution;
  });
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function limitText(value: string, max: number) { return value.trim().slice(0, max); }
