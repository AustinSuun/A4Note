/**
 * Workbench domain model: Project -> Workspace -> Tab -> AgentSession.
 *
 * Pure data and pure transitions only: no React, no Tauri, no storage. Every
 * mutation returns a new state object, so the model can be verified in Node.
 */
import type { JsonValue } from './types';
import type { Resource, ResourceKind } from './resources';
import {
  RESOURCE_TAB_KEY_PREFIX,
  inferResourceKind,
  isResourceKind,
  normalizeResourceUri,
  resourceKey,
  resourceTabKey,
  resourceTitleFromUri,
} from './resources';

export const WORKBENCH_STATE_VERSION = 1;

export type ProjectKind = 'folder' | 'builtin';
export type WorkspaceTabKind = 'tool' | 'pdf' | 'markdown' | 'file' | 'agent' | 'terminal' | 'diff' | `plugin:${string}`;
export type AgentProviderId = 'codex' | 'claude' | 'local' | `plugin:${string}`;
export type AgentPermissionMode = 'default' | 'autoReview' | 'fullAccess';
/**
 * Session lifecycle, not turn lifecycle. A finished turn returns the session to
 * `idle` so the user can keep talking; `closed` is the terminal state of the
 * session itself. Turn completion is an `AgentEvent` (`src/core/agentProtocol.ts`).
 */
export type AgentSessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'failed' | 'closed';

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  kind: ProjectKind;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface WorkspaceLayout {
  fileTreeVisible: boolean;
  rightDrawerVisible: boolean;
}

