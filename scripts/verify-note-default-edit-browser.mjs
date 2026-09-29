// Windows Chromium regression for the reader note per-open default-edit rule and the
// redesigned workbench mode menu (task 456497d8). Real reader modules (content-mode hook,
// retained note wrapper, workbench menu + its CSS) run in a synthetic host; no library,
// task service or native data is touched. Evidence lands in
// .tmp/shots/note-default-edit-browser/<run>/.
//
// What it proves (and what fails on code without the fix):
//   - every open/re-open of the retained note surface starts in live edit, even after a
//     manual switch to reading during the previous open;
//   - a manual read switch stays effective for the current open, including across layout
//     mode changes (split -> floating -> writing) made while the panel is visible;
//   - the workbench menu presents every presentation form with a schematic diagram, a
//     name, the live shortcut binding and a short description; keyboard navigation,
//     Escape-to-close and focus restore keep working;
//   - the menu stays usable in light/dark theme, narrow windows and 125% zoom.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.NOTE_DEFAULT_FIXTURE || 'scripts/fixtures/note-default-edit-host.tsx';
const HOST_SOURCE = fs.readFileSync(FIXTURE, 'utf8');
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>note default edit</title>'
  + '<style>body{margin:0;padding:16px;background:var(--background,#f5f5f4);font-family:sans-serif;color:var(--text,#1c2420)}'
  + '.harness-shell{position:relative;display:block;height:calc(100vh - 32px);border:1px solid var(--line,#ddd);background:var(--surface,#fff)}'
  + '.harness-toolbar{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--line,#ddd)}'
  + '.harness-body{position:relative;display:block;height:calc(100% - 45px)}'
  + '.harness-pdf{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted,#777);background:var(--surface-soft,#fafafa)}'
  + '.reader-retained-note{position:absolute;inset:12px 12px 12px auto;width:min(420px,60%);background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:10px;overflow:hidden;display:flex}'
  + '.note-workspace{display:flex;flex-direction:column;width:100%}'
  + '.note-document-header{display:flex;justify-content:flex-end;padding:8px;border-bottom:1px solid var(--line,#ddd)}'
  + '.note-view-switch{display:inline-flex;gap:2px}'
  + '.note-view-switch button{padding:3px 10px;border:1px solid var(--line,#ddd);border-radius:6px;background:transparent;color:var(--muted,#777);cursor:pointer}'
  + '.note-view-switch button.active{background:var(--accent-soft,#e5efe7);color:var(--accent-strong,#1f6b45);border-color:var(--accent,#2c8a5b)}'
  + '.harness-editor{flex:1;margin:0;border:0;outline:none;padding:12px;font:14px/1.6 sans-serif;resize:none;background:transparent;color:inherit}'
  + '.note-preview-only{padding:12px;margin:0}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';

const own = path.resolve('.tmp/note-default-edit-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/note-default-edit-browser', run);
const screenshots = [];
const records = [];
const errors = [];
const sourceFiles = [
  'src/features/reader/noteContentMode.ts',
  'src/features/reader/ReaderMarkdown.tsx',
  'src/features/reader/ReaderNoteActivity.tsx',
  'src/features/reader/ReaderNoteWorkbenchMenu.tsx',
  'src/features/reader/reader-writing-layout.css',
];
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'missing';
const after = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));

