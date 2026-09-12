import type { ReactNode } from 'react';
import { resolveResourceViewContributions, type ResourceViewContribution, type SceneSidebarViewContribution, type SceneViewContribution, type WorkbenchPanelViewContribution } from '../workbench';
import type { DeclarativeViewRenderer, PluginViewBlock, SceneSidebarRegistration, SceneViewRegistration } from '../core/types';
import type { PaperDocument, ReaderSidePanelTab, WorkbenchPanelContribution } from '../core/types';
import { selectPluginLifecycleFallbacks } from '../core/pluginBindings';
import {
  createAiSceneContributions,
  type AiSceneContributionProps,
} from '../features/ai';
import {
  createLibrarySceneContribution,
  createLibrarySidebarContribution,
} from '../features/library';
import {
  createMarkdownSceneContributions,
  type MarkdownSceneContributionProps,
} from '../features/markdown';
import { createOverviewSceneContribution } from '../features/overview';
import {
  createReaderSceneContribution,
  createReaderPanelViewContributions,
  createReaderResourceViewContribution,
  createReaderSidebarContribution,
  type ReaderSceneContributionProps,
} from '../features/reader';
import type { ReaderSidePanelContentProps } from '../features/reader';
import { LibraryDetailPanel } from '../features/library/LibraryDetailPanel';
import type { LibraryDetailPanelProps } from '../features/library/types';

/**
 * Runtime inputs for first-party scene adapters.
 *
 * Core owns the plugin identities and lifecycle, while this UI-only module
 * owns the React boundary. Keeping the adapter construction here means the
 * application shell does not need to know which feature component implements
 * a scene or its contextual sidebar.
 */
export interface BuiltinSceneUiRuntime {
  overview: Parameters<typeof createOverviewSceneContribution>[0];
  library: Parameters<typeof createLibrarySceneContribution>[0];
  librarySidebar: Parameters<typeof createLibrarySidebarContribution>[0];
  reader: ReaderSceneContributionProps;
  readerSidebar: Parameters<typeof createReaderSidebarContribution>[0];
  ai: AiSceneContributionProps;
  markdown: MarkdownSceneContributionProps;
  /** Panel metadata comes from the live core registry. */
  panels: WorkbenchPanelContribution[];
  libraryPanel: Omit<LibraryDetailPanelProps, 'paper'> & {
    paper: PaperDocument | null;
    onOpen: () => void;
  };
  readerPanel: Omit<ReaderSidePanelContentProps, 'tab' | 'paper'> & {
    onOpen: (tab: ReaderSidePanelTab) => void;
  };
  readerResource?: Parameters<typeof createReaderResourceViewContribution>[0];
}

export interface SceneUiContributions {
  views: SceneViewContribution[];
  sidebars: SceneSidebarViewContribution[];
  panelViews: WorkbenchPanelViewContribution[];
  resourceViews: ResourceViewContribution[];
}

export interface ResolvedSceneUiContributions extends SceneUiContributions {
  missingViewIds: string[];
  missingSidebarIds: string[];
  missingPanelViewIds: string[];
  missingResourceViewIds: string[];
  /** Human-readable binding failures for diagnostics and support reports. */
  diagnostics: string[];
}

type ContributionIdentity = {
  id: string;
  sceneId: string;
  pluginId: string;
};

/**
 * Resolve a host adapter without allowing ownership to cross an active plugin
 * boundary. A contribution id is globally unique in the runtime registry, so
 * the scene/id fallback is safe for older adapters that kept the same owner
 * but used a slightly different registration snapshot. The registration owner
 * and adapter owner must both still be active; ownership is never inferred
 * from a matching scene alone.
 */
function findOwnedCandidate<T extends ContributionIdentity>(
  registration: ContributionIdentity,
  candidates: T[],
  isPluginActive: (pluginId: string) => boolean,
) {
  if (!isPluginActive(registration.pluginId)) return undefined;
  const activeCandidates = candidates.filter((candidate) => isPluginActive(candidate.pluginId));
  return activeCandidates.find((candidate) => candidate.id === registration.id
    && candidate.sceneId === registration.sceneId
    && candidate.pluginId === registration.pluginId)
    // Keep the compatibility fallback explicitly ownership-bound. This is
    // intentionally redundant for current registrations, but protects older
    // adapters that may have been reconstructed from a stale object identity.
    ?? activeCandidates.find((candidate) => candidate.id === registration.id
      && candidate.sceneId === registration.sceneId
      && candidate.pluginId === registration.pluginId);
}

