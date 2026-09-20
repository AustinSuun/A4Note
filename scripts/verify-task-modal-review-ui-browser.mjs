import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createTaskServer } from '../apps/project-tasks/server.mjs';

const root = process.cwd();
const phase=process.env.MODAL_PHASE || 'after';
const scratch = path.join(root, '.tmp/qingcheng-modal-review', phase+'-'+Date.now());
const evidence = path.join(scratch, 'screenshots');
// A unique synthetic database/profile per run; never remove another worker's evidence.
fs.mkdirSync(evidence, { recursive: true });

let browser, ws, web, taskServer;
let seq = 0;
const pending = new Map();
const errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));

const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, m => {
    clearTimeout(timer);
    m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

const until = async (expression, timeoutMs = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  const errText = await evaluate(`document.querySelector('.tb-error')?.textContent || ''`);
  console.log('TIMED OUT. tb-error:', errText);
  console.log('ERRORS:', JSON.stringify(errors));
  throw Error('Condition timed out: ' + expression);
};

const click = text => evaluate(`(()=>{
  const bs = [...document.querySelectorAll('button, [role="button"]')];
  const b = bs.find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.innerText?.includes(${JSON.stringify(text)}));
  if (!b) throw Error('Button missing: ' + ${JSON.stringify(text)});
  b.click();
})()`);

const screenshot = async name => {
  const data = (await rpc('Page.captureScreenshot', { format: 'png' })).data;
  fs.writeFileSync(path.join(evidence, name), Buffer.from(data, 'base64'));
};

try {
  // 1. Web server first to determine origin
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
<link rel="stylesheet" href="/entry.css">
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:'Microsoft YaHei',-apple-system,BlinkMacSystemFont,sans-serif}
  .test-window{height:100%;display:flex;flex-direction:column}
  .test-titlebar{height:36px;flex-shrink:0;padding:0 16px;display:flex;align-items:center;background:#fafbfa;color:#567163;font-size:12px;border-bottom:1px solid #edf0ee}
  .test-body{display:flex;flex:1;min-height:0}
  .test-body main{flex:1;min-width:0}
</style>
<div id="root"></div>
<script>
  window.process = { env: {}, platform: 'win32' };
</script>
<script type="module" src="/entry.js"></script>`);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const webPort = web.address().port;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  // 2. Create isolated task server with exact origin
  const privateDir = path.join(scratch, 'private');
  fs.mkdirSync(privateDir, { recursive: true });

  taskServer = createTaskServer({
    dataDir: privateDir,
    project: 'Aster · 弹窗UI分析',
    origins: [webOrigin],
  });
  await new Promise(r => taskServer.server.listen(0, '127.0.0.1', r));
  const serverPort = taskServer.server.address().port;
  const operatorToken = taskServer.store.access.operatorToken;

  const api = async (p, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${serverPort}/api${p}`, {
      method,
      headers: {
        Authorization: 'Bearer ' + operatorToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };

  // Seed tasks: Review task with full results, feedback, events
  const tReview = await api('/tasks', 'POST', {
    title: '优化任务详情弹窗 UI：平衡按钮尺寸与突出展示审核效果',
    description: '### 任务需求背景\n\n用户反馈任务板详情弹窗存在较多排版与视觉问题：\n1. 选中按钮与次要按钮大小失衡；\n2. 字体大小层次不清，内容拥挤；\n3. 核心审核内容与交付成果未突出显示，用户难以快速完成验收评估。',
    acceptance: '1. 按钮尺寸平衡协调；\n2. 字号分级规范易读；\n3. 交付效果突出高亮；\n4. 响应式布局自适应良好。',
    priority: 'high',
  });

  // Create worker agent & advance tReview to in_progress -> review
  const workerJoin = await fetch(`http://127.0.0.1:${serverPort}/api/join`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + taskServer.store.access.enrollmentToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias: '青岚', role: 'worker' }),
  }).then(r => r.json());

  // Claim
  await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${tReview.id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + workerJoin.sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim', revision: 1 }),
  });

  // Progress
  await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${tReview.id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + workerJoin.sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'progress', revision: 2, progress: '正在开发环境中检查详情弹窗视觉与排版' }),
  });

  // Submit with result
  await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${tReview.id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + workerJoin.sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'submit',
      revision: 3,
      result: `## 交付报告与测试结论\n\n- 交付者：青岚\n- 核心工作：完成多项目管理侧栏及弹窗优化。\n- 检验指标：27项自动化测试全绿，0运行时报错。\n- 关键建议：请核对按钮尺寸平衡性与审核区高亮展示。`
    }),
  });

  // Add attachments
  const pngPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${tReview.id}/attachments`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + workerJoin.sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: (await api('/tasks/'+tReview.id)).revision,
      name: 'modal-review-result.png',
      purpose: 'result',
      caption: '交付结果截图：弹窗平衡按钮与信息层级呈现',
      base64: pngPixel,
    }),
  });
  await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${tReview.id}/attachments`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + operatorToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: (await api('/tasks/'+tReview.id)).revision,
      name: 'modal-secondary-result.png',
      purpose: 'result',
      caption: '第二份合成结果示意（不是实际前后证据）',
      base64: pngPixel,
    }),
  });

  // 3. Build Vite bundle for test harness
  const entry = path.join(scratch, 'entry.tsx');
  fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskBoard } from '/src/features/taskboard/TaskBoard';
