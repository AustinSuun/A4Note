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

// Actual TaskBoard/notice components and real isolated service; only native launch is mocked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline-dir') ? path.resolve(process.argv[process.argv.indexOf('--baseline-dir') + 1]) : null;
const evidence = path.join(root, '.tmp/compact-header');
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-compact-ui-'));
let browser, ws, web, tasks;
let seq = 0, checks = 0;
const pending = new Map(), records = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const ok = (value, message) => { assert(value, message); checks++; };
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 12000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const until = async expression => {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw Error('Condition timed out: ' + expression);
};
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing');b.click()})()`);
const screenshot = async name => fs.writeFileSync(path.join(evidence, name), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  const phases = baseline ? ['before', 'after'] : ['after'];
  for (const phase of phases) {
    const entry = path.join(root, '.tmp/compact-header/fixture-entry.tsx');
    await build({ configFile: false, root, logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: { outDir: scratch, emptyOutDir: false, minify: true, cssCodeSplit: false,
        lib: { entry, formats: ['es'], fileName: () => phase + '.js', cssFileName: phase } },
      plugins: [react(), { name: 'isolated-launch-and-baseline', enforce: 'pre',
        resolveId(id) {
          if (id === entry) return entry;
          if (/platform\/projectTaskLauncher$/.test(id)) return '\0test-launch';
        },
        load(id) {
          if (id === entry) return `import React from 'react';import{createRoot}from'react-dom/client';import{TaskBoard}from'/src/features/taskboard/TaskBoard';import{TaskShellSidebarHost}from'/src/features/taskboard/TaskShellSidebar';createRoot(document.getElementById('root')).render(<div className="test-window"><div className="test-titlebar">A4 Note · 隔离浏览器验收</div><div className="test-body"><aside className="test-sidebar"><TaskShellSidebarHost/></aside><main><TaskBoard/></main></div></div>);`;
          if (id === '\0test-launch') return `export const selectProjectFolder=async()=>window.__fixture.folder??null;export const supportsLocalTaskLaunch=()=>true;export const savedLocalTaskPort=()=>4319;export const launchLocalTasks=async()=>{if(window.__fixture.fail)throw Error('隔离测试：服务连接失败');return {...window.__fixture.connection,projectRoot:window.__fixture.folder,onboarding:window.__fixture.warning?{status:'warning',message:'接入说明写入失败：项目只读，请检查权限。'}:{status:'ready'}}};`;
          if (phase === 'before' && /[/\\]TaskBoard\.tsx$/.test(id)) return fs.readFileSync(path.join(baseline, 'before-TaskBoard.tsx'), 'utf8');
          if (phase === 'before' && /[/\\]taskboard\.css$/.test(id)) return fs.readFileSync(path.join(baseline, 'before-taskboard.css'), 'utf8');
        },
      }],
    });
  }

  web = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    const phase = p.includes('before') ? 'before' : 'after';
    if (p.endsWith('.js') || p.endsWith('.css')) {
      const file = path.join(scratch, phase + path.extname(p));
      res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(file)); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const connection = { url: 'http://127.0.0.1:' + tasks.server.address().port, operatorToken: tasks.store.access.operatorToken, projectId: tasks.store.access.projectId };
    res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/${phase}.css"><style>html,body,#root{height:100%;margin:0}body{font-family:'Microsoft YaHei',sans-serif}.test-window{height:100%;display:flex;flex-direction:column}.test-titlebar{height:40px;flex-shrink:0;padding:0 20px;display:flex;align-items:center;box-sizing:border-box;color:#567163;font-size:13px;border-bottom:1px solid #edf0ee}.test-body{display:flex;flex:1;min-height:0}.test-body main{flex:1;min-width:0}.test-sidebar{display:none;width:300px;flex-shrink:0;background:#f5f7f5;padding-top:20px;text-align:center;box-sizing:border-box}html[data-sidebar="open"] .test-sidebar{display:block}</style><div id="root"></div><script>window.__fixture=${JSON.stringify({ connection, folder: path.join(scratch, 'project').split(path.sep).join('/') })}</script><script type="module" src="/${phase}.js"></script>`);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + web.address().port;
  tasks = createTaskServer({ dataDir: path.join(scratch, 'private'), project: 'Aster · 临时验收', origins: [origin] });
  await new Promise(r => tasks.server.listen(0, '127.0.0.1', r));
  const api = async (p, method = 'GET', body) => {
    const r = await fetch('http://127.0.0.1:' + tasks.server.address().port + '/api' + p, { method, headers: { Authorization: 'Bearer ' + tasks.store.access.operatorToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert(r.ok); return r.json();
  };
  for (let i = 1; i <= 8; i++) await api('/tasks', 'POST', { title: '验收任务 ' + i, description: '相同临时任务用于修改前后对比，不触碰真实看板。', acceptance: '只检查显示与原有交互', priority: 'normal' });
  const exe = process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
  if (!exe) throw Error('Set TASKBOARD_TEST_BROWSER to an installed Chromium executable');
  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  const firstRow = {};
  for (const phase of phases) {
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1568, height: 1005, deviceScaleFactor: 1, mobile: false });
    await rpc('Page.navigate', { url: origin + '/' + phase });
    await until(`!!document.querySelector('.tb-start-local')`);
    await click('打开项目文件夹并启动看板');
    await until(`document.querySelectorAll('.tb-card').length===8`); await pause(150);
    await evaluate(`document.querySelector('.tb-card').click()`); await until(`!!document.querySelector('.tb-detail-dialog h2')`);
    firstRow[phase] = await evaluate(`document.querySelector('.tb-card').getBoundingClientRect().top`);
    await screenshot('compact-' + phase + '.png');
    records.push({ phase, firstCardTop: firstRow[phase] });
    if (phase === 'before') continue;
    // 详情已改为原生模态（c06ccee7）：模态打开时看板处于inert，键盘焦点无法进入接入提示。
    await evaluate(`document.querySelector('[aria-label="关闭任务详情"]').click()`);
    await until(`!document.querySelector('.tb-detail-dialog')`);
    ok(await evaluate(`JSON.stringify([...document.querySelectorAll('.tb-board > .tb-column')].map(e => [...e.classList].find(name => name.startsWith('tb-') && name !== 'tb-column'))) === JSON.stringify(['tb-queued', 'tb-in_progress', 'tb-review'])`), 'overview keeps the three direct-flow stages and hides archived tasks');
    ok(!await evaluate(`!!document.querySelector('.tb-eyebrow')`), 'English eyebrow removed');
    ok(!await evaluate(`!!document.querySelector('.tb-main-content .tb-project-context, .tb-main-content .tb-project-empty, .tb-main-content .tb-onboarding, .tb-main-content .tb-plan-service-note')`), 'board top keeps only search and tasks');
    // 用户要求：侧栏与看板都不再保留说明性文字；打开文件夹入口移到侧栏右上。
    ok(!await evaluate(`!!document.querySelector('.tb-sidebar-notices, .tb-onboarding, .tb-plan-service-note, .tb-service-notice')`), 'no explanatory notices remain in sidebar or board');
    ok(!await evaluate(`!!document.querySelector('.tb-connection')`), 'connection chip removed from titlebar');
    ok(!await evaluate(`[...document.querySelectorAll('.tb-titlebar-actions button')].some(b => b.textContent.includes('断开'))`), 'disconnect removed from titlebar');
    ok(await evaluate(`!!document.querySelector('.tb-sidebar-title-row .tb-sidebar-mini-button[aria-label="打开已有项目文件夹"]')`), 'open-folder action sits at sidebar top right');
    ok(await evaluate(`document.querySelectorAll('.tb-sidebar-footer button').length===1&&document.querySelector('.tb-sidebar-footer button').textContent.includes('新建项目')`), 'sidebar footer keeps only new project');
    // 拖动契约：容器仍可拖动，流程切换、提示词和主按钮都是明确的真实控件。
    const titlebarControls = await evaluate(`(()=>{const box=document.querySelector('.tb-titlebar-actions'),nav=document.querySelector('.tb-titlebar-actions .tb-stage-nav'),prompts=[...document.querySelectorAll('.tb-agent-prompt-actions button')],prim=document.querySelector('.tb-titlebar-actions .tb-primary');return{ok:!!box&&!!nav&&!!prim&&prompts.length===2&&!box.hasAttribute('data-window-no-drag')&&nav.hasAttribute('data-window-no-drag'),promptLabels:prompts.map(b=>b.textContent.trim()),primary:prim?.textContent.trim()}})()`);
    ok(titlebarControls.ok, 'titlebar controls keep the drag boundary and prompt buttons ' + JSON.stringify(titlebarControls));
    ok(titlebarControls.promptLabels.some(label => label.includes('发布者提示词')) && titlebarControls.promptLabels.some(label => label.includes('执行者提示词')), 'both Agent prompt copy buttons are visible');
    const boardFit = await evaluate(`(()=>{const b=document.querySelector('.tb-board'),cols=[...document.querySelectorAll('.tb-column')],last=cols[cols.length-1].getBoundingClientRect(),br=b.getBoundingClientRect();return{scroll:b.scrollWidth,client:b.clientWidth,lastRight:last.right,boardRight:br.right}})()`);
    ok(boardFit.scroll <= boardFit.client + 2 && boardFit.lastRight <= boardFit.boardRight + 2, 'all task columns fit the window width');
    records.push({ phase: 'after-notices', firstCardTop: await evaluate(`document.querySelector('.tb-card').getBoundingClientRect().top`) });
    await screenshot('compact-after-notices.png');
    for (const width of [1568, 1280, 1000]) for (const zoom of [1, 1.25]) for (const sidebar of ['closed', 'open']) {
      await rpc('Emulation.setDeviceMetricsOverride', { width, height: 1005, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.documentElement.style.zoom='${zoom}';document.documentElement.dataset.sidebar='${sidebar}'`); await pause(70);
      const layout = await evaluate(`(()=>{const selectors=['.tb-header','.tb-heading','.tb-titlebar-actions','.tb-filters'];return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,rects:selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth}}),buttons:[...document.querySelectorAll('.tb-titlebar-actions > button')].map(e=>e.getBoundingClientRect().toJSON()),fonts:Object.fromEntries(['.tb-header h1','.tb-project-name','.tb-column h2','.tb-column header p','.tb-empty','.tb-filters > input'].map(s=>[s,getComputedStyle(document.querySelector(s)).fontSize]))}})()`);
      ok(!layout.overflow, 'no page overflow ' + [width, zoom, sidebar]);
      ok(layout.rects.every(r => r.scroll <= r.client + 2), 'header/filter content not clipped ' + [width, zoom, sidebar]);
      const heading = layout.rects[1], actions = layout.rects[2];
      ok(heading.right <= actions.left + 1 || heading.bottom <= actions.top + 1, 'heading/actions do not overlap');
      ok(layout.buttons.length === 1 && layout.buttons[0].width > 40, 'titlebar keeps only the primary action');
      // 顶部操作已移入应用标题栏（board-shell-sidebar），按钮最小高度按标题栏设计为30px。
      ok(layout.buttons.every(r => r.height >= 30 * zoom - 1), 'titlebar action hit areas retained');
      if (zoom === 1 && width >= 1280) {
        const fit = await evaluate(`(()=>{const b=document.querySelector('.tb-board'),cols=[...document.querySelectorAll('.tb-column')],last=cols[cols.length-1].getBoundingClientRect(),br=b.getBoundingClientRect();return{scroll:b.scrollWidth,client:b.clientWidth,lastRight:last.right,boardRight:br.right}})()`);
        ok(fit.scroll <= fit.client + 2 && fit.lastRight <= fit.boardRight + 2, 'columns adapt to window width ' + [width, sidebar]);
      }
      assert.deepEqual(layout.fonts, { '.tb-header h1': '25px', '.tb-project-name': '13px', '.tb-column h2': '15px', '.tb-column header p': '13px', '.tb-empty': '14px', '.tb-filters > input': '14px' }); checks++;
      records.push({ width, zoom, sidebar, headerHeight: layout.rects[0].bottom - layout.rects[0].top });
    }
    await evaluate(`document.documentElement.style.zoom='1';document.documentElement.dataset.sidebar='closed'`);
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1568, height: 1005, deviceScaleFactor: 1, mobile: false });
    // Existing controls must still work after the CSS/header-only change.
    // 旧筛选按钮已由流程视图切换取代（07005692）；这里检查阶段切换与搜索仍然有效。
    const stage = label => evaluate(`(()=>{const b=[...document.querySelectorAll('.tb-stage-nav button')].find(e=>e.textContent.includes(${JSON.stringify(label)}));if(!b)throw Error('缺少流程视图按钮：'+${JSON.stringify(label)});b.click()})()`);
    await stage('正在进行'); await pause(150);
    ok(await evaluate(`document.querySelectorAll('.tb-card').length===0`), 'stage switch still filters');
    await stage('总览'); await pause(150);
    ok(await evaluate(`document.querySelectorAll('.tb-card').length===8`), 'overview restores all cards');
    await evaluate(`(()=>{const e=document.querySelector('.tb-filters input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'验收任务 3');e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause(50);
    ok(await evaluate(`document.querySelectorAll('.tb-card').length===1`), 'search still works');
    await click('＋ 新任务'); await until(`!!document.querySelector('.tb-modal')`); ok(true, 'new-task modal opens'); await evaluate(`document.querySelector('[aria-label="取消创建"]').click()`);
    // 断开按钮已按用户要求移除；重新进入入口界面用整页重载模拟。
    const reopenEntry = async () => { await rpc('Page.navigate', { url: origin + '/' + phase }); await until(`!!document.querySelector('.tb-start-local')`); };
    const reconnect = async () => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.startsWith('重新连接'));if(!b)throw Error('缺少重新连接按钮');b.click()})()`);
    await reopenEntry();
    // 说明性文字已按用户要求全部移除：只读等状态不再以看板文字呈现，写入时由服务拒绝提示。
    await evaluate(`window.__fixture.warning=true`); await reconnect();
    // 搜索词会跨重载保留；等看板挂载后清掉，再核对警告场景仍能完整加载任务。
    await until(`!!document.querySelector('.tb-filters input')`);
    await evaluate(`(()=>{const e=document.querySelector('.tb-filters input');if(e&&e.value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
    await until(`document.querySelectorAll('.tb-card').length===8`);
    ok(!await evaluate(`!!document.querySelector('.tb-onboarding, .tb-onboarding-warning, .tb-sidebar-notices')`), 'warning state no longer rendered as board text');
    await reopenEntry(); await evaluate(`window.__fixture.fail=true`); await reconnect(); await until(`!!document.querySelector('.tb-error')`);
    ok(await evaluate(`document.querySelector('.tb-error[role=alert]').textContent.includes('服务连接失败')`), 'launch errors remain visible');
  }
  if (baseline) ok(firstRow.before - firstRow.after >= 60, 'first row moves up at least 60px');
  ok(errors.length === 0, 'no browser exceptions');
  fs.writeFileSync(path.join(evidence, 'compact-results.json'), JSON.stringify({ passed: true, checks, firstRow, records, scope: 'Isolated real React components with native launcher mock, not installed/native GUI' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, firstRow }));
} catch (e) {
  fs.writeFileSync(path.join(evidence, 'compact-results.json'), JSON.stringify({ passed: false, checks, records, errors, error: String(e) }, null, 2));
  console.error(e); process.exitCode = 1;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) browser.kill();
  if (tasks) { tasks.server.closeAllConnections(); await tasks.close(); }
  if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
}
