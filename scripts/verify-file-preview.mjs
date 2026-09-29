import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

// Pure rules of the generic file tab preview: kind by extension, size caps,
// sandbox/CSP, HTML charset handling and the remembered preview/source choice.
// DOM preparation and the mounted tab are covered by verify-file-preview-browser.mjs.
const dir = path.resolve('.tmp/file-preview-unit');
fs.mkdirSync(dir, { recursive: true });
const modulePath = path.resolve('src/features/explorer/filePreview.ts');
assert.ok(fs.existsSync(modulePath), 'src/features/explorer/filePreview.ts is missing: the file tab has no image/HTML preview rules');
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error', appType: 'custom', cacheDir: path.join(dir, 'vite-cache'), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
try {
  const p = await server.ssrLoadModule('/src/features/explorer/filePreview.ts');

  for (const name of ['a.png', 'B.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg', 'g.avif', 'h.bmp', 'i.ico']) assert.equal(p.filePreviewKind(`D:\\notes\\${name}`), 'image', name);
  for (const name of ['page.html', 'PAGE.HTM', '实验/LNN点云识别设计-跨尺度演化.html']) assert.equal(p.filePreviewKind(`D:/notes/${name}`), 'html', name);
  for (const name of ['notes.txt', 'data.json', 'archive.bin', 'README', '.png', 'png', 'x.html.bak', 'x.svgz', 'x.md', 'x.pdf']) assert.equal(p.filePreviewKind(`D:\\notes\\${name}`), 'text', name);
  assert.equal(p.isSvgPath('C:\\a\\Logo.SVG'), true);
  assert.equal(p.isSvgPath('C:\\a\\logo.png'), false);
  assert.equal(p.fileBaseName('C:\\a\\b\\照片 1.png'), '照片 1.png');

  assert.equal(p.IMAGE_PREVIEW_MAX_BYTES, 20 * 1024 * 1024, 'image cap matches Markdown local images');
  assert.equal(p.HTML_PREVIEW_MAX_BYTES, 5 * 1024 * 1024);

  // Sandbox: every restriction on; no script or same-origin escape hatch is offered.
  assert.equal(p.HTML_PREVIEW_SANDBOX, '');
  const csp = p.HTML_PREVIEW_CSP;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /script-src|unsafe-eval|frame-src|connect-src|child-src|object-src/);
  assert.match(csp, /img-src data: http: https:/);
  const sources = ['FileTab.tsx', 'htmlPreviewDocument.ts', 'filePreview.ts'].map((file) => fs.readFileSync(path.resolve('src/features/explorer', file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /allow-scripts|allow-same-origin|allow-top-navigation|allow-popups|dangerouslySetInnerHTML/);
  const tab = fs.readFileSync(path.resolve('src/features/explorer/FileTab.tsx'), 'utf8');
  assert.match(tab, /sandbox=\{HTML_PREVIEW_SANDBOX\}/);
  assert.match(tab, /srcDoc=/);
  assert.doesNotMatch(tab, /writeTextFile|saveTextFile|writeFile|write_text_file/, 'opening a file never writes it');

  // Charset: BOM, declared charset, strict UTF-8; undeclared non-UTF-8 is reported, not garbled.
  const enc = (text) => new TextEncoder().encode(text);
  const gbkZhongWen = [0xd6, 0xd0, 0xce, 0xc4]; // 中文
  const bytes = (...parts) => Uint8Array.from(parts.flatMap((part) => typeof part === 'string' ? [...enc(part)] : part));
  let d = p.decodeHtmlBytes(enc('<p>中文</p>'));
  assert.deepEqual([d.ok, d.text, d.encoding, d.declared], [true, '<p>中文</p>', 'utf-8', false]);
  d = p.decodeHtmlBytes(bytes([0xef, 0xbb, 0xbf], '<p>中文</p>'));
  assert.deepEqual([d.ok, d.text, d.encoding], [true, '<p>中文</p>', 'utf-8']);
  d = p.decodeHtmlBytes(Uint8Array.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]));
  assert.deepEqual([d.ok, d.text, d.encoding], [true, '中文', 'utf-16le']);
  d = p.decodeHtmlBytes(bytes('<html><head><meta charset="gbk"></head><body>', gbkZhongWen, '</body></html>'));
  assert.deepEqual([d.ok, d.encoding, d.declared, d.text.includes('中文')], [true, 'gbk', true, true]);
  d = p.decodeHtmlBytes(bytes('<meta http-equiv="Content-Type" content="text/html; charset=GB2312">', gbkZhongWen));
  assert.deepEqual([d.ok, d.encoding, d.text.endsWith('中文')], [true, 'gbk', true]);
  d = p.decodeHtmlBytes(bytes('<html><body>', gbkZhongWen, '</body></html>'));
  assert.deepEqual(d, { ok: false, reason: 'encoding', declared: null }, 'undeclared GBK must not render as mojibake');
  d = p.decodeHtmlBytes(bytes('<meta charset="x-unknown-9">', gbkZhongWen));
  assert.deepEqual(d, { ok: false, reason: 'encoding', declared: 'x-unknown-9' });
  d = p.decodeHtmlBytes(bytes('<meta charset="x-unknown-9"><p>ascii only</p>'));
  assert.equal(d.ok, true, 'an unknown label on valid UTF-8 still renders');
  assert.equal(p.sniffHtmlCharset(bytes(' '.repeat(1100), '<meta charset="gbk">')), null, 'only the first 1024 bytes are prescanned');

  // Preview/source choice is remembered per file, bounded, and failure-tolerant.
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(p.readHtmlViewMode('D:\\a.html', storage), 'preview', 'HTML renders by default');
  p.writeHtmlViewMode('D:\\a.html', 'source', storage);
  assert.equal(p.readHtmlViewMode('D:\\a.html', storage), 'source');
  assert.equal(p.readHtmlViewMode('D:\\b.html', storage), 'preview', 'the choice is per file');
  for (let i = 0; i < 250; i += 1) p.writeHtmlViewMode(`D:\\n${i}.html`, 'source', storage);
  const saved = JSON.parse(store.get('a4note.filePreview.htmlMode.v1'));
  assert.equal(Object.keys(saved).length, 200);
  assert.equal(p.readHtmlViewMode('D:\\a.html', storage), 'preview', 'oldest entries fall off');
  assert.equal(p.readHtmlViewMode('D:\\n249.html', storage), 'source');
  assert.equal(p.readHtmlViewMode('D:\\x.html', { getItem: () => '{broken' }), 'preview');
  assert.doesNotThrow(() => p.writeHtmlViewMode('D:\\x.html', 'source', { getItem: () => null, setItem: () => { throw new Error('quota'); } }));

  console.log('PASS file preview rules: kinds, caps, sandbox/CSP, charset (BOM/declared/strict UTF-8/undeclared GBK), remembered view mode');
} catch (error) {
  console.error('FAILED file preview rules:', error);
  process.exitCode = 1;
} finally {
  await server.close();
}
