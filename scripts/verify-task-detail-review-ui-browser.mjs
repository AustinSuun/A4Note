// Real TaskBoard + isolated synthetic task service in headless Chrome.
// Harness shape follows scripts/verify-task-modal-review-ui-browser.mjs (shared workspace, qingcheng);
// scenarios and assertions here cover task ab3806ec: review-first detail dialog, compact compare chips,
// collapsed feedback, 44px archive action and an isolated destructive zone.
// Usage: MODAL_PHASE=before|after node scripts/verify-task-detail-review-ui-browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createTaskServer } from '../apps/project-tasks/server.mjs';

const root = process.cwd();
const phase = process.env.MODAL_PHASE === 'before' ? 'before' : 'after';
const evidence = path.join(root, '.tmp/detail-review-ui', phase);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-review-ui-'));
const privateDir = path.join(scratch, 'private');
fs.mkdirSync(privateDir, { recursive: true });

let browser, ws, web, taskServer;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const ok = (condition, name, detail) => {
  checks.push({ name, passed: !!condition, detail });
  if (phase === 'after') assert.ok(condition, name + (detail ? ' ' + JSON.stringify(detail) : ''));
};
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const until = async (expression, timeoutMs = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await pause(100); }
  throw Error('Condition timed out: ' + expression + ' errors=' + JSON.stringify(pageErrors.slice(0, 3)));
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const click = async text => {
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button, summary')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}));if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);
  await frame();
};
const screenshot = async name => {
  fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const setViewport = async (width, height, zoom = 1) => {
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.documentElement.style.zoom=${zoom}`);
  await frame();
};

// Deterministic screenshot-like PNGs (no external fixtures needed); real screenshots can be supplied via DETAIL_UI_SAMPLES=a.png;b.png
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); const o = y * (width * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mockShot = (seed, width = 1280, height = 800) => png(width, height, (x, y) => {
  if (y < 48) return [36 + seed * 20, 74, 60];
  if (x < 220) return [241, 244, 242];
  const row = Math.floor((y - 48) / 28), col = x - 240;
  if (row % 2 === 0 && col > 0 && col < 260 + (row * 37 + seed * 13) % 500 && (y - 48) % 28 > 8 && (y - 48) % 28 < 20) return [70, 80, 76];
  const dx = x - 700, dy = y - 420, r = Math.hypot(dx, dy);
  if (seed === 1 && r > 118 && r < 126) return [220, 40, 40];
  return [255, 255, 255];
});
const samples = (process.env.DETAIL_UI_SAMPLES || '').split(';').filter(Boolean).map(p => path.resolve(p)).filter(p => fs.existsSync(p));
const sampleBase64 = i => (samples[i] ? fs.readFileSync(samples[i]) : mockShot(i)).toString('base64');

try {
  web = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.endsWith('.js') || p.endsWith('.css')) {
      res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(scratch, path.basename(p))));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/entry.css">
<style>html,body,#root{height:100%;margin:0}body{font-family:'Microsoft YaHei',-apple-system,sans-serif}.test-window{height:100%;display:flex;flex-direction:column}.test-titlebar{height:36px;flex-shrink:0;padding:0 16px;display:flex;align-items:center;gap:12px;background:#fafbfa;color:#567163;font-size:12px;border-bottom:1px solid #edf0ee}.test-body{display:flex;flex:1;min-height:0}.test-body main{flex:1;min-width:0}</style>
<div id="root"></div><script>window.process={env:{},platform:'win32'};</script><script type="module" src="/entry.js"></script>`);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const webOrigin = `http://127.0.0.1:${web.address().port}`;

  taskServer = createTaskServer({ dataDir: privateDir, project: 'Aster · 详情弹窗样例', origins: [webOrigin] });
  await new Promise(r => taskServer.server.listen(0, '127.0.0.1', r));
  const serverPort = taskServer.server.address().port;
  const operatorToken = taskServer.store.access.operatorToken;
  const api = async (p, method = 'GET', body, token = operatorToken) => {
    const r = await fetch(`http://127.0.0.1:${serverPort}/api${p}`, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!r.ok) throw Error(`${method} ${p} -> ${r.status} ${text.slice(0, 200)}`);
    return json;
  };
  const worker = await api('/join', 'POST', { alias: '样例执行', role: 'worker' }, taskServer.store.access.enrollmentToken);
  const asWorker = (p, body) => api(p, 'PATCH', body, worker.sessionToken);
  // Workers may only add result evidence to their own task; reference material comes from the human operator.
  const attach = async (id, file) => api(`/tasks/${id}/attachments`, 'POST', { revision: (await api('/tasks/' + id)).revision, ...file }, file.purpose === 'result' ? worker.sessionToken : operatorToken);
  const longResult = '# 交付说明\n\n已按要求完成详情弹窗排版：验收图片成为主体，选择控件改为紧凑角标；反馈框默认收起，点击“需要调整”后展开。\n\n## 验证\n\n- 组件回归 37 项通过；\n- 隔离浏览器 1366×768 与 1568×1005 各状态截图见附件；\n- 生产构建通过。\n\n## 未覆盖\n\n- 安装版与真实原生窗口未测；深色主题仅抽样。\n' + '补充说明：'.repeat(60);
  const seedReview = async (title, options) => {
    const created = await api('/tasks', 'POST', { title, description: options.description, acceptance: options.acceptance, priority: 'high' });
    await asWorker(`/tasks/${created.id}`, { action: 'claim', revision: created.revision });
    await asWorker(`/tasks/${created.id}`, { action: 'progress', revision: (await api('/tasks/' + created.id)).revision, progress: '正在隔离浏览器中核对详情弹窗排版' });
    for (const file of options.files ?? []) await attach(created.id, file);
    // Operator-added reference material bumps the spec; the worker acknowledges it before submitting.
    await asWorker(`/tasks/${created.id}`, { action: 'acknowledge', revision: (await api('/tasks/' + created.id)).revision });
    await asWorker(`/tasks/${created.id}`, { action: 'submit', revision: (await api('/tasks/' + created.id)).revision, result: options.result });
    return created.id;
  };
  const richId = await seedReview('任务详情弹窗 UI 精细优化：突出验收效果、放大图片与主操作、收起反馈框（合成样例，标题较长用于换行检查）', {
    description: '用户主要看验收的实际效果，不愿阅读密集的过程信息。以效果图片、简短结果结论和明确的验收操作为视觉中心。\n\n1. 验收图片成为主体；\n2. 默认不常驻大面积反馈框；\n3. 归档与删除隔离。',
    acceptance: '1. 效果图与结论成为视觉主体；\n2. 常驻反馈框消失；\n3. 归档按钮 ≥44px 且与删除隔离。',
    result: longResult,
    files: [
      { name: 'after-evidence-default-1366x768.png', purpose: 'result', caption: '修改后：验收页默认态（隔离 Chrome，1366×768）', base64: sampleBase64(0) },
      { name: 'after-feedback-open-with-a-very-long-file-name-to-check-ellipsis-and-wrapping-behaviour.png', purpose: 'result', caption: '修改后：点击“需要调整”后展开反馈面板；说明文字较长时最多显示两行，完整内容见悬停提示。', base64: sampleBase64(1) },
      { name: 'user-marked-reference.png', purpose: 'reference', caption: '用户原始标注截图', base64: sampleBase64(2) },
      { name: 'mcp-task-detail-review-ui-report.md', purpose: 'result', caption: '交付报告', base64: Buffer.from('# report\n').toString('base64') },
    ],
  });
  const plainId = await seedReview('无截图的待检查任务（用于空态与退回流程）', { description: '仅文字交付。', acceptance: '按说明核对。', result: '文字结论：已完成配置调整，无界面变化。' });
  const queued = await api('/tasks', 'POST', { title: '排队中的任务（无验收操作，只有更多操作）', description: '尚未领取。', acceptance: '无。', priority: 'normal' });

  // The entry must live under the project root so Vite resolves react/react-dom from this worktree.
  const harness = path.join(evidence, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  const entry = path.join(harness, 'entry.tsx');
  fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskBoard } from '/src/features/taskboard/TaskBoard';
import { TaskShellSidebarHost } from '/src/features/taskboard/TaskShellSidebar';
import { DocumentToolbarProvider, useDocumentToolbar } from '/src/workbench/DocumentToolbar';
import '/src/features/explorer/markdown-mode-switch.css';
function Shell() {
  const toolbar = useDocumentToolbar();
  return <div className="test-window">
    <header className="workbench-topbar test-titlebar"><span>隔离合成样本 · 非真实任务</span><div className="workbench-document-controls" ref={toolbar.setControlsHost} /></header>
    <div className="test-body"><aside style={{ width: 240, display: 'flex', flexDirection: 'column' }}><TaskShellSidebarHost /></aside><main><TaskBoard /></main></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<DocumentToolbarProvider enabled><Shell /></DocumentToolbarProvider>);
`);
  await build({
    configFile: false, root, logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.platform': JSON.stringify('win32'), 'process.env': '{}' },
    build: { outDir: scratch, emptyOutDir: false, minify: true, lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' }, rollupOptions: { external: [] } },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    plugins: [react(), {
      name: 'mock-launcher', enforce: 'pre',
      resolveId(id) { if (/platform\/projectTaskLauncher$/.test(id)) return '\0test-launcher'; },
      load(id) {
        if (id !== '\0test-launcher') return;
        return `export const supportsLocalTaskLaunch = () => true;
export const savedLocalTaskPort = () => ${serverPort};
export const selectProjectFolder = async () => 'd:/workspace/aster';
export const launchLocalTasks = async () => ({ url: 'http://127.0.0.1:${serverPort}', operatorToken: '${operatorToken}', projectId: '${taskServer.store.access.projectId}', projectRoot: 'd:/workspace/aster', reused: true, onboarding: { status: 'ready' } });`;
      },
    }],
  });

  const exe = process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  assert.ok(exe, 'Chrome or Edge required');
  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.clear();localStorage.setItem('a4note.tasks.local-start.v1',JSON.stringify({projectRoot:'d:/workspace/aster',port:${serverPort}}));}catch{}
window.__fixture={defaultPath:'d:/workspace/aster',connections:{'d:/workspace/aster':{url:'http://127.0.0.1:${serverPort}',operatorToken:'${operatorToken}',projectId:'${taskServer.store.access.projectId}'}}};
window.__confirms=[];window.__confirmAnswer=true;window.confirm=m=>{window.__confirms.push(m);return window.__confirmAnswer;};` });
  await setViewport(1366, 768);
  await rpc('Page.navigate', { url: webOrigin });
  await until(`!!document.querySelector('.tb-start-local') || document.querySelectorAll('.tb-card, .tb-stage-row').length>0`);
  if (await evaluate(`!!document.querySelector('.tb-start-local')`)) await click('打开项目文件夹并启动看板');
  await until(`document.querySelectorAll('.tb-card, .tb-stage-row').length >= 3`);
  await pause(300);

  const openTask = async id => {
    await evaluate(`(()=>{const card=[...document.querySelectorAll('.tb-card, .tb-stage-row')].find(c=>c.dataset.taskId===${JSON.stringify(id)}||c.textContent.includes(${JSON.stringify(id.slice(0, 8))}));(card?.querySelector('button')??card??[...document.querySelectorAll('.tb-card, .tb-stage-row')][0]).click()})()`);
    await until(`!!document.querySelector('.tb-detail-dialog') && !document.querySelector('.tb-detail-dialog .tb-dialog-body p')?.textContent?.startsWith('加载中')`);
    await until(`!!document.querySelector('.tb-detail-dialog .tb-detail > section:not([hidden])')`);
    await pause(400);
  };
  const cardSelector = async id => {
    // Cards do not expose ids; match by title text.
    const t = (await api('/tasks/' + id)).title;
    const find = `[...document.querySelectorAll('.tb-card, .tb-stage-row')].find(c=>c.textContent.includes(${JSON.stringify(t.slice(0, 24))}))`;
    await evaluate(`(()=>{const el=${find};if(!el)throw Error('card missing');el.click()})()`);
    try { await until(`!!document.querySelector('.tb-detail-dialog')`, 2500); }
    catch { await evaluate(`(()=>{const el=${find};(el.querySelector('button')??el).click()})()`); }
    await until(`!!document.querySelector('.tb-detail-dialog .tb-detail > section:not([hidden])')`);
    await pause(400);
  };
  const closeDialog = async () => { await evaluate(`document.querySelector('.tb-detail-dialog [aria-label="关闭任务详情"]')?.click()`); await frame(); await until(`!document.querySelector('.tb-detail-dialog')`); };
  const metrics = () => evaluate(`(()=>{
    const d=document.querySelector('.tb-detail-dialog'),b=d.querySelector('.tb-dialog-body'),z=parseFloat(document.documentElement.style.zoom||'1');
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {top:r.top/z,left:r.left/z,right:r.right/z,bottom:r.bottom/z,width:r.width/z,height:r.height/z}};
    const visible=el=>{if(!el)return false;const summary=el.closest('summary');for(let n=el.parentElement;n;n=n.parentElement){if(n.tagName==='DETAILS'&&!n.open&&!(summary&&summary.parentElement===n))return false;}return el.checkVisibility?el.checkVisibility({visibilityProperty:true,contentVisibilityAuto:true}):el.getClientRects().length>0;};
    const btn=t=>[...d.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(t));
    const archive=btn('效果满意'),adjust=btn('需要调整'),del=btn('删除任务'),more=d.querySelector('.tb-more-actions summary');
    const textarea=d.querySelector('.tb-detail-footer textarea');
    const thumb=d.querySelector('.tb-review-summary .tb-image-thumbnail'),img=thumb?.querySelector('img'),card=thumb?.closest('.tb-file'),chip=card?.querySelector('.tb-compare-chip input'),summary=d.querySelector('.tb-review-summary');
    const cardBlank=card?card.getBoundingClientRect().height/z-[...card.children].reduce((s,c)=>s+c.getBoundingClientRect().height/z,0):null;
    const bodyRect=rect(b);
    return {dialog:rect(d),vw:innerWidth/z,vh:innerHeight/z,body:{client:b.clientWidth,scroll:b.scrollWidth,height:b.clientHeight},
      archive:archive&&{...rect(archive),visible:visible(archive),font:getComputedStyle(archive).fontSize,disabled:archive.disabled},
      adjust:adjust&&{...rect(adjust),visible:visible(adjust),expanded:adjust.getAttribute('aria-expanded')},
      del:del&&{...rect(del),visible:visible(del)},more:more&&{...rect(more),visible:visible(more),open:more.parentElement.open},
      textareaVisible:visible(textarea),textareaFocused:document.activeElement===textarea,
      summaryTop:summary&&rect(summary).top,bodyBottom:bodyRect&&bodyRect.bottom,bodyTop:bodyRect&&bodyRect.top,
      thumb:thumb&&rect(thumb),imgHeight:img?img.getBoundingClientRect().height/z:null,cardBlank,chip:chip&&{...rect(chip),checked:chip.checked},
      tabs:[...d.querySelectorAll('.tb-detail-tabs button')].map(e=>({label:e.textContent.trim(),height:e.getBoundingClientRect().height/z,pressed:e.getAttribute('aria-pressed')})),
      buttons:[...d.querySelectorAll('.tb-dialog-controls button,.tb-detail-tabs button,.tb-detail-footer button')].filter(visible).map(e=>({label:e.textContent.trim(),height:e.getBoundingClientRect().height/z})),
      footerHeight:d.querySelector('.tb-detail-footer')?.getBoundingClientRect().height/z??0,fontBody:getComputedStyle(b).fontSize,title:getComputedStyle(d.querySelector('.tb-dialog-header h2')).fontSize}})()`);
  const gap = (a, b) => ({ dx: Math.max(a.left - b.right, b.left - a.right), dy: Math.max(a.top - b.bottom, b.top - a.bottom) });
  const record = {};

  await cardSelector(richId);
  ok((await evaluate(`document.querySelector('.tb-detail-tabs button[aria-pressed=true]')?.textContent`)) === '验收与证据', 'Review task opens on the evidence tab');
  const matrix = [];
  for (const [width, height] of [[1366, 768], [1568, 1005]]) for (const zoom of width === 1366 ? [1, 1.25] : [1]) for (const maximized of [false, true]) {
    await setViewport(width, height, zoom);
    const isMax = await evaluate(`document.querySelector('.tb-detail-dialog').classList.contains('is-maximized')`);
    if (isMax !== maximized) await click(maximized ? '最大化' : '还原');
    await evaluate(`document.querySelector('.tb-dialog-body').scrollTop=0`); await frame();
    const m = await metrics();
    const cell = {
      width, height, zoom, maximized,
      inViewport: m.dialog.left >= -1 && m.dialog.top >= -1 && m.dialog.right <= m.vw + 1 && m.dialog.bottom <= m.vh + 1,
      noHorizontalOverflow: m.body.scroll <= m.body.client + 1,
      archivePrimary: !!m.archive && m.archive.visible && m.archive.height >= 44 && m.archive.width >= 160,
      adjustTarget: !!m.adjust && m.adjust.height >= 40,
      noResidentTextarea: !m.textareaVisible,
      deleteCollapsed: !m.del || !m.del.visible,
      moreActionsPresent: !!m.more && m.more.visible,
      reviewFirst: m.summaryTop !== null && m.summaryTop <= m.bodyTop + 40,
      screenshotFirstScreen: !!m.thumb && m.thumb.top < m.bodyBottom && m.imgHeight >= 160,
      compactChip: !!m.chip && m.chip.width <= 24 && m.chip.height <= 24,
      cardNoBlank: m.cardBlank !== null && m.cardBlank <= 40,
      allTargets: m.buttons.every(b => b.height >= 34),
      footerBudget: m.footerHeight <= 120,
    };
    matrix.push({ ...cell, metrics: m });
    if (height >= 1000) cell.screenshotFullyVisible = !!m.thumb && m.thumb.bottom <= m.bodyBottom + 1;
    for (const [k, v] of Object.entries(cell)) if (typeof v === 'boolean' && k !== 'maximized') ok(v, `matrix ${width}x${height} z${zoom} ${maximized ? 'max' : 'normal'}: ${k}`, { archive: m.archive, footer: m.footerHeight, thumb: m.thumb, img: m.imgHeight, blank: m.cardBlank, chip: m.chip });
    if (zoom === 1) await screenshot(`evidence-${width}x${height}-${maximized ? 'max' : 'normal'}`);
  }
  record.matrix = matrix;
  await setViewport(1366, 768); if (await evaluate(`document.querySelector('.tb-detail-dialog').classList.contains('is-maximized')`)) await click('还原');

  // Other tabs at the reference size.
  for (const tab of ['任务要求', '执行记录', '完整历史']) { await click(tab); await pause(150); await screenshot('tab-' + tab); }
  await click('验收与证据'); await pause(150);

  // Feedback: hidden by default, expands on demand, collapse keeps the draft, nothing is sent until submit.
  if (phase === 'after') {
    await click('需要调整');
    let m = await metrics();
    ok(m.textareaVisible && m.textareaFocused && m.adjust.expanded === 'true', 'Feedback panel opens and focuses the textarea', { m: m.adjust });
    ok(m.archive.visible && m.archive.height >= 44, 'Archive stays available while feedback is open');
    await rpc('Input.insertText', { text: '图片下方仍有空白，请再压缩。' });
    const layout = await evaluate(`(()=>{const p=document.querySelector('.tb-feedback-panel'),t=p.querySelector('textarea');return {panel:p.getBoundingClientRect().width,textarea:t.getBoundingClientRect().width}})()`);
    ok(layout.textarea >= layout.panel * 0.8, 'Feedback textarea uses the panel width', layout);
    await screenshot('feedback-open-1366x768');
    await click('收起');
    m = await metrics();
    ok(!m.textareaVisible, 'Collapse hides the textarea');
    ok((await api('/tasks/' + richId)).status === 'review', 'Collapsing sends nothing');
    await click('需要调整');
    ok((await evaluate(`document.querySelector('.tb-detail-footer textarea').value`)) === '图片下方仍有空白，请再压缩。', 'Draft feedback survives collapse');
    await click('收起');
    await evaluate(`window.__confirmAnswer=false`);
    await evaluate(`document.querySelector('.tb-detail-dialog [aria-label="关闭任务详情"]').click()`); await frame();
    ok(!!(await evaluate(`!!document.querySelector('.tb-detail-dialog')`)) && (await evaluate('window.__confirms.at(-1)')).includes('未保存'), 'Closing with a draft asks before discarding');
    await evaluate(`window.__confirmAnswer=true`);

    // Destructive zone: collapsed by default, separated from the archive action, confirm guarded.
    await click('更多操作');
    m = await metrics();
    const separation = gap(m.del, m.archive);
    ok(m.del && m.del.visible && (separation.dx >= 160 || separation.dy >= 32), 'Delete is far from archive when revealed', { separation, del: m.del, archive: m.archive });
    ok(m.del.height >= 36, 'Delete keeps a usable target', m.del);
    await screenshot('more-actions-open-1366x768');
    await evaluate(`window.__confirmAnswer=false`);
    await click('删除任务');
    await pause(300);
    ok((await api('/tasks/' + richId)).status === 'review', 'Declined confirm leaves the task untouched');
    await evaluate(`window.__confirmAnswer=true`);
    await click('更多操作'); // collapse again

    // Narrow window: the two action groups still live in separate rows.
    await setViewport(880, 700);
    await click('更多操作');
    m = await metrics();
    const narrowGap = gap(m.del, m.archive);
    ok(m.body.scroll <= m.body.client + 1, 'Narrow dialog has no horizontal overflow');
    ok(m.archive.height >= 44 && (narrowGap.dy >= 32 || narrowGap.dx >= 160), 'Narrow layout keeps delete separated from archive', { narrowGap, del: m.del, archive: m.archive });
    await screenshot('narrow-880x700-more-open');
    await click('更多操作');
    await setViewport(1366, 768);

    // Gallery: keyboard selection, pair compare, single preview, Escape closes only the viewer.
    await evaluate(`document.querySelector('.tb-review-summary .tb-compare-chip input').focus()`);
    await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' }); await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' }); await frame();
    ok(await evaluate(`document.querySelector('.tb-review-summary .tb-compare-chip input').checked`), 'Space toggles the compare chip from the keyboard');
    await evaluate(`[...document.querySelectorAll('.tb-review-summary .tb-compare-chip input')][1].click()`); await frame();
    ok(await evaluate(`[...document.querySelectorAll('.tb-review-summary .tb-file.is-chosen')].length===2`), 'Two chosen cards are highlighted');
    await click('并排对比');
    await until(`!!document.querySelector('.tb-image-dialog .tb-image-panes.is-pair')`);
    await pause(300); await screenshot('compare-pair');
    await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await frame();
    ok(!(await evaluate(`!!document.querySelector('.tb-image-dialog')`)) && (await evaluate(`!!document.querySelector('.tb-detail-dialog')`)), 'Escape closes the viewer but keeps the detail dialog');
    await evaluate(`document.querySelector('.tb-review-summary .tb-image-thumbnail').click()`);
    await until(`!!document.querySelector('.tb-image-dialog') && !document.querySelector('.tb-image-panes.is-pair')`);
    ok(true, 'Thumbnail opens a single full-size preview');
    await click('关闭大图'); await frame();
    await evaluate(`[...document.querySelectorAll('.tb-review-summary .tb-compare-chip input')].forEach(i=>{if(i.checked)i.click()})`); await frame();
    ok(await evaluate(`[...document.querySelectorAll('.tb-review-summary .tb-compare-chip input')].every(i=>!i.checked)`), 'Chips can be cleared again');
    await closeDialog();

    // Plain review task: empty screenshot state and the real return flow.
    await cardSelector(plainId);
    m = await metrics();
    ok(!m.thumb && (await evaluate(`document.body.textContent.includes('尚未提供实际结果截图')`)), 'No-image task states the gap instead of a blank gallery');
    await screenshot('no-images-1366x768');
    await click('需要调整');
    await rpc('Input.insertText', { text: '请补充界面截图。' });
    await click('提交调整意见并退回');
    await pause(500);
    const returned = await api('/tasks/' + plainId);
    ok(returned.status !== 'review' && returned.feedback === '请补充界面截图。', 'Return-for-changes reaches the service with the feedback', { status: returned.status, feedback: returned.feedback });
    ok(!(await evaluate(`!!document.querySelector('.tb-detail-footer textarea')`)) && !(await evaluate(`!!document.querySelector('.tb-detail-footer .tb-archive')`)), 'After the return, review actions disappear and the draft is cleared');
    await closeDialog();

    // Queued task: only the collapsed destructive zone; confirm accepted deletes it.
    await cardSelector(queued.id);
    m = await metrics();
    ok(!m.archive && !m.adjust && m.more && !m.del?.visible, 'Non-review task shows only the collapsed more-actions entry');
    await screenshot('queued-footer-1366x768');
    await click('更多操作'); await click('删除任务'); await pause(500);
    ok((await evaluate('window.__confirms.at(-1)')).includes('删除'), 'Delete always asks for confirmation');
    let gone = false; try { await api('/tasks/' + queued.id); } catch { gone = true; }
    ok(gone, 'Accepted confirm deletes the queued task');
    await until(`!document.querySelector('.tb-detail-dialog')`);

    // Archive: the primary action archives and the footer disappears.
    await cardSelector(richId);
    await click('效果满意');
    await pause(500);
    ok((await api('/tasks/' + richId)).status === 'archived', 'Primary action archives the reviewed task');
    ok(!(await evaluate(`!!document.querySelector('.tb-detail-dialog .tb-detail-footer')`)), 'Archived task renders no footer bar');
    await screenshot('archived-1366x768');
    await closeDialog();
  } else {
    await screenshot('feedback-resident-1366x768');
  }
  ok(pageErrors.length === 0, 'No uncaught page errors', pageErrors.slice(0, 3));
  record.checks = checks; record.phase = phase; record.samples = samples;
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ phase, passed: checks.every(c => c.passed), checks: checks.length, failed: checks.filter(c => !c.passed).map(c => c.name), evidence }));
} catch (e) {
  fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ error: String(e), checks, pageErrors }, null, 2));
  console.error('DETAIL_REVIEW_UI_ERROR', e);
  process.exitCode = 1;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) { const exited = new Promise(r => browser.once('exit', r)); browser.kill(); await Promise.race([exited, pause(5000)]); }
  if (taskServer) { taskServer.server.closeAllConnections(); await taskServer.close(); }
  if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
  try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { console.warn('scratch cleanup:', String(e)); }
}
