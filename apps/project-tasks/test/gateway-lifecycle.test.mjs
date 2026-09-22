import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTaskGateway } from '../gateway.mjs';
import { inspectGateway, stopGateway, pidAlive } from '../gateway-lifecycle.mjs';
import { testEnv } from './test-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayScript = path.join(here, '..', 'gateway.mjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const reachable = async url => { try { await fetch(url + '/api/gateway-health', { signal: AbortSignal.timeout(500) }); return true; } catch { return false; } };

async function spawnGateway(temp) {
  const stateDir = path.join(temp, 'hub'), projectsHome = path.join(temp, 'private');
  fs.mkdirSync(stateDir, { recursive: true });
  const env = testEnv({ TASKS_GATEWAY_DIR: stateDir, TASKS_PROJECTS_HOME: projectsHome, TASKS_PORT: '0' });
  const child = spawn(process.execPath, [gatewayScript], { env, cwd: path.dirname(gatewayScript), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const connectionPath = path.join(stateDir, 'gateway-connection.json');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && (!fs.existsSync(connectionPath) || child.exitCode !== null)) await wait(50);
  assert.equal(child.exitCode, null, 'gateway child exited early: ' + log);
  assert.ok(fs.existsSync(connectionPath), 'connection file missing: ' + log);
  const connection = read(connectionPath), access = read(path.join(stateDir, 'gateway-access.json'));
  const exited = new Promise(r => child.once('exit', code => r(code)));
  return { child, stateDir, projectsHome, connection, access, exited, log: () => log };
}

test('real gateway process: inspect identifies pid/agents/streams, graceful stop closes listener, removes record and keeps data', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-'));
  const root = path.join(temp, 'project'); fs.mkdirSync(root);
  const gw = await spawnGateway(temp);
  const controllers = [];
  try {
    assert.equal(gw.connection.pid, gw.child.pid);
    const hub = { Authorization: 'Bearer ' + gw.access.token, 'Content-Type': 'application/json' };
    const registered = await (await fetch(gw.connection.url + '/api/gateway/register', { method: 'POST', headers: hub, body: JSON.stringify({ projectRoot: root }) })).json();
    assert.ok(registered.url && registered.operatorToken);
    const api = (route, method = 'GET', body, token = registered.operatorToken, extra = {}) =>
      fetch(registered.url + '/api' + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });
    const task = await (await api('/tasks', 'POST', { title: 'survives shutdown' })).json();
    const bytes = Buffer.from('attachment survives graceful stop');
    const attached = await (await api('/tasks/' + task.id + '/attachments', 'POST', { revision: task.revision, name: 'e.txt', base64: bytes.toString('base64'), purpose: 'reference' })).json();
    assert.equal(attached.attachments.length, 1);
    const worker = await (await api('/join', 'POST', { alias: 'worker-1' })).json();
    assert.ok(worker.sessionToken);
    // A re-join of the same alias is a second session; the summary must still name the agent once.
    assert.ok((await (await api('/join', 'POST', { alias: 'worker-1' })).json()).sessionToken);
    // One WebView-style stream (Origin) and one agent-style stream (no Origin).
    for (const extra of [{ Origin: 'http://tauri.localhost' }, {}]) {
      const controller = new AbortController(); controllers.push(controller);
      const stream = await fetch(registered.url + '/api/events', { headers: { Authorization: 'Bearer ' + registered.operatorToken, ...extra }, signal: controller.signal });
      assert.equal(stream.status, 200); void stream.body.getReader().read().catch(() => {});
    }
    await wait(200);
    const info = await inspectGateway({ stateDir: gw.stateDir });
    assert.equal(info.state, 'running');
    assert.equal(info.pid, gw.child.pid);
    assert.equal(info.version, 4);
    assert.deepEqual(info.streams, { app: 1, other: 1 });
    assert.deepEqual(info.activeAgents.map(a => a.alias), ['worker-1']);
    assert.equal(info.projects[0].activeAgents.length, 2, 'raw per-project list keeps both sessions');
    assert.equal(info.projects[0].id, registered.projectId);

    // Shutdown control is hub-only: project credentials, wrong tokens and browser origins are refused.
    assert.equal((await api('/gateway/shutdown', 'POST', { reason: 'x' })).status, 404);
    assert.equal((await fetch(gw.connection.url + '/api/gateway/shutdown', { method: 'POST', headers: { Authorization: 'Bearer ' + registered.operatorToken, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(gw.connection.url + '/api/gateway/shutdown', { method: 'POST', headers: { ...hub, Origin: 'http://tauri.localhost' }, body: '{}' })).status, 403);
    assert.equal((await fetch(gw.connection.url + '/api/gateway/status', { headers: { Authorization: 'Bearer ' + registered.operatorToken } })).status, 403);
    assert.equal(await reachable(gw.connection.url), true);

    const result = await stopGateway({ stateDir: gw.stateDir, reason: 'test-exit' });
    assert.equal(result.stopped, true, JSON.stringify(result));
    assert.equal(result.method, 'graceful');
    assert.equal(await gw.exited, 0);
    assert.equal(pidAlive(gw.child.pid), false);
    assert.equal(await reachable(gw.connection.url), false);
    assert.equal(fs.existsSync(path.join(gw.stateDir, 'gateway-connection.json')), false, 'stale connection record must be removed');
    assert.equal(fs.existsSync(path.join(gw.stateDir, 'gateway-access.json')), true, 'credentials are kept for restart');

    // Repeated stop is a no-op, and a fresh gateway serves the same identity, task and attachment bytes.
    assert.deepEqual((({ stopped, skipped, state }) => ({ stopped, skipped, state }))(await stopGateway({ stateDir: gw.stateDir })), { stopped: false, skipped: true, state: 'none' });
    const again = createTaskGateway({ stateDir: gw.stateDir, projectsHome: gw.projectsHome });
    try {
      await again.listen(0);
      const next = await again.register(root);
      assert.equal(next.projectId, registered.projectId);
      assert.equal(next.operatorToken, registered.operatorToken);
      const snapshot = await (await fetch(next.url + '/api/snapshot', { headers: { Authorization: 'Bearer ' + next.operatorToken } })).json();
      assert.deepEqual(snapshot.tasks.map(t => t.title), ['survives shutdown']);
      assert.deepEqual(Buffer.from(await (await fetch(next.url + '/api/attachments/' + attached.attachments[0].id, { headers: { Authorization: 'Bearer ' + next.operatorToken } })).arrayBuffer()), bytes);
    } finally { await again.close(); }
  } finally {
    for (const c of controllers) c.abort();
    if (gw.child.exitCode === null) gw.child.kill();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('pid mismatch between record and live listener is never signalled', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-pid-'));
  const gw = await spawnGateway(temp);
  const connectionPath = path.join(gw.stateDir, 'gateway-connection.json');
  try {
    fs.writeFileSync(connectionPath, JSON.stringify({ ...gw.connection, pid: gw.connection.pid + 100000 }));
    const info = await inspectGateway({ stateDir: gw.stateDir });
    assert.equal(info.state, 'pid-mismatch');
    const result = await stopGateway({ stateDir: gw.stateDir });
    assert.equal(result.stopped, false); assert.equal(result.skipped, true);
    assert.equal(gw.child.exitCode, null); assert.equal(await reachable(gw.connection.url), true);
    fs.writeFileSync(connectionPath, JSON.stringify(gw.connection));
    assert.equal((await stopGateway({ stateDir: gw.stateDir })).stopped, true);
    assert.equal(await gw.exited, 0);
  } finally {
    if (gw.child.exitCode === null) gw.child.kill();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('foreign listener on the recorded port is left untouched', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-foreign-'));
  const stateDir = path.join(temp, 'hub'); fs.mkdirSync(stateDir, { recursive: true });
  let requests = 0;
  const other = http.createServer((req, res) => { requests++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ service: 'something-else' })); });
  const port = await listen(other);
  try {
    fs.writeFileSync(path.join(stateDir, 'gateway-access.json'), JSON.stringify({ id: 'hub-id', token: 'x'.repeat(40) }));
    fs.writeFileSync(path.join(stateDir, 'gateway-connection.json'), JSON.stringify({ url: 'http://127.0.0.1:' + port, pid: process.pid, id: 'hub-id' }));
    assert.equal((await inspectGateway({ stateDir })).state, 'foreign');
    const result = await stopGateway({ stateDir });
    assert.equal(result.stopped, false); assert.equal(result.reason, 'port-owned-by-other-program');
    assert.equal(other.listening, true);
    assert.ok(requests >= 1);
    assert.equal(fs.existsSync(path.join(stateDir, 'gateway-connection.json')), true, 'foreign record is not rewritten');
  } finally { await new Promise(r => other.close(r)); await fs.promises.rm(temp, { recursive: true, force: true }); }
});

test('stale record: dead pid is cleaned up, a live unverified pid is not killed, empty state reports none', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-stale-'));
  const stateDir = path.join(temp, 'hub'); fs.mkdirSync(stateDir, { recursive: true });
  const closed = http.createServer(); const port = await listen(closed); await new Promise(r => closed.close(r));
  const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' }); await new Promise(r => dead.once('exit', r));
  try {
    assert.equal((await inspectGateway({ stateDir })).state, 'none');
    fs.writeFileSync(path.join(stateDir, 'gateway-access.json'), JSON.stringify({ id: 'hub-id', token: 'x'.repeat(40) }));
    const record = path.join(stateDir, 'gateway-connection.json');
    fs.writeFileSync(record, JSON.stringify({ url: 'http://127.0.0.1:' + port, pid: process.pid, id: 'hub-id' }));
    const live = await stopGateway({ stateDir });
    assert.equal(live.stopped, false); assert.equal(live.reason, 'process-alive-without-verified-service');
    assert.equal(fs.existsSync(record), true);
    fs.writeFileSync(record, JSON.stringify({ url: 'http://127.0.0.1:' + port, pid: dead.pid, id: 'hub-id' }));
    const cleaned = await stopGateway({ stateDir });
    assert.equal(cleaned.stopped, true); assert.equal(cleaned.method, 'stale-cleanup');
    assert.equal(fs.existsSync(record), false);
  } finally { await fs.promises.rm(temp, { recursive: true, force: true }); }
});

test('legacy gateway without shutdown capability: skip policy keeps it, terminate policy retires only the same access id', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-legacy-'));
  const stateDir = path.join(temp, 'hub'); fs.mkdirSync(stateDir, { recursive: true });
  const script = path.join(temp, 'legacy.mjs');
  fs.writeFileSync(script, `import http from 'node:http';const s=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({service:'a4note-task-gateway',version:3,id:'legacy-id'}));});s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)));setInterval(()=>{},1000);`);
  const legacy = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const port = await new Promise(r => legacy.stdout.once('data', d => r(Number(String(d)))));
  const exited = new Promise(r => legacy.once('exit', r));
  try {
    fs.writeFileSync(path.join(stateDir, 'gateway-access.json'), JSON.stringify({ id: 'legacy-id', token: 'x'.repeat(40) }));
    fs.writeFileSync(path.join(stateDir, 'gateway-connection.json'), JSON.stringify({ url: 'http://127.0.0.1:' + port, pid: legacy.pid, id: 'legacy-id' }));
    const info = await inspectGateway({ stateDir });
    assert.equal(info.state, 'legacy'); assert.equal(info.version, 3);
    const kept = await stopGateway({ stateDir, legacy: 'skip' });
    assert.equal(kept.stopped, false); assert.equal(legacy.exitCode, null);
    const retired = await stopGateway({ stateDir, legacy: 'terminate', timeoutMs: 3000 });
    assert.equal(retired.stopped, true, JSON.stringify(retired));
    await exited;
    assert.equal(pidAlive(legacy.pid), false);
    assert.equal(fs.existsSync(path.join(stateDir, 'gateway-connection.json')), false);
  } finally {
    if (legacy.exitCode === null) legacy.kill();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('in-process gateway advertises no shutdown capability and rejects remote stop', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-lifecycle-inproc-'));
  const gateway = createTaskGateway({ stateDir: path.join(temp, 'hub'), projectsHome: path.join(temp, 'private') });
  try {
    const base = await gateway.listen(0);
    const health = await (await fetch(base + '/api/gateway-health')).json();
    assert.equal(health.capabilities.shutdown, false); assert.equal(health.pid, process.pid);
    const denied = await fetch(base + '/api/gateway/shutdown', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.access.token, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 409);
  } finally { await gateway.close(); await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});
