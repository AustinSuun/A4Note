import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskServer } from '../server.mjs';
import { Store } from '../lib/store.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const buildSha256 = 'a'.repeat(64);
const target = { kind: 'desktop', source: 'D:/apps/a4note.exe', version: '0.1.16-test', sha256: buildSha256 };
const criterion = (id, extra = {}) => ({
  id, label: '标准' + id, expected: '预期' + id, capability: 'desktop', objective: true, screenshotRequired: true, ...extra,
});
const reportOf = (run, task, checks) => ({
  runId: run.id, projectId: run.binding.projectId, taskId: task.id,
  deliveryRevision: run.binding.deliveryRevision, criteriaRevision: run.binding.criteriaRevision,
  target, environment: '隔离数据目录与profile；窗口1280x800；缩放100%；浅色主题。', checks,
});
const check = (run, status, screenshotAttachmentId) => ({
  id: run.criteria[0].id, capability: run.criteria[0].capability, expected: run.criteria[0].expected,
  status, actual: '实际结果' + status, steps: '打开被测版本并核对', screenshotAttachmentId,
});

test('acceptance integration: migration, protocol roles, evidence binding, auto archive and reopen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-integration-'));
  const app = createTaskServer({ dataDir: dir, project: '验收项目' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const admin = app.store.access.operatorToken, enroll = app.store.access.enrollmentToken;
  const call = async (endpoint, token = admin, method = 'GET', body) => {
    const r = await fetch(url + '/api' + endpoint, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    const health = await (await fetch(url + '/api/health')).json();
    assert.equal(health.capabilities.acceptance, true, '健康检查应声明验收能力');
    assert.equal(health.capabilities.queue, true);

    const dev = (await call('/join', enroll, 'POST', { alias: '青开' })).body;
    const verifier = (await call('/join', enroll, 'POST', { alias: '青验' })).body;
    assert.notEqual(dev.id, verifier.id);
    const created = (await call('/tasks', admin, 'POST', { title: '验收接线', description: '说明', acceptance: '要求' })).body;
    const id = created.id;
    const fresh = async () => (await call('/tasks/' + id)).body;
    const acceptance = async () => (await call('/tasks/' + id + '/acceptance')).body;
    const post = async (body, token = admin) => call('/tasks/' + id + '/acceptance', token, 'POST', body);
    const upload = async (token, body) => call('/tasks/' + id + '/attachments', token, 'POST', body);

    // 直接进入队列 → 领取 → 提交，产生服务端交付版本
    let task = created;
    assert.equal(task.status, 'queued');
    task = (await call('/tasks/' + id, dev.sessionToken, 'PATCH', { action: 'claim', revision: task.revision })).body;
    assert.equal(task.delivery_revision, 0, '未提交前没有交付版本');
    task = (await call('/tasks/' + id, dev.sessionToken, 'PATCH', { action: 'submit', revision: task.revision, result: '已完成，验证说明见附件' })).body;
    assert.equal(task.status, 'review');
    assert.equal(task.delivery_revision, 1, '提交应生成服务端交付版本');

    // 默认人工验收；旧数据迁移不得批量自动归档
    let state = await acceptance();
    assert.equal(state.config.mode, 'manual');
    assert.equal(state.config.revision, 0);
    assert.deepEqual(state.runs, []);

    // 只有用户可切换方式与批准标准
    assert.equal((await post({ action: 'configure', revision: task.revision, configRevision: 0, mode: 'automatic', criteria: [criterion('c1')] }, dev.sessionToken)).status, 403);
    assert.equal((await post({ action: 'configure', revision: task.revision, configRevision: 0, mode: 'automatic', criteria: [criterion('c1', { objective: false })] })).status, 400, '自动模式不接受主观标准');
    assert.equal((await post({ action: 'configure', revision: task.revision, configRevision: 5, mode: 'manual', criteria: [] })).status, 409, '标准版本必须匹配');
    assert.equal((await post({ action: 'configure', revision: task.revision + 99, configRevision: 0, mode: 'manual', criteria: [] })).status, 409, '任务版本必须匹配');
    state = (await post({ action: 'configure', revision: task.revision, configRevision: 0, mode: 'automatic', criteria: [criterion('c1')] })).body;
    assert.equal(state.config.revision, 1);
    assert.equal(state.config.mode, 'automatic');
    assert.equal(state.config.approvedBy, 'human');
    assert.equal(state.config.specRevision, task.spec_revision);
    assert.equal(state.task.revision, task.revision + 1);
    task = state.task;

    // 发起独立验收请求：绑定当前交付、标准与被测构建
    assert.equal((await post({ action: 'request', revision: task.revision, target: { ...target, sha256: 'z'.repeat(64) } })).status, 400);
    state = (await post({ action: 'request', revision: task.revision, target, ttlMs: 60000 })).body;
    const run1 = state.runs[0];
    assert.equal(run1.status, 'waiting');
    assert.equal(run1.runnerId, null);
    assert.equal(run1.binding.developerId, dev.id);
    assert.equal(run1.binding.deliveryRevision, 1);
    assert.equal(run1.binding.criteriaRevision, 1);
    assert.equal(run1.binding.target.sha256, buildSha256);
    task = state.task;
    assert.equal((await post({ action: 'request', revision: task.revision, target })).status, 409, '进行中的请求不能重复发起');

    // 领取：开发者不能自验，能力不足不能替代桌面验收
    assert.equal((await post({ action: 'claim', runId: run1.id, runRevision: 1, capabilities: ['desktop'] }, dev.sessionToken)).status, 403);
    assert.equal((await post({ action: 'claim', runId: run1.id, runRevision: 1, capabilities: ['command', 'browser'] }, verifier.sessionToken)).status, 409);
    assert.equal((await post({ action: 'claim', runId: run1.id, runRevision: 2, capabilities: ['desktop'] }, verifier.sessionToken)).status, 409);
    assert.equal((await post({ action: 'claim', runId: 'missing', runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).status, 404);
    state = (await post({ action: 'claim', runId: run1.id, runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).body;
    assert.equal(state.runs[0].status, 'running');
    assert.equal(state.runs[0].runnerId, verifier.id);
    assert.equal(state.runs[0].revision, 2);
    const run1Live = state.runs[0];

    // 证据必须绑定本次运行：非验收者、错时间、错标准都拒绝
    task = await fresh();
    assert.equal((await upload(verifier.sessionToken, { name: '普通.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision, caption: '' })).status, 403, '非本任务开发者且未绑定验收请求');
    task = await fresh();
    assert.equal((await upload(verifier.sessionToken, {
      name: '早于领取.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run1Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: run1Live.claimedAt - 1000,
    })).status, 400);
    task = await fresh();
    assert.equal((await upload(verifier.sessionToken, {
      name: '未知标准.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run1Live.id, evidenceKind: 'screenshot', criterionId: 'nope', capturedAt: Date.now(),
    })).status, 400);
    task = await fresh();
    assert.equal((await upload(dev.sessionToken, {
      name: '开发者伪证.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run1Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: Date.now(),
    })).status, 403, '开发会话不能为验收请求上传证据');

    // 第一轮：检查未通过 → 需要人工确认，不自动归档
    task = await fresh();
    const shot1 = (await upload(verifier.sessionToken, {
      name: 'c1-失败.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run1Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: Date.now(),
    })).body;
    assert.equal(shot1.status, 'review');
    const reportFile1 = reportOf(run1Live, shot1, [check(run1Live, 'failed', null)]);
    task = await fresh();
    const report1 = (await upload(verifier.sessionToken, {
      name: '验收报告.json', base64: Buffer.from(JSON.stringify(reportFile1), 'utf8').toString('base64'), purpose: 'result',
      revision: task.revision, acceptanceRunId: run1Live.id, evidenceKind: 'report', capturedAt: Date.now(),
    })).body;
    const reportAttachment1 = report1.attachments.at(-1).id;
    assert.equal((await post({ action: 'complete', runId: run1Live.id, runRevision: 2, report: { ...reportFile1, checks: [check(run1Live, 'passed', null)], reportAttachmentId: reportAttachment1 } }, verifier.sessionToken)).status, 409, '提交内容必须与报告附件一致');
    state = (await post({ action: 'complete', runId: run1Live.id, runRevision: 2, report: { ...reportFile1, reportAttachmentId: reportAttachment1 } }, verifier.sessionToken)).body;
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.runs[0].outcome.decision, 'needs_human_review');
    assert.ok(state.runs[0].outcome.reasons.some((r) => r.includes('failed')));
    assert.equal(state.task.status, 'review', '未通过不得自动归档');
    task = state.task;

    // 已结束的请求不能再上传证据
    assert.equal((await upload(verifier.sessionToken, {
      name: '迟到.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run1Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: Date.now(),
    })).status, 409);

    // 第二轮：全部通过且证据有效 → 自动归档并标记来源
    state = (await post({ action: 'request', revision: task.revision, target, ttlMs: 60000 })).body;
    const run2 = state.runs[0];
    state = (await post({ action: 'claim', runId: run2.id, runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).body;
    const run2Live = state.runs[0];
    task = await fresh();
    const shot2 = (await upload(verifier.sessionToken, {
      name: 'c1-通过.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run2Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: Date.now(),
    })).body;
    const shot2Id = shot2.attachments.at(-1).id;
    const reportFile2 = reportOf(run2Live, shot2, [check(run2Live, 'passed', shot2Id)]);
    task = await fresh();
    const report2 = (await upload(verifier.sessionToken, {
      name: '验收报告.json', base64: Buffer.from(JSON.stringify(reportFile2), 'utf8').toString('base64'), purpose: 'result',
      revision: task.revision, acceptanceRunId: run2Live.id, evidenceKind: 'report', capturedAt: Date.now(),
    })).body;
    const reportAttachment2 = report2.attachments.at(-1).id;
    // 缺截图证据时不得自动通过
    const missing = await post({ action: 'complete', runId: run2Live.id, runRevision: 2, report: { ...reportFile2, checks: [check(run2Live, 'passed', null)], reportAttachmentId: reportAttachment2 } }, verifier.sessionToken);
    assert.equal(missing.status, 409, '报告与附件不一致应被拒绝');
    state = (await post({ action: 'complete', runId: run2Live.id, runRevision: 2, report: { ...reportFile2, reportAttachmentId: reportAttachment2 } }, verifier.sessionToken)).body;
    assert.equal(state.runs[0].outcome.decision, 'eligible_for_auto_archive');
    assert.equal(state.task.status, 'archived');
    assert.equal(state.task.acceptance_archive_run, run2Live.id);
    assert.ok(state.task.progress.includes('自动验收'));
    const archivedRevision = state.task.revision;
    // 完全相同的成功回调幂等
    const replay = await post({ action: 'complete', runId: run2Live.id, runRevision: 2, report: { ...reportFile2, reportAttachmentId: reportAttachment2 } }, verifier.sessionToken);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replay, true);
    assert.equal(replay.body.task.status, 'archived');
    assert.equal(replay.body.task.revision, archivedRevision, '幂等重放不得再提升版本');
    // 归档后仅用户可复核返工
    assert.equal((await post({ action: 'reopen', reason: '效果不对' }, verifier.sessionToken)).status, 403);
    assert.equal((await post({ action: 'reopen', reason: '   ' })).status, 400);
    state = (await post({ action: 'reopen', reason: '自动通过后复核发现效果不符，退回待检查' })).body;
    assert.equal(state.task.status, 'review');
    assert.equal(state.task.acceptance_archive_run, null);
    assert.ok(state.task.feedback.includes('退回待检查'));
    task = state.task;

    // 需求变化后交付与标准同时失效：必须退回、重新确认并再次提交
    task = (await call('/tasks/' + id, admin, 'PATCH', { action: 'edit', revision: task.revision, description: '补充新要求' })).body;
    assert.equal(task.spec_revision, created.spec_revision + 1);
    assert.equal((await post({ action: 'request', revision: task.revision, target })).status, 409, '标准已过期不得发起验收');
    const reconfigured = await post({ action: 'configure', revision: task.revision, configRevision: 1, mode: 'manual', criteria: [criterion('c1')] });
    assert.equal(reconfigured.status, 200, JSON.stringify(reconfigured.body));
    task = reconfigured.body.task;
    assert.equal((await post({ action: 'request', revision: task.revision, target })).status, 409, '交付未确认新需求时不得验收');
    // 已归档请求不能用于新交付
    assert.equal((await post({ action: 'complete', runId: run2.id, runRevision: 2, report: { ...reportFile2, reportAttachmentId: reportAttachment2 } }, verifier.sessionToken)).status, 409);

    task = (await call('/tasks/' + id, admin, 'PATCH', { action: 'request_changes', revision: task.revision, feedback: '按新要求重做' })).body;
    assert.equal(task.status, 'queued');
    assert.equal(task.owner, null);
    task = (await call('/tasks/' + id, dev.sessionToken, 'PATCH', { action: 'claim', revision: task.revision })).body;
    task = (await call('/tasks/' + id, dev.sessionToken, 'PATCH', { action: 'submit', revision: task.revision, result: '已按新要求重做' })).body;
    assert.equal(task.status, 'review');
    assert.equal(task.delivery_revision, 2, '重新提交应产生新的交付版本');
    const approvedAgain = await post({ action: 'configure', revision: task.revision, configRevision: 2, mode: 'manual', criteria: [criterion('c1')] });
    assert.equal(approvedAgain.status, 200, JSON.stringify(approvedAgain.body));
    assert.equal(approvedAgain.body.config.revision, 3);
    task = approvedAgain.body.task;

    // 人工模式：辅助通过只是建议，最终仍由用户归档；取消权仅用户
    state = (await post({ action: 'request', revision: task.revision, target, ttlMs: 60000 })).body;
    const run3 = state.runs[0];
    assert.equal(run3.binding.deliveryRevision, 2);
    assert.equal((await post({ action: 'cancel', runId: run3.id, runRevision: 1 }, verifier.sessionToken)).status, 403, '仅用户可取消验收请求');
    state = (await post({ action: 'claim', runId: run3.id, runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).body;
    const run3Live = state.runs[0];
    state = (await post({ action: 'cancel', runId: run3Live.id, runRevision: 2 })).body;
    assert.equal(state.runs[0].status, 'cancelled');
    assert.equal((await post({ action: 'claim', runId: run3Live.id, runRevision: 3, capabilities: ['desktop'] }, verifier.sessionToken)).status, 409, '已取消请求不能领取');
    assert.equal((await post({ action: 'cancel', runId: run3Live.id, runRevision: 3 })).status, 409, '已结束请求不能重复取消');
    task = state.task;

    state = (await post({ action: 'request', revision: task.revision, target, ttlMs: 60000 })).body;
    const run4 = state.runs[0];
    state = (await post({ action: 'claim', runId: run4.id, runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).body;
    const run4Live = state.runs[0];
    task = await fresh();
    const shot4 = (await upload(verifier.sessionToken, {
      name: 'c1-辅助.png', base64: png.toString('base64'), purpose: 'result', revision: task.revision,
      acceptanceRunId: run4Live.id, evidenceKind: 'screenshot', criterionId: 'c1', capturedAt: Date.now(),
    })).body;
    const reportFile4 = reportOf(run4Live, shot4, [check(run4Live, 'passed', shot4.attachments.at(-1).id)]);
    task = await fresh();
    const report4 = (await upload(verifier.sessionToken, {
      name: '验收报告.json', base64: Buffer.from(JSON.stringify(reportFile4), 'utf8').toString('base64'), purpose: 'result',
      revision: task.revision, acceptanceRunId: run4Live.id, evidenceKind: 'report', capturedAt: Date.now(),
    })).body;
    state = (await post({ action: 'complete', runId: run4Live.id, runRevision: 2, report: { ...reportFile4, reportAttachmentId: report4.attachments.at(-1).id } }, verifier.sessionToken)).body;
    assert.equal(state.runs[0].outcome.decision, 'advisory_pass');
    assert.equal(state.task.status, 'review', '人工模式不得自动归档');
    assert.equal(state.task.acceptance_archive_run, null);
    task = state.task;

    // 超时请求必须由用户重新发起
    state = (await post({ action: 'request', revision: task.revision, target, ttlMs: 1000 })).body;
    const run5 = state.runs[0];
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await post({ action: 'claim', runId: run5.id, runRevision: 1, capabilities: ['desktop'] }, verifier.sessionToken)).status, 409, '超时请求不能领取');

    // 开发者自己的结果附件仍然可用，且不进入验收证据索引
    task = await fresh();
    const devFile = (await upload(dev.sessionToken, { name: '开发说明.txt', base64: Buffer.from('说明', 'utf8').toString('base64'), purpose: 'result', revision: task.revision, caption: '' })).body;
    assert.equal(devFile.attachments.at(-1).created_by, dev.id);
    assert.equal(app.store.db.prepare('SELECT count(*) n FROM acceptance_evidence WHERE attachment_id=?').get(devFile.attachments.at(-1).id).n, 0);
    assert.ok(app.store.db.prepare('SELECT count(*) n FROM acceptance_runs').get().n >= 5);
  } finally {
    await app.close();
  }

  // 迁移：旧库（无验收列/表）重新打开时补齐结构，并在有任务时先做快照备份
  const legacy = new Store(dir, '验收项目');
  legacy.db.exec(`ALTER TABLE tasks DROP COLUMN delivery_revision;
    ALTER TABLE tasks DROP COLUMN acceptance_archive_run;
    DROP TABLE acceptance_evidence; DROP TABLE acceptance_runs; DROP TABLE task_acceptance;`);
  legacy.close();
  const reopened = new Store(dir, '验收项目');
  try {
    const columns = reopened.db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(columns.includes('delivery_revision') && columns.includes('acceptance_archive_run'));
    const tables = reopened.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    assert.ok(['task_acceptance', 'acceptance_runs', 'acceptance_evidence'].every((t) => tables.includes(t)));
    const row = reopened.db.prepare('SELECT status,result,delivery_revision FROM tasks').get();
    assert.equal(row.status, 'review');
    assert.equal(row.delivery_revision, 1, '已提交交付迁移后保留交付版本');
    assert.ok(fs.readdirSync(dir).some((f) => /^before-acceptance-.*\.sqlite$/.test(f)), '迁移前应保留数据快照');
    assert.equal(reopened.snapshot().capabilities.acceptance, true);
    assert.ok(reopened.db.prepare('SELECT count(*) n FROM attachments').get().n >= 6, '迁移不得丢失附件');
  } finally {
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
