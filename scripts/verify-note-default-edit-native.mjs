// Isolated native WebView2 evidence: reader notes open in live edit every time,
// a manual read switch only lasts for the current open, and the redesigned
// workbench mode menu (diagram + name + shortcut + description) renders in light,
// dark, narrow and zoomed states. Requires an isolated dev:live instance.
// Usage: node scripts/verify-note-default-edit-native.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'before';
const port = Number(process.env.NOTE_DEFAULT_CDP_PORT || 9246);
const vitePort = Number(process.env.NOTE_DEFAULT_VITE_PORT || 1439);
const instance = process.env.NOTE_DEFAULT_INSTANCE || 'readermotion';
const dir = path.resolve('.tmp/shots/reader-note-default-native', label);
fs.mkdirSync(dir, { recursive: true });
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = tabs.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${vitePort}`));
if (!page) throw Error('Isolated WebView target missing');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const errors = [];
const measurements = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push('pageerror ' + m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map(x => x.value ?? x.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result?.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (expr, name) => { for (let i = 0; i < 120; i += 1) { try { if (await ev(expr)) return; } catch { /* retry */ } await pause(120); } throw Error('timeout ' + name); };
const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const MODE_EXPR = `(()=>{const root=document.querySelector('.workbench-tab-frame.active .reader-workspace-shell');const btn=document.querySelector('.workbench-tab-frame.active .note-view-switch button.active');const retained=document.querySelector('.workbench-tab-frame.active .reader-retained-note');return {phase:root?.dataset.notePresence??null,mode:root?.dataset.noteMode??null,content:btn?.getAttribute('aria-label')??null,editor:!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .cm-content, .workbench-tab-frame.active .reader-retained-note .summary-document-editor'),preview:!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .note-preview-only'),retainedHidden:retained?.hidden??null}})()`;
const mode = () => ev(MODE_EXPR);
const click = selector => ev(`(document.querySelector(${JSON.stringify(selector)}).click(),true)`);
let problem = null;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  await wait(`!!document.querySelector('.workbench-tab-frame.active .paper-table tbody tr')`, 'isolated fixture papers');
  await ev(`(document.querySelector('.workbench-tab-frame.active .paper-table tbody tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  await wait(`!!document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button')`, 'reader');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(500);
  if ((await mode())?.phase !== 'hidden') {
    await click('.workbench-tab-frame.active .reader-note-workbench-button');
    await wait(`document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.notePresence==='hidden'`, 'reset note');
    await pause(300);
  }
  // First open: must default to live edit in both builds.
  await click('.workbench-tab-frame.active .reader-note-workbench-button');
  await wait(`document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'first open');
    await wait("!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .cm-content, .workbench-tab-frame.active .reader-retained-note .summary-document-editor, .workbench-tab-frame.active .reader-retained-note .note-preview-only')", 'content surface');
await pause(400);
  const first = await mode();
  measurements.push({ case: 'first-open', ...first });
  await shot('00-first-open');
  // Manual switch to reading; effective for the current open.
  await ev(`([...document.querySelectorAll('.workbench-tab-frame.active .note-view-switch button')].find(b=>b.getAttribute('aria-label')==='阅读模式')?.click(),true)`);
    await wait("!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .cm-content, .workbench-tab-frame.active .reader-retained-note .summary-document-editor, .workbench-tab-frame.active .reader-retained-note .note-preview-only')", 'content surface');
await pause(300);
  const manualRead = await mode();
  measurements.push({ case: 'manual-read', ...manualRead });
  await shot('01-manual-read');
  // Layout switch inside the same open must not reset the content state.
  await ev(`(()=>{const b=document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button');b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true})()`);
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`, 'mode menu');
  await ev(`([...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(x=>x.textContent.includes('悬浮速记'))?.click(),true)`);
  await wait(`document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.noteMode==='floating'`, 'floating');
    await wait("!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .cm-content, .workbench-tab-frame.active .reader-retained-note .summary-document-editor, .workbench-tab-frame.active .reader-retained-note .note-preview-only')", 'content surface');
await pause(400);
  const sameOpenFloating = await mode();
  measurements.push({ case: 'same-open-floating', ...sameOpenFloating });
  await shot('02-floating-same-open');
  // Close, then re-open: the default must be live edit again (after the fix).
  await click('.workbench-tab-frame.active .reader-note-workbench-button');
  await wait(`document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.notePresence==='hidden'`, 'closed');
  await pause(300);
  await click('.workbench-tab-frame.active .reader-note-workbench-button');
  await wait(`document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.notePresence==='entered'`, 'reopen');
    await wait("!!document.querySelector('.workbench-tab-frame.active .reader-retained-note .cm-content, .workbench-tab-frame.active .reader-retained-note .summary-document-editor, .workbench-tab-frame.active .reader-retained-note .note-preview-only')", 'content surface');
await pause(400);
  const reopen = await mode();
  measurements.push({ case: 'reopen', ...reopen });
  await shot('03-reopen');
  // Redesigned menu in light, dark, narrow and zoomed states.
  await ev(`(()=>{const b=document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button');b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true})()`);
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`, 'menu for shots');
  await pause(250);
  await shot('04-menu-light');
  await ev(`document.documentElement.dataset.theme='midnight'`);
  await pause(300);
  await shot('05-menu-dark');
  await ev(`document.documentElement.dataset.theme=''`);
  await pause(200);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await pause(350);
  await shot('06-narrow-reopen-state');
  await ev(`(()=>{if(!document.querySelector('.reader-note-workbench-menu')){document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))}return true})()`);
  await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`, 'narrow menu');
  await pause(250);
  await shot('07-menu-narrow');
  await ev(`document.documentElement.style.zoom='125%'`);
  await pause(300);
  await shot('08-menu-zoom-125');
  await ev(`document.documentElement.style.zoom=''`);
  await send('Emulation.clearDeviceMetricsOverride');
  if (label === 'after') {
    if (first.content !== '编辑模式') throw Error('first open must default to live edit ' + JSON.stringify(first));
    if (manualRead.content !== '阅读模式') throw Error('manual read switch must apply within the open ' + JSON.stringify(manualRead));
    if (sameOpenFloating.content !== '阅读模式') throw Error('layout switch must not reset the content state within the open ' + JSON.stringify(sameOpenFloating));
    if (reopen.content !== '编辑模式') throw Error('re-open must default back to live edit ' + JSON.stringify(reopen));
  } else {
    measurements.push({ case: 'before-baseline', firstDefaultsEdit: first.content === '编辑模式', reopenKeepsManualRead: reopen.content === '阅读模式' });
  }
} catch (e) {
  problem = String(e);
  errors.push('TEST ' + problem);
  try { await shot('failure'); } catch { /* ignore */ }
} finally {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ label, dir, instance, measurements, errors }, null, 2));
  ws.close();
  console.log(JSON.stringify({ dir, checks: measurements.length, errors }));
  if (errors.length) process.exitCode = 1;
}
