// Card 9222954f — browser regression for the reader text-layer hit/preview offset.
// At high zoom with a sidebar (container offset + horizontal scroll) the selection preview and
// the created underline/highlight used to land left of the pointer, because the transparent text
// runs were laid out in a substitute font whose advances differ from the PDF font: the caret the
// browser placed under the pointer and the character offset the reader mapped back onto the PDF
// run box disagreed by an amount that grew with the offset into the run and with the zoom.
// Builds the real PdfReader (production Vite build) into a harness with a synthetic two-page PDF,
// drives it through headless Chrome/Edge over CDP with real mouse drags and asserts, per scenario
// (zoom 1 / 1.5 / 3.7 × sidebar 0 / 360 px × page 1 / 2, plus a window resize), that the live
// preview, the created mark and the hit box start and end under the pointer for underline and
// highlight, that ink / rect / arrow drags map 1:1 onto their marks, and that an existing mark is
// hit where it is painted. Evidence: .tmp/pdf-text-layer-offset/<tag>/*.png + result.json.
//   OFFSET_TAG=<name>      evidence folder (default: after)
//   OFFSET_DPR=<factor>    device scale factor (default 1)
//   OFFSET_REPORT_ONLY=1   record without failing (baseline runs on old code)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const tag = process.env.OFFSET_TAG || 'after';
const reportOnly = process.env.OFFSET_REPORT_ONLY === '1';
const dpr = Number(process.env.OFFSET_DPR || 1);
const evidence = path.join(root, '.tmp/pdf-text-layer-offset', tag);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-text-layer-offset-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const logFile = path.join(evidence, 'geometry.log');
const log = line => { const text = `${new Date().toISOString()} ${line}`; console.log(text); fs.appendFileSync(logFile, text + '\n'); };
const ok = (condition, name, detail) => {
  checks.push({ name, passed: !!condition, detail });
  log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
  if (!reportOnly) assert.ok(condition, name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
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
  throw Error('Condition timed out: ' + expression.slice(0, 160) + ' errors=' + JSON.stringify(pageErrors.slice(0, 3)));
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot = async name => fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const mouse = (type, x, y, extra = {}) => rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const drag = async (from, to, steps = 12) => {
  await mouse('mouseMoved', from.x, from.y, { button: 'none' });
  await mouse('mousePressed', from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, { buttons: 1 });
    await pause(15);
  }
  await frame();
  await pause(120);
};

const LINE = (n) => `Line ${String(n).padStart(2, '0')}: curved trajectories, numerical ODE solvers lead to inaccurate results when applying ${n % 2 ? 'mean flows' : 'rectified paths'}.`;
function syntheticPdf() {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  const pageIds = [];
  const pagesId = 4 + 0; // patched below
  const pageBodies = [];
  for (let p = 0; p < 2; p++) {
    const ops = ['BT', '/F1 11 Tf', '14 TL', '54 740 Td'];
    for (let i = 1; i <= 30; i++) ops.push(`(${LINE(p * 30 + i).replace(/[()\\]/g, '\\$&')}) Tj`, 'T*');
    ops.push('ET');
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    pageBodies.push(content);
  }
  const pagesIndex = objects.length + pageBodies.length + 1;
  for (const content of pageBodies) pageIds.push(add(`<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  const pages = add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  assert.equal(pages, pagesIndex);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const browserExecutable = () => process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));

async function main() {
  fs.writeFileSync(path.join(scratch, 'fixture.pdf'), syntheticPdf());
  const harness = path.join(evidence, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  const entry = path.join(harness, 'entry.tsx');
  fs.writeFileSync(entry, `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PdfReader from '/src/features/reader/pdf/PdfReader';
import { defaultReaderToolSettings } from '/src/features/reader/pdf/types';
import '/src/ui/styles.css';
const source = { key: 'harness:file-1', title: 'Synthetic', fileId: 'file-1', request: { source: 'paperFile', paperId: 'harness', kind: 'source', fileId: 'file-1' } };
let counter = 0;
function Harness() {
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [tool, setTool] = useState<any>('cursor');
  const [zoom, setZoom] = useState(1);
  const [sidebar, setSidebar] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const latest = useRef(annotations); latest.current = annotations;
  const latestFocused = useRef(focused); latestFocused.current = focused;
  (window as any).__pdfHarness = { setTool, setZoom, setSidebar, annotations: () => latest.current, focused: () => latestFocused.current, reset: () => { setAnnotations([]); setFocused(null); }, replaceAnnotations: (next: any[]) => setAnnotations(next) };
  return <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
    <div className="harness-sidebar" style={{ width: sidebar, flex: '0 0 auto', background: '#dde5df' }} />
    <div className="reader-document-pane" style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <PdfReader source={source as any} annotations={annotations} activeTool={tool} activeAnnotationColor={'blue' as any} toolSettings={defaultReaderToolSettings}
        onCompleteOneShotTool={() => setTool('cursor')} zoom={zoom} onZoomChange={(z) => setZoom(z)}
        onCreateAnnotation={async (draft) => { const id = 'new-' + (++counter); setAnnotations(list => [...list, { id, paperId: 'harness', fileId: 'file-1', createdAt: new Date().toISOString(), ...draft }]); return id; }}
        onUpdateAnnotationComment={async () => {}} onUpdateAnnotationPosition={async (id, positionJson) => setAnnotations(list => list.map(a => a.id === id ? { ...a, positionJson } : a))} onUpdateAnnotationColor={async () => {}}
        onDeleteAnnotation={async (id) => setAnnotations(list => list.filter(a => a.id !== id))} onAppendAnnotationToNote={() => {}}
        onFocusAnnotation={(id) => setFocused(id)} focusedAnnotationId={focused} />
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
`);
  await build({
    configFile: false, root, logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.platform': JSON.stringify('win32'), 'process.env': '{}' },
    build: { outDir: scratch, emptyOutDir: false, minify: true, lib: { entry, formats: ['es'], fileName: () => 'entry.js', cssFileName: 'entry' }, rollupOptions: { external: [] } },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    plugins: [react()],
  });
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>pdf-text-layer-offset harness</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
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
  // Tauri shim: the reader only loads bytes inside the desktop runtime; serve the synthetic PDF through the same command.
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id; }, invoke: async (cmd) => { if (cmd === 'load_paper_file_bytes') { const buf = await (await fetch('/fixture.pdf')).arrayBuffer(); return Array.from(new Uint8Array(buf)); } return null; } };` });
  const viewport = { width: 1600, height: 1000 };
  const setViewport = async (width, height) => { await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }); await frame(); await pause(150); };
  await setViewport(viewport.width, viewport.height);
  await rpc('Page.navigate', { url: origin + '/' });
  await until(`!!window.__pdfHarness && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready') && document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span').length >= 30`, 30000);
  await pause(400);

  const setZoom = async z => {
    await evaluate(`window.__pdfHarness.setZoom(${z})`);
    await until(`Math.abs(document.querySelector('.pdf-page[data-page="1"] .pdf-render-layer').getBoundingClientRect().width - 612*${z}) < 2 && !document.querySelector('.pdf-page.updating')`, 20000);
    await pause(250);
  };
  const setSidebar = async w => { await evaluate(`window.__pdfHarness.setSidebar(${w})`); await frame(); await pause(150); };
  const setTool = async t => { await evaluate(`window.__pdfHarness.setTool(${JSON.stringify(t)})`); await frame(); };
  const reset = async () => { await evaluate('window.__pdfHarness.reset()'); await frame(); };
  const annotations = () => evaluate('JSON.parse(JSON.stringify(window.__pdfHarness.annotations()))');
  const spanExpr = (page, needle) => `[...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-text-layer span')].find(s=>s.textContent.includes(${JSON.stringify(needle)}))`;
  // Bring character `ci` of the run containing `needle` on `page` to a comfortable viewport spot.
  const scrollToChar = async (page, needle, ci) => {
    await evaluate(`(()=>{const s=${spanExpr(page, needle)};const t=s.firstChild;const r=document.createRange();r.setStart(t,${ci});r.setEnd(t,${ci}+1);const b=r.getBoundingClientRect();const c=document.querySelector('.pdf-document');const cr=c.getBoundingClientRect();c.scrollLeft+=b.left-cr.left-cr.width*0.45;c.scrollTop+=b.top-cr.top-cr.height*0.4;})()`);
    await frame(); await pause(150);
  };
  // Client rect of one character of a run, plus the run's own geometry.
  const charRect = (page, needle, ci) => evaluate(`(()=>{const s=${spanExpr(page, needle)};const t=s.firstChild;const r=document.createRange();r.setStart(t,${ci});r.setEnd(t,${ci}+1);const b=r.getBoundingClientRect();const l=s.closest('.pdf-render-layer').getBoundingClientRect();const c=document.querySelector('.pdf-document');const g=document.createRange();g.selectNodeContents(t);const gb=g.getBoundingClientRect();return {left:b.left,right:b.right,cx:b.left+b.width/2,cy:b.top+b.height/2,top:b.top,bottom:b.bottom,width:b.width,run:{left:parseFloat(s.style.left)/100*l.width+l.left,width:parseFloat(s.style.width)/100*l.width||null,glyphLeft:gb.left,glyphWidth:gb.width,scale:s.style.getPropertyValue('--pdf-run-scale')||null,font:getComputedStyle(s).fontFamily},layer:{left:l.left,top:l.top,width:l.width,height:l.height},scroll:{left:c.scrollLeft,top:c.scrollTop}}})()`);
  const previewRects = () => evaluate(`[...document.querySelectorAll('.pdf-highlight-paint rect[data-selection-preview]')].map(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const markRects = selector => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(m=>!m.classList.contains('draft')).map(m=>{const r=m.getBoundingClientRect();return {id:m.dataset.annotationId,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const highlightPaintRects = () => evaluate(`[...document.querySelectorAll('.pdf-highlight-paint rect:not([data-selection-preview])')].map(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const hitAt = (x, y) => evaluate(`(()=>{const e=document.elementFromPoint(${x},${y});const m=e&&e.closest('.annotation-mark');return m?{id:m.dataset.annotationId,cls:m.className}:{id:null,tag:e&&e.tagName,cls:e&&e.className}})()`);

  const results = { dpr, viewport, scenarios: [], shapes: [], resize: null, reopen: null, pageErrors };
  const TOL = 1.5 * Math.max(1, dpr); // px: sub-glyph accuracy at every zoom; the old code drifted 20–110 px

  // ---- text tools: pointer ↔ preview ↔ created mark ↔ hit box ------------------------------
  const scenarios = [
    { zoom: 1, sidebar: 0, page: 1 }, { zoom: 1, sidebar: 360, page: 1 },
    { zoom: 1.5, sidebar: 360, page: 2 },
    { zoom: 3.7, sidebar: 0, page: 1 }, { zoom: 3.7, sidebar: 360, page: 1 }, { zoom: 3.7, sidebar: 360, page: 2 },
  ];
  const START = 9, END = 60; // character indices inside the run "Line NN: curved trajectories, …"
  for (const scenario of scenarios) {
    const needle = `Line ${String((scenario.page - 1) * 30 + 12).padStart(2, '0')}:`;
    const label = `z${scenario.zoom}-s${scenario.sidebar}-p${scenario.page}`;
    await reset();
    await setSidebar(scenario.sidebar);
    await setZoom(scenario.zoom);
    const record = { ...scenario, label, tools: {} };
    for (const tool of ['underline', 'highlight']) try {
      await setTool(tool);
      await scrollToChar(scenario.page, needle, START);
      const a = await charRect(scenario.page, needle, START);
      const b = await charRect(scenario.page, needle, END);
      // Press just inside the first glyph and release just inside the last one, so the native
      // caret snaps to the near edge of both and the expected band is exactly [a.left, b.right].
      const from = { x: a.left + 1, y: a.cy }, to = { x: b.right - 1, y: a.cy };
      await drag(from, to);
      const preview = await previewRects();
      const selected = await evaluate('window.getSelection().toString()');
      await screenshot(`${label}-${tool}-dragging`);
      await mouse('mouseReleased', to.x, to.y);
      await until(`window.__pdfHarness.annotations().length === ${tool === 'underline' ? 1 : 2}`, 8000);
      await pause(200);
      const marks = await markRects(`.annotation-mark.${tool}[data-annotation-id]`);
      const paint = tool === 'highlight' ? await highlightPaintRects() : [];
      await screenshot(`${label}-${tool}-created`);
      const created = (await annotations()).at(-1);
      const mark = marks[0];
      // Range marks are pass-through paint while a text tool is active (reader.css); hit-test with the cursor tool.
      await setTool('cursor');
      const hitStart = mark ? await hitAt(a.left + 2, tool === 'underline' ? (mark.top + mark.bottom) / 2 : a.cy) : null;
      const hitEnd = mark ? await hitAt(b.right - 2, tool === 'underline' ? (mark.top + mark.bottom) / 2 : a.cy) : null;
      const entry = {
        pointer: { from, to }, charStart: { left: a.left, right: a.right }, charEnd: { left: b.left, right: b.right },
        run: a.run, layer: a.layer, scroll: a.scroll, selected, preview, marks, paint,
        created: created && { type: created.type, quote: created.quote, position: created.positionJson },
        hitStart, hitEnd,
      };
      record.tools[tool] = entry;
      log(`${label} ${tool} pointer=[${from.x.toFixed(1)},${to.x.toFixed(1)}] char=[${a.left.toFixed(1)},${b.right.toFixed(1)}] mark=[${mark?.left.toFixed(1)},${mark?.right.toFixed(1)}] preview=[${preview[0]?.left.toFixed(1)},${preview[0]?.right.toFixed(1)}] scale=${a.run.scale} scroll=${a.scroll.left},${a.scroll.top} layerLeft=${a.layer.left}`);
      ok(marks.length === 1, `${label} ${tool}: exactly one mark created`, marks);
      ok(created?.type === tool && created.quote.startsWith('curved trajectories') && created.quote.endsWith('lead to i'), `${label} ${tool}: quote follows the dragged characters`, created?.quote);
      ok(mark && Math.abs(mark.left - a.left) <= TOL, `${label} ${tool}: mark starts under the pointer`, { markLeft: mark?.left, charLeft: a.left });
      ok(mark && Math.abs(mark.right - b.right) <= TOL, `${label} ${tool}: mark ends under the pointer`, { markRight: mark?.right, charRight: b.right });
      ok(preview.length === 1 && Math.abs(preview[0].left - a.left) <= TOL && Math.abs(preview[0].right - b.right) <= TOL, `${label} ${tool}: live preview matches the pointer`, preview);
      ok(mark && preview[0] && Math.abs(preview[0].left - mark.left) <= 0.5 && Math.abs(preview[0].right - mark.right) <= 0.5, `${label} ${tool}: preview and created mark share one geometry`, { preview: preview[0], mark });
      if (tool === 'highlight') ok(paint.length === 1 && Math.abs(paint[0].left - mark.left) <= 0.5 && Math.abs(paint[0].right - mark.right) <= 0.5, `${label} highlight: painted band equals the hit box`, { paint, mark });
      ok(hitStart?.id === mark?.id && hitEnd?.id === mark?.id, `${label} ${tool}: hit box covers the painted start and end`, { hitStart, hitEnd });
      // Re-hit the existing mark with the cursor tool: focus must follow the painted geometry.
      const mid = { x: (mark.left + mark.right) / 2, y: (mark.top + mark.bottom) / 2 };
      await mouse('mouseMoved', mid.x, mid.y, { button: 'none' });
      await mouse('mousePressed', mid.x, mid.y);
      await mouse('mouseReleased', mid.x, mid.y);
      await frame(); await pause(120);
      const focused = await evaluate('window.__pdfHarness.focused()');
      entry.focusedAfterClick = focused;
      ok(focused === mark.id, `${label} ${tool}: clicking the painted mark focuses it`, { focused, expected: mark.id });
      await evaluate('window.getSelection().removeAllRanges()');
    } catch (error) {
      // Baseline runs on the old code lose the selection entirely at 370 % + sidebar; keep recording.
      if (!reportOnly) throw error;
      log(`ERROR ${label} ${tool}: ${error.message.split('\n')[0]}`);
      checks.push({ name: `${label} ${tool}: scenario completed`, passed: false, detail: error.message.slice(0, 200) });
      try { await mouse('mouseReleased', 0, 0); await evaluate('window.getSelection().removeAllRanges()'); await setTool('cursor'); await reset(); } catch { /* ignore */ }
    }
    results.scenarios.push(record);
  }

  // ---- shape tools at 370 % + sidebar: pointer bounds equal mark bounds -----------------------
  await reset();
  await setSidebar(360);
  await setZoom(3.7);
  await scrollToChar(1, 'Line 20:', 20);
  const anchor = await charRect(1, 'Line 20:', 20);
  const shapeFrom = { x: anchor.left, y: anchor.top - 8 };
  const shapeTo = { x: anchor.left + 260, y: anchor.top + 120 };
  for (const tool of ['ink', 'rect', 'arrow']) {
    // Each shape gets an empty page: an earlier mark under the pointer would swallow the mousedown.
    await reset();
    await setTool(tool);
    await drag(shapeFrom, shapeTo, 16);
    await mouse('mouseReleased', shapeTo.x, shapeTo.y);
    await until(`window.__pdfHarness.annotations().some(a => a.type === ${JSON.stringify(tool)})`, 8000);
    await pause(200);
    const marks = await markRects(`.annotation-mark.${tool}`); // ink/arrow marks carry no data-annotation-id
    const created = (await annotations()).find(a => a.type === tool);
    await screenshot(`z3.7-s360-${tool}-created`);
    const mark = marks[0];
    const expected = { left: Math.min(shapeFrom.x, shapeTo.x), right: Math.max(shapeFrom.x, shapeTo.x), top: Math.min(shapeFrom.y, shapeTo.y), bottom: Math.max(shapeFrom.y, shapeTo.y) };
    // Marks can carry a stroke/outline margin; compare their centre and size instead of raw edges.
    const centre = r => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    const c = mark && centre(mark), e = centre(expected);
    const tol = tool === 'arrow' ? 12 : 8; // stroke width / arrow head allowance in screen px
    results.shapes.push({ tool, pointer: { from: shapeFrom, to: shapeTo }, mark, position: created?.positionJson });
    log(`z3.7-s360 ${tool} pointer=[${expected.left},${expected.top}]-[${expected.right},${expected.bottom}] mark=[${mark?.left.toFixed(1)},${mark?.top.toFixed(1)}]-[${mark?.right.toFixed(1)},${mark?.bottom.toFixed(1)}]`);
    ok(mark && Math.abs(c.x - e.x) <= tol && Math.abs(c.y - e.y) <= tol, `z3.7-s360 ${tool}: mark centre follows the drag`, { mark, expected });
    ok(mark && Math.abs((mark.right - mark.left) - (expected.right - expected.left)) <= tol * 2 && Math.abs((mark.bottom - mark.top) - (expected.bottom - expected.top)) <= tol * 2, `z3.7-s360 ${tool}: mark size follows the drag`, { mark, expected });
    if (tool === 'arrow') {
      const p = created.positionJson;
      const l = anchor.layer;
      const startPx = { x: l.left + p.startX / 100 * l.width, y: l.top + p.startY / 100 * l.height };
      const endPx = { x: l.left + p.endX / 100 * l.width, y: l.top + p.endY / 100 * l.height };
      ok(Math.abs(startPx.x - shapeFrom.x) <= 1.5 && Math.abs(startPx.y - shapeFrom.y) <= 1.5 && Math.abs(endPx.x - shapeTo.x) <= 1.5 && Math.abs(endPx.y - shapeTo.y) <= 1.5, 'z3.7-s360 arrow: persisted endpoints round-trip to the pointer', { startPx, endPx, shapeFrom, shapeTo });
    }
    if (tool === 'ink') {
      const p = created.positionJson;
      const l = anchor.layer;
      const first = p.points[0], last = p.points.at(-1);
      const firstPx = { x: l.left + first.x / 100 * l.width, y: l.top + first.y / 100 * l.height };
      const lastPx = { x: l.left + last.x / 100 * l.width, y: l.top + last.y / 100 * l.height };
      ok(Math.abs(firstPx.x - shapeFrom.x) <= 1.5 && Math.abs(firstPx.y - shapeFrom.y) <= 1.5 && Math.abs(lastPx.x - shapeTo.x) <= 1.5 && Math.abs(lastPx.y - shapeTo.y) <= 1.5, 'z3.7-s360 ink: persisted stroke ends round-trip to the pointer', { firstPx, lastPx, shapeFrom, shapeTo });
    }
    await setTool('cursor');
  }

  // ---- window resize + reopen: fitted runs and persisted marks keep following the glyphs -----
  await reset();
  await setSidebar(360);
  await setZoom(3.7);
  await setTool('underline');
  await scrollToChar(1, 'Line 25:', START);
  {
    const a = await charRect(1, 'Line 25:', START), b = await charRect(1, 'Line 25:', END);
    await drag({ x: a.left + 1, y: a.cy }, { x: b.right - 1, y: a.cy });
    await mouse('mouseReleased', b.right - 1, a.cy);
    await until('window.__pdfHarness.annotations().length === 1', 8000);
    await setTool('cursor');
  }
  await setViewport(1180, 760);
  await scrollToChar(1, 'Line 25:', START);
  {
    const a = await charRect(1, 'Line 25:', START), b = await charRect(1, 'Line 25:', END);
    const [mark] = await markRects('.annotation-mark.underline[data-annotation-id]');
    await screenshot('z3.7-s360-resized');
    results.resize = { viewport: { width: 1180, height: 760 }, charStart: a.left, charEnd: b.right, mark, scale: a.run.scale };
    log(`resize 1180x760 char=[${a.left.toFixed(1)},${b.right.toFixed(1)}] mark=[${mark?.left.toFixed(1)},${mark?.right.toFixed(1)}] scale=${a.run.scale}`);
    ok(mark && Math.abs(mark.left - a.left) <= TOL && Math.abs(mark.right - b.right) <= TOL, 'after a window resize the mark still spans the same glyphs', { mark, a: a.left, b: b.right });
  }
  // Reopen: feed the persisted JSON back in at another zoom and check the same glyphs are covered.
  const persisted = JSON.parse(JSON.stringify(await annotations()));
  await reset();
  await evaluate(`window.__pdfHarness.replaceAnnotations(${JSON.stringify(persisted)})`);
  await setViewport(viewport.width, viewport.height);
  await setSidebar(0);
  await setZoom(1.5);
  await scrollToChar(1, 'Line 25:', START);
  {
    const a = await charRect(1, 'Line 25:', START), b = await charRect(1, 'Line 25:', END);
    const [mark] = await markRects('.annotation-mark.underline[data-annotation-id]');
    await screenshot('reopened-z1.5-s0');
    results.reopen = { zoom: 1.5, charStart: a.left, charEnd: b.right, mark };
    log(`reopen z1.5 char=[${a.left.toFixed(1)},${b.right.toFixed(1)}] mark=[${mark?.left.toFixed(1)},${mark?.right.toFixed(1)}]`);
    ok(mark && Math.abs(mark.left - a.left) <= TOL && Math.abs(mark.right - b.right) <= TOL, 'persisted geometry reopened at another zoom/layout covers the same glyphs', { mark, a: a.left, b: b.right });
  }

  ok(pageErrors.length === 0, 'no uncaught page errors or console errors', pageErrors.slice(0, 5));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors }, null, 2));
  console.log(`verify-pdf-text-layer-offset-browser (${tag}): ${checks.filter(c => c.passed).length}/${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
}

if (!browserExecutable() && process.env.OFFSET_REQUIRE_BROWSER !== '1') {
  // The geometry can only be exercised by a real layout engine; without one the fast source/logic
  // checks in verify-pdf-text-layer-offset.mjs still guard the pipeline.
  console.log('verify-pdf-text-layer-offset-browser: skipped (no Chrome/Edge found; set TASKBOARD_TEST_BROWSER or OFFSET_REQUIRE_BROWSER=1)');
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}

try {
  await main();
} catch (error) {
  try {
    if (ws) {
      await screenshot('failure');
      fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ checks, pageErrors, error: String(error?.stack || error) }, null, 2));
    }
  } catch (inner) { console.error('failure capture failed', inner); }
  throw error;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  if (browser) {
    const exited = new Promise(r => browser.once('exit', r));
    browser.kill();
    await Promise.race([exited, pause(5000)]);
  }
  web?.close();
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(scratch, { recursive: true, force: true }); break; } catch { await pause(400); }
  }
  if (checks.some(c => !c.passed) && !reportOnly) process.exitCode = 1;
}
