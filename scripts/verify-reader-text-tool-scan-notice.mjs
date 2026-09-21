// Task 259f7b91 — a page without a text layer must say so instead of swallowing the text tools.
// Builds the real PdfReader (production Vite build) around a synthetic two-page PDF whose second
// page carries no text operators at all (the stand-in for a scanned page), drives it through
// headless Chrome/Edge over CDP and captures screenshots + result.json.
//   node scripts/verify-reader-text-tool-scan-notice.mjs
// Evidence: .tmp/shots/text-tool-scan-notice/*.png + result.json
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
const evidence = path.join(root, '.tmp/shots/text-tool-scan-notice');
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-scan-notice-'));

let browser, ws, web;
let seq = 0;
const pending = new Map();
const pageErrors = [];
const consoleErrors = [];
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const ok = (condition, name, detail) => {
  checks.push({ name, passed: !!condition, detail });
  assert.ok(condition, name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
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
  throw Error('Condition timed out: ' + expression + ' errors=' + JSON.stringify(pageErrors.slice(0, 3)));
};
const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot = async name => {
  fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await rpc('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const mouse = async (type, x, y, extra = {}) => rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y, { button: 'none' });
  await mouse('mousePressed', x, y);
  await mouse('mouseReleased', x, y);
  await frame();
};
const drag = async (from, to) => {
  await mouse('mouseMoved', from.x, from.y, { button: 'none' });
  await mouse('mousePressed', from.x, from.y);
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await mouse('mouseMoved', from.x + (to.x - from.x) * step, from.y + (to.y - from.y) * step, { buttons: 1 });
    await pause(30);
  }
  await mouse('mouseReleased', to.x, to.y);
  await frame();
};
const key = async keyName => {
  const codes = { Escape: 27, Enter: 13 };
  const base = { key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], nativeVirtualKeyCode: codes[keyName] };
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await frame();
};
const insertText = async text => { await rpc('Input.insertText', { text }); await frame(); };

