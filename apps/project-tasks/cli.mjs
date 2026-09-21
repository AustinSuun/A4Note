#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runtime, api, checkService, resolveSessionConnection } from './lib/agent-client.mjs';
import { createFixturesForRun, verifyFixtures } from './lib/acceptance-fixtures-cli.mjs';
const args = process.argv.slice(2),
  command = args.shift(),
  config = runtime();
const option = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const session = process.env.TASKS_SESSION_FILE ?? option('session', null);
async function main() {
  if (command === 'doctor') {
    console.log(JSON.stringify(await checkService(config), null, 2));
    return;
  }
  if (command === 'access') {
    if (!config.operatorToken) throw Error('请先启动本机服务');
    console.log(
      '仅用于你自己的看板连接，不要发送给执行Agent或提交到仓库。\n' +
        JSON.stringify(
          { url: config.url, operatorToken: config.operatorToken },
          null,
          2,
        ),
    );
    return;
  }
  if (command === 'join') {
    await checkService(config);
    const alias = option('alias', null),
      role = option('role', 'worker');
    if (!alias || !session)
      throw Error(
        'join --alias 青松 --session <私有路径> [--role worker|dispatcher]',
      );
    if (role === 'dispatcher' && !args.includes('--authorized-dispatcher'))
      throw Error(
        '派发角色需要用户授权；明确授权后添加 --authorized-dispatcher',
      );
    const a = await api(
      config.url,
      role === 'dispatcher' ? config.operatorToken : config.enrollmentToken,
      '/join',
      'POST',
      { alias, role },
    );
    fs.mkdirSync(path.dirname(path.resolve(session)), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(
      session,
      JSON.stringify({ url: config.url, projectId: config.projectId, ...a }, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        id: a.id,
        alias: a.alias,
        role: a.role,
        sessionFile: session,
      }),
    );
    return;
  }
  const saved = session ? JSON.parse(fs.readFileSync(session, 'utf8')) : {};
  const token = process.env.TASKS_SESSION_TOKEN ?? saved.sessionToken,
    url = (await resolveSessionConnection(config, saved)).url;
  const call = (endpoint, method = 'GET', body) =>
    api(url, token, endpoint, method, body);
  let result;
  if (command === 'list') result = await call('/snapshot');
  else if (command === 'get') result = await call('/tasks/' + args[0]);
  else if (command === 'download') {
    const output = option('output', null);
    if (!output) throw Error('download ATTACHMENT_ID --output <文件路径>');
    const r = await fetch(url + '/api/attachments/' + args[0], {
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error('附件下载失败');
    fs.writeFileSync(output, Buffer.from(await r.arrayBuffer()), {
      flag: 'wx',
      mode: 0o600,
    });
    result = { savedTo: output };
  } else if (command === 'heartbeat')
    result = await call('/heartbeat', 'POST', {});
  else if (command === 'create') {
    const file = option('json', null);
    if (!file) throw Error('create --json <任务说明.json>');
    result = await call(
      '/tasks',
      'POST',
      JSON.parse(fs.readFileSync(file, 'utf8')),
    );
  } else if (command === 'upload') {
    const file = option('file', null),
      revision = Number(option('revision', NaN));
    if (!file || !Number.isInteger(revision))
      throw Error(
        'upload TASK_ID --file <文件> --revision N [--purpose result]',
      );
    const bytes = fs.readFileSync(file);
    if (bytes.length > 10 * 1024 * 1024) throw Error('附件超过10MB');
    const body = {
      name: path.basename(file),
      purpose: option('purpose', 'result'),
      caption: option('caption', ''),
      revision,
      base64: bytes.toString('base64'),
    };
    const run = option('acceptance-run', null);
    if (run) {
      const captured = Number(option('captured-at', NaN));
      if (!Number.isSafeInteger(captured))
        throw Error('验收证据需要 --captured-at <epoch毫秒>，必须是本次运行内的真实捕获时间');
      Object.assign(body, {
        acceptanceRunId: run,
        evidenceKind: option('evidence-kind', 'screenshot'),
        criterionId: option('criterion-id', null),
        capturedAt: captured,
      });
    }
    result = await call('/tasks/' + args[0] + '/attachments', 'POST', body);
  } else if (command === 'acceptance') {
    const id = args[0], act = option('action', 'show');
    if (!id) throw Error('acceptance TASK_ID [--action show|configure|request|claim|cancel|complete|reopen]');
    if (act === 'show') result = await call('/tasks/' + id + '/acceptance');
    else {
      const body = { action: act };
      const file = option('json', null);
      if (file) Object.assign(body, JSON.parse(fs.readFileSync(file, 'utf8')));
      if (['configure', 'request'].includes(act)) {
        const revision = Number(option('revision', NaN));
        if (Number.isInteger(revision)) body.revision = revision;
        if (!Number.isInteger(body.revision))
          throw Error(act + ' 需要 --revision N（先get任务）；不会按旧版本自动重试');
      }
      const configRevision = Number(option('config-revision', NaN));
      if (Number.isSafeInteger(configRevision)) body.configRevision = configRevision;
      const runId = option('run-id', null);
      if (runId) body.runId = runId;
      else if (act !== 'configure' && act !== 'request' && act !== 'reopen')
        throw Error(act + ' 需要 --run-id');
      const runRevision = Number(option('run-revision', NaN));
      if (Number.isSafeInteger(runRevision)) body.runRevision = runRevision;
      if (act === 'claim') {
        const caps = (option('capabilities', '') || '').split(',').map(c => c.trim()).filter(Boolean);
        if (!caps.length) throw Error('claim 需要 --capabilities command,browser,desktop 中实际具备的能力；不能声明不具备的能力');
        body.capabilities = caps;
      }
      if (act === 'reopen') {
        const reason = option('text', '');
        if (!reason.trim()) throw Error('reopen 需要 --text <复核返工原因>');
        body.reason = reason;
      }
      result = await call('/tasks/' + id + '/acceptance', 'POST', body);
    }
  } else if (command === 'fixtures') {
    const id = args[0], runId = option('run-id', null);
    if (!id || !runId) throw Error('fixtures TASK_ID --run-id <验收请求ID> [--needs-notes] [--json 夹具内容.json] [--manifest-out 清单.json]');
    result = await createFixturesForRun({ call, session: saved, config, taskId: id, runId,
      needsNotes: args.includes('--needs-notes'), json: option('json', null), manifestOut: option('manifest-out', null) });
  } else if (command === 'fixtures-verify') {
    const manifest = option('manifest', null);
    if (!manifest) throw Error('fixtures-verify --manifest <夹具清单.json> [--project-root <授权项目绝对路径>]');
    result = verifyFixtures({ config, json: manifest, projectRoot: option('project-root', null) });
  } else if (
    ['claim', 'takeover', 'handoff', 'acknowledge', 'progress', 'submit', 'release', 'edit'].includes(
      command,
    )
  ) {
    const revision = Number(option('revision', NaN));
    if (!Number.isInteger(revision))
      throw Error('必须先get任务，并指定 --revision N；不会自动按旧要求重试');
    const b = { action: command, revision };
    if (command === 'takeover') {
      b.userAuthorized = args.includes('--user-authorized');
      b.workspaceChecked = args.includes('--workspace-checked');
      b.reason = option('text', '');
    }
    if (command === 'handoff') {
      const file = option('json', null);
      if (!file) throw Error('handoff需要 --json <交接.json>');
      b.handoff = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (command === 'progress') b.progress = option('text', '');
    if (command === 'submit') {
      const f = option('file', null);
      b.result = f ? fs.readFileSync(f, 'utf8') : option('text', '');
      const deliveryFile = option('delivery-json', null);
      if (deliveryFile) b.delivery = JSON.parse(fs.readFileSync(deliveryFile, 'utf8'));
    }
    if (command === 'release') {
      b.writesStopped = args.includes('--writes-stopped');
      b.reason = option('text', '');
    }
    if (command === 'edit') {
      const f = option('json', null);
      if (!f) throw Error('edit需要 --json');
      Object.assign(b, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
    result = await call('/tasks/' + args[0], 'PATCH', b);
  } else
    throw Error(
      '命令：join, list, get, create, claim, takeover, handoff, acknowledge, progress, submit, upload, acceptance, release, heartbeat；任务发布后直接进入queued，claim由执行Agent原子领取，不需要方案审批；acceptance用于独立验收；fixtures/fixtures-verify管理验收夹具；access仅供用户看板连接',
    );
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
