// Browser walk-through for card e4c2fa22: PDF link annotations and the 「返回」 stack, driven by real mouse
// input in headless Chrome/Edge over CDP against the real PdfReader (scripts/fixtures/pdf-link-host.tsx) on
// the hand-built link fixture (scripts/fixtures/pdf-link-fixture.mjs). Checks, in order:
//   1. links load lazily per page, carry hover tips (target page / citation number, full URL) and take the
//      pointer only in the cursor tool;
//   2. clicking an internal link scrolls the target line to the upper viewport, flashes it once (≤ 600 ms) and
//      shows 「返回 第 1 页」 on the right; the button returns to the exact scroll offset and fades out;
//   3. a second jump followed by a manual scroll back near the origin dismisses the button without a click,
//      while a scroll elsewhere keeps it; a two-hop chain pops one level at a time;
//   4. Alt+← plumbing (readerNavigation.requestPdfLinkBack) pops the stack; switching documents clears it;
//   5. external links reach the mocked `open_external_url` IPC with the exact URL; javascript:/mailto: links are
//      blocked with a hint and never reach the IPC; an IPC failure surfaces as a hint;
//   6. at 150 % zoom (and on the /Rotate 90 page) a link box sits on the text-layer glyphs within 2 px;
//   7. highlight / eraser / ink tools see through the layer, and a cursor-mode drag across link rows selects text.
// Evidence: .tmp/pdf-links/<tag>/*.png + links.log + result.json.
//   LINKS_TAG=<name>             evidence folder (default: after)
//   LINKS_REPORT_ONLY=1          record without failing the process
//   LINKS_REQUIRE_BROWSER=1      fail instead of skipping when no Chrome/Edge is installed
//   TASKBOARD_TEST_BROWSER=<exe> browser executable
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { LINKS, buildPdfLinkFixture } from './fixtures/pdf-link-fixture.mjs';

const root = process.cwd();
const tag = process.env.LINKS_TAG || 'after';
const reportOnly = process.env.LINKS_REPORT_ONLY === '1';
const evidence = path.join(root, '.tmp/pdf-links', tag);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-links-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const logFile = path.join(evidence, 'links.log');
const log = line => { const text = `${new Date().toISOString()} ${line}`; console.log(text); fs.appendFileSync(logFile, text + '\n'); };
const check = (name, condition, detail) => {
  checks.push({ name, passed: !!condition, detail });
  if (!condition) log(`FAIL ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`);
};
const round = value => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error) + ' :: ' + method + ' ' + String(params.expression ?? '').slice(0, 120))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
// Serialize inside the page: CDP returnByValue rejects some DOM-derived object graphs.
const evaluateJson = async expression => JSON.parse(await evaluate(`JSON.stringify((()=>{ return (${expression}); })())`));
const until = async (expression, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return true; await pause(60); }
  return false;
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot = async name => fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const mouse = (type, x, y, extra = {}) => rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const click = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await frame(); };
const drag = async (from, to, steps = 12, midpoint) => {
  await mouse('mouseMoved', from.x, from.y, { button: 'none' });
  await mouse('mousePressed', from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, { buttons: 1 });
    if (i === Math.floor(steps / 2) && midpoint) await midpoint();
    await pause(15);
  }
  await mouse('mouseReleased', to.x, to.y);
  await frame();
  await pause(120);
};

const browserExecutable = () => process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));

// ---------- page-side helpers (evaluated as strings) ----------
const CONTAINER = `document.querySelector('.pdf-document')`;
const linkExpr = (page, needle) => `[...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-link')].find(l => (l.getAttribute('aria-label') || '').includes(${JSON.stringify(needle)}))`;
const rectOf = expr => `(()=>{ const n = ${expr}; if (!n) return null; const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`;
const spanExpr = (page, needle) => `[...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-text-layer span')].find(s => s.textContent.trim() === ${JSON.stringify(needle)})`;
const state = () => evaluateJson(`(()=>{ const c = ${CONTAINER}; const b = document.querySelector('.pdf-link-back'); const flash = document.querySelector('.pdf-link-flash'); const hint = document.querySelector('.pdf-text-layer-hint');
  return { scrollTop: c.scrollTop, clientHeight: c.clientHeight, back: b ? { text: b.textContent, visible: b.classList.contains('is-visible'), page: b.dataset.linkBackPage, shortcutId: b.dataset.shortcutId, rect: (()=>{ const r = b.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(), opacity: getComputedStyle(b).opacity } : null,
    flash: flash ? { page: Number(flash.closest('.pdf-page').dataset.page), rect: (()=>{ const r = flash.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })(), opacity: getComputedStyle(flash).opacity, animation: getComputedStyle(flash).animationName } : null,
    hint: hint ? hint.textContent : null, ipc: window.__ipcCalls.filter(c => c.cmd === 'open_external_url'), selecting: c.dataset.textSelecting ?? null }; })()`);
