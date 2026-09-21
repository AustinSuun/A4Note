// Task 05795e28 — Settings UI refactor, verified at render level.
// Mounts the real SettingsScene (production Vite build) with stubbed host props and
// drives it through headless Chrome/Edge over CDP: navigation keyboard support,
// label/ARIA wiring, live regions, global search, `initialSection` syncing, the
// capture 100-row policy, and 980/1280/1440px x 10/18/32px layout.
//   node scripts/verify-settings-ui.mjs
// Evidence: .tmp/shots/settings-ui/*.png + result.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const evidence = path.join(root, '.tmp/shots/settings-ui');
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-ui-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const consoleErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const ok = (condition, name, detail) => {
  checks.push({ name, passed: !!condition, detail });
  assert.ok(condition, name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
};
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const until = async (expression, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await pause(80); }
  throw Error('Condition timed out: ' + expression + ' errors=' + JSON.stringify(pageErrors.slice(0, 3)));
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot = async name => {
  fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const pressKey = async (keyName, options = {}) => {
  const codes = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Enter: 13, ' ': 32, Tab: 9, Escape: 27 };
  const base = { key: keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName], ...options };
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await frame();
};
const activeElement = () => evaluate(`(()=>{const el=document.activeElement;if(!el)return null;return {tag:el.tagName,id:el.id||null,label:(el.textContent||'').trim().slice(0,40),section:(el.closest('[data-settings-section]')||{}).dataset?.settingsSection??null}})()`);
const clickAt = async (x, y) => {
  await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await frame();
};
const rectOf = selector => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight}})()`);
/* Real mouse input at viewport coordinates: scroll the target into view first,
   otherwise long sections (e.g. the 100-task capture list) put their buttons
   below the fold and the click lands on nothing. */
const clickSelector = async selector => {
  const first = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};})()`);
  assert.ok(first, 'missing element ' + selector);
  await frame();
  const rect = await rectOf(selector);
  assert.ok(rect.visible, 'element outside viewport after scrolling: ' + selector + ' ' + JSON.stringify(rect));
  await clickAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
};

/* The harness aliases the capture and updater platform modules so the section can
   render 0/1/100 tasks and a downloadable update without native plumbing. */
const captureStub = `
export const captureSupported = () => true;
const state = () => (window.__captureState ?? { enabled: true, enrichMetadata: true });
export const getCaptureStatus = async () => ({ ...state(), inbox: { tasks: (window.__captureTasks ?? []).map((task, index) => ({ captureId: 'c' + index, title: task.title ?? ('论文 ' + (index + 1)), state: task.state ?? 'complete', result: { libraryImported: true, library: { hasSourcePdf: true }, artifacts: [] } })) } });
export const disableCaptureBridge = async () => { (window.__captureCalls ||= []).push('disable'); };
export const revealCaptureInbox = async () => { (window.__captureCalls ||= []).push('reveal'); };
export const updateCaptureTask = async (id, action) => { (window.__captureCalls ||= []).push(['task', id, action]); };
export const setCaptureEnrichment = async value => { window.__captureState = { ...state(), enrichMetadata: value }; (window.__captureCalls ||= []).push(['enrich', value]); };
`;
const updaterStub = `
const listeners = new Set();
let snapshot = { phase: 'available', current: '0.1.25', version: '0.1.26', notes: '重要：安装前会自动备份资料库。\\n新增全局搜索。\\n修复同步错误提示。', received: 0, downloaded: false };
export const updateSnapshot = () => snapshot;
export const subscribeUpdates = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const publish = patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); };
export const checkForUpdates = async () => publish({ phase: 'latest' });
export const downloadUpdate = async () => publish({ phase: 'downloading', received: 50, total: 100 });
export const installUpdate = async () => publish({ phase: 'installing', installStep: 'backing-up' });
export const openReleases = async () => { (window.__updateCalls ||= []).push('releases'); };
`;
const entrySource = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsScene } from '/src/features/settings';
import '/src/ui/styles.css';

