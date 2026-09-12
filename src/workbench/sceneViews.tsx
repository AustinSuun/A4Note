import type { ReactNode } from 'react';
import type { WorkspaceTab } from '../core/workspace';

/** Runtime context passed to a scene view by the workbench host. */
export interface SceneViewContext {
  sceneId: string;
  tab: WorkspaceTab;
}

/** UI contribution owned by the plugin that registered the scene. */
export interface SceneViewContribution {
  id: string;
  sceneId: string;
  pluginId: string;
  render: (context: SceneViewContext) => ReactNode;
}

export interface SceneViewRegistry {
  register: (view: SceneViewContribution) => () => void;
  get: (sceneId: string) => SceneViewContribution | undefined;
  list: () => SceneViewContribution[];
}

export interface SceneSidebarViewContext {
  sceneId: string;
  panelId: string;
}

export interface SceneSidebarViewContribution {
  id: string;
  sceneId: string;
  pluginId: string;
  render: (context: SceneSidebarViewContext) => ReactNode;
}

export interface SceneSidebarViewRegistry {
  register: (view: SceneSidebarViewContribution) => () => void;
  get: (panelId: string) => SceneSidebarViewContribution | undefined;
  list: () => SceneSidebarViewContribution[];
}

/**
 * The core registry intentionally knows nothing about React components. The
 * host assembles built-in views at the UI boundary, while external plugins can
 * later provide a sandboxed view adapter without importing feature modules.
 */
export function createSceneViewRegistry(initialViews: SceneViewContribution[] = []): SceneViewRegistry {
  const views = new Map<string, SceneViewContribution>();
  for (const view of initialViews) registerView(view);

  return {
    register: registerView,
    // Scene ids are the host lookup key; contribution ids remain unique
    // lifecycle identities and intentionally stay opaque to the workbench.
    get: (sceneId) => Array.from(views.values()).find((view) => view.sceneId === sceneId),
    list: () => Array.from(views.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId)),
  };

  function registerView(view: SceneViewContribution) {
    if (!view.id.trim() || !view.sceneId.trim() || !view.pluginId.trim()) throw new Error('Scene view contribution requires id, sceneId and pluginId');
    if (views.has(view.id)) throw new Error(`Scene view already registered: ${view.id}`);
    if (Array.from(views.values()).some((candidate) => candidate.sceneId === view.sceneId)) throw new Error(`Scene view already registered for scene: ${view.sceneId}`);
    views.set(view.id, view);
    return () => views.delete(view.id);
  }
}

/** Scene-owned contextual sidebar views use the same lifecycle and identity rules. */
export function createSceneSidebarViewRegistry(initialViews: SceneSidebarViewContribution[] = []): SceneSidebarViewRegistry {
  const views = new Map<string, SceneSidebarViewContribution>();
  for (const view of initialViews) registerView(view);

  return {
    register: registerView,
    get: (panelId) => views.get(panelId),
    list: () => Array.from(views.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId) || left.id.localeCompare(right.id)),
  };

  function registerView(view: SceneSidebarViewContribution) {
    if (!view.id.trim() || !view.sceneId.trim() || !view.pluginId.trim()) throw new Error('Scene sidebar view contribution requires id, sceneId and pluginId');
    if (views.has(view.id)) throw new Error(`Scene sidebar view already registered: ${view.id}`);
    views.set(view.id, view);
    return () => views.delete(view.id);
  }
}