export interface WorkspaceTab {
  id: string;
  workspaceId: string;
  kind: WorkspaceTabKind;
  key: string;
  title: string;
  resourceId?: string;
  sessionId?: string;
  state: Record<string, JsonValue>;
  pinned: boolean;
  order: number;
}
export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  activeTabId?: string;
  layout: WorkspaceLayout;
  tabs: WorkspaceTab[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  projectId: string;
  workspaceId: string;
  providerId: AgentProviderId;
  providerSessionId?: string;
  modelId?: string;
  permissionMode: AgentPermissionMode;
  status: AgentSessionStatus;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchState {
  version: number;
  projects: Project[];
  workspaces: Workspace[];
  resources: Resource[];
  agentSessions: AgentSession[];
  activeProjectId?: string;
  activeWorkspaceId?: string;
}

/** Injectable id and clock so verification scripts can assert exact output. */
export interface WorkbenchMutationContext {
  createId?: (prefix: string) => string;
  now?: () => string;
}

export const defaultWorkspaceLayout: WorkspaceLayout = {
  fileTreeVisible: false,
  rightDrawerVisible: false,
};

/**
 * `idle -> running` is legal because a session whose process is already up takes
 * the next turn without another handshake; only the supervisor knows whether a
 * process is live, so the model rejects nonsense (`closed -> running`) rather
 * than trying to encode liveness. `running -> idle` is turn completion.
 */
export const agentSessionTransitions: Record<AgentSessionStatus, AgentSessionStatus[]> = {
  idle: ['starting', 'running', 'closed', 'failed'],
  starting: ['idle', 'running', 'stopping', 'closed', 'failed'],
  running: ['idle', 'stopping', 'closed', 'failed'],
  stopping: ['idle', 'closed', 'failed'],
  failed: ['starting', 'closed'],
  closed: ['starting'],
};
function mutationId(context: WorkbenchMutationContext | undefined, prefix: string) {
  if (context?.createId) return context.createId(prefix);
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mutationNow(context?: WorkbenchMutationContext) {
  return context?.now ? context.now() : new Date().toISOString();
}

export function createWorkbenchState(): WorkbenchState {
  return { version: WORKBENCH_STATE_VERSION, projects: [], workspaces: [], resources: [], agentSessions: [] };
}

export function normalizeProjectPath(rootPath: string) {
  return rootPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function projectNameFromPath(rootPath: string) {
  const segments = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function findProject(state: WorkbenchState, projectId: string) {
  return state.projects.find((project) => project.id === projectId) ?? null;
}

export function findProjectByRootPath(state: WorkbenchState, rootPath: string) {
  const normalized = normalizeProjectPath(rootPath);
  return state.projects.find((project) => normalizeProjectPath(project.rootPath) === normalized) ?? null;
}

export function findWorkspace(state: WorkbenchState, workspaceId: string) {
  return state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export function workspacesForProject(state: WorkbenchState, projectId: string) {
  return state.workspaces.filter((workspace) => workspace.projectId === projectId);
}

export function findTab(state: WorkbenchState, tabId: string) {
  for (const workspace of state.workspaces) {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    if (tab) return { workspace, tab };
  }
  return null;
}

export function orderedTabs(workspace: Workspace | null) {
  if (!workspace) return [];
  return [...workspace.tabs].sort(compareTabs);
}
function compareTabs(left: WorkspaceTab, right: WorkspaceTab) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return left.order - right.order;
}

export function activeWorkspace(state: WorkbenchState) {
  return state.activeWorkspaceId ? findWorkspace(state, state.activeWorkspaceId) : null;
}

export function activeTab(state: WorkbenchState) {
  const workspace = activeWorkspace(state);
  if (!workspace?.activeTabId) return null;
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;
}

export function findAgentSession(state: WorkbenchState, sessionId: string) {
  return state.agentSessions.find((session) => session.id === sessionId) ?? null;
}

export function agentSessionsForWorkspace(state: WorkbenchState, workspaceId: string) {
  return state.agentSessions.filter((session) => session.workspaceId === workspaceId);
}

function replaceWorkspace(state: WorkbenchState, workspaceId: string, update: (workspace: Workspace) => Workspace) {
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) return workspace;
    changed = true;
    return update(workspace);
  });
  return changed ? { ...state, workspaces } : state;
}

function reindexTabs(tabs: WorkspaceTab[]) {
  return [...tabs].sort(compareTabs).map((tab, index) => (tab.order === index ? tab : { ...tab, order: index }));
}

export interface CreateProjectInput {
  id?: string;
  name?: string;
  rootPath: string;
  kind?: ProjectKind;
  workspaceName?: string;
}

export function createProject(
  state: WorkbenchState,
  input: CreateProjectInput,
  context?: WorkbenchMutationContext,
): { state: WorkbenchState; project: Project } {
  const existing = findProjectByRootPath(state, input.rootPath);
  if (existing) return { state: activateProject(state, existing.id, context), project: existing };
  const now = mutationNow(context);
  const project: Project = {
    id: input.id ?? mutationId(context, 'project'),
    name: input.name?.trim() || projectNameFromPath(input.rootPath) || '未命名项目',
    rootPath: input.rootPath,
    kind: input.kind ?? 'folder',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
  const withProject: WorkbenchState = { ...state, projects: [...state.projects, project] };
  const seeded = createWorkspace(withProject, { projectId: project.id, name: input.workspaceName }, context);
  return {
    state: { ...seeded.state, activeProjectId: project.id, activeWorkspaceId: seeded.workspace.id },
    project,
  };
}

export function renameProject(state: WorkbenchState, projectId: string, name: string, context?: WorkbenchMutationContext) {
  const trimmed = name.trim();
  if (!trimmed) return state;
  const now = mutationNow(context);
  return {
    ...state,
    projects: state.projects.map((project) => (project.id === projectId ? { ...project, name: trimmed, updatedAt: now } : project)),
  };
}

export function activateProject(state: WorkbenchState, projectId: string, context?: WorkbenchMutationContext) {
  const project = findProject(state, projectId);
  if (!project) return state;
  const now = mutationNow(context);
  const workspaces = workspacesForProject(state, projectId);
  const nextWorkspaceId = workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : workspaces[0]?.id;
  return {
    ...state,
    projects: state.projects.map((candidate) => (candidate.id === projectId ? { ...candidate, lastOpenedAt: now } : candidate)),
    activeProjectId: projectId,
    activeWorkspaceId: nextWorkspaceId,
  };
}

/** Removes the Aster record only. Files on disk are never touched by the model. */
export function removeProject(state: WorkbenchState, projectId: string): WorkbenchState {
  if (!findProject(state, projectId)) return state;
  const removedWorkspaceIds = workspacesForProject(state, projectId).map((workspace) => workspace.id);
  const removedResourceIds = new Set(resourcesForProject(state, projectId).map((resource) => resource.id));
  const next: WorkbenchState = {
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    workspaces: state.workspaces.filter((workspace) => workspace.projectId !== projectId),
    resources: state.resources.filter((resource) => !removedResourceIds.has(resource.id)),
    agentSessions: state.agentSessions.filter((session) => !removedWorkspaceIds.includes(session.workspaceId)),
  };
  return repairActiveSelection(unbindTabsFromResources(next, removedResourceIds));
}

export function findResource(state: WorkbenchState, resourceId: string) {
  return state.resources.find((resource) => resource.id === resourceId) ?? null;
}

export function findResourceByUri(state: WorkbenchState, uri: string) {
  const key = resourceKey(uri);
  return state.resources.find((resource) => resourceKey(resource.uri) === key) ?? null;
}

export function resourcesForProject(state: WorkbenchState, projectId: string) {
  return state.resources.filter((resource) => resource.projectId === projectId);
}

export interface RegisterResourceInput {
  id?: string;
  uri: string;
  kind?: ResourceKind;
  title?: string;
  projectId?: string;
  metadata?: Record<string, JsonValue>;
}

function sameMetadata(left: Record<string, JsonValue>, right: Record<string, JsonValue>) {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

function stripResourceId(tab: WorkspaceTab): WorkspaceTab {
  const { resourceId: _dropped, ...rest } = tab;
  return rest;
}

/** A tab whose resource record is gone still knows its own path, so unbind instead of closing. */
function unbindTabsFromResources(state: WorkbenchState, removedIds: Set<string>): WorkbenchState {
  if (removedIds.size === 0) return state;
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    let workspaceChanged = false;
    const tabs = workspace.tabs.map((tab) => {
      if (!tab.resourceId || !removedIds.has(tab.resourceId)) return tab;
      workspaceChanged = true;
      return stripResourceId(tab);
    });
    if (!workspaceChanged) return workspace;
    changed = true;
    return { ...workspace, tabs };
  });
  return changed ? { ...state, workspaces } : state;
}

/**
 * Idempotent by `resourceKey`: registering the same path twice returns the first
 * record. A later registration may fill in a title, a kind or a project the first
 * one did not know, but never overwrites a value that is already there.
 */
export function registerResource(
  state: WorkbenchState,
  input: RegisterResourceInput,
  context?: WorkbenchMutationContext,
): { state: WorkbenchState; resource: Resource | null } {
  const uri = normalizeResourceUri(input.uri);
  if (!uri) return { state, resource: null };
  const existing = findResourceByUri(state, uri);
  if (existing) {
    const patch: Partial<Resource> = {};
    const title = input.title?.trim();
    if (title && title !== existing.title) patch.title = title;
    if (input.kind && input.kind !== existing.kind) patch.kind = input.kind;
    if (input.projectId && !existing.projectId) patch.projectId = input.projectId;
    if (input.metadata) {
      const merged = { ...existing.metadata, ...input.metadata };
      if (!sameMetadata(existing.metadata, merged)) patch.metadata = merged;
    }
    if (Object.keys(patch).length === 0) return { state, resource: existing };
    const updated: Resource = { ...existing, ...patch, updatedAt: mutationNow(context) };
    return {
      state: { ...state, resources: state.resources.map((candidate) => (candidate.id === existing.id ? updated : candidate)) },
      resource: updated,
    };
  }
  const now = mutationNow(context);
  const resource: Resource = {
    id: input.id ?? mutationId(context, 'resource'),
    projectId: input.projectId,
    kind: input.kind ?? inferResourceKind(uri),
    uri,
    title: input.title?.trim() || resourceTitleFromUri(uri),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, resources: [...state.resources, resource] }, resource };
}

