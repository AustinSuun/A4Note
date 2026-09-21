import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ensureStarted } from '../bootstrap.mjs';
const listen = (s) =>
  new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const close = (s) => new Promise((r) => s.close(r));
test('one click: real detached service, concurrent requests, reuse, credentials and project identity', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-launch-')),
    projectRoot = path.join(temp, '项目 with spaces'),
    dataDir = path.join(temp, 'private');
  fs.mkdirSync(projectRoot);
  const socket = http.createServer();
  const port = await listen(socket);
  await close(socket);
  try {
    const results = await Promise.all([
      ensureStarted({ projectRoot, dataDir, port }),
      ensureStarted({ projectRoot, dataDir, port }),
    ]);
    assert.equal(results.filter((r) => !r.reused).length, 1);
    assert.equal(results[0].projectId, results[1].projectId);
    const connection = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'connection.json')),
    );
    assert.ok(connection.pid > 0);
    const reused = await ensureStarted({ projectRoot, dataDir, port });
    assert.equal(reused.reused, true);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'connection.json'))).pid,
      connection.pid,
    );
    const r = await fetch(reused.url + '/api/snapshot', {
      headers: { Authorization: 'Bearer ' + reused.operatorToken },
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).project.id, reused.projectId);
    assert.ok(
      !fs
        .readFileSync(path.join(dataDir, 'startup.log'), 'utf8')
        .includes(reused.operatorToken),
    );
    assert.ok(!fs.existsSync(path.join(dataDir, 'bootstrap.lock')));
    await assert.rejects(
      ensureStarted({ projectRoot, dataDir: path.join(temp, 'other'), port }),
      /另一个项目/,
    );
  } finally {
    const f = path.join(dataDir, 'connection.json');
    if (fs.existsSync(f)) {
      const { pid } = JSON.parse(fs.readFileSync(f));
      try {
        process.kill(pid);
      } catch {}
      for (let i = 0; i < 60; i++) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          break;
        }
      }
    }
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
test('occupied port is not stopped and owner token is never sent to an unrelated service', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-occupied-'));
  let authSeen = false;
  const s = http.createServer((req, res) => {
    authSeen ||= !!req.headers.authorization;
    res.end(JSON.stringify({ service: 'not-our-service' }));
  });
  const port = await listen(s);
  try {
    await assert.rejects(
      ensureStarted({
        projectRoot: temp,
        dataDir: path.join(temp, 'private'),
        port,
      }),
      /其他程序/,
    );
    assert.equal(authSeen, false);
    assert.equal(s.listening, true);
  } finally {
    await close(s);
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
test('API-only homepage explains A4 scene, not npm build', async () => {
  const { createTaskServer } = await import('../server.mjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-home-'));
  const app = createTaskServer({
    dataDir: temp,
    webRoot: path.join(temp, 'missing'),
  });
  const port = await listen(app.server);
  try {
    const r = await fetch('http://127.0.0.1:' + port);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /任务服务正在运行/);
    assert.match(html, /请回到最新版 A4 Note/);
    assert.ok(!html.includes(app.store.access.operatorToken));
  } finally {
    await app.close();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
