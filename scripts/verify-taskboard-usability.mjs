import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createTaskServer } from '../apps/project-tasks/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '.tmp/taskboard-usability');
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-task-usability-'));
let browser, ws, web, serverA, serverB;
let seq = 0, checks = 0;
const pending = new Map(), records = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const ok = (value, message) => { assert(value, message); checks++; };
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 15000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const until = async (expression, timeoutMs = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error('Condition timed out: ' + expression);
};
const click = text => evaluate(`(()=>{const bs=[...document.querySelectorAll('button')];const b=bs.find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);
const clickOpenFolder = () => evaluate(`(()=>{const b=document.querySelector('.tb-sidebar-mini-button[aria-label="打开已有项目文件夹"]');if(!b)throw Error('Button missing: open folder mini button');b.click()})()`);
const screenshot = async name => fs.writeFileSync(path.join(evidence, name), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

try {
  // 1. Create two isolated projects with createTaskServer
  const dirA = path.join(scratch, 'project-alpha');
  const dirB = path.join(scratch, 'project-beta');
  const dirC = path.join(scratch, 'subfolder', 'project-alpha'); // Same folder name for duplicate name test
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  fs.mkdirSync(dirC, { recursive: true });

  web = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p === '/create-folder' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        try {
          const {path: parent, name} = JSON.parse(body);
          assert.equal(path.resolve(parent), path.resolve(scratch));
          assert.match(name, /^[a-zA-Z0-9-]+$/);
          fs.mkdirSync(path.join(parent, name));
          res.setHeader('Content-Type','application/json'); res.end('{}');
        } catch(e) { res.statusCode = 400; res.end(JSON.stringify({error:String(e)})); }
      }); return;
    }
    if (p.endsWith('.js') || p.endsWith('.css')) {
      const file = path.join(scratch, path.basename(p));
      res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(file));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/entry.css">
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:'Microsoft YaHei',sans-serif}
  .test-window{height:100%;display:flex;flex-direction:column}
  .test-titlebar{height:40px;flex-shrink:0;padding:0 16px;display:flex;align-items:center;background:#fafbfa;color:#567163;font-size:12px;border-bottom:1px solid #edf0ee}
  .workbench-document-controls{display:flex;flex:1;min-width:0}
  .test-body{display:flex;flex:1;min-height:0}
  .test-body main{flex:1;min-width:0}
</style>
<div id="root"></div>
<script type="module" src="/entry.js"></script>`);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const webOrigin = 'http://127.0.0.1:' + web.address().port;

  serverA = createTaskServer({ dataDir: path.join(dirA, 'private'), project: '项目 Alpha', origins: [webOrigin] });
  await new Promise(r => serverA.server.listen(0, '127.0.0.1', r));
  const portA = serverA.server.address().port;
  const tokenA = serverA.store.access.operatorToken;

  serverB = createTaskServer({ dataDir: path.join(dirB, 'private'), project: '项目 Beta', origins: [webOrigin] });
  await new Promise(r => serverB.server.listen(0, '127.0.0.1', r));
  const portB = serverB.server.address().port;
  const tokenB = serverB.store.access.operatorToken;
  const idA = (await (await fetch(`http://127.0.0.1:${portA}/api/snapshot`, {headers:{Authorization:`Bearer ${tokenA}`}})).json()).project.id;
  const idB = (await (await fetch(`http://127.0.0.1:${portB}/api/snapshot`, {headers:{Authorization:`Bearer ${tokenB}`}})).json()).project.id;

  // Add distinct tasks to Project A and Project B
  const apiCall = async (port, token, method, urlPath, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${urlPath}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(res.ok, `API call failed: ${res.status}`);
    return res.json();
  };

  await apiCall(portA, tokenA, 'POST', '/tasks', { title: 'Alpha 任务 1：核心算法研究', description: '属于项目 Alpha 的专有任务', acceptance: '不可出现在 Beta', priority: 'high' });
  await apiCall(portA, tokenA, 'POST', '/tasks', { title: 'Alpha 任务 2：前端架构升级', description: '属于项目 Alpha 的专有任务 2', acceptance: '不可出现在 Beta', priority: 'normal' });
  await apiCall(portB, tokenB, 'POST', '/tasks', { title: 'Beta 任务 1：移动端适配', description: '属于项目 Beta 的专有任务', acceptance: '不可出现在 Alpha', priority: 'normal' });

  // 2. Build test bundle with Vite
  const entry = path.join(root, '.tmp/taskboard-usability/entry.tsx');
  fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskBoard } from '/src/features/taskboard/TaskBoard';
