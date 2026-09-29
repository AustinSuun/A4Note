import type { SidebarSceneItem } from './ProjectSidebar';

export type SidebarSceneGroupId = 'research' | 'workspace' | 'custom';

/** Group labels shared by the sidebar scene picker and the edge scene switcher. */
export const SIDEBAR_SCENE_GROUP_LABELS: Record<SidebarSceneGroupId, string> = {
  research: '科研阅读',
  workspace: '工作区',
  custom: '插件场景',
};

export interface SidebarSceneGroup<T> {
  id: SidebarSceneGroupId;
  label: string;
  items: T[];
}

/** Splits scenes by scope in a fixed order; empty groups are dropped. Unknown scopes are plugin scenes. */
export function groupSidebarScenes<T extends Pick<SidebarSceneItem, 'scope'>>(scenes: readonly T[]): SidebarSceneGroup<T>[] {
  const groups: SidebarSceneGroup<T>[] = [
    { id: 'research', label: SIDEBAR_SCENE_GROUP_LABELS.research, items: scenes.filter((scene) => scene.scope === 'research') },
    { id: 'workspace', label: SIDEBAR_SCENE_GROUP_LABELS.workspace, items: scenes.filter((scene) => scene.scope === 'workspace') },
    { id: 'custom', label: SIDEBAR_SCENE_GROUP_LABELS.custom, items: scenes.filter((scene) => scene.scope !== 'research' && scene.scope !== 'workspace') },
  ];
  return groups.filter((group) => group.items.length > 0);
}
