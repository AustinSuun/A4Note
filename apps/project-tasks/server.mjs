import {AcceptancePolicyError} from './lib/acceptance-policy.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, ApiError, fail, hash } from './lib/store.mjs';
import { resolveDataDir } from './lib/data-dir.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function createTaskServer({
  dataDir,
  project = 'A4 Note',
  origins = [],
  allowedHosts = ['127.0.0.1', 'localhost', '[::1]'],
  webRoot = path.join(here, 'web-assets'),
} = {}) {
  const store = new Store(dataDir, project),
    clients = new Set();
  let seq = store.snapshot().sequence;
  const notify = () => {
    const n = store.snapshot().sequence;
    if (n !== seq) {
      seq = n;
      for (const r of clients)
        r.write(`id: ${n}\ndata: ${JSON.stringify({ sequence: n })}\n\n`);
    }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const host = req.headers.host ?? '';
      let hostname;
      try {
        hostname = new URL('http://' + host).hostname;
      } catch {
        fail(400, 'Host无效');
      }
      if (!allowedHosts.includes(hostname)) fail(403, 'Host未授权');
      const origin = req.headers.origin;
      if (origin) {
        let same = false;
        try {
          const u = new URL(origin);
          same = u.host === host && ['http:', 'https:'].includes(u.protocol);
        } catch {}
        if (!same && !origins.includes(origin)) fail(403, '来源未授权');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        });
        return res.end();
      }
      const u = new URL(req.url, 'http://localhost'),
        p = u.pathname;
      const send = (data, status = 200) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(data));
      };
      const body = async () => {
        if (
          !String(req.headers['content-type'] ?? '').startsWith(
            'application/json',
          )
        )
          fail(415, '仅接受JSON');
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 15 * 1024 * 1024) fail(413, '请求过大');
          chunks.push(c);
        }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString());
          if (!value || typeof value !== 'object' || Array.isArray(value))
            fail(400, '需要JSON对象');
          return value;
        } catch {
          fail(400, 'JSON无效');
        }
      };
      if (p === '/api/health' && req.method === 'GET')
        return send({
          service: 'a4note-project-tasks',
          version: 1,
          capabilities: {queue: true, acceptance: true},
          projectId: store.access.projectId,
        });
      if (p.startsWith('/api/')) {
        const credential = String(req.headers.authorization ?? '').replace(
          /^Bearer /,
          '',
        );
        if (!credential) fail(401, '需要连接凭据');
        if (p === '/api/join' && req.method === 'POST') {
          const out = store.join(credential, await body());
          notify();
          return send(out, 201);
        }
        const actor = store.auth(credential);
        if (p === '/api/me' && req.method === 'GET') return send(actor);
        if (p === '/api/heartbeat' && req.method === 'POST') {
          store.heartbeat(actor);
          return send({ ok: true });
        }
        if (p === '/api/snapshot' && req.method === 'GET')
          return send(store.snapshot());
        if (p === '/api/events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            Connection: 'keep-alive',
            'Cache-Control': 'no-store',
          });
          res.write(`data: ${JSON.stringify({ sequence: seq })}\n\n`);
          clients.add(res);
          const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
          heartbeat.unref();
          req.on('close', () => {
            clearInterval(heartbeat);
            clients.delete(res);
          });
          return;
        }
        if (p === '/api/tasks' && req.method === 'POST') {
          const out = store.create(actor, await body());
          notify();
          return send(out, 201);
        }
        const acceptance = p.match(/^\/api\/tasks\/([\w-]+)\/acceptance$/);
        if (acceptance && req.method === 'GET') return send(store.acceptance(acceptance[1]));
        if (acceptance && req.method === 'POST') {
          const out = store.acceptanceAction(actor,acceptance[1],await body());
          notify(); return send(out);
        }
        const task = p.match(/^\/api\/tasks\/([\w-]+)$/),
          attach = p.match(/^\/api\/tasks\/([\w-]+)\/attachments$/),
          file = p.match(/^\/api\/attachments\/([\w-]+)$/);
        if (task && req.method === 'GET') return send(store.detail(task[1]));
        if (task && req.method === 'PATCH') {
          const out = store.update(actor, task[1], await body());
          notify();
          return send(out);
        }
        if (attach && req.method === 'POST') {
          const out = store.attach(actor, attach[1], await body());
          notify();
          return send(out, 201);
        }
        if (file && req.method === 'DELETE') {
          const out = store.removeAttachment(
            actor,
            file[1],
            (await body()).revision,
          );
          notify();
          return send(out);
        }
        if (file && req.method === 'GET') {
          const f = store.attachment(file[1]);
          if (!fs.existsSync(f.path)) fail(404, '附件文件缺失，请检查数据备份');
          res.writeHead(200, {
            'Content-Type': f.mime,
            'Content-Length': f.size,
            'Content-Disposition': `${f.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
            'Content-Security-Policy': "default-src 'none'; sandbox",
          });
          return fs
            .createReadStream(f.path)
            .on('error', () => res.destroy())
            .pipe(res);
        }
        fail(404, '接口不存在');
      }
      if (req.method !== 'GET') fail(405, '不支持的请求');
      const filename =
        p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\//, '');
      const resolved = path.resolve(webRoot, filename);
      if (!resolved.startsWith(path.resolve(webRoot) + path.sep))
        fail(403, '路径无效');
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        if (p === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy':
              "default-src 'none'; style-src 'unsafe-inline'",
          });
          return res.end(
            '<!doctype html><meta charset="utf-8"><title>A4 Note 任务服务</title><main style="max-width:560px;margin:80px auto;font:16px/1.8 system-ui"><h1>任务服务正在运行</h1><p>这里是服务接口，不是任务看板。</p><p>请回到最新版 A4 Note 的「任务」场景，点击「启动并连接本机服务」。无需在这里运行 npm run build。</p><p>网页不能替你启动本机程序；独立浏览器看板需另行部署。</p></main>',
          );
        }
        fail(404, '资源不存在');
      }
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      );
      const ext = path.extname(resolved);
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[ext] ?? 'application/octet-stream',
      );
      fs.createReadStream(resolved)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (e) {
      const status = (e instanceof ApiError || e instanceof AcceptancePolicyError) ? e.status : 500;
      if (!res.headersSent) {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            error: status === 500 ? '服务错误，请查看本机服务状态' : e.message,
          }),
        );
      } else res.end();
    }
  });
  return {
    server,
    store,
    async close() {
      for (const r of clients) r.end();
      await new Promise((r) => server.close(r));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const root = path.resolve(process.env.TASKS_PROJECT_ROOT ?? process.cwd());
  const dataDir = process.env.TASKS_DATA_DIR ?? resolveDataDir(root);
  const app = createTaskServer({
    dataDir,
    project: process.env.TASKS_PROJECT_NAME ?? path.basename(root),
    origins: (
      process.env.TASKS_ALLOWED_ORIGINS ??
      'tauri://localhost,http://tauri.localhost,https://tauri.localhost'
    )
      .split(',')
      .filter(Boolean),
    allowedHosts: [
      '127.0.0.1',
      'localhost',
      '[::1]',
      ...(process.env.TASKS_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
    ],
  });
  const port = Number(process.env.TASKS_PORT ?? 4319),
    bind = process.env.TASKS_BIND ?? '127.0.0.1';
  app.server.listen(port, bind, () => {
    fs.writeFileSync(
      path.join(dataDir, 'connection.json'),
      JSON.stringify(
        {
          url: `http://127.0.0.1:${port}`,
          projectRoot: root,
          pid: process.pid,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      `Project task service listening on ${bind}:${port}\nPrivate data: ${dataDir}\nUse cli.mjs access to display the dashboard connection credential locally. Do not commit credentials.`,
    );
  });
  let closing = false;
  const stop = () => {
    if (!closing) {
      closing = true;
      app.close().then(() => process.exit(0));
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