const pluginSettings = [
  { id: 'markdown.documentFontSize', pluginId: 'markdown', title: 'Markdown 正文字号', description: '文档正文字号', defaultValue: 18 },
  { id: 'markdown.showLineNumbers', pluginId: 'markdown', title: '显示代码行号', defaultValue: false },
];
const plugins = [
  { id: 'markdown', name: 'Markdown 文档', version: '1.2.0', trust: 'builtin', enabled: true },
  { id: 'reader', name: 'PDF 阅读器', version: '1.0.0', trust: 'trusted', enabled: false },
];
const market = { url: 'https://plugins.example/index.json', fetchedAt: '2026-09-21T08:00:00Z', records: [{ id: 'zotero-import', name: 'Zotero 导入', description: '从 Zotero 导入文献元数据', version: '0.3.0' }] };
const scenes = [{ id: 'reader', label: '阅读', pluginId: 'reader' }, { id: 'tasks', label: '任务', pluginId: 'tasks' }];
const calls = [];
window.__settingsCalls = calls;
function Harness() {
  const [section, setSection] = useState('general');
  const [settings, setSettings] = useState({ density: 'compact', theme: 'a4note', fontFamily: 'sourceHanSans', interfaceFontSize: 18, documentFontFamily: 'sourceHanSans', codeFontFamily: 'firaCode', documentLineHeight: 'relaxed', documentLayout: 'narrow', defaultReaderLayout: 'focus', metadataSourcePreference: 'crossrefFirst', onlineMetadataEnabled: true, aiProviderId: 'local-context-assistant' });
  const [sync, setSync] = useState({ supported: true, authenticated: false, username: '', pendingOperations: 3, lastSuccessAt: '2026-09-21T07:00:00Z', lastError: '上次同步被网络中断', busy: false });
  window.__settingsSetSection = setSection;
  window.__settingsSetSync = setSync;
  return <div style={{ width: '100%', minHeight: '100%' }}>
    <SettingsScene
      settings={settings}
      initialSection={section}
      pluginSettings={pluginSettings}
      pluginSettingValues={{}}
      paths={{ root: 'D:/A4Library', database: 'D:/A4Library/aster.db', files_root: 'D:/A4Library/files', backups: 'D:/A4Library/backups' }}
      diagnostics={{ product_name: 'A4 Note', version: '0.1.25', identifier: 'app.aster.research' }}
      aiProviders={[{ id: 'local-context-assistant', name: '本地上下文助手', status: 'available' }]}
      providers={[]}
      plugins={plugins}
      extensionCounts={{ commands: 12, settings: 4, views: 6, metadata: 2, translation: 1, ai: 1 }}
      scenes={scenes}
      enabledSceneIds={['reader']}
      onChange={next => { calls.push(['settings', next.interfaceFontSize]); setSettings(next); }}
      onToggleScene={(id, enabled) => calls.push(['scene', id, enabled])}
      onTogglePlugin={(id, enabled) => calls.push(['plugin', id, enabled])}
      onPluginSettingChange={(id, value) => calls.push(['pluginSetting', id, value])}
      onRefreshPaths={() => { calls.push(['refreshPaths']); return Promise.resolve(); }}
      onRevealPath={kind => calls.push(['reveal', kind])}
      onCreateBackup={() => window.__backupMode === 'fail' ? Promise.reject(new Error('备份失败：权限不足')) : Promise.resolve({ backup_path: 'D:/A4Library/backups/2026-09-21.zip' })}
      onRestoreBackup={() => Promise.resolve()}
      sync={sync}
      onSync={() => { calls.push(['sync']); return Promise.resolve(); }}
      onSyncLogin={() => { calls.push(['syncLogin']); return Promise.resolve(); }}
      onSyncLogout={() => { calls.push(['syncLogout']); return Promise.resolve(); }}
      market={market}
      localPlugins={[{ id: 'local-ocr', name: '本地 OCR', source: 'local', packagePath: 'D:/plugins/ocr.zip', status: 'verified', enabled: true }]}
      onImportPlugin={() => calls.push(['import'])}
      onMarketUrlChange={url => calls.push(['marketUrl', url])}
      onRefreshMarket={() => { calls.push(['refreshMarket']); return Promise.resolve(); }}
    />
  </div>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`;

async function main() {
  const harness = path.join(evidence, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  const entry = path.join(harness, 'entry.tsx');
  fs.writeFileSync(entry, entrySource);
  fs.writeFileSync(path.join(harness, 'capture-stub.ts'), captureStub);
  fs.writeFileSync(path.join(harness, 'updater-stub.ts'), updaterStub);

  await build({
    configFile: false, root, logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.platform': JSON.stringify('win32'), 'process.env': '{}' },
    build: { outDir: scratch, emptyOutDir: false, minify: true, lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' }, rollupOptions: { external: [] } },
    resolve: {
      alias: [
        { find: /^(.*)\/platform\/capture$/, replacement: path.join(harness, 'capture-stub.ts') },
        { find: /^(.*)\/platform\/updater$/, replacement: path.join(harness, 'updater-stub.ts') },
      ],
    },
    plugins: [react()],
  });

  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>settings ui harness</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
  web = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    const file = path.join(scratch, url);
    if (!file.startsWith(scratch) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const body = fs.readFileSync(file);
    const headers = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (/gzip/.test(req.headers['accept-encoding'] ?? '') && body.length > 4096) { headers['content-encoding'] = 'gzip'; res.writeHead(200, headers); res.end(zlib.gzipSync(body)); return; }
    res.writeHead(200, headers); res.end(body);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + web.address().port;

  const exe = process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  assert.ok(exe, 'Chrome or Edge required');
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + path.join(scratch, 'profile'), '--lang=zh-CN', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(scratch, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? a.type).join(' '));
  };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: origin + '/' });
  await until(`!!document.querySelector('.settings-section')`);
  await pause(250);

  const results = { fixture: 'real SettingsScene with stubbed host props', cases: {}, checks: 0 };
  const sectionId = () => evaluate(`document.querySelector('.settings-layout').dataset.settingsSection`);
  const setSectionProp = async value => { await evaluate(`window.__settingsSetSection(${JSON.stringify(value)})`); await frame(); await pause(120); };

  // ---------------------------------------------------------------- 1. structure
  const nav = await evaluate(`Array.from(document.querySelectorAll('.settings-section-nav button')).map(b => ({ label: b.textContent.trim(), current: b.getAttribute('aria-current'), tabIndex: b.tabIndex }))`);
  ok(nav.length === 7, '设置分类共 7 个', nav.length);
  ok(nav.filter(item => item.current === 'page').length === 1, '只有一个分类带 aria-current="page"', nav.map(item => item.current));
  ok(nav.filter(item => item.tabIndex === 0).length === 1, '分类导航使用 roving tabindex（仅当前项可 Tab 进入）', nav.map(item => item.tabIndex));
  ok(new Set(nav.map(item => item.label)).size === nav.length, '分类名称互不重复', nav.map(item => item.label));
  ok(await evaluate(`!!document.querySelector('[data-settings-section="general"].settings-section')`), 'section 容器带 data-settings-section 标记');
  results.cases.nav = nav;

  // ---------------------------------------------------------------- 2. keyboard navigation
  await evaluate(`document.querySelectorAll('.settings-section-nav button')[0].focus()`);
  await pressKey('ArrowDown');
  const afterArrow = await activeElement();
  ok(afterArrow && afterArrow.label.includes('外观'), 'ArrowDown 把焦点移到下一个分类', afterArrow);
  await pressKey('End');
  const afterEnd = await activeElement();
  ok(afterEnd && afterEnd.label.includes('关于'), 'End 跳到最后一个分类', afterEnd);
  await pressKey('Home');
  const afterHome = await activeElement();
  ok(afterHome && afterHome.label.includes('通用'), 'Home 回到第一个分类', afterHome);
  await pressKey('ArrowDown');
  await pressKey('Enter');
  ok(await sectionId() === 'appearance', 'Enter 激活焦点所在分类', await sectionId());
  const focusAfterEnter = await activeElement();
  ok(focusAfterEnter && focusAfterEnter.tag === 'BUTTON' && focusAfterEnter.label.includes('外观'), '键盘激活后焦点留在分类导航（方向键可继续使用）', focusAfterEnter);
  ok(await evaluate(`document.activeElement.getAttribute('aria-current') === 'page'`), '当前分类自身带 aria-current', await evaluate(`document.activeElement.getAttribute('aria-current')`));
  ok(await evaluate(`document.querySelector('.settings-section-heading h2').getAttribute('tabindex') === '-1'`), '分类标题可被程序化聚焦但不进入 Tab 顺序');
  await pressKey('Tab');
  const afterTab = await activeElement();
  ok(afterTab && afterTab.id === 'settings-search-input', '导航之后 Tab 顺序进入搜索框', afterTab);
  const externalFocus = await evaluate(`(async () => { window.__settingsSetSection('updates'); await new Promise(r => setTimeout(r, 200)); const el = document.activeElement; return { tag: el.tagName, section: (el.closest('[data-settings-section]') || {}).dataset?.settingsSection ?? null, id: el.id || null }; })()`);
  ok(externalFocus.tag === 'H2' && externalFocus.section === 'updates', '外部切换分类时焦点落到新分类标题', externalFocus);
  await setSectionProp('general');
  await evaluate(`document.querySelectorAll('.settings-section-nav button')[1].focus()`);
  await pressKey('Enter');
  await pause(150);
  await screenshot('01-nav-appearance');

  // ---------------------------------------------------------------- 3. labels and ARIA
  const labelAudit = await evaluate(`(() => {
    const controls = Array.from(document.querySelectorAll('.settings-section-body input, .settings-section-body select, .settings-section-body textarea'));
    const unnamed = controls.filter(el => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'));
    const search = document.getElementById('settings-search-input');
    return { total: controls.length, unnamed: unnamed.map(el => el.outerHTML.slice(0, 80)), searchNamed: !!(search.labels && search.labels.length) };
  })()`);
  ok(labelAudit.unnamed.length === 0, '当前分类所有 input/select 都有可见 label 或 ARIA 名称', labelAudit);
  ok(labelAudit.searchNamed, '全局搜索框有可见 label 关联', labelAudit.searchNamed);
  const searchName = await evaluate(`document.getElementById('settings-search-input').labels[0].textContent.trim()`);
  ok(searchName.includes('搜索设置'), '搜索框 label 文案可见', searchName);

  const toggleAudit = [];
  for (const id of ['general', 'library', 'plugins']) {
    await setSectionProp(id);
    const toggles = await evaluate(`Array.from(document.querySelectorAll('.settings-section-body .settings-toggle, .settings-section-body .plugin-runtime-toggle')).map(el => { const r = el.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height) }; })`);
    toggleAudit.push({ id, count: toggles.length, toggles });
    ok(toggles.every(target => target.height >= 32 && target.width >= 32), `${id} 分类的开关/复选框行点击目标不小于 32x32`, toggles);
  }
  ok(toggleAudit.some(entry => entry.count > 0), '至少一个分类包含整行开关（通用/资料库/插件）', toggleAudit.map(entry => ({ id: entry.id, count: entry.count })));
  results.cases.toggles = toggleAudit.map(entry => ({ id: entry.id, count: entry.count }));

  // ---------------------------------------------------------------- 4. live regions (backup success + error)
  await setSectionProp('library');
  await evaluate(`window.__backupMode = 'ok'`);
  await clickSelector('#setting-backup');
  await until(`!!document.querySelector('#library-backup-status[role="status"]')`);
  const successStatus = await evaluate(`document.querySelector('#library-backup-status').textContent.trim()`);
  ok(successStatus.includes('备份已创建'), '备份成功写入 live region', successStatus);
  const statusCount = await evaluate(`document.querySelectorAll('.settings-section-body [role="status"]').length`);
  await clickSelector('#setting-backup');
  await pause(200);
  const statusCountAfter = await evaluate(`document.querySelectorAll('.settings-section-body [role="status"]').length`);
  ok(statusCountAfter === statusCount, '重复操作不会堆叠 live region 节点', { before: statusCount, after: statusCountAfter });
  await evaluate(`window.__backupMode = 'fail'`);
  await clickSelector('#setting-backup');
  await until(`!!document.querySelector('#library-backup-status[role="alert"]')`);
  const errorStatus = await evaluate(`document.querySelector('#library-backup-status').textContent.trim()`);
  ok(errorStatus.includes('备份失败'), '失败状态用 role="alert" 播报', errorStatus);
  await screenshot('02-library-backup-status');
  await evaluate(`window.__backupMode = 'ok'`);

  // ---------------------------------------------------------------- 5. capture 100-row policy
  await evaluate(`window.__captureTasks = Array.from({ length: 100 }, (_, i) => ({ title: '采集论文 ' + (i + 1), state: i % 5 === 0 ? 'failed' : 'complete' }))`);
  await setSectionProp('appearance');
  await setSectionProp('library');
  await until(`!!document.querySelector('[data-capture-total]')`, 20000);
  await pause(3400);
  const capture100 = await evaluate(`(() => { const list = document.querySelector('.settings-capture-list'); const summary = document.querySelector('[data-capture-total]'); return { total: Number(summary.dataset.captureTotal), rendered: list ? Number(list.dataset.captureRendered) : 0, rows: list ? list.children.length : 0 }; })()`);
  ok(capture100.total === 100, '采集任务总数 100 条', capture100);
  ok(capture100.rendered > 0 && capture100.rendered < 100, '100 条任务不会一次性全部渲染', capture100);
  await clickSelector('.settings-capture-list + .settings-action-row button');
  await pause(200);
  const captureMore = await evaluate(`Number(document.querySelector('.settings-capture-list').dataset.captureRendered)`);
  ok(captureMore > capture100.rendered, '「显示更多」按页增加渲染行数', { before: capture100.rendered, after: captureMore });
  await evaluate(`Array.from(document.querySelectorAll('.settings-capture-list + .settings-action-row button')).find(b => b.textContent.includes('展开全部')).click()`);
  await pause(250);
  const captureAll = await evaluate(`Number(document.querySelector('.settings-capture-list').dataset.captureRendered)`);
  ok(captureAll === 100, '「展开全部」后 100 条任务都可访问', captureAll);
  await screenshot('03-capture-100-paged');
  await evaluate(`Array.from(document.querySelectorAll('.settings-capture-list + .settings-action-row button')).find(b => b.textContent.includes('收起')).click()`);
  await pause(250);
  await evaluate(`window.__captureTasks = []`);
  await setSectionProp('appearance');
  await setSectionProp('library');
  await pause(3400);
  const captureEmpty = await evaluate(`(() => ({ empty: document.querySelector('.settings-empty') ? document.querySelector('.settings-empty').textContent.trim() : '', total: document.querySelector('[data-capture-total]') ? Number(document.querySelector('[data-capture-total]').dataset.captureTotal) : -1 }))()`);
  ok(captureEmpty.total === 0 && captureEmpty.empty.includes('没有采集任务'), '0 条任务显示空状态', captureEmpty);
  await evaluate(`window.__captureTasks = [{ title: '只有一条', state: 'complete' }]`);
  await setSectionProp('appearance');
  await setSectionProp('library');
  await pause(3400);
  const captureOne = await evaluate(`(() => ({ rows: document.querySelectorAll('.settings-capture-row').length, more: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('显示更多')) }))()`);
  ok(captureOne.rows === 1 && captureOne.more === false, '1 条任务只渲染一行且不显示分页按钮', captureOne);
  results.cases.capture = { capture100, captureMore, captureAll, captureEmpty, captureOne };

  // ---------------------------------------------------------------- 6. global search
  await evaluate(`(() => { const input = document.getElementById('settings-search-input'); input.focus(); input.value = ''; return true; })()`);
  await rpc('Input.insertText', { text: '字号' });
  await frame();
  await until(`document.querySelectorAll('.settings-search-results [role="option"]').length > 0`);
  const hits = await evaluate(`Array.from(document.querySelectorAll('.settings-search-results [role="option"]')).map(b => b.textContent.trim())`);
  ok(hits.some(hit => hit.includes('界面字号')), '搜索“字号”命中界面字号', hits);
  ok(hits.length <= 12, '搜索结果数量受控', hits.length);
  await pressKey('ArrowDown');
  await pressKey('Enter');
  await pause(200);
  ok(await sectionId() === 'appearance', '回车打开搜索结果会切换到对应分类', await sectionId());
  const focusedAfterJump = await activeElement();
  ok(focusedAfterJump && focusedAfterJump.section === 'appearance', '搜索结果把焦点带到设置项所在分类', focusedAfterJump);
  const anchored = await evaluate(`(() => { const el = document.activeElement; const field = document.getElementById('setting-interface-font-size'); return { inside: !!field && (field === el || field.contains(el)), settingsQuery: document.querySelector('.settings-layout').dataset.settingsQuery }; })()`);
  ok(anchored.inside, '焦点落在匹配的设置项锚点内', anchored);
  await screenshot('04-search-jump');
  await evaluate(`(() => { const input = document.getElementById('settings-search-input'); input.focus(); input.value = ''; return true; })()`);
  await rpc('Input.insertText', { text: 'zzzz没有这个设置' });
  await frame();
  await until(`!!document.querySelector('.settings-search-empty')`);
  const emptySearch = await evaluate(`document.querySelector('.settings-search-empty').textContent.trim()`);
  ok(emptySearch.includes('没有匹配的设置'), '无结果时给出明确空状态', emptySearch);
  await pressKey('Escape');
  await pause(120);
  ok(await evaluate(`document.querySelector('.settings-search-results') === null`), 'Escape 清空搜索并收起结果');

  // ---------------------------------------------------------------- 7. initialSection sync
  await setSectionProp('sync');
  ok(await sectionId() === 'sync', '受控 initialSection 切换分类', await sectionId());
  const syncPanel = await evaluate(`(() => ({ pending: document.body.innerText.includes('待处理操作'), logout: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('退出登录')), error: document.body.innerText.includes('上次同步被网络中断'), status: !!document.querySelector('#setting-sync-status') }))()`);
  ok(syncPanel.pending, '同步界面展示待处理操作数量');
  ok(syncPanel.status, '同步界面展示同步状态分组');
  ok(syncPanel.error, '同步界面展示上一次错误');
  await evaluate(`window.__settingsSetSync({ supported: true, authenticated: true, username: 'austin', pendingOperations: 0, lastSuccessAt: '2026-09-21T07:30:00Z', busy: false })`);
  await frame(); await pause(120);
  const loggedIn = await evaluate(`(() => ({ logout: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('退出登录')), sync: !!document.getElementById('setting-sync-actions') }))()`);
  ok(loggedIn.logout && loggedIn.sync, '已登录时提供「立即同步」与「退出登录」', loggedIn);
  await screenshot('05-sync-states');
  await setSectionProp('not-a-section');
  ok(await sectionId() === 'general', '非法 initialSection 安全回退到通用', await sectionId());
  await setSectionProp('plugins');
  await evaluate(`document.querySelector('#setting-plugin-filter input').focus()`);
  await setSectionProp('about');
  const focusAfterSwitch = await activeElement();
  ok(focusAfterSwitch && focusAfterSwitch.section === 'about', '切换分类后焦点不会留在不可见控件上', focusAfterSwitch);

  // ---------------------------------------------------------------- 8. update flow sharing the model
  await setSectionProp('updates');
  const updatePanel = await evaluate(`(() => ({ notes: document.querySelectorAll('#setting-update-notes li').length, reminder: document.querySelectorAll('#setting-update-notes .settings-update-note-reminder').length, download: !!document.getElementById('setting-update-download') }))()`);
  ok(updatePanel.notes >= 2, '软件更新页渲染发行说明条目', updatePanel);
  ok(updatePanel.reminder === 1, '发行说明中的备份提醒被单独标记', updatePanel.reminder);
  ok(updatePanel.download, '提供「下载并验证更新」入口');
  await screenshot('06-updates');

  // ---------------------------------------------------------------- 9. widths x font sizes
  const layoutCases = [];
  for (const width of [980, 1280, 1440]) {
    for (const fontSize of [10, 18, 32]) {
      await rpc('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.documentElement.style.setProperty('--ui-font-size', '${fontSize}px')`);
      await setSectionProp('appearance');
      await pause(220);
      const metrics = await evaluate(`(() => {
        const layout = document.querySelector('.settings-layout');
        const nav = Array.from(document.querySelectorAll('.settings-section-nav button'));
        const clipped = Array.from(document.querySelectorAll('.settings-section-body .settings-field-label')).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim().slice(0, 24));
        const controls = Array.from(document.querySelectorAll('.settings-section-body button, .settings-section-body input, .settings-section-body select'));
        const offscreen = controls.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); }).length;
        return {
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          layoutOverflow: layout.scrollWidth - layout.clientWidth,
          navVisible: nav.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth + 1; }).length,
          navTotal: nav.length,
          clippedLabels: clipped,
          controlsOffscreen: offscreen,
        };
      })()`);
      layoutCases.push({ width, fontSize, ...metrics });
      ok(metrics.docOverflow <= 1, `${width}px / ${fontSize}px 无页面横向溢出`, metrics.docOverflow);
      ok(metrics.layoutOverflow <= 1, `${width}px / ${fontSize}px 设置区域无横向溢出`, metrics.layoutOverflow);
      ok(metrics.navVisible === metrics.navTotal, `${width}px / ${fontSize}px 分类导航全部可见`, { visible: metrics.navVisible, total: metrics.navTotal });
      ok(metrics.clippedLabels.length === 0, `${width}px / ${fontSize}px 标签文字未被裁切`, metrics.clippedLabels);
      ok(metrics.controlsOffscreen === 0, `${width}px / ${fontSize}px 控件都在视口内`, metrics.controlsOffscreen);
      if ((width === 980 || width === 1440) && (fontSize === 10 || fontSize === 32)) await screenshot(`10-layout-${width}-font${fontSize}`);
      if (width === 1280 && fontSize === 18) await screenshot('11-layout-1280-font18');
    }
  }
  results.cases.layout = layoutCases;

  // ---------------------------------------------------------------- 10. every section renders
  const sectionAudit = [];
  for (const id of ['general', 'appearance', 'library', 'plugins', 'sync', 'updates', 'about']) {
    await setSectionProp(id);
    await pause(180);
    const state = await evaluate(`(() => {
      const body = document.querySelector('.settings-section-body');
      const controls = body.querySelectorAll('input, select, button');
      const nameOf = el => (el.getAttribute('aria-label') || '').trim()
        || (el.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean).map(rid => (document.getElementById(rid) || {}).textContent || '').join(' ').trim()
        || (el.labels && el.labels.length ? Array.from(el.labels).map(label => label.textContent.trim()).join(' ').trim() : '')
        || (el.textContent || '').trim()
        || (el.getAttribute('title') || '').trim();
      const unnamed = Array.from(controls).filter(el => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && el.type !== 'hidden' && !nameOf(el));
      return { groups: body.querySelectorAll('.settings-group').length, controls: controls.length, unnamed: unnamed.map(el => el.outerHTML.slice(0, 60)), heading: document.querySelector('.settings-section-heading h2').textContent.trim() };
    })()`);
    sectionAudit.push({ id, ...state });
    ok(state.groups >= 1, `${id} 分类渲染出设置分组`, state.groups);
    ok(state.controls > 0, `${id} 分类渲染出可操作控件`, state.controls);
    ok(state.unnamed.length === 0, `${id} 分类的可命名控件都有标签`, state.unnamed);
    await screenshot(`20-section-${id}`);
  }
  results.cases.sections = sectionAudit;

  ok(pageErrors.length === 0, '没有 pageerror', pageErrors.slice(0, 3));
  ok(consoleErrors.length === 0, '没有 console error', consoleErrors.slice(0, 3));

  results.checks = checks.length;
  results.passed = checks.filter(check => check.passed).length;
  results.pageErrors = pageErrors;
  results.consoleErrors = consoleErrors;
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(results, null, 2));
  console.log(`Settings UI render checks passed: ${results.passed}/${results.checks} (screenshots in .tmp/shots/settings-ui)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} try { browser?.kill(); } catch {} try { web?.close(); } catch {} try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {} });
