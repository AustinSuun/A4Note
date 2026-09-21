// Runtime verification of a running `npm run dev:live` window over its local CDP port.
// Read-only unless --write-marker is given (creates one library folder in that
// instance so a second instance can prove it does not see it).
//
//   node scripts/verify-dev-live-runtime.mjs --cdp-port 9271 --expect-instance xq-a --evidence .tmp/live-evidence/xq-a
//   node scripts/verify-dev-live-runtime.mjs --cdp-port 9272 --expect-instance xq-b --expect-no-folder <name>
//
// Records: strip state/text, native verdict (get_dev_environment), library root tail
// (get_aster_paths, user directory redacted), capture status, screenshots of the main
// scenes at the current window size and a 980×680 emulated viewport.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'cdp-port': { type: 'string' },
  'expect-instance': { type: 'string' },
  'expect-mode': { type: 'string', default: 'isolated' },
  evidence: { type: 'string' },
  'write-marker': { type: 'string' },
  'expect-no-folder': { type: 'string' },
  'expect-folder': { type: 'string' },
  'page-url-prefix': { type: 'string' },
} });
if (!values['cdp-port']) throw new Error('--cdp-port is required');
const cdpPort = Number(values['cdp-port']);
const evidence = path.resolve(values.evidence ?? `.tmp/live-evidence/cdp-${cdpPort}-${Date.now()}`);
fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
const records = [];
const check = (ok, name, detail) => records.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (text) => String(text ?? '').replace(/[A-Za-z]:\\Users\\[^\\]+/g, '%USERPROFILE%').replace(/\/Users\/[^/]+/g, '%USERPROFILE%');

const tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const prefix = values['page-url-prefix'];
const target = tabs.find((tab) => tab.type === 'page' && (!prefix || tab.url.startsWith(prefix)) && !tab.url.startsWith('devtools://'));
if (!target) throw new Error(`No page target on CDP ${cdpPort}: ${JSON.stringify(tabs.map((tab) => tab.url))}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let seq = 0;
const requests = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && requests.has(message.id)) {
    const pending = requests.get(message.id);
    requests.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  }
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP timeout ' + method)); }, 20000);
  requests.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
const invoke = (command, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}${args ? ', ' + JSON.stringify(args) : ''}).then(v => ({ ok: true, value: v }), e => ({ ok: false, error: String(e) }))`);
const screenshots = [];
async function shot(name) {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(file);
}
const badge = "document.getElementById('a4note-live-dev-badge')";

