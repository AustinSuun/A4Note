import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';

const defaultAiScene: SceneContribution = {
  id: 'aiChat',
  label: 'AI 对话',
  icon: 'A',
  key: '4',
  pluginId: 'ai.core',
  scope: 'workspace',
  sidebarMode: 'workspace',
  supportsOpenItems: true,
  defaultSidebarPanel: 'ai.sessions',
  enabledByDefault: true,
};

/** First-party AI scene; provider and conversation settings belong here. */
export function createAiPlugin(scene: SceneContribution = defaultAiScene): AsterPlugin {
  return createBuiltinScenePlugin({ ...defaultAiScene, ...scene, pluginId: 'ai.core' }, {
    view: { id: 'ai.core.view' },
    sidebar: { id: 'ai.sessions' },
  });
}

export const aiPlugin: AsterPlugin = createAiPlugin();
