// Verifies the packaged browser-extension artifact (task 5fd94c28 shipping gap +
// card item 打包): the zip is byte-checked against build-info.json *and* the packaged
// popup is actually executed in Chrome against the recorded IEEE payload, so a module
// missing from the shipping list cannot pass.
//   node scripts/verify-extension-package.mjs
// Evidence: .tmp/shots/extension-package/<run>/
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';

const root = process.cwd();
const packRoot = path.join(root, 'artifacts', 'browser-extension');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, '.tmp', 'shots', 'extension-package', run);
const records = [];
const errors = [];
function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 1. the archive matches its own build-info ---------- */
if (!fs.existsSync(path.join(packRoot, 'build-info.json'))) {
  console.error('artifacts/browser-extension/build-info.json 不存在：先运行 node scripts/package-capture-extension.mjs（CI 由 .github/workflows/ci.yml 的 Build capture extension package 步骤生成）。');
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(path.join(packRoot, 'build-info.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/browser-extension/manifest.json'), 'utf8'));
const zipPath = path.join(packRoot, info.filename);
const zip = fs.readFileSync(zipPath);
check(info.version === manifest.version, '构建信息版本与 manifest 一致', { info: info.version, manifest: manifest.version });
check(sha256(zip) === info.sha256, 'zip 的 sha256 与 build-info 一致', sha256(zip));

