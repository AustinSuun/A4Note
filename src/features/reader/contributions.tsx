import type { ReactNode } from 'react';
import type { PaperDocument } from '../../core/types';
import type { ResourceViewContribution, SceneSidebarViewContribution, SceneViewContribution, SceneViewContext, WorkbenchPanelViewContribution } from '../../workbench';
import { ReaderScene } from './ReaderScene';
import { ReaderSceneSidebar, type ReaderSceneSidebarProps } from './ReaderSceneSidebar';
import { ReaderSidePanelContent, type ReaderSidePanelContentProps } from './ReaderSidePanelContent';
import { PdfResourceTab } from './PdfResourceTab';
import type { ReaderSceneProps } from './types';

export type ReaderSceneContributionProps = {
  getPaper: (context: SceneViewContext) => PaperDocument | null;
  emptyView: ReactNode;
  render?: (paper: PaperDocument, context: SceneViewContext, panelViews?: WorkbenchPanelViewContribution[]) => ReactNode;
  readerProps?: Omit<ReaderSceneProps, 'paper'>;
  panelViews?: WorkbenchPanelViewContribution[];
};

/** Main reader view contribution owned by reader.core. */
export function createReaderSceneContribution(
  props: ReaderSceneContributionProps,
  panelViews: WorkbenchPanelViewContribution[] = [],
): SceneViewContribution {
  return {
    id: 'reader.core.view',
    sceneId: 'reader',
    pluginId: 'reader.core',
    render: (context) => {
      // `props` may be the host's live runtime proxy. Read it at render time so
      // ordinary React state updates (selected paper, reader mode, callbacks)
      // are not frozen when the plugin contribution is memoized.
      const paper = props.getPaper(context);
      if (!paper) return props.emptyView;
      // `props` can be a live host proxy. Read its fields at render time so
      // mode changes and callbacks are never frozen by the contribution
      // factory's memoized identity.
      if (props.render) return props.render(paper, context, panelViews);
      return props.readerProps
        ? <ReaderScene {...props.readerProps} panelViews={panelViews} paper={paper} />
        : props.emptyView;
    },
  };
}

/** Reader open-document navigator contribution owned by reader.core. */
export function createReaderSidebarContribution(props: ReaderSceneSidebarProps): SceneSidebarViewContribution {
  return {
    id: 'reader.documents',
    sceneId: 'reader',
    pluginId: 'reader.core',
    render: () => <ReaderSceneSidebar {...props} />,
  };
}

/** Trusted first-party panel renderers owned by reader.core. */
export function createReaderPanelViewContributions(
  props: Omit<ReaderSidePanelContentProps, 'tab' | 'paper'> & { onOpen: (tab: ReaderSidePanelContentProps['tab']) => void },
): WorkbenchPanelViewContribution[] {
  const panelIds: Record<ReaderSidePanelContentProps['tab'], string> = {
    notes: 'reader.notes',
    annotations: 'reader.annotations',
    chat: 'reader.chat',
    cite: 'reader.cite',
    relations: 'reader.relations',
  };
  return (Object.keys(panelIds) as ReaderSidePanelContentProps['tab'][]).map((tab) => ({
    id: panelIds[tab],
    sceneId: 'reader',
    pluginId: 'reader.core',
    render: ({ selectedPaper }) => selectedPaper ? (
      <ReaderSidePanelContent {...props} tab={tab} paper={selectedPaper} />
    ) : null,
    open: () => props.onOpen(tab),
  }));
}

/** PDF resource renderer owned by reader.core. */
export function createReaderResourceViewContribution(props: {
  openerId?: string;
  pluginId?: string;
  onStateChange?: (tabId: string, state: { zoom?: number; page?: number }) => void;
} = {}): ResourceViewContribution {
  const openerId = props.openerId ?? 'reader.pdf';
  return {
    id: `${openerId}.view`,
    openerId,
    pluginId: props.pluginId ?? 'reader.core',
    render: ({ tab }) => (
      <PdfResourceTab
        path={typeof tab.state.path === 'string' ? tab.state.path : typeof tab.state.uri === 'string' ? tab.state.uri : ''}
        name={typeof tab.state.name === 'string' ? tab.state.name : tab.title}
        resourceId={tab.resourceId}
        initialZoom={typeof tab.state.zoom === 'number' ? tab.state.zoom : 1}
        initialPage={typeof tab.state.page === 'number' ? tab.state.page : 1}
        onStateChange={(state) => props.onStateChange?.(tab.id, state)}
      />
    ),
  };
}
