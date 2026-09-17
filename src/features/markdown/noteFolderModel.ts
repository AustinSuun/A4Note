import type { Project, WorkbenchState } from '../../core/workspace';
export type NoteFolder = { key: string; name: string; path: string; projectIds: string[] };
export const noteFolderKey = (path: string) => path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/** Deduplicated folder navigation over the current workbench namespace. */
export function noteFolders(projects: Project[]): NoteFolder[] {
  const folders = new Map<string, NoteFolder>();
  for (const project of projects) {
    if (project.kind !== 'folder' || !project.rootPath.trim()) continue;
    const key = noteFolderKey(project.rootPath);
    const found = folders.get(key);
    if (found) found.projectIds.push(project.id);
    else folders.set(key, { key, name: project.rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || project.name, path: project.rootPath, projectIds: [project.id] });
  }
  return [...folders.values()];
}
export function noteFolderWorkspace(state: WorkbenchState, folder: NoteFolder, remembered?: string) {
  const candidates = state.workspaces.filter(workspace => folder.projectIds.includes(workspace.projectId));
  return candidates.find(workspace => workspace.id === remembered)
    ?? candidates.find(workspace => workspace.id === state.activeWorkspaceId)
    ?? candidates.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}
export function readNoteFolderPreferences(raw: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.length < 2048 && typeof value === 'string' && value.length < 256));
  } catch { return {}; }
}
