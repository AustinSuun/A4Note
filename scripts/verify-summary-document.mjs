import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = name => ts.transpileModule(fs.readFileSync(new URL('../src/core/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const libraryUrl = data(compile('librarySummary'));
const lib = await import(libraryUrl);
const model = await import(data(compile('summaryDocument').replace(/from ['"]\.\/librarySummary['"]/g, 'from ' + JSON.stringify(libraryUrl))));
let passed = 0;
const check = (name, work) => { work(); passed++; console.log('PASS ' + name); };
const block = (id, title, value = '', eol = '\n') => `<!-- a4-summary:${id} -->${eol}## ${title}${eol}${value}${eol}<!-- /a4-summary:${id} -->${eol}`;
const figure = { id: 'figure', name: '结构' }, options = { scope: 'summary-note://paper-a/note-a', mode: 'fill-empty', createIfMissing: false };
for (const eol of ['\n', '\r\n']) {
  const source = '\ufeff# 总结笔记' + eol + '前置自由段落。' + eol + block('figure', '旧展示名', '', eol) + '测试1' + eol + '![自由图片](summary-assets/free.png)' + eol + block('evaluation', '评估', '保留数据 🚀', eol) + '结尾自由内容  ' + eol;
  const doc = model.summaryDocument(source), fields = lib.summaryFields(source), from = source.indexOf('测试1');
  const select = { from, to: from + 3, text: '测试1' };
  check('lossless interval roundtrip ' + JSON.stringify(eol), () => assert.equal(doc.segments.map(s => source.slice(s.start, s.end)).join(''), source));
  check('free/field order preserved ' + JSON.stringify(eol), () => assert.deepEqual(doc.segments.map(s => s.kind), ['free', 'field', 'free', 'field', 'free']));
  check('legacy public field shape unchanged ' + JSON.stringify(eol), () => assert.deepEqual(Object.keys(fields.get('figure')).sort(), ['end', 'id', 'start', 'value']));
  check('outside text never inferred into figure ' + JSON.stringify(eol), () => assert.equal(fields.get('figure').value, ''));
  check('free image is not assigned to any field ' + JSON.stringify(eol), () => assert.ok([...fields.values()].every(s => !s.value.includes('free.png'))));
  check('unchanged free edit is byte identical ' + JSON.stringify(eol), () => assert.equal(model.replaceSummaryFreeText(doc, source, doc.segments[0].key, doc.segments[0].value), source));
  check('free edit preserves complete field blocks ' + JSON.stringify(eol), () => { const next = model.replaceSummaryFreeText(doc, source, doc.segments[4].key, '修改后的结尾' + eol); assert.ok(next.startsWith(source.slice(0, doc.segments[4].start))); assert.equal(lib.summaryFields(next).get('evaluation').value, '保留数据 🚀'); });
  const plan = model.planSummaryAssignment(doc, select, figure, options);
  check('planning never changes source ' + JSON.stringify(eol), () => assert.equal(doc.source, source));
  check('confirmed selection enters exact stable ID ' + JSON.stringify(eol), () => assert.equal(lib.summaryFields(plan.next).get('figure').value, '测试1'));
  check('successful proposal removes only selected free text ' + JSON.stringify(eol), () => assert.equal(model.summaryDocument(plan.next).segments.filter(s => s.kind === 'free').map(s => s.value).join(''), doc.segments.filter(s => s.kind === 'free').map(s => s.value).join('').replace('测试1', '')));
  check('other field and raw legacy heading survive ' + JSON.stringify(eol), () => { assert.ok(plan.next.includes(block('evaluation', '评估', '保留数据 🚀', eol))); assert.ok(plan.next.includes('## 旧展示名' + eol)); });
  check('confirmation rejects changed source ' + JSON.stringify(eol), () => assert.throws(() => model.confirmedSummaryAssignment(plan, source + 'other edit', options.scope)));
  check('confirmation returns preview exactly ' + JSON.stringify(eol), () => assert.equal(model.confirmedSummaryAssignment(plan, source, options.scope), plan.next));
  check('stale free edits rejected ' + JSON.stringify(eol), () => assert.throws(() => model.replaceSummaryFreeText(doc, source + 'x', doc.segments[0].key, '改')));
  check('no source-map marker injection through free edit ' + JSON.stringify(eol), () => assert.throws(() => model.replaceSummaryFreeText(doc, source, doc.segments[4].key, block('injected', '注入', 'x', eol))));
  check('no selection across field boundary ' + JSON.stringify(eol), () => assert.throws(() => model.planSummaryAssignment(doc, { from: 0, to: from + 3, text: source.slice(0, from + 3) }, figure, options)));
  check('existing field content requires append confirmation ' + JSON.stringify(eol), () => assert.throws(() => model.planSummaryAssignment(doc, select, { id: 'evaluation', name: '评估' }, options)));
  check('append never overwrites target ' + JSON.stringify(eol), () => { const moved = model.planSummaryAssignment(doc, select, { id: 'evaluation', name: '新展示名' }, { ...options, mode: 'append' }); assert.equal(lib.summaryFields(moved.next).get('evaluation').value, '保留数据 🚀' + eol + eol + '测试1'); });
  check('absent field requires explicit create ' + JSON.stringify(eol), () => assert.throws(() => model.planSummaryAssignment(doc, select, { id: 'custom_a', name: '自定义' }, options)));
  check('explicit creation affects proposal only ' + JSON.stringify(eol), () => { const plan = model.planSummaryAssignment(doc, select, { id: 'custom_a', name: '自定义' }, { ...options, createIfMissing: true }); assert.equal(plan.createsField, true); assert.equal(lib.summaryFields(plan.next).get('custom_a').value, '测试1'); assert.equal(lib.summaryFields(source).has('custom_a'), false); });
}
check('empty note has usable empty free region', () => assert.deepEqual(model.summaryDocument('').segments.map(s => s.value), ['']));
check('headings do not create fields', () => assert.equal(model.summaryDocument('## 结构\n自由正文').segments[0].kind, 'free'));
for (const fence of ['```', '~~~~']) check('fenced marker examples remain free ' + fence, () => { const source = fence + '\n' + block('figure', '结构') + '<!-- a4-summary:invalid id -->\n' + fence + '\n'; assert.equal(lib.summaryFields(source).size, 0); assert.equal(model.summaryDocument(source).segments[0].value, source); });
for (const malformed of ['<!-- a4-summary:figure -->\nmissing end', '<!-- /a4-summary:figure -->\n', '<!-- a4-summary:bad id -->\n', ' <!-- a4-summary:figure -->\n', '<!-- a4-summary:figure\n', block('figure', '结构') + block('figure', '重复'), '<!-- a4-summary:figure -->\n' + block('evaluation', '嵌套') + '<!-- /a4-summary:figure -->\n']) check('malformed markers fail closed ' + malformed.slice(0, 35), () => assert.throws(() => model.summaryDocument(malformed)));
check('UTF-16 surrogate splitting rejected', () => { const source = '🚀文本\n', doc = model.summaryDocument(source); assert.throws(() => model.planSummaryAssignment(doc, { from: 1, to: 3, text: source.slice(1, 3) }, figure, { ...options, createIfMissing: true })); });
check('CRLF splitting rejected', () => { const source = '正文\r\n末尾', doc = model.summaryDocument(source); assert.throws(() => model.planSummaryAssignment(doc, { from: 3, to: 6, text: source.slice(3, 6) }, figure, { ...options, createIfMissing: true })); });
check('full Unicode selection preserved', () => { const source = '🚀文本\n', plan = model.planSummaryAssignment(model.summaryDocument(source), { from: 0, to: 4, text: '🚀文本' }, figure, { ...options, createIfMissing: true }); assert.equal(lib.summaryFields(plan.next).get('figure').value, '🚀文本'); });
check('metadata column cannot receive assignment', () => { const source = '文字'; assert.throws(() => model.planSummaryAssignment(model.summaryDocument(source), { from: 0, to: 2, text: source }, { id: 'venue', name: '来源', source: 'venue' }, { ...options, createIfMissing: true })); });
check('stale selected text rejected', () => assert.throws(() => model.planSummaryAssignment(model.summaryDocument('文字'), { from: 0, to: 2, text: '别字' }, figure, { ...options, createIfMissing: true })));
check('unclosed free fence cannot swallow fields', () => { const source = '前言\n' + block('figure', '结构'); const doc = model.summaryDocument(source); assert.throws(() => model.replaceSummaryFreeText(doc, source, doc.segments[0].key, '```\n')); });
check('same content in another paper cannot accept proposal', () => {
  const source = '文字', plan = model.planSummaryAssignment(model.summaryDocument(source), { from: 0, to: 2, text: source }, figure, { ...options, createIfMissing: true });
  assert.throws(() => model.confirmedSummaryAssignment(plan, source, 'summary-note://paper-b/note-a'));
});
check('same paper but another note cannot accept proposal', () => {
  const source = '文字', plan = model.planSummaryAssignment(model.summaryDocument(source), { from: 0, to: 2, text: source }, figure, { ...options, createIfMissing: true });
  assert.throws(() => model.confirmedSummaryAssignment(plan, source, 'summary-note://paper-a/note-b'));
});
check('proposal requires explicit source identity', () => assert.throws(() => model.planSummaryAssignment(model.summaryDocument('文字'), { from: 0, to: 2, text: '文字' }, figure, { ...options, scope: '', createIfMissing: true })));
for (const eol of ['\n', '\r\n']) {
  const instruction = '此笔记的字段与论文总览同步。请保留 a4-summary 字段标记；可在字段外自由写作。';
  const source = '# 总结笔记' + eol + eol + instruction + eol + '前置自由段落。' + eol + block('figure', '结构', '', eol) + '测试1' + eol;
  const doc = model.summaryDocument(source), technical = doc.segments.find(s => s.kind === 'technical');
  check('legacy instruction has lossless hidden interval ' + JSON.stringify(eol), () => { assert.ok(technical); assert.equal(doc.segments.map(s => source.slice(s.start, s.end)).join(''), source); assert.ok(!doc.segments.filter(s => s.kind !== 'technical').map(s => s.value).join('').includes(instruction)); });
  check('technical preamble cannot be assigned as free text ' + JSON.stringify(eol), () => assert.throws(() => model.planSummaryAssignment(doc, { from: technical.start, to: technical.end, text: technical.value }, figure, options)));
  check('editing adjacent prose preserves hidden raw bytes ' + JSON.stringify(eol), () => { const free = doc.segments.find(s => s.kind === 'free' && s.value.includes('前置自由')); const next = model.replaceSummaryFreeText(doc, source, free.key, free.value + '新增' + eol); assert.ok(next.includes(instruction + eol)); assert.equal(lib.summaryFields(next).get('figure').value, ''); });
  check('instruction in fenced or changed user prose is not hidden ' + JSON.stringify(eol), () => { for (const text of ['# 总结笔记' + eol + eol + '```' + eol + instruction + eol + '```' + eol, '# 总结笔记' + eol + eol + instruction + ' 用户补充' + eol]) assert.ok(!model.summaryDocument(text + block('figure', '结构', '', eol)).segments.some(s => s.kind === 'technical')); });
}
console.log(JSON.stringify({ passed, failed: 0, scope: 'Pure lossless model and preview proposals; no actual saves or UI confirmation tested.' }));
