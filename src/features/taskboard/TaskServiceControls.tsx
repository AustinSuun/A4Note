import { useEffect, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { supportsLocalTaskLaunch } from '../../platform/projectTaskLauncher';
import {
  describeAgents,
  inspectLocalTasks,
  loadExitPolicy,
  saveExitPolicy,
  stopLocalTasks,
  type GatewayInspection,
} from '../../platform/projectTasksLifecycle';
import './taskboard-service.css';

const visibleStates = new Set<GatewayInspection['state']>(['running', 'legacy', 'stale-record']);

/** Exit policy toggle and an explicit stop; desktop only.
 *  `inline` renders bare controls for the board toolbar, `bar` keeps the standalone strip
 *  used before a board connection exists. */
export function TaskServiceControls({ connected, variant = 'bar' }: { connected: boolean; variant?: 'bar' | 'inline' }) {
  const [info, setInfo] = useState<GatewayInspection | null>(null);
  const [keep, setKeep] = useState(loadExitPolicy);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!supportsLocalTaskLaunch()) return;
    let active = true;
    const poll = () => inspectLocalTasks().then((next) => { if (active) setInfo(next); }).catch(() => { if (active) setInfo(null); });
    void poll();
    const timer = setInterval(poll, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [connected]);
  if (!supportsLocalTaskLaunch() || !info || !visibleStates.has(info.state)) return null;
  const agents = info.activeAgents ?? [];
  const stop = async () => {
    if (agents.length > 0) {
      const confirmed = await ask(
        `${agents.length} 个 Agent 最近在线：${describeAgents(agents)}。停止服务后它们会与看板断开连接，进程不会被停止。仍要停止吗？`,
        { title: '停止任务服务', kind: 'warning', okLabel: '停止服务', cancelLabel: '取消' },
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const result = await stopLocalTasks('user-request');
      setNotice(result.stopped ? `任务服务已停止（${result.method ?? 'graceful'}）。` : `未停止：${result.reason ?? '未知原因'}。`);
      setInfo(await inspectLocalTasks());
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };
  const summary =
    info.state === 'running'
      ? ''
      : info.state === 'legacy'
        ? `检测到旧版任务服务（PID ${info.pid}${info.alive === false ? '，已不在运行' : ''}）：不支持安全停止，退出软件时会按旧版方式结束它`
        : `上次的服务记录已失效（PID ${info.pid} ${info.alive ? '仍在运行但身份无法确认' : '未运行'}）`;
  const controls = (
    <>
      {summary && (
        <span className="tb-service-summary" title={agents.length > 0 ? describeAgents(agents) : undefined}>{summary}</span>
      )}
      <label className="tb-service-policy">
        <input
          type="checkbox"
          checked={keep}
          onChange={(e) => { setKeep(e.target.checked); void saveExitPolicy(e.target.checked); }}
        />
        关闭软件时保留后台服务
      </label>
      <button disabled={busy} onClick={() => void stop()}>
        {busy ? '正在停止…' : info.state === 'stale-record' ? '清理记录' : '停止服务'}
      </button>
      {notice && <span className="tb-service-notice">{notice}</span>}
    </>
  );
  if (variant === 'inline') return <div className="tb-service-controls" role="status">{controls}</div>;
  return <div className="tb-service-bar" role="status">{controls}</div>;
}
