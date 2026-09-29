// Isolated native WebView2 evidence for task 3eabf1ac: the reader's sidebar note
// gains the Markdown "笔记属性" area; properties persist into the same note row
// (frontmatter of notes.content) across a layout-mode switch and a reload, the
// body stays intact, viewing never writes, and removing every property returns
// the note to its legacy bytes. Attaches to a running isolated dev:live
// instance (never the user's production app).
// Usage: node scripts/verify-reader-note-properties-native.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'after';
const port = Number(process.env.PROPS_CDP_PORT || 9329);
const vitePort = Number(process.env.PROPS_VITE_PORT || 1499);
const instance = process.env.PROPS_INSTANCE || 'arena-two-props';
const base = path.resolve('.tmp/shots/reader-note-properties-native');
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
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (expr, name, tries = 120) => { for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* retry */ } await pause(120); } throw Error('timeout ' + name); };
const shot = async (name, clip) => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })).data, 'base64'));
const step = (name, data) => { steps.push({ step: name, ...data }); console.log(name, JSON.stringify(data).slice(0, 220)); return data; };
const ACTIVE = '.workbench-tab-frame.active';
const NOTE = `${ACTIVE} .note-workspace`;
const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
const type = async text => { for (const ch of text) await send('Input.insertText', { text: ch }); };
const clickEl = async selector => { const r = await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`); if (!r) throw Error('missing ' + selector); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }); await pause(150); };
const enterScene = async name => {
  if (await ev(`!!document.querySelector('.workbench-scene-list')`)) {
    await ev(`(()=>{const el=[...document.querySelectorAll('.workbench-scene-list button, .workbench-scene-list [role=button], .workbench-scene-list a')].find(b=>new RegExp(${JSON.stringify(name)}).test(b.textContent));el?.click();return !!el})()`);
  } else await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()===${JSON.stringify(name)})?.click(),true)`);
  await pause(600);
};
const papers = () => ev(`window.__TAURI_INTERNALS__.invoke('list_papers').then(r=>Array.isArray(r)?r:(r.papers||r.items||r))`);
const openReaderAndNote = async () => {
  if (!(await ev(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`))) {
    await enterScene('文献');
    await wait(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr').length>=1`, 'library rows');
    await ev(`(document.querySelectorAll('${ACTIVE} .paper-table tbody tr')[0].dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  }
  await wait(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`, 'reader');
  await pause(800);
  if (!(await ev(`!!document.querySelector('${NOTE}')`))) step('open note via workbench menu', { picked: await switchMode('/边读边记/') });
  await wait(`!!document.querySelector('${NOTE}')`, 'note workspace', 80);
  await pause(600);
};
const noteState = () => ev(`(()=>{const ws=document.querySelector('${NOTE}');if(!ws)return {present:false};const p=ws.querySelector(':scope > .note-properties');const rect=ws.getBoundingClientRect();const cm=ws.querySelector('.cm-content');return {present:true,panel:!!p,folded:p?p.classList.contains('is-collapsed'):null,count:p?p.querySelector('.note-properties-count')?.textContent:null,rows:p?[...p.querySelectorAll('.markdown-property-row')].map(r=>r.dataset.propertyKey):[],editorHasYaml:cm?/^---/.test(cm.textContent.trim()):null,editorText:(cm?.textContent||'').slice(0,80),saveState:ws.querySelector('.note-save-state')?.textContent,title:ws.querySelector('.note-document-trigger span:last-of-type')?.textContent,rect:{x:rect.left,y:rect.top,w:rect.width,h:rect.height}}})()`);
const noteRecord = async () => {
  const title = await ev(`document.querySelector('${NOTE} .note-document-trigger span:last-of-type')?.textContent||''`);
  const list = await papers();
  for (const paper of list) { const notes = (paper.notes || []).filter(n => (n.title || '').trim() === title.trim()); if (notes.length) { const note = notes[notes.length - 1]; return { paperId: paper.paperId, noteId: note.id, title: note.title, content: note.content }; } }
  return null;
};
// The summary note keeps its properties read-only by design; work on a plain note created through the reader's own "新建文档".
const ensurePlainNote = async () => {
  // Always start from a fresh plain note so every run measures a legacy (frontmatter-free) body.
  await clickEl(`${NOTE} .note-document-trigger`);
  await wait(`!!document.querySelector('${NOTE} .note-history-panel, ${NOTE} [class*="history"]') || [...document.querySelectorAll('${NOTE} button')].some(b=>b.textContent.includes('新建文档'))`, 'history menu', 30);
  await ev(`([...document.querySelectorAll('${NOTE} button')].find(b=>b.textContent.includes('新建文档')).click(),true)`);
  const previous = await ev(`document.querySelector('${NOTE} .note-document-trigger span:last-of-type')?.textContent||''`);
  await wait(`(document.querySelector('${NOTE} .note-document-trigger span:last-of-type')?.textContent||'')!=='' && (document.querySelector('${NOTE} .note-document-trigger span:last-of-type')?.textContent||'')!==${JSON.stringify(previous)}`, 'plain note selected', 60);
  await pause(600);
  await clickEl(`${NOTE} .cm-content`);
  await key('End', 'End', 35); await key('Enter', 'Enter', 13);
  await type('原生正文 legacy body'); await key('Enter', 'Enter', 13); await type('second line');
  await waitSaved(); await pause(500);
  return { created: true, previous, title: await ev(`document.querySelector('${NOTE} .note-document-trigger span:last-of-type')?.textContent||''`) };
};
const waitSaved = () => wait(`document.querySelector('${NOTE} .note-save-state')?.classList.contains('saved')`, 'saved', 100);
const withTheme = async (theme, fn) => {
  const prev = await ev(`document.documentElement.getAttribute('data-theme')`);
  await ev(`(document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)}),true)`); await pause(250);
  try { await fn(); } finally { await ev(`(${prev === null ? 'document.documentElement.removeAttribute(\'data-theme\')' : `document.documentElement.setAttribute('data-theme',${JSON.stringify(prev)})`},true)`); await pause(150); }
};
const switchMode = async pattern => {
  // The workbench bookmark opens its radio menu on context-menu (short press toggles the note).
  await ev(`(document.querySelector('${ACTIVE} .reader-note-workbench-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:10,clientY:10})),true)`);
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`, 'workbench menu', 30);
  const picked = await ev(`(()=>{const el=[...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(b=>${pattern}.test(b.textContent));if(el){el.click();return el.textContent.trim().slice(0,20)}return null})()`);
  await pause(900);
  return picked;
};
let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`(window.confirm=()=>true,true)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  errors.length = 0;
  await openReaderAndNote();
  step('plain note', await ensurePlainNote());
  const baseline = await noteRecord();
  step('note baseline (db)', { hasNote: !!baseline, noteId: baseline?.noteId, startsWithYaml: baseline ? baseline.content.startsWith('---') : null, length: baseline?.content.length });
  const initial = step('note sidebar initial', await noteState());
  await shot('01-note-sidebar');
  if (initial.rect) await shot('02-note-sidebar-closeup', { x: Math.max(0, initial.rect.x - 8), y: Math.max(0, initial.rect.y - 8), width: Math.min(560, 1600 - initial.rect.x + 8), height: 360 });
  await pause(1500);
  const afterView = await noteRecord();
  step('viewing writes nothing', { unchanged: !!baseline && afterView?.content === baseline.content });
  if (label === 'after' && initial.panel && baseline) {
    if (initial.folded) await clickEl(`${NOTE} > .note-properties .markdown-properties-heading > button`);
    await wait(`!document.querySelector('${NOTE} > .note-properties').classList.contains('is-collapsed')`, 'expanded', 20);
    await clickEl(`${NOTE} .markdown-property-suggest-toggle`);
    await wait(`!!document.querySelector('${NOTE} .markdown-property-choice-list')`, 'picker', 30);
    await shot('03-picker-open');
    await ev(`([...document.querySelectorAll('${NOTE} .markdown-property-choice-list .markdown-property-option')].find(b=>b.textContent.includes('标签')).click(),true)`);
    await wait(`!!document.querySelector('${NOTE} .markdown-property-row[data-property-key="tags"]')`, 'tags row', 30);
    await clickEl(`${NOTE} .markdown-property-row[data-property-key="tags"] .markdown-property-array-editor input`);
    await type('native-tag'); await key('Enter', 'Enter', 13);
    await clickEl(`${NOTE} .markdown-property-suggest-toggle`);
    await wait(`!!document.querySelector('${NOTE} .markdown-property-choice-list')`, 'picker 2', 30);
    await ev(`([...document.querySelectorAll('${NOTE} .markdown-property-choice-list .markdown-property-option')].find(b=>b.textContent.includes('日期')).click(),true)`);
    await wait(`!!document.querySelector('${NOTE} .markdown-property-row[data-property-key="date"]')`, 'date row', 30);
    await clickEl(`${NOTE} .markdown-property-row[data-property-key="date"] input.markdown-property-date`);
    await type('2026-09-28'); await key('Tab', 'Tab', 9);
    await waitSaved();
    await pause(400);
    const saved = await noteRecord();
    step('properties persisted into the same note row', { sameNote: saved?.noteId === baseline.noteId, startsWithYaml: saved?.content.startsWith('---\ntags:') || saved?.content.startsWith('---\r\ntags:'), hasTag: /- native-tag/.test(saved?.content || ''), hasDate: /date: ["']?2026-09-28/.test(saved?.content || ''), bodyIntact: (saved?.content || '').endsWith(baseline.content) });
    step('note sidebar with properties', await noteState());
    await shot('04-note-properties');
    const r = await noteState();
    await shot('05-note-properties-closeup', { x: Math.max(0, r.rect.x - 8), y: Math.max(0, r.rect.y - 8), width: Math.min(560, 1600 - r.rect.x + 8), height: 360 });
    await withTheme('midnight', async () => { await shot('06-note-properties-midnight', { x: Math.max(0, r.rect.x - 8), y: Math.max(0, r.rect.y - 8), width: Math.min(560, 1600 - r.rect.x + 8), height: 360 }); });
    // Layout-mode switch through the workbench menu (floating form), same data.
    const floating = await switchMode('/悬浮速记/');
    step('floating form shares the same properties', { menuItem: floating, ...(await noteState()) });
    await shot('07-floating-form');
    const writing = await switchMode('/专注写作/');
    step('writing form shares the same properties', { menuItem: writing, ...(await noteState()) });
    await shot('07b-writing-form');
    const back = await switchMode('/边读边记/');
    step('back to sidebar form', { menuItem: back, ...(await noteState()) });
    // Reload = restart-equivalent for the WebView: properties come back from the db.
    await send('Page.reload'); await pause(2500);
    await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard after reload');
    await ev(`(window.confirm=()=>true,true)`);
    await openReaderAndNote();
    const reloaded = step('after reload', { sameNote: (await noteRecord())?.noteId === baseline.noteId, ...(await noteState()) });
    await shot('08-after-reload');
    // 125% scaling = the same physical window with 1280x720 CSS px at DPR 1.25.
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1.25, mobile: false }); await pause(700);
    step('125% scaling', await noteState());
    await shot('09-zoom-125');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(500);
    // Remove both properties → legacy bytes restored.
    if (reloaded.panel && reloaded.folded) await clickEl(`${NOTE} > .note-properties .markdown-properties-heading > button`);
    for (let i = 0; i < 2; i += 1) {
      await ev(`(document.querySelector('${NOTE} .markdown-property-row .markdown-property-icon').click(),true)`);
      await wait(`!!document.querySelector('${NOTE} .markdown-property-menu button.danger')`, 'menu', 30);
      await clickEl(`${NOTE} .markdown-property-menu button.danger`);
      await pause(300);
    }
    await waitSaved(); await pause(400);
    const restored = await noteRecord();
    step('removing every property restores the legacy note bytes', { identical: restored?.content === baseline.content, rows: (await noteState()).rows });
    await shot('10-restored');
  }
} catch (error) { problem = String(error); try { await shot('failure'); } catch { /* ignore */ } }
finally { try { await send('Emulation.clearDeviceMetricsOverride'); } catch { /* ignore */ } }
fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify({ label, instance, steps, errors, problem }, null, 2));
console.log(JSON.stringify({ label, steps: steps.length, errors: errors.length, problem }));
ws.close();
if (problem) process.exit(1);