// --- synthetic two-page PDF: page 1 = Helvetica body text, page 2 = scan-like bars, no text ops ---
function syntheticPdf() {
  const textPage = () => {
    const ops = ['BT', '/F1 11 Tf', '13.5 TL', '54 740 Td', '(Synthetic test document - page 1) Tj', 'T*', 'T*'];
    for (let i = 0; i < 34; i += 1) {
      ops.push(`(Page 1 line ${i + 1}: The quick brown fox jumps over the lazy dog while reading annotated papers.) Tj`, 'T*');
    }
    ops.push('ET');
    return ops.join('\n');
  };
  // Deliberately free of BT/ET text operators: pdf.js reports zero text items, exactly like a scan.
  const scannedPage = () => {
    const ops = ['1 1 1 rg', '0 0 612 792 re f', '0.87 0.86 0.84 rg', '38 36 536 720 re f'];
    for (let i = 0; i < 30; i += 1) {
      ops.push('0.55 0.55 0.55 rg', `${54 + (i % 3) * 6} ${700 - i * 22} ${470 - (i % 4) * 40} 5 re f`);
    }
    ops.push('0.42 0.42 0.42 rg', '54 96 504 3 re f', '54 84 380 3 re f');
    return ops.join('\n');
  };
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentIds = [];
  for (const stream of [textPage(), scannedPage()]) {
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`));
  }
  const pagesObj = objects.length + 3;
  const pageIds = [];
  [1, 2].forEach((page, index) => {
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`));
  });
  const pages = add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  assert.equal(pages, pagesObj, 'pages object id');
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
  const log = useRef<any[]>([]);
  const latest = useRef(annotations); latest.current = annotations;
  (window as any).__pdfHarness = { setTool, setZoom, log: log.current, annotations: () => latest.current };
  return <div className="reader-scene-shell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
    <div className="reader-document-pane" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <PdfReader
        source={source as any}
        annotations={annotations}
        activeTool={tool}
        activeAnnotationColor={'green' as any}
        toolSettings={defaultReaderToolSettings}
        onCompleteOneShotTool={() => setTool('cursor')}
        zoom={zoom}
        onZoomChange={(z) => setZoom(z)}
        onCreateAnnotation={async (draft) => { const id = 'new-' + (++counter); log.current.push(['create', id, draft]); setAnnotations(list => [...list, { id, paperId: 'harness', fileId: 'file-1', createdAt: new Date().toISOString(), ...draft }]); return id; }}
        onUpdateAnnotationComment={async (id, comment) => { log.current.push(['comment', id, comment]); setAnnotations(list => list.map(a => a.id === id ? { ...a, comment } : a)); }}
        onUpdateAnnotationPosition={async () => {}}
        onUpdateAnnotationColor={async () => {}}
        onDeleteAnnotation={async (id) => setAnnotations(list => list.filter(a => a.id !== id))}
        onAppendAnnotationToNote={() => {}}
        onFocusAnnotation={() => {}}
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
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>reader scan notice harness</title><link rel="stylesheet" href="/entry.css"><style>html,body,#root{margin:0;height:100%;background:#e9ece8}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`;
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
  browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + path.join(scratch, 'profile'), '--lang=zh-CN', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(scratch, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await pause(100);
  const cdpPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? a.type).join(' '));
  };
  await rpc('Page.enable'); await rpc('Runtime.enable');
  // Tauri shim: the reader only loads bytes inside the desktop runtime; serve the synthetic PDF through the same command.
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id; }, invoke: async (cmd, args) => { if (cmd === 'load_paper_file_bytes') { const buf = await (await fetch('/fixture.pdf')).arrayBuffer(); return Array.from(new Uint8Array(buf)); } (window.__invokes ||= []).push(cmd); return null; } };` });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: origin + '/' });
  await until(`!!window.__pdfHarness && document.querySelectorAll('.pdf-page').length >= 2 && !!document.querySelector('.pdf-page[data-page="1"] canvas.ready')`, 30000);
  await pause(400);

  const pageState = number => evaluate(`(()=>{const p=document.querySelector('.pdf-page[data-page="${number}"]');if(!p)return null;const r=p.getBoundingClientRect();return {className:p.className,cursor:getComputedStyle(p).cursor,textLayerCursor:p.querySelector('.pdf-text-layer')?getComputedStyle(p.querySelector('.pdf-text-layer')).cursor:null,spans:p.querySelectorAll('.pdf-text-layer span').length,visible:r.bottom>0&&r.top<window.innerHeight}})()`);
  const notice = () => evaluate(`(()=>{const e=document.querySelector('.pdf-text-layer-hint');if(!e)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {text:e.innerText.trim(),role:e.getAttribute('role'),live:e.getAttribute('aria-live'),width:Math.round(r.width),height:Math.round(r.height),pointerEvents:cs.pointerEvents,top:Math.round(r.top)}})()`);
  const annotations = () => evaluate(`JSON.parse(JSON.stringify(window.__pdfHarness.annotations()))`);
  const setTool = async tool => { await evaluate(`window.__pdfHarness.setTool(${JSON.stringify(tool)})`); await frame(); await pause(150); };
  const scrollToPage = async number => {
    await evaluate(`(()=>{const c=document.querySelector('.pdf-document');const p=document.querySelector('.pdf-page[data-page="${number}"]');const cr=c.getBoundingClientRect();const pr=p.getBoundingClientRect();c.scrollTop=Math.max(0,c.scrollTop+(pr.top-cr.top)-40);})()`);
    await until(`(()=>{const c=document.querySelector('.pdf-document').getBoundingClientRect();const p=document.querySelector('.pdf-page[data-page="${number}"]').getBoundingClientRect();return p.top>=c.top-6&&p.top<c.bottom;})()`);
    await until(`!!document.querySelector('.pdf-page[data-page="${number}"] canvas.ready')`, 30000);
    await pause(300);
  };
  const pointOnPage = async (number, xPercent, yPercent) => {
    await evaluate(`(()=>{const c=document.querySelector('.pdf-document');const l=document.querySelector('.pdf-page[data-page="${number}"] .pdf-render-layer');const lr=l.getBoundingClientRect();const cr=c.getBoundingClientRect();
      const px=lr.left-cr.left+c.scrollLeft+lr.width*${xPercent}/100, py=lr.top-cr.top+c.scrollTop+lr.height*${yPercent}/100;
      c.scrollLeft=Math.max(0,px-cr.width*0.35); c.scrollTop=Math.max(0,py-cr.height*0.4);})()`);
    await frame(); await pause(120);
    const l = await evaluate(`(()=>{const r=document.querySelector('.pdf-page[data-page="${number}"] .pdf-render-layer').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    return { x: l.left + l.width * xPercent / 100, y: l.top + l.height * yPercent / 100, layer: l };
  };

  const results = { fixture: 'page 1 = text layer, page 2 = scan-like page without text operators', cases: {} };
  const noticeText = '本页没有可选择的文字层（可能是扫描页），高亮和下划线无法使用；请改用矩形、箭头、自由画笔或文本框标注。';

  // ---------------------------------------------------------------- 1. the scan page announces itself
  await scrollToPage(2);
  await setTool('highlight');
  await until(`!!document.querySelector('.pdf-page[data-page="2"].text-tools-unavailable')`);
  const scanHighlight = await pageState(2);
  const textPageIdle = await pageState(1);
  ok(scanHighlight.className.includes('text-tools-unavailable'), '扫描页在高亮工具下被标记为 text-tools-unavailable', scanHighlight);
  ok(!textPageIdle.className.includes('text-tools-unavailable'), '带文字层的页面不会被标记', textPageIdle.className);
  ok(scanHighlight.spans === 0, '扫描页确实没有文字层内容（合成 fixture 有效）', scanHighlight.spans);
  const shown = await notice();
  const t0 = Date.now();
  ok(shown && shown.text === noticeText, '提示文案等于 zh.reader.textLayerUnavailable', shown);
  ok(shown && shown.role === 'status' && shown.live === 'polite', '提示是可被读屏的 status 区域', shown);
  ok(shown && shown.pointerEvents === 'none', '提示不拦截指针事件（非阻断）', shown.pointerEvents);
  await screenshot('01-scan-page-highlight-notice');
  results.cases.notice = shown;

  // ---------------------------------------------------------------- 2. disabled cursor
  ok(scanHighlight.cursor === 'not-allowed', '扫描页光标为 not-allowed（禁用态）', scanHighlight.cursor);
  ok(scanHighlight.textLayerCursor === 'not-allowed', '文字层元素同样是 not-allowed', scanHighlight.textLayerCursor);
  await screenshot('02-scan-page-disabled-cursor');

  // ---------------------------------------------------------------- 3. a highlight drag is a no-op, not a silent failure
  const before = (await annotations()).length;
  const from = await pointOnPage(2, 20, 30);
  const to = await pointOnPage(2, 70, 34);
  await drag(from, to);
  await pause(300);
  const afterDrag = await annotations();
  ok(afterDrag.length === before, '在扫描页拖拽高亮不会创建标注', { before, after: afterDrag.length });
  ok((await notice()) !== null, '拖拽之后提示仍然可见（用户看得到原因）', await notice());
  const scrolled = await evaluate(`(()=>{const c=document.querySelector('.pdf-document');const s=c.scrollTop;c.scrollTop=s+120;const moved=c.scrollTop!==s;c.scrollTop=s;return moved})()`);
  ok(scrolled, '提示浮层不阻断页面滚动');
  await screenshot('03-scan-page-highlight-drag-no-op');
  results.cases.highlightDrag = { before, after: afterDrag.length, noticeVisible: true };

  // ---------------------------------------------------------------- 4. underline behaves the same
  await setTool('underline');
  ok((await pageState(2)).className.includes('text-tools-unavailable'), '下划线工具下扫描页同样是禁用态');
  const underlineNotice = await notice();
  ok(underlineNotice && underlineNotice.text === noticeText, '下划线工具同样给出提示', underlineNotice);
  await screenshot('04-scan-page-underline-notice');

  // ---------------------------------------------------------------- 5. geometry tools keep working on the scan page
  await setTool('rect');
  ok(!(await pageState(2)).className.includes('text-tools-unavailable'), '矩形工具下扫描页不再是禁用态');
  const rectFrom = await pointOnPage(2, 18, 45);
  const rectTo = await pointOnPage(2, 55, 52);
  await drag(rectFrom, rectTo);
  await until(`window.__pdfHarness.annotations().length === ${before + 1}`, 8000);
  const rect = (await annotations()).find(a => a.id === 'new-1');
  ok(rect && rect.type === 'rect' && rect.page === 2, '扫描页上矩形工具仍能创建标注', rect && { type: rect.type, page: rect.page, positionJson: rect.positionJson });
  await screenshot('05-scan-page-rect-still-works');
  results.cases.rect = rect && { type: rect.type, page: rect.page, positionJson: rect.positionJson };

  // ---------------------------------------------------------------- 6. the freehand tool keeps working too
  await setTool('ink');
  const inkFrom = await pointOnPage(2, 25, 60);
  const inkTo = await pointOnPage(2, 60, 66);
  await drag(inkFrom, inkTo);
  await until(`window.__pdfHarness.annotations().length === ${before + 2}`, 8000);
  const ink = (await annotations()).find(a => a.id === 'new-2');
  ok(ink && ink.type === 'ink' && ink.page === 2, '扫描页上自由画笔仍能创建标注', ink && { type: ink.type, page: ink.page, points: ink.positionJson?.points?.length });
  await screenshot('06-scan-page-ink-still-works');
  results.cases.ink = ink && { type: ink.type, page: ink.page };

  // ---------------------------------------------------------------- 7. the text box keeps working
  await setTool('text');
  const textPoint = await pointOnPage(2, 22, 74);
  await clickAt(textPoint.x, textPoint.y);
  await until(`!!document.querySelector('.annotation-text-editor')`, 8000);
  await insertText('扫描页文本框');
  await key('Escape');
  await until(`!document.querySelector('.annotation-text-editor')`, 8000);
  await until(`window.__pdfHarness.annotations().length === ${before + 3}`, 8000);
  const textBox = (await annotations()).find(a => a.id === 'new-3');
  ok(textBox && textBox.type === 'text' && textBox.page === 2 && textBox.comment === '扫描页文本框', '扫描页上文本框仍能创建并保存', textBox && { type: textBox.type, page: textBox.page, comment: textBox.comment });
  await screenshot('07-scan-page-textbox-still-works');
  results.cases.textBox = textBox && { type: textBox.type, page: textBox.page, comment: textBox.comment };

  // ---------------------------------------------------------------- 8. a real text page still highlights, and shows no notice
  await scrollToPage(1);
  await setTool('highlight');
  await until(`!document.querySelector('.pdf-text-layer-hint')`, 9000);
  const textPage = await pageState(1);
  ok(!textPage.className.includes('text-tools-unavailable'), '回到文字页后不再标记不可用');
  ok(textPage.cursor === 'crosshair', '文字页十字光标不受影响', textPage.cursor);
  const span = await evaluate(`(()=>{const s=[...document.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span')].find(s=>s.innerText.trim().length>10);if(!s)return null;const r=s.getBoundingClientRect();return {text:s.innerText.slice(0,24),x:r.left,y:r.top+r.height/2,w:r.width}})()`);
  ok(span, '文字页存在可选择的文字层 span', span);
  await drag({ x: span.x + 2, y: span.y }, { x: span.x + span.w * 0.75, y: span.y });
  await until(`window.__pdfHarness.annotations().length === ${before + 4}`, 8000);
  const highlight = (await annotations()).find(a => a.id === 'new-4');
  ok(highlight && highlight.type === 'highlight' && highlight.page === 1, '文字页上高亮仍然照常创建（无回归）', highlight && { type: highlight.type, page: highlight.page, rects: highlight.positionJson?.rects?.length ?? highlight.positionJson?.quads?.length });
  await screenshot('08-text-page-highlight-still-works');
  results.cases.textPageHighlight = highlight && { type: highlight.type, page: highlight.page, origin: span.text, positionJson: highlight.positionJson };
  results.noticeLifetimeMs = Date.now() - t0;

  ok(pageErrors.length === 0, '没有未捕获的页面错误（pageerror）', pageErrors.slice(0, 5));
  ok(consoleErrors.length === 0, '没有 console error', consoleErrors.slice(0, 5));
  results.log = await evaluate(`JSON.parse(JSON.stringify(window.__pdfHarness.log))`);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ results, checks, pageErrors, consoleErrors }, null, 2));
  console.log(`verify-reader-text-tool-scan-notice: ${checks.filter(c => c.passed).length}/${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
}

try {
  await main();
} catch (error) {
  try {
    if (ws) {
      await screenshot('failure');
      const summary = await evaluate(`(()=>{const c=document.querySelector('.pdf-document');return JSON.stringify({docClass:c?.className,pages:document.querySelectorAll('.pdf-page').length,notices:[...document.querySelectorAll('.pdf-text-layer-hint')].map(e=>e.innerText),hint:!!document.querySelector('.annotation-text-editor'),marks:[...document.querySelectorAll('.annotation-mark')].map(m=>m.className),log:window.__pdfHarness?window.__pdfHarness.log:null})})()`);
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
}