export type ResourcePatch = Partial<Pick<Resource, 'kind' | 'title' | 'uri' | 'projectId' | 'metadata'>>;

/** `uri` is not patchable: a different URI is a different resource, not an edit. */
export function updateResource(
  state: WorkbenchState,
  resourceId: string,
  patch: ResourcePatch,
  context?: WorkbenchMutationContext,
): WorkbenchState {
  const existing = findResource(state, resourceId);
  if (!existing) return state;
  const next: Resource = { ...existing };
  let changed = false;
  // Resource identity is immutable. A different URI must be registered as a
  // separate resource instead of mutating the record referenced by open tabs.
  if (patch.kind && patch.kind !== existing.kind) {
    next.kind = patch.kind;
    changed = true;
  }
  const title = patch.title?.trim();
  if (title && title !== existing.title) {
    next.title = title;
    changed = true;
  }
  if (patch.projectId !== undefined && patch.projectId !== existing.projectId) {
    next.projectId = patch.projectId || undefined;
    changed = true;
  }
  if (patch.metadata) {
    const merged = { ...existing.metadata, ...patch.metadata };
    if (!sameMetadata(existing.metadata, merged)) {
      next.metadata = merged;
      changed = true;
    }
  }
  if (!changed) return state;
  next.updatedAt = mutationNow(context);
  return { ...state, resources: state.resources.map((candidate) => (candidate.id === resourceId ? next : candidate)) };
}

