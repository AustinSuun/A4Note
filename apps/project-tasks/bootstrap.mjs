import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAgentGuide } from './lib/project-onboarding.mjs';
import { resolveDataDir } from './lib/data-dir.mjs';
import { ensureGatewayProject } from './gateway-bootstrap.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
export async function ensureStarted({
  projectRoot,
  port = 4319,
  dataDir,
  timeoutMs = 12000,
} = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw Error('需要 Node.js 22.13 或以上，请安装后重启 A4 Note。');
  if (
    !projectRoot ||
    !path.isAbsolute(projectRoot) ||
    !fs.statSync(projectRoot).isDirectory()
  )
    throw Error('请选择有效的项目文件夹。');
  const root = path.resolve(projectRoot);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('任务服务端口无效。');
  const dir = dataDir ?? resolveDataDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const url = `http://127.0.0.1:${port}`,
    lockPath = path.join(dir, 'bootstrap.lock');
  const probe = async () => {
    let response;
    try {
      response = await fetch(url + '/api/health', {
        signal: AbortSignal.timeout(1000),
        redirect: 'error',
      });
    } catch (e) {
      if (e.cause?.code === 'ECONNREFUSED') return null;
      throw Error('本机端口没有正常响应，请检查占用该端口的程序。');
    }
    const health = await response.json().catch(() => null),
      access = readJson(path.join(dir, 'access.json'));
    if (!response.ok || health?.service !== 'a4note-project-tasks')
      throw Error('端口已被其他程序占用；未关闭任何程序。请使用其他端口。');
    if (!health.projectId)
      throw Error(
        '当前运行的是旧版任务服务，请先在原终端按 Ctrl+C 停止，再点击启动。',
      );
    if (!access || health.projectId !== access.projectId)
      throw Error(
        '该端口是另一个项目的任务服务。请选择对应项目，或使用其他端口。',
      );
    const check = await fetch(url + '/api/me', {
      headers: { Authorization: 'Bearer ' + access.operatorToken },
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    });
    if (!check.ok || (await check.json()).role !== 'human')
      throw Error('本机连接凭据不匹配，请检查服务数据目录。');
    return {
      url,
      operatorToken: access.operatorToken,
      projectId: access.projectId,
      projectRoot: root,
    };
  };
  const existing = await probe();
  if (existing) return { ...existing, reused: true };
  const deadline = Date.now() + timeoutMs;
  let lock;
  while (!lock) {
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A live bootstrap owner is never stolen; dead/partial locks require manual cleanup.
      const ready = await probe();
      if (ready) return { ...ready, reused: true };
      if (Date.now() >= deadline)
        throw Error(
          '另一个启动请求未结束。稍后重试；若持续失败，请检查私有数据目录的 bootstrap.lock。',
        );
      await wait(150);
    }
  }
  let child,
    ready = false;
  try {
    const again = await probe();
    if (again) return { ...again, reused: true };
    // Ignore inherited service configuration: this command starts only a private loopback service.
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith('TASKS_')) delete env[key];
    Object.assign(env, {
      TASKS_PROJECT_ROOT: root,
      TASKS_DATA_DIR: dir,
      TASKS_PORT: String(port),
      TASKS_BIND: '127.0.0.1',
      TASKS_PROJECT_NAME: path.basename(root),
    });
    const log = fs.openSync(path.join(dir, 'startup.log'), 'a', 0o600);
    try {
      child = spawn(process.execPath, [path.join(here, 'server.mjs')], {
        cwd: root,
        env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
      });
    } finally {
      fs.closeSync(log);
    }
    let spawnError;
    child.on('error', (e) => {
      spawnError = e;
    });
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null)
        throw Error('任务服务启动失败，请查看私有数据目录中的 startup.log。');
      const result = await probe();
      if (result) {
        ready = true;
        child.unref();
        return { ...result, reused: false };
      }
      await wait(150);
    }
    throw Error('启动超时，请检查 Node 版本与 startup.log 后重试。');
  } finally {
    if (child && !ready && child.exitCode === null) child.kill();
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  ensureGatewayProject({
    projectRoot: process.argv[2],
    port: Number(process.argv[3] ?? 4319),
  })
    .then((result) => {
      if (process.argv.includes('--register-project'))
        result.onboarding = registerAgentGuide({ projectRoot: result.projectRoot, projectId: result.projectId, runtimeDir: here });
      process.stdout.write(JSON.stringify(result));
    })
    .catch((error) => {
      process.stderr.write(error.message + '\n');
      process.exitCode = 1;
    });
}
