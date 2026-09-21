import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { liveDevPlan, liveTauriConfig } from './dev-live-config.mjs';
import { acquireDevLock, checkDevAdmission } from './dev-live-admission.mjs';

// realpath: a junction/symlinked checkout must not produce a different identity hash than its target.
const root = await fs.realpath(path.resolve(fileURLToPath(new URL('../', import.meta.url))));
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
  // Admission before any directory is created: identity, data root and profile must be
  // provably isolated, and the native side re-verifies the same values at runtime.
  const devEnv = await checkDevAdmission(plan, process.env);
  for (const port of [plan.port, plan.cdpPort]) await checkPort(port);
  await fs.mkdir(plan.stateDir, { recursive: true });
  const lockPath = path.join(plan.stateDir, 'owner.lock.json');
  const lock = await acquireDevLock(lockPath);
  let server;
  let child;
  let stopping = false;
  const sessionPath = path.join(plan.stateDir, 'session.json');
  const record = { ...plan, expected: devEnv, ownerPid: process.pid, startedAt: new Date().toISOString(), status: 'starting', productionLibraryCopied: false };
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
    const { default: react } = await import('@vitejs/plugin-react');
    const probeUrl = '/@fs/' + plan.probePath.replaceAll('\\', '/');
    server = await createServer({
      root,
      // vite.config.ts is bypassed on purpose: this server hands the launcher identity to the
      // product's environment strip (src/platform/devEnvironmentStrip.ts) so the page can detect
      // a mismatched backend; plain `npm run dev` keeps the generic 'preview' instance.
      configFile: false,
      define: {
        'import.meta.env.VITE_A4NOTE_DEV_INSTANCE': JSON.stringify(plan.instance),
        'import.meta.env.VITE_A4NOTE_DEV_IDENTIFIER': JSON.stringify(plan.identifier),
      },
      server: {
        host: '127.0.0.1', port: plan.port, strictPort: true,
        watch: { ignored: ['**/.build/**', '**/.tmp/live-dev/**/webview/**'] },
      },
      plugins: [
        react(),
        {
          name: 'a4note-live-hmr-probe',
          apply: 'serve',
          transformIndexHtml() {
            return [{ tag: 'script', attrs: { type: 'module' }, injectTo: 'body', children: `import ${JSON.stringify(probeUrl)};` }];
          },
        },
      ],
    });
    await server.listen();
    const childEnv = {
      ...process.env,
      ...devEnv,
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
    console.log(`Verify before trusting screenshots: the bottom strip must read "DEV ${plan.instance} · 独立测试库（原生已核验 …）"; a red strip means the native side refused the library. Static debug builds show the same strip once they are launched with ${Object.keys(devEnv).join('/')}.`);
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
