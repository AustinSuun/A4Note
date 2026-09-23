import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, console });
  return exports;
}
const fields = load('src/core/librarySummary.ts');
const template = load('src/core/summaryNoteTemplate.ts', { './librarySummary': fields });
const initial = template.summaryNoteTemplate('');
assert.equal(initial, '');
assert.equal(fields.summaryFields(initial).size, 0);
assert.doesNotMatch(initial, /a4-summary|请保留|## /);
assert.equal(fields.summaryFields(initial).has('venue'), false);
const layout = JSON.stringify({ version: 2, columns: [{ id: 'custom', name: '自定义', kind: 'text', width: 150 }] });
assert.equal(template.summaryNoteTemplate(layout), initial);
assert.equal(fields.summaryFields(template.summaryNoteTemplate(layout)).has('custom'), false);
const explicit = fields.updateSummaryField(initial, { id: 'custom', name: '自定义' }, '仅当前论文');
assert.equal(fields.summaryFields(explicit).get('custom').value, '仅当前论文');
assert.equal(fields.summaryFields(initial).size, 0);
assert.throws(() => template.summaryNoteTemplate('{broken'));
function fixture(invoke) {
  const published = []; let invalidated = 0;
  const api = load('src/platform/library/provisionSummaryNotes.ts', {
    '@tauri-apps/api/core': { invoke }, '../../core/summaryNoteTemplate': template,
    './summaries': { acceptProvisionedSummary(id, file) { invalidated++; published.push({ file, id }); } },
  });
  return { api, published, invalidated: () => invalidated };
}
const blank = { scanned: 0, preserved: 0, created: [], failures: [], nextAfter: null };
let calls = [];
const f = fixture(async (name, args) => {
  calls.push([name, args]);
  if (name === 'read_summary_layout') return { content: layout };
  if (args.afterId === null) return { scanned: 50, preserved: 48, created: [{ paperId: 'new', file: { noteId: 'n', content: args.content } }], failures: [{ paperId: 'bad', message: 'failed' }], nextAfter: 'p049' };
  assert.equal(args.afterId, 'p049'); return { ...blank, scanned: 1, preserved: 1 };
});
await f.api.provisionLibrarySummaries();
assert.equal(f.api.summaryProvisionSnapshot().running, false);
assert.equal(f.api.summaryProvisionSnapshot().scanned, 51);
assert.equal(f.api.summaryProvisionSnapshot().created, 1);
assert.equal(f.api.summaryProvisionSnapshot().failed, 1);
assert.equal(f.published.length, 1); assert.equal(f.invalidated(), 1);
assert.equal(calls[1][1].content, '');
assert.equal(f.published[0].file.content, '');
let fail = true;
const retry = fixture(async name => { if (fail) throw new Error('IPC unavailable'); return name === 'read_summary_layout' ? { content: '' } : blank; });
await retry.api.provisionLibrarySummaries(); // Does not reject PDF import/list.
assert.equal(retry.api.summaryProvisionSnapshot().failed, 1);
fail = false; await retry.api.provisionLibrarySummaries(); assert.equal(retry.api.summaryProvisionSnapshot().failed, 0);
let release; let runs = 0; const gate = new Promise(resolve => { release = resolve; });
const concurrent = fixture(async name => { if (name === 'read_summary_layout') { runs++; if (runs === 1) await gate; return { content: '' }; } return blank; });
const first = concurrent.api.provisionLibrarySummaries(); const second = concurrent.api.provisionLibrarySummaries();
await Promise.resolve(); assert.equal(runs, 1); release(); await Promise.all([first, second]); assert.equal(runs, 2);
const broken = fixture(async name => name === 'read_summary_layout' ? { content: '' } : { ...blank, nextAfter: 'stuck' });
await broken.api.provisionLibrarySummaries(); assert.equal(broken.api.summaryProvisionSnapshot().failed, 1);
const many = fixture(async name => name === 'read_summary_layout' ? { content: '' } : { ...blank, failures: Array.from({ length: 50 }, (_, i) => ({ paperId: `${i}`, message: 'failure' })) });
await many.api.provisionLibrarySummaries(); assert.equal(many.api.summaryProvisionSnapshot().failed, 50); assert.equal(many.api.summaryProvisionSnapshot().failures.length, 20);
// Execute the real native load boundary with fake IPC. Pure mapping does not load the provisioner.
const order = [];
const nativeApi = load('src/platform/nativeApi.ts', {
  '@tauri-apps/api/core': { invoke: async name => { order.push(name); return []; } },
  '@tauri-apps/plugin-dialog': {},
  './library/provisionSummaryNotes': { provisionLibrarySummaries: async () => { order.push('provision'); } },
});
assert.equal(order.length, 0);
await nativeApi.listNativePapers();
assert.deepEqual(order, ['provision', 'list_papers']);
const native = readFileSync('src/platform/nativeApi.ts', 'utf8');
assert.match(native, /listNativePapers\(\)[\s\S]*?await provisionLibrarySummaries\(\);[\s\S]*?invoke<NativePaperSummary\[\]>\('list_papers'\)/);
assert.match(readFileSync('src-tauri/src/lib.rs', 'utf8'), /library_summary_provision::provision_summary_notes/);
assert.match(readFileSync('src/features/library/LibraryScene.tsx', 'utf8'), /<SummaryProvisionNotice\s*\/>/);
// Exercise the real cache module: a slow pre-provision read cannot hide the new note.
let finishRead; const slowRead = new Promise(resolve => { finishRead = resolve; });
const summaries = load('src/platform/library/summaries.ts', {
  './summaryNotes': { publishSummaryNote() {} }, '../../core/summaryNoteTemplate': template,
  '@tauri-apps/api/core': { invoke: async () => slowRead }, '../projects/textDocuments': {},
});
let changed = 0; summaries.onSummaryChange(id => { assert.equal(id, 'p'); changed++; });
const pending = summaries.loadSummary('p');
const provisioned = { path: 'summary-note://p/n', content: initial, exists: true, noteId: 'n' };
summaries.acceptProvisionedSummary('p', provisioned);
assert.equal(changed, 1); assert.equal((await summaries.loadSummary('p')).noteId, 'n');
finishRead({ path: '/legacy/总结.md', exists: false, content: '' });
assert.equal((await pending).noteId, 'n'); assert.equal((await summaries.loadSummary('p')).content, initial);
// Render the real notice with an isolated service; no desktop or library data involved.
let noticeState = { running: false, scanned: 0, created: 0, failed: 0, failures: [] };
const react = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const notice = load('src/features/library/SummaryProvisionNotice.tsx', {
  react, 'react/jsx-runtime': await import('react/jsx-runtime'), './summary-provision.css': {},
  '../../platform/library/provisionSummaryNotes': {
    summaryProvisionSnapshot: () => noticeState, subscribeSummaryProvision: () => () => {}, provisionLibrarySummaries: async () => {},
  },
});
const renderNotice = () => renderToStaticMarkup(react.createElement(notice.SummaryProvisionNotice));
assert.equal(renderNotice(), '');
noticeState = { ...noticeState, running: true, scanned: 50, created: 3 };
assert.match(renderNotice(), /role="status"/); assert.match(renderNotice(), /50/);
noticeState = { ...noticeState, running: false, failed: 1, failures: [{ paperId: 'p', message: '<script>bad</script>' }] };
assert.match(renderNotice(), /role="alert"/); assert.match(renderNotice(), /重试补齐/);
assert.doesNotMatch(renderNotice(), /<script>/); assert.match(renderNotice(), /&lt;script&gt;/);
console.log('Summary provisioning: template, batching, failures, retry, queued refresh, cache races, notifications, notice rendering and wiring passed.');
