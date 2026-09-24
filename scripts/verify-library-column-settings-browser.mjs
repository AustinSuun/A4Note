// Real-DOM regression for the library column-settings popover (task ae98615a): the panel
// opens right-aligned directly under its trigger at UI zoom 100 % / 125 % / 80 %, in an
// 854×392 window and above the trigger when the space below is short; toggles report the
// right column, Esc returns focus, outside click closes; the placement helpers are checked
// as pure functions too. Evidence: .tmp/shots/library-column-settings-browser/<run>/.
//   node scripts/verify-library-column-settings-browser.mjs
import fs from 'node:fs';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.LIBRARY_COLUMNS_FIXTURE || 'scripts/fixtures/library-column-settings-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>column settings</title>'
  + '<style>body{margin:0;background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/library-column-settings-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/library-column-settings-browser', run);
const records = [];
const errors = [];
const screenshots = [];
function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let browserProcess = null, server = null, ws = null, seq = 0;
const requests = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, method === 'Browser.close' ? 5000 : 30000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const pauseAll = () => { for (const { timer } of requests.values()) clearTimeout(timer); requests.clear(); };
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception?.description || ''));
  return result.result.value;
};
const wait = async (expression, tries = 100, interval = 80) => {
  for (let index = 0; index < tries; index += 1) {
    try { if (await ev(expression)) return true; } catch { /* keep waiting */ }
    await pause(interval);
  }
  throw Error('Timed out ' + expression);
};
const shot = async (name) => {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(name);
};
const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const setZoom = zoom => ev(`(()=>{if(${zoom}===1){document.documentElement.style.zoom='';document.documentElement.style.removeProperty('--ui-zoom')}else{document.documentElement.style.zoom='${Math.round(zoom * 100)}%';document.documentElement.style.setProperty('--ui-zoom','${zoom}')}return true})()`);
const openPanel = async () => { await ev(`document.querySelector('.column-settings-trigger').click()`); await wait(`!!document.querySelector('.column-settings-panel')`); await pause(150); };
const closePanel = async () => { await ev(`(()=>{const p=document.querySelector('.column-settings-panel');if(p){document.querySelector('.column-settings-trigger').click()}return true})()`); await wait(`!document.querySelector('.column-settings-panel')`); await pause(120); };
const geometry = () => ev(`(()=>{const t=document.querySelector('.column-settings-trigger');const p=document.querySelector('.column-settings-panel');const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};return {trigger:r(t),panel:p?r(p):null,style:p?{left:p.style.left,top:p.style.top}:null,zoom:document.documentElement.style.zoom||'100%',innerWidth,innerHeight,activeInPanel:!!p&&p.contains(document.activeElement)}})()`);
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
const alignedBelow = (g) => g.panel && near(g.panel.right, g.trigger.right) && near(g.panel.top, g.trigger.bottom + 4) && g.panel.left >= 7 && g.panel.right <= g.innerWidth - 7 && g.panel.bottom <= g.innerHeight - 7;

