// Isolated Chromium contract for the annotation layer quick picker (f6b927bb); run from repo root.
// Real component + real CSS: no radio dot and a whole-row active state, the header 新图层 action,
// per-row delete with its protections (sole layer, data confirmation, move-then-delete), list
// scrolling, dock button/name decoupling, narrow window and light/dark legibility.
// Scope: DOM, computed style and focus in headless Chrome. Not native persistence or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const own = path.resolve('.tmp/annotation-layer-picker');
const run = 'picker-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.a4-tests/annotation-layer-picker', run);
fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
const profile = path.join(own, run + '-profile');
const records = [];
const screenshots = [];
const errors = [];
const stages = [];
const stage = (name) => {
  stages.push(`${new Date().toISOString()} ${name}`);
  try { fs.writeFileSync(path.join(evidence, 'stages.log'), stages.join('\n') + '\n'); } catch { /* evidence dir may not exist yet */ }
};
let server;
let chrome;
let ws;
let seq = 0;
const requests = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (ok, name, detail) => records.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });

async function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, method === 'Browser.close' ? 3000 : method === 'Page.navigate' ? 60000 : 15000);
    requests.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description ?? ''));
  return result.result?.value;
}
async function wait(expression, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { if (await ev(expression)) return true; } catch { /* page may still be loading */ }
    await pause(120);
  }
  throw Error('Timed out ' + expression);
}
async function click(selector) {
  await ev(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw Error('missing ' + ${JSON.stringify(selector)}); node.click(); return true })()`);
  await pause(150);
}
async function shot(name) {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(file);
}
const clearLog = () => ev('window.pickerFixture.clearLog()');
const readLog = () => ev('window.pickerFixture.log()');
const snapshot = () => ev('window.pickerFixture.snapshot()');
const reset = async (count, withData) => { await ev(`window.pickerFixture.reset(${count}, ${withData})`); await pause(240); };
const isOpen = () => ev(`!!document.querySelector('.annotation-layer-picker')`);
const openPicker = async () => { if (!(await isOpen())) await click('.annotation-layer-btn'); await wait(`!!document.querySelector('.annotation-layer-picker')`); };
const closePicker = async () => { if (await isOpen()) { await click('.annotation-layer-btn'); await wait(`!document.querySelector('.annotation-layer-picker')`); } };
const hasLog = (entries, expected) => entries.some((entry) => JSON.stringify(entry) === JSON.stringify(expected));
// A stuck browser or dev server must never leave the runner hanging: dump progress and exit.
const watchdog = setTimeout(() => {
  try { fs.writeFileSync(path.join(evidence, 'watchdog.json'), JSON.stringify({ stages, records, screenshots }, null, 2)); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  process.exit(2);
}, 900000);

const DOCK_METRICS = `(() => { const button = document.querySelector('.annotation-layer-btn'); const next = document.querySelector('[data-test-tool="after"]'); const rect = button.getBoundingClientRect(); return { width: Math.round(rect.width * 100) / 100, text: button.textContent.trim(), nameSpans: document.querySelectorAll('.annotation-layer-btn-name').length, nextLeft: Math.round(next.getBoundingClientRect().left * 100) / 100 } })()`;
const ROW_STYLE = `(() => { const row = document.querySelector('.annotation-layer-row.active'); const name = row.querySelector('.annotation-layer-name'); const style = getComputedStyle(row); const nameStyle = getComputedStyle(name); const parse = (value) => (value.match(/[\\d.]+/g) ?? []).map(Number); const luminance = (rgb) => { const [r, g, b] = rgb.slice(0, 3).map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }; const bgRaw = parse(style.backgroundColor); const fg = parse(nameStyle.color); const bg = bgRaw.length >= 4 && bgRaw[3] < 1 ? bgRaw.slice(0, 3).map((value) => value * bgRaw[3] + 255 * (1 - bgRaw[3])) : bgRaw; const l1 = luminance(fg); const l2 = luminance(bg); return { background: style.backgroundColor, boxShadow: style.boxShadow, weight: Number(nameStyle.fontWeight), color: nameStyle.color, contrast: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100, dotCount: document.querySelectorAll('.annotation-layer-dot').length } })()`;
const HEADER_METRICS = `(() => { const popover = document.querySelector('.reader-tool-popover'); const button = popover.querySelector('.reader-tool-popover-heading button'); const list = popover.querySelector('.annotation-layer-list'); const popoverRect = popover.getBoundingClientRect(); const buttonRect = button.getBoundingClientRect(); return { popoverScrollW: popover.scrollWidth, popoverClientW: popover.clientWidth, listScrollH: list.scrollHeight, listClientH: list.clientHeight, buttonInside: buttonRect.left >= popoverRect.left - 0.5 && buttonRect.right <= popoverRect.right + 0.5 && buttonRect.top >= popoverRect.top - 0.5 && buttonRect.bottom <= popoverRect.bottom + 0.5, buttonClipped: button.scrollWidth > button.clientWidth + 1, buttonWidth: Math.round(buttonRect.width * 100) / 100, buttonHeight: Math.round(buttonRect.height * 100) / 100, buttonText: button.textContent.trim(), rowCount: popover.querySelectorAll('.annotation-layer-row').length } })()`;

try {
  fs.mkdirSync(own, { recursive: true });
  // One shared optimize-deps cache keeps repeat runs cheap; a per-run cache re-bundles the whole
  // app on a loaded machine and was measured to stall for minutes.
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(own, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  stage('server-ready');
  const port = server.httpServer.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  for (let i = 0; i < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); i++) await pause(100);
  stage('chrome-profile');
  const cdpPort = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const tabs = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
  const target = tabs.find((tab) => tab.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  stage('ws-open');
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && requests.has(message.id)) {
      const pending = requests.get(message.id);
      requests.delete(message.id);
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails);
    }
  });
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: 'http://127.0.0.1:' + port + '/tests/fixtures/annotation-layer-picker.html' });
  // A loaded Windows host can need minutes for the first dev-server transform; wait generously
  // instead of reporting a false failure.
  await wait('!!document.querySelector(".annotation-layer-btn")', 1800);
  stage('fixture-ready');

  // 1. The dock entry is decoupled from the editable layer name and keeps a constant width.
  await closePicker();
  const baseline = await ev(DOCK_METRICS);
  check(baseline.nameSpans === 0, 'dock button renders no layer-name span', baseline);
  check(baseline.text === '12/12', 'dock button shows only the visible/total count', baseline);
  await ev('window.pickerFixture.renameActive("超长活动图层名称 abcdefghijklmnop 1234567890 🚀🚀")');
  await pause(200);
  const longName = await ev(DOCK_METRICS);
  check(Math.abs(longName.width - baseline.width) < 0.5 && Math.abs(longName.nextLeft - baseline.nextLeft) < 0.5, 'renaming the active layer moves neither the button nor its neighbours', { baseline: baseline.width, longName: longName.width, next: [baseline.nextLeft, longName.nextLeft] });
  await shot('dock-long-name');
  await reset(1, false);
  const single = await ev(DOCK_METRICS);
  check(single.text === '1/1' && Math.abs(single.width - baseline.width) < 0.5 && Math.abs(single.nextLeft - baseline.nextLeft) < 0.5, 'a 1/1 count keeps the same dock geometry', single);
  await reset(12, false);
  stage('dock-checks');

  // 2. The active layer is a whole-row state, not a radio dot.
  await openPicker();
  stage('picker-open');
  const active = await ev(ROW_STYLE);
  check(active.dotCount === 0, 'no radio dot is rendered in the layer list', active);
  check(active.background !== 'rgba(0, 0, 0, 0)' && active.boxShadow.includes('inset'), 'active layer is a whole-row tint with an inset hairline', active);
  check(active.weight >= 600, 'active layer name is emphasised', active);
  check(active.contrast >= 4.5, 'active row text keeps >= 4.5:1 contrast (light theme)', active);
  await shot('picker-12-light');

  // 3. Row activation, eye toggle and their independence.
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-5"] .annotation-layer-select');
  await pause(180);
  check(hasLog(await readLog(), ['setActiveLayer', 'layer-5']), 'clicking a row activates that layer', await readLog());
  check(await ev('document.querySelector(".annotation-layer-row.active").dataset.layerId') === 'layer-5', 'the active row class follows the selection');
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-6"] .annotation-layer-icon-btn:not(.annotation-layer-delete)');
  await pause(180);
  const eyeLog = await readLog();
  check(!eyeLog.some((entry) => entry[0] === 'setActiveLayer'), 'the eye toggle never activates the row', eyeLog);
  check(hasLog(eyeLog, ['setLayerVisible', 'layer-6', false]), 'the eye toggle hides the layer', eyeLog);
  check(await ev('document.querySelector(".annotation-layer-row[data-layer-id=\\"layer-6\\"]").classList.contains("hidden-layer")') === true, 'hidden layer gets the reduced-opacity style');

  // 4. Per-row delete: labels, spacing and the empty-layer fast path.
  const spacing = await ev(`(() => { const row = document.querySelector('.annotation-layer-row'); const eye = row.querySelector('.annotation-layer-icon-btn:not(.annotation-layer-delete)'); const remove = row.querySelector('.annotation-layer-delete'); return { gap: Math.round((remove.getBoundingClientRect().left - eye.getBoundingClientRect().right) * 100) / 100, label: remove.getAttribute('aria-label'), eyeLabel: eye.getAttribute('aria-label') } })()`);
  check(spacing.gap >= 4, 'delete button is spaced away from the eye toggle', spacing);
  check(/^删除图层「.+」$/.test(spacing.label) && spacing.label !== spacing.eyeLabel, 'delete button carries its own explicit Chinese accessible name', spacing);
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-7"] .annotation-layer-delete');
  await pause(240);
  const emptyDeleteLog = await readLog();
  check(hasLog(emptyDeleteLog, ['deleteLayer', 'layer-7', 'purge', null]), 'an empty layer deletes without a confirmation step', emptyDeleteLog);
  stage('delete-checks');
  check(await ev('document.querySelectorAll(".annotation-layer-row").length') === 11, 'the deleted row leaves the list');
  check(await ev('!!document.querySelector(".annotation-layer-confirm")') === false, 'no confirmation panel for an empty layer');

  // 5. Sole-layer protection.
  await closePicker();
  await reset(1, false);
  await openPicker();
  const sole = await ev('(() => { const remove = document.querySelector(".annotation-layer-delete"); return { disabled: remove.disabled, title: remove.title, rows: document.querySelectorAll(".annotation-layer-row").length } })()');
  check(sole.disabled === true && sole.rows === 1, 'the only remaining layer cannot be deleted', sole);
  await shot('picker-1-layer');

  // 6. Layers with data: explicit decision, cancel is safe, both resolutions work.
  await closePicker();
  await reset(6, true);
  await openPicker();
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-3"] .annotation-layer-delete');
  await wait('!!document.querySelector(".annotation-layer-confirm")');
  const confirm = await ev('(() => { const panel = document.querySelector(".annotation-layer-confirm"); return { role: panel.getAttribute("role"), label: panel.getAttribute("aria-label"), text: panel.textContent, focus: document.activeElement.className, options: panel.querySelectorAll("select option").length } })()');
  check(confirm.role === 'alertdialog' && confirm.text.includes('3 条标注') && confirm.text.includes('笔记引用'), 'a layer with annotations asks for an explicit decision', confirm);
  check(confirm.focus.includes('annotation-layer-action'), 'focus moves into the confirmation panel', confirm.focus);
  check(confirm.options === 5, 'every other layer is offered as a move target', confirm.options);
  await shot('picker-confirm');
  await click('[data-layer-confirm-cancel]');
  await pause(240);
  const cancelled = await readLog();
  check(!cancelled.some((entry) => entry[0] === 'deleteLayer'), 'cancelling keeps the layer and its annotations', cancelled);
  check((await snapshot()).count === 6, 'cancelling does not change the layer set');
  check(await ev('document.activeElement.classList.contains("annotation-layer-delete")') === true, 'focus returns to the row delete button after cancelling');
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-3"] .annotation-layer-delete');
  await wait('!!document.querySelector(".annotation-layer-confirm")');
  await click('[data-layer-confirm-move]');
  await pause(240);
  check((await readLog()).some((entry) => entry[0] === 'deleteLayer' && entry[1] === 'layer-3' && entry[2] === 'move' && entry[3] === 'layer-1'), 'move-then-delete hands the annotations to the chosen target layer', await readLog());
  check((await snapshot()).count === 5, 'the layer is gone after the move');
  await closePicker();
  await reset(6, true);
  await openPicker();
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-3"] .annotation-layer-delete');
  await wait('!!document.querySelector(".annotation-layer-confirm")');
  await click('[data-layer-confirm-purge]');
  await pause(240);
  check((await readLog()).some((entry) => entry[0] === 'deleteLayer' && entry[1] === 'layer-3' && entry[2] === 'purge'), 'confirming the purge deletes the layer with its annotations', await readLog());

  // 7. Deleting the active layer hands the active state to the nearest neighbour.
  await closePicker();
  await reset(5, false);
  await ev('window.pickerFixture.setActive("layer-3")');
  await pause(200);
  await openPicker();
  await clearLog();
  await click('.annotation-layer-row[data-layer-id="layer-3"] .annotation-layer-delete');
  await pause(280);
  const neighbourLog = await readLog();
  const neighbourState = await snapshot();
  check(neighbourLog.some((entry) => entry[0] === 'deleteLayer' && entry[1] === 'layer-3'), 'the active layer itself can be deleted', neighbourLog);
  check(neighbourState.activeLayerId === 'layer-4' && neighbourLog.some((entry) => entry[0] === 'setActiveLayer' && entry[1] === 'layer-4'), 'deleting the active layer hands over to the nearest neighbour', { log: neighbourLog, state: neighbourState });

  // 8. Twelve layers scroll; the header action stays complete and unclipped.
  await closePicker();
  await reset(12, false);
  await openPicker();
  const header = await ev(HEADER_METRICS);
  check(header.rowCount === 12, 'twelve layers are listed', header);
  check(header.listScrollH > header.listClientH, 'the list scrolls inside the popover at twelve layers', header);
  check(header.buttonInside && !header.buttonClipped && header.buttonText === '新图层', 'the header 新图层 action stays complete and inside the popover', header);
  check(header.buttonHeight >= 28 && header.buttonWidth >= 60, 'the header 新图层 action keeps a usable click target', header);
  check(header.popoverScrollW <= header.popoverClientW, 'the popover has no horizontal overflow', header);
  await shot('picker-12-scroll');
  await ev('(() => { const list = document.querySelector(".annotation-layer-list"); list.scrollTop = list.scrollHeight; return list.scrollTop > 0 })()');
  await pause(200);
  check((await ev(HEADER_METRICS)).buttonInside, 'the header stays visible while the list is scrolled to the end');

  // 9. Narrow window at 150% zoom.
  await rpc('Emulation.setDeviceMetricsOverride', { width: 460, height: 700, deviceScaleFactor: 1, mobile: false });
  await ev('document.documentElement.style.zoom = 1.5');
  await pause(320);
  await closePicker();
  await openPicker();
  const narrow = await ev(HEADER_METRICS);
  check(narrow.buttonInside && !narrow.buttonClipped, 'a 460px window at 150% zoom keeps 新图层 complete', narrow);
  check(narrow.popoverScrollW <= narrow.popoverClientW, 'a narrow window has no horizontal overflow', narrow);
  await shot('picker-narrow-z150');
  await closePicker();
  await ev('document.documentElement.style.zoom = 1');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  stage('narrow-checks');

  // 10. Midnight theme keeps the same structure and legible contrast.
  await ev('document.documentElement.dataset.theme = "midnight"');
  await pause(220);
  await openPicker();
  const dark = await ev(ROW_STYLE);
  check(dark.dotCount === 0 && dark.background !== 'rgba(0, 0, 0, 0)', 'dark theme keeps the whole-row active tint', dark);
  check(dark.contrast >= 4.5, 'active row text keeps >= 4.5:1 contrast (midnight theme)', dark);
  await shot('picker-12-dark');
  await ev('delete document.documentElement.dataset.theme');
  await pause(150);
  stage('dark-checks');

  // 11. Five layers, and the header action still creates and activates a layer.
  await closePicker();
  await reset(5, false);
  await openPicker();
  await shot('picker-5-layer');
  await clearLog();
  await click('.reader-tool-popover-heading .annotation-layer-action');
  await pause(240);
  const createdState = await snapshot();
  check(createdState.count === 6 && (await readLog()).some((entry) => entry[0] === 'createLayer'), 'the 新图层 action creates a layer', { state: createdState, log: await readLog() });
  check(createdState.activeLayerId === 'layer-6' && await ev('document.querySelector(".annotation-layer-row.active").dataset.layerId') === 'layer-6', 'the created layer becomes the active one');
  stage('create-checks');

  check(errors.length === 0, 'no runtime page exceptions', errors);
} catch (error) {
  records.push({ name: 'Execution failure', passed: false, error: String(error), stack: error.stack });
} finally {
  clearTimeout(watchdog);
  const result = {
    at: new Date().toISOString(),
    scope: 'annotation layer quick picker contract in isolated headless Chrome; not native persistence or installed acceptance',
    run,
    evidence,
    passed: records.filter((record) => record.passed).length,
    failed: records.filter((record) => !record.passed).length,
    records,
    screenshots,
  };
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  if (ws?.readyState === 1) { try { await rpc('Browser.close'); } catch { /* already gone */ } ws.close(); }
  if (chrome && !chrome.killed) chrome.kill();
  if (server) await server.close();
  console.log(JSON.stringify({ evidence, passed: result.passed, failed: result.failed, failures: records.filter((record) => !record.passed).map((record) => ({ name: record.name, error: record.error, detail: record.detail })) }, null, 2));
}
if (records.some((record) => record.passed === false)) process.exitCode = 1;
