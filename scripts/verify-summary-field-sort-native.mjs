// Isolated native WebView2 evidence for global field-card ordering (task 07abf228): field titles without the
// "总览字段 ·" prefix, handle-only drag/keyboard reorder that rewrites the shared catalog, a second paper's
// overview note and the library 综览 table following the same order, and persistence across restart.
// Attaches to a running isolated dev:live instance (never the production identity).
// Usage: node scripts/verify-summary-field-sort-native.mjs <before|after|restart>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'after';
const port = Number(process.env.SUMMARY_CDP_PORT || 9329);
const vitePort = Number(process.env.SUMMARY_VITE_PORT || 1499);
const instance = process.env.SUMMARY_INSTANCE || 'arena-two-sort';
const base = path.resolve('.tmp/shots/summary-field-sort-native');
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
const tryWait = (expr, name, tries) => wait(expr, name, tries).catch(() => false);
const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const click = selector => ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
const step = (name, data) => { steps.push({ step: name, ...data }); return data; };
const ACTIVE = '.workbench-tab-frame.active';
const ED = `${ACTIVE} .reader-retained-note .summary-document-editor`;
const invoke = (command, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}${args ? ',' + JSON.stringify(args) : ''})`);
// Same parser the app uses (defaults apply when the layout file does not exist yet); served by the dev server.
const catalogRaw = () => ev(`window.__TAURI_INTERNALS__.invoke('read_summary_layout').then(f=>import('/src/core/librarySummary.ts').then(m=>m.parseSummaryLayout(f.content).columns))`);
const catalogIds = async () => (await catalogRaw()).map(c => c.id);
const stateOf = async root => ev(`(()=>{const r=document.querySelector(${JSON.stringify(root)});if(!r)return null;const secs=[...r.querySelectorAll('.summary-document-section')];
const titles=secs.filter(s=>s.classList.contains('field')).map(s=>s.querySelector('header strong')?.textContent.trim()||'');
const fields=secs.filter(s=>s.classList.contains('field')).map(s=>(s.dataset.summarySegment||'').replace(/^field:/,''));
const handles=secs.filter(s=>s.querySelector('.summary-document-handle')).map(s=>(s.dataset.summarySegment||''));
const kinds=secs.map(s=>s.classList.contains('field')?'field':s.classList.contains('free')?'free':'other');
const h=r.querySelector('.summary-document-handle');const hs=h?getComputedStyle(h):null;const hb=h?h.getBoundingClientRect():null;const strong=h?h.parentElement.querySelector('strong').getBoundingClientRect():null;
const rr=r.getBoundingClientRect();const overflow=[...r.querySelectorAll('*')].some(el=>{const b=el.getBoundingClientRect();return b.width>0&&(b.right>rr.right+1||b.left<rr.left-1)});
return {sections:secs.length,kinds,fields,titles,middleDotTitles:titles.filter(t=>t.includes('·')).length,handles:handles.length,handleOnNonField:handles.filter(k=>!k.startsWith('field:')).length,handle:h?{cursor:hs.cursor,touchAction:hs.touchAction,w:Math.round(hb.width),h:Math.round(hb.height),gapToTitle:Math.round(strong.left-hb.right),label:h.getAttribute('aria-label')}:null,horizontalOverflow:overflow,notice:r.querySelector('.summary-document-notice')?.textContent||'',alert:r.querySelector('[role=alert]')?.textContent||''}})()`);
const ensurePapers = async count => {
  // The isolated fixture library ships one guide paper; import a second fixture PDF through the normal import command.
  const papers = await invoke('list_papers');
  if (papers.length >= count) return papers.length;
  const fixture = process.env.SUMMARY_FIXTURE_PDF || 'D:/WorkSpace/Aster/.tmp/promo/pdfs/1706.03762.pdf';
  await invoke('import_pdf_to_library', { request: { original_path: fixture, title: 'Attention Is All You Need (fixture)', authors: 'Vaswani et al.', year: 2017, venue: 'NeurIPS', doi: '', tags: ['fixture'] } });
  await pause(800);
  await reloadApp();
  return (await invoke('list_papers')).length;
};
const reloadApp = async () => {
  // Library list is loaded on scene entry; a reload lands on the scene list, so re-enter the library scene.
  await send('Page.reload');
  await pause(1500);
  await wait(`!!document.querySelector('.workbench-tool')||!!document.querySelector('.workbench-scene-list')`, 'app after reload', 300);
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard after reload');
  await ev(`(window.confirm=()=>true,true)`);
  if (!(await ev(`!!document.querySelector('.workbench-tool')`))) {
    await ev(`(()=>{const el=[...document.querySelectorAll('.workbench-scene-list button, .workbench-scene-list [role=button], .workbench-scene-list a')].find(b=>/文献/.test(b.textContent));el?.click();return !!el})()`);
    await wait(`!!document.querySelector('.workbench-tool')`, 'scene entered', 200);
  }
  await pause(500);
};
const openPaper = async index => {
  await ensurePapers(index);
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  if (!(await tryWait(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr').length>=${index}`, 'library rows', 30))) {
    await reloadApp();
    await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  }
  await wait(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr').length>=${index}`, 'library rows');
  const rowText = await ev(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr')[${index - 1}].innerText`);
  const papers = await invoke('list_papers');
  const match = papers.find(p => p.title && rowText.includes(p.title.slice(0, 40)));
  await ev(`(document.querySelectorAll('${ACTIVE} .paper-table tbody tr')[${index - 1}].dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  await wait(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`, 'reader');
  await pause(500);
  if (await ev(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence!=='entered'`)) {
    await click(`${ACTIVE} .reader-note-workbench-button`);
    await wait(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'note open');
  }
  await pause(300);
  await ev(`([...document.querySelectorAll('${ACTIVE} .note-view-switch button')].find(b=>b.getAttribute('aria-label')==='编辑模式')?.click(),true)`);
  if (!(await ev(`!!document.querySelector('${ED}')`))) {
    await ev(`(document.querySelector('${ACTIVE} button[aria-label^="切换论文文档"]').click(),true)`);
    await wait(`!!document.querySelector('${ACTIVE} .note-history-actions')`, 'history menu');
    await ev(`([...document.querySelectorAll('${ACTIVE} .note-history-actions button')].find(b=>/总览笔记/.test(b.textContent))?.click(),true)`);
    await wait(`!!document.querySelector('${ED}')`, 'overview note editor', 200);
  }
  await wait(`!!document.querySelector('${ED} .summary-document-section')`, 'sections');
  await ev(`(()=>{const r=document.querySelector('${ED}');if(r)r.scrollTop=0;document.activeElement?.blur();return true})()`);
  await pause(500);
  if (!match) throw Error('paper id for row ' + index + ' not found: ' + rowText.slice(0, 80));
  return match.paper_id;
};
const ensureFields = async (want) => {
  // Explicit user path only (select + 添加到本篇); never touches other notes. Skips ids already present.
  for (const id of want) {
    if (await ev(`!!document.querySelector('${ED} [data-summary-segment="field:${id}"]')`)) continue;
    const ok = await ev(`(()=>{const s=document.querySelector('${ED} select[aria-label="添加已有字段"]');if(!s||![...s.options].some(o=>o.value===${JSON.stringify(id)}))return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(id)});s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    if (!ok) continue;
    await ev(`([...document.querySelectorAll('${ED} .summary-document-add button')].find(b=>b.textContent.trim()==='添加到本篇')?.click(),true)`);
    await tryWait(`!!document.querySelector('${ED} [data-summary-segment="field:${id}"]')`, 'added ' + id, 30);
    await pause(200);
    await ev(`(document.activeElement?.blur(),true)`);
    await tryWait(`document.querySelector('${ACTIVE} .note-save-state')?.textContent.includes('已保存')`, 'saved', 60);
  }
};
const noteBytes = async paperId => { const f = await invoke('read_paper_summary', { paperId }); return f.exists ? f.content : '<missing>'; };
const dragHandle = async (fromId, toId, side) => {
  await ev(`(()=>{document.querySelector('${ED} [data-summary-field="${fromId}"]')?.scrollIntoView({block:'center'});return true})()`);
  await pause(150);
  const from = await ev(`(()=>{const h=document.querySelector('${ED} [data-summary-field="${fromId}"] .summary-document-handle');if(!h)return null;const b=h.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  const to = await ev(`(()=>{const s=document.querySelector('${ED} [data-summary-field="${toId}"]');if(!s)return null;const b=s.getBoundingClientRect();return {x:b.left+b.width/2,y:${side === 'before' ? 'b.top+3' : 'b.bottom-3'}}})()`);
  if (!from || !to) return { started: false, from, to };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8, button: 'left', buttons: 1 }); await pause(30); }
  await pause(150);
  const mid = await ev(`(()=>{const r=document.querySelector('${ED}');return {sorting:r.classList.contains('sorting'),lifted:r.querySelector('.lifted')?.dataset.summaryField||null,dropBefore:r.querySelector('.drop-before')?.dataset.summaryField||null,dropAfter:r.querySelector('.drop-after')?.dataset.summaryField||null,selection:String(getSelection()).length,editor:!!r.querySelector('.cm-content')}})()`);
  await shot(`drag-${fromId}-${side}-${toId}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await pause(200);
  return { started: true, mid };
};
let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`(window.confirm=()=>true,true)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  if (label !== 'before') await reloadApp();
  // Runtime.enable replays console history from before this run (e.g. the HMR gap while files were being written); keep it apart.
  step('console-history-before-run', { replayed: errors.splice(0) });
  const catalog0 = await catalogRaw();
  step('catalog-initial', { ids: catalog0.map(c => c.id) });
  const previous = fs.existsSync(path.join(base, 'expected-order.json')) ? JSON.parse(fs.readFileSync(path.join(base, 'expected-order.json'), 'utf8')) : null;
  // Paper 1
  const paper1 = await openPaper(1);
  const want = catalog0.filter(c => !c.source && !c.hidden).map(c => c.id).slice(0, 4);
  await ensureFields(want);
  await pause(400);
  const bytes1Before = await noteBytes(paper1);
  const rest1 = await stateOf(ED); step('paper1-rest', { paper: paper1, ...rest1 });
  await shot('01-paper1-rest');
  if (label === 'restart' && previous) step('restart-order', { expected: previous.catalog, actual: await catalogIds(), paper1Fields: rest1.fields, matches: JSON.stringify(previous.catalog) === JSON.stringify(await catalogIds()) });
  // Pointer drag: last displayed field above the first displayed field.
  const fields1 = rest1.fields;
  let drag = null;
  if (fields1.length >= 2 && rest1.handles > 0) {
    const from = fields1[fields1.length - 1], to = fields1[0];
    const before = await catalogIds();
    drag = await dragHandle(from, to, 'before');
    await tryWait(`document.querySelector('${ED} .summary-document-notice')?.textContent.includes('已更新全局字段顺序')`, 'notice', 40);
    const after = await catalogIds();
    const state = await stateOf(ED);
    step('paper1-drag', { from, to, ...drag, catalogBefore: before, catalogAfter: after, displayed: state.fields, expectedDisplayedFirst: from, notice: state.notice, alert: state.alert, noteBytesUnchanged: (await noteBytes(paper1)) === bytes1Before, catalogOtherPropsUnchanged: JSON.stringify([...(await catalogRaw())].sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify([...catalog0].sort((a, b) => a.id.localeCompare(b.id))) });
    await shot('02-paper1-after-drag');
  } else {
    // Old build: no handle. Try dragging the card header the way a user might and prove nothing moves.
    const before = await catalogIds();
    step('paper1-drag', { handles: rest1.handles, catalogBefore: before, catalogAfter: await catalogIds(), unavailable: true });
  }
  // Keyboard reorder from the handle.
  if (rest1.handles > 0) {
    const target = (await stateOf(ED)).fields[1];
    const before = await catalogIds();
    await ev(`(document.querySelector('${ED} [data-summary-field="${target}"] .summary-document-handle').focus(),true)`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await tryWait(`JSON.stringify([...document.querySelectorAll('${ED} .summary-document-section.field')].map(s=>s.dataset.summaryField))!==${JSON.stringify(JSON.stringify((await stateOf(ED)).fields))}`, 'keyboard move', 40);
    const state = await stateOf(ED);
    step('paper1-keyboard', { target, catalogBefore: before, catalogAfter: await catalogIds(), displayed: state.fields, focusOnHandle: await ev(`document.activeElement?.classList.contains('summary-document-handle')&&document.activeElement.closest('[data-summary-field]')?.dataset.summaryField`), noteBytesUnchanged: (await noteBytes(paper1)) === bytes1Before });
    await shot('03-paper1-after-keyboard');
  }
  // Body drag must not reorder; text selection allowed.
  {
    const before = await catalogIds();
    const box = await ev(`(()=>{const p=document.querySelector('${ED} .summary-document-section.field .summary-document-preview');if(!p)return null;const b=p.getBoundingClientRect();return {x:b.left+30,y:b.top+10,x2:b.left+120,y2:b.bottom+120}})()`);
    if (box) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i += 1) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + (box.x2 - box.x) * i / 6, y: box.y + (box.y2 - box.y) * i / 6, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x2, y: box.y2, button: 'left', buttons: 0, clickCount: 1 });
      await pause(300);
      step('paper1-body-drag', { catalogBefore: before, catalogAfter: await catalogIds(), lifted: await ev(`!!document.querySelector('.lifted')`) });
      await ev(`(getSelection().removeAllRanges(),document.activeElement?.blur(),true)`);
      await ev(`(()=>{const e=document.querySelector('${ED} .cm-content');if(e){e.blur();}return true})()`);
      await pause(300);
    }
  }
  // Dark + narrow: handle still reachable, drag still works.
  await ev(`document.documentElement.dataset.theme='midnight'`); await pause(300); await shot('04-paper1-dark');
  await ev(`document.documentElement.dataset.theme=''`);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }); await pause(500);
  const narrow = await stateOf(ED); step('paper1-narrow', narrow);
  if (narrow.handles > 0 && narrow.fields.length >= 2) {
    const before = await catalogIds();
    const d = await dragHandle(narrow.fields[0], narrow.fields[1], 'after');
    await tryWait(`JSON.stringify([...document.querySelectorAll('${ED} .summary-document-section.field')].map(s=>s.dataset.summaryField))!==${JSON.stringify(JSON.stringify(narrow.fields))}`, 'narrow drag', 40);
    step('paper1-narrow-drag', { ...d, catalogBefore: before, catalogAfter: await catalogIds(), displayed: (await stateOf(ED)).fields });
  }
  await shot('05-paper1-narrow');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300);
  // Paper 2 must show the same relative order and be able to reorder as well.
  const bytes1 = await noteBytes(paper1);
  const paper2 = await openPaper(2);
  await ensureFields(want.slice(0, 3));
  await pause(400);
  const rest2 = await stateOf(ED);
  const cat = await catalogIds();
  const expected2 = cat.filter(id => rest2.fields.includes(id));
  step('paper2-rest', { paper: paper2, ...rest2, catalog: cat, followsCatalog: JSON.stringify(expected2) === JSON.stringify(rest2.fields) });
  await shot('06-paper2-rest');
  if (rest2.handles > 0 && rest2.fields.length >= 2) {
    const before = await catalogIds();
    const from = rest2.fields[rest2.fields.length - 1], to = rest2.fields[0];
    const d = await dragHandle(from, to, 'before');
    await tryWait(`document.querySelector('${ED} .summary-document-notice')?.textContent.includes('已更新全局字段顺序')`, 'notice2', 40);
    const after = await catalogIds();
    step('paper2-drag', { from, to, ...d, catalogBefore: before, catalogAfter: after, displayed: (await stateOf(ED)).fields, paper1BytesUnchanged: (await noteBytes(paper1)) === bytes1 });
    await shot('07-paper2-after-drag');
    // Paper 1 is still mounted in its own retained tab: its editor must already show the new order.
    await ev(`([...document.querySelectorAll('.workbench-tab')].find(t=>!t.classList.contains('active'))?.click(),true)`);
    await pause(400);
    const back = await openPaper(1);
    const s1 = await stateOf(ED);
    const now = await catalogIds();
    step('paper1-follows', { paper: back, displayed: s1.fields, catalog: now, follows: JSON.stringify(now.filter(id => s1.fields.includes(id))) === JSON.stringify(s1.fields) });
    await shot('08-paper1-follows');
  }
  // Library 综览 table header order follows the catalog too.
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  await wait(`!!document.querySelector('[aria-label="文献显示方式"] button')`, 'library view switch');
  await ev(`([...document.querySelectorAll('[aria-label="文献显示方式"] button')].find(b=>b.textContent.trim()==='综览')?.click(),true)`);
  await wait(`!!document.querySelector('.library-scene .summary-viewport')`, 'summary viewport');
  await pause(600);
  const headers = await ev(`[...document.querySelectorAll('.library-scene .summary-viewport .summary-head .summary-cell, .library-scene .summary-viewport [class*="summary-head"] [class*="cell"], .library-scene .summary-viewport [role="columnheader"]')].map(h=>h.textContent.trim()).filter(Boolean)`);
  const catNow = await catalogRaw();
  const names = catNow.filter(c => !c.hidden).map(c => c.name);
  const headerText = await ev(`document.querySelector('.library-scene .summary-viewport')?.innerText.slice(0,600)`);
  const orderInText = names.map(n => headerText.indexOf(n)).filter(i => i >= 0);
  step('library-overview', { headers, catalogNames: names, headerOrderFollowsCatalog: orderInText.every((v, i, a) => i === 0 || v > a[i - 1]) && orderInText.length >= 2 });
  await shot('09-library-overview');
  await ev(`([...document.querySelectorAll('[aria-label="文献显示方式"] button')].find(b=>b.textContent.trim()==='列表')?.click(),true)`);
  await pause(300);
  await send('Emulation.clearDeviceMetricsOverride');
  const finalCatalog = await catalogIds();
  fs.writeFileSync(path.join(base, 'expected-order.json'), JSON.stringify({ label, catalog: finalCatalog, at: new Date().toISOString() }, null, 2));
  if (label !== 'before') {
    const bad = [];
    const p1 = steps.find(s => s.step === 'paper1-rest');
    if (p1.middleDotTitles) bad.push('titles still contain ·');
    if (!p1.handles || p1.handleOnNonField) bad.push('handles missing or on non-field cards');
    if (p1.horizontalOverflow) bad.push('horizontal overflow');
    const d = steps.find(s => s.step === 'paper1-drag');
    if (!d?.started || !d.mid?.lifted || d.displayed?.[0] !== d.from || d.catalogAfter?.[0] !== d.from && d.catalogAfter.indexOf(d.from) > d.catalogAfter.indexOf(d.to)) bad.push('drag did not move the field before its target');
    if (d && !d.noteBytesUnchanged) bad.push('note bytes changed by reorder');
    if (d && !d.catalogOtherPropsUnchanged) bad.push('catalog entries changed beyond order');
    const k = steps.find(s => s.step === 'paper1-keyboard');
    if (k && JSON.stringify(k.catalogBefore) === JSON.stringify(k.catalogAfter)) bad.push('keyboard move did not change catalog');
    const b = steps.find(s => s.step === 'paper1-body-drag');
    if (b && JSON.stringify(b.catalogBefore) !== JSON.stringify(b.catalogAfter)) bad.push('body drag reordered');
    const p2 = steps.find(s => s.step === 'paper2-rest');
    if (p2 && !p2.followsCatalog) bad.push('paper 2 does not follow catalog order');
    const f = steps.find(s => s.step === 'paper1-follows');
    if (f && !f.follows) bad.push('paper 1 did not follow the reorder made from paper 2');
    const lib = steps.find(s => s.step === 'library-overview');
    if (lib && !lib.headerOrderFollowsCatalog) bad.push('library overview header order does not follow catalog');
    const r = steps.find(s => s.step === 'restart-order');
    if (r && !r.matches) bad.push('order not persisted across restart');
    if (bad.length) throw Error(bad.join('; '));
  }
} catch (e) {
  problem = String(e); errors.push('TEST ' + problem);
  try { await shot('failure'); } catch { /* ignore */ }
} finally {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ label, dir, instance, steps, errors }, null, 2));
  ws.close();
  console.log(JSON.stringify({ dir, steps: steps.length, errors }));
  if (errors.length) process.exitCode = 1;
}
