import { useCallback, useEffect, useState } from 'react';
import {
  preflightLocalTasks,
  preflightBlockers,
  supportsLocalTaskLaunch,
  type TaskPreflight,
} from '../../platform/projectTaskLauncher';

/** Visible state of one guide step. */
type StepState = 'pending' | 'ok' | 'warn' | 'error';

interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

const MARK: Record<StepState, string> = { pending: '○', ok: '✓', warn: '!', error: '×' };

function buildSteps(p: TaskPreflight | null, hasProject: boolean, connected: boolean): Step[] {
  if (!p)
    return [
      { key: 'env', label: '检查运行环境', state: 'pending' },
      { key: 'project', label: '选择项目文件夹', state: hasProject ? 'ok' : 'pending' },
      { key: 'service', label: '启动服务并验证身份', state: connected ? 'ok' : 'pending' },
    ];
  const node: Step = {
    key: 'env',
    label: `检查运行环境（Node.js ${p.node.required}+）`,
    state: p.node.status === 'ok' && p.resources.status === 'ok' ? 'ok' : 'error',
    detail: p.node.status === 'ok' ? p.resources.detail : p.node.detail,
  };
  const project: Step = {
    key: 'project',
    label: '选择项目文件夹',
    state: p.project.status === 'ok' ? 'ok' : p.project.status === 'invalid' ? 'error' : 'pending',
    detail:
      p.project.status === 'ok'
        ? p.project.path
        : p.project.status === 'invalid'
          ? '所选文件夹无效或已不存在。'
          : '尚未选择。',
  };
  const port: Step = {
    key: 'service',
    label: `启动服务并验证身份（端口 ${p.port.value}）`,
    state: connected ? 'ok' : p.port.status === 'in_use' ? 'warn' : p.port.status === 'free' ? 'pending' : 'error',
    detail: connected ? '已连接，看板可用。' : p.port.detail,
  };
  return [node, project, port];
}

export interface TaskBindingGuideProps {
  /** Board already has a live client. */
  connected: boolean;
  /** Currently remembered project folder, if any. */
  projectPath?: string;
  /** Port the guide should probe. */
  port: number;
  busy: boolean;
  /** Runs the existing one-click launch; the guide never launches by itself. */
  onStart: (chooseProject: boolean) => void;
}

/**
 * Turns "scene enabled" into a visible path to a usable board.
 *
 * The guide only *reports* and hands off to the existing launch action; it never
 * auto-starts a service, so the project keeps its "off by default, no autostart"
 * policy. The manual connection entry stays available next to it.
 */
export function TaskBindingGuide({ connected, projectPath, port, busy, onStart }: TaskBindingGuideProps) {
  const [probe, setProbe] = useState<TaskPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState('');

  const runCheck = useCallback(async () => {
    if (!supportsLocalTaskLaunch()) return;
    setChecking(true);
    setFailed('');
    try {
      setProbe(await preflightLocalTasks(projectPath, port));
    } catch (e) {
      setProbe(null);
      setFailed(String(e));
    } finally {
      setChecking(false);
    }
  }, [projectPath, port]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  if (!supportsLocalTaskLaunch()) return null;

  const steps = buildSteps(probe, !!projectPath, connected);
  const blockers = probe ? preflightBlockers(probe) : [];
  const blocked = blockers.length > 0;

  return (
    <section className="tb-binding-guide" aria-label="任务服务绑定引导">
      <div className="tb-guide-head">
        <h3>启用任务场景后，还需要绑定本机服务</h3>
        <button type="button" disabled={busy || checking} onClick={() => void runCheck()}>
          {checking ? '检查中…' : '重新检查'}
        </button>
      </div>
      <ol className="tb-guide-steps">
        {steps.map((s) => (
          <li key={s.key} className={'tb-guide-step is-' + s.state}>
            <span className="tb-guide-mark" aria-hidden="true">{MARK[s.state]}</span>
            <span className="tb-guide-label">{s.label}</span>
            {s.detail && <span className="tb-guide-detail">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {failed && <p role="alert">环境检查失败：{failed}</p>}
      {blocked && (
        <ul className="tb-guide-blockers" aria-label="需要先解决的问题">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="tb-guide-actions">
        <button
          type="button"
          className="tb-primary"
          disabled={busy || checking || (blocked && probe?.project.status !== 'unset')}
          onClick={() => onStart(!projectPath || probe?.project.status !== 'ok')}
        >
          {projectPath && probe?.project.status === 'ok' ? '启动服务并进入看板' : '选择项目文件夹并启动'}
        </button>
        {projectPath && (
          <button type="button" disabled={busy || checking} onClick={() => onStart(true)}>
            改选其他项目
          </button>
        )}
      </div>
      <small>
        绑定只在你点击时发生：A4 Note 不会随软件或系统自动启动任务服务，也不会结束占用端口的其他程序。
        端口已被占用时，如果那是同一项目已在运行的服务，直接启动即可复用。
      </small>
    </section>
  );
}
