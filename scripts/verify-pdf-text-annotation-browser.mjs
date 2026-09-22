// Task 540986ab — browser walk-through of PDF text annotations.
// Builds the real PdfReader (production Vite build) into a harness page with a synthetic PDF,
// drives it through headless Chrome/Edge over CDP and captures screenshots at 100/200/335 %.
//   MODAL_PHASE=before  → only records the baseline (settings popover) without asserting.
//   MODAL_PHASE=after   → asserts the in-place editing behaviour (default).
// Evidence: .tmp/pdf-text-annotation/<phase>/*.png + result.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const phase = process.env.MODAL_PHASE === 'before' ? 'before' : 'after';
const evidence = path.join(root, '.tmp/pdf-text-annotation', phase);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-text-annotation-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const ok = (condition, name, detail) => {
  checks.push({ name, passed: !!condition, detail });
  if (phase === 'after') assert.ok(condition, name + (detail ? ' ' + JSON.stringify(detail) : ''));
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
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
  throw Error('Condition timed out: ' + expression + ' errors=' + JSON.stringify(pageErrors.slice(0, 3)));
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot = async name => {
  fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const mouse = async (type, x, y, extra = {}) => rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const clickAt = async (x, y, clickCount = 1) => {
  await mouse('mouseMoved', x, y, { button: 'none' });
  for (let n = 1; n <= clickCount; n++) {
    await mouse('mousePressed', x, y, { clickCount: n });
    await mouse('mouseReleased', x, y, { clickCount: n });
  }
  await frame();
};
const key = async (keyName, opts = {}) => {
  const codes = { Escape: 27, Enter: 13, Delete: 46, Backspace: 8, Space: 32, a: 65 };
  const base = { key: keyName === 'Space' ? ' ' : keyName, code: keyName === 'a' ? 'KeyA' : keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName], ...opts };
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(keyName === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : keyName === 'Space' ? { text: ' ', unmodifiedText: ' ' } : {}) });
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await frame();
};
const insertText = async text => { await rpc('Input.insertText', { text }); await frame(); };