export function removeResource(state: WorkbenchState, resourceId: string): WorkbenchState {
  if (!findResource(state, resourceId)) return state;
  const next: WorkbenchState = { ...state, resources: state.resources.filter((resource) => resource.id !== resourceId) };
  return unbindTabsFromResources(next, new Set([resourceId]));
}

export interface CreateWorkspaceInput {
  id?: string;
  projectId: string;
  name?: string;
  layout?: Partial<WorkspaceLayout>;
}

export function createWorkspace(
  state: WorkbenchState,
  input: CreateWorkspaceInput,
  context?: WorkbenchMutationContext,
): { state: WorkbenchState; workspace: Workspace } {
  const now = mutationNow(context);
  const siblings = workspacesForProject(state, input.projectId);
  const workspace: Workspace = {
    id: input.id ?? mutationId(context, 'workspace'),
    projectId: input.projectId,
    name: input.name?.trim() || (siblings.length === 0 ? '默认工作区' : `工作区 ${siblings.length + 1}`),
    layout: { ...defaultWorkspaceLayout, ...input.layout },
    tabs: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    state: {
      ...state,
      workspaces: [...state.workspaces, workspace],
      activeProjectId: input.projectId,
      activeWorkspaceId: workspace.id,
    },
    workspace,
  };
}

export function renameWorkspace(state: WorkbenchState, workspaceId: string, name: string, context?: WorkbenchMutationContext) {
  const trimmed = name.trim();
  if (!trimmed) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, workspaceId, (workspace) => ({ ...workspace, name: trimmed, updatedAt: now }));
}

export function removeWorkspace(state: WorkbenchState, workspaceId: string): WorkbenchState {
  if (!findWorkspace(state, workspaceId)) return state;
  const next: WorkbenchState = {
    ...state,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
    agentSessions: state.agentSessions.filter((session) => session.workspaceId !== workspaceId),
  };
  return repairActiveSelection(next);
}
export function activateWorkspace(state: WorkbenchState, workspaceId: string, context?: WorkbenchMutationContext) {
  const workspace = findWorkspace(state, workspaceId);
  if (!workspace) return state;
  const now = mutationNow(context);
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === workspace.projectId ? { ...project, lastOpenedAt: now } : project,
    ),
    activeProjectId: workspace.projectId,
    activeWorkspaceId: workspace.id,
  };
}

export function setWorkspaceLayout(
  state: WorkbenchState,
  workspaceId: string,
  layout: Partial<WorkspaceLayout>,
  context?: WorkbenchMutationContext,
) {
  const now = mutationNow(context);
  return replaceWorkspace(state, workspaceId, (workspace) => ({
    ...workspace,
    layout: { ...workspace.layout, ...layout },
    updatedAt: now,
  }));
}

export interface OpenTabInput {
  id?: string;
  kind: WorkspaceTabKind;
  key: string;
  title: string;
  resourceId?: string;
  sessionId?: string;
  state?: Record<string, JsonValue>;
  pinned?: boolean;
}

/** Tabs are deduplicated by `key`: opening the same resource focuses the existing tab. */
export function openTab(
  state: WorkbenchState,
  workspaceId: string,
  input: OpenTabInput,
  context?: WorkbenchMutationContext,
): { state: WorkbenchState; tab: WorkspaceTab | null } {
  const workspace = findWorkspace(state, workspaceId);
  if (!workspace) return { state, tab: null };
  const now = mutationNow(context);
  const existing = workspace.tabs.find((tab) => tab.key === input.key);
  if (existing) {
    // Reopening a tab restored from a pre-RES-2 snapshot is what binds it to a
    // resource. Add only missing identity fields so legacy tabs can migrate,
    // while an existing opener/scene binding is never repointed by a later
    // registration or extension match.
    const missingState = Object.entries(input.state ?? {}).reduce<Record<string, JsonValue>>((result, [key, value]) => {
      if (!Object.hasOwn(existing.state, key)) result[key] = value;
      return result;
    }, {});
    const hasMissingState = Object.keys(missingState).length > 0;
    const bound = input.resourceId && !existing.resourceId || hasMissingState
      ? {
        ...existing,
        ...(input.resourceId && !existing.resourceId ? { resourceId: input.resourceId } : {}),
        ...(hasMissingState ? { state: { ...existing.state, ...missingState } } : {}),
      }
      : existing;
    return {
      state: replaceWorkspace(state, workspaceId, (target) => ({
        ...target,
        tabs: bound === existing ? target.tabs : target.tabs.map((tab) => (tab.id === existing.id ? bound : tab)),
        activeTabId: existing.id,
        updatedAt: now,
      })),
      tab: bound,
    };
  }
  const tab: WorkspaceTab = {
    id: input.id ?? mutationId(context, 'tab'),
    workspaceId,
    kind: input.kind,
    key: input.key,
    title: input.title,
    resourceId: input.resourceId,
    sessionId: input.sessionId,
    state: input.state ?? {},
    pinned: input.pinned ?? false,
    order: workspace.tabs.length,
  };
  const nextState = replaceWorkspace(state, workspaceId, (target) => ({
    ...target,
    tabs: reindexTabs([...target.tabs, tab]),
    activeTabId: tab.id,
    updatedAt: now,
  }));
  return { state: nextState, tab: findTab(nextState, tab.id)?.tab ?? tab };
}

