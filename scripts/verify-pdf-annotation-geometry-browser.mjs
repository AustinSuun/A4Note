// Browser walk-through for card 6d59b629: highlight / underline geometry and the quick-action
// popup against the real pdf.js text layer and bitmap, driven by real mouse drags in headless
// Chrome/Edge over CDP. A synthetic A4 Times-Roman document (11 pt body, 9 pt / 10 pt-leading
// footnote block) is rendered by the real PdfReader; per scenario (pdf zoom × root css zoom × dpr)
// the script selects one word and checks that
//   - the band's left/right edges coincide with the selection's own client rects,
//   - the band spans ascender → descender of the run (baseline − 0.9 em … baseline + 0.2 em) and the
//     underline rule sits just under the baseline, with the baseline agreeing with the bitmap,
//   - the text-layer glyphs of a mid-run word sit on the painted glyphs (substitute-font drift),
//   - the persisted PositionJson is identical at every zoom / root zoom / dpr,
//   - the SelectionPopup hangs 10 px above the selected line, over the pointer,
//   - a two-line selection of the 9 pt block yields two per-line bands (not one band across the leading)
//     that stay on their lines after a zoom change, and an old single-rect annotation still paints.
// Evidence: .tmp/pdf-annotation-geometry/<tag>/*.png + geometry.log + result.json.
//   GEOMETRY_TAG=<name>          evidence folder (default: after)
//   GEOMETRY_REPORT_ONLY=1       record without failing the process
//   GEOMETRY_REQUIRE_BROWSER=1   fail instead of skipping when no Chrome/Edge is installed
//   TASKBOARD_TEST_BROWSER=<exe> browser executable
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const tag = process.env.GEOMETRY_TAG || 'after';
const reportOnly = process.env.GEOMETRY_REPORT_ONLY === '1';
const evidence = path.join(root, '.tmp/pdf-annotation-geometry', tag);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotation-geometry-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const logFile = path.join(evidence, 'geometry.log');
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

