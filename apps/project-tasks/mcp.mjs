#!/usr/bin/env node
// Standard stdio MCP; never write credentials or diagnostic logs to stdout.
import readline from 'node:readline';
import { runtime, api, checkService, resolveSessionConnection } from './lib/agent-client.mjs';
import { createFixturesForRun, verifyFixtures } from './lib/acceptance-fixtures-cli.mjs';
const cfg = runtime();
let sessionToken = process.env.TASKS_SESSION_TOKEN ?? null;
const schema = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }),
  str = { type: 'string' },
  num = { type: 'integer', minimum: 1 };
const tools = [
  { name: 'connection_status', description: '检查服务是否属于当前项目；不发送凭据，不启动服务。', inputSchema: schema({}) },
  {
    name: 'join',
    description: '为当前对话注册临时代号；默认执行者。不会继承旧对话写入权限。',
    inputSchema: schema({ alias: str }, ['alias']),
  },
  {
    name: 'list_tasks',
    description: '查看当前项目任务和Agent代号，不读取历史聊天。',
    inputSchema: schema({}),
  },
  {
    name: 'get_task',
    description: '读取最新revision/spec_revision、附件和验收要求。',
    inputSchema: schema({ id: str }, ['id']),
  },
  {
    name: 'read_attachment',
    description:
      '读取任务附件。图片返回可见内容，其他文件建议使用CLI download。',
    inputSchema: schema({ id: str }, ['id']),
  },
  {
    name: 'heartbeat',
    description: '报告当前会话仍在运行；失联任务不会自动转交。',
    inputSchema: schema({}),
  },
  {
    name: 'create_task',
    description: '仅已有授权的派发会话可创建任务。',
    inputSchema: schema(
      {
        title: str,
        description: str,
        acceptance: str,
        priority: { enum: ['high', 'normal', 'low'] },
      },
      ['title'],
    ),
  },
  {
    name: 'update_task',
    description:
      '使用已读revision操作任务；冲突时必须重新读取。任务发布后直接进入queued，执行Agent可原子领取；submit直接进入review。takeover须用户明确授权说明、工作区隔离核验及原负责人超过2分钟无心跳；handoff记录结构化交接。接管后重新读取并acknowledge。不提供用户验收归档权限。',
    inputSchema: schema(
      {
        id: str,
        revision: num,
        action: {
          enum: [
            'claim', 'takeover', 'handoff',
            'acknowledge',
            'progress',
            'submit',
            'release',
            'edit',
          ],
        },
        progress: str,
        result: str,
        reason: str,
        userAuthorized: { type: 'boolean' },
        workspaceChecked: { type: 'boolean' },
        handoff: schema(Object.fromEntries(['completed','remaining','blockers','nextSteps','branch','worktree','commit','uncommittedChanges','resources','validation'].map(k => [k, str]))),
        writesStopped: { type: 'boolean' },
        title: str,
        description: str,
        acceptance: str,
      },
      ['id', 'revision', 'action'],
    ),
  },
  {
    name: 'attach_file',
    description:
      '上传已获授权的附件base64，单个最多10MB；大文件建议CLI upload。执行者只能上传自己任务的result附件。',
    inputSchema: schema(
      {
        id: str,
        revision: num,
        name: str,
        purpose: { enum: ['reference', 'reproduction', 'result'] },
        caption: str,
        base64: str,
        acceptanceRunId: str,
        evidenceKind: { enum: ['report', 'screenshot'] },
        criterionId: str,
        capturedAt: num,
      },
      ['id', 'revision', 'name', 'base64'],
    ),
  },
  {
    name: 'acceptance_fixtures',
    description:
      '为本会话已领取的验收请求创建隔离测试笔记/样式样例夹具；needsNotes=false时不写任何文件。不启动应用、不改真实资料或.gitignore、不覆盖旧运行。',
    inputSchema: schema(
      { id: str, runId: str, needsNotes: { type: 'boolean' }, note: str, sample: str, environment: str, manifestOut: str },
      ['id', 'runId'],
    ),
  },
  {
    name: 'acceptance_fixtures_verify',
    description: '验收结束后重验夹具输入指纹，确认原始输入未被非预期修改。',
    inputSchema: schema({ manifest: str }, ['manifest']),
  },
  {
    name: 'acceptance_status',
    description: '读取任务验收方式、已批准标准和验收请求；不修改任何内容。',
    inputSchema: schema({ id: str }, ['id']),
  },
  {
    name: 'acceptance_action',
    description:
      '独立验收协议：claim/complete仅限已领取的验收会话且不能是交付开发者；configure/request/cancel/reopen仅限用户。能力不足或证据缺失会失败，不会自动判通过。',
    inputSchema: schema(
      {
        id: str,
        action: { enum: ['configure', 'request', 'claim', 'cancel', 'complete', 'reopen'] },
        revision: num,
        runId: str,
        runRevision: num,
        capabilities: { type: 'array', items: { enum: ['command', 'browser', 'desktop'] }, maxItems: 3 },
        target: schema({ kind: { enum: ['command', 'browser', 'desktop'] }, source: str, version: str, sha256: str }, ['kind', 'source', 'version', 'sha256']),
        mode: { enum: ['manual', 'automatic'] },
        configRevision: num,
        criteria: { type: 'array', maxItems: 40 },
        report: { type: 'object' },
        reason: str,
      },
      ['id', 'action'],
    ),
  },
];
async function request(m) {
  if (m.method === 'initialize')
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'a4note-project-tasks', version: '0.1.0' },
      instructions:
        '直接队列流程：先connection_status确认本项目服务，再join或使用已授权会话；先读任务再修改；派发Agent发布后任务进入queued，执行Agent按队列原子领取，更新progress与heartbeat，submit后进入review。用户在A4 Note检查实际效果，满意后归档，不满意则退回队列。独立验收会话仍需先读取请求、声明真实能力并绑定证据；执行Agent不能自行归档。',
    };
  if (m.method === 'ping') return {};
  if (m.method === 'tools/list') return { tools };
  if (m.method === 'tools/call') {
    try {
      const { name, arguments: b = {} } = m.params ?? {};
      let r;
      if (name === 'connection_status') {
        r = await checkService(cfg);
      } else if (name === 'join') {
        await checkService(cfg);
        if (sessionToken)
          throw Error('本MCP进程已绑定会话，请新开对话/进程注册另一身份');
        const a = await api(cfg.url, cfg.enrollmentToken, '/join', 'POST', {
          alias: b.alias,
          role: 'worker',
        });
        sessionToken = a.sessionToken;
        r = { id: a.id, alias: a.alias, role: a.role };
      } else {
        const live = await resolveSessionConnection({...runtime(), projectId:cfg.projectId});
        cfg.url = live.url;
        const call = (p, method = 'GET', body) =>
          api(cfg.url, sessionToken, p, method, body);
        if (name === 'list_tasks') r = await call('/snapshot');
        else if (name === 'get_task') r = await call('/tasks/' + b.id);
        else if (name === 'read_attachment') {
          if (!sessionToken) throw Error('请先join');
          const response = await fetch(cfg.url + '/api/attachments/' + b.id, {
            headers: { Authorization: 'Bearer ' + sessionToken },
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) throw Error('附件读取失败');
          const mime = response.headers.get('content-type');
          if (!mime?.startsWith('image/'))
            throw Error('非图片附件请使用CLI download');
          return {
            content: [
              {
                type: 'image',
                mimeType: mime,
                data: Buffer.from(await response.arrayBuffer()).toString(
                  'base64',
                ),
              },
            ],
          };
        } else if (name === 'heartbeat')
          r = await call('/heartbeat', 'POST', {});
        else if (name === 'create_task') r = await call('/tasks', 'POST', b);
        else if (name === 'update_task') {
          const { id, ...body } = b;
          if (
            ![
            'claim', 'takeover', 'handoff',
              'acknowledge',
              'progress',
              'submit',
              'release',
              'edit',
            ].includes(body.action)
          )
            throw Error('MCP不提供方案审批或用户验收归档操作；任务发布后直接进入队列，用户在任务板检查并归档');
          r = await call('/tasks/' + id, 'PATCH', body);
        } else if (name === 'attach_file') {
          const { id, ...body } = b;
          r = await call('/tasks/' + id + '/attachments', 'POST', body);
        } else throw Error('未知工具');
      }
      return { content: [{ type: 'text', text: JSON.stringify(r) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  }
  throw Error('Unsupported method');
}
const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
let queue = Promise.resolve();
lines.on('line', (line) => {
  queue = queue.then(async () => {
    let m;
    try {
      m = JSON.parse(line);
      if (m.id === undefined) return;
      const result = await request(m);
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n',
      );
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: m?.id ?? null,
          error: { code: -32600, message: 'Invalid request' },
        }) + '\n',
      );
    }
  });
});
