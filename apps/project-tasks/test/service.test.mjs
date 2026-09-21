import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskServer } from '../server.mjs';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
test('service lifecycle, concurrent claims, revisions, attachments and authorization', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-tasks-'));
  let app = createTaskServer({ dataDir: dir, project: '合成项目' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  let url = 'http://127.0.0.1:' + app.server.address().port;
  const admin = app.store.access.operatorToken,
    enroll = app.store.access.enrollmentToken;
  const call = async (
    endpoint,
    token = admin,
    method = 'GET',
    body,
    headers = {},
  ) => {
    const r = await fetch(url + '/api' + endpoint, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.equal((await call('/snapshot', 'wrong')).status, 401);
    assert.equal(
      (
        await call('/snapshot', admin, 'GET', null, {
          Origin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('/join', enroll, 'POST', {
          alias: '管理员',
          role: 'dispatcher',
        })
      ).status,
      403,
    );
    const a = (await call('/join', enroll, 'POST', { alias: '青松' })).body,
      b = (await call('/join', enroll, 'POST', { alias: '青松' })).body;
    assert.notEqual(a.id, b.id);
    assert.equal(a.alias, b.alias);
    assert.equal(
      (await call('/tasks', a.sessionToken, 'POST', { title: '不能创建' }))
        .status,
      403,
    );
    const dispatcher = (
      await call('/join', admin, 'POST', { alias: '派发', role: 'dispatcher' })
    ).body;
    let t = (
      await call('/tasks', dispatcher.sessionToken, 'POST', {
        title: '引用样式',
        description: '不要改全局字号',
        priority: 'high',
      })
    ).body;
    assert.equal(t.status, 'queued');
    const claims = await Promise.all([
      call('/tasks/' + t.id, a.sessionToken, 'PATCH', {
        action: 'claim',
        revision: t.revision,
      }),
      call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
        action: 'claim',
        revision: t.revision,
      }),
    ]);
    assert.deepEqual(claims.map((c) => c.status).sort(), [200, 409]);
    t = claims.find((c) => c.status === 200).body;
    const worker = t.owner === a.id ? a : b,
      other = worker.id === a.id ? b : a;
    assert.equal(
      (
        await call('/tasks/' + t.id, other.sessionToken, 'PATCH', {
          action: 'progress',
          revision: t.revision,
          progress: '伪造',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('/tasks/' + t.id, worker.sessionToken, 'PATCH', {
          action: 'edit',
          revision: t.revision,
          title: '擅自修改',
        })
      ).status,
      403,
    );
    t = (
      await call('/tasks/' + t.id, admin, 'PATCH', {
        action: 'edit',
        revision: t.revision,
        description: '新增要求',
      })
    ).body;
    assert.equal(t.spec_revision, 2);
    assert.equal(
      (
        await call('/tasks/' + t.id, worker.sessionToken, 'PATCH', {
          action: 'submit',
          revision: t.revision,
          result: '旧结果',
        })
      ).status,
      409,
    );
    t = (
      await call('/tasks/' + t.id + '/attachments', admin, 'POST', {
        name: '../../截图.png',
        revision: t.revision,
        purpose: 'reference',
        base64: png.toString('base64'),
      })
    ).body;
    assert.equal(t.attachments.length, 1);
    assert.equal(t.spec_revision, 3);
    assert.equal(t.attachments[0].mime, 'image/png');
    assert.ok(!t.attachments[0].name.includes('/'));
    const f = await fetch(url + '/api/attachments/' + t.attachments[0].id, {
      headers: { Authorization: 'Bearer ' + worker.sessionToken },
    });
    assert.equal(f.status, 200);
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), png);
    assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      (await fetch(url + '/api/attachments/' + t.attachments[0].id)).status,
      401,
    );
    t = (
      await call('/tasks/' + t.id, worker.sessionToken, 'PATCH', {
        action: 'acknowledge',
        revision: t.revision,
      })
    ).body;
    assert.equal(
      (
        await call(
          '/tasks/' + t.id + '/attachments',
          worker.sessionToken,
          'POST',
          {
            name: 'ref.png',
            revision: t.revision,
            purpose: 'reference',
            base64: png.toString('base64'),
          },
        )
      ).status,
      403,
    );
    t = (
      await call(
        '/tasks/' + t.id + '/attachments',
        worker.sessionToken,
        'POST',
        {
          name: 'after.png',
          revision: t.revision,
          purpose: 'result',
          base64: png.toString('base64'),
        },
      )
    ).body;
    assert.equal(t.spec_revision, 3);
    t = (
      await call('/tasks/' + t.id, worker.sessionToken, 'PATCH', {
        action: 'submit',
        revision: t.revision,
        result: '浏览器检查通过',
      })
    ).body;
    assert.equal(t.status, 'review');
    assert.equal(
      (
        await call('/tasks/' + t.id, worker.sessionToken, 'PATCH', {
          action: 'archive',
          revision: t.revision,
        })
      ).status,
      403,
    );
    t = (
      await call('/tasks/' + t.id, admin, 'PATCH', {
        action: 'request_changes',
        revision: t.revision,
        feedback: '间距再调整',
      })
    ).body;
    assert.equal(t.status, 'queued');
    assert.equal(t.owner, null);
    t = (
      await call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
        action: 'claim',
        revision: t.revision,
      })
    ).body;
    assert.equal(
      (
        await call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
          action: 'release_stale',
          revision: t.revision,
          reason: '执行者离线',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('/tasks/' + t.id, admin, 'PATCH', {
          action: 'release_stale',
          revision: t.revision,
        })
      ).status,
      400,
    );
    t = (
      await call('/tasks/' + t.id, admin, 'PATCH', {
        action: 'release_stale',
        revision: t.revision,
        reason: '执行者离线，用户授权交接',
      })
    ).body;
    assert.equal(t.status, 'queued');
    assert.equal(t.owner, null);
    t = (
      await call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
        action: 'claim',
        revision: t.revision,
      })
    ).body;
    assert.equal(
      (
        await call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
          action: 'release',
          revision: t.revision,
        })
      ).status,
      403,
    );
    t = (
      await call('/tasks/' + t.id, b.sessionToken, 'PATCH', {
        action: 'release',
        revision: t.revision,
        writesStopped: true,
      })
    ).body;
    assert.equal(t.status, 'queued');
    t = (
      await call('/tasks/' + t.id, a.sessionToken, 'PATCH', {
        action: 'claim',
        revision: t.revision,
      })
    ).body;
    t = (
      await call('/tasks/' + t.id, a.sessionToken, 'PATCH', {
        action: 'submit',
        revision: t.revision,
        result: '调整完成',
      })
    ).body;
    t = (
      await call('/tasks/' + t.id, admin, 'PATCH', {
        action: 'archive',
        revision: t.revision,
      })
    ).body;
    assert.equal(t.status, 'archived');
    assert.equal(
      (
        await call('/tasks/' + t.id, admin, 'PATCH', {
          action: 'edit',
          revision: t.revision,
          title: '不能改',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call('/tasks/' + t.id + '/attachments', admin, 'POST', {
          name: 'x.png',
          revision: t.revision,
          base64: png.toString('base64'),
        })
      ).status,
      409,
    );
    // Direct queue flow has no backlog promotion action; deletion remains user-only.
    const dq = (
      await call('/tasks', dispatcher.sessionToken, 'POST', { title: '待删除卡' })
    ).body;
    assert.equal(dq.status, 'queued');
    assert.equal(
      (
        await call('/tasks/' + dq.id, a.sessionToken, 'PATCH', {
          action: 'promote',
          revision: dq.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('/tasks/' + dq.id, admin, 'PATCH', {
          action: 'promote',
          revision: dq.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('/tasks/' + dq.id, a.sessionToken, 'PATCH', {
          action: 'delete',
          revision: dq.revision,
        })
      ).status,
      403,
    );
    const del = await call('/tasks/' + dq.id, admin, 'PATCH', {
      action: 'delete',
      revision: dq.revision,
    });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, dq.id);
    assert.equal((await call('/tasks/' + dq.id)).status, 404);
    assert.ok(
      !((await call('/snapshot')).body.tasks ?? []).some((x) => x.id === dq.id),
    );
    assert.ok(
      (await call('/snapshot')).body.agents.every(
        (a) => !('token_hash' in a) && !('sessionToken' in a),
      ),
    );
    const id = t.id;
    await app.close();
    app = createTaskServer({ dataDir: dir, project: '不能覆盖项目' });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    url = 'http://127.0.0.1:' + app.server.address().port;
    t = (await call('/tasks/' + id)).body;
    assert.equal(t.status, 'archived');
    assert.equal(t.attachments.length, 2);
    assert.equal((await call('/snapshot')).body.project.name, '合成项目');
    t = (await call('/tasks', admin, 'POST', { title: '安全' })).body;
    t = (
      await call('/tasks/' + t.id + '/attachments', admin, 'POST', {
        name: 'x.svg',
        revision: t.revision,
        base64: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
      })
    ).body;
    const svg = await fetch(url + '/api/attachments/' + t.attachments[0].id, {
      headers: { Authorization: 'Bearer ' + admin },
    });
    assert.equal(svg.headers.get('content-type'), 'application/octet-stream');
    assert.ok(svg.headers.get('content-disposition').startsWith('attachment'));
    assert.equal(
      (
        await call('/tasks/' + t.id + '/attachments', admin, 'POST', {
          name: 'bad.png',
          revision: t.revision,
          base64: '!!!!',
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
