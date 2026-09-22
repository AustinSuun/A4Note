// Isolated Chromium geometry contract for the annotation dock layer entry (f3878879).
// Real component + the REAL application cascade, including legacy reader.css: there
// `.annotation-tool-slot` is flex-direction: column, and the old entry rule
// (`flex: 0 0 64px` + `border-left`) sized the entry's flex-basis on the vertical axis,
// producing a 64px-tall square that inflated the whole toolbar by ~28px. Every geometry
// assertion below fails on that old layout and passes on the fixed one.
// Scope: DOM geometry and computed style in headless Chrome. Not native persistence or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const own = path.resolve('.tmp/layer-toolbar-geometry');
const run = 'geometry-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.a4-tests/layer-toolbar-geometry', run);
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
async function wait(expression, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try { if (await ev(expression)) return true; } catch { /* page may still be loading */ }
    await pause(120);
  }
  throw Error('Timed out ' + expression);
}
async function click(selector) {
  await ev(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw Error('missing ' + ${JSON.stringify(selector)}); node.click(); return true })()`);
  await pause(160);
}
async function shot(name) {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(file);
}
const watchdog = setTimeout(() => {
  try { fs.writeFileSync(path.join(evidence, 'watchdog.json'), JSON.stringify({ stages, records, screenshots }, null, 2)); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  process.exit(2);
}, 900000);

const GEOMETRY = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const info = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { rect: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }, height: cs.height, width: cs.width, minHeight: cs.minHeight, flex: cs.flex, display: cs.display, flexDirection: cs.flexDirection, borderLeftWidth: cs.borderLeftWidth, marginLeft: cs.marginLeft, borderRadius: cs.borderRadius, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth, borderBottomWidth: cs.borderBottomWidth, overflowX: cs.overflowX } };
  const layer = document.querySelector('.annotation-layer-btn');
  const layerSlot = layer ? layer.closest('.annotation-tool-slot') : null;
  const peer = document.querySelector('[data-test-tool="cursor"]');
  const shortcut = document.querySelector('[data-test-tool="shortcut"]');
  const peerSlot = peer ? peer.closest('.annotation-tool-slot') : null;
  const toolbar = document.querySelector('.annotation-toolbar');
  const dock = document.querySelector('.reader-annotation-dock');
  return { layer: info(layer), layerSlot: info(layerSlot), peer: info(peer), peerSlot: info(peerSlot), shortcut: info(shortcut), toolbar: info(toolbar), dock: info(dock), count: layer ? layer.getAttribute('data-layer-total') : null, countText: layer ? (layer.querySelector('.annotation-layer-btn-count')?.textContent ?? null) : null, clip: layer ? { scrollW: layer.scrollWidth, clientW: layer.clientWidth } : null, viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }, rootZoom: getComputedStyle(document.documentElement).zoom, theme: document.documentElement.dataset.theme || null };
})()`;
const closePicker = async () => { if (await ev(`!!document.querySelector('.annotation-layer-picker')`)) { await click('.annotation-layer-btn'); await wait(`!document.querySelector('.annotation-layer-picker')`); } };
const openPicker = async () => { if (!(await ev(`!!document.querySelector('.annotation-layer-picker')`))) { await click('.annotation-layer-btn'); await wait(`!!document.querySelector('.annotation-layer-picker')`); } };
const reset = async (count) => { await ev(`window.geometryFixture.reset(${count}, false)`); await pause(220); };
const heightProbes = {};

