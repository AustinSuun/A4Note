import type { SceneViewContribution } from '../../workbench';
import { OverviewScene, type OverviewSceneProps } from './OverviewScene';

/** UI contribution owned by the overview plugin. */
export function createOverviewSceneContribution(props: OverviewSceneProps): SceneViewContribution {
  return {
    id: 'overview.core.view',
    sceneId: 'overview',
    pluginId: 'overview.core',
    render: () => <OverviewScene {...props} />,
  };
}
