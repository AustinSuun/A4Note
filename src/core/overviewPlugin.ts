import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';

const defaultOverviewScene: SceneContribution = {
  id: 'overview',
  label: '总览',
  icon: 'O',
  key: '1',
  pluginId: 'overview.core',
  scope: 'workspace',
  sidebarMode: 'scene',
  enabledByDefault: true,
};

/** First-party overview scene; future overview settings belong here. */
export function createOverviewPlugin(scene: SceneContribution = defaultOverviewScene): AsterPlugin {
  return createBuiltinScenePlugin({ ...defaultOverviewScene, ...scene, pluginId: 'overview.core' }, {
    view: { id: 'overview.core.view' },
  });
}

export const overviewPlugin: AsterPlugin = createOverviewPlugin();
