// Windows isolated Chromium evidence for the reader note workbench (task 24ea34e5).
// Real reader modules (state hook, command map, geometry, entry menu, layout CSS) run in a
// synthetic host that mirrors ReaderScene's shell markup; no user profile, task service or
// native data is touched. Screenshots land in .tmp/shots/note-workbench/<run>/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

/* Generated host page: real reader modules mounted in a synthetic shell (no native data). */
const HOST_SOURCE = fs.readFileSync('scripts/fixtures/note-edge-host.tsx', 'utf8');
const HOST_HTML = "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\" /><title>note workbench harness</title>\n<style>html,body{margin:0;padding:0;background:#fff}.wb-harness{padding:8px}.wb-harness-toolbar{display:flex;gap:6px;align-items:center;margin-bottom:8px}.wb-harness-pdf{height:600px;background:#f4f6f4;border:1px solid #d8ded8;padding:8px;box-sizing:border-box}</style>\n</head>\n<body><div id=\"root\"></div><script type=\"module\" src=\"./host.tsx\"></script></body></html>\n";

const own = path.resolve('.tmp/note-workbench-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/note-workbench', run);
const screenshots = [];
const records = [];
const errors = [];
const sourceFiles = [
  'src/features/reader/ReaderScene.tsx',
  'src/features/reader/useReaderDrawerLayout.ts',
  'src/features/reader/useReaderDrawerGesture.ts',
  'src/features/reader/ReaderSideDrawer.tsx',
  'src/features/reader/reader-writing-layout.css',
  'src/ui/styles/tokens.css',
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));

function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let browserProcess = null, server = null, ws = null, seq = 0, paused = false;
const requests = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, method === 'Browser.close' ? 5000 : 30000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const pauseAll = () => { paused = true; for (const { timer } of requests.values()) clearTimeout(timer); requests.clear(); };
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception?.description || ''));
  return result.result.value;
};
const wait = async (expression) => {
  for (let index = 0; index < 150; index += 1) {
    try { if (await ev(expression)) return true; } catch { /* keep waiting */ }
    await pause(100);
  }
  throw Error('Timed out ' + expression);
};
const click = async (selector) => {
  await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});e.click();return true})()`);
  await pause(60);
};
const key = async (name, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk });
  await pause(60);
};
const shot = async (name) => {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(name);
};
const state = async () => {
  const value = await ev('window.__wbState');
  if (!value) throw Error('host state unavailable');
  return value;
};
/* Reloads and paper switches can briefly expose the previous document; poll the state
   object instead of reading it once. */
const waitState = async (predicate) => {
  for (let index = 0; index < 120; index += 1) {
    const value = await ev('window.__wbState').catch(() => null);
    if (value && (predicate ? new Function('state', 'return ' + predicate)(value) : true)) return value;
    await pause(100);
  }
  throw Error('Timed out waiting for host state: ' + predicate);
};
/* transitions run for 200ms; settle before geometry assertions */
const settle = () => pause(320);
const boxOf = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()`);
const dragBy = async (selector, dx, dy) => {
  const box = await boxOf(selector);
  if (!box) throw Error('missing ' + selector);
  const x = box.left + Math.min(6, box.width / 2), y = box.top + box.height / 2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * step) / 6, y: y + (dy * step) / 6, button: 'left', buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
  await pause(80);
};
const setViewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