function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let browserProcess = null, server = null, ws = null, seq = 0;
const requests = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, 30000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception?.description || ''));
  return result.result.value;
};
const wait = async (expression, tries = 120, interval = 100) => {
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
const state = () => ev(`(()=>{const panel=document.querySelector('.note-workspace');const shell=document.querySelector('.reader-workspace-shell');const retained=document.querySelector('.reader-retained-note');return {content:panel?.dataset.contentMode??null,active:document.getElementById('harness-active')?.dataset.active??null,noteMode:shell?.dataset.noteMode??null,hidden:retained?.hidden??null,editor:!!document.querySelector('.harness-editor'),preview:!!document.querySelector('.note-preview-only')}})()`);
const openMenu = () => ev(`(document.querySelector('.reader-note-workbench-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})),true)`);
const menuItems = () => ev(`[...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].map(item=>({label:item.querySelector('.reader-note-workbench-item-label')?.textContent.trim()??'',key:item.querySelector('.reader-note-workbench-item-key')?.textContent.trim()??'',hint:item.querySelector('.reader-note-workbench-item-hint')?.textContent.trim()??'',diagram:!!item.querySelector('svg.reader-note-workbench-item-diagram'),current:item.classList.contains('current')}))`);

try {
  fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'host.tsx'), HOST_SOURCE);
  fs.writeFileSync(path.join(own, 'host.html'), HOST_HTML);

  server = await createServer({
    configFile: false, root: process.cwd(), cacheDir: path.join(own, run + '-vite-cache'), plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/.build/**', '**/.tmp/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } },
  });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/note-default-edit-browser/host.html';

  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1568,760', 'about:blank',
  ], { stdio: 'ignore' });
  let port = 0;
  for (let index = 0; index < 150 && !port; index += 1) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); }
    catch (error) { if (error.code !== 'EBUSY' && error.code !== 'ENOENT') throw error; }
    if (!port) await pause(100);
  }
  if (!Number.isInteger(port) || port < 1) throw Error('Chrome did not publish a readable DevToolsActivePort');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = tabs.find(tab => tab.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const entry = requests.get(message.id);
      requests.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1568, height: 760, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('.reader-note-workbench-button')`, 200);
  await pause(300);

  /* 1. fresh mount defaults to live edit */
  let now = await state();
  check(now.content === 'edit' && now.editor, 'fresh mount defaults to live edit', now);
  await shot('00-fresh-edit');

  /* 2. manual read switch applies for the current open */
  await ev(`([...document.querySelectorAll('.note-view-switch button')].find(b=>b.getAttribute('aria-label')==='阅读模式')?.click(),true)`);
  await pause(150);
  now = await state();
  check(now.content === 'read' && now.preview, 'manual switch to reading applies', now);

  /* 3. layout mode changes inside the same open keep the reading state */
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`);
  let items = await menuItems();
  check(items.length === 4, 'menu lists the four presentation forms', items.map(item => item.label));
  check(items.every(item => item.diagram && item.label && item.key && item.hint), 'every form shows diagram, name, shortcut and description', items);
  const expectedHints = { '边读边记': 'PDF 与笔记并排，可拖动调整宽度', '悬浮速记': '叠在 PDF 上，可拖动、可缩放的速记卡', '专注写作': '以笔记为主，占满内容区，随时返回论文', 'PDF 专注': '收起笔记，PDF 占满内容区' };
  check(items.every(item => expectedHints[item.label] === item.hint), 'descriptions match the redesigned copy', items);
  check(items.find(item => item.label === '边读边记')?.current === true, 'current form is marked', items);
  await shot('01-menu-light');
  await ev(`([...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(x=>x.textContent.includes('悬浮速记'))?.click(),true)`);
  await wait(`document.querySelector('.reader-workspace-shell')?.dataset.noteMode==='floating'`);
  await pause(150);
  now = await state();
  check(now.content === 'read', 'reading state survives a layout switch within the open', now);
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`);
  await ev(`([...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(x=>x.textContent.includes('专注写作'))?.click(),true)`);
  await wait(`document.querySelector('.reader-workspace-shell')?.dataset.noteMode==='writing'`);
  await pause(150);
  now = await state();
  check(now.content === 'read', 'reading state survives split->floating->writing within the open', now);

  /* 4. closing and re-opening resets to live edit */
  await ev(`document.getElementById('harness-toggle').click(),true`);
  await wait(`document.getElementById('harness-active').dataset.active==='false'`);
  await pause(250);
  await ev(`document.getElementById('harness-toggle').click(),true`);
  await wait(`document.getElementById('harness-active').dataset.active==='true'`);
  await pause(250);
  now = await state();
  check(now.content === 'edit' && now.editor, 're-open resets to live edit', now);
  await shot('02-reopen-edit');

  /* 5. repeat the cycle once more (read -> close -> open) */
  await ev(`([...document.querySelectorAll('.note-view-switch button')].find(b=>b.getAttribute('aria-label')==='阅读模式')?.click(),true)`);
  await pause(150);
  await ev(`document.getElementById('harness-toggle').click(),true`);
  await wait(`document.getElementById('harness-active').dataset.active==='false'`);
  await pause(250);
  await ev(`document.getElementById('harness-toggle').click(),true`);
  await wait(`document.getElementById('harness-active').dataset.active==='true'`);
  await pause(250);
  now = await state();
  check(now.content === 'edit', 'second re-open also defaults to live edit', now);

  /* 6. keyboard navigation on the redesigned menu */
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`);
  await pause(150);
  const firstFocus = await ev(`document.activeElement?.textContent?.includes('边读边记')??false`);
  await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})),true`);
  await pause(100);
  const secondFocus = await ev(`document.activeElement?.textContent?.includes('悬浮速记')??false`);
  check(firstFocus && secondFocus, 'arrow keys move focus through the forms', { firstFocus, secondFocus });
  await ev(`document.activeElement instanceof HTMLButtonElement && (document.activeElement.click(),true)`);
  await wait(`!document.querySelector('.reader-note-workbench-menu')`);
  now = await state();
  check(now.noteMode === 'floating', 'activating the focused form selects it', now);
  check(await ev(`document.activeElement?.classList?.contains('reader-note-workbench-button')??false`), 'closing the menu restores focus to the handle');
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu')`);
  await ev(`document.querySelector('.reader-note-workbench-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})),true`);
  await wait(`!document.querySelector('.reader-note-workbench-menu')`);
  check(true, 'Escape closes the menu');

  /* 7. dark theme, narrow window and zoom */
  await ev(`document.documentElement.dataset.theme='midnight'`);
  await pause(200);
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu')`);
  await pause(150);
  await shot('03-menu-dark');
  await ev(`document.documentElement.dataset.theme=''`);
  await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 700, deviceScaleFactor: 1, mobile: false });
  await pause(250);
  await openMenu();
  await wait(`!!document.querySelector('.reader-note-workbench-menu')`);
  const narrowBox = await ev(`(()=>{const m=document.querySelector('.reader-note-workbench-menu');const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,innerWidth,innerHeight}})()`);
  check(narrowBox.left >= 0 && narrowBox.right <= narrowBox.innerWidth && narrowBox.top >= 0 && narrowBox.bottom <= narrowBox.innerHeight, 'menu stays on screen in a narrow window', narrowBox);
  await shot('04-menu-narrow');
  await ev(`document.documentElement.style.zoom='125%'`);
  await pause(250);
  const zoomBox = await ev(`(()=>{const m=document.querySelector('.reader-note-workbench-menu');const r=m.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,innerWidth,innerHeight}})()`);
  check(zoomBox.left >= -1 && zoomBox.right <= zoomBox.innerWidth + 1 && zoomBox.bottom <= zoomBox.innerHeight + 1, 'menu stays on screen at 125% zoom', zoomBox);
  await shot('05-menu-zoom-125');
  await ev(`document.documentElement.style.zoom=''`);
  await send('Emulation.clearDeviceMetricsOverride');
} catch (error) {
  check(false, 'script completed without fatal error', String(error));
  errors.push('FATAL ' + String(error));
  try { await shot('failure'); } catch { /* ignore */ }
} finally {
  const failed = records.filter(record => !record.passed);
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ run, evidence, sourceHashes: after, screenshots, errors, total: records.length, failed: failed.length, records }, null, 2));
  try { if (browserProcess) browserProcess.kill(); } catch { /* ignore */ }
  try { await server?.close(); } catch { /* ignore */ }
  console.log(JSON.stringify({ evidence, total: records.length, failed: failed.length, errors, screenshots }));
  process.exitCode = failed.length || errors.length ? 1 : 0;
}
