// Task 07abf228: global field order is a pure view over parsed notes plus a catalog-only move.
// Fails on the previous tree because src/core/summaryFieldOrder.ts does not exist there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = name => ts.transpileModule(fs.readFileSync(new URL('../src/core/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const rewrite = (source, map) => source.replace(/from ['"]\.\/([A-Za-z]+)['"]/g, (m, name) => map[name] ? 'from ' + JSON.stringify(map[name]) : m);
const libraryUrl = data(compile('librarySummary'));
const catalogUrl = data(rewrite(compile('summaryFieldCatalog'), { librarySummary: libraryUrl }));
const documentUrl = data(rewrite(compile('summaryDocument'), { librarySummary: libraryUrl }));
const orderUrl = data(rewrite(compile('summaryFieldOrder'), { librarySummary: libraryUrl, summaryDocument: documentUrl, summaryFieldCatalog: catalogUrl }));
const { summaryDocument } = await import(documentUrl);
const { orderSummarySegments, visibleSummaryFieldIds, moveSummaryFieldBeside, sameSummaryFieldOrder } = await import(orderUrl);
let passed = 0;
const check = (name, work) => { work(); passed++; console.log('PASS ' + name); };
const block = (id, title, value = '') => `<!-- a4-summary:${id} -->\n## ${title}\n${value}\n<!-- /a4-summary:${id} -->\n`;
const col = (id, name) => ({ id, name, kind: 'mixed', width: 200 });
const catalog = [col('online', 'online 时间'), col('feature', '主要功能'), col('code', '代码'), col('dataset', '数据集')];
const source = '前言\n' + block('code', '代码', '仓库') + '代码后的自由文字\n' + block('online', 'online 时间', '2024') + block('mystery', '未登记') + '结尾\n';
const doc = summaryDocument(source);
const ids = segments => segments.map(s => s.kind === 'field' ? s.id : s.kind === 'free' ? 'free:' + s.value.trim() : 'tech').filter(x => x !== 'tech');

check('display order follows the catalog and keeps free text under the block it was written after', () => {
  assert.deepEqual(ids(orderSummarySegments(doc.segments, catalog)), ['free:前言', 'online', 'code', 'free:代码后的自由文字', 'mystery', 'free:结尾']);
});
check('ordering is a pure view: same segment objects, source untouched, document order retrievable', () => {
  const ordered = orderSummarySegments(doc.segments, catalog);
  for (const segment of ordered) assert.ok(doc.segments.includes(segment));
  assert.equal(doc.source, source);
  assert.deepEqual([...ordered].sort((a, b) => a.start - b.start).map(s => s.key), doc.segments.map(s => s.key));
});
check('unregistered fields keep document order after registered ones; empty catalog keeps document order', () => {
  assert.deepEqual(ids(orderSummarySegments(doc.segments, [])), ['free:前言', 'code', 'free:代码后的自由文字', 'online', 'mystery', 'free:结尾']);
  const two = summaryDocument(block('b', 'B') + block('a', 'A'));
  assert.deepEqual(ids(orderSummarySegments(two.segments, [col('zzz', 'z')])), ['b', 'a']);
});
check('visible field ids list only catalog fields present in this note, in display order', () => {
  assert.deepEqual(visibleSummaryFieldIds(doc.segments, catalog), ['online', 'code']);
  assert.deepEqual(visibleSummaryFieldIds(summaryDocument('只有自由内容').segments, catalog), []);
});
check('moving beside a neighbour changes only the catalog order', () => {
  const next = moveSummaryFieldBeside(catalog, 'code', 'online', 'before');
  assert.deepEqual(next.map(c => c.id), ['code', 'online', 'feature', 'dataset']);
  assert.deepEqual(next.find(c => c.id === 'code'), catalog.find(c => c.id === 'code'));
  assert.deepEqual(moveSummaryFieldBeside(catalog, 'online', 'code', 'after').map(c => c.id), ['feature', 'code', 'online', 'dataset']);
  assert.deepEqual(moveSummaryFieldBeside(catalog, 'online', 'dataset', 'after').map(c => c.id), ['feature', 'code', 'dataset', 'online']);
  assert.deepEqual(moveSummaryFieldBeside(catalog, 'dataset', 'online', 'before').map(c => c.id), ['dataset', 'online', 'feature', 'code']);
  assert.deepEqual(catalog.map(c => c.id), ['online', 'feature', 'code', 'dataset']);
});
check('a move onto the current position is reported as a no-op so nothing is saved', () => {
  assert.ok(sameSummaryFieldOrder(catalog, moveSummaryFieldBeside(catalog, 'feature', 'online', 'after')));
  assert.ok(sameSummaryFieldOrder(catalog, moveSummaryFieldBeside(catalog, 'feature', 'code', 'before')));
  assert.ok(sameSummaryFieldOrder(catalog, moveSummaryFieldBeside(catalog, 'feature', 'feature', 'before')));
  assert.ok(!sameSummaryFieldOrder(catalog, moveSummaryFieldBeside(catalog, 'feature', 'code', 'after')));
});
check('fields missing from the catalog cannot be moved', () => {
  assert.throws(() => moveSummaryFieldBeside(catalog, 'mystery', 'online', 'before'), /不在目录/);
  assert.throws(() => moveSummaryFieldBeside(catalog, 'online', 'mystery', 'before'), /不在目录/);
});
check('cross-note consistency: two notes with different subsets render the same relative order', () => {
  const noteA = summaryDocument(block('dataset', 'D') + block('online', 'O') + block('code', 'C'));
  const noteB = summaryDocument(block('code', 'C') + block('feature', 'F'));
  const next = moveSummaryFieldBeside(catalog, 'code', 'online', 'before');
  assert.deepEqual(visibleSummaryFieldIds(noteA.segments, next), ['code', 'online', 'dataset']);
  assert.deepEqual(visibleSummaryFieldIds(noteB.segments, next), ['code', 'feature']);
  assert.equal(noteA.source.indexOf('a4-summary:dataset') < noteA.source.indexOf('a4-summary:code'), true);
});
console.log(JSON.stringify({ passed, failed: 0, scope: 'Pure ordering and catalog move; no IPC, DOM or note mutation.' }));
