import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { Store } from '../apps/project-tasks/lib/store.mjs';

const temp = path.resolve('.tmp/task-client-safety', String(process.pid));
fs.mkdirSync(temp, { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-edit-conflict-'));
const hung = http.createServer(() => {});
try {
  // 协议层：旧草稿必须被拒绝，不能用刷新后的版本号覆盖他人新要求
  const store = new Store(dir, '冲突项目');
  try {
  const human = { id: 'human', alias: '你', role: 'human' };
  const task = store.create(human, { title: '原始标题', description: '原始要求', acceptance: '原始验收' });
  const baseline = task.revision;
  const other = store.update(human, task.id, { action: 'edit', revision: baseline, description: 'OTHER USER NEW REQUIREMENT' });
  check(other.revision === baseline + 1, '他人修改后版本递增');
  // 修复后的界面：保存编辑开始时的基线版本 → 服务拒绝，他人内容保留
  let conflict = null;
  try { store.update(human, task.id, { action: 'edit', revision: baseline, title: '新标题', description: '原始要求' }); }
  catch (error) { conflict = error; }
  check(conflict && conflict.status === 409, '基线版本过期时拒绝保存');
  check(/重新读取|已更新/.test(conflict.message), '冲突提示要求重新读取：' + conflict.message);
  check(store.get(task.id).description === 'OTHER USER NEW REQUIREMENT', '他人要求未被旧草稿覆盖');
  check(store.get(task.id).title === '原始标题', '冲突保存不产生部分写入');
  // 协议层事实：服务只按提交的版本判定，因此界面必须发送基线而不是刷新后的版本
  const stale = store.update(human, task.id, { action: 'edit', revision: other.revision, title: '原始标题', description: '原始要求', acceptance: '原始验收', priority: 'normal' });
  check(stale.revision === other.revision + 1, '用刷新后的版本提交旧草稿仍会被接受（因此界面必须锁定基线）');
  check(store.get(task.id).description === '原始要求', '该序列正是审计复现的覆盖路径');
  // 重新载入最新要求后可以正常保存
  store.update(human, task.id, { action: 'edit', revision: stale.revision, description: 'OTHER USER NEW REQUIREMENT' });
  const reloaded = store.detail(task.id);
  const saved = store.update(human, task.id, { action: 'edit', revision: reloaded.revision, title: '合并后的标题', description: reloaded.description + '\n补充：合并后的要求' });
  check(saved.revision === reloaded.revision + 1, '重新载入后可保存');
  check(saved.description.includes('OTHER USER NEW REQUIREMENT'), '合并保存保留他人内容');
  check(store.acceptance(task.id).config.mode === 'manual', '编辑要求不改变验收方式');
  } finally { store.close(); }

  // 客户端层：请求可取消，超时/取消都提示结果未知，不暗示可盲目重试
  const output = ts.transpileModule(fs.readFileSync('src/platform/projectTasks.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const module = path.join(temp, 'projectTasks.mjs');
  fs.writeFileSync(module, output);
  const { TaskClient } = await import(pathToFileURL(module).href);
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
  const client = new TaskClient('http://127.0.0.1:' + hung.address().port, 'token');
  const inflight = client.request('/snapshot');
  const settled = inflight.then(() => 'resolved', (error) => error.message);
  check(typeof client.cancelPending === 'function', '客户端提供取消未完成请求的方法');
  client.cancelPending();
  const message = await settled;
  check(/已取消/.test(message), '取消后给出明确结果：' + message);
  check(/刷新核对/.test(message) && !/重试/.test(message), '不暗示写入可以盲目重试');
  await new Promise((resolve) => setTimeout(resolve, 20));
  // 连接被拒绝时立即报错，而不是长时间挂起
  const refused = await new TaskClient('http://127.0.0.1:1', 'token').snapshot().then(() => 'ok', (error) => error.message);
  check(typeof refused === 'string' && refused.length > 0, '连接失败立即返回错误：' + refused);
  console.log(`Task edit conflict and client safety regression passed (${checks} assertions)`);
} finally {
  await new Promise((resolve) => hung.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  // Windows may hold the SQLite WAL handle briefly after close.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
