import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Mounts the real FileTab in Chrome with the platform file API mocked by
// synthetic fixtures (never touches a user folder). Covers image/SVG/HTML
// previews, the HTML security sandbox, caps, corrupt and non-UTF-8 files,
// text/binary regressions, rapid switching and "opening never writes".
const dir = path.resolve('.tmp/file-preview-browser');
fs.mkdirSync(dir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, [r, g, b]) {
  const stride = width * 3 + 1; const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const o = y * stride + 1 + x * 3; raw[o] = r; raw[o + 1] = (g + x) & 255; raw[o + 2] = (b + y) & 255; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const gbk = (ascii, tail = '') => Buffer.concat([Buffer.from(ascii), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from(tail)]); // 中文 in GBK
const probe = `<!doctype html><html><head><meta charset="utf-8"><title>probe</title>
<meta http-equiv="refresh" content="0;url=https://example.invalid/">
<link rel="stylesheet" href="./probe.css"><base href="https://example.invalid/">
<style>body{font:16px sans-serif;margin:24px}h2{margin-top:1800px}</style>
<script>parent.document.title='PWNED';top.__pwned=1;localStorage.setItem('pwned','1');window.name='pwned';</script></head>
<body onload="parent.__pwned=2"><h1>PROBE-BODY</h1><noscript>NOSCRIPT-VISIBLE</noscript>
<p><img class="rel" src="./img/diagram.png" alt="diagram"><img class="missing" src="./img/none.png" alt="missing"><img class="bad" src="x" onerror="parent.__pwned=3" alt="bad"></p>
<p><a class="toc" href="#sec2">jump</a> <a class="ext" href="https://example.invalid/page">external</a> <a class="js" href="javascript:parent.__pwned=4">js</a> <a class="rel-link" href="./other.html">other</a></p>
<form action="https://example.invalid/post"><button class="submit">send</button></form>
<iframe src="https://example.invalid/"></iframe><object data="./x.swf"></object>
<h2 id="sec2">SECTION-TWO</h2></body></html>`;
const files = {
  'photo.png': { bytes: png(64, 40, [40, 120, 200]) },
  'large.png': { bytes: png(2400, 1800, [220, 80, 60]) },
  'logo.svg': { text: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" onload="parent.__svgRan=1"><script>parent.__svgRan=1</script><rect width="120" height="80" rx="12" fill="#2d7d6f"/><circle cx="60" cy="40" r="22" fill="#fff"/></svg>' },
  'bad.svg': { text: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"' },
  'broken.png': { bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('this is not really a png\0\0\0')]), binary: true },
  'huge.png': { preview: { byte_length: 23 * 1024 * 1024, binary: true, content: '', truncated: false } },
  'probe.html': { text: probe },
  'img/diagram.png': { bytes: png(90, 30, [30, 160, 90]) },
  'oversize.html': { preview: { byte_length: Math.round(6.7 * 1024 * 1024), binary: false, content: '<html><body>OVERSIZE-SOURCE-HEAD', truncated: true } },
  'gbk-undeclared.html': { bytes: gbk('<html><body><p>'), preview: { content: '<html><body><p>\uFFFD\uFFFD</p>', binary: false, truncated: false, byte_length: 19 } },
  'gbk-declared.html': { bytes: gbk('<html><head><meta charset="gbk"></head><body><p id="t">', '</p></body></html>'), preview: { content: '<html><head><meta charset="gbk">…', binary: false, truncated: false, byte_length: 71 } },
  'notes.txt': { text: 'NOTES-TXT line 1\nline 2' },
  'data.json': { text: '{"DATA_JSON": true}' },
  'archive.bin': { bytes: Buffer.from([0, 1, 2, 3, 0, 255]), binary: true },
};
const root = 'C:/fixture/';
const fixtures = {};
for (const [name, file] of Object.entries(files)) {
  const bytes = file.bytes ?? (file.text !== undefined ? Buffer.from(file.text) : null);
  // Like workspace_fs.rs, a NUL byte marks a file as binary (PNG is binary, SVG/GBK HTML are text).
  fixtures[(root + name).toLowerCase()] = {
    bytes: bytes ? bytes.toString('base64') : null,
    preview: { byte_length: bytes?.length ?? 0, binary: file.binary ?? Boolean(bytes?.includes(0)), content: file.text ?? '', truncated: false, ...file.preview },
  };
}
fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(fixtures));
fs.writeFileSync(path.join(dir, 'projects-mock.ts'), `import fixtures from './fixtures.json';
const w = window as any; w.__calls = [];
const key = (p: string) => p.replace(/\\\\/g, '/').toLowerCase();
const wait = () => new Promise((r) => setTimeout(r, w.__delay ? Math.random() * w.__delay : 0));
export function isTauriRuntime() { return true; }
export async function readTextFilePreview(path: string) { w.__calls.push(['readTextFilePreview', path]); await wait(); const f = (fixtures as any)[key(path)]; if (!f) throw new Error('missing ' + path); return { path, ...f.preview }; }
export async function readFileBytes(path: string) { w.__calls.push(['readFileBytes', path]); await wait(); const f = (fixtures as any)[key(path)]; if (!f?.bytes) throw new Error('missing ' + path); return Array.from(atob(f.bytes), (c) => c.charCodeAt(0)); }
`);
fs.writeFileSync(path.join(dir, 'host.tsx'), `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileTab } from '/src/features/explorer/FileTab';
import '/src/ui/styles/tokens.css'; import '/src/ui/styles/base.css'; import '/src/ui/styles/workbench.css';
function Host() { const [path, setPath] = useState(''); (window as any).__open = setPath; return path ? <div className="workbench-tab-frame active" style={{ height: '100%', width: '100%' }}><FileTab path={path} name={path.split('\\\\').pop()!} /></div> : null; }
const shell = document.getElementById('root')!; shell.style.cssText = 'height:720px;width:1100px;display:flex;';
createRoot(shell).render(<Host />);
`);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"/><title>file-preview-harness</title><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');