const report = { at: new Date().toISOString(), cdpPort, pageUrl: target.url, title: target.title };
try {
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  for (let i = 0; i < 100 && !(await ev(`${badge} && ${badge}.dataset.state !== 'checking'`)); i++) await pause(200);
  report.badge = await ev(`(() => { const b = ${badge}; return b ? { state: b.dataset.state, text: b.textContent, rect: b.getBoundingClientRect().toJSON() } : null; })()`);
  report.viewport = await ev('({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })');
  report.htmlDataset = await ev('({ ...document.documentElement.dataset })');
  check(report.badge, 'environment strip present');
  const expectedMode = values['expect-mode'];
  const verdict = await invoke('get_dev_environment');
  report.verdict = verdict;
  check(verdict.ok, 'get_dev_environment answers');
  if (verdict.ok) {
    check(verdict.value.mode === expectedMode, `native mode is ${expectedMode}`, verdict.value.mode);
    if (values['expect-instance']) check(verdict.value.instance === values['expect-instance'], `native instance is ${values['expect-instance']}`, verdict.value.instance);
    if (expectedMode === 'isolated') check(verdict.value.identifier !== 'app.aster.research', 'identity is not the production install', verdict.value.identifier);
    check(!/[A-Za-z]:\\Users\\|\/Users\//.test(JSON.stringify(verdict.value)), 'verdict carries no user directory');
  }
  if (expectedMode === 'isolated') {
    check(report.badge?.state === 'verified', 'strip state is verified', report.badge?.state);
    check(report.badge?.text.includes('独立测试库') && report.badge?.text.includes('原生已核验'), 'strip claims isolation only with native verification wording', report.badge?.text);
    check(report.htmlDataset?.a4noteDevInstance === verdict.value?.identifier, 'html dataset carries the verified identity');
  } else {
    check(report.badge?.state === 'blocked' || report.badge?.state === 'error', 'strip is red for a blocked instance', report.badge?.state);
    check(await ev("document.getElementById('root')?.inert === true"), 'blocked page is inert');
  }
  const paths = await invoke('get_aster_paths');
  report.paths = paths.ok ? { root: redact(paths.value.root), database: redact(paths.value.database) } : { error: redact(paths.error) };
  if (expectedMode === 'isolated') {
    check(paths.ok, 'get_aster_paths works for an isolated instance');
    if (paths.ok) {
      check(paths.value.root.replaceAll('/', '\\').includes(`\\${verdict.value.identifier}\\AsterData`), 'library root lives under the dev identity', report.paths.root);
      check(!paths.value.root.replaceAll('/', '\\').includes('\\app.aster.research\\'), 'library root is not the production folder');
    }
  } else {
    check(!paths.ok, 'get_aster_paths is refused for a blocked instance', report.paths);
    if (!paths.ok) check(/DEV 隔离校验失败/.test(paths.error), 'refusal message names the isolation gate', redact(paths.error));
  }
  const capture = await invoke('capture_control', { request: { action: 'status' } });
  report.capture = capture.ok ? capture.value : { error: redact(capture.error) };
  if (expectedMode === 'isolated' && capture.ok) check(capture.value?.enabled === false, 'browser capture is disabled for the dev identity');
  const diagnostics = await invoke('get_app_diagnostics');
  report.diagnostics = diagnostics.ok ? { identifier: diagnostics.value.identifier, product_name: diagnostics.value.product_name, data_root: redact(diagnostics.value.data_root) } : { error: redact(diagnostics.error) };
  if (expectedMode === 'isolated' && diagnostics.ok) check(diagnostics.value.identifier === verdict.value.identifier, 'diagnostics panel reports the real runtime identifier', diagnostics.value.identifier);

  if (values['write-marker']) {
    const created = await invoke('create_folder', { request: { name: values['write-marker'], parentId: null } });
    report.marker = created.ok ? { created: values['write-marker'] } : { error: redact(created.error) };
    check(created.ok, `marker folder ${values['write-marker']} created in this instance`, report.marker);
  }
  if (values['expect-no-folder'] || values['expect-folder']) {
    const folders = await invoke('list_folders');
    const names = folders.ok ? (Array.isArray(folders.value) ? folders.value : folders.value?.folders ?? []).map((folder) => folder.name) : null;
    report.folders = names ?? { error: redact(folders.error) };
    if (values['expect-no-folder']) check(names && !names.includes(values['expect-no-folder']), `folder ${values['expect-no-folder']} is NOT visible here (no shared library)`, names);
    if (values['expect-folder']) check(names && names.includes(values['expect-folder']), `folder ${values['expect-folder']} is visible here`, names);
  }

  await shot('01-initial');
  // Main scenes: click the top-level scene buttons we can find and record whether the strip stays put.
  const sceneButtons = await ev(`Array.from(document.querySelectorAll('button, [role=tab]')).filter(el => /^(文献库|阅读|笔记|总览|设置|任务|AI)$/.test((el.textContent || '').trim()) || /^(文献库|阅读|笔记|总览|设置|任务)$/.test(el.getAttribute('aria-label') || '')).map(el => (el.textContent || el.getAttribute('aria-label') || '').trim()).filter((v, i, a) => a.indexOf(v) === i)`);
  report.sceneButtons = sceneButtons;
  let index = 2;
  for (const label of sceneButtons.slice(0, 6)) {
    await ev(`(() => { const el = Array.from(document.querySelectorAll('button, [role=tab]')).find(el => (el.textContent || '').trim() === ${JSON.stringify(label)} || (el.getAttribute('aria-label') || '').trim() === ${JSON.stringify(label)}); if (el) el.click(); return !!el; })()`);
    await pause(700);
    const still = await ev(`(() => { const b = ${badge}; if (!b) return null; const r = b.getBoundingClientRect(); const previous = b.style.pointerEvents; b.style.pointerEvents = 'auto'; const hit = document.elementFromPoint(Math.round(r.left + 20), Math.round(r.top + r.height / 2)); b.style.pointerEvents = previous; return { state: b.dataset.state, bottom: Math.round(r.bottom), inner: innerHeight, covered: hit === b || b.contains(hit) }; })()`);
    check(still && still.state === report.badge.state && still.bottom === still.inner && still.covered, `strip visible and unobscured in scene ${label}`, still);
    await shot(`${String(index++).padStart(2, '0')}-scene-${label}`);
  }
  // Emulated small window (min supported 980×680) and a wide one.
  for (const [width, height] of [[980, 680], [1600, 900]]) {
    await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await pause(500);
    const geometry = await ev(`(() => { const b = ${badge}.getBoundingClientRect(); const root = document.getElementById('root').getBoundingClientRect(); return { badgeTop: Math.round(b.top), badgeBottom: Math.round(b.bottom), rootBottom: Math.round(root.bottom), inner: innerHeight }; })()`);
    check(geometry.rootBottom <= geometry.badgeTop && geometry.badgeBottom === geometry.inner, `strip reserved below #root at ${width}×${height}`, geometry);
    await shot(`${String(index++).padStart(2, '0')}-viewport-${width}x${height}`);
  }
  await rpc('Emulation.clearDeviceMetricsOverride');
} catch (error) {
  records.push({ name: 'Execution failure', passed: false, error: String(error), stack: error.stack });
} finally {
  report.records = records;
  report.screenshots = screenshots;
  report.passed = records.filter((r) => r.passed).length;
  report.failed = records.filter((r) => !r.passed).length;
  fs.writeFileSync(path.join(evidence, 'runtime-report.json'), JSON.stringify(report, null, 2));
  ws.close();
  console.log(JSON.stringify({ evidence, passed: report.passed, failed: report.failed, badge: report.badge?.text, mode: report.verdict?.value?.mode, failures: records.filter((r) => !r.passed).map((r) => ({ name: r.name, detail: r.detail, error: r.error })) }, null, 2));
  if (report.failed) process.exitCode = 1;
}