import { TaskShellSidebarHost } from '/src/features/taskboard/TaskShellSidebar';
import { DocumentToolbarProvider, useDocumentToolbar } from '/src/workbench/DocumentToolbar';
import '/src/features/explorer/markdown-mode-switch.css';

function Shell() {
  const [visible, setVisible] = React.useState(true);
  const toolbar = useDocumentToolbar();
  return (
    <div className="test-window">
      <header className="workbench-topbar test-titlebar"><span>隔离合成样本 · 非真实任务</span>
        <button id="shell-toggle" onClick={() => setVisible(v => !v)}>项目侧栏</button>
        <div className="workbench-document-controls" ref={toolbar.setControlsHost} />
      </header>
      <div className="test-body">
        {visible && <aside style={{ width: 240, display: 'flex', flexDirection: 'column' }}><TaskShellSidebarHost /></aside>}
        <main><TaskBoard /></main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <DocumentToolbarProvider enabled><Shell /></DocumentToolbarProvider>
);
`);

  await build({
    configFile: false,
    root,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.platform': JSON.stringify('win32'),
      'process.env': '{}',
    },
    build: {
      outDir: scratch,
      emptyOutDir: false,
      lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' },
      rollupOptions: { external: [] },
    },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    plugins: [
      react(),
      {
        name: 'mock-launcher-for-inspect',
        enforce: 'pre',
        resolveId(id) {
          if (/platform\/projectTaskLauncher$/.test(id)) return '\0test-launcher';
        },
        load(id) {
          if (id === '\0test-launcher') {
            return `
export const supportsLocalTaskLaunch = () => true;
export const savedLocalTaskPort = () => ${serverPort};
export const selectProjectFolder = async () => 'd:/workspace/aster';
export const launchLocalTasks = async () => ({
  url: 'http://127.0.0.1:${serverPort}',
  operatorToken: '${operatorToken}',
  projectId: '${taskServer.store.access.projectId}',
  projectRoot: 'd:/workspace/aster',
  reused: true,
  onboarding: { status: 'ready' },
});
`;
          }
        },
      },
    ],
  });

  // 4. Launch Chromium
  const exe = process.env.TASKBOARD_TEST_BROWSER || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(p => fs.existsSync(p));

  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile,
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };

  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Mock localStorage to connect directly
  const initScript = `
    try {
      localStorage.clear();
      localStorage.setItem('a4note.tasks.local-start.v1', JSON.stringify({
        projectRoot: 'd:/workspace/aster',
        port: ${serverPort}
      }));
    } catch {}
    window.__fixture = {
      defaultPath: "d:/workspace/aster",
      connections: {
        "d:/workspace/aster": {
          url: "http://127.0.0.1:${serverPort}",
          operatorToken: "${operatorToken}",
          projectId: "${taskServer.store.access.projectId}"
        }
      }
    };
  `;
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  await rpc('Page.navigate', { url: webOrigin });

  await until(`!!document.querySelector('.tb-start-local') || !!document.querySelector('.tb-card')`, 12000);
  if (await evaluate(`!!document.querySelector('.tb-start-local')`)) {
    await click('打开项目文件夹并启动看板');
  }

  await until(`document.querySelectorAll('.tb-card').length >= 1`, 12000);
  await pause(300);

  // Click on the review card to open modal
  await evaluate(`document.querySelector('.tb-card').click()`);
  await until(`!!document.querySelector('.tb-detail-dialog')`, 8000);
  await pause(400);

  console.log('=== INSPECTION: CURRENT MODAL DOM METRICS ===');

  // Measure Modal Geometry
  const modalGeo = await evaluate(`(()=>{
    const d = document.querySelector('.tb-detail-dialog');
    const r = d.getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top, left: r.left };
  })()`);
  console.log('Modal Geometry:', JSON.stringify(modalGeo));

  // Measure Header Controls
  const headerControls = await evaluate(`(()=>{
    const btns = [...document.querySelectorAll('.tb-dialog-controls button')].map(b => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        width: r.width,
        height: r.height,
        fontSize: s.fontSize,
        padding: s.padding,
        borderRadius: s.borderRadius,
      };
    });
    return btns;
  })()`);
  console.log('Header Controls:', JSON.stringify(headerControls, null, 2));

  // Measure Navigation Tabs (Selected vs Unselected)
  const tabMetrics = await evaluate(`(()=>{
    const tabs = [...document.querySelectorAll('.tb-detail-tabs button')].map(b => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        selected: b.getAttribute('aria-pressed') === 'true',
        width: r.width,
        height: r.height,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        padding: s.padding,
        textDecoration: s.textDecoration,
        backgroundColor: s.backgroundColor,
        color: s.color,
      };
    });
    return tabs;
  })()`);
  console.log('Navigation Tabs:', JSON.stringify(tabMetrics, null, 2));

  // Measure Footer Review Action Buttons
  const footerBtns = await evaluate(`(()=>{
    const btns = [...document.querySelectorAll('.tb-review-actions button, .tb-user-actions button')].map(b => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        className: b.className,
        width: r.width,
        height: r.height,
        fontSize: s.fontSize,
        padding: s.padding,
        backgroundColor: s.backgroundColor,
      };
    });
    return btns;
  })()`);
  console.log('Footer Buttons:', JSON.stringify(footerBtns, null, 2));

  // Measure Typography Hierarchy inside Modal Body
  const typography = await evaluate(`(()=>{
    const sample = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { sel, text: el.textContent.trim().slice(0, 30), fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, color: s.color };
    };
    return [
      sample('.tb-dialog-header h2'),
      sample('.tb-dialog-subtitle'),
      sample('.tb-detail h3'),
      sample('.tb-detail .tb-prose'),
      sample('.tb-review-actions h3'),
      sample('.tb-review-actions p'),
    ].filter(Boolean);
  })()`);
  console.log('Typography:', JSON.stringify(typography, null, 2));

  await screenshot('initial-review.png');
  // 1. Capture Requirements tab
  await screenshot('current-modal-tab-requirements.png');

  // 2. Click "执行记录" tab
  await click('执行记录');
  await pause(200);
  await screenshot('current-modal-tab-execution.png');

  // 3. Click "验收与证据" tab
  await click('验收与证据');
  await pause(300);
  await screenshot('current-modal-tab-evidence.png');

  // 4. Click "完整历史" tab
  await click('完整历史');
  await pause(200);
  await screenshot('current-modal-tab-history.png');

  // 5. Click "最大化"
  await click('最大化');
  await pause(200);
  await screenshot('current-modal-maximized.png');

  // Responsive UI checks use the actual TaskBoard and an isolated synthetic API.
  const matrix=[];
  await click('还原'); await click('验收与证据');
  for (const width of [1440,1280,1024]) for (const zoom of [1,1.25]) for (const maximized of [false,true]) {
    await rpc('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.style.zoom=${zoom}`);
    const isMax=await evaluate(`document.querySelector('.tb-detail-dialog').classList.contains('is-maximized')`);
    if(isMax!==maximized)await click(maximized?'最大化':'还原');
    await evaluate(`document.querySelector('.tb-dialog-body').scrollTop=0`); await pause(80);
    const m=await evaluate(`(()=>{const d=document.querySelector('.tb-detail-dialog'),b=d.querySelector('.tb-dialog-body'),r=d.getBoundingClientRect(),summary=d.querySelector('.tb-review-summary');return {rect:r.toJSON(),vw:innerWidth,vh:innerHeight,bodyClient:b.clientWidth,bodyScroll:b.scrollWidth,bodyHeight:b.clientHeight,summaryVisible:summary.getBoundingClientRect().top<b.getBoundingClientRect().bottom,firstSection:b.querySelector('.tb-detail > section:not([hidden])')?.firstElementChild?.className,buttons:[...d.querySelectorAll('.tb-dialog-controls button,.tb-detail-tabs button,.tb-review-actions button,.tb-user-actions button')].map(e=>({label:e.textContent.trim(),height:e.getBoundingClientRect().height}))}})()`);
    const checks={viewport:m.rect.left>=-1&&m.rect.top>=-1&&m.rect.right<=m.vw+1&&m.rect.bottom<=m.vh+1,noHorizontalBodyOverflow:m.bodyScroll<=m.bodyClient+1,bodyUsable:m.bodyHeight>=120,reviewFirst:m.summaryVisible&&m.firstSection==='tb-review-summary',buttonTargets:m.buttons.every(b=>b.height/zoom>=34)};
    matrix.push({width,zoom,maximized,checks,metrics:m});
    await screenshot(`matrix-${width}-${zoom}-${maximized?'max':'normal'}.png`);
  }
  fs.writeFileSync(path.join(scratch,'matrix.json'),JSON.stringify(matrix,null,2));
  if(phase==='after')assert(matrix.every(r=>Object.values(r.checks).every(Boolean)),JSON.stringify(matrix.filter(r=>!Object.values(r.checks).every(Boolean)).map(r=>({width:r.width,zoom:r.zoom,maximized:r.maximized,checks:r.checks,rect:r.metrics.rect})),null,2));
  // Write inspection report json
  fs.writeFileSync(path.join(scratch, 'inspection-report.json'), JSON.stringify({
    modalGeo,
    headerControls,
    tabMetrics,
    footerBtns,
    typography,
  }, null, 2));

  fs.writeFileSync(path.join(root,'.tmp/qingcheng-modal-review/latest-'+phase+'.json'),JSON.stringify({scratch,phase}));
  console.log('INSPECTION COMPLETE '+scratch);
} catch (e) {
  console.error('INSPECTION_ERROR:', e);
  process.exitCode = 1;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) browser.kill();
  if (taskServer) { taskServer.server.closeAllConnections(); await taskServer.close(); }
  if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
}
