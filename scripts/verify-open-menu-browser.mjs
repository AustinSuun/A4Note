// Real-DOM regression for task bcabb18d: the title bar「打开 ▾」button exists only
// while the active tab is a concrete file, and every item acts on that file.
//  - md open → button present, tooltip = path, reveal_path receives the md path,
//    VS Code opens the md file itself;
//  - overview / library list / no tab / file without a path → no button in the DOM;
//  - board → button present, "在 VS Code 中打开" hidden, reveal gets the board path;
//  - library paper → reveal_paper_file(paper id, file id);
//  - switching tabs closes an open menu; closing the last file tab removes the button;
//  - collapsing the sidebar changes nothing.
// Fails on the pre-fix code (button everywhere, reveal → project root).
// Evidence: .tmp/shots/open-menu-browser/<run>/.
//   node scripts/verify-open-menu-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';

const FIXTURE = process.env.OPEN_MENU_FIXTURE || 'scripts/fixtures/open-menu-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>open menu</title>'
  + '<style>html,body,#root{height:100%;margin:0}body{background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/open-menu-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/open-menu-browser', run);
const records = [];
const errors = [];
const screenshots = [];
function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const ROOT = 'D:\\Fixture\\研究笔记';
const MD = `${ROOT}\\notes\\读书笔记.md`;
const BOARD = `${ROOT}\\未命名白板.a4board`;
const DEEP = `${ROOT}\\资料 目录\\第一层 很长的目录名称\\第二层 很长的目录名称\\第三层\\一个相当长的笔记文件名称用于测试.md`;

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
const settle = () => pause(160);
const click = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click();return true})()`);
const openTab = async (id) => { await click(`[data-open="${id}"]`); await settle(); };
const ipc = () => ev('window.__ipc.slice()');
const clearIpc = () => ev('(window.__ipc.length=0,true)');

const PROBE = `(()=>{
  const t=document.querySelector('.workbench-open-trigger');
  const panel=document.querySelector('.workbench-open-menu-panel');
  return {present:!!t,disabled:t?t.disabled:null,title:t?t.getAttribute('title'):null,dataPath:t?t.getAttribute('data-path'):null,
    aria:t?t.getAttribute('aria-label'):null,kind:(document.querySelector('.workbench-open-menu')||{dataset:{}}).dataset.openKind||null,
    menuOpen:!!panel,items:panel?[...panel.querySelectorAll('[role=menuitem]')].map(b=>b.textContent.replace('</>','').trim()):[],
    active:window.__fixture&&window.__fixture.activeId}
})()`;
const probe = () => ev(PROBE);
const openMenu = async () => { await click('.workbench-open-trigger'); await settle(); return probe(); };
const clickItem = async (text) => {
  const clicked = await ev(`(()=>{const b=[...document.querySelectorAll('.workbench-open-menu-panel [role=menuitem]')].find(x=>x.textContent.replace('</>','').trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`);
  await settle();
  return clicked;
};
const width = text => [...text].reduce((sum, char) => sum + (char.codePointAt(0) >= 0x2e80 ? 2 : 1), 0);
const absent = p => !p.present && !p.menuOpen;

async function scenarios() {
  let p = await probe();
  check(absent(p), '总览（场景页）：「打开」按钮不在 DOM 中（不是禁用、不是占位）', p);
  await shot('01-overview-no-button');

  await openTab('library');
  p = await probe();
  check(absent(p), '文献库列表：「打开」按钮不在 DOM 中', p);
  await shot('02-library-no-button');

  await openTab('md');
  p = await probe();
  check(p.present && !p.disabled, '打开 md：按钮出现且可用', p);
  check(p.dataPath === MD && p.title === MD, '打开 md：tooltip 为该文件完整路径（短路径不省略）', { title: p.title, dataPath: p.dataPath });
  p = await openMenu();
  check(p.menuOpen && p.items[0] === '在文件管理器中显示' && p.items.includes('在 VS Code 中打开'), 'md 菜单：在文件管理器中显示 + 在 VS Code 中打开', p.items);
  check(p.items.includes('在 VS Code 中打开项目文件夹'), 'md 菜单：项目级入口移至「在 VS Code 中打开项目文件夹」（文件位于文件夹项目内）', p.items);
  await shot('03-md-menu');
  await clearIpc();
  const revealClicked = await clickItem('在文件管理器中显示');
  let calls = await ipc();
  check(revealClicked && calls.length === 1 && calls[0].cmd === 'reveal_path' && calls[0].args?.request?.path === MD,
    'md「在文件管理器中显示」：reveal_path 收到 md 文件路径（不是项目根目录）', calls);
  p = await probe();
  check(!p.menuOpen, '点击菜单项后菜单关闭', p);
  await openMenu();
  await clearIpc();
  await clickItem('在 VS Code 中打开');
  calls = await ipc();
  check(calls.length === 1 && calls[0].cmd === 'open_path_in_vscode' && calls[0].args?.request?.path === MD, 'md「在 VS Code 中打开」：打开 md 文件本身', calls);
  await openMenu();
  await clearIpc();
  await clickItem('在 VS Code 中打开项目文件夹');
  calls = await ipc();
  check(calls.length === 1 && calls[0].cmd === 'open_path_in_vscode' && calls[0].args?.request?.path === ROOT, '「在 VS Code 中打开项目文件夹」：打开文件夹项目根目录', calls);

  // Menu open on md, switch tab → the menu must not stay open for the old file.
  await openMenu();
  await openTab('board');
  p = await probe();
  check(p.present && !p.menuOpen, '菜单打开时切换到白板：按钮跟随新标签且旧菜单已关闭', p);
  check(p.dataPath === BOARD && p.kind === 'board', '白板：tooltip/data-path 为 .a4board 路径', p);
  p = await openMenu();
  check(p.items.includes('在文件管理器中显示') && !p.items.includes('在 VS Code 中打开'), '白板菜单：隐藏「在 VS Code 中打开」', p.items);
  await shot('04-board-menu');
  await clearIpc();
  await clickItem('在文件管理器中显示');
  calls = await ipc();
  check(calls.length === 1 && calls[0].cmd === 'reveal_path' && calls[0].args?.request?.path === BOARD, '白板「在文件管理器中显示」：reveal_path 收到白板路径', calls);

  await openTab('pdf');
  p = await openMenu();
  check(p.present && p.kind === 'pdf' && !p.items.includes('在 VS Code 中打开'), '工作区 PDF：按钮出现，隐藏 VS Code', p);
  await openTab('image');
  p = await openMenu();
  check(p.present && p.kind === 'image' && !p.items.includes('在 VS Code 中打开'), '图片：按钮出现，隐藏 VS Code', p);
  await openTab('html');
  p = await openMenu();
  check(p.present && p.kind === 'html' && p.items.includes('在 VS Code 中打开'), 'HTML：按钮出现，VS Code 打开文件本身', p);
  await ev(`document.querySelector('.workbench-open-trigger').click()`);

  await openTab('paper');
  p = await probe();
  check(p.present && p.kind === 'pdf' && /guide\.pdf$/.test(p.dataPath || ''), '阅读器文献（论文 PDF）：按钮出现，tooltip 为库内 PDF 路径', p);
  p = await openMenu();
  check(!p.items.includes('在 VS Code 中打开') && !p.items.includes('在 VS Code 中打开项目文件夹'), '论文 PDF 菜单：只有「在文件管理器中显示」', p.items);
  await shot('05-paper-menu');
  await clearIpc();
  await clickItem('在文件管理器中显示');
  calls = await ipc();
  check(calls.length === 1 && calls[0].cmd === 'reveal_paper_file' && calls[0].args?.request?.paper_id === 'paper-guide'
    && calls[0].args?.request?.kind === 'source' && calls[0].args?.request?.file_id === 'file-guide', '论文「在文件管理器中显示」：reveal_paper_file(paper_id, source, file_id)', calls);

  await openTab('deep');
  p = await probe();
  check(p.present && p.dataPath === DEEP && p.title !== DEEP && p.title.includes('…') && width(p.title) <= 72
    && p.title.startsWith('D:\\Fixture') && p.title.endsWith('一个相当长的笔记文件名称用于测试.md'), '长路径：tooltip 中间省略（保留开头与文件名），data-path 保留完整路径', { title: p.title, width: p.title && width(p.title) });
  await openMenu();
  await shot('06-long-path-md');
  await clearIpc();
  await clickItem('在文件管理器中显示');
  calls = await ipc();
  check(calls[0]?.args?.request?.path === DEEP, '长路径（含空格）：reveal_path 收到完整路径', calls);

  await openTab('nopath');
  p = await probe();
  check(absent(p), '文件标签缺少路径：不渲染按钮（不会退回项目根目录）', p);

  // Sidebar state is irrelevant.
  await openTab('md');
  const before = await probe();
  await click('.fixture-sidebar-toggle'); await settle();
  const collapsed = await probe();
  await shot('07-md-sidebar-collapsed');
  await click('.fixture-sidebar-toggle'); await settle();
  const expanded = await probe();
  check(before.present && collapsed.present && expanded.present && collapsed.dataPath === MD && expanded.dataPath === MD, '收起/展开侧栏：按钮与目标不变', { before, collapsed, expanded });

  // Close every file tab: the button disappears with the last one.
  let guard = 0;
  while ((await ev('window.__fixture.openFiles.length')) > 0 && guard++ < 20) {
    await click('.fixture-close'); await settle();
    const state = await ev('({active:window.__fixture.activeId,left:window.__fixture.openFiles.length})');
    p = await probe();
    if (state.left > 0 && state.active !== 'nopath') check(p.present, `关闭一个文件标签后仍有文件（${state.active}）：按钮跟随当前文件`, { state, p });
  }
  p = await probe();
  check(absent(p) && ['notes', 'library'].includes(p.active), '关闭最后一个文件标签：按钮消失', p);
  await shot('08-all-file-tabs-closed');

  await click('.fixture-none'); await settle();
  p = await probe();
  check(absent(p), '没有任何标签：不渲染按钮', p);
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
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/open-menu-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1280,720', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`!!window.__fixture`);
  check(true, '夹具已加载', await ev('window.__openMenuModules'));
  await scenarios();
} catch (error) {
  check(false, '运行异常', String(error && error.stack || error));
} finally {
  pauseAll();
  try { if (ws) await send('Browser.close'); } catch { /* ignore */ }
  try { browserProcess?.kill(); } catch { /* ignore */ }
  try { await server?.close(); } catch { /* ignore */ }
}
check(errors.length === 0, 'pageerror / console.error = 0', errors);
const failed = records.filter(record => !record.passed);
const result = { evidence, passed: records.length - failed.length, total: records.length, failed, screenshots, errors };
fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ ...result, records }, null, 2));
console.log(JSON.stringify({ evidence, failed: failed.map(f => f.name), passed: result.passed, total: result.total }, null, 2));
process.exit(failed.length ? 1 : 0);
