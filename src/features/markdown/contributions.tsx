import type { ReactNode } from 'react';
import type { ResourceViewContribution, SceneSidebarViewContribution, SceneViewContribution } from '../../workbench';
import { resolveProjectWikiLink, type RenamedTextFile } from '../../platform/projects';
import { MarkdownResourceTab } from '../explorer/MarkdownResourceTab';
import { MarkdownWorkspaceScene, type MarkdownWorkspaceSceneProps } from './MarkdownWorkspaceScene';

export type MarkdownSceneContributionProps = {
  view: MarkdownWorkspaceSceneProps;
  sidebar: ReactNode;
  resource?: {
    onRenamed?: (tabId: string, file: RenamedTextFile) => void;
    onOpenFile?: (path: string, name: string) => void;
  };
};

/** Markdown scene and file-tree contributions owned by markdown.core. */
export function createMarkdownSceneContributions(props: MarkdownSceneContributionProps): {
  view: SceneViewContribution;
  sidebar: SceneSidebarViewContribution;
  resource: ResourceViewContribution;
} {
  return {
    view: {
      id: 'markdown.core.view',
      sceneId: 'markdown',
      pluginId: 'markdown.core',
      render: () => <MarkdownWorkspaceScene {...props.view} />,
    },
    sidebar: {
      id: 'markdown.files',
      sceneId: 'markdown',
      pluginId: 'markdown.core',
      render: () => props.sidebar,
    },
    resource: {
      id: 'markdown.editor.view',
      openerId: 'markdown.editor',
      pluginId: 'markdown.core',
      render: ({ tab }) => (
        <MarkdownResourceTab
          path={typeof tab.state.path === 'string' ? tab.state.path : typeof tab.state.uri === 'string' ? tab.state.uri : ''}
          name={typeof tab.state.name === 'string' ? tab.state.name : tab.title}
          onRenamed={(file) => props.resource?.onRenamed?.(tab.id, file)}
          onOpenWikiLink={async (target) => {
            if (!props.view.rootPath || !props.resource?.onOpenFile) throw new Error('请先打开项目文件夹。');
            const from = typeof tab.state.path === 'string' ? tab.state.path : '';
            const file = await resolveProjectWikiLink(props.view.rootPath, from, target);
            props.resource.onOpenFile(file.path, file.name);
          }}
        />
      ),
    },
  };
}