/** Render the JSON-only external plugin protocol using host-owned elements. */
export function renderDeclarativeView(renderer: DeclarativeViewRenderer): ReactNode {
  return <div className="plugin-declarative-view">
    {renderer.title && <h2>{renderer.title}</h2>}
    {renderer.description && <p className="scene-description">{renderer.description}</p>}
    {renderer.blocks.map((block, index) => <DeclarativeBlock key={`${block.type}-${index}`} block={block} />)}
  </div>;
}

function DeclarativeBlock({ block }: { block: PluginViewBlock }) {
  if (block.type === 'heading') return block.level === 1 ? <h1>{block.text}</h1> : block.level === 3 ? <h3>{block.text}</h3> : <h2>{block.text}</h2>;
  if (block.type === 'paragraph') return <p>{block.text}</p>;
  if (block.type === 'list') return <ul>{block.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>;
  if (block.type === 'link') return <p><a href={block.href} target="_blank" rel="noreferrer">{block.text}</a></p>;
  return <span>{block.text}</span>;
}

/** Resolve panel UI adapters against the live panel and plugin registries. */
export function resolveWorkbenchPanelViewContributions(
  panels: WorkbenchPanelContribution[],
  candidates: WorkbenchPanelViewContribution[],
  isPluginActive: (pluginId: string) => boolean,
) {
  return panels.flatMap((panel) => {
    const ownerPluginId = panel.source.startsWith('plugin:') ? panel.source.slice('plugin:'.length) : null;
    const candidate = ownerPluginId
      ? findOwnedCandidate({ id: panel.id, sceneId: panel.sceneId, pluginId: ownerPluginId }, candidates, isPluginActive)
      : candidates.find((view) => view.id === panel.id && view.sceneId === panel.sceneId && isPluginActive(view.pluginId));
    if (candidate && (!ownerPluginId || isPluginActive(ownerPluginId))) return [candidate];
    if (panel.renderer && ownerPluginId && isPluginActive(ownerPluginId)) {
      return [{ id: panel.id, sceneId: panel.sceneId, pluginId: ownerPluginId, render: () => renderDeclarativeView(panel.renderer!) }];
    }
    return [];
  });
}

/** Resolve host-side adapters against the live plugin-owned registrations. */
export function resolveSceneViewContributions(
  registrations: SceneViewRegistration[],
  candidates: SceneViewContribution[],
  isPluginActive: (pluginId: string) => boolean,
) {
  const resolved = registrations.flatMap((registration) => {
    const candidate = findOwnedCandidate(registration, candidates, isPluginActive);
    if (!isPluginActive(registration.pluginId)) return [];
    if (candidate) return [candidate];
    if (registration.renderer) return [{ id: registration.id, sceneId: registration.sceneId, pluginId: registration.pluginId, render: () => renderDeclarativeView(registration.renderer!) }];
    return [];
  });
  // A persisted workbench can render one frame before a plugin lifecycle event
  // has repopulated the core registration snapshot. First-party adapters are
  // still lifecycle-owned, so they are safe to expose when their active plugin
  // has no live registration yet. Do not use this for a scene that has an
  // active registration with a different owner: that would cross plugin
  // boundaries and hide a real binding error.
  const lifecycleFallbacks = selectPluginLifecycleFallbacks(
    registrations,
    resolved,
    candidates,
    isPluginActive,
    'sceneId',
  );
  return [...resolved, ...lifecycleFallbacks];
}

/** Resolve scene-owned sidebar adapters using the same ownership check. */
export function resolveSceneSidebarContributions(
  registrations: SceneSidebarRegistration[],
  candidates: SceneSidebarViewContribution[],
  isPluginActive: (pluginId: string) => boolean,
) {
  const resolved = registrations.flatMap((registration) => {
    const candidate = findOwnedCandidate(registration, candidates, isPluginActive);
    if (!isPluginActive(registration.pluginId)) return [];
    if (candidate) return [candidate];
    if (registration.renderer) return [{ id: registration.id, sceneId: registration.sceneId, pluginId: registration.pluginId, render: () => renderDeclarativeView(registration.renderer!) }];
    return [];
  });
  const lifecycleFallbacks = selectPluginLifecycleFallbacks(
    registrations,
    resolved,
    candidates,
    isPluginActive,
    'id',
  );
  return [...resolved, ...lifecycleFallbacks];
}

/** Resolve all host adapters in one pass so the workbench cannot mix registry snapshots. */
export function resolveSceneUiContributions(
  registrations: { views: SceneViewRegistration[]; sidebars: SceneSidebarRegistration[]; panels?: WorkbenchPanelContribution[]; resourceOpeners?: import('../core/types').ResourceOpenerContribution[] },
  candidates: SceneUiContributions,
  isPluginActive: (pluginId: string) => boolean,
): ResolvedSceneUiContributions {
  const views = resolveSceneViewContributions(registrations.views, candidates.views, isPluginActive);
  const sidebars = resolveSceneSidebarContributions(registrations.sidebars, candidates.sidebars, isPluginActive);
  const panelViews = resolveWorkbenchPanelViewContributions(registrations.panels ?? [], candidates.panelViews, isPluginActive);
  const resourceResolution = resolveResourceViewContributions(
    registrations.resourceOpeners ?? [],
    candidates.resourceViews,
    isPluginActive,
    renderDeclarativeView,
  );
  const resourceViews = resourceResolution.views;
  const diagnostics = [
    ...registrations.views
      .filter((registration) => isPluginActive(registration.pluginId) && !views.some((view) => view.id === registration.id))
      .map((registration) => `scene view ${registration.id} (${registration.sceneId}) has no active host adapter`),
    ...registrations.sidebars
      .filter((registration) => isPluginActive(registration.pluginId) && !sidebars.some((sidebar) => sidebar.id === registration.id))
      .map((registration) => `scene sidebar ${registration.id} (${registration.sceneId}) has no active host adapter`),
    ...(registrations.panels ?? [])
      .filter((panel) => !panelViews.some((view) => view.id === panel.id))
      .map((panel) => `workbench panel ${panel.id} (${panel.sceneId}) has no active host adapter`),
    ...resourceResolution.diagnostics,
  ];
  return {
    views,
    sidebars,
    panelViews,
    resourceViews,
    missingViewIds: registrations.views
      .filter((registration) => !views.some((view) => view.id === registration.id))
      .map((registration) => registration.id),
    missingSidebarIds: registrations.sidebars
      .filter((registration) => !sidebars.some((sidebar) => sidebar.id === registration.id))
      .map((registration) => registration.id),
    missingPanelViewIds: (registrations.panels ?? [])
      .filter((panel) => !panelViews.some((view) => view.id === panel.id))
      .map((panel) => panel.id),
    missingResourceViewIds: resourceResolution.missingResourceViewIds,
    diagnostics,
  };
}

/** Create all trusted first-party React adapters for the current render. */
export function createBuiltinSceneUiContributions(runtime: BuiltinSceneUiRuntime): SceneUiContributions {
  const ai = createAiSceneContributions(runtime.ai);
  const markdown = createMarkdownSceneContributions(runtime.markdown);

  const panelViews: WorkbenchPanelViewContribution[] = [];
  const libraryPanel = runtime.panels.find((panel) => panel.id === 'library.details');
  if (libraryPanel) {
    panelViews.push({
      id: libraryPanel.id,
      sceneId: libraryPanel.sceneId,
      pluginId: libraryPanel.source.startsWith('plugin:') ? libraryPanel.source.slice('plugin:'.length) : 'library.core',
      render: ({ selectedPaper }) => selectedPaper ? <LibraryDetailPanel {...runtime.libraryPanel} paper={selectedPaper} /> : null,
      open: () => runtime.libraryPanel.onOpen(),
    });
  }
  const readerPanelViews = createReaderPanelViewContributions(runtime.readerPanel);
  const activeReaderPanelIds = new Set(runtime.panels.filter((panel) => panel.sceneId === 'reader').map((panel) => panel.id));
  panelViews.push(...readerPanelViews.filter((view) => activeReaderPanelIds.has(view.id as WorkbenchPanelContribution['id'])));

  const resourceViews = [
    createReaderResourceViewContribution(runtime.readerResource),
    // library.core keeps this legacy opener for compatibility. Its renderer is
    // the same trusted PDF adapter, but ownership remains with library.core.
    createReaderResourceViewContribution({ ...runtime.readerResource, openerId: 'library.pdf', pluginId: 'library.core' }),
    markdown.resource,
  ];

  return {
    views: [
      createOverviewSceneContribution(runtime.overview),
      createLibrarySceneContribution(runtime.library, panelViews),
      // Keep the live reader proxy intact. Spreading it here would capture
      // the first render's state and make toolbar clicks appear ineffective.
      createReaderSceneContribution(runtime.reader, panelViews),
      ai.view,
      markdown.view,
    ],
    sidebars: [
      createLibrarySidebarContribution(runtime.librarySidebar),
      createReaderSidebarContribution(runtime.readerSidebar),
      ai.sidebar,
      markdown.sidebar,
    ],
    panelViews,
    resourceViews,
  };
}
