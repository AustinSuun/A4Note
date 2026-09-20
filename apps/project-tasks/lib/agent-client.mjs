import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveDataDir } from './data-dir.mjs';
export function runtime() {
  const root = path.resolve(process.env.TASKS_PROJECT_ROOT ?? process.cwd()),
    id = createHash('sha256').update(root).digest('hex').slice(0, 16),
    dir = process.env.TASKS_DATA_DIR ?? resolveDataDir(root);
  let connection = {},
    access = {};
  try {
    connection = JSON.parse(
      fs.readFileSync(path.join(dir, 'connection.json'), 'utf8'),
    );
  } catch {}
  try {
    access = JSON.parse(fs.readFileSync(path.join(dir, 'access.json'), 'utf8'));
  } catch {}
  return {
    dir,
    projectRoot: root,
    projectId: process.env.TASKS_EXPECTED_PROJECT_ID ?? access.projectId,
    url: process.env.TASKS_URL ?? connection.url ?? 'http://127.0.0.1:4319',
    enrollmentToken:
      process.env.TASKS_ENROLLMENT_TOKEN ?? access.enrollmentToken,
    operatorToken: access.operatorToken,
  };
}
export async function api(url, token, endpoint, method = 'GET', body) {
  if (!token)
    throw Error('没有连接凭据。先启动服务，或通过环境变量配置授权连接。');
  const r = await fetch(url + '/api' + endpoint, {
    method,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(e.error ?? '服务请求失败');
  }
  return r.json();
}

export async function checkService(config = runtime()) {
  if (!config.projectId) throw Error('本项目没有已确认的服务身份。请在A4中打开项目，或配置TASKS_EXPECTED_PROJECT_ID。');
  let r;
  try { r = await fetch(config.url + '/api/health', { signal: AbortSignal.timeout(3000), redirect: 'error' }); }
  catch { throw Error('项目看板服务不可达，请在A4中打开对应项目；不要自行另起服务。'); }
  const health = await r.json().catch(() => null);
  if (!r.ok || health?.service !== 'a4note-project-tasks' || health.projectId !== config.projectId)
    throw Error('看板服务身份不匹配：不是当前项目，未发送任何连接凭据。');
  return { available: true, projectRoot: config.projectRoot, projectId: config.projectId, url: config.url };
}

// Refresh the endpoint from private project metadata, without changing a session
// file. An endpoint is never trusted merely because it was saved in a session.
export async function resolveSessionConnection(config = runtime(), saved = {}) {
  if(saved.projectId && config.projectId && saved.projectId !== config.projectId)
    throw Error('会话不属于当前项目，未发送凭据');
  const expected = config.projectId ?? saved.projectId;
  const candidates = process.env.TASKS_URL ? [process.env.TASKS_URL] : [...new Set([config.url, saved.url].filter(Boolean))];
  let error;
  for(const url of candidates) {
    try { return await checkService({...config, projectId:expected, url}); }
    catch(e) { error=e; }
  }
  throw error ?? Error('没有已确认项目连接');
}