// --- synthetic two-page PDF (Helvetica body text) so no real library file is touched -------------
function syntheticPdf() {
  const lines = (page) => Array.from({ length: 34 }, (_, i) => `Page ${page} line ${i + 1}: The quick brown fox jumps over the lazy dog while reading annotated papers at any zoom level.`);
  const content = (page) => {
    const ops = ['BT', '/F1 11 Tf', '13.5 TL', '54 740 Td', `(Synthetic test document - page ${page}) Tj`, 'T*', 'T*'];
    for (const line of lines(page)) ops.push(`(${line.replace(/[()\\]/g, '\\$&')}) Tj`, 'T*');
    ops.push('ET');
    return ops.join('\n');
  };
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + 1 + 2 * 2; // placeholder computed below
  const pageIds = [];
  const contentIds = [];
  for (const page of [1, 2]) {
    const stream = content(page);
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`));
  }
  const pagesObj = objects.length + 3;
  for (const page of [1, 2]) {
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[page - 1]} 0 R >>`));
  }
  const pages = add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  assert.equal(pages, pagesObj, 'pages object id');
  void pagesId;
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function main() {
  fs.writeFileSync(path.join(scratch, 'fixture.pdf'), syntheticPdf());

  // The entry must live under the project root so Vite resolves react/react-dom from this worktree.
  const harness = path.join(evidence, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  const entry = path.join(harness, 'entry.tsx');
  fs.writeFileSync(entry, `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PdfReader from '/src/features/reader/pdf/PdfReader';
import { defaultReaderToolSettings } from '/src/features/reader/pdf/types';
import '/src/ui/styles.css';
const legacyAnnotation = {
  id: 'legacy-1', paperId: 'harness', fileId: 'file-1', page: 1, type: 'text', quote: '文字', color: 'green',
  comment: '旧标注 legacy 13px',
  positionJson: { x: 10, y: 60, width: 22, height: 7, fontSize: 13, bold: false, italic: false, textColor: '#202822', borderColor: '#ffffff', backgroundColor: 'transparent' },
  createdAt: '2026-09-01T00:00:00.000Z',
};
const source = { key: 'harness:file-1', title: 'Synthetic', fileId: 'file-1', request: { source: 'paperFile', paperId: 'harness', kind: 'source', fileId: 'file-1' } };
let counter = 0;
function Harness() {
  const [annotations, setAnnotations] = useState<any[]>([legacyAnnotation]);
  const [tool, setTool] = useState<any>('cursor');
  const [zoom, setZoom] = useState(1);
  const [focused, setFocused] = useState<string | null>(null);
  const [toolSettings, setToolSettings] = useState(defaultReaderToolSettings);
  const log = useRef<any[]>([]);
  const latest = useRef(annotations); latest.current = annotations;
  (window as any).__pdfHarness = {
    setTool, setZoom, setToolSettings, log: log.current,
    annotations: () => latest.current,
    reset: () => setAnnotations([legacyAnnotation]),
    replaceAnnotations: (next: any[]) => setAnnotations(next),
  };
  const update = (id: string, patch: (a: any) => any) => setAnnotations(list => list.map(a => a.id === id ? patch(a) : a));
  return <div className="reader-scene-shell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
    <div className="reader-document-pane" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <PdfReader
        source={source as any}
        annotations={annotations}
        activeTool={tool}
        activeAnnotationColor={'green' as any}
        toolSettings={toolSettings}
        onCompleteOneShotTool={() => setTool('cursor')}
        zoom={zoom}
        onZoomChange={(z) => setZoom(z)}
        onCreateAnnotation={async (draft) => { const id = 'new-' + (++counter); log.current.push(['create', id, draft]); setAnnotations(list => [...list, { id, paperId: 'harness', fileId: 'file-1', createdAt: new Date().toISOString(), ...draft }]); return id; }}
        onUpdateAnnotationComment={async (id, comment) => { log.current.push(['comment', id, comment]); update(id, a => ({ ...a, comment })); }}
        onUpdateAnnotationPosition={async (id, positionJson) => { log.current.push(['position', id, positionJson]); update(id, a => ({ ...a, positionJson })); }}
        onUpdateAnnotationColor={async (id, color) => { update(id, a => ({ ...a, color })); }}
        onDeleteAnnotation={async (id) => { log.current.push(['delete', id]); setAnnotations(list => list.filter(a => a.id !== id)); }}
        onAppendAnnotationToNote={() => {}}
        onFocusAnnotation={(id) => setFocused(id)}
        focusedAnnotationId={focused}
      />
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

  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>pdf-text-annotation harness</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
  web = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    const file = path.join(scratch, url);
    if (!file.startsWith(scratch) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const body = fs.readFileSync(file);
    const headers = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (/gzip/.test(req.headers['accept-encoding'] ?? '') && body.length > 4096) { headers['content-encoding'] = 'gzip'; res.writeHead(200, headers); res.end(zlib.gzipSync(body)); return; }
    res.writeHead(200, headers); res.end(body);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + web.address().port;

  const exe = process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  assert.ok(exe, 'Chrome or Edge required');
  const profile = path.join(scratch, 'profile');
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--lang=zh-CN', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  // Tauri shim: the reader only loads bytes inside the desktop runtime; serve the synthetic PDF through the same command.
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id; }, invoke: async (cmd, args) => { if (cmd === 'load_paper_file_bytes') { const buf = await (await fetch('/fixture.pdf')).arrayBuffer(); return Array.from(new Uint8Array(buf)); } (window.__invokes ||= []).push(cmd); return null; } };` });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: origin + '/' });
  await until(`!!window.__pdfHarness && document.querySelectorAll('.pdf-page').length >= 2 && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready') && document.querySelector('.pdf-page[data-page="1"] .annotation-overlay') !== null`, 30000);
  await until(`document.querySelector('.pdf-page[data-page="1"] canvas').width > 0`);
  await pause(400);

  const layerRect = () => evaluate(`(()=>{const r=document.querySelector('.pdf-page[data-page="1"] .pdf-render-layer').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  const scroller = () => evaluate(`(()=>{const c=document.querySelector('.pdf-document');return {left:c.scrollLeft,top:c.scrollTop,w:c.clientWidth,h:c.clientHeight}})()`);
  const setZoom = async z => {
    await evaluate(`window.__pdfHarness.setZoom(${z})`);
    await until(`Math.abs(document.querySelector('.pdf-page[data-page="1"] .pdf-render-layer').getBoundingClientRect().width - 612*${z}) < 2` + (phase === 'after' ? ` && getComputedStyle(document.querySelector('.pdf-page[data-page="1"] .pdf-render-layer')).getPropertyValue('--pdf-display-zoom').trim() === String(${z})` : ''));
    await until(`!document.querySelector('.pdf-page[data-page="1"].updating')`, 20000);
    await pause(250);
  };
  // Bring a page point (percent) to a comfortable viewport position and return its client coordinates.
  const pointOnPage = async (xPercent, yPercent) => {
    await evaluate(`(()=>{const c=document.querySelector('.pdf-document');const l=document.querySelector('.pdf-page[data-page="1"] .pdf-render-layer');const lr=l.getBoundingClientRect();const cr=c.getBoundingClientRect();
      const px=lr.left-cr.left+c.scrollLeft+lr.width*${xPercent}/100, py=lr.top-cr.top+c.scrollTop+lr.height*${yPercent}/100;
      c.scrollLeft=Math.max(0,px-cr.width*0.35); c.scrollTop=Math.max(0,py-cr.height*0.4);})()`);
    await frame(); await pause(120);
    const l = await layerRect();
    return { x: l.left + l.width * xPercent / 100, y: l.top + l.height * yPercent / 100, layer: l };
  };
  const editorState = () => evaluate(`(()=>{const e=document.querySelector('.annotation-text-editor');if(!e)return null;const m=e.closest('.annotation-mark');const l=m.closest('.pdf-render-layer').getBoundingClientRect();const r=m.getBoundingClientRect();const cs=getComputedStyle(e);
    return {focused:document.activeElement===e,text:e.innerText,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom,layer:{left:l.left,top:l.top,width:l.width,height:l.height},fontPx:parseFloat(cs.fontSize),lineHeight:parseFloat(cs.lineHeight),popover:!!document.querySelector('.comment-popover'),draft:m.classList.contains('draft'),xPct:(r.left-l.left)/l.width*100,yPct:(r.top-l.top)/l.height*100,wPct:r.width/l.width*100,hPct:r.height/l.height*100,scrollH:e.scrollHeight,clientH:e.clientHeight,editing:m.classList.contains('editing')}})()`);
  const markState = id => evaluate(`(()=>{const m=document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(id)}]');if(!m)return null;const l=m.closest('.pdf-render-layer').getBoundingClientRect();const r=m.getBoundingClientRect();const c=m.querySelector('.sticky-note-content');const cs=c?getComputedStyle(c):null;
    return {text:c?c.innerText:null,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom,xPct:(r.left-l.left)/l.width*100,yPct:(r.top-l.top)/l.height*100,wPct:r.width/l.width*100,hPct:r.height/l.height*100,fontPx:cs?parseFloat(cs.fontSize):null,clipped:c?(c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1):null,layoutMode:m.dataset.textLayout,focused:m.classList.contains('focused'),layer:{width:l.width,height:l.height}}})()`);
  const annotations = () => evaluate(`JSON.parse(JSON.stringify(window.__pdfHarness.annotations()))`);
  const logEntries = () => evaluate(`JSON.parse(JSON.stringify(window.__pdfHarness.log))`);
  const noPopover = async () => !(await evaluate(`!!document.querySelector('.comment-popover')`));

  const results = { phase, zooms: {}, cases: {} };

  if (phase === 'before') {
    // Baseline: text tool click opens the settings popover; save the default text to see the default box.
    const anchors = { 1: [30, 12], 2: [30, 42], 3.35: [30, 72] };
    for (const zoom of [1, 2, 3.35]) {
      await setZoom(zoom);
      await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
      const p = await pointOnPage(...anchors[zoom]);
      await clickAt(p.x, p.y);
      await pause(300);
      const popover = await evaluate(`(()=>{const e=document.querySelector('.comment-popover');if(!e)return null;const r=e.getBoundingClientRect();return {width:r.width,height:r.height}})()`);
      results.zooms[zoom] = { popover };
      await screenshot(`before-text-tool-click-${zoom}`);
      ok(popover, `before: popover shown at zoom ${zoom}`, popover);
      await evaluate(`(()=>{const t=document.querySelector('.comment-popover textarea');const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'标注');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await frame();
      await evaluate(`[...document.querySelectorAll('.comment-popover button')].find(b=>b.classList.contains('primary'))?.click()`);
      await until(`!document.querySelector('.comment-popover')`);
      await pause(300);
      const created = (await annotations()).filter(a => a.id.startsWith('new-')).pop();
      const mark = created ? await markState(created.id) : null;
      results.zooms[zoom].created = { positionJson: created?.positionJson, mark };
      await screenshot(`before-created-${zoom}`);
    }
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors }, null, 2));
    console.log('before phase recorded', JSON.stringify(results));
    return;
  }

  // ---------------------------------------------------------------- after phase --------------------------------
  if (!process.env.OVERLAP_ONLY) {
  const legacyBase = await markState('legacy-1');
  ok(legacyBase && near(legacyBase.fontPx, 13, 0.1) && near(legacyBase.xPct, 10, 0.2) && near(legacyBase.wPct, 22, 0.3) && legacyBase.layoutMode === 'fixed', 'legacy annotation renders unchanged (13px, 22% wide, fixed layout)', legacyBase);

  const anchors = { 1: [30, 12], 2: [30, 42], 3.35: [30, 72] };
  for (const zoom of [1, 2, 3.35]) {
    await setZoom(zoom);
    await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
    const [ax, ay] = anchors[zoom];
    const p = await pointOnPage(ax, ay);
    const hit = await evaluate(`(()=>{const e=document.elementFromPoint(${p.x},${p.y});return e?e.tagName+'.'+e.className:null})()`);
    await clickAt(p.x, p.y);
    try { await until(`!!document.querySelector('.annotation-text-editor')`, 5000); }
    catch (error) { throw Error(`no editor after text-tool click at zoom ${zoom}; hit=${hit} docClass=${await evaluate(`document.querySelector('.pdf-document').className`)} ${error.message}`); }
    await pause(150);
    const fresh = await editorState();
    ok(fresh && !fresh.popover, `zoom ${zoom}: clicking with the text tool opens no settings popover`, fresh);
    ok(fresh.focused, `zoom ${zoom}: the page box itself has keyboard focus`);
    ok(near(fresh.fontPx, 24 * zoom, 0.6), `zoom ${zoom}: default font is 24 page px (${(24 * zoom).toFixed(1)} css px)`, { fontPx: fresh.fontPx });
    const oneLine = fresh.fontPx * 1.3 + 6 * zoom;
    ok(near(fresh.height, oneLine, 2 + zoom), `zoom ${zoom}: the empty box is one line high`, { height: fresh.height, oneLine });
    const minWidth = 24 * zoom * 9;
    ok(fresh.width <= minWidth + 3 && fresh.wPct < 40, `zoom ${zoom}: the empty box is short (min width ${minWidth.toFixed(0)}px)`, { width: fresh.width, wPct: fresh.wPct });
    ok(near(fresh.xPct, ax, 0.3) && near(fresh.yPct, ay, 0.3), `zoom ${zoom}: the box sits where the user clicked`, { xPct: fresh.xPct, yPct: fresh.yPct });
    const tool = await evaluate(`document.querySelector('.pdf-document').className`);
    ok(/cursor-mode/.test(tool), `zoom ${zoom}: the one-shot text tool returns to the cursor while editing`, tool);
    await screenshot(`after-empty-box-${zoom}`);

    await insertText('标注');
    const short = await editorState();
    ok(short.text === '标注' && short.height <= fresh.height + 1, `zoom ${zoom}: typing keeps a single line`, { text: short.text, height: short.height });
    await insertText('：这是一段较长的说明文字，用于验证文本框先横向扩展，达到上限后自动换行并增高。');
    const long = await editorState();
    const maxWidthPx = long.layer.width * 0.6;
    ok(long.width > short.width && long.width <= maxWidthPx + 2, `zoom ${zoom}: the box widens with the text and stops at the 60% cap`, { width: long.width, maxWidthPx });
    ok(long.height > fresh.height * 1.6, `zoom ${zoom}: overflowing text wraps and raises the box`, { height: long.height, oneLine: fresh.height });
    ok(long.right <= long.layer.left + long.layer.width * 0.985 + 1, `zoom ${zoom}: the box never crosses the right page margin`);
    await key('Enter');
    await insertText('第二段');
    const multi = await editorState();
    ok(multi.text.includes('\n第二段') && multi.height >= long.height + fresh.fontPx * 1.1, `zoom ${zoom}: Enter inserts a line break and grows the box by a line`, { height: multi.height, previous: long.height });
    ok(multi.scrollH <= multi.clientH + 1, `zoom ${zoom}: nothing is clipped while typing`);
    await screenshot(`after-typing-${zoom}`);

    const before = (await annotations()).length;
    await key('Escape');
    await until(`!document.querySelector('.annotation-text-editor')`);
    await pause(250);
    const list = await annotations();
    const created = list[list.length - 1];
    ok(list.length === before + 1 && created.type === 'text' && created.comment === multi.text.replace(/\n+$/, ''), `zoom ${zoom}: Escape finishes editing and persists the text once`, { count: list.length, comment: created?.comment });
    ok(created.positionJson.fontUnit === 'page' && created.positionJson.autoWidth === true && created.positionJson.fontSize === 24, `zoom ${zoom}: new annotations store page-unit font and auto width`, created.positionJson);
    ok(near(created.positionJson.width, multi.wPct, 0.3) && near(created.positionJson.height, multi.hPct, 0.3) && near(created.positionJson.x, multi.xPct, 0.2) && near(created.positionJson.y, multi.yPct, 0.2), `zoom ${zoom}: the saved geometry equals the measured editor box`, { saved: created.positionJson, measured: { x: multi.xPct, y: multi.yPct, w: multi.wPct, h: multi.hPct } });
    const mark = await markState(created.id);
    ok(mark && near(mark.wPct, multi.wPct, 0.15) && near(mark.hPct, multi.hPct, 0.15) && near(mark.xPct, multi.xPct, 0.1) && near(mark.yPct, multi.yPct, 0.1), `zoom ${zoom}: the rendered label keeps the exact editor geometry (no jump)`, { mark, editor: { x: multi.xPct, y: multi.yPct, w: multi.wPct, h: multi.hPct } });
    ok(mark.clipped === false && mark.layoutMode === 'auto', `zoom ${zoom}: the saved label is not clipped`, mark);
    ok(await noPopover(), `zoom ${zoom}: no popover after saving`);
    await screenshot(`after-created-${zoom}`);
    results.zooms[zoom] = { fresh, long, multi, created: created.positionJson, mark };
  }

  // Cross-zoom consistency of one annotation created at 100 %.
  const createdAt1 = (await annotations()).find(a => a.id === 'new-1');
  const at1 = { ...(await setZoom(1), await markState('new-1')) };
  const at335 = { ...(await setZoom(3.35), await markState('new-1')) };
  ok(near(at1.xPct, at335.xPct, 0.2) && near(at1.yPct, at335.yPct, 0.2) && near(at1.wPct, at335.wPct, 0.6) && near(at1.hPct, at335.hPct, 0.6), 'the same annotation keeps its percent geometry at 100% and 335%', { at1, at335 });
  ok(near(at335.fontPx, at1.fontPx * 3.35, 0.6) && at335.clipped === false, 'font scales with zoom and text is not clipped at 335%', { at1: at1.fontPx, at335: at335.fontPx });
  results.cases.crossZoom = { at1, at335, positionJson: createdAt1.positionJson };
  await pointOnPage(30, 20);
  await screenshot('after-same-annotation-335');
  // A plain click on a selected box or its handle must not rewrite the annotation (no silent width freeze).
  await setZoom(1);
  const clickTarget = (await annotations()).find(a => a.id === 'new-1');
  const cp = await pointOnPage(clickTarget.positionJson.x + 1, clickTarget.positionJson.y + 0.8);
  const logBefore = (await logEntries()).length;
  await clickAt(cp.x, cp.y);
  await until(`!!document.querySelector('.annotation-mark[data-annotation-id="new-1"].focused .annotation-resize-handle.nw')`);
  const hp = await evaluate(`(()=>{const r=document.querySelector('.annotation-mark[data-annotation-id="new-1"] .annotation-resize-handle.nw').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await clickAt(hp.x, hp.y);
  await pause(200);
  const clickedOnly = (await annotations()).find(a => a.id === 'new-1');
  ok((await logEntries()).length === logBefore && clickedOnly.positionJson.autoWidth === true, 'clicking a box or a resize handle without dragging writes nothing and keeps auto width', { logDelta: (await logEntries()).length - logBefore, autoWidth: clickedOnly.positionJson.autoWidth });

  // Legacy annotation: unchanged at 200 %, editable in place, keeps its fixed width and pixel font.
  await setZoom(2);
  const legacy2 = await markState('legacy-1');
  ok(near(legacy2.fontPx, 13, 0.1) && near(legacy2.wPct, 22, 0.3) && near(legacy2.xPct, 10, 0.2) && near(legacy2.yPct, 60, 0.2), 'legacy annotation is untouched by the new defaults at 200%', legacy2);
  const lp = await pointOnPage(12, 61.5);
  await clickAt(lp.x, lp.y, 2);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await pause(150);
  const legacyEdit = await editorState();
  ok(legacyEdit && !legacyEdit.popover && legacyEdit.focused, 'double-click edits a legacy annotation in place without a popover');
  ok(near(legacyEdit.fontPx, 13, 0.1) && near(legacyEdit.wPct, legacy2.wPct, 0.05) && near(legacyEdit.hPct, legacy2.hPct, 0.05) && near(legacyEdit.xPct, legacy2.xPct, 0.05) && near(legacyEdit.yPct, legacy2.yPct, 0.05) && legacyEdit.text === '旧标注 legacy 13px', 'the legacy editor keeps the exact box, font and text', { legacyEdit, legacy2 });
  await screenshot('after-legacy-editing-200');
  await evaluate(`(()=>{const e=document.querySelector('.annotation-text-editor');const s=window.getSelection();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);s.removeAllRanges();s.addRange(r);})()`);
  await insertText('，已就地修改');
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  const legacyAfter = (await annotations()).find(a => a.id === 'legacy-1');
  const legacyMark = await markState('legacy-1');
  ok(legacyAfter.comment === '旧标注 legacy 13px，已就地修改' && legacyAfter.positionJson.fontUnit === undefined && legacyAfter.positionJson.width === 22 && legacyAfter.positionJson.height === 7 && legacyAfter.positionJson.fontSize === 13, 'legacy edit persists the text without changing width, font or unit', legacyAfter.positionJson);
  ok(!(await logEntries()).some(([kind, id]) => kind === 'position' && id === 'legacy-1'), 'editing a legacy annotation whose text still fits writes no position update', (await logEntries()).filter(([kind, id]) => id === 'legacy-1'));
  ok(legacyMark.clipped === false, 'legacy label is not clipped after editing');
  results.cases.legacy = { legacy2, legacyEdit, after: legacyAfter.positionJson };

  // Empty box is discarded; emptied annotation is deleted.
  await setZoom(1);
  await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
  const ep = await pointOnPage(5, 90);
  const countBefore = (await annotations()).length;
  await clickAt(ep.x, ep.y);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  ok((await annotations()).length === countBefore, 'an empty new box is discarded on Escape');
  const emptyTarget = (await annotations()).find(a => a.id === 'new-1');
  const tp = await pointOnPage(emptyTarget.positionJson.x + 1, emptyTarget.positionJson.y + 1);
  await clickAt(tp.x, tp.y, 2);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await evaluate(`document.execCommand('selectAll')`);
  await key('Delete');
  const emptied = await editorState();
  ok(emptied.text.trim() === '' && emptied.height <= 24 * 1.3 + 6 + 3, 'deleting all text shrinks the box back to one line', { height: emptied.height });
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  ok(!(await annotations()).some(a => a.id === 'new-1'), 'an annotation emptied by the user is removed on commit');

  // Blur (clicking elsewhere) commits; keyboard stays inside the editor (Space never starts a pan).
  await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
  const bp = await pointOnPage(10, 20);
  await clickAt(bp.x, bp.y);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await insertText('点击外部');
  await key('Space');
  const panReady = await evaluate(`document.querySelector('.pdf-document').classList.contains('pan-ready')`);
  ok(!panReady, 'Space typed in the editor does not arm the hand/pan gesture');
  await insertText('提交');
  const away = await pointOnPage(5, 50);
  await clickAt(away.x, away.y);
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  const blurred = (await annotations()).pop();
  ok(blurred.comment === '点击外部 提交', 'clicking outside commits the text (space preserved)', blurred.comment);

  // Right/bottom edge handling.
  await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
  const edge = await pointOnPage(97, 98.5);
  await clickAt(edge.x, edge.y);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  const edgeEmpty = await editorState();
  ok(edgeEmpty.xPct < 97 && edgeEmpty.right <= edgeEmpty.layer.left + edgeEmpty.layer.width * 0.985 + 1, 'a click at the right edge places the box inside the page', { xPct: edgeEmpty.xPct });
  await insertText('页面右下角创建的文字标注，需要自动换行并保持在页面之内。');
  const edgeTyped = await editorState();
  ok(edgeTyped.right <= edgeTyped.layer.left + edgeTyped.layer.width * 0.985 + 1 && edgeTyped.height > edgeEmpty.height, 'text at the edge wraps inside the page instead of overflowing', { right: edgeTyped.right, pageRight: edgeTyped.layer.left + edgeTyped.layer.width });
  ok(edgeTyped.bottom <= edgeTyped.layer.top + edgeTyped.layer.height * 0.985 + 1 && edgeTyped.yPct < edgeEmpty.yPct, 'while typing, a box that reaches the bottom margin moves up instead of hanging off the page', { bottom: edgeTyped.bottom, pageBottom: edgeTyped.layer.top + edgeTyped.layer.height, yPct: edgeTyped.yPct });
  await screenshot('after-edge-typing');
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  const edgeSaved = (await annotations()).pop();
  const edgeMark = await markState(edgeSaved.id);
  ok(edgeSaved.positionJson.y + edgeSaved.positionJson.height <= 98.5 + 0.01 && edgeMark.bottom <= edgeMark.top + edgeMark.height + 0.5 && edgeSaved.positionJson.y < 98.5, 'a box created at the bottom is shifted up so it stays on the page', edgeSaved.positionJson);
  ok(edgeMark.clipped === false && near(edgeMark.hPct, edgeSaved.positionJson.height, 0.4), 'the edge box renders unclipped at its saved size', edgeMark);
  await pointOnPage(97, 98.5);
  await screenshot('after-edge-saved');
  results.cases.edge = { edgeEmpty, edgeTyped, saved: edgeSaved.positionJson, mark: edgeMark };

  // Manual resize turns the box into a fixed width; later edits keep that width and only grow in height.
  const rz = (await annotations()).find(a => a.id === blurred.id);
  const rp = await pointOnPage(rz.positionJson.x + 1, rz.positionJson.y + 0.8);
  await clickAt(rp.x, rp.y);
  await until(`!!document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}].focused .annotation-resize-handle.e')`);
  const handle = await evaluate(`(()=>{const r=document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-resize-handle.e').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const widthBefore = (await markState(rz.id)).width;
  await mouse('mouseMoved', handle.x, handle.y, { button: 'none' });
  await mouse('mousePressed', handle.x, handle.y);
  await mouse('mouseMoved', handle.x + 70, handle.y, { buttons: 1 });
  await mouse('mouseMoved', handle.x + 140, handle.y, { buttons: 1 });
  await mouse('mouseReleased', handle.x + 140, handle.y);
  await frame(); await pause(250);
  const resized = (await annotations()).find(a => a.id === rz.id);
  const resizedMark = await markState(rz.id);
  ok(resized.positionJson.autoWidth === false && resizedMark.width > widthBefore + 100 && resizedMark.layoutMode === 'fixed', 'dragging the east handle fixes the width at the dragged size', { before: widthBefore, after: resizedMark.width, autoWidth: resized.positionJson.autoWidth });
  ok(resizedMark.clipped === false, 'the resized box keeps its text visible');
  const rp2 = await pointOnPage(resized.positionJson.x + 0.5, resized.positionJson.y + 0.5);
  await clickAt(rp2.x, rp2.y, 2);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await evaluate(`(()=>{const e=document.querySelector('.annotation-text-editor');const s=window.getSelection();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);s.removeAllRanges();s.addRange(r);})()`);
  await insertText('，继续补充更多文字内容以验证固定宽度下只增高不变宽。');
  const fixedTyped = await editorState();
  ok(near(fixedTyped.wPct, resizedMark.wPct, 0.15) && fixedTyped.hPct > resizedMark.hPct, 'after a manual resize typing keeps the width and grows the height', { width: fixedTyped.wPct, fixed: resizedMark.wPct, height: fixedTyped.hPct, before: resizedMark.hPct });
  await screenshot('after-fixed-width-typing');
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  await pause(200);
  const fixedSaved = (await annotations()).find(a => a.id === rz.id);
  ok(fixedSaved.positionJson.autoWidth === false && near(fixedSaved.positionJson.width, resized.positionJson.width, 0.05), 'the fixed width survives the edit', fixedSaved.positionJson);
  results.cases.resize = { before: widthBefore, resized: resized.positionJson, saved: fixedSaved.positionJson };

  // Selection actions expose bold and italic directly; colour edits the glyph ink.
  const sp = await pointOnPage(fixedSaved.positionJson.x + 0.5, fixedSaved.positionJson.y + 0.5);
  await clickAt(sp.x, sp.y);
  await until(`!!document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}].focused .annotation-text-style-button[aria-label="加粗"]')`);
  ok(!(await evaluate(`!!document.querySelector('.annotation-text-style-panel, .annotation-text-style-toggle')`)), 'selecting a text annotation has no Aa entry or secondary style panel');
  const styleBefore = (await annotations()).find(a => a.id === rz.id);
  await evaluate(`document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-text-style-button[aria-label="加粗"]').click()`);
  await until(`window.__pdfHarness.annotations().find(a => a.id === ${JSON.stringify(rz.id)}).positionJson.bold === true`);
  await evaluate(`document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-text-style-button[aria-label="倾斜"]').click()`);
  await until(`window.__pdfHarness.annotations().find(a => a.id === ${JSON.stringify(rz.id)}).positionJson.italic === true`);
  const pressed = await evaluate(`(()=>{const m=document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}]');return {bold:m.querySelector('[aria-label="加粗"]').getAttribute('aria-pressed'),italic:m.querySelector('[aria-label="倾斜"]').getAttribute('aria-pressed')}})()`);
  ok(pressed.bold === 'true' && pressed.italic === 'true', 'direct bold and italic buttons expose their persisted pressed state', pressed);
  await evaluate(`document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-color-pill').click()`);
  await until(`!!document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-color-palette-label')`);
  const paletteLabel = await evaluate(`document.querySelector('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-color-palette-label').textContent`);
  ok(paletteLabel === '文字颜色', 'text annotation colour palette is explicitly bound to glyph colour', paletteLabel);
  const chosenTextColor = await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.annotation-mark[data-annotation-id=${JSON.stringify(rz.id)}] .annotation-color-presets button')];const b=buttons.find(x=>!x.classList.contains('active'));const c=b?.getAttribute('aria-label');b?.click();return c})()`);
  await until(`window.__pdfHarness.annotations().find(a => a.id === ${JSON.stringify(rz.id)}).positionJson.textColor === ${JSON.stringify(chosenTextColor)}`);
  const restyled = (await annotations()).find(a => a.id === rz.id);
  const restyledMark = await markState(rz.id);
  ok(restyled.positionJson.bold === true && restyled.positionJson.italic === true && restyled.positionJson.fontSize === styleBefore.positionJson.fontSize, 'direct B/I changes preserve the internal font size', restyled.positionJson);
  ok(restyled.positionJson.textColor === chosenTextColor && restyled.color === styleBefore.color, 'quick colour changes textColor without mutating the generic annotation colour', { textColor: restyled.positionJson.textColor, annotationColor: restyled.color });
  await screenshot('after-direct-bold-italic-text-color');
  results.cases.style = { before: styleBefore.positionJson, restyled: restyled.positionJson, mark: restyledMark, pressed };

  // IME-style input through CDP composition events (real Windows IME cannot be driven headlessly).
  await evaluate(`window.__pdfHarness.setTool('text')`); await frame();
  const ip = await pointOnPage(5, 75);
  await clickAt(ip.x, ip.y);
  await until(`!!document.querySelector('.annotation-text-editor')`);
  await rpc('Input.imeSetComposition', { text: 'pin', selectionStart: 3, selectionEnd: 3 });
  await frame();
  const composing = await editorState();
  await rpc('Input.imeSetComposition', { text: 'pinyin', selectionStart: 6, selectionEnd: 6 });
  await frame();
  await insertText('拼音');
  const committed = await editorState();
  ok(composing.text.includes('pin') && committed.text === '拼音', 'composition text is replaced by the committed IME text exactly once', { composing: composing.text, committed: committed.text });
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`);
  const imeSaved = (await annotations()).pop();
  ok(imeSaved.comment === '拼音', 'the committed IME text is what gets saved', imeSaved.comment);
  results.cases.ime = { composing: composing.text, committed: committed.text, saved: imeSaved.comment, note: 'CDP composition simulation only; real Windows IME unverified' };
  }

  // Existing range marks are paint while highlight/underline selection is active,
  // but become interactive again in cursor mode. Start a reverse drag inside an
  // existing highlight and continue through it to create a second overlapping mark.
  await setZoom(1);
  const overlapFixture = await evaluate(`(()=>{
    const span = [...document.querySelectorAll('.pdf-text-layer span')].find(s => (s.textContent || '').includes('Page 1 line 4:'));
    const layer = span?.closest('.pdf-render-layer');
    if (!span || !layer) return null;
    span.scrollIntoView({ block: 'center', inline: 'center' });
    const r = span.getBoundingClientRect(), p = layer.getBoundingClientRect();
    const positionJson = {
      x: ((r.left + r.width * 0.52 - p.left) / p.width) * 100,
      y: ((r.top - p.top) / p.height) * 100,
      width: (r.width * 0.42 / p.width) * 100,
      height: (r.height / p.height) * 100,
    };
    window.__pdfHarness.replaceAnnotations([{ id: 'overlap-existing', paperId: 'harness', fileId: 'file-1', page: 1, type: 'highlight', quote: 'existing range', comment: '', color: 'yellow', positionJson, createdAt: new Date().toISOString() }]);
    return {
      start: { x: r.left + r.width * 0.82, y: r.top + r.height * 0.55 },
      end: { x: r.left + r.width * 0.12, y: r.top + r.height * 0.55 },
      existingOnly: { x: r.left + r.width * 0.90, y: r.top + r.height * 0.55 },
      createdOnly: { x: r.left + r.width * 0.20, y: r.top + r.height * 0.55 },
    };
  })()`);
  ok(overlapFixture, 'overlap fixture finds a real PDF text span');
  await evaluate(`window.__pdfHarness.setTool('highlight')`); await frame();
  await until(`!!document.querySelector('.annotation-mark[data-annotation-id="overlap-existing"]')`);
  const highlightHit = await evaluate(`(()=>{const p=${JSON.stringify(overlapFixture.start)};const e=document.elementFromPoint(p.x,p.y);return { tag:e?.tagName, textLayer:!!e?.closest('.pdf-text-layer'), mark:!!e?.closest('.annotation-mark') }})()`);
  ok(highlightHit.textLayer && !highlightHit.mark, 'highlight mode sends the pointer through the existing mark to the PDF text layer', highlightHit);
  await mouse('mouseMoved', overlapFixture.start.x, overlapFixture.start.y, { button: 'none' });
  await mouse('mousePressed', overlapFixture.start.x, overlapFixture.start.y);
  await mouse('mouseMoved', overlapFixture.end.x, overlapFixture.end.y, { buttons: 1 });
  await mouse('mouseReleased', overlapFixture.end.x, overlapFixture.end.y);
  await until(`window.__pdfHarness.annotations().filter(a => a.type === 'highlight').length === 2`);
  const overlapAnnotations = (await annotations()).filter(a => a.type === 'highlight');
  ok(overlapAnnotations[1].quote.includes('The quick brown fox') && overlapAnnotations[1].quote.includes('annotated pap'), 'reverse drag through an existing mark preserves text from both sides of the overlap', overlapAnnotations.map(a => a.quote));
  ok(overlapAnnotations.every(a => a.positionJson.width > 0 && a.positionJson.height > 0), 'both overlapping highlights keep independent geometry', overlapAnnotations.map(a => a.positionJson));
  await screenshot('after-overlapping-highlight');
  await evaluate(`window.__pdfHarness.setTool('cursor')`); await frame();
  await clickAt(overlapFixture.existingOnly.x, overlapFixture.existingOnly.y);
  const existingFocus = await evaluate(`document.querySelector('.annotation-mark.focused')?.dataset.annotationId || null`);
  ok(existingFocus === 'overlap-existing', 'the non-covered end of the original highlight remains individually selectable', existingFocus);
  await evaluate(`document.querySelector('.annotation-mark.focused .annotation-color-pill').click()`);
  await until(`!!document.querySelector('.annotation-mark.focused .annotation-color-presets button:not(.active)')`);
  await evaluate(`document.querySelector('.annotation-mark.focused .annotation-color-presets button:not(.active)').click()`);
  await until(`window.__pdfHarness.annotations().find(a => a.id === 'overlap-existing').color !== 'yellow'`);
  const recolored = (await annotations()).find(a => a.id === 'overlap-existing').color;
  ok(recolored !== 'yellow', 'the original overlapping highlight remains recolorable in cursor mode', recolored);
  await clickAt(overlapFixture.createdOnly.x, overlapFixture.createdOnly.y);
  const createdFocus = await evaluate(`document.querySelector('.annotation-mark.focused')?.dataset.annotationId || null`);
  ok(createdFocus === overlapAnnotations[1].id, 'the non-covered end of the new highlight remains individually selectable', createdFocus);
  await evaluate(`document.querySelector('.annotation-mark.focused .annotation-inline-actions button[title*="删除"]').click()`);
  await until(`window.__pdfHarness.annotations().filter(a => a.type === 'highlight').length === 1`);
  ok((await annotations()).some(a => a.id === 'overlap-existing'), 'deleting one overlapping highlight preserves the other', await annotations());
  results.cases.overlapHighlight = { hitDuringSelection: highlightHit, annotations: overlapAnnotations, existingFocus, recolored, createdFocus };

  ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 5));
  const invokes = await evaluate(`JSON.stringify(window.__invokes || [])`);
  results.invokes = JSON.parse(invokes);
  results.log = await logEntries();
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors }, null, 2));
  console.log(`verify-pdf-text-annotation-browser (${phase}): ${checks.filter(c => c.passed).length}/${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
}

try {
  await main();
} catch (error) {
  // Keep a picture and a DOM summary of the failing state next to the evidence.
  try {
    if (ws) {
      await screenshot('failure');
      const summary = await evaluate(`(()=>{const c=document.querySelector('.pdf-document');const e=document.activeElement;return JSON.stringify({docClass:c?.className,pages:document.querySelectorAll('.pdf-page').length,editor:!!document.querySelector('.annotation-text-editor'),popover:!!document.querySelector('.comment-popover'),active:e&&(e.tagName+'.'+e.className),marks:[...document.querySelectorAll('.annotation-mark')].map(m=>m.className),log:window.__pdfHarness?window.__pdfHarness.log:null})})()`);
      fs.writeFileSync(path.join(evidence, 'failure.json'), summary);
      console.error('failure summary:', summary);
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
  if (checks.some(c => !c.passed) && phase === 'after') process.exitCode = 1;
}
