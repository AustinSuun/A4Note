import type {
  AsterPlugin,
  SceneContribution,
  SceneSidebarRegistration,
  SceneViewRegistration,
  WorkbenchPanelContribution,
  ResourceOpenerContribution,
} from './types';

/**
 * First-party scene ids are stable, namespaced plugin ids. The host owns these
 * definitions, but registers them through the same lifecycle used by local and
 * market plugins so enable/disable and discovery stay consistent.
 */
const builtinPluginIds: Record<string, string> = {
  overview: 'overview.core',
  library: 'library.core',
  reader: 'reader.core',
  aiChat: 'ai.core',
  markdown: 'markdown.core',
};

const builtinPluginNames: Record<string, string> = {
  overview: 'A4 Note 总览',
  library: 'A4 Note 文献库',
  reader: 'A4 Note 阅读器',
  aiChat: 'A4 Note AI 对话',
  markdown: 'A4 Note Markdown',
};

export function builtinScenePluginId(sceneId: string) {
  return builtinPluginIds[sceneId] ?? `scene.${sceneId}.core`;
}

export interface BuiltinScenePluginOptions {
  view?: Omit<SceneViewRegistration, 'sceneId' | 'pluginId'> & { sceneId?: string; pluginId?: string };
  sidebar?: Omit<SceneSidebarRegistration, 'sceneId' | 'pluginId'> & { sceneId?: string; pluginId?: string };
  workbenchPanels?: WorkbenchPanelContribution[];
  resourceOpeners?: ResourceOpenerContribution[];
}

export function createBuiltinScenePlugin(scene: SceneContribution, options: BuiltinScenePluginOptions = {}): AsterPlugin {
  const pluginId = scene.pluginId ?? builtinScenePluginId(scene.id);
  const name = builtinPluginNames[scene.id] ?? `${scene.label} 场景`;
  const normalizedScene: SceneContribution = {
    ...scene,
    pluginId,
    source: `plugin:${pluginId}`,
    enabledByDefault: scene.enabledByDefault ?? true,
  };
  return {
    id: pluginId,
    name,
    manifest: {
      id: pluginId,
      name,
      version: '1.0.0',
      distribution: 'builtin',
      permissions: ['scenes', ...(options.workbenchPanels?.length ? ['workbench' as const] : []), ...(options.resourceOpeners?.length ? ['resources' as const] : [])],
    },
    activate: (context) => {
      context.scenes.register(normalizedScene);
      if (options.view) {
        context.sceneViews.register({
          id: options.view.id,
          sceneId: options.view.sceneId ?? normalizedScene.id,
          pluginId: options.view.pluginId ?? pluginId,
          renderer: options.view.renderer,
        });
      }
      if (options.sidebar) {
        context.sceneSidebars.register({
          id: options.sidebar.id,
          sceneId: options.sidebar.sceneId ?? normalizedScene.id,
          pluginId: options.sidebar.pluginId ?? pluginId,
          renderer: options.sidebar.renderer,
        });
      }
      for (const panel of options.workbenchPanels ?? []) {
        context.workbenchPanels.register({ ...panel, source: panel.source ?? `plugin:${pluginId}` });
      }
      for (const opener of options.resourceOpeners ?? []) {
        context.resourceOpeners.register({ ...opener, pluginId: opener.pluginId ?? pluginId });
      }
    },
  };
}

export function createBuiltinScenePlugins(scenes: SceneContribution[]) {
  const seen = new Set<string>();
  return scenes
    .filter((scene) => {
      const pluginId = scene.pluginId ?? builtinScenePluginId(scene.id);
      if (seen.has(pluginId)) return false;
      seen.add(pluginId);
      return true;
    })
    .map((scene) => createBuiltinScenePlugin(scene));
}