// Central directory:依赖-free 解析，STORE 条目直接用 CRC32 校验内容。
const crcTable = Array.from({ length: 256 }, (_, i) => { for (let j = 0; j < 8; j += 1) i = (i & 1) ? 0xedb88320 ^ (i >>> 1) : i >>> 1; return i >>> 0; });
const crc32 = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const entries = new Map();
if (eocd >= 0) {
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const crc = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 24);
    const local = zip.readUInt32LE(cursor + 42);
    const localNameLength = zip.readUInt16LE(local + 26);
    const localExtraLength = zip.readUInt16LE(local + 28);
    const data = zip.subarray(local + 30 + localNameLength + localExtraLength, local + 30 + localNameLength + localExtraLength + size);
    entries.set(name, { crc, size, sha256: sha256(data), crcOk: crc32(data) === crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
}
const shipped = Object.keys(info.sources);
check(entries.size === shipped.length, 'zip 条目数与 build-info.sources 一致', { zip: entries.size, sources: shipped.length });
const missing = shipped.filter((file) => !entries.has('A4-Note-Capture/' + file));
check(missing.length === 0, '每个登记文件都真的在 zip 里', missing);
const badCrc = shipped.filter((file) => entries.get('A4-Note-Capture/' + file)?.crcOk === false);
check(badCrc.length === 0, 'zip 内条目的 CRC32 与内容一致', badCrc);
check(shipped.includes('dom-fallbacks.mjs'), '0.6.6 的 IEEE 修复模块已随包发布', shipped.includes('dom-fallbacks.mjs'));
const unpacked = path.join(packRoot, 'unpacked');
for (const file of shipped) {
  const onDisk = path.join(unpacked, file);
  const hash = fs.existsSync(onDisk) ? sha256(fs.readFileSync(onDisk)) : null;
  check(hash === info.sources[file], `解包目录中的 ${file} 与登记哈希一致`);
}

/* ---------- 2. the packaged popup runs in Chrome ---------- */
const host = path.join(root, '.tmp', 'extension-package');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(host, { recursive: true });
const serve = path.join(host, 'unpacked');
fs.rmSync(serve, { recursive: true, force: true });
fs.cpSync(unpacked, serve, { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'capture-ieee-collected.json'), path.join(serve, 'collected.json'));
const popupHtml = fs.readFileSync(path.join(serve, 'popup.html'), 'utf8');
fs.writeFileSync(path.join(serve, 'harness.html'), popupHtml.replace('<body', '<body').replace(/(<body[^>]*>)/, '$1\n<script src="./chrome-stub.js"></script>'));
fs.writeFileSync(path.join(serve, 'chrome-stub.js'), `// Stubbed browser plumbing; the packaged popup module itself is untouched.
window.__calls = [];
window.__recorded = fetch('./collected.json').then((response) => response.json());
window.chrome = {
  tabs: {
    query: async () => [{ id: 7, url: (await window.__recorded).url }],
    create: async (options) => { window.__calls.push('tabs.create:' + options.url); return {}; },
  },
  scripting: { executeScript: async () => [{ result: await window.__recorded }] },
  downloads: { download: async (options) => { window.__calls.push('downloads.download:' + options.url); return 1; } },
  runtime: { getManifest: () => ({ version: ${JSON.stringify(manifest.version)} }), sendMessage: async () => ({ ok: false }), connectNative: () => ({ postMessage() {}, disconnect() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }), onMessage: { addListener() {} }, getURL: (value) => value, lastError: null },
  storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}), set: async () => {} } },
};
`);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const server = http.createServer((request, response) => {
  const target = path.join(serve, decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, ''));
  if (!target.startsWith(serve) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
  response.end(fs.readFileSync(target));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/harness.html';

let browserProcess = null, ws = null, seq = 0;
const requests = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, 30000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception?.description || ''));
  return result.result.value;
};
try {
  const profile = path.join(host, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=420,820', 'about:blank',
  ], { stdio: 'ignore' });
  const port = await waitForChromeDebugPort(profile);
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  ws = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const entry = requests.get(message.id); clearTimeout(entry.timer); requests.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push((message.params.args || []).map((argument) => argument.value ?? argument.description ?? argument.type).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await ev(`!!document.querySelector('#title') && document.getElementById('title').textContent.trim().length > 0`)) break;
    await pause(100);
  }
  const status = (await ev(`document.getElementById('status').textContent`)).trim();
  const title = (await ev(`document.getElementById('title').textContent`)).trim();
  check(status.includes('已识别') && title.includes('MD3D'), '打包后的 popup 能识别 IEEE 页面（真实模块图运行）', { status, title });
  fs.writeFileSync(path.join(evidence, '01-packaged-popup.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await ev(`document.getElementById('help-toggle').click()`);
  await pause(200);
  await ev(`document.querySelectorAll('details').forEach((node) => { node.open = true; })`);
  await pause(150);
  const gated = await ev(`(() => { const button = Array.from(document.querySelectorAll('#files button')).find((node) => node.textContent.includes('在浏览器中打开')); if (!button) return null; button.click(); return true; })()`);
  await pause(200);
  const calls = await ev('window.__calls');
  check(gated === true && calls.some((entry) => entry.startsWith('tabs.create:') && entry.includes('stamp.jsp')), '打包后的受限入口打开浏览器标签而不是下载', calls);
  check(!calls.some((entry) => entry.startsWith('downloads.download:')), '打包后的扩展从不下载受限正文', calls);
  check(errors.length === 0, '打包后的 popup 无脚本错误', errors.slice(0, 3));
  fs.writeFileSync(path.join(evidence, '02-packaged-gated-entry.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
} catch (error) {
  check(false, '打包产物运行失败', String(error && error.stack || error));
} finally {
  try { if (ws) await send('Browser.close'); } catch { /* ignore */ }
  try { browserProcess?.kill(); } catch { /* ignore */ }
  await new Promise((resolve) => server.close(resolve));
}

const failed = records.filter((record) => !record.passed);
fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ version: info.version, filename: info.filename, sha256: info.sha256, records }, null, 2));
console.log(JSON.stringify({ artifact: 'artifacts/browser-extension/' + info.filename, version: info.version, sha256: info.sha256, evidence: path.relative(root, evidence), failed, passed: records.length - failed.length, total: records.length }, null, 2));
process.exit(failed.length ? 1 : 0);
