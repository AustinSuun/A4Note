import { createHash } from 'node:crypto';
import path from 'node:path';

export function liveDevPlan(root, { instance = 'integration', port = 1421, cdpPort = 9230 } = {}) {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(instance)) throw new Error('instance must be 1–24 lowercase letters/digits/hyphens and start with a letter');
  for (const value of [port, cdpPort]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Ports must be integers from 1024 to 65535');
  }
  if (port === cdpPort) throw new Error('Vite and CDP ports must differ');
  root = path.resolve(root);
  const suffix = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 10);
  const identifier = `app.aster.research.dev.${instance}.w${suffix}`;
  const stateDir = path.join(root, '.tmp', 'live-dev', instance);
  return {
    root, instance, port, cdpPort, identifier,
    url: `http://127.0.0.1:${port}`,
    stateDir,
    configPath: path.join(stateDir, 'tauri.dev.json'),
    profileDir: path.join(stateDir, 'webview'),
    probePath: path.join(stateDir, 'hmr-probe.css'),
    cargoTargetDir: path.join(root, '.build', 'live-dev', instance, 'target'),
  };
}

export function liveTauriConfig(base, plan) {
  const main = base.app?.windows?.find(window => (window.label ?? 'main') === 'main');
  if (!main) throw new Error('Expected the main window in tauri.conf.json');
  return {
    productName: `A4 Note DEV ${plan.instance}`,
    identifier: plan.identifier,
    build: { beforeDevCommand: null, devUrl: plan.url },
    app: {
      windows: [{ ...main, label: 'main', title: `A4 Note DEV · ${plan.instance} · 独立测试库`, dataDirectory: 'live-webview', devtools: true }],
    },
    // No automatic release check/download from an isolated development instance.
    plugins: { updater: { endpoints: [] } },
  };
}