try {
  fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'host.tsx'), fs.readFileSync(FIXTURE, 'utf8'));
  fs.writeFileSync(path.join(own, 'host.html'), HOST_HTML);
  server = await createServer({
    configFile: false, root: process.cwd(), cacheDir: path.join(own, run + '-vite-cache'), plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/.build/**', '**/.tmp/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } },
  });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/library-column-settings-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  const port = await waitForChromeDebugPort(profile);
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const entry = requests.get(message.id); clearTimeout(entry.timer); requests.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push((message.params.args || []).map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await viewport(1400, 900);
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('.column-settings-trigger')`);
  await pause(150);

  /* 1. pure placement helpers */
  const unit = await ev(`(()=>{const P=window.__placement;const t={left:1162,top:168,right:1238,bottom:200,width:76,height:32};const p={left:0,top:0,right:224,bottom:182,width:224,height:182};return {below:P.anchoredPlacement(t,p,{width:1400,height:900}),above:P.anchoredPlacement({...t,top:820,bottom:852},p,{width:1400,height:900}),clampLeft:P.anchoredPlacement({...t,left:20,right:96},p,{width:1400,height:900}),css125:P.toCssPixels({left:1014,top:204},1.25),css80:P.toCssPixels({left:1091,top:165},0.8),point:P.pointPlacement({x:1380,y:880},{width:268,height:400},{width:1400,height:900})}})()`);
  check(unit.below.left === 1014 && unit.below.top === 204, 'anchoredPlacement：右对齐、紧贴按钮下方 4px', unit.below);
  check(unit.above.top === 820 - 4 - 182, 'anchoredPlacement：下方不够时贴到按钮上方', unit.above);
  check(unit.clampLeft.left === 8, 'anchoredPlacement：左侧越界时钳制到 8px', unit.clampLeft);
  check(near(unit.css125.left, 811.2, 0.01) && near(unit.css80.left, 1363.75, 0.01), 'toCssPixels：视口像素 ÷ 缩放系数', { css125: unit.css125, css80: unit.css80 });
  check(unit.point.left === 1400 - 268 - 8 && unit.point.top === 880 - 400, 'pointPlacement：右下角锚点向左/向上翻转钳制', unit.point);

  /* 2. zoom 100 / 125 / 80 in the real DOM */
  for (const zoom of [1, 1.25, 0.8]) {
    await setZoom(zoom);
    await pause(200);
    await openPanel();
    const g = await geometry();
    check(alignedBelow(g), `UI 缩放 ${Math.round(zoom * 100)}%：面板右对齐紧贴按钮下方且在窗口内`, { trigger: g.trigger, panel: g.panel, style: g.style });
    check(g.activeInPanel, `UI 缩放 ${Math.round(zoom * 100)}%：打开后焦点进入面板`);
    await shot(`01-zoom-${Math.round(zoom * 100)}`);
    await closePanel();
  }
  await setZoom(1);

  /* 3. the user's 854×392 window + bottom placement */
  await viewport(854, 392);
  await pause(200);
  await openPanel();
  const narrow = await geometry();
  check(alignedBelow(narrow) && narrow.panel.right <= 854 - 7, '854×392 窗口：面板紧贴按钮下方，无横向空档', { trigger: narrow.trigger, panel: narrow.panel });
  check(narrow.trigger.right - narrow.panel.right < 2 && narrow.panel.left > narrow.trigger.left - 200, '面板与按钮水平距离在自身宽度内（不再偏到左侧）', { gap: narrow.trigger.left - narrow.panel.left });
  await shot('02-window-854x392');
  await closePanel();
  await ev('window.__columnHost.setBottom(true)');
  await pause(200);
  await openPanel();
  const above = await geometry();
  check(above.panel && near(above.panel.bottom, above.trigger.top - 4) && above.panel.top >= 7 && near(above.panel.right, above.trigger.right), '底部空间不足时面板贴在按钮上方', { trigger: above.trigger, panel: above.panel });
  await shot('03-flip-above');
  await closePanel();
  await ev('window.__columnHost.setBottom(false)');
  await viewport(1400, 900);
  await pause(300);

  /* 4. toggles, fixed title, Esc focus return, outside click */
  await openPanel();
  const boxes = await ev(`Array.from(document.querySelectorAll('.column-settings-panel label')).map(l=>({text:l.textContent.trim(),disabled:l.querySelector('input').disabled,checked:l.querySelector('input').checked}))`);
  check(boxes[0].text.startsWith('标题') && boxes[0].disabled && boxes.length === 5, '标题固定禁用，其余四列可勾选', boxes);
  await ev(`Array.from(document.querySelectorAll('.column-settings-panel label')).find(l=>l.textContent.includes('年份')).querySelector('input').click()`);
  await pause(120);
  const calls = await ev('window.__columnCalls');
  check(JSON.stringify(calls) === JSON.stringify([['year', false]]) && (await ev(`!!document.querySelector('.column-settings-panel')`)), '取消勾选「年份」上报 onChange(year,false) 且面板保持打开', calls);
  await ev(`Array.from(document.querySelectorAll('.column-settings-panel label')).find(l=>l.textContent.includes('年份')).querySelector('input').click()`);
  await pause(120);
  check(JSON.stringify(await ev('window.__columnCalls')) === JSON.stringify([['year', false], ['year', true]]), '重新勾选上报 onChange(year,true)');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!document.querySelector('.column-settings-panel')`);
  check(await ev(`document.activeElement===document.querySelector('.column-settings-trigger') && document.querySelector('.column-settings-trigger').getAttribute('aria-expanded')==='false'`), 'Esc 关闭面板并把焦点还给「列设置」按钮');
  await openPanel();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 600, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 600, button: 'left', clickCount: 1 });
  await wait(`!document.querySelector('.column-settings-panel')`);
  check(true, '点外关闭面板');
  await openPanel();
  await ev(`document.querySelector('.column-settings-trigger').click()`);
  await wait(`!document.querySelector('.column-settings-panel')`);
  check(true, '再次点击触发按钮关闭面板');
  check(errors.length === 0, '无 pageerror / console error', errors.slice(0, 3));
} catch (error) {
  check(false, '执行失败', String(error && error.stack || error));
} finally {
  pauseAll();
  try { if (ws) await send('Browser.close'); } catch { /* ignore */ }
  try { browserProcess?.kill(); } catch { /* ignore */ }
  try { await server?.close(); } catch { /* ignore */ }
}
const failed = records.filter(record => !record.passed);
const result = { evidence, passed: records.length - failed.length, total: records.length, failed, screenshots, errors };
fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ ...result, records }, null, 2));
console.log(JSON.stringify({ evidence, failed, passed: result.passed, total: result.total }, null, 2));
process.exit(failed.length ? 1 : 0);
