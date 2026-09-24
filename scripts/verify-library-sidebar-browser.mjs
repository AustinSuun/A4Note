// Real-DOM regression for the library sidebar heading (task 5e3bdbd4): the top
// "文献库 / N 篇文献" row carries no FolderPlus button any more (DOM + Tab order), while the
// 文件类 section's ＋ still opens the root-level draft row and creates/cancels/retries.
// Evidence: .tmp/shots/library-sidebar-browser/<run>/.
//   node scripts/verify-library-sidebar-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.LIBRARY_SIDEBAR_FIXTURE || 'scripts/fixtures/library-sidebar-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>library sidebar</title>'
  + '<style>body{margin:0;background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/library-sidebar-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/library-sidebar-browser', run);
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
const typeText = async (text) => { for (const char of text) await send('Input.dispatchKeyEvent', { type: 'char', text: char }); await pause(40); };
const key = async (keyName) => {
  const codes = { Enter: 13, Escape: 27, Tab: 9 };
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName], ...(keyName === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await pause(60);
};
const click = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click();return true})()`);
const calls = () => ev('window.__sidebarCalls');

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
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/library-sidebar-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=900,800', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('.library-sidebar-heading')`);
  await pause(150);

  /* 1. heading: text only, no button, no empty placeholder */
  const heading = await ev(`(()=>{const h=document.querySelector('.library-sidebar-heading');const r=h.getBoundingClientRect();return {children:Array.from(h.children).map(c=>c.tagName+'.'+c.className),buttons:h.querySelectorAll('button').length,text:h.textContent.trim(),width:r.width,height:r.height,style:getComputedStyle(h).borderBottomWidth,textRight:h.firstElementChild.getBoundingClientRect().right,headingRight:r.right}})()`);
  check(heading.buttons === 0 && heading.children.length === 1 && heading.children[0].startsWith('DIV'), '顶部标题行只剩文字容器，没有按钮', heading.children);
  check(heading.text.includes('文献库') && heading.text.includes('2 篇文献'), '标题与篇数仍显示', heading.text);
  check(heading.height >= 30 && heading.style === '1px', '标题行高度与分割线保持', { height: heading.height, border: heading.style });
  check(!(await ev(`!!document.querySelector('[aria-label="新建文件夹"], [title="新建文件夹"]')`)), 'DOM 中没有顶部「新建文件夹」按钮', null);
  const tabOrder = await ev(`Array.from(document.querySelectorAll('.library-scene-sidebar button, .library-scene-sidebar [tabindex="0"]')).filter(e=>!e.disabled).map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,12))`);
  check(!tabOrder.includes('新建文件夹') && tabOrder.includes('新建文件类'), 'Tab 序列无顶部新建按钮，保留「新建文件类」', tabOrder.slice(0, 6));
  await shot('01-heading-without-plus');

  /* 2. 文件类 ＋ still creates a root folder */
  await click('[aria-label="新建文件类"]');
  await wait(`!!document.querySelector('.library-folder-draft input')`);
  const draft = await ev(`(()=>{const d=document.querySelector('.library-folder-draft');const i=d.querySelector('input');return {label:d.getAttribute('aria-label'),value:i.value,focused:document.activeElement===i,inTree:!!d.closest('.library-sidebar-folder-tree')}})()`);
  check(draft.focused && draft.inTree && draft.label.includes('新建文件夹'), '点击「新建文件类」后根级出现聚焦的新建行', draft);
  await ev(`(()=>{const i=document.querySelector('.library-folder-draft input');i.focus();i.select();return true})()`);
  await typeText('回归测试夹');
  await key('Enter');
  await wait(`Array.from(document.querySelectorAll('.library-sidebar-folder-tree [role="treeitem"], .library-sidebar-folder-tree .file-tree-row')).some(r=>r.textContent.includes('回归测试夹'))`);
  const created = (await calls()).filter(entry => entry[0] === 'create');
  check(created.length === 1 && created[0][1] === '回归测试夹' && created[0][2] === 'library', 'onCreateFolder 收到名称与根级父目录', created);
  check(!(await ev(`!!document.querySelector('.library-folder-draft')`)), '创建成功后草稿行关闭');
  await shot('02-root-folder-created');

  /* 3. cancel + failure keeps the draft for retry */
  await click('[aria-label="新建文件类"]');
  await wait(`!!document.querySelector('.library-folder-draft input')`);
  await key('Escape');
  await wait(`!document.querySelector('.library-folder-draft')`);
  check(true, 'Esc 取消草稿行');
  await ev('window.__sidebarHost.setFailNext(true)');
  await click('[aria-label="新建文件类"]');
  await wait(`!!document.querySelector('.library-folder-draft input')`);
  await ev(`(()=>{const i=document.querySelector('.library-folder-draft input');i.focus();i.select();return true})()`);
  await typeText('失败重试');
  await click('.library-folder-draft .tree-edit-confirm');
  await wait(`!!document.querySelector('.library-folder-draft [role="alert"], .file-tree-hint.error, .library-folder-draft-message')`);
  const failed = await ev(`(()=>{const d=document.querySelector('.library-folder-draft');return {draftStillOpen:!!d,value:d?.querySelector('input')?.value,error:(document.querySelector('.library-folder-draft [role="alert"], .file-tree-hint.error')?.textContent||'').trim()}})()`);
  check(failed.draftStillOpen && failed.value === '失败重试' && failed.error.includes('失败'), '创建失败时草稿保留可重试并显示错误', failed);
  await key('Enter');
  await wait(`!document.querySelector('.library-folder-draft')`);
  check((await calls()).filter(entry => entry[0] === 'create').length === 3, '重试后再次调用 onCreateFolder', (await calls()).filter(entry => entry[0] === 'create').length);
  await shot('03-retry-after-failure');

  /* 4. narrow + zoom: heading still intact */
  await ev(`document.documentElement.style.zoom='150%'`);
  await pause(200);
  const zoomed = await ev(`(()=>{const h=document.querySelector('.library-sidebar-heading');const r=h.getBoundingClientRect();return {buttons:h.querySelectorAll('button').length,right:r.right,innerWidth}})()`);
  check(zoomed.buttons === 0 && zoomed.right <= zoomed.innerWidth, '150% 缩放下标题行无按钮且不溢出', zoomed);
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
console.log(JSON.stringify({ evidence, failed, passed: result.passed, total: result.total }, null, 2));
process.exit(failed.length ? 1 : 0);
