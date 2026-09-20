import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskServer } from '../server.mjs';

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('direct queue flow: publish, atomic claim, submit, user review and requeue', async () => {
  const dir = temp('direct-queue-');
  const app = createTaskServer({ dataDir: dir, project: '直接队列测试' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const admin = app.store.access.operatorToken;
  const enroll = app.store.access.enrollmentToken;
  const call = async (endpoint, token = admin, method = 'GET', body) => {
    const response = await fetch(url + '/api' + endpoint, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const update = (task, token, body) => call('/tasks/' + task.id, token, 'PATCH', { revision: task.revision, ...body });
  try {
    const snapshot = await call('/snapshot');
    assert.equal(snapshot.body.capabilities.queue, true);
    assert.equal(snapshot.body.capabilities.planQueue, undefined);
    for (const action of ['submit_plan', 'approve_plan', 'reject_plan']) {
      assert.equal((await call('/tasks/not-a-task', admin, 'PATCH', { action, revision: 1 })).status, 404);
    }
    const workerA = (await call('/join', enroll, 'POST', { alias: '执行甲' })).body;
    const workerB = (await call('/join', enroll, 'POST', { alias: '执行乙' })).body;
    const dispatcher = (await call('/join', admin, 'POST', { alias: '派发', role: 'dispatcher' })).body;
    let task = (await call('/tasks', dispatcher.sessionToken, 'POST', {
      title: '直接执行', description: '只执行授权范围', acceptance: '检查实际效果', priority: 'high',
    })).body;
    assert.equal(task.status, 'queued');
    assert.match(task.progress, /等待领取/);
    for (const action of ['submit_plan', 'approve_plan', 'reject_plan', 'legacy_submit_plan', 'legacy_approve_plan', 'legacy_reject_plan', 'promote']) {
      const rejected = await update(task, admin, { action });
      assert.equal(rejected.status, 400);
      assert.match(rejected.body.error, /未知操作/);
    }
    const claims = await Promise.all([
      update(task, workerA.sessionToken, { action: 'claim' }),
      update(task, workerB.sessionToken, { action: 'claim' }),
    ]);
    assert.deepEqual(claims.map(result => result.status).sort(), [200, 409]);
    task = claims.find(result => result.status === 200).body;
    const worker = task.owner === workerA.id ? workerA : workerB;
    const other = worker.id === workerA.id ? workerB : workerA;
    assert.equal(task.status, 'in_progress');
    task = (await update(task, worker.sessionToken, { action: 'progress', progress: '执行中并保持 heartbeat' })).body;
    assert.equal((await update(task, other.sessionToken, { action: 'progress', progress: '越权' })).status, 403);
    task = (await update(task, worker.sessionToken, { action: 'submit', result: '完成结果与验证说明' })).body;
    assert.equal(task.status, 'review');
    assert.equal((await update(task, worker.sessionToken, { action: 'archive' })).status, 403);
    task = (await update(task, admin, { action: 'request_changes', feedback: '请再检查窄屏效果' })).body;
    assert.equal(task.status, 'queued');
    assert.equal(task.owner, null);
    assert.equal(task.result, '完成结果与验证说明');
    assert.equal(task.feedback, '请再检查窄屏效果');
    task = (await update(task, workerB.sessionToken, { action: 'claim' })).body;
    task = (await update(task, workerB.sessionToken, { action: 'release', writesStopped: true, reason: '停止写入后交还' })).body;
    assert.equal(task.status, 'queued');
    task = (await update(task, workerA.sessionToken, { action: 'claim' })).body;
    task = (await update(task, workerA.sessionToken, { action: 'submit', result: '返工完成并验证' })).body;
    task = (await update(task, admin, { action: 'archive' })).body;
    assert.equal(task.status, 'archived');
    assert.equal((await update(task, admin, { action: 'edit', title: '不应修改' })).status, 409);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
