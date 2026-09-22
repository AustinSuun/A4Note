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
const evidence = path.join(root, '.tmp/qingchuan-stage');
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-stage-integration-'));
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
    if (p.endsWith('.js') || p.endsWith('.css')) {
      const file = path.join(scratch, path.basename(p));
      res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(file));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/${new URL(req.url, "http://localhost").searchParams.has("baseline") ? "entry-before" : "entry"}.css">
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:'Microsoft YaHei',sans-serif}
  .test-window{height:100%;display:flex;flex-direction:column}
  .test-titlebar{height:36px;flex-shrink:0;padding:0 16px;display:flex;align-items:center;background:#fafbfa;color:#567163;font-size:12px;border-bottom:1px solid #edf0ee}
  .test-body{display:flex;flex:1;min-height:0}
  .test-body main{flex:1;min-width:0}
</style>
<div id="root"></div>
<script type="module" src="/${new URL(req.url, "http://localhost").searchParams.has("baseline") ? "entry-before" : "entry"}.js"></script>`);
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

  // Add distinct tasks to Project A and Project B. The direct queue flow has
  // no backlog or plan-approval fixture between publication and execution.
  const apiCall = async (port, token, method, urlPath, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${urlPath}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(res.ok, `API call failed: ${res.status}`);
    return res.json();
  };

  const worker = await apiCall(portA, serverA.store.access.enrollmentToken, 'POST', '/join', {alias:'测试执行者'});
  const fixtureTasks = {};
  for (const status of ['queued','in_progress','review','archived']) {
    let t = await apiCall(portA, tokenA, 'POST', '/tasks', {title: '阶段任务-' + status, description:'实际隔离任务，阶段='+status, acceptance:'验证阶段隔离、真实状态流转与证据', priority:'high'});
    if (['in_progress','review','archived'].includes(status)) t = await apiCall(portA, worker.sessionToken,'PATCH','/tasks/'+t.id,{action:'claim',revision:t.revision});
    if (['review','archived'].includes(status)) t = await apiCall(portA, worker.sessionToken,'PATCH','/tasks/'+t.id,{action:'submit',revision:t.revision,result:'开发者报告：仅隔离测试已运行；真实Windows剪贴板与系统拖拽未测试。'});
    if (status === 'archived') t = await apiCall(portA, tokenA,'PATCH','/tasks/'+t.id,{action:'archive',revision:t.revision});
    fixtureTasks[status] = t;
  }
  await apiCall(portB, tokenB, 'POST','/tasks',{title:'Beta独有任务',description:'不可串项目',acceptance:'独立',priority:'normal'});

  // 2. Build test bundle with Vite
  const entry = path.join(root, '.tmp/qingchuan-stage/entry.tsx');
  fs.writeFileSync(entry, `
import React, {useState, useEffect} from 'react';
import { createRoot } from 'react-dom/client';
import { TaskBoard } from '/src/features/taskboard/TaskBoard';
import { TaskShellSidebarHost } from '/src/features/taskboard/TaskShellSidebar';
import { DocumentToolbarProvider, DocumentToolbarActiveContext, useDocumentToolbar } from '/src/workbench/DocumentToolbar';
import { WindowTitleBar } from '/src/workbench/WindowTitleBar';
import { bindWindowTitlebarGestures } from '/src/workbench/windowTitlebarGestures';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/base.css';
import '/src/ui/styles/workbench.css';
// Mirror the real shell structure (WorkbenchTopBar inside the titlebar projectbar) so the
// document-controls host stretches exactly like production and the blank strip is real.
function Host(){const t=useDocumentToolbar();return <header className="workbench-topbar"><div className="workbench-breadcrumb"><span className="workbench-breadcrumb-project">A4 Note</span></div><div className="workbench-document-controls" ref={t.setControlsHost}/><div className="workbench-topbar-actions"/></header>;}
function Fixture(){const [active,setActive]=useState(true);window.__setSceneActive=setActive;
useEffect(()=>{window.__gestures=[];return bindWindowTitlebarGestures(document.querySelector('.window-titlebar'),command=>window.__gestures.push(command));},[]);
return <DocumentToolbarProvider enabled={active}><DocumentToolbarActiveContext.Provider value={active}>
<div className="test-window"><WindowTitleBar sidebarCollapsed={false} onToggleSidebar={()=>{}} topBar={<Host/>}/>
<div className="test-body"><TaskShellSidebarHost/><main><TaskBoard/></main></div></div>
</DocumentToolbarActiveContext.Provider></DocumentToolbarProvider>;}

createRoot(document.getElementById('root')!).render(<Fixture/>);
`);

  const compile = async baseline => build({
    configFile: false,
    root,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: scratch,
      emptyOutDir: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry, formats: ['es'], fileName: () => baseline ? 'entry-before.js' : 'entry.js', cssFileName: baseline ? 'entry-before' : 'entry' },
    },
    plugins: [
      react(),
      {
        name: 'mock-launcher-for-multi-project',
        enforce: 'pre',
        resolveId(id) {
          if (/platform\/projectTaskLauncher$/.test(id)) return '\0test-launcher';
        },
        load(id) {
          // The former visual baseline imported the removed plan panel. Both
          // bundles intentionally use the current direct-queue TaskBoard.
          if (id === '\0test-launcher') {
            return `
export const supportsLocalTaskLaunch = () => true;
export const savedLocalTaskPort = () => 4319;
export const selectProjectFolder = async () => window.__fixture?.folderToPick ?? null;
export const launchLocalTasks = async (port = 4319, chooseProject = false, explicitPath) => {
  if (window.__fixture?.failLaunch) throw Error('启动服务异常测试');
  const targetPath = explicitPath || (chooseProject ? window.__fixture?.folderToPick : window.__fixture?.defaultPath);
  if (!targetPath) return null;
  const norm = p => String(p || '').split(String.fromCharCode(92)).join('/').toLowerCase();
  const connEntry = Object.entries(window.__fixture?.connections ?? {}).find(([k]) => norm(k) === norm(targetPath));
  const conn = connEntry ? connEntry[1] : null;
  if (!conn) throw Error('未配置的项目连接: ' + targetPath + ' vs ' + Object.keys(window.__fixture?.connections ?? {}));
  return { ...conn, projectRoot: targetPath, reused: true, onboarding: { status: 'ready' } };
};
`;
          }
        },
      },
    ],
  });

  await compile(true);
  await compile(false);

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
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1568, height: 1005, deviceScaleFactor: 1, mobile: false });

  const initScript = `
    if (!localStorage.getItem('fixture-initialized')) {
      localStorage.setItem('fixture-initialized','yes');
      localStorage.setItem('a4note.tasks.local-start.v1', JSON.stringify({ projectRoot: ${JSON.stringify(dirA)}, port:${portA} }));
    }
    window.__fixture = {defaultPath:${JSON.stringify(dirA)},folderToPick:${JSON.stringify(dirA)},connections:{
      [${JSON.stringify(dirA)}]:{url:'http://127.0.0.1:${portA}',operatorToken:'${tokenA}',projectId:'${serverA.store.access.projectId}'},
      [${JSON.stringify(dirB)}]:{url:'http://127.0.0.1:${portB}',operatorToken:'${tokenB}',projectId:'${serverB.store.access.projectId}'}
    }};
  `;
  await rpc('Page.addScriptToEvaluateOnNewDocument',{source:initScript});
  await rpc('Page.navigate',{url:webOrigin+'/?baseline=1'});
  await until(`!!document.querySelector('.tb-connect')`,12000);
  await click('打开项目文件夹并启动看板');
  await until(`document.querySelectorAll('.tb-card').length===3`);
  const beforeLayout = await evaluate(`({top:document.querySelector('.tb-workspace').getBoundingClientRect().top,height:document.querySelector('.tb-workspace').getBoundingClientRect().height,titlebar:document.querySelector('.window-titlebar').getBoundingClientRect().height})`);
  await screenshot('review-before-1568.png');
  await rpc('Page.navigate',{url:webOrigin});
  await until(`!!document.querySelector('.tb-connect')`,12000);
  await click('重新连接 project-alpha');
  await until(`document.querySelectorAll('.tb-card').length===3`,15000);
  ok(await evaluate(`document.querySelectorAll('.tb-stage-nav button').length===5`),'Direct queue navigation exposes overview, three workflow stages and archive history');
  ok(await evaluate(`!!document.querySelector('.window-titlebar .tb-titlebar-actions')`),'Task controls use actual shell portal');
  ok(!await evaluate(`!!document.querySelector('.tb-header .tb-titlebar-actions')`),'No duplicate page actions');
  await evaluate(`document.querySelector('.tb-titlebar-actions button').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));document.querySelector('.tb-titlebar-actions button').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0}));`);
  ok(await evaluate(`window.__gestures.length===0`),'Action buttons do not start drag or maximize');
  await evaluate(`document.querySelector('.window-titlebar-drag-zone').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));document.querySelector('.window-titlebar-drag-zone').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0}));`);
  ok(await evaluate(`window.__gestures.join(',')==='start_dragging,toggle_maximize'`),'Blank titlebar retains drag and double click');
  // Real blank strip between the stage switch and the first control to its right: the
  // gesture must fire from actual pointer coordinates, not only from the dedicated
  // drag zone (8cc3cc88 regression: the growing nav carried data-window-no-drag).
  const strip = await evaluate(`(()=>{const sw=document.querySelector('.window-titlebar .tb-stage-switch').getBoundingClientRect();const box=document.querySelector('.window-titlebar .tb-titlebar-actions');const next=[...box.querySelectorAll('button,.tb-titlebar-project,.tb-connection')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.left>=sw.right-1).sort((a,b)=>a.left-b.left)[0];return {left:sw.right,right:next?next.left:box.getBoundingClientRect().right,y:(sw.top+sw.bottom)/2}})()`);
  ok(strip.right-strip.left>=80,'Stage switch leaves a real blank strip before the next titlebar control '+JSON.stringify(strip));
  const dispatchDoubleClick = async (x,y) => {
    await evaluate(`window.__gestures=[]`);
    await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
    await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:2});
    await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:2});
    await pause(30);
    return evaluate(`window.__gestures.join(',')`);
  };
  for (const x of [strip.left+6,(strip.left+strip.right)/2,strip.right-6]) {
    const hit = await evaluate(`(()=>{const e=document.elementFromPoint(${x},${strip.y});return {tag:e.tagName,cls:e.className,noDrag:!!e.closest('[data-window-no-drag]'),control:!!e.closest('button,[role="tab"],nav')}})()`);
    ok(!hit.noDrag&&!hit.control,'Titlebar blank strip at x='+Math.round(x)+' is plain container, not a no-drag/interactive box '+JSON.stringify(hit));
    ok(await dispatchDoubleClick(x,strip.y)==='start_dragging,toggle_maximize','Real pointer on blank strip x='+Math.round(x)+' starts drag and toggles maximize');
  }
  // Use the already-active overview button so the real click keeps the board on 'all'.
  const switchBtn = await evaluate(`(()=>{const r=document.querySelector('.window-titlebar .tb-stage-switch button[aria-pressed="true"]').getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}})()`);
  ok(await dispatchDoubleClick(switchBtn.x,switchBtn.y)==='','Real pointer on a stage button never starts drag or maximize');
  await until(`document.querySelector('.tb-stage-switch').dataset.stage==='all'`);
  const gapInSwitch = await evaluate(`(()=>{const b=document.querySelectorAll('.window-titlebar .tb-stage-switch button');const a=b[0].getBoundingClientRect(),c=b[1].getBoundingClientRect();return {x:(a.right+c.left)/2,y:a.top-1}})()`);
  ok(await dispatchDoubleClick(gapInSwitch.x,gapInSwitch.y)==='','Padding inside the stage switch stays part of the control (no drag)');
  await evaluate(`window.__gestures=[]`);
  await evaluate(`window.__setSceneActive(false)`);await pause(60);
  ok(!await evaluate(`!!document.querySelector('.tb-titlebar-actions')`),'Inactive scene does not contribute controls');
  await evaluate(`window.__setSceneActive(true)`);await pause(60);
  await screenshot('review-titlebar-1568.png');
  const metrics = await evaluate(`({viewport:innerWidth,titlebar:document.querySelector('.window-titlebar').getBoundingClientRect().height,boardTop:document.querySelector('.tb-stage-workspace').getBoundingClientRect().top,boardHeight:document.querySelector('.tb-stage-workspace').getBoundingClientRect().height})`);
  records.push({before:beforeLayout,after:metrics});
  ok(metrics.boardTop<=beforeLayout.top,'Direct queue board keeps the compact workspace position '+JSON.stringify({before:beforeLayout,after:metrics}));
  const columns = await evaluate(`[...document.querySelectorAll('.tb-column')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,width:r.width,right:r.right}})`);
  ok(columns.length===3,'Overview keeps the three direct workflow stages');
  ok(await evaluate(`![...document.querySelectorAll('.tb-board .tb-column')].some(e=>e.classList.contains('tb-archived'))`),'Archived tasks stay out of the overview board');
  ok(await evaluate(`[...document.querySelectorAll('.tb-board .tb-column h2')].map(e=>e.textContent.trim().slice(0,-1)).join('|')==='任务队列|正在进行|待检查效果'`),'Overview uses queue, execution and review columns');
  const gaps = columns.slice(1).map((c,i)=>c.left-(columns[i].left+columns[i].width));
  ok(gaps.every(g=>g>=0 && g<24),'No unused large gaps between columns');
  ok(columns.at(-1).right>1200,'Last column uses remaining width rather than stopping at 420px');

  const changeStage = async stage => {
    await evaluate(`document.querySelectorAll('.tb-stage-nav button')[${['all','queued','in_progress','review','archived'].indexOf(stage)}].click()`);
    await until(`document.querySelector('.tb-stage-switch').dataset.stage===${JSON.stringify(stage)}`);
    await pause(100);
  };
  const input = async (selector,value) => {
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(50);
  };
  for (const stage of ['all','queued','in_progress','review','archived']) {
    await changeStage(stage);
    if(stage!=='all') {
      ok(await evaluate(`document.querySelectorAll('.tb-stage-row').length===1`),'Only target stage '+stage);
      ok(await evaluate(`document.querySelector('.tb-stage-row').textContent.includes(${JSON.stringify('阶段任务-'+stage)})`),'Correct identity '+stage);
    }
    await screenshot('stage-'+stage+'.png');
  }
  await changeStage('review');
  await evaluate(`document.querySelector('.tb-stage-task-title').click()`);
  await until(`!!document.querySelector('.tb-stage-review .tb-review-summary')`);
  ok(!await evaluate(`!!document.querySelector('dialog[open]')`),'Review selection uses large inline evidence workspace');
  // The stage evidence summary must present the developer's report as developer-provided evidence and
  // never as an independent verdict (TaskReviewSummary.tsx): provenance in the meta line, the always-visible
  // caution note, no verdict wording, and the structured-verdict caveat one disclosure away. The predicate
  // is also run against a tampered clone so the assertion can never pass vacuously.
  const reviewHonesty = `(root=>{if(!root)return {ok:false,reason:'summary missing'};const meta=root.querySelector('.tb-review-meta');const caution=root.querySelector('.tb-review-caution[role="note"]');const text=root.textContent;const disclosure=[...root.querySelectorAll('.tb-secondary-disclosure')].find(b=>b.textContent.includes('证据说明与限制'));const reasons=[];if(!meta||!meta.textContent.includes('开发 Agent'))reasons.push('no developer provenance');if(!caution||!caution.textContent.includes('开发自述不等于独立验收'))reasons.push('caution note missing');if(/独立验收通过|验收通过|验收已通过|已通过验收/.test(text))reasons.push('verdict wording present');if(!disclosure)reasons.push('provenance disclosure missing');return {ok:reasons.length===0,reasons,meta:meta?.textContent,caution:caution?.textContent};})`;
  const honest = await evaluate(`(${reviewHonesty})(document.querySelector('.tb-stage-review .tb-review-summary'))`);
  ok(honest.ok,'Developer report is labelled as developer-provided evidence, not independent approval '+JSON.stringify(honest));
  const tampered = await evaluate(`(()=>{const clone=document.querySelector('.tb-stage-review .tb-review-summary').cloneNode(true);clone.querySelector('.tb-review-caution')?.remove();const verdict=document.createElement('p');verdict.textContent='独立验收通过';clone.appendChild(verdict);return (${reviewHonesty})(clone);})()`);
  ok(!tampered.ok&&tampered.reasons.includes('caution note missing')&&tampered.reasons.includes('verdict wording present'),'Honesty predicate rejects a fabricated approval '+JSON.stringify(tampered));
  await evaluate(`[...document.querySelectorAll('.tb-stage-review .tb-review-summary .tb-secondary-disclosure')].find(b=>b.textContent.includes('证据说明与限制')).click()`);
  await until(`document.querySelector('.tb-stage-review .tb-review-summary').textContent.includes('未提供结构化独立验收评价')`);
  ok(true,'Provenance notes still state that no structured independent verdict exists');
  await evaluate(`[...document.querySelectorAll('.tb-stage-review .tb-review-summary .tb-secondary-disclosure')].find(b=>b.textContent.includes('证据说明与限制')).click()`);
  await until(`!document.querySelector('.tb-stage-review .tb-review-summary').textContent.includes('未提供结构化独立验收评价')`);
  await screenshot('stage-review-evidence.png');
  await click('打开完整详情与人工审核');
  await until(`!!document.querySelector('dialog[open] .tb-review-buttons button[aria-expanded]')`);
  ok(await evaluate(`document.querySelector('.tb-detail-tabs button[aria-pressed="true"]').textContent==='验收与证据'`),'Review opens on evidence rather than long requirements');
  ok(await evaluate(`document.querySelectorAll('.tb-detail-tabs button').length===4`),'Four explicit detail sections without a plan tab');
  await screenshot('review-evidence-first.png');
  // The feedback textarea sits behind the explicit「需要调整」toggle (TaskBoard.tsx tb-feedback-panel); open it first.
  ok(!await evaluate(`!!document.querySelector('dialog[open] textarea[aria-label="调整意见"]')`),'Feedback textarea stays collapsed until requested');
  await click('需要调整');
  await until(`!!document.querySelector('dialog[open] textarea[aria-label="调整意见"]')`);
  await input('textarea[aria-label="调整意见"]','保留我的反馈');
  await click('任务要求');
  ok(await evaluate(`!document.querySelector('section[aria-label="任务要求与验收标准"]').hidden`),'Requirements section reachable');
  await click('完整历史');
  ok(await evaluate(`document.querySelector('section[aria-label="任务历史原始记录"]').textContent.includes('提交交付')`),'History uses real submitted event');
  await click('验收与证据');
  ok(await evaluate(`document.querySelector('textarea[aria-label="调整意见"]').value==='保留我的反馈'`),'Switch sections preserves pending feedback');

  await evaluate(`window.confirm=()=>false;document.querySelector('button[aria-label="关闭任务详情"]').click()`);
  ok(await evaluate(`!!document.querySelector('dialog[open]')`),'Cancel preserves review feedback');
  ok(await evaluate(`document.querySelector('textarea[aria-label="调整意见"]').value==='保留我的反馈'`),'Feedback not lost');
  await evaluate(`window.confirm=()=>true;document.querySelector('button[aria-label="关闭任务详情"]').click()`);
  await until(`!document.querySelector('dialog[open]')`);
  await changeStage('queued');
  await input('input[aria-label="搜索任务或Agent"]','不存在');
  ok(await evaluate(`document.querySelector('.tb-stage-empty').textContent.includes('没有符合')`),'Filter empty distinguished');
  ok(await evaluate(`document.querySelector('.tb-stage-heading > span').textContent==='匹配 0 / 阶段总数 1'`),'Counts keep the queued stage total under an empty filter');
  await changeStage('in_progress');
  ok(await evaluate(`document.querySelector('input[aria-label="搜索任务或Agent"]').value===''`),'Stage search is independently remembered');
  await changeStage('queued');
  ok(await evaluate(`document.querySelector('input[aria-label="搜索任务或Agent"]').value==='不存在'`),'Stage search restores');
  await input('input[aria-label="搜索任务或Agent"]','');

  // A real server transition, including a competing claim, while the UI subscribes to SSE.
  let task = fixtureTasks.queued;
  task = await apiCall(portA,worker.sessionToken,'PATCH','/tasks/'+task.id,{action:'claim',revision:task.revision});
  const second = await apiCall(portA,serverA.store.access.enrollmentToken,'POST','/join',{alias:'竞争执行者'});
  const conflict = await fetch(`http://127.0.0.1:${portA}/api/tasks/${task.id}`,{method:'PATCH',headers:{Authorization:'Bearer '+second.sessionToken,'Content-Type':'application/json'},body:JSON.stringify({action:'claim',revision:task.revision})});
  ok(conflict.status===409,'Competing claim denied');
  await until(`document.querySelector('.tb-stage-empty')?.textContent.includes('暂无任务')`);
  task = await apiCall(portA,worker.sessionToken,'PATCH','/tasks/'+task.id,{action:'submit',revision:task.revision,result:'阶段流转验证'});
  await changeStage('review');
  await until(`document.querySelectorAll('.tb-stage-row').length===2`);
  await evaluate(`([...document.querySelectorAll('.tb-stage-task-title')].find(e=>e.textContent==='阶段任务-queued')).click()`);
  await until(`document.querySelector('.tb-review-summary')?.textContent.includes('阶段流转验证')`);
  task = await apiCall(portA,tokenA,'PATCH','/tasks/'+task.id,{action:'archive',revision:task.revision});
  await until(`!!document.querySelector('.tb-stage-moved')`);
  ok(!await evaluate(`document.querySelector('.tb-stage-review')?.textContent.includes('阶段流转验证')`),'External transition hides stale review actions/evidence');
  await click('前往任务当前阶段');
  await until(`document.querySelectorAll('.tb-stage-row').length===2`);
  ok(await evaluate(`document.querySelector('.tb-stage-switch').dataset.stage==='archived'`),'Follow task to new stage');

  // Each project's stage/search survives switches; no data from the previous project is shown.
  await input('input[aria-label="搜索任务或Agent"]','阶段任务');
  await evaluate(`window.__fixture.folderToPick=${JSON.stringify(dirB)}`);
  await evaluate(`document.querySelector('[aria-label=\"打开已有项目文件夹\"]').click()`);
  await until(`document.querySelectorAll('.tb-card').length===1`);
  ok(await evaluate(`document.querySelector('.tb-stage-switch').dataset.stage==='all'`),'New project defaults to overview');
  ok(!await evaluate(`document.body.innerText.includes('阶段任务-')`),'No previous project evidence');
  await changeStage('queued');
  await evaluate(`([...document.querySelectorAll('.tb-project-item')].find(e=>e.textContent.includes('project-alpha'))).querySelector('.tb-project-item-main').click()`);
  await until(`document.querySelector('.tb-stage-switch')?.dataset.stage==='archived'`);
  ok(await evaluate(`document.querySelector('input[aria-label="搜索任务或Agent"]').value==='阶段任务'`),'Project-scoped query restored');
  await rpc('Page.reload');
  await until(`!!document.querySelector('.tb-connect')`);
  await evaluate(`window.__fixture.folderToPick=${JSON.stringify(dirA)}`);
  await click('打开项目文件夹并启动看板');
  await until(`document.querySelector('.tb-stage-switch')?.dataset.stage==='archived'`,15000);
  ok(await evaluate(`document.querySelectorAll('.tb-stage-row').length===2`),'Refresh restores stage and query');
  await input('input[aria-label="搜索任务或Agent"]','');
  // Shell declares min-width:980 CSS px. At 125% this needs 1225 physical px.
  // Below that is an existing shell limitation, not silently hidden by test CSS.
  for(const [width,zoom] of [[1568,1],[1568,1.25],[1280,1],[1280,1.25],[980,1],[1225,1.25]]) {
    await rpc('Emulation.setDeviceMetricsOverride',{width,height:1005,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.style.zoom=${zoom}`);
    await pause(80);
    const layout = await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.tb-stage-nav button')].map(b=>getComputedStyle(b).fontSize)})`);
    if(layout.scroll>layout.width+2) console.log('OVERFLOW',JSON.stringify({width,zoom,layout,offenders:await evaluate(`[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,min:getComputedStyle(e).minWidth,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+2).slice(0,20)`)}));
    ok(layout.scroll<=layout.width+2,'No page overflow '+width+' / '+zoom);
    ok(layout.buttons.length===5,'All direct-flow stage entries retained '+width+' / '+zoom);
  }
  await evaluate(`document.documentElement.style.zoom=1`);
  await screenshot('stage-responsive.png');

  ok(errors.length === 0, 'Zero browser runtime errors: ' + JSON.stringify(errors));
  fs.writeFileSync(path.join(evidence, 'stage-integration-results.json'), JSON.stringify({ passed: true, checks, records }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} catch (e) {
  let html='';try{html=await evaluate('document.body.innerHTML')}catch{};console.error(e);console.log('BROWSER_ERRORS:',JSON.stringify(errors));console.log('DOM_HTML:',html.slice(0,1000));
  fs.writeFileSync(path.join(evidence, 'stage-integration-results.json'), JSON.stringify({ passed: false, checks, error: String(e) }, null, 2));
  process.exitCode = 1;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) browser.kill();
  if (serverA) { serverA.server.closeAllConnections(); await serverA.close(); }
  if (serverB) { serverB.server.closeAllConnections(); await serverB.close(); }
  if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}