/** Closing a tab never deletes its agent session: history outlives the tab. */
export function closeTab(state: WorkbenchState, tabId: string, context?: WorkbenchMutationContext) {
  const found = findTab(state, tabId);
  if (!found) return state;
  const { workspace } = found;
  const now = mutationNow(context);
  const ordered = orderedTabs(workspace);
  const index = ordered.findIndex((candidate) => candidate.id === tabId);
  const remaining = ordered.filter((candidate) => candidate.id !== tabId);
  const nextActiveTabId =
    workspace.activeTabId === tabId ? (remaining[index] ?? remaining[index - 1] ?? remaining[remaining.length - 1])?.id : workspace.activeTabId;
  return replaceWorkspace(state, workspace.id, (target) => ({
    ...target,
    tabs: reindexTabs(remaining),
    activeTabId: nextActiveTabId,
    updatedAt: now,
  }));
}

export function closeOtherTabs(state: WorkbenchState, tabId: string, context?: WorkbenchMutationContext) {
  const found = findTab(state, tabId);
  if (!found) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: reindexTabs(target.tabs.filter((tab) => tab.id === tabId || tab.pinned)),
    activeTabId: tabId,
    updatedAt: now,
  }));
}
export function setActiveTab(state: WorkbenchState, tabId: string, context?: WorkbenchMutationContext) {
  const found = findTab(state, tabId);
  if (!found) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({ ...target, activeTabId: tabId, updatedAt: now }));
}

/** `targetIndex` is an index inside the ordered (pinned-first) tab list. */
export function moveTab(state: WorkbenchState, tabId: string, targetIndex: number, context?: WorkbenchMutationContext) {
  const found = findTab(state, tabId);
  if (!found) return state;
  const now = mutationNow(context);
  const ordered = orderedTabs(found.workspace);
  const from = ordered.findIndex((candidate) => candidate.id === tabId);
  const to = Math.max(0, Math.min(ordered.length - 1, targetIndex));
  if (from === to) return state;
  const moved = [...ordered];
  const [tab] = moved.splice(from, 1);
  moved.splice(to, 0, tab);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: moved.map((candidate, index) => ({ ...candidate, order: index })),
    updatedAt: now,
  }));
}

export function setTabPinned(state: WorkbenchState, tabId: string, pinned: boolean, context?: WorkbenchMutationContext) {
  const found = findTab(state, tabId);
  if (!found || found.tab.pinned === pinned) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: reindexTabs(target.tabs.map((tab) => (tab.id === tabId ? { ...tab, pinned } : tab))),
    updatedAt: now,
  }));
}

export function renameTab(state: WorkbenchState, tabId: string, title: string, context?: WorkbenchMutationContext) {
  const trimmed = title.trim();
  const found = findTab(state, tabId);
  if (!found || !trimmed) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: target.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: trimmed } : tab)),
    updatedAt: now,
  }));
}

/** Updates the identity after a resource-backed file is renamed on disk. */
export function rekeyTab(
  state: WorkbenchState,
  tabId: string,
  key: string,
  title: string,
  context?: WorkbenchMutationContext,
) {
  const trimmedKey = key.trim();
  const trimmedTitle = title.trim();
  const found = findTab(state, tabId);
  if (!found || !trimmedKey || !trimmedTitle) return state;
  if (found.workspace.tabs.some((tab) => tab.id !== tabId && tab.key === trimmedKey)) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: target.tabs.map((tab) => (tab.id === tabId ? { ...tab, key: trimmedKey, title: trimmedTitle } : tab)),
    updatedAt: now,
  }));
}

