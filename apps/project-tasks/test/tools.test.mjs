import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTaskServer } from '../server.mjs';
import { testEnv } from './test-env.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
test('real CLI and MCP stdio clients share tasks but not agent identities', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-tools-')),
    app = createTaskServer({ dataDir: dir, project: '工具测试' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const env = testEnv({
    TASKS_DATA_DIR: dir,
    TASKS_URL: 'http://127.0.0.1:' + app.server.address().port,
  });
  const cli = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [path.join(here, '../cli.mjs'), ...args],
          { env },
        )
      ).stdout,
    );
  let child;
  try {
    const session = path.join(dir, 'dispatcher.json');
    const dispatcher = await cli(
      'join',
      '--alias',
      '派发',
      '--role',
      'dispatcher',
      '--authorized-dispatcher',
      '--session',
      session,
    );
    assert.equal(dispatcher.role, 'dispatcher');
    assert.ok(!dispatcher.sessionToken);
    const taskFile = path.join(dir, 'task.json');
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ title: '工具闭环', description: 'CLI创建，MCP领取' }),
    );
    let t = await cli('create', '--json', taskFile, '--session', session);
    assert.equal(t.status, 'queued');

    child = spawn(process.execPath, [path.join(here, '../mcp.mjs')], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const waiting = new Map();
    let id = 0;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const r = JSON.parse(line);
      waiting.get(r.id)?.(r);
      waiting.delete(r.id);
    });
    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timeout = setTimeout(
          () => reject(Error('MCP response timeout')),
          5000,
        );
        waiting.set(n, (r) => {
          clearTimeout(timeout);
          resolve(r);
        });
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n',
        );
      });
    assert.equal(
      (
        await rpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        })
      ).result.serverInfo.name,
      'a4note-project-tasks',
    );
    const tools = (await rpc('tools/list')).result.tools;
    assert.ok(tools.some((t) => t.name === 'read_attachment'));
    assert.ok(!tools.some((t) => t.name === 'archive'));
    const invoke = async (name, b = {}) =>
      (await rpc('tools/call', { name, arguments: b })).result;
    const joined = JSON.parse(
      (await invoke('join', { alias: '青松' })).content[0].text,
    );
    assert.ok(joined.id);
    assert.ok(!joined.sessionToken);
    assert.equal((await invoke('join', { alias: '不能换身份' })).isError, true);
    t = JSON.parse(
      (
        await invoke('update_task', {
          id: t.id,
          revision: t.revision,
          action: 'claim',
        })
      ).content[0].text,
    );
    assert.equal(t.owner, joined.id);
    assert.equal(t.status, 'in_progress');
    const f = await invoke('attach_file', {
      id: t.id,
      revision: t.revision,
      name: 'proof.png',
      purpose: 'result',
      base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString(
        'base64',
      ),
    });
    t = JSON.parse(f.content[0].text);
    assert.equal(t.attachments.length, 1);
    const image = await invoke('read_attachment', { id: t.attachments[0].id });
    assert.equal(image.content[0].type, 'image');
    assert.equal(image.content[0].mimeType, 'image/png');
    const output = path.join(dir, 'downloaded.png');
    await cli(
      'download',
      t.attachments[0].id,
      '--output',
      output,
      '--session',
      session,
    );
    assert.equal(fs.readFileSync(output).length, 9);
    t = JSON.parse(
      (
        await invoke('update_task', {
          id: t.id,
          revision: t.revision,
          action: 'submit',
          result: '接口闭环通过',
        })
      ).content[0].text,
    );
    assert.equal(t.status, 'review');
    assert.equal(
      (
        await invoke('update_task', {
          id: t.id,
          revision: t.revision,
          action: 'archive',
        })
      ).isError,
      true,
    );
    assert.equal(
      (await cli('get', t.id, '--session', session)).status,
      'review',
    );
  } finally {
    if (child) {
      const done = new Promise((r) => child.once('exit', r));
      child.stdin.end();
      await done;
    }
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
