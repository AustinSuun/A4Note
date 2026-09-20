import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  loadProjectsPreference,
  normalizeProjectPath,
  type ManagedProject,
} from './projectTasksPreference';

export interface LocalTaskConnection {
  url: string;
  operatorToken: string;
  projectRoot: string;
  projectId: string;
  reused: boolean;
  onboarding?: {
    status: 'ready' | 'warning';
    file?: string;
    changed?: boolean;
    message?: string;
  };
}

export const supportsLocalTaskLaunch = () => isTauri();

export async function selectProjectFolder(title = '选择已有项目文件夹'): Promise<string | null> {
  if (!isTauri()) return null;
  const value = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof value === 'string' ? value : null;
}

export function savedLocalTaskPort(): number {
  const prefs = loadProjectsPreference();
  const active = prefs.projects.find((p) => p.id === prefs.activeProjectId);
  return active?.port ?? 4319;
}

const pending = new Map<string, Promise<LocalTaskConnection | null>>();

export async function launchLocalTasks(
  port = 4319,
  chooseProject = false,
  explicitPath?: string,
): Promise<LocalTaskConnection | null> {
  if (!isTauri())
    throw Error(
      '浏览器不能直接启动本机服务，请在桌面版 A4 Note 中使用一键启动，或展开手动连接。',
    );
  const prefs = loadProjectsPreference();
  const activePath = prefs.projects.find(p => p.id === prefs.activeProjectId)?.path;
  const key = JSON.stringify([chooseProject, normalizeProjectPath(explicitPath ?? activePath ?? ''), port]);
  const existing = pending.get(key);
  if (existing) return existing;
  const launching = (async () => {
    let targetPath = explicitPath;
    let targetPort = port;

    if (!targetPath && chooseProject) {
      const chosen = await selectProjectFolder();
      if (!chosen) return null;
      targetPath = chosen;
    }

    if (!targetPath) {
      const prefs = loadProjectsPreference();
      const active = prefs.projects.find((p) => p.id === prefs.activeProjectId);
      if (active?.path) {
        targetPath = active.path;
        targetPort = active.port ?? port;
      } else {
        const chosen = await selectProjectFolder();
        if (!chosen) return null;
        targetPath = chosen;
      }
    }

    const start = async (pathRoot: string, sPort: number) => {
      const result = await invoke<LocalTaskConnection>('start_project_tasks', {
        projectRoot: pathRoot,
        port: sPort,
      });
      // Register or update project in preferences
      const actual = new URL(result.url);
      if (actual.protocol !== 'http:' || actual.hostname !== '127.0.0.1' || !actual.port)
        throw Error('本机服务返回地址无效');
      // Commit project preferences only after the UI verifies the snapshot identity.
      return result;
    };

    try {
      return await start(targetPath, targetPort);
    } catch (e) {
      if (String(e) === 'PROJECT_REQUIRED') {
        const chosen = await selectProjectFolder();
        if (!chosen) return null;
        return start(chosen, targetPort);
      }
      throw Error(String(e));
    }
  })();
  pending.set(key, launching);
  try {
    return await launching;
  } finally {
    if (pending.get(key) === launching) pending.delete(key);
  }
}