/** Shallow merge, so a view can persist scroll or page state without owning the whole tab. */
export function updateTabState(
  state: WorkbenchState,
  tabId: string,
  patch: Record<string, JsonValue>,
  context?: WorkbenchMutationContext,
) {
  const found = findTab(state, tabId);
  if (!found) return state;
  const now = mutationNow(context);
  return replaceWorkspace(state, found.workspace.id, (target) => ({
    ...target,
    tabs: target.tabs.map((tab) => (tab.id === tabId ? { ...tab, state: { ...tab.state, ...patch } } : tab)),
    updatedAt: now,
  }));
}

export interface CreateAgentSessionInput {
  id?: string;
  workspaceId: string;
  providerId: AgentProviderId;
  modelId?: string;
  permissionMode?: AgentPermissionMode;
  workingDirectory?: string;
}

export function createAgentSession(
  state: WorkbenchState,
  input: CreateAgentSessionInput,
  context?: WorkbenchMutationContext,
): { state: WorkbenchState; session: AgentSession | null } {
  const workspace = findWorkspace(state, input.workspaceId);
  if (!workspace) return { state, session: null };
  const project = findProject(state, workspace.projectId);
  const workingDirectory = input.workingDirectory ?? project?.rootPath ?? '';
  if (!workingDirectory) return { state, session: null };
  const now = mutationNow(context);
  const session: AgentSession = {
    id: input.id ?? mutationId(context, 'session'),
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    providerId: input.providerId,
    modelId: input.modelId,
    permissionMode: input.permissionMode ?? 'default',
    status: 'idle',
    workingDirectory,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, agentSessions: [...state.agentSessions, session] }, session };
}
export function canTransitionAgentSession(from: AgentSessionStatus, to: AgentSessionStatus) {
  if (from === to) return true;
  return agentSessionTransitions[from]?.includes(to) ?? false;
}

export type AgentSessionPatch = Partial<
  Pick<AgentSession, 'status' | 'providerSessionId' | 'modelId' | 'permissionMode' | 'workingDirectory'>
>;

/** Illegal status transitions are rejected instead of throwing: the caller sees an unchanged state. */
export function updateAgentSession(
  state: WorkbenchState,
  sessionId: string,
  patch: AgentSessionPatch,
  context?: WorkbenchMutationContext,
): WorkbenchState {
  const session = findAgentSession(state, sessionId);
  if (!session) return state;
  if (patch.status && !canTransitionAgentSession(session.status, patch.status)) return state;
  const now = mutationNow(context);
  return {
    ...state,
    agentSessions: state.agentSessions.map((candidate) =>
      candidate.id === sessionId ? { ...candidate, ...patch, updatedAt: now } : candidate,
    ),
  };
}

/** Removes the session record and any tab bound to it. */
export function removeAgentSession(state: WorkbenchState, sessionId: string, context?: WorkbenchMutationContext): WorkbenchState {
  const session = findAgentSession(state, sessionId);
  if (!session) return state;
  const boundTabs = state.workspaces
    .flatMap((workspace) => workspace.tabs)
    .filter((tab) => tab.sessionId === sessionId)
    .map((tab) => tab.id);
  let next: WorkbenchState = { ...state, agentSessions: state.agentSessions.filter((candidate) => candidate.id !== sessionId) };
  for (const tabId of boundTabs) next = closeTab(next, tabId, context);
  return next;
}

export function serializeWorkbenchState(state: WorkbenchState): string {
  return JSON.stringify(state);
}

export function deserializeWorkbenchState(raw: string | null | undefined): WorkbenchState {
  if (!raw) return createWorkbenchState();
  try {
    return normalizeWorkbenchState(JSON.parse(raw) as unknown);
  } catch {
    return createWorkbenchState();
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asStateBag(value: unknown): Record<string, JsonValue> {
  return isRecord(value) ? (value as Record<string, JsonValue>) : {};
}

/**
 * Pre-RES-2 file tabs were keyed `file:<raw path>`, so two spellings of one path
 * opened two tabs. Rewriting the key on restore is what retires that; the tab id,
 * title and state are untouched.
 */
function upgradeTabKey(kind: WorkspaceTabKind, key: string) {
  if (key.startsWith(RESOURCE_TAB_KEY_PREFIX) || kind !== 'file') return key;
  if (key.startsWith('file://')) return resourceTabKey(key);
  const legacy = /^file:(.+)$/.exec(key);
  return legacy ? resourceTabKey(legacy[1]) : key;
}

/** A key upgrade can collapse two old tabs onto one key; the first one wins. */
function dedupeTabsByKey(tabs: WorkspaceTab[]) {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.key)) return false;
    seen.add(tab.key);
    return true;
  });
}

