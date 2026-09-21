import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTaskServer } from '../server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'cli.mjs');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const target = { kind: 'desktop', source: 'D:/apps/a4note.exe', version: '0.1.16-cli', sha256: 'b'.repeat(64) };

test('acceptance CLI: human configuration, independent claim, fixtures and evidence upload', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-cli-data-'));
  // Runners expose os.tmpdir() as an 8.3 short path; the fixture guard compares
  // realpath against resolve, so normalise here as the other suites already do.
  const projectRoot = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-cli-root-')),
  );
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-cli-session-'));
  const app = createTaskServer({ dataDir, project: 'CLI验收项目' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const admin = app.store.access.operatorToken, enroll = app.store.access.enrollmentToken;
  const base = {
    ...process.env,
    TASKS_SESSION_TOKEN: undefined,
    TASKS_SESSION_FILE: undefined,
    TASKS_PROJECT_ROOT: projectRoot,
    TASKS_EXPECTED_PROJECT_ID: app.store.access.projectId,
    TASKS_URL: url,
    TASKS_DATA_DIR: dataDir,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  // The service runs in this process, so the CLI must be spawned asynchronously.
  const run = (args, env = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: projectRoot, env: { ...base, ...env } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('CLI 超时：' + args.join(' '))); }, 60000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const call = async (endpoint, token, method = 'GET', body) => {
    const r = await fetch(url + '/api' + endpoint, {
      method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  try {
    const health = await (await fetch(url + '/api/health')).json();
    assert.equal(health.capabilities.acceptance, true);
    const dev = await call('/join', enroll, 'POST', { alias: '青开' });
    const verifier = await call('/join', enroll, 'POST', { alias: '青验' });
    const writeSession = (agent) => {
      const file = path.join(sessionDir, agent.id + '.json');
      fs.writeFileSync(file, JSON.stringify({ url, projectId: app.store.access.projectId, ...agent }), { mode: 0o600 });
      return file;
    };
    const devSession = writeSession(dev), verifierSession = writeSession(verifier);
    const human = { TASKS_SESSION_TOKEN: admin };

    const task = await call('/tasks', admin, 'POST', { title: 'CLI验收', description: '说明', acceptance: '要求' });
    let current = task;
    current = await call('/tasks/' + task.id, dev.sessionToken, 'PATCH', { action: 'claim', revision: current.revision });
    current = await call('/tasks/' + task.id, dev.sessionToken, 'PATCH', { action: 'submit', revision: current.revision, result: '已完成' });
    assert.equal(current.status, 'review');
    assert.equal(current.delivery_revision, 1);

    // 用法指引：缺少必需参数时明确说明，不静默失败
    const usage = await run([]);
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /acceptance/);
    assert.match(usage.stderr, /fixtures/);
    const missingRun = await run(['acceptance', task.id, '--action', 'claim', '--run-revision', '1'], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(missingRun.status, 1);
    assert.match(missingRun.stderr, /--run-id/);
    const missingCaps = await run(['acceptance', task.id, '--action', 'claim', '--run-id', 'x'], { TASKS_SESSION_FILE: verifierSession });
    assert.match(missingCaps.stderr, /capabilities/);
    const missingCaptured = await run(['upload', task.id, '--file', cli, '--revision', String(current.revision), '--acceptance-run', 'x'], { TASKS_SESSION_FILE: verifierSession });
    assert.match(missingCaptured.stderr, /captured-at/);

    const criteriaFile = path.join(sessionDir, 'criteria.json');
    fs.writeFileSync(criteriaFile, JSON.stringify({
      mode: 'automatic',
      criteria: [{ id: 'c1', label: '打开被测版本', expected: '界面正常', capability: 'desktop', objective: true, screenshotRequired: true }],
    }));
    // 开发者会话不能切换验收方式
    const devConfigure = await run(['acceptance', task.id, '--action', 'configure', '--revision', String(current.revision), '--config-revision', '0', '--json', criteriaFile], { TASKS_SESSION_FILE: devSession });
    assert.equal(devConfigure.status, 1);
    assert.match(devConfigure.stderr, /仅用户可批准或取消验收/);

    const configured = await run(['acceptance', task.id, '--action', 'configure', '--revision', String(current.revision), '--config-revision', '0', '--json', criteriaFile], human);
    assert.equal(configured.status, 0, configured.stderr);
    const configuredState = JSON.parse(configured.stdout);
    assert.equal(configuredState.config.mode, 'automatic');
    assert.equal(configuredState.config.revision, 1);
    current = configuredState.task;

    const requested = await run(['acceptance', task.id, '--action', 'request', '--revision', String(current.revision),
      '--json', path.join(sessionDir, 'target.json')], human);
    assert.equal(requested.status, 1, '缺少被测构建信息时必须失败');
    fs.writeFileSync(path.join(sessionDir, 'target.json'), JSON.stringify({ target, ttlMs: 600000 }));
    const requested2 = await run(['acceptance', task.id, '--action', 'request', '--revision', String(current.revision),
      '--json', path.join(sessionDir, 'target.json')], human);
    assert.equal(requested2.status, 0, requested2.stderr);
    const run1 = JSON.parse(requested2.stdout).runs[0];
    assert.equal(run1.status, 'waiting');
    current = JSON.parse(requested2.stdout).task;

    // 开发会话不能领取自己的交付
    const selfClaim = await run(['acceptance', task.id, '--action', 'claim', '--run-id', run1.id, '--run-revision', '1', '--capabilities', 'desktop'], { TASKS_SESSION_FILE: devSession });
    assert.equal(selfClaim.status, 1);
    assert.match(selfClaim.stderr, /不能验收自己的交付/);
    const claimed = await run(['acceptance', task.id, '--action', 'claim', '--run-id', run1.id, '--run-revision', '1', '--capabilities', 'desktop'], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(claimed.status, 0, claimed.stderr);
    const live = JSON.parse(claimed.stdout).runs[0];
    assert.equal(live.status, 'running');
    assert.equal(live.runnerId, verifier.id);
    current = JSON.parse(claimed.stdout).task;

    // 夹具：仅本次运行的验收会话可在授权项目内创建，且不覆盖旧运行
    const created = await run(['fixtures', task.id, '--run-id', live.id, '--needs-notes', '--manifest-out', path.join(sessionDir, 'manifest.json')], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(created.status, 0, created.stderr);
    const manifest = JSON.parse(created.stdout);
    assert.equal(manifest.created, true);
    assert.equal(manifest.taskId, task.id);
    assert.equal(manifest.inputs.length, 2);
    const fixtureRoot = path.join(projectRoot, '.a4-tests', 'acceptance', task.id, live.id);
    assert.ok(fs.existsSync(path.join(fixtureRoot, '测试笔记.md')));
    assert.ok(fs.existsSync(path.join(fixtureRoot, '样式样例.md')));
    assert.ok(fs.existsSync(path.join(fixtureRoot, '验收报告.md')));
    assert.ok(fs.statSync(path.join(fixtureRoot, 'screenshots')).isDirectory());
    assert.ok(fs.existsSync(path.join(sessionDir, 'manifest.json')));
    // 开发会话不能为同一请求创建夹具
    const devFixtures = await run(['fixtures', task.id, '--run-id', live.id, '--needs-notes'], { TASKS_SESSION_FILE: devSession });
    assert.equal(devFixtures.status, 1);
    assert.match(devFixtures.stderr, /只有领取本请求的验收会话/);
    // 旧运行不覆盖
    const again = await run(['fixtures', task.id, '--run-id', live.id, '--needs-notes'], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(again.status, 1);
    const verified = await run(['fixtures-verify', '--manifest', path.join(sessionDir, 'manifest.json')], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout).map((f) => f.unchanged), [true, true]);
    const outside = await run(['fixtures-verify', '--manifest', path.join(sessionDir, 'manifest.json'), '--project-root', path.dirname(projectRoot)], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(outside.status, 1, '授权项目之外不得读取夹具清单');

    // 证据上传：截图与报告都要绑定运行/交付/标准/构建
    const shotFile = path.join(sessionDir, 'shot.png');
    fs.writeFileSync(shotFile, png);
    const shot = await run(['upload', task.id, '--file', shotFile, '--revision', String(current.revision), '--purpose', 'result',
      '--acceptance-run', live.id, '--evidence-kind', 'screenshot', '--criterion-id', 'c1', '--captured-at', String(Date.now())], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(shot.status, 0, shot.stderr);
    const shotId = JSON.parse(shot.stdout).attachments.at(-1).id;
    current = JSON.parse(shot.stdout);
    const reportFile = path.join(sessionDir, 'report.json');
    const report = {
      runId: live.id, projectId: app.store.access.projectId, taskId: task.id,
      deliveryRevision: live.binding.deliveryRevision, criteriaRevision: live.binding.criteriaRevision,
      target, environment: '隔离数据目录与profile；1280x800；100%缩放；浅色主题。',
      checks: [{ id: 'c1', capability: 'desktop', expected: '界面正常', status: 'passed', actual: '已核对', steps: '打开被测版本', screenshotAttachmentId: shotId }],
    };
    fs.writeFileSync(reportFile, JSON.stringify(report));
    const uploaded = await run(['upload', task.id, '--file', reportFile, '--revision', String(current.revision), '--purpose', 'result',
      '--acceptance-run', live.id, '--evidence-kind', 'report', '--captured-at', String(Date.now())], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(uploaded.status, 0, uploaded.stderr);
    const reportAttachmentId = JSON.parse(uploaded.stdout).attachments.at(-1).id;
    const completeFile = path.join(sessionDir, 'complete.json');
    fs.writeFileSync(completeFile, JSON.stringify({ report: { ...report, reportAttachmentId } }));
    const completed = await run(['acceptance', task.id, '--action', 'complete', '--run-id', live.id, '--run-revision', '2', '--json', completeFile], { TASKS_SESSION_FILE: verifierSession });
    assert.equal(completed.status, 0, completed.stderr);
    const done = JSON.parse(completed.stdout);
    assert.equal(done.runs[0].outcome.decision, 'eligible_for_auto_archive');
    assert.equal(done.task.status, 'archived');
    assert.equal(done.task.acceptance_archive_run, live.id);

    // 用户复核返工
    const reopened = await run(['acceptance', task.id, '--action', 'reopen', '--text', '复核发现效果不符'], human);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.equal(JSON.parse(reopened.stdout).task.status, 'review');
    const emptyReopen = await run(['acceptance', task.id, '--action', 'reopen'], human);
    assert.equal(emptyReopen.status, 1);
    assert.match(emptyReopen.stderr, /复核返工原因/);
  } finally {
    await app.close();
    for (const dir of [dataDir, projectRoot, sessionDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
