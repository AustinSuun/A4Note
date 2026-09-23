// Real-DOM regression for the library paper context menu (task bab38e7e): the menu has no
// title/filename row, its first command is 阅读, the folder submenu opens with the back item,
// the screen-reader context stays on aria-label, and positioning/keyboard behaviour holds
// at the viewport edges. Evidence: .tmp/shots/library-context-menu-browser/<run>/.
//   node scripts/verify-library-context-menu-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.LIBRARY_MENU_FIXTURE || 'scripts/fixtures/library-context-menu-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>library context menu</title>'
  + '<style>body{margin:0;background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/library-context-menu-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/library-context-menu-browser', run);
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
const key = async (keyName, mods = 0) => {
  const codes = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Enter: 13, Tab: 9, Escape: 27 };
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName], modifiers: mods };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await pause(60);
};
const openAt = async (x, y) => { await ev(`window.__menuHost.openAt(${x}, ${y})`); await wait(`!!document.querySelector('.library-paper-context-menu')`); await pause(120); };
const closeMenu = async () => { await ev('window.__menuHost.close()'); await wait(`!document.querySelector('.library-paper-context-menu')`); };
const menuState = () => ev(`(()=>{const m=document.querySelector('.library-paper-context-menu');if(!m)return null;const r=m.getBoundingClientRect();const items=Array.from(m.querySelectorAll('[role="menuitem"]')).map(b=>({text:b.textContent.trim(),disabled:b.disabled}));return {rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},ariaLabel:m.getAttribute('aria-label'),children:Array.from(m.children).map(c=>({tag:c.tagName,cls:c.className,role:c.getAttribute('role'),text:c.textContent.trim().slice(0,40)})),items,titleRow:!!m.querySelector('.library-context-title'),firstChildIsMenuitem:m.firstElementChild?.getAttribute('role')==='menuitem',active:document.activeElement?.textContent.trim().slice(0,30),activeInMenu:m.contains(document.activeElement),innerWidth,innerHeight}})()`);

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
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/library-context-menu-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1200,800', 'about:blank',
  ], { stdio: 'ignore' });
  for (let index = 0; index < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); index += 1) await pause(100);
  const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('#menu-trigger')`);
  await pause(150);

  /* 1. normal menu: no title row, first item 阅读, aria-label keeps the paper */
  await openAt(300, 200);
  const normal = await menuState();
  check(normal && !normal.titleRow, '菜单内没有 .library-context-title 标题行', normal?.children.slice(0, 2));
  check(normal && normal.firstChildIsMenuitem && normal.items[0]?.text === '阅读', '菜单第一个子元素就是「阅读」菜单项（无空白占位/分隔）', normal?.children.slice(0, 2));
  check(normal && !normal.children.some(child => child.role !== 'menuitem' && child.role !== 'separator'), '菜单子元素只有 menuitem 与 separator', normal?.children.map(child => child.role));
  check(normal && normal.children[0].role === 'menuitem' && normal.children[normal.children.length - 1].role === 'menuitem', '首尾都不是分隔线（无多余分隔）');
  check(normal && normal.ariaLabel === '论文操作：Mean Flows for One-step Generative Modeling with an Intentionally Very Long Title That Would Have Been Truncated in the Old Header Row', 'aria-label 仍带完整论文标题', normal?.ariaLabel);
  check(normal && JSON.stringify(normal.items.map(item => item.text)) === JSON.stringify(['阅读', '详情', '关系', '设置文件类', '编辑论文信息', '编辑标签', '打开 PDF 所在文件夹', '导入译文 PDF', '复制 BibTeX', '删除论文']), '十个操作项顺序不变', normal?.items.map(item => item.text));
  check(normal && normal.active === '阅读' && normal.activeInMenu, '打开后焦点落在首项「阅读」', normal?.active);
  check(normal && Math.abs(normal.rect.left - 300) <= 1 && Math.abs(normal.rect.top - 200) <= 1, '常规位置贴着锚点', normal?.rect);
  await shot('01-menu-no-title');

  /* 2. folder submenu: first item is the back item, no title row */
  await ev(`Array.from(document.querySelectorAll('.library-paper-context-menu [role="menuitem"]')).find(b=>b.textContent.includes('设置文件类')).click()`);
  await pause(150);
  const folder = await menuState();
  check(folder && !folder.titleRow && folder.firstChildIsMenuitem && folder.items[0]?.text === '返回论文操作', '文件夹子菜单首项为「返回论文操作」，无标题行', folder?.items.slice(0, 3));
  check(folder && folder.items.some(item => item.text.includes('生成模型 / Flow')) && folder.items.find(item => item.text.startsWith('默认资料库'))?.disabled === true, '文件夹列表含层级路径且当前文件夹禁用', folder?.items);
  check(folder && folder.active === '返回论文操作', '子菜单打开后焦点在首项', folder?.active);
  await shot('02-folder-submenu');
  await key('ArrowLeft');
  const back = await menuState();
  check(back && back.items[0]?.text === '阅读' && back.active === '阅读', 'ArrowLeft 返回主菜单并聚焦首项', back?.active);

  /* 3. keyboard: Down/Up/Home/End skip disabled, Escape closes and restores focus */
  await ev('window.__menuHost.setNoPdf(true)');
  await pause(100);
  await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
  const afterDown = await menuState();
  check(afterDown && afterDown.active === '导入译文 PDF', '方向键跳过禁用的「打开 PDF 所在文件夹」', afterDown?.active);
  await key('End');
  check((await menuState())?.active === '删除论文', 'End 到最后一项');
  await key('Home');
  check((await menuState())?.active === '阅读', 'Home 回到「阅读」');
  await key('ArrowUp');
  check((await menuState())?.active === '删除论文', 'ArrowUp 从首项环绕到末项');
  await key('Escape');
  await wait(`!document.querySelector('.library-paper-context-menu')`);
  check(await ev(`document.activeElement?.id==='menu-trigger'`), 'Escape 关闭并把焦点还给触发元素');
  await ev('window.__menuHost.setNoPdf(false)');

  /* 4. viewport edges: bottom-right anchor flips/clamps inside */
  await openAt(1180, 780);
  const corner = await menuState();
  check(corner && corner.rect.right <= corner.innerWidth - 7 && corner.rect.bottom <= corner.innerHeight - 7 && corner.rect.left >= 8 && corner.rect.top >= 8, '右下角锚点：菜单完整留在视口内', corner?.rect);
  await shot('03-corner-clamped');
  await closeMenu();
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 360, deviceScaleFactor: 1, mobile: false });
  await pause(150);
  await openAt(400, 340);
  const narrow = await menuState();
  check(narrow && narrow.rect.left >= 8 && narrow.rect.right <= narrow.innerWidth - 7 && narrow.rect.top >= 8 && narrow.rect.bottom <= narrow.innerHeight - 7 && narrow.rect.width <= narrow.innerWidth - 16, '窄窗 420×360：菜单缩进视口且可滚动', narrow?.rect);
  await shot('04-narrow-window');
  await closeMenu();
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  /* the viewport change fires a window resize, which (by design) dismisses an open menu */
  await pause(400);

  /* 5. actions run through the same callbacks; outside click closes */
  await openAt(300, 200);
  await ev(`Array.from(document.querySelectorAll('.library-paper-context-menu [role="menuitem"]')).find(b=>b.textContent.includes('复制 BibTeX')).click()`);
  await wait(`!document.querySelector('.library-paper-context-menu')`);
  check(JSON.stringify(await ev('window.__menuCalls')) === JSON.stringify(['copy']), '点击操作项触发回调并关闭菜单', await ev('window.__menuCalls'));
  await openAt(300, 200);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 600, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 600, button: 'left', clickCount: 1 });
  await wait(`!document.querySelector('.library-paper-context-menu')`);
  check(true, '点外关闭菜单');
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
