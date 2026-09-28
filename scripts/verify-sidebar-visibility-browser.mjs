// Real-DOM regression for task 6f9e0947: after the viewport narrows past the
// sidebar breakpoint the title bar toggle, aria state and back-to-scenes action
// must follow what is actually on screen; clicking "展开侧栏" opens an overlay
// drawer that can be used, Esc / clicking the content closes it, and widening
// restores the side-by-side layout without rewriting the persisted preference.
// Repeated under root zoom 125% and the reported 1207px @ 118% case.
// Evidence: .tmp/shots/sidebar-visibility-browser/<run>/.
//   node scripts/verify-sidebar-visibility-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';

const FIXTURE = process.env.SIDEBAR_VISIBILITY_FIXTURE || 'scripts/fixtures/workbench-sidebar-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>sidebar visibility</title>'
  + '<style>html,body,#root{height:100%;margin:0}body{background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/sidebar-visibility-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/sidebar-visibility-browser', run);
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
const key = async (keyName) => {
  const codes = { Enter: 13, Escape: 27, Tab: 9 };
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName] };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await pause(80);
};
const click = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click();return true})()`);
const viewport = async (width, height = 860) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await pause(420); // media change + grid/opacity transitions (.24s)
};
const settle = () => pause(380);
const calls = () => ev('window.__shellCalls.slice()');

/* What the user sees, independent of implementation details. */
const PROBE = `(()=>{
  const btn=document.querySelector('.window-titlebar-sidebar-toggle');
  const sb=document.querySelector('[data-testid="sidebar"]');
  const r=sb.getBoundingClientRect(); const cs=getComputedStyle(sb);
  const hit=document.elementFromPoint(Math.max(1,r.left+Math.min(r.width/2,120)), r.top+24);
  const onScreen=r.width>40&&r.right>40&&cs.visibility!=='hidden'&&Number(cs.opacity)>0.5&&cs.pointerEvents!=='none';
  const visible=onScreen&&!!hit&&sb.contains(hit);
  const back=[...document.querySelectorAll('.window-titlebar-leading-action-button')].find(b=>{const q=b.getBoundingClientRect();const s=getComputedStyle(b);return q.width>0&&q.height>0&&q.right<=innerWidth+1&&s.visibility!=='hidden'&&Number(s.opacity)>0.5});
  const shell=document.querySelector('.workbench-shell');
  return {label:btn.getAttribute('aria-label'),title:btn.getAttribute('title'),expanded:btn.getAttribute('aria-expanded'),icon:(btn.querySelector('svg')&&btn.querySelector('svg').getAttribute('class'))||'',
    visible,backReachable:!!back,mode:shell.dataset.sidebarMode||null,collapsedAttr:shell.dataset.sidebarCollapsed||null,
    stored:localStorage.getItem('aster.sidebarCollapsed'),innerWidth,zoom:document.documentElement.style.zoom||'100%',
    sidebar:{left:Math.round(r.left),width:Math.round(r.width)},hit:hit?(hit.className||hit.tagName):null,focus:document.activeElement&&document.activeElement.className}
})()`;
const probe = () => ev(PROBE);
const consistent = p => (p.label === '收起侧栏') === p.visible && p.title === p.label
  && p.expanded === String(p.visible) && p.icon.includes(p.visible ? 'panel-left-close' : 'panel-left-open');

async function scenario(tag, zoom) {
  await ev(`localStorage.setItem('aster.sidebarCollapsed','false')`);
  await send('Page.reload');
  await wait(`!!document.querySelector('.window-titlebar-sidebar-toggle')`);
  if (zoom) await ev(`document.documentElement.style.zoom=${JSON.stringify(zoom)}`);
  await viewport(1400);

  let p = await probe();
  check(p.visible && p.label === '收起侧栏' && consistent(p), `${tag} 1400 宽：侧栏并排显示，按钮为「收起侧栏」`, p);
  await shot(`${tag}-01-wide-docked`);

  await viewport(1000);
  p = await probe();
  check(!p.visible, `${tag} 1000 窄：侧栏自动隐藏`, p);
  check(p.label === '展开侧栏' && consistent(p), `${tag} 1000 窄：按钮文案/图标/aria-expanded 跟随实际可见性（展开侧栏）`, p);
  check(p.backReachable, `${tag} 1000 窄：返回场景仍可达`, p);
  check(p.stored === 'false', `${tag} 自动隐藏不改写持久化值`, p.stored);
  await shot(`${tag}-02-narrow-hidden`);

  await click('.window-titlebar-sidebar-toggle');
  await settle();
  p = await probe();
  check(p.visible && p.mode === 'overlay' && consistent(p), `${tag} 窄窗口点击「展开侧栏」以覆盖层展开`, p);
  check(p.stored === 'false', `${tag} 打开覆盖层不改写持久化值`, p.stored);
  const treeHit = await ev(`(()=>{const b=document.querySelector('.fixture-tree-item');if(!b)return {missing:true};const r=b.getBoundingClientRect();const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {onTop:!!h&&b.contains(h),hit:h&&h.className}})()`);
  if (treeHit.onTop) await click('.fixture-tree-item');
  const opened = (await calls()).filter(entry => entry[0] === 'open');
  check(treeHit.onTop && opened.length > 0, `${tag} 覆盖层中的文件树项位于最上层且可点击`, { treeHit, opened });
  await shot(`${tag}-03-narrow-overlay`);

  await key('Escape');
  await settle();
  p = await probe();
  check(!p.visible && p.label === '展开侧栏' && consistent(p), `${tag} Esc 收起覆盖层`, p);
  check(String(p.focus || '').includes('window-titlebar-sidebar-toggle'), `${tag} Esc 后焦点回到侧栏按钮`, p.focus);

  await click('.window-titlebar-sidebar-toggle');
  await settle();
  const scrim = await ev(`(()=>{const w=innerWidth;const h=document.elementFromPoint(w-24, innerHeight/2);if(!h)return null;h.click();return h.className})()`);
  await settle();
  p = await probe();
  check(!p.visible && consistent(p), `${tag} 点击内容区收起覆盖层`, { scrim, p });

  const backBefore = (await calls()).filter(entry => entry[0] === 'back').length;
  const backClicked = await ev(`(()=>{const b=[...document.querySelectorAll('.window-titlebar-leading-action-button')].find(x=>x.getBoundingClientRect().width>0);if(!b)return false;b.click();return true})()`);
  await settle();
  p = await probe();
  const scenesShown = await ev(`!!document.querySelector('.fixture-scene-item')`);
  check(backClicked && (await calls()).filter(entry => entry[0] === 'back').length === backBefore + 1 && p.visible && scenesShown,
    `${tag} 侧栏隐藏时点击「返回场景」：切回场景列表并展开侧栏`, { backClicked, p, scenesShown });
  await shot(`${tag}-04-narrow-back-to-scenes`);
  await click('.fixture-scene-item');
  await key('Escape');
  await settle();

  await viewport(1400);
  p = await probe();
  check(p.visible && p.mode !== 'overlay' && consistent(p) && p.stored === 'false', `${tag} 恢复 1400：并排布局恢复，持久化值仍为 false`, p);

  await click('.window-titlebar-sidebar-toggle');
  await settle();
  p = await probe();
  check(!p.visible && p.stored === 'true' && consistent(p), `${tag} 宽窗口手动收起写入持久化值`, p);
  await viewport(1000);
  p = await probe();
  check(!p.visible && p.label === '展开侧栏' && consistent(p) && p.stored === 'true', `${tag} 手动收起后变窄：仍为收起、按钮一致`, p);
  await click('.window-titlebar-sidebar-toggle');
  await settle();
  p = await probe();
  check(p.visible && consistent(p) && p.stored === 'true', `${tag} 手动收起后变窄仍可用覆盖层临时打开`, p);
  await viewport(1400);
  p = await probe();
  check(!p.visible && consistent(p) && p.stored === 'true', `${tag} 变宽后保留用户先前的收起选择`, p);
  await click('.window-titlebar-sidebar-toggle');
  await settle();
  p = await probe();
  check(p.visible && consistent(p) && p.stored === 'false', `${tag} 再次展开恢复并排`, p);
  if (zoom) await ev(`document.documentElement.style.zoom=''`);
}

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
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/sidebar-visibility-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1400,860', 'about:blank',
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
  await viewport(1400);
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('.window-titlebar-sidebar-toggle')`);

  await scenario('zoom100', '');
  await scenario('zoom125', '125%');

  /* The reported case: a 1207px window at 118% UI zoom. Whatever the engine decides
     about the breakpoint, the button must describe reality and a click must work. */
  await ev(`localStorage.setItem('aster.sidebarCollapsed','false')`);
  await send('Page.reload');
  await wait(`!!document.querySelector('.window-titlebar-sidebar-toggle')`);
  await ev(`document.documentElement.style.zoom='118%'`);
  await viewport(1207, 1025);
  let p = await probe();
  check(consistent(p), '1207px @118%：按钮与实际可见性一致', p);
  await shot('zoom118-1207-initial');
  const before = p.visible;
  await click('.window-titlebar-sidebar-toggle');
  await settle();
  p = await probe();
  check(p.visible === !before && consistent(p), '1207px @118%：点击按钮后可见性确实翻转', p);
  await shot('zoom118-1207-after-toggle');
  await ev(`document.documentElement.style.zoom=''`);

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
console.log(JSON.stringify({ evidence, failed: failed.map(f => f.name), passed: result.passed, total: result.total }, null, 2));
process.exit(failed.length ? 1 : 0);
