import { useState } from 'react';
import type { AcceptanceCapability, AcceptanceCriterion, AcceptanceRun, AcceptanceState, Detail } from '../../platform/projectTasks';
import './task-acceptance-panel.css';

const capabilities: AcceptanceCapability[] = ['command', 'browser', 'desktop'];
const capabilityLabel: Record<AcceptanceCapability, string> = { command: '命令/测试', browser: '浏览器检查', desktop: '真实桌面' };
const decisionLabel: Record<string, string> = {
  eligible_for_auto_archive: '自动验收通过并已归档（用户可复核返工）',
  advisory_pass: '辅助验收通过，仍需用户最终确认',
  needs_human_review: '需要人工确认，未自动归档',
};
const emptyCriterion = (index: number): AcceptanceCriterion => ({
  id: `c${index + 1}`, label: '', expected: '', capability: 'desktop', objective: true, screenshotRequired: true,
});

/** Keep IDs unique after deleting a non-final row; preserve all surviving criteria. */
export function appendAcceptanceCriterion(list: AcceptanceCriterion[]): AcceptanceCriterion[] {
  const used = new Set(list.map(item => item.id));
  let index = 0;
  while (used.has(`c${index + 1}`)) index++;
  return [...list, emptyCriterion(index)];
}

/** Human-owned acceptance configuration plus run state. Never presents a developer's own report as an independent verdict. */
export function TaskAcceptancePanel({ task, state, enabled, busy, onAction }: {
  task: Detail; state: AcceptanceState | null; enabled: boolean; busy: boolean;
  onAction: (body: Record<string, unknown>, confirm?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'manual' | 'automatic'>(state?.config.mode ?? 'manual');
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(state?.config.criteria.length ? state.config.criteria : [emptyCriterion(0)]);
  const [advancedOpen, setAdvancedOpen] = useState(state?.config.mode === 'automatic');
  const [openCriteria, setOpenCriteria] = useState<Set<number>>(() => state?.config.mode === 'automatic'
    ? new Set((state.config.criteria.length ? state.config.criteria : [emptyCriterion(0)]).map((_, index) => index))
    : new Set());
  const [openReports, setOpenReports] = useState<Set<string>>(() => new Set());
  const [target, setTarget] = useState({ kind: 'desktop' as AcceptanceCapability, source: '', version: '', sha256: '' });
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [configRevision, setConfigRevision] = useState(state?.config.revision ?? 0);
  const active = (state?.runs ?? []).find(run => ['waiting', 'running'].includes(run.status) && run.expiresAt > Date.now()) ?? null;
  if (!state) return <section className="tb-acceptance" aria-label="验收方式与独立验收"><p>正在读取验收状态…</p></section>;
  if (state.config.revision !== configRevision) return <section className="tb-acceptance" aria-label="验收方式与独立验收">
    <div role="alert" className="tb-acceptance-alert">验收方式已由用户更新（当前 v{state.config.revision}）。本地草稿未覆盖服务设置，请重新载入。</div>
    <button type="button" disabled={busy} onClick={() => { setConfigRevision(state.config.revision); setMode(state.config.mode);
      setCriteria(state.config.criteria.length ? state.config.criteria : [emptyCriterion(0)]); }}>重新载入当前验收方式</button>
  </section>;
  const patch = (index: number, value: Partial<AcceptanceCriterion>) =>
    setCriteria(list => list.map((item, i) => (i === index ? { ...item, ...value } : item)));
  const updateMode = (next: 'manual' | 'automatic') => { setMode(next); if (next === 'automatic') setAdvancedOpen(true); };
  const toggleCriterion = (index: number) => setOpenCriteria(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const toggleReport = (id: string) => setOpenReports(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const renderRun = (run: AcceptanceRun) => <li key={run.id}>
    <p><strong>{run.status === 'waiting' ? '等待验收Agent' : run.status === 'running' ? '验收执行中' : run.status === 'cancelled' ? '已取消' : '已结束'}</strong>
      {' · '}方式 {run.binding.mode === 'automatic' ? '自动' : '人工辅助'} · 请求 {run.id.slice(0, 8)} · 运行版本 {run.revision}</p>
    <p>执行者：{run.runnerId ? run.runnerId.slice(0, 8) : '尚未领取（没有可用验收Agent时保持等待，不会自动判通过）'}
      {' · '}声明能力：{run.capabilities.length ? run.capabilities.map(c => capabilityLabel[c]).join('、') : '无'}
      {' · '}交付 v{run.binding.deliveryRevision} / 需求 v{run.binding.specRevision} / 标准 v{run.binding.criteriaRevision}</p>
    <p>被测来源：{capabilityLabel[run.binding.target.kind]} · {run.binding.target.version} · sha256:{run.binding.target.sha256.slice(0, 16)}…</p>
    <p>时限：{new Date(run.expiresAt).toLocaleString('zh-CN')}{run.expiresAt <= Date.now() ? '（已超时，须重新发起）' : ''}</p>
    {run.outcome && <div className="tb-acceptance-outcome">
      <p><strong>{decisionLabel[run.outcome.decision] ?? run.outcome.decision}</strong></p>
      {run.outcome.reasons.length ? <ul>{run.outcome.reasons.map(r => <li key={r}>{r}</li>)}</ul> : <p>全部批准标准通过且证据有效。</p>}
      {run.report && <div className="tb-acceptance-report">
        <button type="button" className="tb-secondary-disclosure" aria-expanded={openReports.has(run.id)} onClick={() => toggleReport(run.id)}>
          {openReports.has(run.id) ? '隐藏' : '查看'}报告检查项 · {run.report.checks.length}
        </button>
        {openReports.has(run.id) && <pre>{run.report.environment + '\n' + JSON.stringify(run.report.checks, null, 2)}</pre>}
      </div>}
    </div>}
    {run.status !== 'completed' && run.status !== 'cancelled' && <button type="button" disabled={busy}
      onClick={() => void onAction({ action: 'cancel', runId: run.id, runRevision: run.revision }, '确定取消该验收请求？已上传证据会保留。')}>取消验收请求</button>}
  </li>;
  return <section className="tb-acceptance" aria-label="验收方式与独立验收">
    <h3>验收方式</h3>
    {!enabled && <div role="status" className="tb-acceptance-alert">当前服务未启用独立验收能力，只能继续使用人工验收。需要按“服务能力”说明受控升级，不能只更新前端。</div>}
    <p className="tb-acceptance-note">默认人工验收。切换方式与批准标准仅项目所有者（human）可执行；开发Agent、派发者不能自行切换为自动或降低标准。</p>
    <div className="tb-acceptance-mode">
      <label><input type="radio" name="acceptance-mode" checked={mode === 'manual'} disabled={!enabled || busy}
        onChange={() => updateMode('manual')} />人工验收（可让Agent辅助准备与提交证据，最终仍由你归档）</label>
      <label><input type="radio" name="acceptance-mode" checked={mode === 'automatic'} disabled={!enabled || busy}
        onChange={() => updateMode('automatic')} />自动验收（全部可判定标准通过且证据有效时才自动归档，并标记为自动验收）</label>
    </div>
    <p>已批准：{state.config.approvedBy ? `v${state.config.revision} · ${new Date(state.config.approvedAt ?? 0).toLocaleString('zh-CN')}` : '尚未批准标准'}</p>
    {mode === 'manual' && !advancedOpen ? <div className="tb-acceptance-original">
      <h4>人工审核依据</h4>
      <p>人工模式优先显示任务原始验收要求；不要求检查者理解机器能力、可判定或截图字段。</p>
      <pre>{task.acceptance || '任务没有提供结构化验收要求。'}</pre>
      {!state.config.criteria.length && <p className="tb-acceptance-alert">先批准验收标准，才能发起验收请求。</p>}
      {!enabled && <button type="button" disabled>保存验收方式与标准</button>}
      <button type="button" className="tb-secondary-disclosure" disabled={!enabled || busy} onClick={() => setAdvancedOpen(true)}>配置自动 / Agent 辅助验收</button>
    </div> : <>
      <h4>高级验收标准 · {criteria.length}/40</h4>
      <div className="tb-acceptance-criteria-list">
        {criteria.map((item, index) => { const open = openCriteria.has(index); return <article className="tb-acceptance-criterion" key={index}>
          <header><strong>标准 {index + 1}</strong><code>{item.id || '未设置 ID'}</code><button type="button" className="tb-secondary-disclosure" aria-expanded={open} onClick={() => toggleCriterion(index)}>{open ? '隐藏高级字段' : '显示高级字段'}</button></header>
          <label>说明<textarea aria-label="标准说明" value={item.label} maxLength={2000} disabled={!enabled || busy} onChange={e => patch(index, { label: e.target.value })} /></label>
          <label>预期结果<textarea aria-label="预期结果" value={item.expected} maxLength={2000} disabled={!enabled || busy} onChange={e => patch(index, { expected: e.target.value })} /></label>
          {open && <div className="tb-acceptance-advanced-fields">
            <label>标准 ID<input aria-label="标准ID" value={item.id} maxLength={64} disabled={!enabled || busy} onChange={e => patch(index, { id: e.target.value })} /></label>
            <label>验收能力<select aria-label="验收能力" value={item.capability} disabled={!enabled || busy} onChange={e => patch(index, { capability: e.target.value as AcceptanceCapability })}>{capabilities.map(c => <option key={c} value={c}>{capabilityLabel[c]}</option>)}</select></label>
            <label className="tb-acceptance-check"><input type="checkbox" aria-label="可判定" checked={item.objective} disabled={!enabled || busy} onChange={e => patch(index, { objective: e.target.checked })} />可判定</label>
            <label className="tb-acceptance-check"><input type="checkbox" aria-label="需截图" checked={item.screenshotRequired} disabled={!enabled || busy} onChange={e => patch(index, { screenshotRequired: e.target.checked })} />需要截图</label>
          </div>}
          <button type="button" className="tb-criterion-delete" disabled={!enabled || busy || criteria.length <= 1} onClick={() => setCriteria(list => list.filter((_, i) => i !== index))}>删除此标准</button>
        </article>; })}
      </div>
      <div className="tb-acceptance-actions">
        <button type="button" disabled={!enabled || busy || criteria.length >= 40} onClick={() => setCriteria(appendAcceptanceCriterion)}>增加标准</button>
        <button type="button" className="tb-primary" disabled={!enabled || busy} onClick={() => void onAction({ action: 'configure', revision: task.revision, configRevision, mode, criteria }, '确定保存验收方式与标准？会提升验收标准版本，旧验收请求将失效。')}>保存验收方式与标准</button>
      </div>
    </>}
    {mode === 'automatic' && <p className="tb-acceptance-note">自动验收须全部标准可判定；主观标准请保留人工验收。桌面标准不能用无头浏览器或命令测试代替。</p>}
    <button type="button" className="tb-secondary-disclosure tb-advanced-tools-toggle" aria-expanded={advancedOpen || mode === 'automatic'} onClick={() => setAdvancedOpen(open => !open)}>{advancedOpen || mode === 'automatic' ? '收起高级验收工具' : '打开高级验收工具'}{state.runs.length ? ` · ${state.runs.length} 条记录` : ''}</button>
    {(advancedOpen || mode === 'automatic') && <section className="tb-acceptance-advanced-tools" aria-label="高级验收工具">
    <h3>独立验收请求</h3>
    {task.status !== 'review' && <p>任务处于「{task.status}」，只有已提交的待检查交付可以发起验收请求。</p>}
    {active && <p role="status">已有进行中的请求 {active.id.slice(0, 8)}（{active.status === 'waiting' ? '等待验收Agent领取' : '执行中'}）。需先取消才能重新发起。</p>}
    {!active && task.status === 'review' && <div className="tb-acceptance-request">
      <label>被测来源类型
        <select value={target.kind} disabled={!enabled || busy} onChange={e => setTarget(t => ({ ...t, kind: e.target.value as AcceptanceCapability }))}>
          {capabilities.map(c => <option key={c} value={c}>{capabilityLabel[c]}</option>)}</select></label>
      <label>可执行文件/页面来源<input value={target.source} maxLength={2048} disabled={!enabled || busy}
        placeholder="只填明确授权的可信版本路径或URL" onChange={e => setTarget(t => ({ ...t, source: e.target.value }))} /></label>
      <label>被测版本<input value={target.version} maxLength={160} disabled={!enabled || busy}
        placeholder="0.1.16 或构建标识" onChange={e => setTarget(t => ({ ...t, version: e.target.value }))} /></label>
      <label>被测构建SHA256<input value={target.sha256} maxLength={64} disabled={!enabled || busy}
        onChange={e => setTarget(t => ({ ...t, sha256: e.target.value.trim().toLowerCase() }))} /></label>
      <label>等待时限（分钟）<input type="number" min={1} max={1440} value={ttlMinutes} disabled={!enabled || busy}
        onChange={e => setTtlMinutes(Number(e.target.value))} /></label>
      <button type="button" className="tb-primary" disabled={!enabled || busy || state.config.revision < 1 || !state.config.criteria.length}
        onClick={() => void onAction({ action: 'request', revision: task.revision, target, ttlMs: Math.round(ttlMinutes * 60000) })}>发起独立验收请求</button>
      {!state.config.criteria.length && <p className="tb-acceptance-alert">先批准验收标准，才能发起验收请求。</p>}
      <p className="tb-acceptance-note">请求发出后由具备能力的独立验收会话领取；开发会话不能验收自己的交付。验收Agent接入命令：<br />
        <code>cli.mjs acceptance {task.id} --action claim --run-id &lt;runId&gt; --run-revision 1 --capabilities desktop</code><br />
        <code>cli.mjs upload {task.id} --file 报告.json --revision N --purpose result --acceptance-run &lt;runId&gt; --evidence-kind report --captured-at &lt;epoch ms&gt;</code></p>
    </div>}
    {state.runs.length > 0 && <><h4>验收请求记录 · {state.runs.length}</h4><ul className="tb-acceptance-runs">{state.runs.slice(0, 8).map(renderRun)}</ul></>}
    </section>}
    {task.status === 'archived' && task.acceptance_archive_run && <div className="tb-acceptance-reopen">
      <p>该任务由自动验收归档（请求 {task.acceptance_archive_run.slice(0, 8)}）。自动通过不代表用户满意。</p>
      <button type="button" disabled={!enabled || busy}
        onClick={() => void onAction({ action: 'reopen', reason: window.prompt('复核返工原因（会退回待检查）：') ?? '' })}>复核不通过，退回待检查</button>
    </div>}
  </section>;
}