try {
  fs.mkdirSync(own, { recursive: true });
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(own, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  stage('server-ready');
  const port = server.httpServer.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  for (let i = 0; i < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); i += 1) await pause(100);
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
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push({ text: (message.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
    }
  });
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: 'http://127.0.0.1:' + port + '/tests/fixtures/layer-toolbar-geometry.html' });
  await wait('!!document.querySelector(".annotation-layer-btn")', 1800);
  stage('fixture-ready');

  // 1. Equal height and vertical alignment with the same-row tool buttons (fails on the old 64px square).
  const base = await ev(GEOMETRY);
  heightProbes.base = base;
  check(base.layer && base.peer && base.shortcut, 'fixture renders the entry, peer tools and the shortcut neighbour', { count: base.count, viewport: base.viewport });
  check(Math.abs(base.layer.rect.h - base.peer.rect.h) <= 1, 'layer entry height equals the peer tool height within 1 CSS px', { layer: base.layer.rect.h, peer: base.peer.rect.h });
  check(Math.abs(base.layer.rect.y - base.peer.rect.y) <= 1, 'layer entry top edge aligns with the peer tool within 1 CSS px', { layer: base.layer.rect.y, peer: base.peer.rect.y });
  check(Math.abs(base.layer.rect.y + base.layer.rect.h - (base.peer.rect.y + base.peer.rect.h)) <= 1, 'layer entry bottom edge aligns with the peer tool within 1 CSS px', {});
  check(Math.abs(base.layer.rect.h - base.shortcut.rect.h) <= 1 && Math.abs(base.layer.rect.y - base.shortcut.rect.y) <= 1, 'layer entry also matches the shortcut settings button', { layer: base.layer.rect.h, shortcut: base.shortcut.rect.h });
  check(base.layer.width !== base.peer.width, 'layer entry keeps its own stable width (icon + count chip)', { layer: base.layer.width, peer: base.peer.width });
  await shot('geometry-base');

  // 2. The wrapper never expands the toolbar (fails when the slot grows to the entry height).
  check(base.layerSlot.rect.h <= base.peerSlot.rect.h + 1, 'the layer slot wrapper is not taller than a peer slot', { layerSlot: base.layerSlot.rect.h, peerSlot: base.peerSlot.rect.h });
  const chromeY = base.peer.rect.h + parseFloat(base.toolbar.paddingTop) + parseFloat(base.toolbar.paddingBottom) + parseFloat(base.toolbar.borderTopWidth) + parseFloat(base.toolbar.borderTopWidth);
  check(base.toolbar.rect.h <= chromeY + 1, 'toolbar height stays at button height plus its own padding and border', { toolbar: base.toolbar.rect.h, expected: chromeY });
  const withoutEntry = await (async () => { await ev(`document.querySelector('.annotation-layer-slot').style.display='none'`); await pause(140); const g = await ev(GEOMETRY); await ev(`document.querySelector('.annotation-layer-slot').style.display=''`); await pause(140); return g; })();
  check(Math.abs(base.toolbar.rect.h - withoutEntry.toolbar.rect.h) < 0.5, 'removing the layer entry does not change the toolbar height', { withEntry: base.toolbar.rect.h, withoutEntry: withoutEntry.toolbar.rect.h });

  // 3. No leftover container styling on the left of the entry (fails on border-left + margin + 8px radius).
  check(base.layer.borderLeftWidth === '0px', 'layer entry has no left border remnant', base.layer.borderLeftWidth);
  check(base.layer.marginLeft === '0px', 'layer entry carries no leftover left margin', base.layer.marginLeft);
  check(base.layer.borderRadius === base.peer.borderRadius, 'layer entry radius matches the tool buttons', { layer: base.layer.borderRadius, peer: base.peer.borderRadius });
  check(base.layerSlot.borderLeftWidth === '0px' && base.layerSlot.marginLeft === '0px', 'the slot wrapper adds no border or margin either', {});

  // 4. Stability across counts 1/2/12 and a long active layer name.
  const widthBase = base.layer.rect.w;
  const shortcutLeft = base.shortcut.rect.x;
  for (const count of [1, 2, 12]) {
    await reset(count);
    const g = await ev(GEOMETRY);
    heightProbes['count' + count] = g;
    check(g.countText === `${count}/${count}`, `count ${count}/${count} renders in the entry`, g.countText);
    check(Math.abs(g.layer.rect.w - widthBase) < 0.5 && Math.abs(g.toolbar.rect.h - base.toolbar.rect.h) < 0.5, `geometry is stable at ${count}/${count}`, { w: g.layer.rect.w, toolbar: g.toolbar.rect.h });
    check(Math.abs(g.layer.rect.h - g.peer.rect.h) <= 1, `entry stays peer-height at ${count}/${count}`, { layer: g.layer.rect.h, peer: g.peer.rect.h });
  }
  await ev('window.geometryFixture.renameActive("超长活动图层名称 abcdefghijklmnop 1234567890 emoji")');
  await pause(220);
  const renamed = await ev(GEOMETRY);
  check(Math.abs(renamed.layer.rect.w - widthBase) < 0.5 && Math.abs(renamed.shortcut.rect.x - shortcutLeft) < 0.5, 'a long layer name moves neither the entry nor its neighbours', { w: renamed.layer.rect.w, shortcut: renamed.shortcut.rect.x });
  check(renamed.clip.scrollW <= renamed.clip.clientW, 'the count chip is not horizontally clipped', renamed.clip);
  await shot('geometry-long-name');

  // 5. State stability: hover, keyboard focus, popover open.
  const center = await ev(`(() => { const r = document.querySelector('.annotation-layer-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`);
  await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
  await pause(260);
  const hover = await ev(GEOMETRY);
  heightProbes.hover = hover;
  check(Math.abs(hover.layer.rect.h - base.layer.rect.h) < 0.5 && Math.abs(hover.toolbar.rect.h - base.toolbar.rect.h) < 0.5, 'hover does not change the geometry', {});
  await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await pause(160);

  await ev('document.activeElement && document.activeElement.blur()');
  for (let i = 0; i < 40; i += 1) {
    const at = await ev(`(() => { const e = document.activeElement; return e && e !== document.body ? String(e.className) : null })()`);
    if (at && at.includes('annotation-layer-btn')) break;
    await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await pause(90);
  }
  const focusState = await ev(`(() => { const b = document.querySelector('.annotation-layer-btn'); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return { focused: document.activeElement === b, focusVisible: b.matches(':focus-visible'), outline: cs.outlineWidth + ' ' + cs.outlineStyle, h: Math.round(r.height * 100) / 100 }; })()`);
  check(focusState.focused, 'keyboard Tab reaches the layer entry', focusState);
  check(focusState.focusVisible && parseFloat(focusState.outline) > 0, 'the focused entry keeps a visible focus outline', focusState);
  check(Math.abs(focusState.h - base.layer.rect.h) < 0.5, 'focus does not change the entry height', focusState);
  await shot('geometry-focus');

  await openPicker();
  await pause(260);
  const open = await ev(GEOMETRY);
  heightProbes.popoverOpen = open;
  check(Math.abs(open.layer.rect.h - base.layer.rect.h) < 0.5 && Math.abs(open.toolbar.rect.h - base.toolbar.rect.h) < 0.5, 'opening the popover does not change the dock geometry', {});
  await shot('geometry-popover-open');
  await closePicker();

  // 6. Themes and UI zoom keep the equal-height contract.
  await ev(`document.documentElement.dataset.theme='midnight'`);
  await pause(260);
  const dark = await ev(GEOMETRY);
  heightProbes.dark = dark;
  check(Math.abs(dark.layer.rect.h - dark.peer.rect.h) <= 1 && Math.abs(dark.toolbar.rect.h - base.toolbar.rect.h) < 0.5, 'midnight theme keeps the geometry', { layer: dark.layer.rect.h, peer: dark.peer.rect.h });
  await shot('geometry-midnight');
  await ev(`delete document.documentElement.dataset.theme`);
  await pause(200);
  for (const zoom of [125, 150]) {
    await ev(`document.documentElement.style.zoom='${zoom}%'`);
    await pause(300);
    const g = await ev(GEOMETRY);
    heightProbes['zoom' + zoom] = g;
    check(Math.abs(g.layer.rect.h - g.peer.rect.h) <= 1.5, `UI zoom ${zoom}% keeps the entry at peer height`, { layer: g.layer.rect.h, peer: g.peer.rect.h, rootZoom: g.rootZoom });
    check(Math.abs(g.layer.rect.y - g.peer.rect.y) <= 1.5, `UI zoom ${zoom}% keeps the vertical alignment`, {});
    await ev(`document.documentElement.style.zoom=''`);
    await pause(220);
  }

  // 7. Narrow window: no horizontal overflow, no height jump, entry not clipped.
  await rpc('Emulation.setDeviceMetricsOverride', { width: 460, height: 800, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  const narrow = await ev(GEOMETRY);
  heightProbes.narrow = narrow;
  check(narrow.dock.rect.w <= narrow.viewport.w - 20 || narrow.toolbar.overflowX !== 'visible', 'a 460px window keeps the dock inside the viewport', { dock: narrow.dock.rect.w, viewport: narrow.viewport.w });
  check(Math.abs(narrow.layer.rect.h - narrow.peer.rect.h) <= 1, 'the entry stays peer-height in a narrow window', { layer: narrow.layer.rect.h, peer: narrow.peer.rect.h });
  check(narrow.clip.scrollW <= narrow.clip.clientW, 'the count chip is not clipped in a narrow window', narrow.clip);
  await shot('geometry-narrow-460');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await pause(300);

  // 8. Functional smoke: popover, selection, visibility count, Esc.
  await reset(2);
  await openPicker();
  await ev('window.geometryFixture.clearLog()');
  await click('.annotation-layer-row[data-layer-id="layer-2"] .annotation-layer-select');
  await pause(200);
  check((await ev('window.geometryFixture.snapshot()')).activeLayerId === 'layer-2', 'selecting a row switches the active layer', await ev('window.geometryFixture.snapshot()'));
  await click('.annotation-layer-row[data-layer-id="layer-1"] .annotation-layer-icon-btn:not(.annotation-layer-delete)');
  await pause(200);
  const afterEye = await ev(GEOMETRY);
  check(afterEye.countText === '1/2', 'the eye toggle updates the visible/total count', afterEye.countText);
  check(Math.abs(afterEye.layer.rect.h - afterEye.peer.rect.h) <= 1, 'the entry stays peer-height after the visibility change', {});
  await ev(`document.querySelector('.reader-tool-popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pause(240);
  check(!(await ev('!!document.querySelector(".annotation-layer-picker")')), 'Escape closes the popover');
  check(errors.length === 0, 'no pageerror or console error in the fixture run', errors.slice(0, 3));
  stage('all-checks');
} catch (error) {
  records.push({ name: 'driver completed without error', passed: false, detail: String(error?.message ?? error) });
} finally {
  clearTimeout(watchdog);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ run, records, screenshots, errors, heightProbes }, null, 2));
  try { await rpc('Browser.close'); } catch { /* already gone */ }
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome?.kill(); } catch { /* ignore */ }
  try { await server?.close(); } catch { /* ignore */ }
}
const passed = records.filter((record) => record.passed).length;
console.log(JSON.stringify({ run, passed, failed: records.length - passed, failures: records.filter((r) => !r.passed).map((r) => r.name), evidence }, null, 2));
process.exit(records.every((record) => record.passed) ? 0 : 1);

