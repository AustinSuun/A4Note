// Isolated native WebView2 evidence for whiteboard phase 1 (task 4093839c): a board created from the notes
// file tree, drawn on, linked from the reader's note switcher, edited from the reader, the same file seen by
// both entries, and everything still there after a restart. Attaches to a running isolated dev:live instance.
// Usage: node scripts/verify-board-native.mjs <after|restart>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'after';
const port = Number(process.env.BOARD_CDP_PORT || 9329);
const vitePort = Number(process.env.BOARD_VITE_PORT || 1499);
const instance = process.env.BOARD_INSTANCE || 'arena-two-board';
const vault = process.env.BOARD_VAULT || 'D:\\WorkSpace\\Aster\\.tmp\\board-vault-arena-two';
const base = path.resolve('.tmp/shots/board-native');
const dir = path.join(base, label);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = tabs.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${vitePort}`));
if (!page) throw Error('Isolated WebView target missing');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(); const errors = []; const steps = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push('pageerror ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map(x => x.value ?? x.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.exception?.value ?? '')); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (expr, name, tries = 120) => { for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* retry */ } await pause(120); } throw Error('timeout ' + name); };
const tryWait = (expr, name, tries) => wait(expr, name, tries).catch(() => false);
const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const click = selector => ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
const step = (name, data) => { steps.push({ step: name, ...data }); return data; };
const invoke = (command, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}${args ? ',' + JSON.stringify(args) : ''})`);
const ACTIVE = '.workbench-tab-frame.active';
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const dragAt = async (from, to, steps = 8) => {
  await mouse('mouseMoved', from.x, from.y, { buttons: 0 });
  await mouse('mousePressed', from.x, from.y, { buttons: 1 });
  for (let i = 1; i <= steps; i += 1) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, { buttons: 1 }); await pause(20); }
  await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
};
const clickAt = async (x, y) => { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y, { buttons: 1 }); await mouse('mouseReleased', x, y, { buttons: 0 }); };
const key = async (text, code, keyCode) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: text, code, windowsVirtualKeyCode: keyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: text, code, windowsVirtualKeyCode: keyCode }); };
const canvasBox = scope => ev(`(()=>{const c=document.querySelector(${JSON.stringify(scope + ' svg.board-canvas')});if(!c)return null;const b=c.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}})()`);
const boardFile = async filePath => { const f = await invoke('read_text_file', { request: { path: filePath } }); return JSON.parse(f.content); };
const savedIn = scope => `document.querySelector(${JSON.stringify(scope + ' [data-board-save-state]')})?.getAttribute('data-board-save-state')==='saved'`;

