import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';

const defaultLibraryScene: SceneContribution = {
  id: 'library',
  label: '文献库',
  icon: 'L',
  key: '2',
  pluginId: 'library.core',
  scope: 'research',
  sidebarMode: 'workspace',
  defaultSidebarPanel: 'library.documents',
  enabledByDefault: true,
};

/** The library surface is a first-party plugin so it can be disabled independently. */
export function createLibraryPlugin(scene: SceneContribution = defaultLibraryScene): AsterPlugin {
  const scenePlugin = createBuiltinScenePlugin({ ...defaultLibraryScene, ...scene, pluginId: 'library.core' }, {
    view: { id: 'library.core.view' },
    sidebar: { id: 'library.documents' },
  });
  return {
    ...scenePlugin,
    id: 'library.core',
    name: 'A4 Note 文献库',
    manifest: {
      id: 'library.core',
      name: 'A4 Note 文献库',
      version: '1.0.0',
      distribution: 'builtin',
      permissions: ['workbench', 'commands', 'events', 'providers', 'settings', 'resources', 'scenes'],
    },
    activate: (context) => {
      scenePlugin.activate(context);
      context.settings.register({
        id: 'library.core.defaultSort',
        title: '文献库默认排序',
        description: '打开文献库时使用的默认排序方式。',
        defaultValue: 'recent',
        sceneId: 'library',
      });
      context.workbenchPanels.register({
        id: 'library.details',
        sceneId: 'library',
        area: 'right',
        commandId: 'library.panel.details',
        titleKey: 'library.details',
        icon: 'details',
        order: 10,
        source: 'plugin:library.core',
        context: 'paper',
      });
      context.resourceOpeners.register({
        id: 'library.pdf',
        kind: 'pdf',
        sceneId: 'library',
        tabKind: 'pdf',
        priority: 10,
        title: '打开文献 PDF',
        open: ({ uri, title }) => ({ kind: 'pdf', uri, title: title ?? 'PDF' }),
      });
    },
  };
}

export const libraryPlugin: AsterPlugin = createLibraryPlugin();
