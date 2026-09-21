import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  loadProjectsPreference,
  normalizeProjectPath,
  type ManagedProject,
} from './projectTasksPreference';
import { installTaskServiceExitHandler } from './projectTasksLifecycle';

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

/** One probe result inside {@link TaskPreflight}. */
export interface PreflightCheck {
  status: string;
  detail?: string;
}

/**
 * Read-only environment probe used by the binding guide.
 *
 * Reports blockers before anything is launched. It never starts, stops or
 * contacts a service, and never frees a busy port.
 */
export interface TaskPreflight {
  ready: boolean;
  node: PreflightCheck & { version: string; required: string };
  resources: PreflightCheck;
  project: PreflightCheck & { path: string };
  port: PreflightCheck & { value: number };
}

export async function preflightLocalTasks(
  projectRoot?: string,
  port = 4319,
): Promise<TaskPreflight | null> {
  if (!isTauri()) return null;
  return invoke<TaskPreflight>('preflight_project_tasks', { projectRoot, port });
}

/** Human-readable blockers, in the order the guide should surface them. */
export function preflightBlockers(p: TaskPreflight): string[] {
  const out: string[] = [];
  if (p.node.status !== 'ok') out.push(p.node.detail || '无法确认 Node.js 环境。');
  if (p.resources.status !== 'ok') out.push(p.resources.detail || '缺少任务服务资源。');
  if (p.project.status === 'unset') out.push('尚未选择项目文件夹。');
  else if (p.project.status === 'invalid') out.push('所选项目文件夹无效或已不存在。');
  if (p.port.status === 'invalid' || p.port.status === 'unknown')
    out.push(p.port.detail || '端口不可用。');
  return out;
}

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
      // Exit confirmation must be listening before the native side can start intercepting closes.
      await installTaskServiceExitHandler();
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
