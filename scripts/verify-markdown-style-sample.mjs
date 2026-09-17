import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
const require = createRequire(import.meta.url);
function load(file, imports = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpile(fs.readFileSync(file, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(exports, id => imports[id] ?? require(id));
  return exports;
}
const source = load('src/features/explorer/noteImageSource.ts');
const { loadNoteImage } = load('src/features/explorer/noteImageLoader.ts', {
  './noteImageSource': source,
  '../../platform/projects': { isTauriRuntime: () => true, readFileBytes: async file => Array.from(fs.readFileSync(file)) },
});
const { remarkAsterInline } = load('src/shared/markdown/remarkAsterInline.ts');
const files = process.argv.slice(2);
if (!files.length) files.push('markdown-style-test.md');
for (const file of files) {
  const documentPath = path.resolve(file);
  const md = fs.readFileSync(documentPath, 'utf8');
  const match = md.match(/!\[A4 Note 图标\]\((\S+) "本地图片示例"\)/);
  assert(match, 'Expected local image fixture');
  const target = source.resolveNoteImagePath(documentPath, match[1]);
  assert(target, 'Resolvable local image');
  const bytes = fs.readFileSync(target.path);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const url = await loadNoteImage(documentPath, match[1]);
  assert(url.startsWith('data:image/png;base64,'));
  assert.deepEqual(Buffer.from(url.split(',')[1], 'base64'), bytes);
  assert.equal(bytes.readUInt32BE(16), 128); assert.equal(bytes.readUInt32BE(20), 128);
  const section = md.slice(md.indexOf('### 2.1 下划线'), md.indexOf('## 3. 列表与任务'));
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkAsterInline] }, section));
  assert(html.includes('<u>中文下划线</u>'));
  assert(html.includes('<u>Underline 123</u>'));
  assert(html.includes('<code>&lt;u&gt;文字&lt;/u&gt;</code>'), 'Inline code must remain literal');
  console.log('Sample passed:', documentPath, '128x128 PNG loaded through shared resolver/loader; underline rendered; no writes.');
}
