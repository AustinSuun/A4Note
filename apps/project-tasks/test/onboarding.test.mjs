import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { dataDirName } from '../lib/data-dir.mjs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { registerAgentGuide } from '../lib/project-onboarding.mjs';
import { checkService } from '../lib/agent-client.mjs';
const runtimeDir = fileURLToPath(new URL('../', import.meta.url));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4-onboarding-'));
const cleanup = (dir) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 100 });
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = (server) => new Promise((r) => server.close(r));

test('append preserves original BOM/CRLF rules; repeat is idempotent; edited blocks and locks are not overwritten', async () => {
  const root = temp();
  try {
    const file = path.join(root, 'AGENTS.md');
    const original = Buffer.from('\ufeff# 原有规则\r\n不要覆盖别人代码\r\n');
    fs.writeFileSync(file, original);
    const options = { projectRoot: root, projectId: 'project-public-id', runtimeDir };
    assert.equal(registerAgentGuide(options).status, 'ready');
    const first = fs.readFileSync(file);
    assert.ok(first.subarray(0, original.length).equals(original));
    assert.equal(registerAgentGuide(options).changed, false);
    assert.ok(fs.readFileSync(file).equals(first));
    assert.match(first.toString(), /connection_status/);
    assert.match(first.toString(), /doctor/);
    assert.ok(!first.toString().includes('operatorToken'));
    fs.appendFileSync(file, '\r\n用户追加的规则\r\n');
    const edited = fs.readFileSync(file);
    assert.equal(registerAgentGuide({ ...options, projectId: 'different-project' }).status, 'warning');
    assert.ok(fs.readFileSync(file).equals(edited));
    fs.writeFileSync(path.join(root, '.a4note-agent-guide.lock'), 'foreign lock');
    assert.equal(registerAgentGuide(options).status, 'warning');
    assert.equal(fs.readFileSync(path.join(root, '.a4note-agent-guide.lock'), 'utf8'), 'foreign lock');
  } finally { await cleanup(root); }
});

test('unsafe targets fail visibly without overwriting files', async () => {
  const root = temp();
  const options = { projectRoot: root, projectId: 'public', runtimeDir };
  try {
    const file = path.join(root, 'AGENTS.md');
    fs.mkdirSync(file);
    assert.equal(registerAgentGuide(options).status, 'warning');
    fs.rmdirSync(file);
    fs.writeFileSync(file, Buffer.from([255, 254, 65, 0]));
    const invalid = fs.readFileSync(file);
    assert.equal(registerAgentGuide(options).status, 'warning');
    assert.ok(fs.readFileSync(file).equals(invalid));
    fs.unlinkSync(file);
    const target = path.join(root, 'untouched.md');
    fs.writeFileSync(target, 'original');
    fs.linkSync(target, file);
    assert.equal(registerAgentGuide(options).status, 'warning');
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  } finally { await cleanup(root); }
});

test('doctor rejects wrong project and unavailable service without sending credentials', async () => {
  let authorization = false;
  const server = http.createServer((req, res) => {
    authorization ||= !!req.headers.authorization;
    res.end(JSON.stringify({ service: 'a4note-project-tasks', projectId: 'other' }));
  });
  const port = await listen(server);
  const config = { url: 'http://127.0.0.1:' + port, projectId: 'expected', enrollmentToken: 'never-send-this' };
  try {
    await assert.rejects(checkService(config), /身份不匹配/);
    assert.equal(authorization, false);
  } finally { await close(server); }
  await assert.rejects(checkService(config), /不可达/);
  await assert.rejects(checkService({ url: config.url }), /没有已确认/);
});

test('fresh project: explicit bootstrap creates instructions; real CLI and MCP discover the same service', { timeout: 30000 }, async () => {
  const home = temp(), root = path.join(home, '项目 with spaces');
  fs.mkdirSync(root);
  const dataDir = path.join(home, '.a4note-project-tasks', dataDirName(root));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const name of Object.keys(env)) if (name.startsWith('TASKS_')) delete env[name];
  const socket = http.createServer(), port = await listen(socket);
  await close(socket);
  const run = (file, args, options = {}) => promisify(execFile)(process.execPath, [file, ...args], { env, cwd: root, windowsHide: true, timeout: 20000, ...options });
  let mcp;
  try {
    const plain = JSON.parse((await run(path.join(runtimeDir, 'bootstrap.mjs'), [root, String(port)])).stdout);
    assert.equal(plain.reused, false);
    assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')), 'no implicit project writes without registration flag');
    const launch = JSON.parse((await run(path.join(runtimeDir, 'bootstrap.mjs'), [root, String(port), '--register-project'])).stdout);
    assert.equal(launch.onboarding.status, 'ready');
    const content = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.ok(!content.includes(launch.operatorToken));
    const config = JSON.parse(content.match(/```json\r?\n([\s\S]+?)\r?\n```/)[1]);
    const clientEnv = { ...env, ...config.env };
    const cli = path.join(path.dirname(config.args[0]), 'cli.mjs');
    const doctor = JSON.parse((await run(cli, ['doctor'], { env: clientEnv })).stdout);
    assert.equal(doctor.projectId, launch.projectId);
    const session = path.join(home, 'private-session.json');
    const joined = JSON.parse((await run(cli, ['join', '--alias', '新对话', '--session', session], { env: clientEnv })).stdout);
    assert.equal(joined.role, 'worker');
    assert.ok(!joined.sessionToken);
    await assert.rejects(run(cli, ['join', '--alias', '错误项目', '--session', path.join(home, 'wrong.json')], { env: { ...clientEnv, TASKS_EXPECTED_PROJECT_ID: 'wrong' } }), /身份不匹配/);
    assert.ok(!fs.existsSync(path.join(home, 'wrong.json')));
    const tasks = JSON.parse((await run(cli, ['list', '--session', session], { env: clientEnv })).stdout);
    assert.equal(tasks.project.id, launch.projectId);
    const again = JSON.parse((await run(path.join(runtimeDir, 'bootstrap.mjs'), [root, String(port), '--register-project'])).stdout);
    assert.equal(again.reused, true);
    assert.equal(again.onboarding.changed, false);
    mcp = spawn(process.execPath, config.args, { env: clientEnv, cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    mcp.stdout.on('data', (b) => output += b);
    mcp.stderr.on('data', (b) => errors += b);
    const exited = new Promise((resolve, reject) => { mcp.on('error', reject); mcp.on('close', resolve); });
    mcp.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connection_status', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'join', arguments: { alias: 'MCP新对话' } } },
    ].map(JSON.stringify).join('\n') + '\n');
    assert.equal(await exited, 0, errors);
    const replies = output.trim().split('\n').map(JSON.parse);
    assert.equal(JSON.parse(replies[0].result.content[0].text).projectId, launch.projectId);
    assert.equal(JSON.parse(replies[1].result.content[0].text).role, 'worker');
    assert.ok(!output.includes('sessionToken'));
  } finally {
    if (mcp && mcp.exitCode === null) mcp.kill();
    const file = path.join(dataDir, 'connection.json');
    if (fs.existsSync(file)) {
      const { pid } = JSON.parse(fs.readFileSync(file));
      try { process.kill(pid); } catch {}
    }
    await cleanup(home);
  }
});
