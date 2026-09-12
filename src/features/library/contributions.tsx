import type { SceneSidebarViewContribution, SceneViewContribution, WorkbenchPanelViewContribution } from '../../workbench';
import { LibraryScene } from './LibraryScene';
import { LibrarySceneSidebar } from './LibrarySceneSidebar';
import type { LibrarySceneSidebarProps } from './LibrarySceneSidebar';
import type { LibrarySceneProps } from './types';

/** Main library view contribution owned by library.core. */
export function createLibrarySceneContribution(props: LibrarySceneProps, panelViews?: WorkbenchPanelViewContribution[]): SceneViewContribution {
  return {
    id: 'library.core.view',
    sceneId: 'library',
    pluginId: 'library.core',
    // `props` can be a live host proxy. Keep it intact and spread it only when
    // React renders so papers, filters and callbacks follow ordinary UI state.
    render: () => <LibraryScene {...props} panelViews={panelViews ?? props.panelViews} />,
  };
}

/** Library document navigator contribution owned by library.core. */
export function createLibrarySidebarContribution(props: LibrarySceneSidebarProps): SceneSidebarViewContribution {
  return {
    id: 'library.documents',
    sceneId: 'library',
    pluginId: 'library.core',
    render: () => <LibrarySceneSidebar {...props} />,
  };
}
