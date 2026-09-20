import { createHash, randomUUID } from 'node:crypto';

/** Pure policy. Inputs named context/run MUST come from authenticated server state,
 * never directly from a request body. The Store adapter must transact compare-and-
 * swap, persist events, verify attachment bytes, and perform any archive itself.
 * Session separation is not proof of different humans/models. No process is launched.
 */
export class AcceptancePolicyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new AcceptancePolicyError(status, message); };
const requireThat = (value, status, message) => { if (!value) reject(status, message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const capabilities = ['command', 'browser', 'desktop'];
function string(value, label, max = 2000) {
  requireThat(typeof value === 'string' && value.trim() && value.length <= max, 400, `${label}不能为空或超长`);
  return value.trim();
}
function clock(value) {
  requireThat(Number.isSafeInteger(value) && value >= 0, 400, '服务端时间无效');
  return value;
}
function human(actor) { requireThat(actor?.role === 'human' && actor.id === 'human', 403, '仅用户可批准或取消验收'); }
function worker(actor) { requireThat(actor?.role === 'worker' && typeof actor.id === 'string' && actor.id !== 'human' && actor.id.length > 0, 403, '需要独立执行Agent会话'); }
function revision(actual, expected) { requireThat(Number.isInteger(expected) && expected === actual, 409, '验收版本已变化，请重新读取'); }

export function defaultAcceptance() {
  return { mode: 'manual', revision: 0, specRevision: null, approvedBy: null, criteria: [], approvedAt: null };
}

export function configureAcceptance(actor, previous, input, task, now = Date.now()) {
  human(actor); clock(now);
  requireThat(task?.status !== 'archived', 409, '已归档任务只读');
  revision(previous.revision, input.revision);
  requireThat(['manual', 'automatic'].includes(input.mode), 400, '验收方式无效');
  requireThat(Array.isArray(input.criteria) && input.criteria.length <= 40, 400, '验收标准最多40项');
  const ids = new Set();
  const criteria = input.criteria.map(item => {
    const id = string(item?.id, '标准ID', 64);
    requireThat(/^[a-zA-Z0-9_-]+$/.test(id) && !ids.has(id), 400, '标准ID重复或无效'); ids.add(id);
    requireThat(capabilities.includes(item.capability), 400, '验收能力无效');
    requireThat(typeof item.objective === 'boolean' && typeof item.screenshotRequired === 'boolean', 400, '须明确标准可判定性和截图要求');
    return { id, label: string(item.label, '标准说明'), expected: string(item.expected, '预期结果'),
      capability: item.capability, objective: item.objective, screenshotRequired: item.screenshotRequired };
  });
  requireThat(input.mode !== 'automatic' || (criteria.length > 0 && criteria.every(c => c.objective)), 400, '自动验收须有可判定的标准；主观项请使用人工验收');
  requireThat(Number.isInteger(task.spec_revision) && task.spec_revision > 0, 400, '任务标准版本无效');
  return { mode: input.mode, revision: previous.revision + 1, specRevision: task.spec_revision,
    approvedBy: actor.id, approvedAt: now, criteria };
}

function targetOf(target) {
  requireThat(target && ['command', 'browser', 'desktop'].includes(target.kind), 400, '必须指定被测来源类型');
  requireThat(sha(target.sha256), 400, '必须指定被测构建SHA256');
  // The source is descriptive only. This module MUST NOT execute it as a command.
  return { kind: target.kind, source: string(target.source, '指定来源', 2048), version: string(target.version, '被测版本', 160), sha256: target.sha256 };
}
function binding(context) {
  const { task, config, projectId, target } = context;
  requireThat(task?.status === 'review' && task.owner, 409, '只可验收已提交的交付');
  requireThat(task.claimed_spec === task.spec_revision, 409, '交付未确认当前需求');
  requireThat(Number.isInteger(task.delivery_revision) && task.delivery_revision > 0, 409, '缺少服务端交付版本，不能验收');
  requireThat(config.approvedBy === 'human' && config.revision > 0 && config.specRevision === task.spec_revision && config.criteria.length > 0, 409, '验收标准缺失或已过期，需用户批准');
  return { projectId: string(projectId, '项目ID', 128), taskId: string(task.id, '任务ID', 128),
    developerId: task.owner, specRevision: task.spec_revision,
    deliveryRevision: task.delivery_revision, resultHash: digest(string(task.result, '交付结果', 16000)),
    criteriaRevision: config.revision, mode: config.mode, criteriaHash: digest(JSON.stringify(config.criteria)),
    target: targetOf(target) };
}
function current(run, context) {
  // Old acceptance records may carry a planRevision field. It is historical
  // metadata only; direct queue acceptance must not gate on a plan revision.
  const withoutLegacyPlan = value => {
    const { planRevision: _planRevision, ...rest } = value ?? {};
    return rest;
  };
  requireThat(JSON.stringify(withoutLegacyPlan(run.binding)) === JSON.stringify(binding(context)), 409, '交付、标准、模式或构建已变化，旧验收失效');
}
function active(run, now) {
  clock(now);
  requireThat(now >= run.createdAt, 409, '服务端时间早于请求创建时间');
  requireThat(now < run.expiresAt, 409, '验收请求已超时，须由用户重新发起');
  requireThat(!['cancelled', 'completed'].includes(run.status), 409, '验收请求已结束');
}

export function requestAcceptance(actor, context, ttlMs = 30 * 60 * 1000, now = Date.now()) {
  human(actor); clock(now);
  requireThat(Number.isInteger(ttlMs) && ttlMs >= 1000 && ttlMs <= 24 * 60 * 60 * 1000, 400, '验收时限须在1秒至24小时内');
  const snapshot = binding(context);
  return { id: randomUUID(), revision: 1, status: 'waiting', createdAt: now, expiresAt: now + ttlMs,
    binding: snapshot, criteria: clone(context.config.criteria), runnerId: null, claimedAt: null, completedAt: null,
    capabilities: [], reportHash: null, outcome: null };
}

export function claimAcceptance(actor, run, context, expectedRevision, available, now = Date.now()) {
  worker(actor); revision(run.revision, expectedRevision); current(run, context); active(run, now);
  requireThat(run.status === 'waiting' && !run.runnerId, 409, '验收请求已被领取');
  requireThat(actor.id !== run.binding.developerId, 403, '开发会话不能验收自己的交付');
  requireThat(Array.isArray(available) && available.length <= 3 && available.every(c => capabilities.includes(c)), 400, '能力声明无效');
  const required = [...new Set(run.criteria.map(c => c.capability))];
  requireThat(required.every(c => available.includes(c)), 409, '能力不足：不能以浏览器或命令测试代替真实桌面验收');
  // Declarations are not independent attestation of the machine's actual abilities.
  return { ...clone(run), revision: run.revision + 1, status: 'running', runnerId: actor.id,
    claimedAt: now, capabilities: [...new Set(available)] };
}

export function cancelAcceptance(actor, run, expectedRevision, now = Date.now()) {
  human(actor); clock(now); revision(run.revision, expectedRevision);
  requireThat(run.status !== 'completed' && run.status !== 'cancelled', 409, '验收请求已结束');
  return { ...clone(run), revision: run.revision + 1, status: 'cancelled', cancelledAt: now };
}

/** attachments is a trusted server-side list. Adapter must verify bytesSha256 by
 * hashing actual stored bytes (not copying the hash from the worker's report).
 * Evidence metadata can bind a report to a run, not prove that screenshots are true.
 */
export function completeAcceptance(actor, run, context, expectedRevision, report, attachments, now = Date.now()) {
  worker(actor); clock(now); current(run, context);
  requireThat(actor.id === run.runnerId && actor.id !== run.binding.developerId, 403, '仅本请求独立验收者可提交');
  requireThat(report && typeof report === 'object' && !Array.isArray(report), 400, '需要结构化验收报告');
  const serialized = JSON.stringify(report);
  requireThat(serialized.length <= 64000, 400, '验收报告过长');
  const reportHash = digest(serialized);
  if (run.status === 'completed') {
    // Retry of the exact successful commit is idempotent, including after expiry.
    requireThat(run.reportHash === reportHash && expectedRevision === run.revision - 1, 409, '重复回调与已保存报告或版本不一致');
    return { run: clone(run), decision: run.outcome.decision, replay: true };
  }
  revision(run.revision, expectedRevision); active(run, now);
  requireThat(run.status === 'running', 409, '须先领取验收请求');
  requireThat(report.runId === run.id && report.projectId === run.binding.projectId && report.taskId === run.binding.taskId, 403, '报告不能跨请求、项目或任务提交');
  requireThat(report.deliveryRevision === run.binding.deliveryRevision && report.criteriaRevision === run.binding.criteriaRevision, 409, '报告版本不匹配');
  requireThat(JSON.stringify(targetOf(report.target)) === JSON.stringify(run.binding.target), 409, '报告被测构建或来源不匹配');
  requireThat(Array.isArray(report.checks) && report.checks.length <= 40, 400, '检查项格式无效');
  requireThat(Array.isArray(attachments), 400, '缺少服务端附件索引');
  string(report.environment, '运行环境', 4000);
  const reasons = [], seen = new Set(), index = new Map(attachments.map(a => [a.id, a]));
  const evidence = (id, kind, criterionId) => {
    const a = index.get(id);
    if (!a || a.task_id !== run.binding.taskId || a.project_id !== run.binding.projectId ||
        a.acceptance_run_id !== run.id || a.created_by !== actor.id || a.purpose !== 'result' || a.retired_at ||
        a.delivery_revision !== run.binding.deliveryRevision || a.criteria_revision !== run.binding.criteriaRevision ||
        a.build_sha256 !== run.binding.target.sha256 || !sha(a.sha256) || a.bytesSha256 !== a.sha256 ||
        !Number.isSafeInteger(a.captured_at) || a.captured_at < run.claimedAt || a.captured_at > now ||
        a.evidence_kind !== kind || (criterionId && a.criterion_id !== criterionId) ||
        (kind === 'screenshot' && !['image/png', 'image/jpeg', 'image/webp'].includes(a.mime))) {
      reasons.push(`证据缺失或失效：${kind}${criterionId ? '/' + criterionId : ''}`);
    }
  };
  evidence(report.reportAttachmentId, 'report');
  for (const item of report.checks) {
    requireThat(item && typeof item === 'object' && !seen.has(item.id), 400, '检查项重复或无效');
    const c = run.criteria.find(c => c.id === item.id);
    requireThat(c, 400, '未知验收标准'); seen.add(item.id);
    requireThat(['passed', 'failed', 'not_run', 'blocked'].includes(item.status), 400, '检查状态无效');
    string(item.actual, '实际结果', 4000); string(item.steps, '实际步骤', 4000);
    if (item.status !== 'passed') reasons.push(`${c.id}：${item.status}`);
    if (!c.objective) reasons.push(`${c.id}：主观标准需人工确认`);
    if (item.capability !== c.capability || !run.capabilities.includes(c.capability)) reasons.push(`${c.id}：能力不匹配`);
    if (item.expected !== c.expected) reasons.push(`${c.id}：预期结果与批准标准不符`);
    if (c.screenshotRequired) evidence(item.screenshotAttachmentId, 'screenshot', c.id);
  }
  for (const c of run.criteria) if (!seen.has(c.id)) reasons.push(`${c.id}：未执行`);
  const decision = reasons.length ? 'needs_human_review' : run.binding.mode === 'automatic' ? 'eligible_for_auto_archive' : 'advisory_pass';
  return { run: { ...clone(run), revision: run.revision + 1, status: 'completed', completedAt: now,
    reportHash, outcome: { decision, reasons } }, decision, replay: false };
}
