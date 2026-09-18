import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { liveDevPlan, liveTauriConfig } from './dev-live-config.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const { values } = parseArgs({ options: {
  instance: { type: 'string', default: 'integration' },
  port: { type: 'string', default: '1421' },
  'cdp-port': { type: 'string', default: '9230' },
  plan: { type: 'boolean', default: false },
} });
const plan = liveDevPlan(root, { instance: values.instance, port: Number(values.port), cdpPort: Number(values['cdp-port']) });
const base = JSON.parse(await fs.readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const config = liveTauriConfig(base, plan);
if (values.plan) {
  console.log(JSON.stringify({ ...plan, config, note: 'Dry plan only. No processes or directories created. Never copy the production profile/library here.' }, null, 2));
} else {
  if (process.platform !== 'win32') throw new Error('This isolated Tauri launcher currently supports Windows only');
  // Fail closed: never silently run with a production identity or the capture pipe enabled.
  const nativeSource = await fs.readFile(path.join(root, 'src-tauri/src/capture/native_runtime.rs'), 'utf8');
  if (!nativeSource.includes('isolated_live_dev') || !nativeSource.includes('app.aster.research.dev.')) {
    throw new Error('Missing isolated debug capture guard; refusing to launch');
  }
  for (const port of [plan.port, plan.cdpPort]) await checkPort(port);
  await fs.mkdir(plan.stateDir, { recursive: true });
  const lockPath = path.join(plan.stateDir, 'owner.lock.json');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Instance has an owner lock: ${lockPath}. Check its PID/paths before manually clearing a stale lock; do not kill another session.`);
    throw error;
  }
  let server;
  let child;
  let stopping = false;
  const sessionPath = path.join(plan.stateDir, 'session.json');
  const record = { ...plan, ownerPid: process.pid, startedAt: new Date().toISOString(), status: 'starting', productionLibraryCopied: false };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      // Only the still-owned spawned child tree, never all a4note/node processes.
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await lock.writeFile(JSON.stringify(record, null, 2));
    await fs.writeFile(plan.configPath, JSON.stringify(config, null, 2) + '\n');
    await fs.mkdir(plan.profileDir, { recursive: true });
    await fs.writeFile(plan.probePath, ':root { --a4note-live-hmr-probe: baseline; }\n');
    const { createServer } = await import('vite');
    const probeUrl = '/@fs/' + plan.probePath.replaceAll('\\', '/');
    const badgeText = `DEV · ${plan.instance} · 独立测试库`;
    server = await createServer({
      root,
      server: {
        host: '127.0.0.1', port: plan.port, strictPort: true,
        watch: { ignored: ['**/.build/**', '**/.tmp/live-dev/**/webview/**'] },
      },
      plugins: [{
        name: 'a4note-isolated-dev-badge',
        apply: 'serve',
        transformIndexHtml() {
          return [{ tag: 'script', attrs: { type: 'module' }, injectTo: 'body', children:
            `import ${JSON.stringify(probeUrl)};\n` +
            `document.documentElement.dataset.a4noteDevInstance=${JSON.stringify(plan.identifier)};\n` +
            `const badge=document.createElement('div');badge.id='a4note-live-dev-badge';badge.textContent=${JSON.stringify(badgeText)};badge.style.cssText='position:fixed;bottom:6px;left:6px;z-index:2147483000;pointer-events:none;background:#153f37;color:white;border:1px solid #82c2ad;border-radius:5px;padding:4px 8px;font:12px/1.4 sans-serif';document.body.append(badge);`
          }];
        },
      }],
    });
    await server.listen();
    const childEnv = {
      ...process.env,
      CARGO_TARGET_DIR: plan.cargoTargetDir,
      WEBVIEW2_USER_DATA_FOLDER: plan.profileDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${plan.cdpPort} --remote-debugging-address=127.0.0.1`,
    };
    child = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', plan.configPath], {
      cwd: root, env: childEnv, stdio: 'inherit',
    });
    record.tauriCliPid = child.pid;
    record.status = 'running';
    await fs.writeFile(sessionPath, JSON.stringify(record, null, 2) + '\n');
    console.log(`LIVE_DEV ${JSON.stringify(record)}`);
    console.log('No production data copied. Native capture is disabled for this debug identity. Do not open real notes in this test window.');
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    process.exitCode = stopping ? 0 : code;
  } finally {
    stop();
    if (server) await server.close();
    await lock.close();
    await fs.unlink(lockPath);
    await fs.writeFile(sessionPath, JSON.stringify({ ...record, status: 'stopped', stoppedAt: new Date().toISOString() }, null, 2) + '\n');
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error(`Port ${port} unavailable: ${error.message}`)));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()));
  });
}