// ---------- fixture: A4, Times-Roman, 30 body lines (11/14 pt) and a 9/10 pt footnote block ----------
const A4 = { width: 595.276, height: 841.89 };
const BODY_LINE = (n) => `Line ${String(n).padStart(2, '0')}: curved trajectories, numerical ODE solvers lead to inaccurate results when applying ${n % 2 ? 'mean flows' : 'rectified paths'}.`;
const SMALL_LINE = (n) => `Small ${String(n).padStart(2, '0')}: footnote-sized text set at nine point on ten point leading, line pitch below the old fixed tolerance of the reader.`;
const SMALL_LINES = 6;
function syntheticPdf() {
  const escape = (text) => text.replace(/[()\\]/g, '\\$&');
  const ops = ['BT', '/F1 11 Tf', '14 TL', '54 780 Td'];
  for (let i = 1; i <= 30; i++) ops.push(`(${escape(BODY_LINE(i))}) Tj`, 'T*');
  ops.push('ET', 'BT', '/F1 9 Tf', '10 TL', '54 330 Td');
  for (let i = 1; i <= SMALL_LINES; i++) ops.push(`(${escape(SMALL_LINE(i))}) Tj`, 'T*');
  ops.push('ET');
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Page /Parent 4 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Catalog /Pages 4 0 R >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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
  const [focused, setFocused] = useState<string | null>(null);
  const latest = useRef(annotations); latest.current = annotations;
  (window as any).__pdfHarness = { setTool, setZoom, annotations: () => latest.current, reset: () => { setAnnotations([]); setFocused(null); }, replaceAnnotations: (next: any[]) => setAnnotations(next) };
  return <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
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
  // lang="zh-CN" like the app: the generic `serif` keyword alone would resolve to a CJK face here.
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>annotation geometry</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
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
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id; }, invoke: async (cmd) => { if (cmd === 'load_paper_file_bytes') { const buf = await (await fetch('/fixture.pdf')).arrayBuffer(); return Array.from(new Uint8Array(buf)); } return null; } };` });
  const viewport = { width: 1400, height: 1000 };
  const setViewport = async (width, height, dpr) => { await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }); await frame(); await pause(150); };
  await setViewport(viewport.width, viewport.height, 1);
  await rpc('Page.navigate', { url: origin + '/' });
  await until(`!!window.__pdfHarness && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready') && document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span').length >= 36`, 30000);
  await pause(400);

  const setZoom = async z => {
    await evaluate(`window.__pdfHarness.setZoom(${z})`);
    await until(`!document.querySelector('.pdf-page.updating') && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready')`, 20000);
    await pause(300);
  };
  // Root zoom the way App.tsx applies the UI zoom (documentElement.style.zoom).
  const setUiZoom = async z => { await evaluate(`document.documentElement.style.zoom = ${JSON.stringify(z === 1 ? '' : (z * 100) + '%')}`); await frame(); await pause(250); };
  const setTool = async t => { await evaluate(`window.__pdfHarness.setTool(${JSON.stringify(t)})`); await frame(); };
  const reset = async () => { await evaluate('window.__pdfHarness.reset()'); await frame(); };
  const spanExpr = (needle) => `[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span')].find(s=>s.textContent.includes(${JSON.stringify(needle)}))`;
  const scrollToChar = async (needle, ci) => {
    await evaluate(`(()=>{const s=${spanExpr(needle)};const t=s.firstChild;const r=document.createRange();r.setStart(t,${ci});r.setEnd(t,${ci}+1);const b=r.getBoundingClientRect();const c=document.querySelector('.pdf-document');const cr=c.getBoundingClientRect();c.scrollLeft+=b.left-cr.left-cr.width*0.3;c.scrollTop+=b.top-cr.top-cr.height*0.4;})()`);
    await frame(); await pause(200);
  };
  // Geometry of characters [start,end) of a run: the selection's own client rect (Range), the pdf.js run
  // box the span was given, and the ink under those characters read back from the bitmap.
  const measure = (needle, start, end) => evaluateJson(`(()=>{
    const s=${spanExpr(needle)}; const t=s.firstChild;
    const r=document.createRange(); r.setStart(t,${start}); r.setEnd(t,${end});
    const g=r.getBoundingClientRect();
    const layer=s.closest('.pdf-render-layer'); const l=layer.getBoundingClientRect();
    const runTopPct=parseFloat(s.style.top), runHeightPct=parseFloat(s.style.height);
    const run={topPx:l.top+runTopPct/100*l.height, heightPx:runHeightPct/100*l.height, bottomPx:l.top+(runTopPct+runHeightPct)/100*l.height, leftPct:parseFloat(s.style.left), topPct:runTopPct, heightPct:runHeightPct};
    const canvas=layer.querySelector('canvas'); const ctx=canvas.getContext('2d');
    const sx=(g.left-l.left)/l.width*canvas.width, ex=(g.right-l.left)/l.width*canvas.width;
    const y0=Math.max(0,Math.floor((run.topPx-l.top-run.heightPx*0.6)/l.height*canvas.height)), y1=Math.min(canvas.height,Math.ceil((run.bottomPx-l.top+run.heightPx*0.6)/l.height*canvas.height));
    const data=ctx.getImageData(Math.floor(sx),y0,Math.max(1,Math.ceil(ex-sx)),Math.max(1,y1-y0)).data; const w=Math.max(1,Math.ceil(ex-sx));
    const rows=[]; for(let y=0;y<y1-y0;y++){let n=0;for(let x=0;x<w;x++){const i=(y*w+x)*4; if(data[i]+data[i+1]+data[i+2] < 3*140) n++;} rows.push(n);}
    let inkTop=-1, inkBottom=-1; for(let y=0;y<rows.length;y++){ if(rows[y]>0){ if(inkTop<0) inkTop=y; inkBottom=y; } }
    const toClientY=(row)=> l.top + (y0+row)/canvas.height*l.height;
    const max=Math.max(...rows); let baseRow=-1; for(let y=rows.length-1;y>=0;y--){ if(rows[y]>=max*0.35){ baseRow=y; break; } }
    const emPx=run.heightPx; const baseClient = baseRow<0 ? run.bottomPx : toClientY(baseRow+1);
    const cx0=Math.max(0,Math.floor((g.left-l.left-emPx*1.5)/l.width*canvas.width)), cx1=Math.min(canvas.width,Math.ceil((g.right-l.left+emPx*1.5)/l.width*canvas.width));
    const ry0=Math.max(0,Math.floor((baseClient-emPx*0.6-l.top)/l.height*canvas.height)), ry1=Math.min(canvas.height,Math.ceil((baseClient-l.top)/l.height*canvas.height));
    const cw=Math.max(1,cx1-cx0), ch=Math.max(1,ry1-ry0); const cdata=ctx.getImageData(cx0,ry0,cw,ch).data;
    const cols=[]; for(let x=0;x<cw;x++){let n=0;for(let y=0;y<ch;y++){const i=(y*cw+x)*4; if(cdata[i]+cdata[i+1]+cdata[i+2] < 3*140) n++;} cols.push(n);}
    const gapPx=Math.max(2,Math.round(emPx*0.22/l.width*canvas.width));
    const clusters=[]; let c0=-1,last=-1; for(let x=0;x<cw;x++){ if(cols[x]>0){ if(c0<0) c0=x; else if(x-last>gapPx){ clusters.push([c0,last]); c0=x; } last=x; } } if(c0>=0) clusters.push([c0,last]);
    const toClientX=(col)=> l.left+(cx0+col)/canvas.width*l.width; const center=(g.left+g.right)/2;
    const words=clusters.map(([a,b])=>({left:toClientX(a),right:toClientX(b+1)})); const inkWord=words.find(w=>w.left<=center&&center<=w.right)||null;
    return { glyph:{left:g.left,right:g.right,top:g.top,bottom:g.bottom}, inkWord, run, layer:{left:l.left,top:l.top,width:l.width,height:l.height}, ink:{top: inkTop<0?null:toClientY(inkTop), bottom: inkTop<0?null:toClientY(inkBottom+1), baseline: baseRow<0?null:toClientY(baseRow+1)}, fontFamily:getComputedStyle(s).fontFamily, fontKerning:getComputedStyle(s).fontKerning, textFont:s.dataset.textFont||null, scale:s.style.getPropertyValue('--pdf-run-scale')||null, rootZoom:document.documentElement.style.zoom||'', dpr:window.devicePixelRatio };
  })()`);
  const paintRects = () => evaluateJson(`[...document.querySelectorAll('.pdf-highlight-paint rect:not([data-selection-preview])')].map(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const previewRects = () => evaluateJson(`[...document.querySelectorAll('.pdf-highlight-paint rect[data-selection-preview]')].map(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const markRects = selector => evaluateJson(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(m=>!m.classList.contains('draft')).map(m=>{const r=m.getBoundingClientRect();return {id:m.dataset.annotationId,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
  const popupRect = () => evaluateJson(`(()=>{const p=document.querySelector('.selection-popup'); if(!p) return null; const r=p.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,placement:p.dataset.placement||'',inPage:!!p.closest('.pdf-page')};})()`);
  const annotations = () => evaluate('JSON.parse(JSON.stringify(window.__pdfHarness.annotations()))');
  const fmt = r => (r ? `[${round(r.left)},${round(r.top)}→${round(r.right)},${round(r.bottom)}]` : 'none');

  const results = { scenarios: [], popups: [], multiLine: null, legacy: null };
  const WORD_START = 9, WORD_END = 15; // "curved": no descenders, so the ink bottom is the baseline
  const scenarios = [
    { zoom: 1, ui: 1, dpr: 1 },
    { zoom: 1.18, ui: 1, dpr: 1 },
    { zoom: 1.5, ui: 1, dpr: 1 },
    { zoom: 2, ui: 1, dpr: 1 },
    { zoom: 1, ui: 1.18, dpr: 1 },
    { zoom: 1.5, ui: 1.18, dpr: 1 },
    { zoom: 1.5, ui: 1, dpr: 1.5 },
    { zoom: 1.5, ui: 1.25, dpr: 1.25 },
  ];
  const positions = [];
  for (const sc of scenarios) {
    const label = `z${sc.zoom}-ui${sc.ui}-dpr${sc.dpr}`;
    await reset();
    await setViewport(viewport.width, viewport.height, sc.dpr);
    await setUiZoom(sc.ui);
    await setZoom(sc.zoom);
    const record = { ...sc, label, tools: {} };
    try {
      for (const [tool, needle] of [['highlight', 'Line 12:'], ['underline', 'Line 14:']]) {
        await setTool(tool);
        await scrollToChar(needle, WORD_START);
        const before = await measure(needle, WORD_START, WORD_END);
        const from = { x: before.glyph.left + 1, y: (before.glyph.top + before.glyph.bottom) / 2 };
        const to = { x: before.glyph.right - 1, y: from.y };
        await drag(from, to);
        const preview = await previewRects();
        await mouse('mouseReleased', to.x, to.y);
        await until(`window.__pdfHarness.annotations().length === ${tool === 'highlight' ? 1 : 2}`, 8000);
        await pause(250);
        const after = await measure(needle, WORD_START, WORD_END);
        const created = (await annotations()).at(-1);
        const band = tool === 'highlight' ? (await paintRects())[0] : (await markRects(`.annotation-mark.${tool}[data-annotation-id]`))[0];
        await screenshot(`${label}-${tool}`);
        const g = after.glyph, run = after.run, em = run.heightPx, baseline = run.bottomPx;
        record.tools[tool] = { quote: created?.quote, position: created?.positionJson, measure: after, preview, band };
        log(`${label} ${tool} quote=${JSON.stringify(created?.quote)} em=${round(em)} band=${fmt(band)} glyph=${fmt(g)} run=[${round(run.topPx)}→${round(baseline)}] ink=[${round(after.ink.top)}→${round(after.ink.bottom)} base=${round(after.ink.baseline)}] inkWord=[${round(after.inkWord?.left)}→${round(after.inkWord?.right)}] font=${after.textFont}/${after.fontKerning} scale=${after.scale}`);
        check(`${label} ${tool}: the selected word is what was annotated`, created?.quote === 'curved', created?.quote);
        check(`${label} ${tool}: a band/rule was painted`, !!band);
        if (!band) continue;
        check(`${label} ${tool}: band edges sit on the selection's own client rect (≤1.5 px)`, Math.abs(band.left - g.left) <= 1.5 && Math.abs(band.right - g.right) <= 1.5, { band: [band.left, band.right], glyph: [g.left, g.right] });
        if (tool === 'highlight') {
          check(`${label} highlight: band spans ascender → descender (baseline − 0.9 em … + 0.2 em, ±1 px)`, Math.abs(band.top - (baseline - 0.9 * em)) <= 1 && Math.abs(band.bottom - (baseline + 0.2 * em)) <= 1, { top: band.top - (baseline - 0.9 * em), bottom: band.bottom - (baseline + 0.2 * em) });
          check(`${label} highlight: live preview band equals the persisted band`, preview.length === 1 && Math.abs(preview[0].left - band.left) <= 0.5 && Math.abs(preview[0].right - band.right) <= 0.5 && Math.abs(preview[0].top - band.top) <= 0.5 && Math.abs(preview[0].bottom - band.bottom) <= 0.5, { preview, band });
        } else {
          check(`${label} underline: rule sits just under the baseline (0 … 0.15 em)`, band.top >= baseline - 0.5 && band.top <= baseline + 0.15 * em + 0.5, { ruleTop: band.top - baseline, em });
        }
        check(`${label} ${tool}: text-layer baseline agrees with the bitmap baseline (≤1.5 px)`, after.ink.baseline !== null && Math.abs(after.ink.baseline - baseline) <= 1.5, { ink: after.ink.baseline, baseline });
        check(`${label} ${tool}: run uses the serif substitute without kerning`, after.textFont === 'serif' && after.fontKerning === 'none' && /Times New Roman/i.test(after.fontFamily), { textFont: after.textFont, fontKerning: after.fontKerning, fontFamily: after.fontFamily });
        // Substitute-font drift: the selection's glyph box vs the painted word. Only judged when the
        // bitmap scan isolated one word (≥ 1.18 × so the inter-word gaps survive the threshold).
        const inkWord = after.inkWord;
        const isolated = inkWord && inkWord.right - inkWord.left <= (g.right - g.left) * 1.15 + 2;
        if (sc.zoom >= 1.18 && isolated) {
          const drift = Math.max(Math.abs(g.left - inkWord.left), Math.abs(g.right - inkWord.right));
          check(`${label} ${tool}: mid-run glyphs sit on the painted word (drift ≤ max(2 px, 0.12 em))`, drift <= Math.max(2, 0.12 * em), { drift: round(drift), em: round(em), glyph: [g.left, g.right], ink: [inkWord.left, inkWord.right] });
        }
        if (tool === 'highlight' && created?.positionJson) positions.push({ label, position: created.positionJson });
        await evaluate('window.getSelection().removeAllRanges()');
        await setTool('cursor');
      }
    } catch (error) {
      log(`ERROR ${label}: ${error.message.split('\n')[0]}`);
      check(`${label}: scenario completed`, false, error.message.slice(0, 200));
      try { await mouse('mouseReleased', 0, 0); await evaluate('window.getSelection().removeAllRanges()'); await setTool('cursor'); } catch { /* ignore */ }
    }
    results.scenarios.push(record);
  }
  // The stored PositionJson of the same word must not depend on zoom, root zoom or dpr.
  if (positions.length > 1) {
    const reference = positions[0].position.segments?.[0] ?? positions[0].position;
    for (const { label, position } of positions.slice(1)) {
      const segment = position.segments?.[0] ?? position;
      const drift = Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(Number(segment[key]) - Number(reference[key]))));
      check(`${label}: persisted percent geometry equals the 100 % one (≤ 0.05 % of the page)`, drift <= 0.05, { drift: round(drift), segment, reference });
    }
  }

  // ---------- SelectionPopup: cursor-tool selection, popup anchored to the line in page space ----------
  for (const sc of [{ zoom: 1, ui: 1, dpr: 1 }, { zoom: 1.18, ui: 1, dpr: 1 }, { zoom: 1, ui: 1.18, dpr: 1 }, { zoom: 1.5, ui: 1.25, dpr: 1.25 }, { zoom: 1.5, ui: 1, dpr: 1.5 }]) {
    const label = `popup-z${sc.zoom}-ui${sc.ui}-dpr${sc.dpr}`;
    await reset();
    await setViewport(viewport.width, viewport.height, sc.dpr);
    await setUiZoom(sc.ui);
    await setZoom(sc.zoom);
    await setTool('cursor');
    const record = { ...sc, label };
    try {
      await scrollToChar('Line 20:', WORD_START);
      const before = await measure('Line 20:', WORD_START, WORD_END);
      const from = { x: before.glyph.left + 1, y: (before.glyph.top + before.glyph.bottom) / 2 };
      const to = { x: before.glyph.right - 1, y: from.y };
      await drag(from, to);
      await mouse('mouseReleased', to.x, to.y);
      await until(`!!document.querySelector('.selection-popup')`, 5000);
      await pause(200);
      const popup = await popupRect();
      await screenshot(label);
      const lineTop = before.run.topPx;
      const gap = 10 * sc.ui; // 10 css px inside the zoomed root
      record.popup = popup; record.lineTop = lineTop; record.mouseup = to;
      log(`${label} popup=${fmt(popup)} placement=${popup?.placement} inPage=${popup?.inPage} lineTop=${round(lineTop)} mouseup=(${round(to.x)},${round(to.y)})`);
      check(`${label}: popup is rendered inside the page layer, above the line`, !!popup && popup.inPage && popup.placement === 'above', popup);
      if (popup) {
        check(`${label}: popup bottom hangs 10 px above the selected line (±2.5 px)`, Math.abs(popup.bottom - (lineTop - gap)) <= 2.5, { bottom: popup.bottom, expected: lineTop - gap });
        check(`${label}: popup is centred over the pointer (±3 px)`, Math.abs((popup.left + popup.right) / 2 - to.x) <= 3, { centre: (popup.left + popup.right) / 2, pointer: to.x });
        const btn = await evaluateJson(`(()=>{const b=document.querySelector('.selection-popup-btn[title="高亮"]'); const r=b.getBoundingClientRect(); return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2};})()`);
        await mouse('mouseMoved', btn.x, btn.y); await mouse('mousePressed', btn.x, btn.y); await mouse('mouseReleased', btn.x, btn.y);
        await until('window.__pdfHarness.annotations().length === 1', 8000);
        await pause(250);
        const after = await measure('Line 20:', WORD_START, WORD_END);
        const band = (await paintRects())[0];
        const created = (await annotations()).at(-1);
        record.band = band; record.quote = created?.quote;
        log(`${label} via popup: quote=${JSON.stringify(created?.quote)} band=${fmt(band)} glyph=${fmt(after.glyph)}`);
        check(`${label}: the popup action annotates the selection with the same geometry`, created?.quote === 'curved' && !!band && Math.abs(band.left - after.glyph.left) <= 1.5 && Math.abs(band.right - after.glyph.right) <= 1.5, { quote: created?.quote, band, glyph: after.glyph });
        check(`${label}: popup closes after the action`, !(await popupRect()));
      }
    } catch (error) {
      log(`ERROR ${label}: ${error.message.split('\n')[0]}`);
      check(`${label}: scenario completed`, false, error.message.slice(0, 200));
      try { await mouse('mouseReleased', 0, 0); await evaluate('window.getSelection().removeAllRanges()'); } catch { /* ignore */ }
    }
    results.popups.push(record);
  }

  // ---------- two lines of the 9 pt / 10 pt block: one band per line, staying on its line after zoom ----------
  {
    const label = 'small-two-lines';
    await reset();
    await setViewport(viewport.width, viewport.height, 1);
    await setUiZoom(1);
    await setZoom(1.18);
    await setTool('highlight');
    const record = { label };
    try {
      const secondLength = SMALL_LINE(2).length, thirdLength = SMALL_LINE(3).length;
      await scrollToChar('Small 02:', 0);
      const start = await measure('Small 02:', 0, 1);
      const end = await measure('Small 03:', thirdLength - 1, thirdLength);
      const pitchPct = end.run.topPct - start.run.topPct;
      check(`${label}: fixture line pitch is below the old fixed 1.2 % tolerance`, pitchPct > 0 && pitchPct < 1.2, { pitchPct, heightPct: start.run.heightPct });
      await drag({ x: start.glyph.left + 1, y: (start.glyph.top + start.glyph.bottom) / 2 }, { x: end.glyph.right - 1, y: (end.glyph.top + end.glyph.bottom) / 2 }, 16);
      const preview = await previewRects();
      await mouse('mouseReleased', end.glyph.right - 1, (end.glyph.top + end.glyph.bottom) / 2);
      await until('window.__pdfHarness.annotations().length === 1', 8000);
      await pause(250);
      const created = (await annotations()).at(-1);
      const segments = created?.positionJson?.segments ?? [];
      const bands = await paintRects();
      await screenshot(label);
      const lines = [await measure('Small 02:', 0, secondLength), await measure('Small 03:', 0, thirdLength)];
      record.segments = segments; record.bands = bands; record.preview = preview; record.lines = lines.map(l => l.run);
      log(`${label} segments=${segments.length} bands=${bands.map(fmt).join(' ')} lines=${lines.map(l => `[${round(l.run.topPx)}→${round(l.run.bottomPx)}]`).join(' ')} quote=${JSON.stringify(created?.quote?.slice(0, 40))}`);
      check(`${label}: two consecutive small lines persist as two segments (old code merged them)`, segments.length === 2, segments);
      check(`${label}: two bands are painted, one per line`, bands.length === 2 && preview.length === 2, { bands: bands.length, preview: preview.length });
      const sorted = [...bands].sort((a, b) => a.top - b.top);
      sorted.forEach((band, index) => {
        const line = lines[index];
        if (!line) return;
        const em = line.run.heightPx, baseline = line.run.bottomPx;
        check(`${label}: band ${index + 1} top is its own line's ascender edge (±1 px)`, Math.abs(band.top - (baseline - 0.9 * em)) <= 1, { top: band.top, expected: baseline - 0.9 * em });
        const glyph = index === 0 ? lines[0].glyph : lines[1].glyph;
        check(`${label}: band ${index + 1} starts on the line's first glyph (≤1.5 px)`, Math.abs(band.left - glyph.left) <= 1.5, { left: band.left, glyph: glyph.left });
      });
      if (sorted[1]) check(`${label}: last band bottom is the last line's descender edge (±1 px)`, Math.abs(sorted[1].bottom - (lines[1].run.bottomPx + 0.2 * lines[1].run.heightPx)) <= 1, { bottom: sorted[1].bottom, expected: lines[1].run.bottomPx + 0.2 * lines[1].run.heightPx });
      // Zoom change: the persisted percent geometry must land on the same lines.
      await evaluate('window.getSelection().removeAllRanges()');
      await setTool('cursor');
      await setZoom(2);
      await scrollToChar('Small 02:', 0);
      const zoomedLines = [await measure('Small 02:', 0, secondLength), await measure('Small 03:', 0, thirdLength)];
      const zoomedBands = [...await paintRects()].sort((a, b) => a.top - b.top);
      await screenshot(`${label}-zoom2`);
      record.zoomedBands = zoomedBands;
      log(`${label} @200% bands=${zoomedBands.map(fmt).join(' ')} lines=${zoomedLines.map(l => `[${round(l.run.topPx)}→${round(l.run.bottomPx)}]`).join(' ')}`);
      check(`${label}: after zooming to 200 % both bands still start on their lines' ascender edges (±1 px)`, zoomedBands.length === 2 && zoomedBands.every((band, index) => Math.abs(band.top - (zoomedLines[index].run.bottomPx - 0.9 * zoomedLines[index].run.heightPx)) <= 1 && Math.abs(band.left - zoomedLines[index].glyph.left) <= 1.5), { zoomedBands, lines: zoomedLines.map(l => l.run) });
    } catch (error) {
      log(`ERROR ${label}: ${error.message.split('\n')[0]}`);
      check(`${label}: scenario completed`, false, error.message.slice(0, 200));
      try { await mouse('mouseReleased', 0, 0); await evaluate('window.getSelection().removeAllRanges()'); await setTool('cursor'); } catch { /* ignore */ }
    }
    results.multiLine = record;
  }

  // ---------- compatibility: an old single-rect highlight (no segments) still paints on its run ----------
  {
    const label = 'legacy-single-rect';
    try {
      await reset();
      await setZoom(1.5);
      await scrollToChar('Line 16:', 0);
      const line = await measure('Line 16:', 0, BODY_LINE(16).length);
      const legacy = { id: 'legacy-1', paperId: 'harness', fileId: 'file-1', createdAt: new Date().toISOString(), type: 'highlight', color: 'yellow', page: 1, quote: BODY_LINE(16), comment: '',
        positionJson: { x: line.run.leftPct, y: line.run.topPct, width: (line.glyph.right - line.glyph.left) / line.layer.width * 100, height: line.run.heightPct } };
      await evaluate(`window.__pdfHarness.replaceAnnotations(${JSON.stringify([legacy])})`);
      await until('document.querySelectorAll(".pdf-highlight-paint rect:not([data-selection-preview])").length === 1', 5000);
      await pause(200);
      const band = (await paintRects())[0];
      await screenshot(label);
      const em = line.run.heightPx, baseline = line.run.bottomPx;
      results.legacy = { band, line: line.run };
      log(`${label} band=${fmt(band)} glyph=${fmt(line.glyph)} run=[${round(line.run.topPx)}→${round(baseline)}]`);
      check(`${label}: an old single-rect highlight paints as the same ascender → descender band on its run`, !!band && Math.abs(band.left - line.glyph.left) <= 1.5 && Math.abs(band.right - line.glyph.right) <= 1.5 && Math.abs(band.top - (baseline - 0.9 * em)) <= 1 && Math.abs(band.bottom - (baseline + 0.2 * em)) <= 1, { band, glyph: line.glyph, run: line.run });
    } catch (error) {
      log(`ERROR ${label}: ${error.message.split('\n')[0]}`);
      check(`${label}: scenario completed`, false, error.message.slice(0, 200));
    }
  }
  await setUiZoom(1);
  check('no page errors or console errors during the walk-through', pageErrors.length === 0, pageErrors.slice(0, 5));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors }, null, 2));
  console.log(`verify-pdf-annotation-geometry-browser (${tag}): ${checks.filter(c => c.passed).length}/${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
}

if (!browserExecutable() && process.env.GEOMETRY_REQUIRE_BROWSER !== '1') {
  // No browser on this machine: the pure checks in verify-pdf-annotation-geometry.mjs still guard the pipeline.
  console.log('verify-pdf-annotation-geometry-browser: skipped (no Chrome/Edge found; set TASKBOARD_TEST_BROWSER or GEOMETRY_REQUIRE_BROWSER=1)');
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
