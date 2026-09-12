import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';
import { builtinWorkbenchPanels } from './workbench';

const defaultReaderScene: SceneContribution = {
  id: 'reader',
  label: '阅读',
  icon: 'R',
  key: '3',
  pluginId: 'reader.core',
  scope: 'research',
  sidebarMode: 'workspace',
  supportsOpenItems: true,
  defaultSidebarPanel: 'reader.documents',
  resourceKinds: ['pdf'],
  enabledByDefault: true,
};

/** First-party reader scene; PDF panels and reader settings belong to this owner. */
export function createReaderPlugin(scene: SceneContribution = defaultReaderScene): AsterPlugin {
  return createBuiltinScenePlugin({ ...defaultReaderScene, ...scene, pluginId: 'reader.core' }, {
    view: { id: 'reader.core.view' },
    sidebar: { id: 'reader.documents' },
    workbenchPanels: builtinWorkbenchPanels.filter((panel) => panel.sceneId === 'reader').map((panel) => ({ ...panel, source: 'plugin:reader.core' })),
    resourceOpeners: [{
      id: 'reader.pdf',
      kind: 'pdf',
      title: '打开 PDF 阅读器',
      sceneId: 'reader',
      tabKind: 'pdf',
      priority: 100,
      open: ({ uri, title }) => ({ kind: 'pdf', title: title ?? 'PDF', state: { uri } }),
    }],
  });
}

export const readerPlugin: AsterPlugin = createReaderPlugin();
