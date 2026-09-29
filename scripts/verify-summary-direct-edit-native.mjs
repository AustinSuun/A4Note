// Isolated native WebView2 evidence for the overview-note (总结笔记) redesign: compact field toolbar,
// direct click-to-edit cards, no 高级源码 button, consistent typography; reader note panel + overview dialog,
// light/dark/narrow states. Attaches to a running isolated dev:live instance (never the production identity).
// Usage: node scripts/verify-summary-direct-edit-native.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'after';
const port = Number(process.env.SUMMARY_CDP_PORT || 9329);
const vitePort = Number(process.env.SUMMARY_VITE_PORT || 1499);
const instance = process.env.SUMMARY_INSTANCE || 'arena-two-sum';
const dir = path.resolve('.tmp/shots/summary-direct-edit-native', label);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = tabs.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${vitePort}`));
if (!page) throw Error('Isolated WebView target missing');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(); const errors = []; const measurements = [];
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
const ACTIVE = '.workbench-tab-frame.active';
const READER_ED = `${ACTIVE} .reader-retained-note .summary-document-editor`;
const measureExpr = root => `(()=>{const r=document.querySelector(${JSON.stringify(root)});if(!r)return null;const cs=el=>el?getComputedStyle(el):null;const px=v=>v?Number.parseFloat(v):null;
const h1=r.querySelector('.summary-document-preview h1');const title=r.querySelector('.summary-document-section header strong');
const body=r.querySelector('.summary-document-preview p, .summary-document-preview');const app=document.querySelector('.workbench-tab-frame.active .paper-table td, .workbench-tool, body');
const secs=[...r.querySelectorAll('.summary-document-section')];const editBtns=[...r.querySelectorAll('button')].filter(b=>b.textContent.trim()==='编辑').length;
const scope=r.closest('.summary-editor, .reader-retained-note')||r;const adv=[...scope.querySelectorAll('button')].filter(b=>/高级源码/.test(b.textContent)).length;
const repair=!!scope.querySelector('.summary-source-repair');const add=r.querySelector('.summary-document-add');const sel=r.querySelector('select[aria-label="添加已有字段"]');
const rr=r.getBoundingClientRect();const overflow=[...r.querySelectorAll('*')].some(el=>{const b=el.getBoundingClientRect();return b.width>0&&(b.right>rr.right+1||b.left<rr.left-1)});
const bigCentered=[...r.querySelectorAll('h1,h2')].some(el=>/总结笔记/.test(el.textContent)&&px(cs(el).fontSize)>24&&cs(el).textAlign==='center');
return {sections:secs.length,editButtons:editBtns,advancedSourceButtons:adv,sourceRepairEntry:repair,toolbar:add?{height:Math.round(add.getBoundingClientRect().height),width:Math.round(add.getBoundingClientRect().width),selectWidth:sel?Math.round(sel.getBoundingClientRect().width):null,selectOptions:sel?sel.options.length:null}:null,
titleFont:title?px(cs(title).fontSize):null,bodyFont:body?px(cs(body).fontSize):null,h1Font:h1?px(cs(h1).fontSize):null,appFont:app?px(cs(app).fontSize):null,rootFont:px(cs(document.documentElement).fontSize),horizontalOverflow:overflow,bigCenteredTitle:bigCentered,width:Math.round(rr.width),height:Math.round(rr.height),emptySections:secs.filter(s=>s.querySelector('.summary-document-empty')).map(s=>Math.round(s.getBoundingClientRect().height))}})()`;
const directEdit = async (root, index, text) => {
  // Click the card body (as a user would); old builds required a per-card 编辑 button, so fall back to it to keep 'before' comparable.
  const card = `${root} .summary-document-section:nth-of-type(${index})`;
  const cm = `!!document.querySelector(${JSON.stringify(card + ' .cm-content')})`;
  const alreadyEditing = await ev(cm);
  let viaClick = false, direct = false, viaButton = false;
  if (!alreadyEditing) {
    viaClick = await ev(`(()=>{const c=document.querySelector(${JSON.stringify(card)});const p=c?.querySelector('.summary-document-preview');if(!p)return false;const inner=p.querySelector('p, li, h1, h2, h3, span')||p;inner.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));inner.click();return true})()`);
    direct = viaClick && await tryWait(cm, 'direct edit', 15);
    if (!direct) { viaButton = await ev(`(()=>{const c=document.querySelector(${JSON.stringify(card)});const b=[...(c?.querySelectorAll('button')||[])].find(b=>b.textContent.trim()==='编辑');if(!b)return false;b.click();return true})()`); if (viaButton) await tryWait(cm, 'button edit', 15); }
  }
  const hasEditor = await ev(cm);
  const focusExpr = `document.activeElement?.closest(${JSON.stringify(card)})?.querySelector('.cm-content')===document.activeElement`;
  const focused = hasEditor ? await tryWait(focusExpr, 'focus', 10) : false;
  if (hasEditor && text) { if (!focused) await ev(`(document.querySelector(${JSON.stringify(card + ' .cm-content')})?.focus(),true)`); await send('Input.insertText', { text }); await pause(200); }
  return { alreadyEditing, direct: !!direct, viaButton, hasEditor, focused };
};
let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`(window.confirm=()=>true,true)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  await wait(`!!document.querySelector('${ACTIVE} .paper-table tbody tr')`, 'isolated fixture papers');
  await ev(`(document.querySelector('${ACTIVE} .paper-table tbody tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  await wait(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`, 'reader');
  await pause(500);
  if (await ev(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence!=='entered'`)) {
    await click(`${ACTIVE} .reader-note-workbench-button`);
    await wait(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'note open');
  }
  await pause(300);
  await ev(`([...document.querySelectorAll('${ACTIVE} .note-view-switch button')].find(b=>b.getAttribute('aria-label')==='编辑模式')?.click(),true)`);
  // Open the overview note through the document switcher (creates it on first run; confirm auto-accepted).
  if (!(await ev(`!!document.querySelector('${READER_ED}')`))) {
    await ev(`(document.querySelector('${ACTIVE} button[aria-label^="切换论文文档"]').click(),true)`);
    await wait(`!!document.querySelector('${ACTIVE} .note-history-actions')`, 'history menu');
    await ev(`([...document.querySelectorAll('${ACTIVE} .note-history-actions button')].find(b=>/总览笔记/.test(b.textContent))?.click(),true)`);
    await wait(`!!document.querySelector('${READER_ED}')`, 'overview note editor', 200);
  }
  await wait(`!!document.querySelector('${READER_ED} .summary-document-section')`, 'sections');
  await ev(`(()=>{const r=document.querySelector('${READER_ED}');if(r)r.scrollTop=0;document.activeElement?.blur();return true})()`);
  await pause(600);
  const rest = await ev(measureExpr(READER_ED)); measurements.push({ case: 'reader-rest', ...rest });
  await shot('01-reader-rest');
  // Direct edit of the free-content card (first section), type, blur → must persist via the shared note session.
  const stamp = `直接编辑验证 ${label} ${Date.now()}`;
  const edit1 = await directEdit(READER_ED, 1, stamp + '\n');
  measurements.push({ case: 'reader-direct-edit-free', ...edit1 });
  await pause(300);
  await shot('02-reader-editing');
  // Add an existing field (explicit confirm through 添加到本篇) when the global catalog has one.
  const options = await ev(`(()=>{const s=document.querySelector('${READER_ED} select[aria-label="添加已有字段"]');return s?[...s.options].map(o=>o.value).filter(Boolean):[]})()`);
  let added = null;
  if (options.length) {
    const before = await ev(`document.querySelectorAll('${READER_ED} .summary-document-section').length`);
    await ev(`(()=>{const s=document.querySelector('${READER_ED} select[aria-label="添加已有字段"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(options[0])});s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await ev(`([...document.querySelectorAll('${READER_ED} .summary-document-add button')].find(b=>b.textContent.trim()==='添加到本篇')?.click(),true)`);
    const grew = await tryWait(`document.querySelectorAll('${READER_ED} .summary-document-section').length>${before}`, 'field added', 30);
    const after = await ev(`document.querySelectorAll('${READER_ED} .summary-document-section').length`);
    let editAdded = null;
    const newIndex = await ev(`(()=>{const secs=[...document.querySelectorAll('${READER_ED} .summary-document-section')];const i=secs.findIndex(s=>s.dataset.editing);return i>=0?i+1:secs.length})()`);
    if (grew) { editAdded = await directEdit(READER_ED, newIndex, `字段内容 ${label}`); await pause(300); await shot('03-reader-added-field-editing'); }
    added = { option: options[0], before, after, grew, editAdded };
  }
  measurements.push({ case: 'reader-add-field', options: options.length, ...added });
  // Blur (click reader toolbar area) → save; then close and reopen the note panel, content must persist.
  await ev(`(document.activeElement?.blur(),document.querySelector('${ACTIVE} .reader-note-workbench-button')?.focus(),true)`);
  await tryWait(`document.querySelector('${ACTIVE} .note-save-state')?.textContent.includes('已保存')`, 'saved', 60);
  const saveState = await ev(`document.querySelector('${ACTIVE} .note-save-state')?.textContent`);
  await click(`${ACTIVE} .reader-note-workbench-button`);
  await wait(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence==='hidden'`, 'closed');
  await pause(300);
  await click(`${ACTIVE} .reader-note-workbench-button`);
  await wait(`document.querySelector('${ACTIVE} .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'reopen');
  await wait(`!!document.querySelector('${READER_ED} .summary-document-section')`, 'reopen sections', 200);
  await pause(500);
  const persisted = await ev(`document.querySelector('${READER_ED}').innerText.includes(${JSON.stringify(stamp)})`);
  const fieldPersisted = added?.grew ? await ev(`document.querySelector('${READER_ED}').innerText.includes(${JSON.stringify('字段内容 ' + label)})`) : null;
  measurements.push({ case: 'reader-reopen', saveState, persisted, fieldPersisted, ...(await ev(measureExpr(READER_ED))) });
  await shot('04-reader-reopen');
  await ev(`document.documentElement.dataset.theme='midnight'`); await pause(300); await shot('05-reader-dark');
  await ev(`document.documentElement.dataset.theme=''`); await pause(200);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }); await pause(400);
  measurements.push({ case: 'reader-narrow', ...(await ev(measureExpr(READER_ED))) });
  await shot('06-reader-narrow');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300);
  // Overview dialog (编辑完整总结) — same editor inside the library overview table (文献库 → 显示方式 总览).
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  await wait(`!!document.querySelector('[aria-label="文献显示方式"] button')`, 'library view switch');
  await ev(`([...document.querySelectorAll('[aria-label="文献显示方式"] button')].find(b=>b.textContent.trim()==='综览')?.click(),true)`);
  await wait(`!!document.querySelector('.library-scene .summary-viewport')`, 'summary viewport');
  await pause(500);
  const opened = await ev(`(()=>{const b=[...document.querySelectorAll('.library-scene button')].find(b=>b.textContent.trim()==='编辑完整总结');if(!b||b.disabled)return false;b.click();return true})()`);
  if (opened) {
    await wait(`!!document.querySelector('.summary-editor .summary-document-editor .summary-document-section')`, 'overview dialog editor', 200);
    await pause(500);
    const dlg = await ev(measureExpr('.summary-editor .summary-document-editor'));
    const header = await ev(`(()=>{const h=document.querySelector('.summary-editor header, .summary-editor .summary-editor-head');return h?[...h.querySelectorAll('button')].map(b=>b.textContent.trim()):null})()`);
    const tools = await ev(`[...document.querySelectorAll('.summary-editor .summary-editor-tools button')].map(b=>b.textContent.trim())`);
    measurements.push({ case: 'overview-dialog', headerButtons: header, toolButtons: tools, ...dlg });
    await shot('07-overview-dialog');
    const edit2 = await directEdit('.summary-editor .summary-document-editor', 1, '');
    measurements.push({ case: 'overview-dialog-direct-edit', ...edit2 });
    await shot('08-overview-dialog-editing');
    await ev(`document.documentElement.dataset.theme='midnight'`); await pause(300); await shot('09-overview-dialog-dark');
    await ev(`document.documentElement.dataset.theme=''`); await pause(200);
    await ev(`(()=>{const c=[...document.querySelectorAll('.summary-editor button')].find(b=>/^(关闭|取消)$/.test(b.textContent.trim()));c?.click();return !!c})()`);
    await pause(300);
    await ev(`(document.querySelector('.summary-editor')&&document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),true)`);
  } else measurements.push({ case: 'overview-dialog', opened: false });
  await ev(`([...document.querySelectorAll('[aria-label="文献显示方式"] button')].find(b=>b.textContent.trim()==='列表')?.click(),true)`);
  await pause(300);
  await send('Emulation.clearDeviceMetricsOverride');
  if (label === 'after') {
    const bad = [];
    if (!edit1.direct || !edit1.hasEditor || !edit1.focused) bad.push('free content must enter edit by direct click');
    if (rest.editButtons) bad.push('no per-card 编辑 buttons expected');
    if (rest.advancedSourceButtons) bad.push('高级源码 button must not be in normal UI');
    if (rest.bigCenteredTitle) bad.push('giant centered 总结笔记 title');
    if (rest.horizontalOverflow) bad.push('horizontal clipping in reader editor');
    if (!persisted) bad.push('typed content must persist after close/reopen');
    if (added?.grew && (fieldPersisted === false || !added.editAdded?.focused)) bad.push('added field must open focused and its content must persist');
    const dlg = measurements.find(m => m.case === 'overview-dialog');
    if (dlg?.advancedSourceButtons) bad.push('高级源码 button in overview dialog');
    if (dlg && dlg.sourceRepairEntry === false) bad.push('overview dialog must keep 以源码修复 recovery entry');
    if (bad.length) throw Error(bad.join('; '));
  }
} catch (e) {
  problem = String(e); errors.push('TEST ' + problem);
  try { await shot('failure'); } catch { /* ignore */ }
} finally {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ label, dir, instance, measurements, errors }, null, 2));
  ws.close();
  console.log(JSON.stringify({ dir, checks: measurements.length, errors }));
  if (errors.length) process.exitCode = 1;
}
