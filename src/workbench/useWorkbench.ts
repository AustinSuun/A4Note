import { useMemo, useSyncExternalStore } from 'react';
import { activeWorkspace, findProject, orderedTabs, workspacesForProject } from '../core/workspace';
import type { AgentSession, Project, Workspace, WorkspaceTab } from '../core/workspace';
import type { Resource } from '../core/resources';
import { createWorkbenchStore, type WorkbenchStorage, type WorkbenchStore } from './workspaceStore';

/** One store per app instance: the shell is a singleton and so is its state. */
let sharedStore: WorkbenchStore | null = null;
let configuredStorage: WorkbenchStorage | null = null;

/**
 * Installs the persistence adapter before the first `workbenchStore()` call
 * (PWS-1: the desktop bootstrap swaps `localStorage` for SQLite). Calling it
 * after the store exists is ignored, because the seeded state would already be
 * live and re-seeding would discard it.
 */
export function configureWorkbenchStorage(storage: WorkbenchStorage) {
  if (sharedStore) return false;
  configuredStorage = storage;
  return true;
}

export function workbenchStore() {
  if (!sharedStore) {
    sharedStore = configuredStorage ? createWorkbenchStore(configuredStorage) : createWorkbenchStore();
  }
  return sharedStore;
}

export interface WorkbenchView {
  store: WorkbenchStore;
  projects: Project[];
  workspaces: Workspace[];
  agentSessions: AgentSession[];
  resources: Resource[];
  activeProject: Project | null;
  projectWorkspaces: Workspace[];
  workspace: Workspace | null;
  tabs: WorkspaceTab[];
  activeTab: WorkspaceTab | null;
  sessions: AgentSession[];
}

export function useWorkbench(): WorkbenchView {
  const store = workbenchStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => {
    const workspace = activeWorkspace(state);
    const activeProject = state.activeProjectId ? findProject(state, state.activeProjectId) : null;
    const tabs = orderedTabs(workspace);
    return {
      store,
      projects: state.projects,
      workspaces: state.workspaces,
      agentSessions: state.agentSessions,
      resources: activeProject
        ? state.resources.filter((resource) => !resource.projectId || resource.projectId === activeProject.id)
        : state.resources,
      activeProject,
      projectWorkspaces: activeProject ? workspacesForProject(state, activeProject.id) : [],
      workspace,
      tabs,
      activeTab: tabs.find((tab) => tab.id === workspace?.activeTabId) ?? null,
      sessions: workspace ? state.agentSessions.filter((session) => session.workspaceId === workspace.id) : [],
    };
  }, [state, store]);
}
