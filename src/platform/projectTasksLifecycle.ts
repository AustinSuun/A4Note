import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { pauseTaskEventStreams } from './projectTasks';

/** Identity and activity of the recorded local task gateway, as reported by gateway-lifecycle.mjs. */
export interface GatewayInspection {
  state: 'none' | 'running' | 'legacy' | 'stale-record' | 'foreign' | 'pid-mismatch';
  url?: string;
  pid?: number;
  version?: number | null;
  startedAt?: string;
  alive?: boolean;
  livePid?: number;
  projects?: { id: string; root: string; name?: string; legacy?: boolean }[];
  activeAgents?: { alias: string; role: string; last_seen: string; project?: string }[];
  streams?: { app: number; other: number };
}
export interface GatewayStopResult extends GatewayInspection {
  stopped: boolean;
  skipped?: boolean;
  accepted?: boolean;
  method?: string;
  reason?: string;
}

const EXIT_EVENT = 'a4note://task-service-exit';
const POLICY_KEY = 'a4note.tasks.exit-policy.v1';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const inspectLocalTasks = () => invoke<GatewayInspection>('inspect_project_tasks');
export const stopLocalTasks = (reason: string) => invoke<GatewayStopResult>('stop_project_tasks', { reason });

/** true = leave the service running after A4 Note exits (user choice, default false). */
export function loadExitPolicy(): boolean {
  try { return localStorage.getItem(POLICY_KEY) === 'keep'; } catch { return false; }
}
export async function saveExitPolicy(keepRunning: boolean) {
  try { localStorage.setItem(POLICY_KEY, keepRunning ? 'keep' : 'stop'); } catch {}
  if (isTauri()) await invoke('set_project_tasks_exit_policy', { keepRunning });
}

export const describeAgents = (agents: GatewayInspection['activeAgents']) =>
  (agents ?? []).map((a) => a.alias + (a.project ? `（${a.project}）` : '')).join('、');

let installed: Promise<void> | null = null;
/** Registers the exit confirmation flow once; safe to call before every launch. */
export function installTaskServiceExitHandler(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!installed) {
    installed = (async () => {
      await invoke('set_project_tasks_exit_policy', { keepRunning: loadExitPolicy() });
      await listen(EXIT_EVENT, () => { void handleExitRequest(); });
    })().catch((error) => { installed = null; throw error; });
  }
  return installed;
}

let exitFlow: Promise<void> | null = null;
function handleExitRequest() {
  if (!exitFlow) exitFlow = runExitFlow().finally(() => { exitFlow = null; });
  return exitFlow;
}

async function runExitFlow() {
  const resolve = (proceed: boolean, stopService: boolean) => invoke('resolve_app_exit', { proceed, stopService });
  let info: GatewayInspection;
  try {
    // Our own board stream would otherwise count as "another window"; it reconnects by itself if exit is cancelled.
    pauseTaskEventStreams();
    await wait(400);
    info = await inspectLocalTasks();
  } catch {
    // Cannot inspect: exit and let the native fallback try a bounded stop.
    await resolve(true, true);
    return;
  }
  if (info.state === 'none' || info.state === 'foreign' || info.state === 'pid-mismatch') {
    await resolve(true, false);
    return;
  }
  if (info.state === 'running' && (info.streams?.app ?? 0) > 0) {
    await message('另一个 A4 Note 窗口仍连接着本机任务服务，本次退出将保留后台服务。', { title: '任务服务', kind: 'info' });
    await resolve(true, false);
    return;
  }
  const agents = info.activeAgents ?? [];
  if (agents.length > 0) {
    const proceed = await ask(
      `任务服务正在后台运行，${agents.length} 个 Agent 最近在线：${describeAgents(agents)}。\n\n` +
        '退出 A4 Note 会停止本机任务服务：这些 Agent 会与看板断开连接，它们的进程不会被停止，之后上报的进度要等看板重新启动服务后才能写入。\n\n' +
        '如需在退出后保留服务，请取消，并在任务场景勾选“关闭软件时保留后台服务”。',
      { title: '退出 A4 Note', kind: 'warning', okLabel: '退出并停止服务', cancelLabel: '取消' },
    );
    if (!proceed) { await resolve(false, false); return; }
  }
  let result: GatewayStopResult | null = null;
  try { result = await stopLocalTasks('app-exit'); } catch (error) {
    await message(`任务服务未能停止：${String(error)}`, { title: '任务服务', kind: 'warning' });
  }
  if (result && !result.stopped && !result.skipped) {
    await message(
      `任务服务未能停止（${result.reason ?? '未知原因'}）。进程 PID ${result.pid ?? '未知'} 可能仍在运行；重新打开 A4 Note 的任务场景可再次停止。`,
      { title: '任务服务', kind: 'warning' },
    );
  }
  await resolve(true, false);
}
