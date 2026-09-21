// Isolated headless-Chromium regression for the environment strip. Serves the real
// product module (src/platform/devEnvironmentStrip.ts) in a synthetic fixture page with
// mocked native verdicts, so it tests rendering, layout reservation and fail-closed
// behaviour — not isolation itself. Evidence: .tmp/dev-environment/<run>/ (gitignored).
// CHROME_PATH overrides the browser.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const DEV_STRIP_ID = 'a4note-live-dev-badge';
const DEV_STRIP_HEIGHT = 28;
const own = path.resolve('.tmp/dev-environment');
const run = 'browser-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(own, run);
fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
const profile = path.join(own, run + '-profile');
const records = [];
const screenshots = [];
const errors = [];
const check = (ok, name, detail) => records.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IDENTIFIER = 'app.aster.research.dev.browser-a.w0123456789';
const chromeCandidates = [process.env.CHROME_PATH, process.env.TASKBOARD_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));

let server;
let chrome;
let ws;
let seq = 0;
const requests = new Map();
async function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP timeout ' + method)); }, method === 'Page.navigate' ? 60000 : 15000);
    requests.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  return result.result?.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 50; i++) { if (await ev(expression)) return; await pause(100); }
  throw new Error('Timed out waiting for ' + expression);
}
async function shot(name) {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(file);
}
const badge = `document.getElementById(${JSON.stringify(DEV_STRIP_ID)})`;
async function navigateWithMock(url, mock, { expectBadge = true } = {}) {
  const injected = mock ? await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI_INTERNALS__={invoke:async(cmd)=>{if(cmd!=='get_dev_environment')throw new Error('unexpected '+cmd);return (${mock})();}}` }) : null;
  await rpc('Page.navigate', { url });
  if (expectBadge) await waitFor(`${badge} && ${badge}.dataset.state !== 'checking'`);
  else { await waitFor(`document.readyState === 'complete'`); await pause(400); }
  if (injected) await rpc('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
}

try {
  if (!chromePath) throw new Error('No Chromium found; set CHROME_PATH');
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: path.join(own, run + '-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/.tmp/**', '**/.build/**', '**/src-tauri/target/**'] } },
    logLevel: 'error',
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dev-environment.html`;
  const launcherUrl = `${base}?instance=browser-a&expected=${encodeURIComponent(IDENTIFIER)}`; // npm run dev:live
  const previewUrl = `${base}?instance=preview`; // npm run dev / tauri dev through vite.config.ts
  const staticUrl = `${base}?dev=0`; // production bundle (tauri build / installed app)
  chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = tabs.find((tab) => tab.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && requests.has(message.id)) {
      const pending = requests.get(message.id);
      requests.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails);
    }
  });
  await rpc('Page.enable');
  await rpc('Runtime.enable');

  // 1. Plain browser under the dev server: never labelled isolated; strip reserved below content at three widths.
  for (const width of [1280, 800, 360]) {
    await rpc('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await navigateWithMock(launcherUrl, null);
    check(await ev(`${badge}.dataset.state === 'browser'`), `browser state at ${width}`);
    check(await ev(`${badge}.textContent.includes('浏览器预览') && !${badge}.textContent.includes('独立测试库')`), `browser wording at ${width}`);
    check(await ev(`(() => { const b = ${badge}.getBoundingClientRect(); const r = document.getElementById('root').getBoundingClientRect(); const f = document.querySelector('footer button').getBoundingClientRect(); return r.bottom <= b.top + 0.5 && f.bottom <= b.top + 0.5 && Math.round(b.height) === ${DEV_STRIP_HEIGHT} && b.bottom <= innerHeight && b.width <= innerWidth; })()`), `reserved strip does not cover content or bottom controls at ${width}`);
    check(await ev(`!${badge}.textContent.includes('C:\\\\\\\\Users') && !${badge}.textContent.includes('/Users/')`), `no private path at ${width}`);
    await shot('browser-' + width);
  }
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false });

  // 2. Native verdict: isolated → verified wording carries the backend's identity, root tail only.
  await navigateWithMock(launcherUrl, `() => ({ mode: 'isolated', identifier: ${JSON.stringify(IDENTIFIER)}, instance: 'browser-a', debug: true, isolated: true, blocked: false, dataRootTail: 'app.aster.research.dev.browser-a.w0123456789/AsterData', reason: null, code: null })`);
  check(await ev(`${badge}.dataset.state === 'verified'`), 'verified state (mock verdict)');
  check(await ev(`${badge}.textContent.includes('独立测试库') && ${badge}.textContent.includes(${JSON.stringify(IDENTIFIER)})`), 'verified wording names the identity');
  check(await ev(`document.documentElement.dataset.a4noteDevInstance === ${JSON.stringify(IDENTIFIER)}`), 'verified identity exposed on <html>');
  check(await ev(`!document.getElementById('root').inert`), 'verified page stays interactive');
  check(await ev(`(() => { const b = ${badge}.getBoundingClientRect(); const f = document.querySelector('footer button').getBoundingClientRect(); return f.bottom <= b.top + 0.5; })()`), 'verified strip still reserves its own space');
  await shot('mock-verified');

  // 3. Native verdict: blocked → red strip with the backend reason, page inert.
  await navigateWithMock(launcherUrl, `() => ({ mode: 'blocked', identifier: 'app.aster.research', instance: null, debug: true, isolated: false, blocked: true, dataRootTail: 'app.aster.research/AsterData', code: 'production-library-in-debug', reason: '调试构建默认不打开正式资料库' })`);
  check(await ev(`${badge}.dataset.state === 'blocked'`), 'blocked state (mock verdict)');
  check(await ev(`${badge}.textContent.includes('已阻止资料库访问') && ${badge}.textContent.includes('调试构建默认不打开正式资料库')`), 'blocked wording carries the native reason');
  check(await ev(`document.getElementById('root').inert === true`), 'blocked page is inert');
  await shot('mock-blocked');

  // 4. Frontend/backend identity mismatch (Vite of instance A serving a window of another identity).
  await navigateWithMock(launcherUrl, `() => ({ mode: 'isolated', identifier: 'app.aster.research.dev.other.w9999999999', instance: 'other', debug: true, isolated: true, blocked: false, dataRootTail: 'x/AsterData' })`);
  check(await ev(`${badge}.dataset.state === 'blocked' && ${badge}.textContent.includes('不一致')`), 'identity mismatch is blocked even when the backend says isolated');
  check(await ev(`document.getElementById('root').inert === true`), 'mismatched page is inert');
  await shot('mock-mismatch');

  // 5. Human override on the real library (`tauri dev` + override through vite.config.ts): loud, never called isolated.
  await navigateWithMock(previewUrl, `() => ({ mode: 'production-debug', identifier: 'app.aster.research', instance: null, debug: true, isolated: false, blocked: false, dataRootTail: 'app.aster.research/AsterData', code: 'production-allowed' })`);
  check(await ev(`${badge}.dataset.state === 'production' && ${badge}.textContent.includes('正式资料库') && !${badge}.textContent.includes('独立测试库')`), 'production-debug is labelled as the real library');
  await shot('mock-production-debug');
  // 5b. Generic preview entry in a plain browser and with a blocked `tauri dev` verdict.
  await navigateWithMock(previewUrl, null);
  check(await ev(`${badge}.dataset.state === 'browser' && ${badge}.textContent.includes('preview')`), 'generic preview entry labels plain browser previews');
  await navigateWithMock(previewUrl, `() => ({ mode: 'blocked', identifier: 'app.aster.research', instance: null, debug: true, isolated: false, blocked: true, dataRootTail: 'app.aster.research/AsterData', code: 'production-library-in-debug', reason: '调试构建默认不打开正式资料库（app.aster.research）。请用 npm run dev:live 启动独立实例' })`);
  check(await ev(`${badge}.dataset.state === 'blocked' && ${badge}.textContent.includes('npm run dev:live') && document.getElementById('root').inert === true`), 'plain tauri dev verdict is blocked with launcher guidance');
  await shot('mock-tauri-dev-blocked');

  // 6. IPC failure under a launcher/dev server: fail closed.
  await navigateWithMock(launcherUrl, `() => { throw new Error('ipc unavailable'); }`);
  check(await ev(`${badge}.dataset.state === 'error' && document.getElementById('root').inert === true`), 'IPC failure blocks a dev-server page');
  await shot('mock-ipc-error');

  // 7. Static bundle (tauri build / installed app): the shipped product renders no strip for a release verdict,
  //    and a plain browser without Tauri gets nothing either. Isolated debug bundles still show the verified strip.
  await navigateWithMock(staticUrl, `() => ({ mode: 'release', identifier: 'app.aster.research', instance: null, debug: false, isolated: false, blocked: false, dataRootTail: 'app.aster.research/AsterData' })`, { expectBadge: false });
  check(await ev(`${badge} === null && !document.documentElement.dataset.a4noteEnvStrip && !document.getElementById('root').inert`), 'release verdict renders no strip and reserves no space');
  await shot('static-release');
  await navigateWithMock(staticUrl, null, { expectBadge: false });
  check(await ev(`${badge} === null`), 'production bundle in a plain browser renders no strip');
  await navigateWithMock(staticUrl, `() => ({ mode: 'isolated', identifier: ${JSON.stringify(IDENTIFIER)}, instance: 'browser-a', debug: true, isolated: true, blocked: false, dataRootTail: 'app.aster.research.dev.browser-a.w0123456789/AsterData' })`);
  check(await ev(`${badge}.dataset.state === 'verified' && ${badge}.textContent.includes('独立测试库')`), 'isolated debug bundle (no dev server) still shows the verified strip');
  await shot('static-isolated');
  await navigateWithMock(staticUrl, `() => ({ mode: 'blocked', identifier: ${JSON.stringify(IDENTIFIER)}, instance: 'browser-a', debug: true, isolated: false, blocked: true, dataRootTail: 'x/AsterData', code: 'missing-expected-identity', reason: '身份不是由启动器登记的实例' })`);
  check(await ev(`${badge}.dataset.state === 'blocked' && document.getElementById('root').inert === true`), 'blocked verdict locks a static debug bundle too');
  await shot('static-blocked');
  // Under a dev server a release verdict is flagged (release binary pointed at Vite), never called isolated.
  await navigateWithMock(previewUrl, `() => ({ mode: 'release', identifier: 'app.aster.research', instance: null, debug: false, isolated: false, blocked: false, dataRootTail: 'app.aster.research/AsterData' })`);
  check(await ev(`${badge}.dataset.state === 'unverified' && !${badge}.textContent.includes('独立测试库')`), 'release binary under a dev server is flagged unverified');

  check(errors.length === 0, 'no runtime exceptions', errors.map((error) => error.text));
} catch (error) {
  records.push({ name: 'Execution failure', passed: false, error: String(error), stack: error.stack });
} finally {
  const result = { at: new Date().toISOString(), scope: 'real product strip module in a synthetic fixture page with mocked native verdicts; not isolation proof, not the installed app', run, evidence, passed: records.filter((r) => r.passed).length, failed: records.filter((r) => !r.passed).length, records, screenshots };
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, failed: result.failed, evidence, failures: records.filter((r) => !r.passed) }));
  try { ws?.close(); } catch {}
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (server) await server.close();
  if (result.failed > 0) process.exitCode = 1;
}