const reloadApp = async () => {
  await send('Page.reload');
  await pause(1500);
  await wait(`!!document.querySelector('.workbench-tool')||!!document.querySelector('.workbench-scene-list')`, 'app after reload', 300);
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard after reload');
  await ev(`(window.confirm=()=>true,true)`);
  await pause(500);
};
const enterScene = async name => {
  const onList = await ev(`!!document.querySelector('.workbench-scene-list')`);
  if (onList) {
    await ev(`(()=>{const el=[...document.querySelectorAll('.workbench-scene-list button, .workbench-scene-list [role=button], .workbench-scene-list a')].find(b=>new RegExp(${JSON.stringify(name)}).test(b.textContent));el?.click();return !!el})()`);
  } else {
    await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()===${JSON.stringify(name)})?.click(),true)`);
  }
  await pause(600);
};
const ensureVaultProject = async () => {
  // Isolated notes folder inside the repo's ignored .tmp; the picker/dialog needs a native folder dialog, so the
  // project is registered through the same workbench snapshot the app persists (pure core helpers, then reload).
  const parent = vault.replace(/[\\/][^\\/]+$/, ''); const name = vault.split(/[\\/]/).pop();
  try { await invoke('create_directory', { request: { path: parent, name } }); } catch (error) { if (!/已存在/.test(String(error))) throw error; }
  const has = await ev(`window.__TAURI_INTERNALS__.invoke('load_workbench_state').then(raw=>import('/src/core/workspace.ts').then(m=>{const s=m.deserializeWorkbenchState(raw);return s.projects.some(p=>p.kind==='folder'&&p.rootPath.replace(/\\\\/g,'/').toLowerCase()===${JSON.stringify(vault.replace(/\\/g, '/').toLowerCase())});}))`);
  if (has) return false;
  await ev(`window.__TAURI_INTERNALS__.invoke('load_workbench_state').then(raw=>import('/src/core/workspace.ts').then(m=>{const s=m.deserializeWorkbenchState(raw);const r=m.createProject(s,{rootPath:${JSON.stringify(vault)},name:${JSON.stringify(name)},kind:'folder',workspaceName:${JSON.stringify(name)}});return window.__TAURI_INTERNALS__.invoke('save_workbench_state',{request:{snapshot:m.serializeWorkbenchState(r.state)}});}))`);
  await pause(800);
  await reloadApp();
  return true;
};
const enterNotes = async () => {
  await enterScene('笔记');
  if (!(await tryWait(`!!document.querySelector('.file-tree-panel')`, 'file tree', 30))) {
    // Folder picker inside the notes scene: activate our vault by name.
    await ev(`(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(vault.split(/[\\/]/).pop())}));el?.click();return !!el})()`);
    await wait(`!!document.querySelector('.file-tree-panel')`, 'file tree after picker', 60);
  }
  await pause(400);
};
const openPaper = async () => {
  await enterScene('文献');
  await wait(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr').length>=1`, 'library rows');
  await ev(`(document.querySelectorAll('${ACTIVE} .paper-table tbody tr')[0].dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  await wait(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`, 'reader');
  await pause(500);
  if (await ev(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence!=='entered'`)) {
    await click(`${ACTIVE} .reader-note-workbench-button`);
    await wait(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'note open');
  }
  await pause(400);
};
const openSwitcher = async () => {
  if (!(await ev(`!!document.querySelector('${ACTIVE} .note-history-popover')`))) await ev(`(document.querySelector('${ACTIVE} button[aria-label^="切换论文文档"]').click(),true)`);
  await wait(`!!document.querySelector('${ACTIVE} .note-history-boards')`, 'board section');
  await pause(300);
};
const addSticky = async (scope, at, text) => {
  await ev(`(document.querySelector(${JSON.stringify(scope + ' [data-tool="note"]')}).click(),true)`);
  const box = await canvasBox(scope);
  await clickAt(box.x + at.x, box.y + at.y);
  await wait(`!!document.querySelector(${JSON.stringify(scope + ' textarea.board-text-editor')})`, 'sticky editor');
  await send('Input.insertText', { text });
  await key('Escape', 'Escape', 27);
  await wait(savedIn(scope), 'saved after sticky', 80);
};
const boardCount = scope => ev(`document.querySelectorAll(${JSON.stringify(scope + ' [data-element-id]')}).length`);
const boardTexts = scope => ev(`[...document.querySelectorAll(${JSON.stringify(scope + ' .board-text-block')})].map(n=>n.textContent)`);
let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`(window.confirm=()=>true,true)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  errors.length = 0;
  const NOTES_BOARD = `${ACTIVE} .board-editor:not(.embedded)`;
  const READER_BOARD = `${ACTIVE} .reader-board-surface .board-editor`;
  if (label === 'after') {
    step('vault project', { created: await ensureVaultProject(), vault });
    await enterNotes();
    step('notes scene', { tree: await ev(`!!document.querySelector('.file-tree-panel')`), newBoardButton: await ev(`!!document.querySelector('.file-tree-panel [aria-label="新建白板"]')`) });
    await shot('01-notes-tree');
    await click('.file-tree-panel [aria-label="新建白板"]');
    await wait(`!!document.querySelector('${NOTES_BOARD}[data-board-id]:not([data-board-id=""])')`, 'board tab');
    await pause(500);
    const boardName = await ev(`document.querySelector('${NOTES_BOARD} .board-title span')?.textContent`);
    const boardPath = await ev(`(()=>{const rows=[...document.querySelectorAll('.file-tree-panel .file-tree-row')];const r=rows.find(x=>x.querySelector('.file-tree-type')?.textContent==='白板');return r?.getAttribute('title')||r?.dataset.path||null})()`);
    step('board created', { boardName, boardPath, badge: await ev(`[...document.querySelectorAll('.file-tree-panel .file-tree-type')].map(n=>n.textContent)`), empty: await ev(`!!document.querySelector('${NOTES_BOARD} .board-empty')`) });
    await shot('02-board-empty');
    const filePath = `${vault}\\${boardName}.a4board`;
    await addSticky(NOTES_BOARD, { x: 240, y: 200 }, '来自笔记场景');
    await ev(`(document.querySelector('${NOTES_BOARD} [data-tool="rect"]').click(),true)`);
    let box = await canvasBox(NOTES_BOARD);
    await dragAt({ x: box.x + 520, y: box.y + 160 }, { x: box.x + 700, y: box.y + 280 });
    await wait(savedIn(NOTES_BOARD), 'saved after rect', 80);
    await ev(`(document.querySelector('${NOTES_BOARD} [data-tool="arrow"]').click(),true)`);
    await dragAt({ x: box.x + 300, y: box.y + 240 }, { x: box.x + 560, y: box.y + 220 });
    await wait(savedIn(NOTES_BOARD), 'saved after arrow', 80);
    await ev(`(document.querySelector('${NOTES_BOARD} [data-tool="pen"]').click(),true)`);
    await dragAt({ x: box.x + 200, y: box.y + 380 }, { x: box.x + 640, y: box.y + 420 }, 16);
    await wait(savedIn(NOTES_BOARD), 'saved after pen', 80);
    await pause(400);
    const drawn = await boardFile(filePath);
    step('drawn in notes', { elements: drawn.elements.map(e => e.type), arrowBound: drawn.elements.find(e => e.type === 'arrow')?.to?.elementId === drawn.elements.find(e => e.type === 'rect')?.id, id: drawn.id, rendered: await boardCount(NOTES_BOARD), texts: await boardTexts(NOTES_BOARD), status: await ev(`document.querySelector('${NOTES_BOARD} .board-status')?.textContent`) });
    await shot('03-board-drawn');
    // Undo in the notes entry removes the stroke; redo brings it back (both persisted).
    await ev(`(document.querySelector('${NOTES_BOARD} [aria-label="撤销"]').click(),true)`);
    await wait(savedIn(NOTES_BOARD), 'saved after undo', 80); await pause(300);
    const afterUndo = (await boardFile(filePath)).elements.length;
    await ev(`(document.querySelector('${NOTES_BOARD} [aria-label="重做"]').click(),true)`);
    await wait(savedIn(NOTES_BOARD), 'saved after redo', 80); await pause(300);
    step('undo/redo persisted', { afterUndo, afterRedo: (await boardFile(filePath)).elements.length });
    // Reader entry: link the board from the note switcher and edit it there.
    await openPaper();
    await openSwitcher();
    step('reader switcher', { section: await ev(`document.querySelector('${ACTIVE} .note-history-boards')?.innerText`) });
    await shot('04-reader-switcher');
    await ev(`([...document.querySelectorAll('${ACTIVE} .note-history-board-actions button')].find(b=>/关联已有白板/.test(b.textContent))?.click(),true)`);
    await wait(`!!document.querySelector('${ACTIVE} .note-history-board-list.picker')`, 'picker');
    await shot('05-reader-picker');
    await ev(`([...document.querySelectorAll('${ACTIVE} .picker .note-history-board-open')].find(b=>b.textContent.includes(${JSON.stringify(boardName)}))?.click(),true)`);
    await wait(`!!document.querySelector('${READER_BOARD}[data-board-id]:not([data-board-id=""])')`, 'reader board surface');
    await pause(600);
    const linked = await boardFile(filePath);
    step('linked from reader', { links: linked.links, sameId: linked.id === drawn.id, readerRendered: await boardCount(READER_BOARD), readerTexts: await boardTexts(READER_BOARD), trigger: await ev(`document.querySelector('${ACTIVE} button[aria-label^="切换论文文档"]')?.textContent`), chip: await ev(`document.querySelector('${READER_BOARD} .board-link-chip')?.textContent`) });
    await shot('06-reader-board');
    await addSticky(READER_BOARD, { x: 200, y: 420 }, '来自阅读器');
    await pause(400);
    const afterReader = await boardFile(filePath);
    // The notes tab is in another workspace; it stays mounted only while visible, so verify via the file plus reopening.
    step('edited from reader', { texts: afterReader.elements.filter(e => e.text).map(e => e.text), elements: afterReader.elements.length, links: afterReader.links.length });
    await shot('07-reader-edited');
    // Back to the notes entry: same version, no second copy.
    await enterNotes();
    // Leaving the notes scene closes its tabs (existing behaviour for Markdown notes too); reopen from the tree.
    const stillOpen = await tryWait(`!!document.querySelector('${NOTES_BOARD}[data-board-id]:not([data-board-id=""])')`, 'notes board again', 20);
    if (!stillOpen) {
      await ev(`(()=>{const rows=[...document.querySelectorAll('.file-tree-panel .file-tree-row')];const r=rows.find(x=>x.textContent.includes(${JSON.stringify(boardName)}));r?.click();return !!r})()`);
      await wait(`!!document.querySelector('${NOTES_BOARD}[data-board-id]:not([data-board-id=""])')`, 'board reopened from tree', 60);
    }
    await pause(600);
    step('notes sees reader edit', { reopenedFromTree: !stillOpen, texts: await boardTexts(NOTES_BOARD), rendered: await boardCount(NOTES_BOARD), chip: await ev(`document.querySelector('${NOTES_BOARD} .board-link-chip')?.textContent`), boardsInVault: (await invoke('list_directory_entries', { request: { path: vault, include_hidden: false } })).entries.filter(e => e.extension === 'a4board').map(e => e.name) });
    await shot('08-notes-after-reader-edit');
    fs.writeFileSync(path.join(base, 'context.json'), JSON.stringify({ boardName, filePath, boardId: drawn.id }, null, 2));
  } else {
    const context = JSON.parse(fs.readFileSync(path.join(base, 'context.json'), 'utf8'));
    await enterNotes();
    if (!(await tryWait(`!!document.querySelector('${NOTES_BOARD}[data-board-id]:not([data-board-id=""])')`, 'restored board tab', 40))) {
      await ev(`(()=>{const rows=[...document.querySelectorAll('.file-tree-panel .file-tree-row')];const r=rows.find(x=>x.textContent.includes(${JSON.stringify(context.boardName)}));r?.click();return !!r})()`);
      await wait(`!!document.querySelector('${NOTES_BOARD}[data-board-id]:not([data-board-id=""])')`, 'board reopened from tree', 60);
    }
    await pause(600);
    const file = await boardFile(context.filePath);
    step('restart notes', { sameId: file.id === context.boardId, elements: file.elements.length, texts: await boardTexts(NOTES_BOARD), rendered: await boardCount(NOTES_BOARD), links: file.links.length });
    await shot('01-restart-notes');
    await openPaper();
    const restored = await tryWait(`!!document.querySelector('${READER_BOARD}[data-board-id]:not([data-board-id=""])')`, 'reader board restored', 30);
    if (!restored) {
      await openSwitcher();
      await ev(`([...document.querySelectorAll('${ACTIVE} .note-history-board-open')].find(b=>b.textContent.includes(${JSON.stringify(context.boardName)}))?.click(),true)`);
      await wait(`!!document.querySelector('${READER_BOARD}[data-board-id]:not([data-board-id=""])')`, 'reader board after restart', 60);
    }
    await pause(600);
    step('restart reader', { restoredWithoutSwitcher: restored, texts: await boardTexts(READER_BOARD), rendered: await boardCount(READER_BOARD), trigger: await ev(`document.querySelector('${ACTIVE} button[aria-label^="切换论文文档"]')?.textContent`) });
    await shot('02-restart-reader');
    // Back to note: the switcher returns to the markdown note without touching the board file.
    const before = JSON.stringify(await boardFile(context.filePath));
    await ev(`(document.querySelector('${READER_BOARD} .reader-board-back').click(),true)`);
    await wait(`!document.querySelector('${READER_BOARD}')`, 'back to note');
    step('back to note', { noteEditor: await ev(`!!document.querySelector('${ACTIVE} .note-workspace')`), fileUnchanged: before === JSON.stringify(await boardFile(context.filePath)) });
    await shot('03-restart-back-to-note');
  }
} catch (error) { problem = String(error); try { await shot('failure'); } catch { /* ignore */ } }
fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify({ label, instance, vault, steps, errors, problem }, null, 2));
console.log(JSON.stringify({ label, steps: steps.length, errors: errors.length, problem }));
ws.close();
if (problem) process.exit(1);
