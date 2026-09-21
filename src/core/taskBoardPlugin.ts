import { createBuiltinScenePlugin } from './builtinScenePlugins';
import type { AsterPlugin, SceneContribution } from './types';
const defaultScene: SceneContribution = {
  id: 'tasks',
  label: '任务',
  icon: 'T',
  key: '6',
  pluginId: 'tasks.core',
  scope: 'workspace',
  sidebarMode: 'workspace',
  defaultSidebarPanel: 'tasks.projects',
  enabledByDefault: false,
};
/** Platform-neutral task tracking only; does not launch or control agent software. */
export function createTaskBoardPlugin(
  scene: SceneContribution = defaultScene,
): AsterPlugin {
  return createBuiltinScenePlugin(
    { ...defaultScene, ...scene, pluginId: 'tasks.core' },
    {
      view: { id: 'tasks.core.view' },
      sidebar: { id: 'tasks.projects' },
    },
  );
}