const errors = []; let server, browser;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const win = (name) => `C:\\fixture\\${name.replace(/\//g, '\\')}`;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], resolve: { alias: [{ find: '../../platform/projects', replacement: path.join(dir, 'projects-mock.ts') }] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), fs.realpathSync(path.resolve('node_modules'))] }, watch: { ignored: ['**/.tmp/**', '**/.build/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console ' + msg.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
  page.on('request', (r) => { if (/example\.invalid|probe\.css|x\.swf|other\.html/.test(r.url())) errors.push('request ' + r.url()); });
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/.tmp/file-preview-browser/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__open === 'function', null, { timeout: 30000 });
  const open = async (name, ready) => {
    await page.evaluate((p) => window.__open(p), win(name));
    await page.waitForFunction(([title, selector]) => document.querySelector('.file-tab h2')?.textContent === title && Boolean(document.querySelector(selector)), [name.split('/').pop(), ready], { timeout: 15000 });
    await sleep(150);
  };
  const text = (selector) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector);
  const count = (selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);
  const kinds = '.file-tab-image-stage img, .file-tab-preview-message, .file-tab-empty-state, pre.file-tab-preview, iframe.file-tab-html-frame';

  // PNG: shown as an image, centred, never upscaled; header shows size and pixels.
  await open('photo.png', kinds);
  assert.equal(await count('.file-tab-empty-state'), 0, 'PNG must not fall back to "暂不支持预览"');
  const photo = await page.evaluate(() => { const img = document.querySelector('.file-tab-image-stage img'); const r = img.getBoundingClientRect(); const s = img.parentElement.getBoundingClientRect(); return { src: img.src.slice(0, 22), w: r.width, h: r.height, natural: [img.naturalWidth, img.naturalHeight], centred: Math.abs((r.left + r.right) / 2 - (s.left + s.right) / 2) < 2, meta: document.querySelector('.file-tab-meta').textContent, fit: document.querySelector('.file-tab-segmented [aria-pressed="true"]')?.textContent }; });
  assert.deepEqual([photo.src, photo.w, photo.h, photo.natural, photo.centred], ['data:image/png;base64,', 64, 40, [64, 40], true], JSON.stringify(photo));
  assert.ok(photo.meta.includes('64 × 40 像素') && /B|KB/.test(photo.meta), photo.meta);
  assert.equal(photo.fit, '适应窗口');

  // Large PNG: fit scales down into the stage; "实际大小" shows 1:1 with scrolling.
  await open('large.png', kinds);
  await page.waitForFunction(() => document.querySelector('.file-tab-meta')?.textContent.includes('2400 × 1800'));
  const fitted = await page.evaluate(() => { const img = document.querySelector('.file-tab-image-stage img'); const s = img.parentElement; return { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, sw: s.clientWidth, sh: s.clientHeight }; });
  assert.ok(fitted.w <= fitted.sw && fitted.h <= fitted.sh && Math.abs(fitted.w / fitted.h - 4 / 3) < 0.02, JSON.stringify(fitted));
  await page.click('.file-tab-segmented button:has-text("实际大小")');
  await sleep(150);
  const actual = await page.evaluate(() => { const img = document.querySelector('.file-tab-image-stage img'); const s = img.parentElement; return { w: img.getBoundingClientRect().width, scroll: s.scrollWidth > s.clientWidth, pressed: document.querySelector('.file-tab-segmented [aria-pressed="true"]').textContent }; });
  assert.deepEqual(actual, { w: 2400, scroll: true, pressed: '实际大小' });

  // SVG: rendered through <img> only, so its script never runs.
  await open('logo.svg', kinds);
  const svg = await page.evaluate(() => ({ src: document.querySelector('.file-tab-image-stage img')?.src.slice(0, 26), pre: document.querySelectorAll('pre').length, ran: window.__svgRan ?? null, inline: document.querySelectorAll('.file-tab svg script, .file-tab-body > svg').length }));
  assert.deepEqual(svg, { src: 'data:image/svg+xml;base64,', pre: 0, ran: null, inline: 0 });
  await open('bad.svg', '.file-tab-notice');
  assert.ok((await text('.file-tab-notice')).includes('SVG 源码') && (await text('pre.file-tab-preview')).includes('<svg'), 'an undecodable SVG falls back to its source');

  // Corrupt and over-cap images get a clear message instead of a broken image.
  await open('broken.png', '.file-tab-preview-message');
  assert.ok((await text('.file-tab-preview-message')).includes('图片无法解码'));
  await open('huge.png', '.file-tab-preview-message');
  assert.ok((await text('.file-tab-preview-message')).includes('超过 20.0 MB'));
  assert.equal(await page.evaluate(() => window.__calls.filter(([op, p]) => op === 'readFileBytes' && p.toLowerCase().includes('huge')).length), 0, 'an over-cap image is never read');

  // HTML: rendered by default in a fully sandboxed srcdoc frame; nothing in it runs or reaches the app.
  await open('probe.html', 'iframe.file-tab-html-frame');
  const frameAttrs = await page.evaluate(() => { const f = document.querySelector('iframe.file-tab-html-frame'); return { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src'), csp: f.srcdoc.includes("Content-Security-Policy") && f.srcdoc.includes("default-src 'none'"), script: /<script/i.test(f.srcdoc), handlers: /\son\w+=/i.test(f.srcdoc), mode: document.querySelector('.file-tab-segmented [aria-pressed="true"]').textContent, note: document.querySelector('.file-tab-meta').textContent }; });
  assert.deepEqual([frameAttrs.sandbox, frameAttrs.src, frameAttrs.csp, frameAttrs.script, frameAttrs.handlers, frameAttrs.mode], ['', null, true, false, false, '预览'], JSON.stringify(frameAttrs));
  assert.ok(frameAttrs.note.includes('脚本不执行') && frameAttrs.note.includes('2 张本地图片无法载入'), frameAttrs.note);
  const frame = page.frames().find((f) => f !== page.mainFrame() && !f.isDetached());
  await frame.waitForFunction(() => document.querySelector('img.rel')?.complete);
  const inside = await frame.evaluate(() => ({
    body: document.body.innerText.includes('PROBE-BODY'), noscript: document.body.innerText.includes('NOSCRIPT-VISIBLE'),
    rel: [document.querySelector('img.rel').src.slice(0, 22), document.querySelector('img.rel').naturalWidth],
    missing: document.querySelector('img.missing').hasAttribute('src'), toc: document.querySelector('a.toc').getAttribute('href'),
    ext: [document.querySelector('a.ext').hasAttribute('href'), document.querySelector('a.ext').title], js: document.querySelector('a.js').hasAttribute('href'), rellink: document.querySelector('a.rel-link').hasAttribute('href'),
    embeds: document.querySelectorAll('iframe, object, script, base[href^="https"]').length, bg: getComputedStyle(document.documentElement).filter,
  }));
  assert.deepEqual(inside, { body: true, noscript: true, rel: ['data:image/png;base64,', 90], missing: false, toc: 'about:srcdoc#sec2', ext: [false, 'https://example.invalid/page'], js: false, rellink: false, embeds: 0, bg: 'none' }, JSON.stringify(inside));
  assert.deepEqual(errors, [], 'rendering the probe logs nothing');
  // Input into the sandboxed (out-of-process) frame makes Playwright try to run its
  // own helpers there, which the script-less sandbox blocks and logs. A raw-CDP run
  // with the frame's Log/Runtime attached shows real clicks on these same elements
  // log nothing, and the srcdoc has no scripts or handlers (asserted above), so only
  // this exact message is tolerated from here on.
  const harnessNoise = /^console Blocked script execution in 'about:srcdoc(#sec2)?' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/;
  const clickIn = async (selector) => {
    const offset = await page.evaluate(() => { const r = document.querySelector('iframe.file-tab-html-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    const box = await frame.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector);
    await page.mouse.click(offset.x + box.x, offset.y + box.y);
  };
  await clickIn('a.ext'); await clickIn('button.submit'); await sleep(1200);
  const host = await page.evaluate(() => ({ title: document.title, pwned: window.__pwned ?? null, storage: localStorage.getItem('pwned'), name: window.name, url: location.pathname, frames: document.querySelectorAll('iframe').length }));
  assert.deepEqual(host, { title: 'file-preview-harness', pwned: null, storage: null, name: '', url: '/.tmp/file-preview-browser/index.html', frames: 1 });
  assert.deepEqual(await frame.evaluate(() => [location.href, document.activeElement?.className, document.querySelectorAll('form').length]), ['about:srcdoc', 'submit', 0], 'links, forms and meta refresh cannot navigate the preview');
  await clickIn('a.toc');
  await sleep(300);
  assert.ok(await frame.evaluate(() => scrollY > 1000 && location.href === 'about:srcdoc#sec2'), 'in-page anchors still scroll the preview');
  const inputNoise = errors.filter((e) => harnessNoise.test(e)).length;
  errors.splice(0, errors.length, ...errors.filter((e) => !harnessNoise.test(e)));

  // Source view is remembered per file.
  await page.click('.file-tab-segmented button:has-text("源码")');
  await page.waitForSelector('pre.file-tab-preview');
  assert.ok((await text('pre.file-tab-preview')).includes('<script>parent.document.title'));
  await open('notes.txt', 'pre.file-tab-preview');
  await open('gbk-declared.html', 'iframe.file-tab-html-frame');
  await open('probe.html', 'pre.file-tab-preview');
  assert.equal(await count('iframe'), 0, 'probe.html reopens in source view');
  await page.click('.file-tab-segmented button:has-text("预览")');
  await page.waitForSelector('iframe.file-tab-html-frame');

  // Over-cap and non-UTF-8 HTML fall back to source with a message.
  await open('oversize.html', '.file-tab-notice');
  assert.ok((await text('.file-tab-notice')).includes('超过 5.0 MB') && (await text('pre.file-tab-preview')).includes('OVERSIZE-SOURCE-HEAD'));
  assert.equal(await page.evaluate(() => window.__calls.filter(([op, p]) => op === 'readFileBytes' && p.includes('oversize')).length), 0, 'an over-cap page is never read whole');
  await open('gbk-undeclared.html', '.file-tab-notice');
  assert.ok((await text('.file-tab-notice')).includes('没有声明 charset'));
  assert.equal(await count('iframe'), 0);
  await open('gbk-declared.html', 'iframe.file-tab-html-frame');
  const gbkFrame = page.frames().find((f) => f !== page.mainFrame() && !f.isDetached());
  assert.equal(await gbkFrame.evaluate(() => document.getElementById('t').textContent), '中文');
  assert.ok((await text('.file-tab-meta')).includes('按 GBK 解码'));

  // Text and binary files keep their existing behaviour.
  await open('notes.txt', kinds);
  assert.ok((await text('pre.file-tab-preview')).startsWith('NOTES-TXT'));
  assert.equal(await count('.file-tab-segmented'), 0);
  await open('data.json', kinds);
  assert.ok((await text('pre.file-tab-preview')).includes('DATA_JSON'));
  await open('archive.bin', kinds);
  assert.ok((await text('.file-tab-empty-state')).includes('暂不支持预览'));

  // Rapid switching with out-of-order responses: only the last file wins.
  await page.evaluate(() => { window.__delay = 160; });
  for (const last of ['notes.txt', 'photo.png', 'gbk-declared.html']) {
    const sequence = ['probe.html', 'large.png', 'logo.svg', 'data.json', 'probe.html', 'photo.png', 'gbk-declared.html', 'broken.png', 'notes.txt', last].filter((n, i, all) => i === all.length - 1 || n !== last);
    for (const name of sequence) { await page.evaluate((p) => window.__open(p), win(name)); await sleep(12); }
    await sleep(1400);
    const final = await page.evaluate(() => ({ title: document.querySelector('.file-tab h2').textContent, pre: document.querySelector('pre.file-tab-preview')?.textContent.slice(0, 9) ?? null, img: document.querySelector('.file-tab-image-stage img')?.alt ?? null, frames: document.querySelectorAll('iframe').length, meta: document.querySelector('.file-tab-meta')?.textContent ?? '' }));
    if (last === 'notes.txt') assert.deepEqual([final.title, final.pre, final.img, final.frames], ['notes.txt', 'NOTES-TXT', null, 0], JSON.stringify(final));
    if (last === 'photo.png') assert.ok(final.title === 'photo.png' && final.img === 'photo.png' && final.frames === 0 && final.meta.includes('64 × 40'), JSON.stringify(final));
    if (last === 'gbk-declared.html') assert.ok(final.title === 'gbk-declared.html' && final.frames === 1 && final.img === null && final.meta.includes('GBK'), JSON.stringify(final));
  }
  await page.evaluate(() => { window.__delay = 0; });

  // Dark theme: the page keeps its own white canvas and is not inverted.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'midnight'; });
  await open('probe.html', 'iframe.file-tab-html-frame');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('iframe.file-tab-html-frame')).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('iframe.file-tab-html-frame')).filter), 'none');

  // Opening files only ever reads.
  const ops = await page.evaluate(() => [...new Set(window.__calls.map(([op]) => op))]);
  assert.deepEqual(ops.sort(), ['readFileBytes', 'readTextFilePreview']);
  assert.deepEqual(errors, []);
  console.log('PASS file preview browser: PNG fit/actual, SVG via img, corrupt/over-cap images, sandboxed HTML probe, remembered source view, over-cap/GBK HTML, txt/json/bin unchanged, rapid switching, dark theme, read-only', JSON.stringify({ photo, fitted, frameAttrs: { sandbox: frameAttrs.sandbox, csp: frameAttrs.csp }, inside, host, inputNoise }));
} catch (e) { console.error('FAILED file preview browser:', e, JSON.stringify(errors)); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); }