const containerRect = () => evaluateJson(rectOf(CONTAINER));
// Page top in scroll pixels (offsetParent chain up to the scroller: `.pdf-page` offsets are relative to the
// transformed `.pdf-document-content`, which sits below the scroller's 7 px padding).
const pageBox = page => evaluateJson(`(()=>{ const c = ${CONTAINER}; const p = document.querySelector('.pdf-page[data-page="${page}"]'); let top = 0; for (let el = p; el && el !== c; el = el.offsetParent) top += el.offsetTop; return { offsetTop: top, offsetHeight: p.offsetHeight }; })()`);

async function main() {
  fs.writeFileSync(path.join(scratch, 'fixture.pdf'), buildPdfLinkFixture());
  const entry = fileURLToPath(new URL('./fixtures/pdf-link-host.tsx', import.meta.url));
  await build({
    configFile: false, root, logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.platform': JSON.stringify('win32'), 'process.env': '{}' },
    build: { outDir: scratch, emptyOutDir: false, minify: true, lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' }, rollupOptions: { external: [] } },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    plugins: [react()],
  });
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>pdf links</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
  web = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    const file = path.join(scratch, url);
    if (!file.startsWith(scratch) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + web.address().port;

  const exe = browserExecutable();
  assert.ok(exe, 'Chrome or Edge required');
  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--lang=zh-CN', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  // Tauri IPC mock: bytes for the fixture; open_external_url is recorded (and fails on demand).
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__ipcCalls = []; window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id; }, invoke: async (cmd, args) => { window.__ipcCalls.push({ cmd, args }); if (cmd === 'load_paper_file_bytes') { const buf = await (await fetch('/fixture.pdf')).arrayBuffer(); return Array.from(new Uint8Array(buf)); } if (cmd === 'open_external_url') { if (window.__failExternal) throw new Error('shell refused'); return null; } return null; } };` });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: origin + '/' });
  const ready = await until(`!!window.__pdfHarness && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready') && document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span').length >= 10`, 30000);
  check('reader renders the link fixture', ready, pageErrors.slice(0, 3));
  if (!ready) throw Error('reader did not render');
  await pause(300);

  const setZoom = async z => { await evaluate(`window.__pdfHarness.setZoom(${z})`); await until(`!document.querySelector('.pdf-page.updating') && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready')`, 20000); await pause(300); };
  const setTool = async t => { await evaluate(`window.__pdfHarness.setTool(${JSON.stringify(t)})`); await frame(); await pause(60); };
  const scrollTo = async top => { await evaluate(`${CONTAINER}.scrollTo({ top: ${top}, behavior: 'auto' })`); await frame(); await pause(250); };
  const results = {};

  // ---------- 1. link layer: lazy load, titles, pointer policy ----------
  const linksReady = await until(`document.querySelector('.pdf-page[data-page="1"] .pdf-link-layer[data-link-state="ready"]') !== null`, 15000);
  check('page 1 link layer loads (lazily, once the page is near the viewport)', linksReady);
  const linkSummary = await evaluateJson(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-link')].map(l => ({ title: l.getAttribute('aria-label'), kind: l.dataset.linkKind, page: l.dataset.linkPage ?? null, pe: getComputedStyle(l).pointerEvents, cursor: getComputedStyle(l).cursor, opacity: getComputedStyle(l).opacity }))`);
  results.links = linkSummary;
  log(`page 1 links: ${JSON.stringify(linkSummary)}`);
  check('page 1 exposes every fixture link as a box', linkSummary.length === Object.keys(LINKS).length, linkSummary.length);
  check('citation link title names the citation and the target page', linkSummary.some(l => l.title === '参考文献 [12] · 跳转到第 3 页' && l.page === '3'));
  check('external link title is the full URL', linkSummary.some(l => l.title === LINKS.https.url && l.kind === 'external'));
  check('broken destination is announced in the title', linkSummary.some(l => l.title === '链接目标无法解析'));
  check('links take the pointer in the cursor tool with a hand cursor and are invisible until hovered', linkSummary.every(l => l.pe === 'auto' && l.cursor === 'pointer' && l.opacity === '0'));
  const farLayer = await evaluateJson(`(()=>{ const l = document.querySelector('.pdf-page[data-page="3"] .pdf-link-layer'); return l ? l.dataset.linkState : 'none'; })()`);
  log(`page 3 link layer state before scrolling: ${farLayer}`);
  const citation = await evaluateJson(rectOf(linkExpr(1, '参考文献 [12]')));
  await mouse('mouseMoved', citation.cx, citation.cy, { button: 'none' });
  await frame(); await pause(200);
  const hovered = await evaluateJson(`(()=>{ const l = ${linkExpr(1, '参考文献 [12]')}; return { opacity: getComputedStyle(l).opacity, matches: l.matches(':hover') }; })()`);
  check('hovered link paints its box (opacity 1)', hovered.matches && Number(hovered.opacity) > 0.9, hovered);
  await pause(450);
  const tip = await evaluateJson(`(()=>{ const l = ${linkExpr(1, '参考文献 [12]')}; const s = getComputedStyle(l, '::after'); const box = l.getBoundingClientRect(); return { opacity: s.opacity, content: s.content, top: parseFloat(s.top), height: parseFloat(s.height), boxHeight: box.height, side: l.dataset.tipSide }; })()`);
  check('hover tip appears below the link (styled ::after with the label text, visible in screenshots)', Number(tip.opacity) > 0.9 && tip.content.includes('参考文献 [12] · 跳转到第 3 页') && tip.top >= tip.boxHeight && tip.height > 12, tip);
  await screenshot('01-hover-citation');

  // ---------- 2. internal jump → flash + back button → return ----------
  const before = await state();
  const cRect = await containerRect();
  await click(citation.cx, citation.cy);
  await pause(40);
  const justAfter = await state();
  const page3 = await pageBox(3);
  const referenceSpan = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="3"] .pdf-text-layer span')].find(s => s.textContent.startsWith('[12] Geng'))`));
  results.jump = { before: before.scrollTop, after: justAfter.scrollTop, page3, referenceSpan, flash: justAfter.flash, back: justAfter.back };
  log(`jump: scrollTop ${before.scrollTop} → ${justAfter.scrollTop}; reference line top at ${round(referenceSpan?.top)} (viewport top ${round(cRect.top)}); flash=${JSON.stringify(justAfter.flash)}; back=${JSON.stringify(justAfter.back)}`);
  check('clicking [12] scrolls to page 3', justAfter.scrollTop > page3.offsetTop - 60 && justAfter.scrollTop < page3.offsetTop + page3.offsetHeight);
  check('the reference line sits in the upper viewport (24 px ± 3 below the top)', !!referenceSpan && Math.abs((referenceSpan.top - cRect.top) - 24) <= 3, referenceSpan && round(referenceSpan.top - cRect.top));
  check('the target line flashes on page 3 (opacity animation)', !!justAfter.flash && justAfter.flash.page === 3 && justAfter.flash.animation === 'pdf-link-flash' && Math.abs(justAfter.flash.rect.top - (referenceSpan?.top ?? 0)) < 30, justAfter.flash);
  check('「返回 第 1 页」 appears on the right', !!justAfter.back && justAfter.back.text.includes('返回') && justAfter.back.text.includes('第 1 页') && justAfter.back.page === '1', justAfter.back);
  await pause(250);
  const shown = await state();
  check('the back button is visible (opacity 1) and carries the reader.linkBack shortcut id', !!shown.back && shown.back.visible && Number(shown.back.opacity) > 0.95 && shown.back.shortcutId === 'reader.linkBack', shown.back);
  check('the back button sits on the right side, lower middle of the surface', !!shown.back && shown.back.rect.right >= cRect.right - 40 && shown.back.rect.top > cRect.top + cRect.height * 0.5 && shown.back.rect.bottom < cRect.bottom - cRect.height * 0.15, shown.back?.rect);
  await screenshot('02-after-jump');
  await pause(500);
  const flashGone = await evaluateJson(`document.querySelector('.pdf-link-flash') === null || Number(getComputedStyle(document.querySelector('.pdf-link-flash')).opacity) < 0.05`);
  check('the flash is over within ~600 ms', flashGone);
  const backRect = shown.back.rect;
  await click((backRect.left + backRect.right) / 2, (backRect.top + backRect.bottom) / 2);
  await pause(60);
  const returned = await state();
  results.return = { scrollTop: returned.scrollTop, flash: returned.flash, back: returned.back };
  log(`return: scrollTop ${returned.scrollTop} (origin ${before.scrollTop}); flash=${JSON.stringify(returned.flash)}; back=${JSON.stringify(returned.back)}`);
  check('「返回」 restores the exact origin offset', Math.abs(returned.scrollTop - before.scrollTop) <= 1, { returned: returned.scrollTop, origin: before.scrollTop });
  check('the origin flashes on page 1', !!returned.flash && returned.flash.page === 1, returned.flash);
  check('the button starts fading right away', !returned.back || !returned.back.visible, returned.back);
  await pause(350);
  check('the button is removed after the fade', await evaluate(`document.querySelector('.pdf-link-back') === null`));
  await screenshot('03-after-return');

  // ---------- 3. auto-dismiss by manual scrolling; far scrolls keep it; two-hop chain ----------
  await click(citation.cx, citation.cy);
  await pause(300);
  const s3a = await state();
  check('second jump shows the button again', !!s3a.back && s3a.back.visible);
  const page2 = await pageBox(2);
  await scrollTo(page2.offsetTop + 40);
  const s3b = await state();
  check('scrolling to another page far from the origin keeps the button', !!s3b.back && s3b.back.visible, s3b.back);
  await scrollTo(before.scrollTop + Math.round(s3b.clientHeight * 0.3));
  const s3c = await state();
  check('scrolling back within 40 % of the viewport of the origin dismisses the button (no click)', !s3c.back || !s3c.back.visible, s3c.back);
  await pause(300);
  check('the dismissed button is removed after its fade', await evaluate(`document.querySelector('.pdf-link-back') === null`));
  await scrollTo(before.scrollTop);
  // Chain: page 1 → page 2 (/Fit) → page 3 ([7] on the rotated page) → back → back.
  // The /Fit link is the last internal link to page 2 (the named /FitH and the /Named NextPage come before it).
  const fitLink = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-link[data-link-kind="internal"]')].filter(l => l.getAttribute('aria-label') === '跳转到第 2 页').pop()`));
  await click(fitLink.cx, fitLink.cy);
  await pause(250);
  const hop1 = await state();
  check('hop 1 lands on page 2 with 「返回 第 1 页」', hop1.scrollTop >= page2.offsetTop - 2 && hop1.scrollTop <= page2.offsetTop + 2 && hop1.back?.page === '1', { scrollTop: hop1.scrollTop, page2, back: hop1.back });
  const rotatedReady = await until(`document.querySelector('.pdf-page[data-page="2"] .pdf-link-layer[data-link-state="ready"]') !== null`, 15000);
  check('page 2 links load once the page is in view', rotatedReady);
  const rotatedLink = await evaluateJson(rectOf(linkExpr(2, '参考文献 [7]')));
  check('rotated page exposes its [7] link', !!rotatedLink, rotatedLink);
  await click(rotatedLink.cx, rotatedLink.cy);
  await pause(250);
  const hop2 = await state();
  check('hop 2 lands on page 3 with 「返回 第 2 页」 (newest level first)', hop2.scrollTop > page3.offsetTop - 60 && hop2.back?.page === '2', { scrollTop: hop2.scrollTop, back: hop2.back });
  await screenshot('04-two-hop-stack');
  await click((hop2.back.rect.left + hop2.back.rect.right) / 2, (hop2.back.rect.top + hop2.back.rect.bottom) / 2);
  await pause(300);
  const pop1 = await state();
  check('first 「返回」 goes back to page 2 and now offers 「返回 第 1 页」', Math.abs(pop1.scrollTop - hop1.scrollTop) <= 1 && pop1.back?.page === '1' && pop1.back.visible, { scrollTop: pop1.scrollTop, back: pop1.back });
  await click((pop1.back.rect.left + pop1.back.rect.right) / 2, (pop1.back.rect.top + pop1.back.rect.bottom) / 2);
  await pause(350);
  const pop2 = await state();
  check('second 「返回」 goes back to page 1 and the stack is empty', Math.abs(pop2.scrollTop - before.scrollTop) <= 1 && (await evaluate(`document.querySelector('.pdf-link-back') === null`)), { scrollTop: pop2.scrollTop });

  // ---------- 4. Alt+← plumbing and document switch ----------
  await click(citation.cx, citation.cy);
  await pause(250);
  const viaShortcut = await evaluate(`window.__pdfHarness.linkBack()`);
  await pause(300);
  const s4 = await state();
  check('requestPdfLinkBack (the reader.linkBack / Alt+← command) pops the stack', viaShortcut === true && Math.abs(s4.scrollTop - before.scrollTop) <= 1 && !(s4.back?.visible), { viaShortcut, scrollTop: s4.scrollTop, back: s4.back });
  await click(citation.cx, citation.cy);
  await pause(250);
  check('button present before the document switch', (await state()).back?.visible === true);
  await evaluate(`window.__pdfHarness.setFileId('file-2')`);
  const switched = await until(`!!document.querySelector('.pdf-page[data-page="1"] canvas.ready') && document.querySelector('.pdf-page[data-page="1"] .pdf-link-layer[data-link-state="ready"]') !== null && ${CONTAINER}.scrollTop < 5`, 20000);
  await pause(250);
  check('switching documents clears the stack (no button on the new document)', switched && (await evaluate(`document.querySelector('.pdf-link-back') === null`)));

  // ---------- 5. external links: whitelist + IPC ----------
  const external = await evaluateJson(rectOf(linkExpr(1, LINKS.https.url)));
  await click(external.cx, external.cy);
  await pause(150);
  const s5a = await state();
  results.external = s5a.ipc;
  log(`external click → ipc=${JSON.stringify(s5a.ipc)} hint=${s5a.hint}`);
  check('https link reaches open_external_url with the exact URL', s5a.ipc.length === 1 && s5a.ipc[0].args?.request?.path === LINKS.https.url, s5a.ipc);
  check('an https link opens without a confirmation hint', s5a.hint === null, s5a.hint);
  check('an https link does not scroll or push the stack', Math.abs(s5a.scrollTop) <= 1 && !s5a.back, { scrollTop: s5a.scrollTop, back: s5a.back });
  const js = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-link')].find(l => (l.getAttribute('aria-label') || '').startsWith('javascript:'))`));
  await click(js.cx, js.cy);
  await pause(150);
  const s5b = await state();
  check('javascript: link is blocked with a hint and never reaches the IPC', s5b.ipc.length === 1 && typeof s5b.hint === 'string' && s5b.hint.includes('javascript:'), { ipc: s5b.ipc.length, hint: s5b.hint });
  await screenshot('05-blocked-javascript');
  const mailto = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-link')].find(l => (l.getAttribute('aria-label') || '').startsWith('mailto:'))`));
  await click(mailto.cx, mailto.cy);
  await pause(150);
  const s5c = await state();
  check('mailto: link is blocked with a hint and never reaches the IPC', s5c.ipc.length === 1 && typeof s5c.hint === 'string' && s5c.hint.includes('mailto:'), { ipc: s5c.ipc.length, hint: s5c.hint });
  const brokenLink = await evaluateJson(rectOf(linkExpr(1, '链接目标无法解析')));
  await click(brokenLink.cx, brokenLink.cy);
  await pause(150);
  const s5d = await state();
  check('a broken destination gives a hint instead of silence', typeof s5d.hint === 'string' && s5d.hint.includes('无法解析') && Math.abs(s5d.scrollTop) <= 1, s5d.hint);
  await evaluate(`window.__failExternal = true`);
  await click(external.cx, external.cy);
  await pause(200);
  const s5e = await state();
  check('an IPC failure surfaces as a hint', s5e.ipc.length === 2 && typeof s5e.hint === 'string' && s5e.hint.includes('打开链接失败'), { ipc: s5e.ipc.length, hint: s5e.hint });
  await evaluate(`window.__failExternal = false`);
  const namedLink = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-link[data-link-kind="named"]')][0]`));
  await click(namedLink.cx, namedLink.cy);
  await pause(250);
  const s5f = await state();
  check('/Named NextPage jumps to page 2 like an internal link', s5f.scrollTop >= page2.offsetTop - 2 && s5f.scrollTop <= page2.offsetTop + 2 && s5f.back?.page === '1', { scrollTop: s5f.scrollTop, page2 });
  await evaluate(`window.__pdfHarness.linkBack()`);
  await pause(300);

  // ---------- 6. alignment at 150 %, flat and rotated ----------
  await setZoom(1.5);
  // Link box vs the text under it: (a) the box must be the same page-percent geometry the text layer
  // positions its span with (no zoom/DPR double scaling), (b) the painted glyphs on the bitmap must lie
  // inside the box, allowing the brackets' descenders (0.3 em) — the span's own border box is shifted by the
  // text layer's font-metric correction, so it is not the reference.
  const align = async (page, needle, title) => {
    const data = await evaluateJson(`(()=>{
      const link = ${linkExpr(page, title)}; const span = ${spanExpr(page, needle)}; if (!link || !span) return null;
      const layer = link.closest('.pdf-render-layer'); const lr = layer.getBoundingClientRect(); const b = link.getBoundingClientRect();
      const pct = (v) => parseFloat(v) / 100;
      const geo = { left: lr.left + pct(span.style.left) * lr.width, top: lr.top + pct(span.style.top) * lr.height };
      const fontPx = parseFloat(getComputedStyle(span).fontSize);
      const canvas = layer.querySelector('canvas'); const cr = canvas.getBoundingClientRect(); const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
      const pad = fontPx * 0.3 + 4;
      const x0 = Math.max(0, Math.floor((b.left - pad - cr.left) * sx)), y0 = Math.max(0, Math.floor((b.top - pad - cr.top) * sy));
      const x1 = Math.min(canvas.width, Math.ceil((b.right + pad - cr.left) * sx)), y1 = Math.min(canvas.height, Math.ceil((b.bottom + pad - cr.top) * sy));
      const img = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0); let il = Infinity, it = Infinity, ir = -Infinity, ib = -Infinity;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const i = (y * img.width + x) * 4; if ((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 < 140) { il = Math.min(il, x); ir = Math.max(ir, x); it = Math.min(it, y); ib = Math.max(ib, y); } }
      const ink = il === Infinity ? null : { left: cr.left + (x0 + il) / sx, right: cr.left + (x0 + ir + 1) / sx, top: cr.top + (y0 + it) / sy, bottom: cr.top + (y0 + ib + 1) / sy };
      return { box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }, geo, fontPx, ink };
    })()`);
    if (!data) { log(`align page ${page} ${needle}: link or span missing`); return { geoDiff: Infinity, inkInside: false, inkCoverage: 0 }; }
    const { box, geo, fontPx, ink } = data;
    const geoDiff = Math.max(Math.abs(box.left - geo.left), Math.abs(box.top - geo.top));
    const allowance = 2 + fontPx * 0.3;
    const inkInside = !!ink && ink.left >= box.left - allowance && ink.right <= box.right + allowance && ink.top >= box.top - allowance && ink.bottom <= box.bottom + allowance;
    const inkCoverage = ink ? Math.min((ink.right - ink.left) / box.width, (ink.bottom - ink.top) / box.height) : 0;
    log(`align page ${page} ${needle}: link=${JSON.stringify(box)} spanGeometry=${JSON.stringify(geo)} ink=${JSON.stringify(ink)} geoDiff=${round(geoDiff)} allowance=${round(allowance)} coverage=${round(inkCoverage)}`);
    return { box, geo, ink, geoDiff, inkInside, inkCoverage };
  };
  const flat150 = await align(1, '[12]', '参考文献 [12]');
  results.align150 = { flat: flat150 };
  check('at 150 % the [12] link box is the text layer\'s own geometry within 2 px', flat150.geoDiff <= 2, round(flat150.geoDiff));
  check('at 150 % the painted [12] glyphs lie inside the link box and fill it', flat150.inkInside && flat150.inkCoverage >= 0.5, { inside: flat150.inkInside, coverage: round(flat150.inkCoverage) });
  await scrollTo(page2.offsetTop);
  await until(`document.querySelector('.pdf-page[data-page="2"] canvas.ready') !== null`, 15000);
  await pause(200);
  const rot150 = await align(2, '[7]', '参考文献 [7]');
  results.align150.rotated = rot150;
  check('at 150 % on the /Rotate 90 page the [7] link box is the text layer\'s own geometry within 2 px', rot150.geoDiff <= 2, round(rot150.geoDiff));
  check('at 150 % on the /Rotate 90 page the painted [7] glyphs lie inside the link box and fill it', rot150.inkInside && rot150.inkCoverage >= 0.5, { inside: rot150.inkInside, coverage: round(rot150.inkCoverage) });
  await screenshot('06-rotated-150');
  await scrollTo(0);
  await setZoom(1);

  // ---------- 7. tools see through the layer; drag selection across link rows ----------
  const citation1 = await evaluateJson(rectOf(linkExpr(1, '参考文献 [12]')));
  for (const tool of ['highlight', 'eraser', 'ink', 'rect']) {
    await setTool(tool);
    const pe = await evaluateJson(`(()=>{ const l = ${linkExpr(1, '参考文献 [12]')}; const hit = document.elementFromPoint(${citation1.cx}, ${citation1.cy}); return { pe: getComputedStyle(l).pointerEvents, hitIsLink: !!hit && hit.classList.contains('pdf-link') }; })()`);
    check(`${tool} tool: links do not take the pointer`, pe.pe === 'none' && !pe.hitIsLink, pe);
  }
  await setTool('eraser');
  await click(citation1.cx, citation1.cy);
  await pause(200);
  const s7 = await state();
  check('clicking a link with the eraser does not jump', Math.abs(s7.scrollTop) <= 1 && !s7.back, { scrollTop: s7.scrollTop });
  await setTool('cursor');
  const wide = await evaluateJson(rectOf(`[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span')].find(s => s.textContent.startsWith('Wide line'))`));
  const httpsBox = await evaluateJson(rectOf(linkExpr(1, LINKS.https.url)));
  let midDrag = null;
  await drag({ x: wide.left + 4, y: wide.cy }, { x: httpsBox.left + httpsBox.width * 0.6, y: httpsBox.cy }, 14, async () => { midDrag = await state(); });
  const selection = await evaluateJson(`(()=>{ const s = window.getSelection(); return { text: s ? s.toString() : '', ranges: s ? s.rangeCount : 0 }; })()`);
  log(`drag selection across link rows: selecting-mid=${midDrag?.selecting} text=${JSON.stringify(selection.text.slice(0, 160))}`);
  check('a cursor-mode drag marks the document as text-selecting so links release the pointer', midDrag?.selecting === 'true', midDrag?.selecting);
  check('the drag selects text across the link rows down to the URL line', selection.text.includes('Wide line') && selection.text.includes('Section 2') && selection.text.includes('https://arxiv.org'), selection.text.slice(0, 120));
  const afterDrag = await state();
  check('the text-selecting flag is cleared on mouseup and no jump happened', afterDrag.selecting === null && Math.abs(afterDrag.scrollTop) <= 1 && !afterDrag.back, { selecting: afterDrag.selecting, scrollTop: afterDrag.scrollTop });
  await screenshot('07-drag-across-links');
  await evaluate(`window.getSelection()?.removeAllRanges()`);

  check('no page errors or console errors during the walk-through', pageErrors.length === 0, pageErrors.slice(0, 5));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors }, null, 2));
  console.log(`verify-pdf-links-browser (${tag}): ${checks.filter(c => c.passed).length}/${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
}

if (!browserExecutable() && process.env.LINKS_REQUIRE_BROWSER !== '1') {
  // No browser on this machine: the pure checks in verify-pdf-links.mjs still guard the pipeline.
  console.log('verify-pdf-links-browser: skipped (no Chrome/Edge found; set TASKBOARD_TEST_BROWSER or LINKS_REQUIRE_BROWSER=1)');
  web?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
} else {
  try {
    await main();
  } catch (error) {
    try {
      if (ws) await screenshot('failure');
      fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ checks, pageErrors, error: String(error?.stack || error) }, null, 2));
    } catch (inner) { console.error('failure capture failed', inner); }
    throw error;
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    if (browser) { const exited = new Promise(r => browser.once('exit', r)); browser.kill(); await Promise.race([exited, pause(5000)]); }
    web?.close();
    for (let i = 0; i < 5; i++) { try { fs.rmSync(scratch, { recursive: true, force: true }); break; } catch { await pause(400); } }
    if (checks.some(c => !c.passed) && !reportOnly) process.exitCode = 1;
  }
}