try {
  fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'host.tsx'), HOST_SOURCE);
  fs.writeFileSync(path.join(own, 'host.html'), HOST_HTML);

  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(own, run + '-vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/note-workbench-browser/host.html';

  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1568,1005', 'about:blank',
  ], { stdio: 'ignore' });
  for (let index = 0; index < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); index += 1) await pause(100);
  const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await setViewport(1568, 1005);
  await send('Page.navigate', { url });
  await wait('!!window.__wbState && !!document.querySelector(".reader-note-workbench-button")');
  await ev('localStorage.clear()');
  await send('Page.reload');
  await pause(500);
  await wait('!!document.querySelector(".reader-note-workbench-button")');
  await waitState();

  check(await ev("!!document.querySelector('.reader-note-workbench-button')?.closest('.reader-workspace-shell')"), '入口属于内容区而非标题栏');
  /* 1. entry button resumes the remembered wide mode, and closes again */
  let snapshot = await state();
  check(snapshot.mode === 'reading' && snapshot.drawerOpen === false, '首次进入默认为 PDF 专注（笔记收起）', snapshot.mode);
  await click('.reader-note-workbench-button');
  await settle();
  snapshot = await state();
  check(snapshot.mode === 'split' && snapshot.drawerOpen === true, '主按钮恢复上次的宽屏模式（分屏）', snapshot.mode);
  check(/a4note\.reader\.noteWorkbench\.paper-a/.test(Object.keys(snapshot.storage).join(',')), '模式写入按论文的偏好键', Object.keys(snapshot.storage));
  const headerActionCount = await ev("document.querySelectorAll('.note-document-actions button').length");
  await click('[aria-label="笔记历史"]');check(await ev("!!document.querySelector('.note-history-marker')"),'打开把手后一次点击头部历史可达');
  await shot('01-split-entry');
  await click('.reader-note-workbench-button');
  check((await state()).mode === 'reading', '再次点击收起笔记并回到 PDF 专注');

  /* 2. menu contents + keyboard hints */
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  const menu = await ev(`(()=>{const m=document.querySelector('.reader-note-workbench-menu');return {
    items:[...m.querySelectorAll('[role=menuitemradio]')].map(i=>i.textContent),
    extras:[...m.querySelectorAll('[role=menuitem]')].map(i=>i.textContent),
    keys:[...m.querySelectorAll('.reader-note-workbench-item-key')].map(k=>k.textContent),
    shortcuts:[...m.querySelectorAll('[aria-keyshortcuts]')].map(i=>i.getAttribute('aria-keyshortcuts')),
    focused:document.activeElement&&document.activeElement.textContent,
  }})()`);
  check(menu.items.length === 4, '菜单包含四种模式（边读边记/悬浮速记/专注写作/PDF 专注）', menu.items);
  check(menu.extras.length === 1 && headerActionCount === 1, '新建在把手菜单、历史在文档头部，两次点击可达', { extras:menu.extras, headerActionCount });
  check(menu.keys.length === 4 && menu.shortcuts.every(Boolean), 'kbd 提示与 aria-keyshortcuts 反映绑定', menu.keys);
  await shot('02-menu');
  await key('ArrowDown', 'ArrowDown', 40);
  const afterArrow = await ev('document.activeElement.getAttribute("role")');
  check(afterArrow === 'menuitemradio' || afterArrow === 'menuitem', '方向键在菜单内移动焦点', afterArrow);
  await key('Escape', 'Escape', 27);
  const closed = await ev('!document.querySelector(".reader-note-workbench-menu")');
  const refocused = await ev('document.activeElement && document.activeElement.classList.contains("reader-note-workbench-button")');
  check(closed && refocused, 'Escape 关闭菜单并把焦点还给触发按钮');

  /* 3. split width honours the 34-40% default and the PDF minimum */
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  await click('.reader-note-workbench-menu [role=menuitemradio]');
  await wait('window.__wbState.mode === "split"');
  await settle();
  snapshot = await state();
  const ratio = snapshot.drawerWidth / snapshot.containerWidth;
  check(ratio >= 0.34 && ratio <= 0.4, '分屏默认宽度落在 34%-40%', ratio);
  const pdfBox = await boxOf('.wb-harness-pdf');
  check(pdfBox.width >= 520, 'PDF 保持最小可读宽度', pdfBox.width);
  const handle = await boxOf('.reader-drawer-resize-handle');
  check(!!handle && (await ev('document.querySelector(".reader-drawer-resize-handle").getAttribute("role")')) === 'separator', '侧栏存在可聚焦的分隔条', handle);

  /* 4. dragging the separator persists a per-paper ratio */
  await dragBy('.reader-drawer-resize-handle', -120, 0);
  await settle();
  snapshot = await state();
  check(snapshot.drawerWidth > ratio * snapshot.containerWidth + 60, '拖宽后侧栏变宽', snapshot.drawerWidth);
  check(Math.abs(snapshot.prefs.splitRatio - snapshot.drawerWidth / snapshot.containerWidth) < 0.06, '拖宽结果写入该论文的比例偏好', snapshot.prefs.splitRatio);
  await shot('03-split-dragged');
  const beforeB = (await ev('localStorage.getItem("a4note.reader.noteWorkbench.paper-b")'));
  check(beforeB === null, '拖动只影响当前论文的偏好');

  /* 5. floating card: geometry, drag, resize, Escape */
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  await click('.reader-note-workbench-menu [role=menuitemradio]:nth-of-type(2)');
  await wait('window.__wbState.mode === "floating"');
  await settle();
  const shellRect = await boxOf('.reader-workspace-shell');
  const cardBox = await boxOf('.reader-workspace-drawer');
  snapshot = await state();
  const localCard = { left: cardBox.left - shellRect.left, top: cardBox.top - shellRect.top, width: cardBox.width, right: cardBox.right - shellRect.left };
  check(localCard.left >= -1 && localCard.top >= -1 && localCard.right <= snapshot.containerWidth + 1, '悬浮卡完全落在内容区内', localCard);
  check(Math.abs(localCard.left - Math.min(snapshot.floatingBox.left,snapshot.containerWidth-snapshot.floatingBox.width-28)) <= 2 && Math.abs(localCard.top - snapshot.floatingBox.top) <= 2 && Math.abs(localCard.width - snapshot.floatingBox.width) <= 2, '悬浮卡几何来自共享比例并为边缘把手保留28px操作区', { localCard, expected: snapshot.floatingBox, diag: snapshot.drawerDiag });
  await shot('04-floating');
  await dragBy('.reader-note-floating-drag', -180, 90);
  await settle();
  const movedBox = await boxOf('.reader-workspace-drawer');
  check(Math.abs(movedBox.left - cardBox.left) > 100 && movedBox.top > cardBox.top, '拖动悬浮卡改变位置', { from: cardBox.left, to: movedBox.left });
  await dragBy('.reader-note-floating-resize', 120, 60);
  await settle();
  const resizedBox = await boxOf('.reader-workspace-drawer');
  check(resizedBox.width > movedBox.width + 60 && resizedBox.height > movedBox.height + 30, '拖动右下角改变卡片尺寸', { w: resizedBox.width, h: resizedBox.height });
  await shot('05-floating-resized');
  await ev('document.querySelector(".reader-note-floating-drag").focus()');
  await key('Escape', 'Escape', 27);
  check((await state()).mode === 'floating', 'Escape 落在卡片拖动钮时不误退出（层级由卡片处理）');

  /* 6. writing mode fills the content area and keeps the editor mounted */
  const modeBeforeWriting = (await state()).mode;
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  await click('.reader-note-workbench-menu [role=menuitemradio]:nth-of-type(3)');
  await waitState("state.mode === 'writing'");
  await settle();
  await ev('document.querySelector("[data-note-editor]").dataset.probe = "kept"');
  await ev('document.querySelector("[data-note-editor]").value = "写作中的草稿"; document.querySelector("[data-note-editor]").dispatchEvent(new Event("input", { bubbles: true }))');
  const writing = await ev(`(()=>{const main=document.querySelector('.reader-main-workspace');return {
    inert: main.hasAttribute('inert'), hidden: main.getAttribute('aria-hidden'),
    drawer: document.querySelector('.reader-workspace-drawer').getBoundingClientRect().width,
    editorProbe: document.querySelector('[data-note-editor]').dataset.probe,
    editorValue: document.querySelector('[data-note-editor]').value,
  }})()`);
  check(writing.inert && writing.hidden === 'true', '专注写作将 PDF 区域设为 inert/aria-hidden', writing);
  check(Math.abs(writing.drawer - snapshot.containerWidth) <= 2, '专注写作容器占满内容区', { drawer: writing.drawer, container: snapshot.containerWidth, diag: (await state()).drawerDiag });
  check(writing.editorProbe === 'kept' && writing.editorValue.includes('写作中的草稿'), '模式切换不卸载编辑器（DOM 与内容保留）');
  await shot('06-writing');
  await ev('document.querySelector("[data-note-editor]").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await settle();
  const restored = await state();
  check(restored.mode === modeBeforeWriting, 'Escape 从专注写作返回进入前的模式', { before: modeBeforeWriting, after: restored.mode });
  check(restored.prefs.wideMode === 'writing', '退出后仍记住宽屏偏好为专注写作', restored.prefs.wideMode);
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  await click('.reader-note-workbench-menu [role=menuitemradio]:nth-of-type(1)');
  await waitState("state.mode === 'split'");
  await settle();
  check((await state()).mode === 'split', '重新选择边读边记回到分屏');

  /* 7. narrow window borrows the floating card without overwriting the preference */
  await click('.wb-harness-width[data-width="900"]');
  await wait('window.__wbState.temporary === true');
  snapshot = await state();
  check(snapshot.mode === 'floating' && snapshot.requested === 'split', '980px 以下临时改用悬浮卡', { mode: snapshot.mode, requested: snapshot.requested });
  check(snapshot.prefs.mode === 'split', '窄窗不覆盖宽屏偏好', snapshot.prefs.mode);
  await shot('07-narrow-floating');
  await click('.wb-harness-width[data-width="1300"]');
  await wait('window.__wbState.temporary === false');
  check((await state()).mode === 'split', '回到宽窗后恢复用户的分屏偏好');

  /* 8. shared authoring column token */
  const column = await ev(`(()=>{const body=document.querySelector('.reader-workspace-drawer .md-body');
    const header=document.querySelector('.reader-workspace-header');
    const token=getComputedStyle(document.documentElement).getPropertyValue('--authoring-content-max-width').trim();
    return { maxWidth:getComputedStyle(body).maxWidth, width:body.getBoundingClientRect().width, header:header.getBoundingClientRect().width, token }})()`);
  check(column.token === '720px', '共享 token 定义在 tokens.css', column.token);
  check(column.maxWidth === '720px', '侧栏正文列使用共享 max-width', column.maxWidth);
  const chrome = await ev(`(()=>{const header=document.querySelector('.reader-workspace-header');const s=getComputedStyle(header);return {maxWidth:s.maxWidth,width:header.getBoundingClientRect().width}})()`);
  check(chrome.maxWidth === 'none', '标题栏等 chrome 不受正文列宽度限制', chrome);

  /* 9. motion budget and reduced motion */
  const motion = await ev(`(()=>{const drawer=document.querySelector('.reader-workspace-drawer');
    return { duration:getComputedStyle(drawer).transitionDuration, shell:getComputedStyle(document.querySelector('.reader-workspace-shell')).getPropertyValue('--note-transition-duration').trim() }})()`);
  check(/0\.2s|200ms/.test(motion.duration) && motion.shell === '200ms', '开合过渡落在 180-240ms', motion);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await ev("getComputedStyle(document.querySelector('.reader-workspace-drawer')).transitionDuration");
  check(reduced === '0s', 'prefers-reduced-motion 取消动画', reduced);
  await send('Emulation.setEmulatedMedia', { features: [] });

  /* 10. per-paper mode + active note persistence, corrupt preferences */
  await ev("document.querySelector('.reader-note-workbench-button').focus()");await key('ArrowDown','ArrowDown',40);
  await wait('!!document.querySelector(".reader-note-workbench-menu")');
  await click('.reader-note-workbench-menu [role=menuitemradio]:nth-of-type(3)');
  await wait('window.__wbState.mode === "writing"');
  await click('.wb-harness-paper[data-paper="paper-b"]');
  await wait('window.__wbState.paperId === "paper-b"');
  check((await state()).mode === 'reading', '切换到另一篇论文时使用该论文自己的模式', (await state()).mode);
  await click('.reader-note-workbench-button');
  await wait('window.__wbState.drawerOpen === true');
  await click('.wb-harness-note');
  await pause(120);
  const noteState = await state();
  check(noteState.prefs.activeNoteId === 'note-b1', '活动笔记按论文记录', noteState.prefs.activeNoteId);
  await click('.wb-harness-paper[data-paper="paper-a"]');
  await wait('window.__wbState.paperId === "paper-a"');
  check((await state()).mode === 'writing', '回到原论文恢复其模式偏好', (await state()).mode);
  await ev('localStorage.setItem("a4note.reader.noteWorkbench.paper-c", "{oops")');
  await click('.wb-harness-paper[data-paper="paper-c"]');
  await wait('window.__wbState.paperId === "paper-c"');
  check((await state()).mode === 'reading', '损坏偏好安全回退默认模式', (await state()).mode);
  await shot('08-writing-narrow-check');

  /* 11. reload restores the persisted per-paper state */
  await click('.wb-harness-paper[data-paper="paper-a"]');
  await pause(150);
  await send('Page.reload');
  const reloaded = await waitState("state.paperId === 'paper-a'");
  check(reloaded.mode === 'writing', '重启后按论文恢复模式', reloaded.mode);
  check(Math.abs(reloaded.prefs.splitRatio - 0.37) > 0.001, '重启后保留拖动过的侧栏比例', reloaded.prefs.splitRatio);

  // Boundary geometry and genuine pointer transactions (not HTMLElement.click).
  await ev("window.__edgeTest.setWidth(1300);window.__edgeTest.setMode('reading')");await settle();
  const edge = '.reader-note-edge-handle';
  const closedEdge = await boxOf(edge), shellEdge = await boxOf('.reader-workspace-shell');
  check(closedEdge.width===22 && closedEdge.height===88 && Math.abs(closedEdge.right-shellEdge.right)<1,'收起把手22×88且停靠内容右边界',{closedEdge,shellEdge});
  check(Math.abs(closedEdge.top+44-(shellEdge.top+shellEdge.height/2))<1,'把手垂直居中');
  check(await ev("!document.querySelector('.wb-harness-toolbar .reader-note-workbench-entry')"),'标题栏无笔记入口占位');
  check(await ev("document.querySelector('[data-shortcut-id=\"reader.notes.toggle\"]')?.matches('.reader-note-edge-handle')"),'快捷键锚点迁移至把手');
  await click(edge);await settle();await ev("window.__edgeTest.setMode('split')");await settle();
  const activeEdge=await boxOf(edge), asideEdge=await boxOf('.reader-workspace-drawer');
  check(activeEdge.width===16&&activeEdge.height===56&&Math.abs(activeEdge.left+8-asideEdge.left-5)<1,'打开把手16×56且骑在分隔条中心',{activeEdge,asideEdge});
  for(let i=0;i<20;i++){
    await ev("window.__edgeTest.setMode('split')");await settle();const oldWidth=(await state()).drawerWidth;
    await dragBy(edge, i%2===0?2:(i%4===1?-8:8),0);await settle();
    check(i%2===0?(await state()).mode==='reading':(await state()).mode==='split'&&(await state()).drawerWidth!==oldWidth,'连续点击/拖宽阈值无误判 '+i);
  }
  await ev("window.__edgeTest.setMode('split')");await settle();
  let rect=await boxOf(edge),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'right',buttons:2,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'right',clickCount:1});await pause(150);
  check(await ev("!!document.querySelector('.reader-note-workbench-menu')"),'右键打开模式菜单');await key('Escape','Escape',27);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await pause(450);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await pause(150);
  check(await ev("!!document.querySelector('.reader-note-workbench-menu')")&&(await state()).mode==='split','400ms长按打开菜单不误收起');await key('Escape','Escape',27);
  await ev("document.querySelector('.reader-note-edge-handle').focus()");await key('ArrowDown','ArrowDown',40);const menuEdge=await boxOf('.reader-note-workbench-menu');
  check(menuEdge.left>=0&&menuEdge.right<=1568&&menuEdge.top>=0&&menuEdge.bottom<=1005,'菜单向内展开且视口约束',menuEdge);await key('Escape','Escape',27);
  await click('.reader-note-mode-switch [aria-label="专注写作"]');await settle();const writeEdge=await boxOf(edge);
  check(Math.abs(writeEdge.left-shellEdge.left)<1,'写作态把手位于内容左边缘');await click(edge);await settle();check((await state()).mode==='split','写作把手返回进入前模式而非强制关闭');
  await ev("window.__edgeTest.setMode('floating')");await settle();
  for(const [x,y] of [[0,0],[.9,0],[0,.9],[.9,.9]]){await ev(`window.__edgeTest.setFloating({x:${x},y:${y},width:.42,height:.62})`);await settle();const c=await boxOf('.reader-workspace-drawer'),h=await boxOf(edge),d=await boxOf('.reader-note-floating-drag');check(c.right<h.left&&d.top>=shellEdge.top,'四角浮卡保留把手与拖动钮操作区 '+x+'/'+y,{c,h,d});}
  for(const zoom of [1,1.25,1.5]){await ev(`document.documentElement.style.zoom='${zoom}';document.documentElement.style.setProperty('--ui-zoom','${zoom}');window.__edgeTest.setWidth(${Math.floor(1500/zoom)});window.__edgeTest.setMode('floating')`);await settle();const h=await boxOf(edge),c=await boxOf('.reader-workspace-drawer');check(h.left>=c.right&&await ev("(()=>{const n=document.querySelector('.reader-note-edge-handle'),r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()"),'浮动卡与把手均可操作 UI'+zoom,{h,c});}
  await ev("document.documentElement.style.zoom='1';document.documentElement.style.setProperty('--ui-zoom','1');window.__edgeTest.setMode('reading')");await settle();
  const scrollBefore=await ev("document.querySelector('.pdf-document').scrollTop");rect=await boxOf(edge);await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.left+rect.width/2,y:rect.top+rect.height/2,deltaX:0,deltaY:120});await pause(150);check(await ev("document.querySelector('.pdf-document').scrollTop")>scrollBefore,'把手上滚轮继续滚动PDF');
  await ev("document.documentElement.style.zoom='1.5';document.documentElement.style.setProperty('--ui-zoom','1.5');document.querySelector('.wb-harness').style.minWidth='980px';window.__edgeTest.setWidth(1600);window.__edgeTest.setMode('floating')");await settle();await settle();
  const bounded=await boxOf(edge);check(bounded.right<=1568&&await ev("(()=>{const n=document.querySelector('.reader-note-edge-handle'),r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()"),'宿主最小宽度溢出时 Reader 自身约束在可见视口',bounded);
  check(errors.length === 0, '无运行时异常与控制台错误', errors);
} catch (error) {
  check(false, '执行失败', String(error && error.stack ? error.stack : error));
} finally {
  pauseAll();
  const after = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
  check(JSON.stringify(before) === JSON.stringify(after), '产品源码在运行期间未被修改');
  const result = {
    task: '24ea34e5',
    scope: 'real reader workbench modules + application CSS in isolated headless Chrome; synthetic host mirrors ReaderScene shell; not the packaged app',
    run,
    evidence,
    screenshots,
    passed: records.filter(record => record.passed).length,
    total: records.length,
    records,
  };
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  if (ws && ws.readyState === 1) { try { await send('Browser.close'); } catch { /* already gone */ } ws.close(); }
  if (browserProcess && !browserProcess.killed) browserProcess.kill();
  if (server) await server.close();
  console.log(JSON.stringify({ evidence, failed: records.filter(record => !record.passed), passed: result.passed, total: result.total }, null, 2));
}
if (records.some(record => record.passed === false)) process.exitCode = 1;
