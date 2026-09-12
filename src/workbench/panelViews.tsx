import type { ReactNode } from 'react';
import type { PaperDocument, WorkbenchPanelContribution } from '../core/types';

/** Runtime context for a trusted UI adapter owned by a workbench panel plugin. */
export interface WorkbenchPanelViewContext {
  panel: WorkbenchPanelContribution;
  sceneId: string;
  selectedPaper: PaperDocument | null;
}

/**
 * UI is deliberately a separate contribution from the core panel metadata.
 * This keeps the core package React-free and gives external plugins a clear
 * place to attach a future sandboxed renderer.
 */
export interface WorkbenchPanelViewContribution {
  id: string;
  sceneId: string;
  pluginId: string;
  render: (context: WorkbenchPanelViewContext) => ReactNode;
  open?: (context: WorkbenchPanelViewContext) => void;
}

export interface WorkbenchPanelViewRegistry {
  register: (view: WorkbenchPanelViewContribution) => () => void;
  get: (panelId: string) => WorkbenchPanelViewContribution | undefined;
  list: () => WorkbenchPanelViewContribution[];
}

export function createWorkbenchPanelViewRegistry(initialViews: WorkbenchPanelViewContribution[] = []): WorkbenchPanelViewRegistry {
  const views = new Map<string, WorkbenchPanelViewContribution>();
  initialViews.forEach(registerView);

  return {
    register: registerView,
    get: (panelId) => views.get(panelId),
    list: () => Array.from(views.values()).sort((left, right) => left.sceneId.localeCompare(right.sceneId) || left.id.localeCompare(right.id)),
  };

  function registerView(view: WorkbenchPanelViewContribution) {
    if (!view.id.trim() || !view.sceneId.trim() || !view.pluginId.trim()) {
      throw new Error('Workbench panel view contribution requires id, sceneId and pluginId');
    }
    if (views.has(view.id)) throw new Error(`Workbench panel view already registered: ${view.id}`);
    views.set(view.id, view);
    return () => views.delete(view.id);
  }
}
