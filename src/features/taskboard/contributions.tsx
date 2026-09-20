import type { SceneViewContribution, SceneSidebarViewContribution } from '../../workbench';
import { TaskShellSidebarHost } from './TaskShellSidebar';
import { TaskBoard } from './TaskBoard';
export function createTaskBoardSidebarContribution(): SceneSidebarViewContribution {
  return { id: 'tasks.projects', sceneId: 'tasks', pluginId: 'tasks.core', render: () => <TaskShellSidebarHost /> };
}
export function createTaskBoardSceneContribution(): SceneViewContribution {
  return {
    id: 'tasks.core.view',
    sceneId: 'tasks',
    pluginId: 'tasks.core',
    render: () => <TaskBoard />,
  };
}