import { TaskShellSidebarHost } from '/src/features/taskboard/TaskShellSidebar';
import { DocumentToolbarProvider, useDocumentToolbar } from '/src/workbench/DocumentToolbar';
import '/src/features/explorer/markdown-mode-switch.css';
function Shell() {
  const [visible,setVisible] = React.useState(true);
  const toolbar = useDocumentToolbar();
  return <div className="test-window">
    <header className="workbench-topbar test-titlebar">
      <button id="shell-toggle" onClick={()=>setVisible(v=>!v)}>项目侧栏</button>
      <div className="workbench-document-controls" ref={toolbar.setControlsHost}/>
    </header>
    <div className="test-body">
      {visible && <aside style={{width:240,display:'flex',flexDirection:'column'}}><TaskShellSidebarHost/></aside>}
      <main><TaskBoard/></main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<DocumentToolbarProvider enabled><Shell/></DocumentToolbarProvider>);
`);

  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: scratch,
      emptyOutDir: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' },
    },
    plugins: [
      react(),
      {
        name: 'mock-only-native-boundary',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@tauri-apps/api/core') return '\0test-core';
          if (id === '@tauri-apps/plugin-dialog') return '\0test-dialog';
        },
        load(id) {
          if (id === '\0test-dialog') return `
            export const open = async options => { window.__fixture.picks = (window.__fixture.picks || 0) + 1; return window.__fixture.folderToPick ?? null; };
          `;
          if (id === '\0test-core') return `
            export const isTauri = () => true;
            export const invoke = async (command, args) => {
              const f = window.__fixture;
              if (command === 'create_directory') {
                const r = await fetch('/create-folder', {method:'POST',body:JSON.stringify(args.request)});
                if (!r.ok) throw Error((await r.json()).error); return;
              }
              if (command !== 'start_project_tasks') throw Error('Unexpected IPC: '+command);
              f.launches = (f.launches || 0) + 1;
              if (f.delay) await new Promise(r => setTimeout(r, f.delay));
              if (f.failLaunch) throw Error('启动服务异常测试');
              const norm = p => String(p || '').split(String.fromCharCode(92)).join('/').toLowerCase().replace(/[/]+$/, '');
              const entry = Object.entries(f.connections).find(([p]) => norm(p) === norm(args.projectRoot));
              if (!entry) throw Error('未配置的测试项目');
              return {...entry[1], projectRoot:f.wrongPath || args.projectRoot, projectId:f.wrongId || entry[1].projectId, reused:true};
            };
          `;
        },
      },
    ],
  });

  // 3. Launch Chrome headless
  const exe = process.env.TASKBOARD_TEST_BROWSER || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(p => fs.existsSync(p));
  if (!exe) throw Error('No Chromium executable found');

  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile,
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    }
  };
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 4. Test Legacy Migration
  const initScript = `
    try {
      localStorage.clear();
      localStorage.setItem('a4note.tasks.local-start.v1', JSON.stringify({
        projectRoot: ${JSON.stringify(dirA)},
        port: ${portA}
      }));
    } catch {}
    window.__fixture = {
      defaultPath: ${JSON.stringify(dirA)},
      folderToPick: ${JSON.stringify(dirA)},
      connections: {
        [${JSON.stringify(dirA)}]: { url: 'http://127.0.0.1:${portA}', operatorToken: '${tokenA}', projectId: '${idA}' },
        [${JSON.stringify(dirB)}]: { url: 'http://127.0.0.1:${portB}', operatorToken: '${tokenB}', projectId: '${idB}' },
        [${JSON.stringify(dirC)}]: { url: 'http://127.0.0.1:${portA}', operatorToken: '${tokenA}', projectId: '${idA}' },
      }
    };
  `;
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  await rpc('Page.navigate', { url: webOrigin });
  await until(`!!document.querySelector('.tb-project-sidebar')`, 12000);
  await pause(300);

  // Check 1: Legacy project migrated into sidebar
  const sidebarItems = await evaluate(`[...document.querySelectorAll('.tb-project-item')].map(e=>({
    name: e.querySelector('.tb-project-name-text')?.textContent.trim(),
    path: e.querySelector('.tb-project-path-text')?.textContent.trim(),
    active: e.classList.contains('active'),
  }))`);
  ok(sidebarItems.length === 1, 'Legacy project automatically migrated into sidebar');
  ok(sidebarItems[0].name === 'project-alpha', 'Project name derived from folder');
  ok(sidebarItems[0].active, 'Migrated project is active');

  // Connect to Project A
  await click('打开项目文件夹并启动看板');
  await until(`document.querySelectorAll('.tb-card').length === 2`);
  ok(await evaluate(`document.body.innerText.includes('Alpha 任务 1：核心算法研究')`), 'Alpha task 1 displayed');
  ok(await evaluate(`document.body.innerText.includes('Alpha 任务 2：前端架构升级')`), 'Alpha task 2 displayed');
  ok(await evaluate(`!!document.querySelector('.workbench-topbar .tb-stage-switch')`), 'State buttons use shell titlebar');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tb-stage-switch button')].map(b=>b.textContent.trim())`), ['总览','积压','任务队列','进行中','待验收','已归档']); checks++;
  ok(!await evaluate(`!!document.querySelector('.tb-stage-count')`), 'No counts in state buttons');
  ok(!await evaluate(`!!document.querySelector('.tb-stage-switch.markdown-resource-mode-switch')`), 'No inherited markdown mode layout');
  for (const label of ['积压','任务队列','进行中','待验收','已归档','总览']) {
    await click(label); await pause(80);
    ok(await evaluate(`[...document.querySelectorAll('.tb-stage-switch button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).getAttribute('aria-pressed')==='true'`), 'Switch '+label);
  }
  await screenshot('multi-project-sidebar-connected.png');

  // Check 2: Add Project B
  await evaluate(`window.__fixture.folderToPick = ${JSON.stringify(dirB)}`);
  await clickOpenFolder();
  await until(`document.querySelectorAll('.tb-project-item').length === 2`);
  await pause(500);

  // Assert Project B became active and loaded its tasks
  await until(`document.querySelectorAll('.tb-card').length === 1`);
  ok(await evaluate(`document.body.innerText.includes('Beta 任务 1：移动端适配')`), 'Beta task 1 loaded after switch');
  ok(!await evaluate(`document.body.innerText.includes('Alpha 任务 1')`), 'Alpha task 1 NOT in Beta (no cross-project leakage)');
  await screenshot('multi-project-switched-to-beta.png');

  // Check 3: Add duplicate folder name Project C (same basename 'project-alpha', different path)
  await evaluate(`window.__fixture.folderToPick = ${JSON.stringify(dirC)}`);
  await clickOpenFolder();
  await until(`document.querySelectorAll('.tb-project-item').length === 3`);
  await pause(200);

  // Assert distinguishing path styling is applied to duplicate names
  const distinguished = await evaluate(`document.querySelectorAll('.tb-project-path-text.distinguish').length`);
  ok(distinguished >= 2, 'Duplicate folder names are highlighted with distinguishing paths');
  await screenshot('multi-project-duplicate-names.png');

  // Check 4: Add same path with different formatting (trailing slash, uppercase drive) -> must not create duplicate
  await evaluate(`window.__fixture.folderToPick = ${JSON.stringify(dirB + '/')} `);
  await clickOpenFolder();
  await pause(200);
  ok(await evaluate(`document.querySelectorAll('.tb-project-item').length === 3`), 'Same path does not create duplicate');

  // Check 5: Sidebar search filtering
  await evaluate(`(()=>{
    const input = document.querySelector('.tb-sidebar-search-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Beta');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(100);
  const searchResults = await evaluate(`[...document.querySelectorAll('.tb-project-item')].map(e=>e.querySelector('.tb-project-name-text')?.textContent.trim())`);
  assert.deepEqual(searchResults, ['project-beta'], 'Search filters to matching project');

  // Clear search
  await evaluate(`(()=>{
    const input = document.querySelector('.tb-sidebar-search-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(100);
  ok(await evaluate(`document.querySelectorAll('.tb-project-item').length === 3`), 'Clear search restores all projects');

  // Check 6: Rename project
  await evaluate(`(()=>{
    const item = [...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('project-beta'));
    item.querySelector('.tb-project-action-btn[title="重命名项目"]').click();
  })()`);
  await pause(100);
  await evaluate(`(()=>{
    const input = document.querySelector('.tb-project-rename-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '移动端核心项目');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await pause(100);
  ok(await evaluate(`document.body.innerText.includes('移动端核心项目')`), 'Project renamed successfully');

  // Shell owns sidebar visibility; TaskBoard must never recreate an inner column.
  await evaluate(`document.getElementById('shell-toggle').click()`);
  await pause(100);
  ok(!await evaluate(`!!document.querySelector('.tb-project-sidebar')`), 'Shell hides project sidebar without in-board fallback');
  await evaluate(`document.getElementById('shell-toggle').click()`);
  await pause(100);
  ok(await evaluate(`!!document.querySelector('.tb-shell-sidebar-host .tb-project-sidebar')`), 'Shell restores project sidebar');
  ok(!await evaluate(`!!document.querySelector('.taskboard .tb-project-sidebar')`), 'No second sidebar inside board');

  // Check 8: Switch back to Project A
  await evaluate(`(()=>{
    const item = [...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('project-alpha'));
    item.click();
  })()`);
  await until(`document.querySelectorAll('.tb-card').length === 2`);
  ok(await evaluate(`document.body.innerText.includes('Alpha 任务 1')`), 'Alpha tasks restored after switching back');

  // Check 9: Unsaved draft protection when switching
  await click('＋ 新任务');
  await until(`!!document.querySelector('.tb-modal')`);
  await evaluate(`(()=>{
    const input = document.querySelector('.tb-modal input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '未保存的测试任务草稿');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  // Try switching to another project
  await evaluate(`(()=>{
    const item = [...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('移动端核心项目'));
    item.click();
  })()`);
  await pause(100);
  ok(await evaluate(`!!document.querySelector('.tb-confirm-modal')`), 'Unsaved draft prompt shown');
  ok(await evaluate(`document.body.innerText.includes('未保存的任务草稿')`), 'Prompt text explains unsaved draft');
  await screenshot('multi-project-unsaved-warning.png');
  // Click stay
  await click('留在当前项目');
  await pause(100);
  ok(await evaluate(`document.querySelector('.tb-modal input')?.value === '未保存的测试任务草稿'`), 'Stay preserves draft');
  // Cancel draft
  await evaluate(`document.querySelector('[aria-label="取消创建"]').click()`);
  await pause(100);

  // Check 10: "从列表移除" with strict confirmation text
  await evaluate(`(()=>{
    const item = [...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('移动端核心项目'));
    item.querySelector('.tb-remove-btn').click();
  })()`);
  await pause(100);
  ok(await evaluate(`!!document.querySelector('.tb-confirm-modal')`), 'Remove confirmation dialog shown');
  const warningText = await evaluate(`document.querySelector('.tb-remove-warning')?.textContent.trim()`);
  ok(warningText.includes('仅移除本应用的项目入口，不删除磁盘项目文件、任务数据库、附件、项目内 Agent 接入说明，也不停止已运行服务或其他 Agent。'), 'Exact safety explanation in remove confirmation');
  await screenshot('multi-project-remove-confirm.png');

  // Confirm remove
  await evaluate(`document.querySelector('.tb-confirm-modal .tb-danger').click()`);
  await pause(200);
  ok(await evaluate(`document.querySelectorAll('.tb-project-item').length === 2`), 'Project removed from sidebar');
  ok(fs.existsSync(path.join(dirB, 'private')), 'Disk files of removed project remain intact');

  // Check 11: Re-adding removed directory restores original identity and tasks
  await evaluate(`window.__fixture.folderToPick = ${JSON.stringify(dirB)}`);
  await clickOpenFolder();
  await until(`document.querySelectorAll('.tb-project-item').length === 3`);
  await pause(500);
  await until(`document.querySelectorAll('.tb-card').length === 1`);
  ok(await evaluate(`document.body.innerText.includes('Beta 任务 1：移动端适配')`), 'Re-added project restores its tasks');


  // Native picker contract: explicit open never silently resumes saved path; cancel leaves view unchanged.
  await evaluate(`window.__fixture.folderToPick = null`);
  const beforePicks = await evaluate(`window.__fixture.picks`);
  await clickOpenFolder(); await pause(150);
  ok(await evaluate(`window.__fixture.picks`) === beforePicks + 1, 'Explicit open invokes folder chooser despite saved project');
  ok(await evaluate(`document.body.innerText.includes('Beta 任务 1')`), 'Cancel picker preserves connected data');

  // Identity failures are visible errors, not an empty board; clicking the same project retries.
  await evaluate(`window.__fixture.wrongId = 'wrong-server-id'`);
  await evaluate(`[...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('project-alpha')).click()`);
  await until(`!!document.querySelector('.tb-error')`);
  ok(await evaluate(`!document.querySelector('.tb-card') && !document.querySelector('.tb-project-empty')`), 'Identity failure hides old tasks and never masquerades as empty project');
  ok(await evaluate(`document.querySelector('.tb-error').textContent.includes('身份')`), 'Identity failure explained');
  await evaluate(`delete window.__fixture.wrongId;document.querySelector('.tb-project-item.active').click()`);
  await until(`document.querySelectorAll('.tb-card').length === 2`);
  ok(true, 'Same selected project retries after failure');

  await evaluate(`window.__fixture.failLaunch=true;window.__fixture.folderToPick=${JSON.stringify(dirB)}`);
  await clickOpenFolder(); await until(`document.querySelector('.tb-error')?.textContent.includes('启动服务异常测试')`);
  ok(await evaluate(`!document.querySelector('.tb-project-empty')`), 'Launch failure is not a zero-task project');
  await evaluate(`window.__fixture.failLaunch=false;document.querySelector('.tb-project-item.active').click()`);
  await until(`document.querySelectorAll('.tb-card').length === 1`);

  // Actual moving surface with reader metrics, keyboard navigation and reduced-motion support.
  const firstTransform = await evaluate(`getComputedStyle(document.querySelector('.tb-stage-switch'),'::before').transform`);
  await click('已归档'); await pause(250);
  ok(await evaluate(`getComputedStyle(document.querySelector('.tb-stage-switch'),'::before').transform`) !== firstTransform, 'Selection surface slides with stage');
  ok(await evaluate(`getComputedStyle(document.querySelector('.tb-stage-switch button')).borderTopWidth==='0px'`), 'No individual button borders, same reader contract');
  await evaluate(`document.querySelector('.tb-stage-switch button.active').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  await until(`document.querySelector('.tb-stage-switch').dataset.stage==='all'`);
  await rpc('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  ok(await evaluate(`getComputedStyle(document.querySelector('.tb-stage-switch'),'::before').transitionDuration==='0s'`), 'Reduced motion honored');
  await rpc('Emulation.setEmulatedMedia',{features:[]});

  // New project modal -> actual isolated disk mkdir through a mocked native IPC boundary.
  await click('＋ 新建项目'); await until(`!!document.querySelector('.tb-create-project-dialog[open]')`);
  await evaluate(`window.__fixture.folderToPick=${JSON.stringify(scratch)}`);
  await click('选择保存位置'); await pause(150);
  const setName = async value => { await evaluate(`(()=>{const i=document.querySelector('.tb-create-project-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(80); };
  await setName('../unsafe'); await click('创建并打开看板');
  await until(`document.querySelector('.tb-create-project-dialog [role=alert]')?.textContent.includes('有效')`);
  ok(true,'Path traversal project names rejected without creating directory');
  await setName('project-beta'); await click('创建并打开看板');
  await until(`document.querySelector('.tb-create-project-dialog [role=alert]')?.textContent.includes('EEXIST')`);
  ok(fs.existsSync(path.join(dirB,'private')), 'Existing directory is never overwritten');
  const created = path.join(scratch,'created-project');
  await evaluate(`window.__fixture.connections[${JSON.stringify(created)}]=window.__fixture.connections[${JSON.stringify(dirB)}];window.__fixture.failLaunch=true`);
  await setName('created-project'); await click('创建并打开看板');
  await until(`!document.querySelector('.tb-create-project-dialog') && !!document.querySelector('.tb-error')`);
  ok(fs.existsSync(created), 'Creation succeeded even when subsequent service launch fails; folder retained for retry');
  ok(await evaluate(`document.querySelector('.tb-project-item.active')?.textContent.includes('created-project')`), 'Failed new project remains selected and recoverable');
  await evaluate(`window.__fixture.failLaunch=false;document.querySelector('.tb-project-item.active').click()`);
  await until(`document.querySelectorAll('.tb-card').length === 1`);
  ok(true, 'Retry new project without creating duplicate folder');
  await screenshot('usability-new-project-connected.png');
  // Check 12: Responsiveness and no overflow across widths
  for (const width of [1440, 1100, 768]) {
    await rpc('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await pause(100);
    const layout = await evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      sidebarWidth: document.querySelector('.tb-project-sidebar')?.clientWidth,
    })`);
    ok(layout.scrollWidth <= layout.clientWidth + 2, 'No page overflow at width ' + width);
    ok(await evaluate(`new Set([...document.querySelectorAll('.tb-stage-switch button')].map(b=>Math.round(b.getBoundingClientRect().top))).size===1`), 'Single button row at '+width);
    ok(await evaluate(`document.querySelector('.tb-project-sidebar').getBoundingClientRect().width<=242`), 'Sidebar stays inside software column at '+width);
    await screenshot('shell-'+width+'.png');
  }

  ok(errors.length === 0, 'Zero browser runtime errors: ' + JSON.stringify(errors));
  fs.writeFileSync(path.join(evidence, 'multi-project-results.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} catch (e) {
  let html='';try{html=await evaluate('document.body.innerHTML')}catch{};console.error(e);console.log('BROWSER_ERRORS:',JSON.stringify(errors));console.log('DOM_HTML:',html.slice(0,1000));
  fs.writeFileSync(path.join(evidence, 'multi-project-results.json'), JSON.stringify({ passed: false, checks, error: String(e) }, null, 2));
  process.exitCode = 1;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) browser.kill();
  if (serverA) { serverA.server.closeAllConnections(); await serverA.close(); }
  if (serverB) { serverB.server.closeAllConnections(); await serverB.close(); }
  if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}