/**
 * Pre-PDF-0 a `.pdf` opened from the file tree became a `file` tab, which renders
 * the "this is a binary file" hint. On restore it becomes a `pdf` tab so the reader
 * picks it up. `markdown` is deliberately not upgraded here: NOTE-0 owns the editor
 * that would render it, and until then a `.md` file tab still has a working preview.
 */
function upgradeTabKind(kind: WorkspaceTabKind, key: string, state: Record<string, JsonValue>): WorkspaceTabKind {
  if (kind !== 'file') return kind;
  const stateUri = typeof state.uri === 'string' ? state.uri : '';
  const statePath = typeof state.path === 'string' ? state.path : '';
  // The key is the last resort: it is a resource key, so it still carries the extension.
  const fromKey = key.startsWith(RESOURCE_TAB_KEY_PREFIX) ? key.slice(RESOURCE_TAB_KEY_PREFIX.length) : '';
  const uri = stateUri || statePath || fromKey;
  return uri && inferResourceKind(uri) === 'pdf' ? 'pdf' : kind;
}

function normalizeTab(raw: unknown, workspaceId: string, index: number): WorkspaceTab | null {
  if (!isRecord(raw)) return null;
  const id = asOptionalString(raw.id);
  const kind = asOptionalString(raw.kind) as WorkspaceTabKind | undefined;
  if (!id || !kind) return null;
  const key = upgradeTabKey(kind, asOptionalString(raw.key) ?? id);
  const state = asStateBag(raw.state);
  return {
    id,
    workspaceId,
    kind: upgradeTabKind(kind, key, state),
    key,
    title: asString(raw.title, key),
    resourceId: asOptionalString(raw.resourceId),
    sessionId: asOptionalString(raw.sessionId),
    state,
    pinned: asBoolean(raw.pinned),
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : index,
  };
}

function normalizeResource(raw: unknown, projectIds: Set<string>): Resource | null {
  if (!isRecord(raw)) return null;
  const id = asOptionalString(raw.id);
  const uri = normalizeResourceUri(asString(raw.uri));
  if (!id || !uri) return null;
  const projectId = asOptionalString(raw.projectId);
  // A resource scoped to a project that is gone is unreachable, so it is dropped
  // exactly like an orphaned workspace.
  if (projectId && !projectIds.has(projectId)) return null;
  const kind = asOptionalString(raw.kind);
  const createdAt = asString(raw.createdAt);
  return {
    id,
    projectId,
    kind: kind && isResourceKind(kind) ? kind : inferResourceKind(uri),
    uri,
    title: asString(raw.title) || resourceTitleFromUri(uri),
    metadata: asStateBag(raw.metadata),
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
  };
}

