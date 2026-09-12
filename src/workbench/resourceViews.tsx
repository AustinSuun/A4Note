import type { ReactNode } from 'react';
import type { DeclarativeViewRenderer, ResourceOpenerContribution } from '../core/types';
import type { WorkspaceTab } from '../core/workspace';

/** Runtime context passed to a resource renderer at the UI boundary. */
export interface ResourceViewContext {
  opener: ResourceOpenerContribution;
  tab: WorkspaceTab;
  sceneId: string | null;
}

/** UI adapter owned by the plugin that registered a resource opener. */
export interface ResourceViewContribution {
  id: string;
  openerId: string;
  pluginId: string;
  render: (context: ResourceViewContext) => ReactNode;
}

export interface ResourceViewRegistry {
  register: (view: ResourceViewContribution) => () => void;
  get: (openerId: string) => ResourceViewContribution | undefined;
  list: () => ResourceViewContribution[];
}

export interface ResourceViewResolution {
  views: ResourceViewContribution[];
  missingResourceViewIds: string[];
  diagnostics: string[];
}

/**
 * Bind live opener registrations to host-owned views without crossing plugin
 * ownership boundaries. The declarative callback is supplied by the UI host so
 * this workbench module remains independent of React and plugin payload policy.
 */
export function resolveResourceViewContributions(
  openers: readonly ResourceOpenerContribution[],
  candidates: readonly ResourceViewContribution[],
  isPluginActive: (pluginId: string) => boolean,
  renderDeclarative: (renderer: DeclarativeViewRenderer) => ReactNode,
): ResourceViewResolution {
  const views = openers.flatMap((opener) => {
    if (!opener.pluginId || !isPluginActive(opener.pluginId)) return [];
    const candidate = candidates.find((view) => view.openerId === opener.id
      && view.pluginId === opener.pluginId
      && isPluginActive(view.pluginId));
    if (candidate) return [candidate];
    if (opener.renderer) {
      return [{
        id: `${opener.id}.declarative`,
        openerId: opener.id,
        pluginId: opener.pluginId,
        render: () => renderDeclarative(opener.renderer!),
      }];
    }
    return [];
  });
  const missingResourceViewIds = openers
    .filter((opener) => !views.some((view) => view.openerId === opener.id))
    .map((opener) => opener.id);
  const diagnostics = openers
    .filter((opener) => opener.pluginId && isPluginActive(opener.pluginId) && !views.some((view) => view.openerId === opener.id))
    .map((opener) => `resource opener ${opener.id} (${opener.kind}) has no active host adapter`);
  return { views, missingResourceViewIds, diagnostics };
}

/**
 * Resource renderers use opener ids as their lifecycle key. A plugin may own
 * multiple openers, but only one UI adapter can claim each opener, which keeps
 * routing deterministic when an extension is opened from different surfaces.
 */
export function createResourceViewRegistry(initialViews: ResourceViewContribution[] = []): ResourceViewRegistry {
  const views = new Map<string, ResourceViewContribution>();
  initialViews.forEach(registerView);

  return {
    register: registerView,
    get: (openerId) => views.get(openerId),
    list: () => Array.from(views.values()).sort((left, right) => left.openerId.localeCompare(right.openerId)),
  };

  function registerView(view: ResourceViewContribution) {
    if (!view.id.trim() || !view.openerId.trim() || !view.pluginId.trim()) {
      throw new Error('Resource view contribution requires id, openerId and pluginId');
    }
    if (views.has(view.openerId)) throw new Error(`Resource view already registered for opener: ${view.openerId}`);
    views.set(view.openerId, view);
    return () => views.delete(view.openerId);
  }
}
