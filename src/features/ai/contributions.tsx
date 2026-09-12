import type { ReactNode } from 'react';
import type { SceneSidebarViewContribution, SceneViewContribution } from '../../workbench';
import { AIChatScene, type AIChatSceneProps } from './AIChatScene';
import type { AiSceneSidebarProps } from './AiSceneSidebar';

export type AiSceneContributionProps = {
  view: AIChatSceneProps | null;
  emptyView: ReactNode;
  sidebar: AiSceneSidebarProps;
};

/** AI view and conversation navigator contributions owned by ai.core. */
export function createAiSceneContributions(props: AiSceneContributionProps): {
  view: SceneViewContribution;
  sidebar: SceneSidebarViewContribution;
} {
  return {
    view: {
      id: 'ai.core.view',
      sceneId: 'aiChat',
      pluginId: 'ai.core',
      render: () => props.view ? <AIChatScene {...props.view} /> : props.emptyView,
    },
    sidebar: {
      id: 'ai.sessions',
      sceneId: 'aiChat',
      pluginId: 'ai.core',
      // AI conversations are selected in the main surface for now. The
      // workspace sidebar remains available for future session navigation.
      render: () => <div className="scene-workspace-empty" aria-hidden="true" />,
    },
  };
}