function dedupeResourcesByKey(resources: Resource[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = resourceKey(resource.uri);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProject(raw: unknown): Project | null {
  if (!isRecord(raw)) return null;
  const id = asOptionalString(raw.id);
  const rootPath = asOptionalString(raw.rootPath);
  if (!id || !rootPath) return null;
  const createdAt = asString(raw.createdAt);
  const kind = asOptionalString(raw.kind) === 'builtin' ? 'builtin' : 'folder';
  return {
    id,
    name: asString(raw.name) || projectNameFromPath(rootPath) || '未命名项目',
    rootPath,
    kind,
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
    lastOpenedAt: asOptionalString(raw.lastOpenedAt),
  };
}
function normalizeWorkspace(raw: unknown, projectIds: Set<string>): Workspace | null {
  if (!isRecord(raw)) return null;
  const id = asOptionalString(raw.id);
  const projectId = asOptionalString(raw.projectId);
  if (!id || !projectId || !projectIds.has(projectId)) return null;
  const layout = isRecord(raw.layout) ? raw.layout : {};
  const tabs = reindexTabs(
    dedupeTabsByKey(
      (Array.isArray(raw.tabs) ? raw.tabs : [])
        .map((tab, index) => normalizeTab(tab, id, index))
        .filter((tab): tab is WorkspaceTab => tab !== null),
    ),
  );
  const activeTabId = asOptionalString(raw.activeTabId);
  const createdAt = asString(raw.createdAt);
  return {
    id,
    projectId,
    name: asString(raw.name) || '默认工作区',
    activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id,
    layout: {
      fileTreeVisible: asBoolean(layout.fileTreeVisible, defaultWorkspaceLayout.fileTreeVisible),
      rightDrawerVisible: asBoolean(layout.rightDrawerVisible, defaultWorkspaceLayout.rightDrawerVisible),
    },
    tabs,
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
  };
}

function normalizeAgentSession(raw: unknown, workspaces: Workspace[]): AgentSession | null {
  if (!isRecord(raw)) return null;
  const id = asOptionalString(raw.id);
  const workspaceId = asOptionalString(raw.workspaceId);
  const providerId = asOptionalString(raw.providerId) as AgentProviderId | undefined;
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!id || !workspace || !providerId) return null;
  const status = asOptionalString(raw.status) as AgentSessionStatus | undefined;
  const permissionMode = asOptionalString(raw.permissionMode) as AgentPermissionMode | undefined;
  const createdAt = asString(raw.createdAt);
  return {
    id,
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    providerId,
    providerSessionId: asOptionalString(raw.providerSessionId),
    modelId: asOptionalString(raw.modelId),
    permissionMode: permissionMode && agentPermissionModes.includes(permissionMode) ? permissionMode : 'default',
    // A process cannot survive a reload, so live states are persisted back as terminal ones.
    status: status && status in agentSessionTransitions ? restoredStatus(status) : 'idle',
    workingDirectory: asString(raw.workingDirectory),
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
  };
}
const agentPermissionModes: AgentPermissionMode[] = ['default', 'autoReview', 'fullAccess'];

/** Sessions that were mid-flight when the app closed come back as failed, never as running. */
function restoredStatus(status: AgentSessionStatus): AgentSessionStatus {
  if (status === 'starting' || status === 'running' || status === 'stopping') return 'failed';
  return status;
}

function repairActiveSelection(state: WorkbenchState): WorkbenchState {
  const activeProjectId = state.projects.some((project) => project.id === state.activeProjectId)
    ? state.activeProjectId
    : state.projects[0]?.id;
  const candidates = activeProjectId ? workspacesForProject(state, activeProjectId) : [];
  const activeWorkspaceId = candidates.some((workspace) => workspace.id === state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : candidates[0]?.id;
  if (activeProjectId === state.activeProjectId && activeWorkspaceId === state.activeWorkspaceId) return state;
  return { ...state, activeProjectId, activeWorkspaceId };
}

/** Accepts anything (old snapshots, hand-edited files) and returns a consistent state. */
export function normalizeWorkbenchState(input: unknown): WorkbenchState {
  if (!isRecord(input)) return createWorkbenchState();
  const projects = (Array.isArray(input.projects) ? input.projects : [])
    .map(normalizeProject)
    .filter((project): project is Project => project !== null);
  const projectIds = new Set(projects.map((project) => project.id));
  const workspaces = (Array.isArray(input.workspaces) ? input.workspaces : [])
    .map((workspace) => normalizeWorkspace(workspace, projectIds))
    .filter((workspace): workspace is Workspace => workspace !== null);
  const agentSessions = (Array.isArray(input.agentSessions) ? input.agentSessions : [])
    .map((session) => normalizeAgentSession(session, workspaces))
    .filter((session): session is AgentSession => session !== null);
  const sessionIds = new Set(agentSessions.map((session) => session.id));
  const resources = dedupeResourcesByKey(
    (Array.isArray(input.resources) ? input.resources : [])
      .map((resource) => normalizeResource(resource, projectIds))
      .filter((resource): resource is Resource => resource !== null),
  );
  const resourceIds = new Set(resources.map((resource) => resource.id));
  return repairActiveSelection({
    version: WORKBENCH_STATE_VERSION,
    projects,
    workspaces: workspaces.map((workspace) => {
      // A tab pointing at a dropped session would render an empty agent view, so it
      // goes; a tab pointing at a dropped resource still knows its own path, so it
      // only loses the binding.
      const kept = workspace.tabs.filter((tab) => !tab.sessionId || sessionIds.has(tab.sessionId));
      let mutated = kept.length !== workspace.tabs.length;
      const tabs = reindexTabs(
        kept.map((tab) => {
          if (!tab.resourceId || resourceIds.has(tab.resourceId)) return tab;
          mutated = true;
          return stripResourceId(tab);
        }),
      );
      if (!mutated) return workspace;
      const activeTabId = tabs.some((tab) => tab.id === workspace.activeTabId) ? workspace.activeTabId : tabs[0]?.id;
      return { ...workspace, tabs, activeTabId };
    }),
    resources,
    agentSessions,
    activeProjectId: asOptionalString(input.activeProjectId),
    activeWorkspaceId: asOptionalString(input.activeWorkspaceId),
  });
}
