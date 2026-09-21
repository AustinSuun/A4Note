/** Default-off migration for a new optional scene; unrelated preferences are preserved. */
export function withProjectTasksDefaultOff(
  disabled: readonly string[],
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): string[] {
  const safeDefault = () => Array.from(new Set([...disabled, 'tasks.core']));
  try {
    const target = storage ?? localStorage;
    if (target.getItem('aster.tasks-opt-in-v1') === '1') return [...disabled];
    let previouslySelected = false;
    try {
      const ui = JSON.parse(target.getItem('aster.uiState') ?? '{}');
      previouslySelected =
        Array.isArray(ui.visibleSceneIds) && ui.visibleSceneIds.includes('tasks');
    } catch {
      /* malformed preferences must not opt in */
    }
    const result = previouslySelected ? [...disabled] : safeDefault();
    target.setItem('aster.disabledPlugins', JSON.stringify(result));
    target.setItem('aster.tasks-opt-in-v1', '1');
    return result;
  } catch {
    return safeDefault();
  }
}

export interface ManagedProject {
  id: string;
  path: string;
  name: string;
  port?: number;
  addedAt?: string;
  lastConnected?: string;
  serviceProjectId?: string;
}

export interface ProjectsPreferenceData {
  projects: ManagedProject[];
  activeProjectId: string | null;
  sidebarOpen: boolean;
}

const MULTI_PREF_KEY = 'a4note.tasks.projects.v2';
const LEGACY_PREF_KEY = 'a4note.tasks.local-start.v1';

export function normalizeProjectPath(rawPath: string): string {
  let p = rawPath.trim().replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(p)) {
    p = p[0].toLowerCase() + p.slice(1);
  }
  const unc = p.startsWith('//');
  p = p.replace(/\/+/g, '/');
  if (unc) p = '/' + p;
  if (p.length > 3 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

export function isSameProjectPath(pathA: string, pathB: string): boolean {
  return normalizeProjectPath(pathA).toLowerCase() === normalizeProjectPath(pathB).toLowerCase();
}

export function deriveProjectName(normalizedPath: string): string {
  const parts = normalizedPath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '项目';
}

export function generateProjectId(normalizedPath: string): string {
  let hash = 0;
  const str = normalizedPath.toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'proj-' + Math.abs(hash).toString(36);
}

export function loadProjectsPreference(
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ProjectsPreferenceData {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return { projects: [], activeProjectId: null, sidebarOpen: true };
  try {
    const raw = s.getItem(MULTI_PREF_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.projects)) {
        const projects: ManagedProject[] = data.projects;
        const activeProjectId =
          typeof data.activeProjectId === 'string' &&
          projects.some((p) => p.id === data.activeProjectId)
            ? data.activeProjectId
            : (projects[0]?.id ?? null);
        return {
          projects,
          activeProjectId,
          sidebarOpen: data.sidebarOpen !== false,
        };
      }
    }
  } catch {}

  // Migrate legacy single project preference
  try {
    const legacyRaw = s.getItem(LEGACY_PREF_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (typeof legacy.projectRoot === 'string' && legacy.projectRoot.trim()) {
        const normPath = normalizeProjectPath(legacy.projectRoot);
        const name = deriveProjectName(normPath);
        const proj: ManagedProject = {
          id: generateProjectId(normPath),
          path: normPath,
          name,
          port: Number.isInteger(legacy.port) ? legacy.port : 4319,
          addedAt: new Date().toISOString(),
        };
        const initialData: ProjectsPreferenceData = {
          projects: [proj],
          activeProjectId: proj.id,
          sidebarOpen: true,
        };
        s.setItem(MULTI_PREF_KEY, JSON.stringify(initialData));
        return initialData;
      }
    }
  } catch {}

  return { projects: [], activeProjectId: null, sidebarOpen: true };
}

export function saveProjectsPreference(
  data: ProjectsPreferenceData,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return;
  try {
    s.setItem(MULTI_PREF_KEY, JSON.stringify(data));
    const active = data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0];
    if (active) {
      s.setItem(
        LEGACY_PREF_KEY,
        JSON.stringify({
          projectRoot: active.path,
          port: active.port ?? 4319,
        }),
      );
    }
  } catch {}
}

export function addManagedProject(
  rawPath: string,
  customName?: string,
  port = 4319,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): { project: ManagedProject; isNew: boolean; state: ProjectsPreferenceData } {
  const normPath = normalizeProjectPath(rawPath);
  const current = loadProjectsPreference(storage);
  const existing = current.projects.find((p) => isSameProjectPath(p.path, normPath));
  if (existing) {
    const nextState: ProjectsPreferenceData = {
      ...current,
      activeProjectId: existing.id,
      projects: current.projects.map(p => p.id === existing.id ? { ...p, port } : p),
    };
    saveProjectsPreference(nextState, storage);
    return { project: { ...existing, port }, isNew: false, state: nextState };
  }
  const name = (customName && customName.trim()) || deriveProjectName(normPath);
  const newProj: ManagedProject = {
    id: generateProjectId(normPath + '-' + Date.now().toString(36)),
    path: normPath,
    name,
    port,
    addedAt: new Date().toISOString(),
  };
  const nextProjects = [...current.projects, newProj];
  const nextState: ProjectsPreferenceData = {
    projects: nextProjects,
    activeProjectId: newProj.id,
    sidebarOpen: current.sidebarOpen,
  };
  saveProjectsPreference(nextState, storage);
  return { project: newProj, isNew: true, state: nextState };
}

export function updateProjectName(
  id: string,
  name: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ProjectsPreferenceData {
  const trimmed = name.trim();
  if (!trimmed) return loadProjectsPreference(storage);
  const current = loadProjectsPreference(storage);
  const nextProjects = current.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
  const nextState: ProjectsPreferenceData = {
    ...current,
    projects: nextProjects,
  };
  saveProjectsPreference(nextState, storage);
  return nextState;
}

export function removeManagedProject(
  id: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): { remaining: ManagedProject[]; nextActiveId: string | null; state: ProjectsPreferenceData } {
  const current = loadProjectsPreference(storage);
  const remaining = current.projects.filter((p) => p.id !== id);
  let nextActiveId = current.activeProjectId;
  if (current.activeProjectId === id) {
    nextActiveId = remaining[0]?.id ?? null;
  }
  const nextState: ProjectsPreferenceData = {
    ...current,
    projects: remaining,
    activeProjectId: nextActiveId,
  };
  saveProjectsPreference(nextState, storage);
  return { remaining, nextActiveId, state: nextState };
}

export function setActiveProjectId(
  id: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ProjectsPreferenceData {
  const current = loadProjectsPreference(storage);
  if (!current.projects.some((p) => p.id === id)) return current;
  const nextState: ProjectsPreferenceData = {
    ...current,
    activeProjectId: id,
  };
  saveProjectsPreference(nextState, storage);
  return nextState;
}

export function setSidebarOpenPref(
  open: boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ProjectsPreferenceData {
  const current = loadProjectsPreference(storage);
  const nextState: ProjectsPreferenceData = {
    ...current,
    sidebarOpen: open,
  };
  saveProjectsPreference(nextState, storage);
  return nextState;
}
