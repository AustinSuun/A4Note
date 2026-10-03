// Real-DOM regression for the library folder drag task (0d0dbaed): the real
// LibrarySceneSidebar in a real Chrome, driven by real DragEvents.
//   node scripts/verify-library-folder-drag-browser.mjs
// Evidence: .tmp/shots/library-folder-drag-browser/<run>/.
import fs from 'node:fs';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.LIBRARY_FOLDER_DRAG_FIXTURE || 'scripts/fixtures/library-folder-drag-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>library folder drag</title>'
  + '<style>body{margin:0;background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/library-folder-drag-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/library-folder-drag-browser', run);
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
  fs.writeFileSync(path.join(evidence, 'screenshots', name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(name);
};
const typeText = async (text) => { for (const char of text) await send('Input.dispatchKeyEvent', { type: 'char', text: char }); await pause(40); };
const KEYS = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
const key = async (keyName) => {
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: KEYS[keyName], nativeVirtualKeyCode: KEYS[keyName], ...(keyName === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await pause(70);
};
const click = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click();return true})()`);
const contextMenu = (folderId, action) => ev(`(()=>{
  const row=document.querySelector('[data-library-folder-id="'+${JSON.stringify(folderId)}+'"]');
  if(!row)throw Error('missing row');
  const rect=row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+30,clientY:rect.top+8}));
  return true})()`).then(async () => { await wait(`!!document.querySelector('.library-sidebar-context-menu [data-action="${action}"]')`); await click(`.library-sidebar-context-menu [data-action="${action}"]`); await pause(120); });
const calls = () => ev('window.__sidebarCalls');
const moveCalls = async () => (await calls()).filter(entry => entry[0] === 'moveFolder');
const topLevelNames = () => ev(`Array.from(document.querySelectorAll('[data-library-folder-id]')).filter(row => row.closest('.file-tree-tree-content') && !row.closest('[role="group"]')).map(row => row.textContent.trim().replace(/\\d+$/,''))`);
const rowDepth = (folderId) => ev(`document.querySelector('[data-library-folder-id="'+${JSON.stringify(folderId)}+'"]')?.closest('[data-tree-row]')?.getAttribute('data-tree-depth')`);
const rowParentGroup = (folderId) => ev(`(()=>{
  const wrap=document.querySelector('[data-library-folder-id="'+${JSON.stringify(folderId)}+'"]')?.closest('[data-tree-row]');
  const group=wrap?.closest('[role="group"]');
  if(!group)return null;
  const owner=group.parentElement?.querySelector(':scope > .file-tree-row-wrap [data-library-folder-id]');
  return owner?.dataset.libraryFolderId||'group';})()`);
const rowPadding = (folderId) => ev(`(()=>{const row=document.querySelector('[data-library-folder-id="'+${JSON.stringify(folderId)}+'"]');return row?getComputedStyle(row).paddingLeft:null})()`);

const DRAG_HELPERS = `(()=>{
  window.__dt = null;
  const rowOf = (id) => document.querySelector('[data-library-folder-id="'+id+'"]');
  const pointOf = (element, zone) => { const rect = element.getBoundingClientRect();
    return { x: rect.left + 12, y: zone === 'before' ? rect.top + 2 : zone === 'after' ? rect.bottom - 2 : rect.top + rect.height / 2 }; };
  window.__dragStart = (id) => { window.__dt = new DataTransfer(); const from = rowOf(id);
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    return window.__dt.getData('application/x-a4note-folder-id'); };
  window.__dragHover = (selector, zone) => { const to = document.querySelector(selector); if (!to) throw Error('missing ' + selector);
    const { x, y } = pointOf(to, zone);
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: x, clientY: y }));
    return true; };
  // React commits asynchronously, so the feedback is read in its own call.
  window.__dragFeedback = (selector) => { const to = selector ? document.querySelector(selector) : null;
    return { reason: (document.querySelector('[data-library-folder-drop-reason]')?.textContent || '').trim(),
             rootActive: !!document.querySelector('[data-library-folder-root-drop][data-active="true"]'),
             dropTarget: to ? (to.getAttribute('data-drop-position') || to.getAttribute('data-drop-target') || null) : null }; };
  window.__dragDrop = (selector, zone) => { const to = document.querySelector(selector); if (!to) throw Error('missing ' + selector);
    const { x, y } = pointOf(to, zone);
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: x, clientY: y })); return true; };
  window.__dragEnd = () => { window.__dt = null; return true; };
  window.__paperDrag = (selector, ids, phase) => { const to = document.querySelector(selector); const { x, y } = pointOf(to, 'inside');
    if (!window.__paperDt) { window.__paperDt = new DataTransfer(); window.__paperDt.setData('application/x-a4note-paper-ids', JSON.stringify(ids)); }
    to.dispatchEvent(new DragEvent(phase === 'drop' ? 'drop' : 'dragover', { bubbles: true, cancelable: true, dataTransfer: window.__paperDt, clientX: x, clientY: y }));
    const result = { dropTarget: to.getAttribute('data-drop-target') };
    if (phase === 'drop') window.__paperDt = null;
    return result; };
  return true; })()`;

const dragFolder = async (folderId, selector, zone) => {
  const payload = await ev(`window.__dragStart(${JSON.stringify(folderId)})`);
  await pause(160);
  await ev(`window.__dragHover(${JSON.stringify(selector)}, ${JSON.stringify(zone)})`);
  await pause(160);
  const hover = await ev(`window.__dragFeedback(${JSON.stringify(selector)})`);
  const reasonNow = (await ev(`window.__dragFeedback(null)`)).reason;
  return { payload, hover: { ...hover, reason: reasonNow }, drop: () => ev(`window.__dragDrop(${JSON.stringify(selector)}, ${JSON.stringify(zone)})`), end: () => ev('window.__dragEnd()') };
};

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
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/library-folder-drag-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=900,900', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`!!document.querySelector('.library-sidebar-folder-tree') && !!document.querySelector('[data-library-folder-id="library"]')`);
  await pause(200);
  await ev(DRAG_HELPERS);

  /* 1. Existing structure is untouched: 默认资料库 → CVPR → {核心参考, MeanFlow}.
        CVPR starts collapsed (only 默认资料库 is expanded), so open it first. */
  check((await rowParentGroup('cvpr')) === 'library', 'CVPR 仍是默认资料库的子级', await rowParentGroup('cvpr'));
  await click('[data-library-folder-id="cvpr"] [data-tree-caret]');
  await wait(`!!document.querySelector('[data-library-folder-id="core"]')`);
  check((await rowParentGroup('core')) === 'cvpr' && (await rowParentGroup('mf')) === 'cvpr', 'CVPR 仍含 核心参考/MeanFlow', [await rowParentGroup('core'), await rowParentGroup('mf')]);
  check((await rowDepth('gen')) === '0', '生成模型 在顶层', await rowDepth('gen'));
  await shot('01-before-drag');

  /* 2. 新建文件类 appears at the top level, beside 默认资料库. */
  await click('[aria-label="新建文件类"]');
  await wait(`!!document.querySelector('.library-folder-draft input')`);
  const draftParent = await ev(`document.querySelector('.library-folder-draft').getAttribute('data-library-folder-draft-parent')`);
  check(draftParent === null, '新建草稿行的父级为空（顶层）', draftParent);
  await ev(`(()=>{const i=document.querySelector('.library-folder-draft input');i.focus();i.select();return true})()`);
  await typeText('新领域');
  await key('Enter');
  await wait(`Array.from(document.querySelectorAll('[data-library-folder-id]')).some(row => row.textContent.includes('新领域'))`);
  const created = (await calls()).filter(entry => entry[0] === 'create');
  check(created.length === 1 && created[0][1] === '新领域' && created[0][2] === null, 'onCreateFolder 收到顶层父级（null）', created);
  const newFolderId = await ev(`Array.from(document.querySelectorAll('[data-library-folder-id]')).find(row => row.textContent.includes('新领域'))?.dataset.libraryFolderId`);
  check((await rowDepth(newFolderId)) === '0' && (await rowParentGroup(newFolderId)) === null, '新文件夹与默认资料库并排（顶层、无父分组）', [await rowDepth(newFolderId), await rowParentGroup(newFolderId)]);
  await shot('02-new-folder-top-level');

  /* 3. Same-level drag reorder, kept after a restart. */
  const beforeTop = await topLevelNames();
  const reorder = await dragFolder(newFolderId, `[data-library-folder-id="gen"]`, 'before');
  check(reorder.hover.dropTarget === 'before', '拖到同级上半区显示“放在其前”指示', reorder.hover.dropTarget);
  await reorder.drop(); await pause(200); await reorder.end(); await pause(120);
  const reorderCall = (await moveCalls()).at(-1);
  // index 1: 默认资料库 occupies position 0 on that level.
  check(reorderCall && reorderCall[1] === newFolderId && reorderCall[2] === null && reorderCall[3] === 1, '同级拖动提交 顶层 parentId=null, index=1', reorderCall);
  const afterTop = await topLevelNames();
  check(afterTop.indexOf('新领域') < afterTop.indexOf('生成模型') && afterTop[0].startsWith('默认资料库'), '同级顺序已改变且默认资料库仍在最前', { beforeTop, afterTop });
  await ev('window.__sidebarHost.restart()');
  await pause(200);
  check(JSON.stringify(await topLevelNames()) === JSON.stringify(afterTop), '重启（按持久化行重建）后顺序保持', await topLevelNames());
  await shot('03-reorder-persisted');

  /* 4. Drop onto a folder nests it with the right indentation. */
  const nest = await dragFolder('gen', `[data-library-folder-id="cvpr"]`, 'inside');
  check(nest.hover.dropTarget === 'inside', '拖到文件夹中部显示“放入此文件夹”', nest.hover.dropTarget);
  await nest.drop(); await pause(220); await nest.end(); await pause(120);
  const nestCall = (await moveCalls()).at(-1);
  check(nestCall && nestCall[1] === 'gen' && nestCall[2] === 'cvpr', '拖入文件夹后 parentId 为目标文件夹', nestCall);
  check((await rowParentGroup('gen')) === 'cvpr' && Number(await rowDepth('gen')) === 2, '子级出现在 CVPR 下并缩进一级', [await rowParentGroup('gen'), await rowDepth('gen')]);
  const padding = await rowPadding('gen');
  check(parseFloat(padding) >= 40, '缩进随层级增加（padding-left）', padding);
  await ev('window.__sidebarHost.restart()'); await pause(180);
  check((await rowParentGroup('gen')) === 'cvpr', '重启后仍留在 CVPR 下', await rowParentGroup('gen'));
  await shot('04-nested-with-indent');

  /* 5. Drop on the blank strip returns it to the top level. */
  const back = await dragFolder('gen', '[data-library-folder-root-drop="true"]', 'inside');
  check(back.hover.rootActive, '拖动时显示“移到顶层”放置区并高亮', back.hover.rootActive);
  await back.drop(); await pause(220); await back.end(); await pause(120);
  const backCall = (await moveCalls()).at(-1);
  check(backCall && backCall[1] === 'gen' && backCall[2] === null, '拖到空白 → 回到顶层', backCall);
  const rootTop = await topLevelNames();
  check((await rowParentGroup('gen')) === null && rootTop[rootTop.length - 1].startsWith('生成模型'), '回顶层后位于该层末尾', rootTop);
  await ev('window.__sidebarHost.restart()'); await pause(180);
  check((await rowParentGroup('gen')) === null, '重启后仍留在顶层', await rowParentGroup('gen'));
  await shot('05-back-to-top-level');

  /* 6. Cycles and 默认资料库 are refused with a reason, and nothing is submitted. */
  const movesBeforeRefusals = (await moveCalls()).length;
  const cycle = await dragFolder('cvpr', `[data-library-folder-id="core"]`, 'inside');
  check(cycle.hover.reason.includes('子文件夹'), '拖到自己的子文件夹时给出原因', cycle.hover.reason);
  await cycle.drop(); await pause(150); await cycle.end(); await pause(120);
  const self = await dragFolder('cvpr', `[data-library-folder-id="cvpr"]`, 'inside');
  check(self.hover.reason.includes('自身'), '拖到自身时给出原因', self.hover.reason);
  await self.drop(); await pause(150); await self.end(); await pause(120);
  const intoRoot = await dragFolder('gen', `[data-library-folder-id="library"]`, 'inside');
  check(intoRoot.hover.reason.includes('默认资料库'), '拖到「默认资料库」时给出原因', intoRoot.hover.reason);
  await intoRoot.drop(); await pause(150); await intoRoot.end(); await pause(120);
  check((await moveCalls()).length === movesBeforeRefusals, '被拒绝的拖动没有提交任何移动', (await moveCalls()).length - movesBeforeRefusals);
  const reasonShown = await ev(`(document.querySelector('[data-library-folder-drop-reason]')?.textContent || '').trim()`);
  check(reasonShown.length > 0, '拒绝原因仍在界面上可见（不静默）', reasonShown);
  const rootRow = await ev(`(()=>{const row=document.querySelector('[data-library-folder-id="library"]');return {draggable:row.getAttribute('draggable'),root:row.getAttribute('data-library-root')}})()`);
  check(rootRow.draggable === 'false' && rootRow.root === 'true', '「默认资料库」不可拖动且标记为根行', rootRow);
  const rootDragPayload = await ev(`(()=>{window.__dt = new DataTransfer(); const row=document.querySelector('[data-library-folder-id="library"]'); row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window.__dt})); const payload=window.__dt.getData('application/x-a4note-folder-id'); window.__dt=null; return payload;})()`);
  check(rootDragPayload === '', '拖动「默认资料库」不会携带任何载荷', rootDragPayload);
  await shot('06-cycle-and-root-refused');

  /* 7. Regressions: papers into a folder, expand/collapse, rename, subfolder, delete, keyboard. */
  const addKeyword = '论文合集';
  await ev(`window.__paperDrag('[data-library-folder-id="cvpr"]', ['p1'], 'over')`);
  await pause(150);
  const paperHover = await ev(`document.querySelector('[data-library-folder-id="cvpr"]').getAttribute('data-drop-target')`);
  check(paperHover === 'true', '文献拖到文件夹时显示放置反馈', paperHover);
  await ev(`window.__paperDrag('[data-library-folder-id="cvpr"]', ['p1'], 'drop')`);
  await pause(150);
  const paperCall = (await calls()).filter(entry => entry[0] === 'movePapers').at(-1);
  check(paperCall && paperCall[1][0] === 'p1' && paperCall[2] === 'cvpr', '文献拖入文件夹仍调用 onMovePapersToFolder', paperCall);

  await click('[data-library-folder-id="cvpr"] [data-tree-caret]');
  await pause(150);
  check(!(await ev(`!!document.querySelector('[data-library-folder-id="core"]')`)), '折叠 CVPR 后子级隐藏');
  await click('[data-library-folder-id="cvpr"] [data-tree-caret]');
  await pause(150);
  check(await ev(`!!document.querySelector('[data-library-folder-id="core"]')`), '再次展开后子级恢复');

  await contextMenu('gen', 'rename');
  await wait(`!!document.querySelector('.library-sidebar-folder-node input, .folder-rename input')`);
  await ev(`(()=>{const i=document.querySelector('input[aria-label^="重命名"]');i.focus();i.select();return true})()`);
  await typeText(addKeyword);
  await key('Enter');
  await wait(`Array.from(document.querySelectorAll('[data-library-folder-id]')).some(row => row.textContent.includes(${JSON.stringify(addKeyword)}))`);
  const renameCall = (await calls()).filter(entry => entry[0] === 'rename').at(-1);
  check(renameCall && renameCall[1] === 'gen' && renameCall[2] === addKeyword, '重命名仍写入 onRenameFolder', renameCall);

  await contextMenu('cvpr', 'subfolder');
  await wait(`!!document.querySelector('.library-folder-draft input')`);
  const subDraftParent = await ev(`document.querySelector('.library-folder-draft').getAttribute('data-library-folder-draft-parent')`);
  check(subDraftParent === 'cvpr', '「新建子文件类」的草稿行挂在 CVPR 下', subDraftParent);
  await ev(`(()=>{const i=document.querySelector('.library-folder-draft input');i.focus();i.select();return true})()`);
  await typeText('子级新增');
  await key('Enter');
  await wait(`Array.from(document.querySelectorAll('[data-library-folder-id]')).some(row => row.textContent.includes('子级新增'))`);
  const childId = await ev(`Array.from(document.querySelectorAll('[data-library-folder-id]')).find(row => row.textContent.includes('子级新增'))?.dataset.libraryFolderId`);
  check((await rowParentGroup(childId)) === 'cvpr', '新建的子文件类出现在 CVPR 内', await rowParentGroup(childId));

  await contextMenu(childId, 'delete');
  await pause(200);
  const deleteCall = (await calls()).filter(entry => entry[0] === 'delete').at(-1);
  check(deleteCall && deleteCall[1] === childId && !(await ev(`!!document.querySelector('[data-library-folder-id="${childId}"]')`)), '删除子文件类仍调用 onDeleteFolder 并移除行', deleteCall);
  await shot('07-regressions');

  const focusRow = (id) => ev(`(()=>{const row=document.querySelector('[data-library-folder-id="${id}"]');row.focus();return document.activeElement===row})()`);
  const activeId = () => ev(`document.activeElement?.dataset?.libraryFolderId || null`);
  await focusRow('library'); await key('ArrowDown');
  const afterDown = await activeId();
  await key('ArrowUp');
  check(afterDown && afterDown !== 'library' && (await activeId()) === 'library', '↑/↓ 在文件类之间移动焦点', { afterDown, back: await activeId() });
  await key('End');
  const last = await activeId();
  await key('Home');
  check((await activeId()) === 'library' && last !== 'library', 'Home/End 跳到首尾行', { last, home: await activeId() });
  await focusRow('core'); await key('ArrowLeft');
  const leftTarget = await activeId();
  check(leftTarget === 'cvpr', '← 从子级回到父级行', leftTarget);
  await key('ArrowLeft'); await pause(160);
  check(!(await ev(`!!document.querySelector('[data-library-folder-id="core"]')`)), '← 在已展开的分支上收起该分支');
  await key('ArrowRight'); await pause(160);
  check(await ev(`!!document.querySelector('[data-library-folder-id="core"]')`), '→ 重新展开该分支');

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
