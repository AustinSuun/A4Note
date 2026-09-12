/**
 * Storage + subscription wrapper around the pure workbench model.
 *
 * All decisions live in `src/core/workspace.ts`; this file only holds the
 * current snapshot, persists it, and notifies subscribers. PWS-1 will swap the
 * storage adapter for SQLite without touching callers.
 */
import {
  activateProject,
  activateWorkspace,
  closeOtherTabs,
  closeTab,
  createAgentSession,
  createProject,
  createWorkbenchState,
  createWorkspace,
  deserializeWorkbenchState,
  moveTab,
  openTab,
  registerResource,
  rekeyTab,
  removeAgentSession,
  removeProject,
  removeResource,
  removeWorkspace,
  renameProject,
  renameTab,
  renameWorkspace,
  serializeWorkbenchState,
  setActiveTab,
  setTabPinned,
  setWorkspaceLayout,
  updateAgentSession,
  updateResource,
  updateTabState,
} from '../core/workspace';
import type {
  AgentSession,
  AgentSessionPatch,
  CreateAgentSessionInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  OpenTabInput,
  Project,
  RegisterResourceInput,
  ResourcePatch,
  WorkbenchState,
  WorkspaceLayout,
  WorkspaceTab,
} from '../core/workspace';
import type { Resource } from '../core/resources';
import type { JsonValue } from '../core/types';

export const WORKBENCH_STORAGE_KEY = 'aster.workbench';

export interface WorkbenchStorage {
  read(): string | null;
  write(value: string): void;
}

const memoryStorage = (): WorkbenchStorage => {
  let value: string | null = null;
  return { read: () => value, write: (next) => { value = next; } };
};

function browserStorage(): WorkbenchStorage {
  if (typeof localStorage === 'undefined') return memoryStorage();
  return {
    read: () => {
      try {
        return localStorage.getItem(WORKBENCH_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        localStorage.setItem(WORKBENCH_STORAGE_KEY, value);
      } catch {
        // A full or blocked storage must not break the running workbench.
      }
    },
  };
}

export interface WorkbenchStore {
  getState(): WorkbenchState;
  subscribe(listener: () => void): () => void;
  createProject(input: CreateProjectInput): Project;
  renameProject(projectId: string, name: string): void;
  activateProject(projectId: string): void;
  removeProject(projectId: string): void;
  createWorkspace(input: CreateWorkspaceInput): void;
  renameWorkspace(workspaceId: string, name: string): void;
  activateWorkspace(workspaceId: string): void;
  removeWorkspace(workspaceId: string): void;
  setWorkspaceLayout(workspaceId: string, layout: Partial<WorkspaceLayout>): void;
  openTab(workspaceId: string, input: OpenTabInput): WorkspaceTab | null;
  closeTab(tabId: string): void;
  closeOtherTabs(tabId: string): void;
  setActiveTab(tabId: string): void;
  moveTab(tabId: string, targetIndex: number): void;
  setTabPinned(tabId: string, pinned: boolean): void;
  renameTab(tabId: string, title: string): void;
  rekeyTab(tabId: string, key: string, title: string): void;
  updateTabState(tabId: string, patch: Record<string, JsonValue>): void;
  registerResource(input: RegisterResourceInput): Resource | null;
  updateResource(resourceId: string, patch: ResourcePatch): void;
  removeResource(resourceId: string): void;
  createAgentSession(input: CreateAgentSessionInput): AgentSession | null;
  updateAgentSession(sessionId: string, patch: AgentSessionPatch): void;
  removeAgentSession(sessionId: string): void;
}

export function createWorkbenchStore(storage: WorkbenchStorage = browserStorage()): WorkbenchStore {
  let state = deserializeWorkbenchState(storage.read());
  const listeners = new Set<() => void>();

  const commit = (next: WorkbenchState) => {
    if (next === state) return;
    state = next;
    storage.write(serializeWorkbenchState(state));
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createProject: (input) => {
      const result = createProject(state, input);
      commit(result.state);
      return result.project;
    },
    renameProject: (projectId, name) => commit(renameProject(state, projectId, name)),
    activateProject: (projectId) => commit(activateProject(state, projectId)),
    removeProject: (projectId) => commit(removeProject(state, projectId)),
    createWorkspace: (input) => commit(createWorkspace(state, input).state),
    renameWorkspace: (workspaceId, name) => commit(renameWorkspace(state, workspaceId, name)),
    activateWorkspace: (workspaceId) => commit(activateWorkspace(state, workspaceId)),
    removeWorkspace: (workspaceId) => commit(removeWorkspace(state, workspaceId)),
    setWorkspaceLayout: (workspaceId, layout) => commit(setWorkspaceLayout(state, workspaceId, layout)),
    openTab: (workspaceId, input) => {
      const result = openTab(state, workspaceId, input);
      commit(result.state);
      return result.tab;
    },
    closeTab: (tabId) => commit(closeTab(state, tabId)),
    closeOtherTabs: (tabId) => commit(closeOtherTabs(state, tabId)),
    setActiveTab: (tabId) => commit(setActiveTab(state, tabId)),
    moveTab: (tabId, targetIndex) => commit(moveTab(state, tabId, targetIndex)),
    setTabPinned: (tabId, pinned) => commit(setTabPinned(state, tabId, pinned)),
    renameTab: (tabId, title) => commit(renameTab(state, tabId, title)),
    rekeyTab: (tabId, key, title) => commit(rekeyTab(state, tabId, key, title)),
    updateTabState: (tabId, patch) => commit(updateTabState(state, tabId, patch)),
    registerResource: (input) => {
      const result = registerResource(state, input);
      commit(result.state);
      return result.resource;
    },
    updateResource: (resourceId, patch) => commit(updateResource(state, resourceId, patch)),
    removeResource: (resourceId) => commit(removeResource(state, resourceId)),
    createAgentSession: (input) => {
      const result = createAgentSession(state, input);
      commit(result.state);
      return result.session;
    },
    updateAgentSession: (sessionId, patch) => commit(updateAgentSession(state, sessionId, patch)),
    removeAgentSession: (sessionId) => commit(removeAgentSession(state, sessionId)),
  };
}

export function createEmptyWorkbenchStore() {
  const storage = memoryStorage();
  storage.write(serializeWorkbenchState(createWorkbenchState()));
  return createWorkbenchStore(storage);
}
