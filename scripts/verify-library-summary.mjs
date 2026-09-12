import { fitSummaryWidths, summarySizing } from '../src/core/librarySummary.ts';
import assert from 'node:assert/strict';
import { summaryRowHeight, summaryPaperMetadata, summaryFields, updateSummaryField, parseSummaryLayout, defaultSummaryColumns, summaryExcerpt } from '../src/core/librarySummary.ts';
import { TextDocumentSession } from '../src/core/textDocumentSession.ts';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
const field = { id: 'abstract', name: '主要功能' };
await test('default columns move metadata below title; optional source fields retained', () => { assert.deepEqual(defaultSummaryColumns.filter(c=>!c.hidden).map(c=>c.name), ['主要功能','代码','数据集','结构','评估与指标','备注']); });
await test('unmanaged Markdown and unknown frontmatter survive first cell edit', () => { const original='\uFEFF---\r\nunknown: keep\r\n---\r\n# 我的自由段落\r\ntext\r\n'; const next=updateSummaryField(original,field,'新内容😀'); assert.ok(next.startsWith(original)); assert.equal(summaryFields(next).get(field.id).value,'新内容😀'); });
await test('cell replacement preserves every byte outside its field body', () => { const source=updateSummaryField('# 总结\n',field,'old')+'\n## 私有段落\nkeep\n'; const span=summaryFields(source).get(field.id); const next=updateSummaryField(source,field,'new\n\nparagraph'); assert.equal(next,source.slice(0,span.start)+'new\n\nparagraph\n'+source.slice(span.end)); });
await test('column rename reuses identity instead of duplicating data', () => { const first=updateSummaryField('',field,'first'); const next=updateSummaryField(first,{...field,name:'新列名'},'second'); assert.equal(summaryFields(next).size,1); assert.equal(summaryFields(next).get(field.id).value,'second'); });
await test('custom fields and image links roundtrip as normal Markdown', () => { const f={id:'custom-123',name:'结构图'}; const body='编码器 → 输出\n\n![图](summary-assets/a.png)'; assert.equal(summaryFields(updateSummaryField('',f,body)).get(f.id).value,body); });
await test('fenced examples cannot terminate an owned field', () => { const value='```md\n<!-- /a4-summary:abstract -->\n```\n正文'; assert.equal(summaryFields(updateSummaryField('',field,value)).get(field.id).value,value); });
await test('missing heading does not swallow a fenced code block', () => { const md='<!-- a4-summary:abstract -->\n```\ncode\n```\n## this is content\n<!-- /a4-summary:abstract -->\n'; assert.equal(summaryFields(md).get(field.id).value,'```\ncode\n```\n## this is content'); });
await test('ambiguous nested or duplicate markers fail closed', () => { const first=updateSummaryField('',field,'a'); assert.throws(()=>summaryFields(first+first)); assert.throws(()=>summaryFields('<!-- a4-summary:abstract -->\nmissing')); assert.throws(()=>updateSummaryField(first,field,'<!-- a4-summary:evil -->')); });
await test('note reference stores only identity rather than source body', () => { const value='[阅读笔记](a4note-note:n1)'; assert.equal(summaryFields(updateSummaryField('',{id:'note',name:'关联笔记'},value)).get('note').value,value); });
await test('column layout preserves unknown root and column properties', () => { const text=JSON.stringify({version:1,customRoot:'keep',columns:[{...defaultSummaryColumns[0],customColumn:'keep'}]}); const state=parseSummaryLayout(text); assert.equal(state.raw.customRoot,'keep'); assert.equal(state.columns[0].customColumn,'keep'); });
await test('bad settings are rejected rather than silently overwritten', () => { assert.throws(()=>parseSummaryLayout('{')); assert.throws(()=>parseSummaryLayout('{"version":3,"columns":[]}')); assert.throws(()=>parseSummaryLayout(JSON.stringify({version:1,columns:[defaultSummaryColumns[0],defaultSummaryColumns[0]]}))); });
await test('compact excerpt is bounded and replaces image markup', () => { assert.ok(summaryExcerpt('x'.repeat(10000),40).length<=80); assert.equal(summaryExcerpt('![image](summary-assets/a.png)',60),'〔图片〕'); });
await test('shared session drains edits that arrive during native save', async () => { let release; const writes=[]; const session=new TextDocumentSession('file','old',{draft(){},async write(_path,content,expected){writes.push([content,expected]); if(writes.length===1)await new Promise(r=>release=r);}});session.update('first');const saving=session.flush();await Promise.resolve();session.update('second');release();await saving;assert.deepEqual(writes,[['first','old'],['second','first']]);assert.equal(session.dirty(),false); });
await test('failed conflict retains draft and expected version; explicit discard does not write', async () => { let calls=0;const session=new TextDocumentSession('file','old',{draft(){},async write(){calls++;throw Error('conflict');}});session.update('draft');await assert.rejects(session.flush());assert.equal(session.getSnapshot().content,'draft');assert.equal(session.getSnapshot().baseline,'old');session.reload('external');assert.equal(session.dirty(),false);assert.equal(calls,1); });
await test('v1 layout migration hides metadata without deleting fields or custom settings', () => { const columns=defaultSummaryColumns.map(c=>({...c,hidden:false})); const state=parseSummaryLayout(JSON.stringify({version:1,columns,unknown:'keep'})); assert.equal(state.raw.version,2); assert.equal(state.raw.unknown,'keep'); assert.equal(state.columns.find(c=>c.id==='online').hidden,true); assert.equal(state.columns.find(c=>c.id==='venue').source,'venue'); assert.equal(state.columns.find(c=>c.id==='abstract').hidden,false); });
await test('v2 layout still permits optional independent metadata columns', () => { const state=parseSummaryLayout(JSON.stringify({version:2,columns:[{...defaultSummaryColumns[0],hidden:false}]})); assert.equal(state.columns[0].hidden,false); });
await test('appending into an unclosed fenced block is refused, not falsely reported as a saved cell', () => { assert.throws(()=>updateSummaryField('# 总结\n```md\nexisting',field,'new')); });
await test('source paper metadata is available without any summary document', () => {
  assert.deepEqual(summaryPaperMetadata({title:' 已有论文 ',year:2024,venue:' NeurIPS '}),{title:'已有论文',year:'2024',venue:'NeurIPS'});
});
await test('missing metadata is not invented or confused with online date', () => {
  assert.deepEqual(summaryPaperMetadata({title:'Paper',year:'',venue:''}),{title:'Paper',year:'',venue:''});
  assert.equal(summaryPaperMetadata({title:'Paper',year:NaN,venue:''}).year,'');
});
await test('metadata projection follows edits without changing user summary fields', () => {
  const paper={title:'Paper',year:2023,venue:'Journal'};
  const md=updateSummaryField('',field,'My research notes');
  summaryPaperMetadata(paper);paper.year=2025;paper.venue='Conference';
  assert.equal(summaryPaperMetadata(paper).year,'2025');assert.equal(summaryPaperMetadata(paper).venue,'Conference');
  assert.equal(summaryFields(md).get(field.id).value,'My research notes');
});
await test('readable metadata and titles fit compact row heights', () => { assert.equal(summaryRowHeight(40),44); assert.equal(summaryRowHeight(60),68); assert.ok(summaryRowHeight(100)>=128); assert.ok(summaryRowHeight(130)>=250); });

await test('window fit honors bounds, total width and leaves saved widths unchanged', () => {
 const desired=[280,210,130,160,220,195,150], before=[...desired];
 const result=fitSummaryWidths(1200,desired); assert.equal(result.reduce((a,b)=>a+b,0),1200); assert.deepEqual(desired,before);
 assert.ok(result.every((w,i)=>w>=(i===0?180:80)&&w<=800));
 assert.deepEqual(fitSummaryWidths(300,desired),[180,80,80,80,80,80,80]);
 assert.deepEqual(fitSummaryWidths(9999,[280,200]),[800,800]); assert.deepEqual(fitSummaryWidths(0,[]),[]);
});
await test('column sizing metadata is backward-compatible and bounded',()=>{
 assert.deepEqual(summarySizing({}),{mode:'manual',titleWidth:280});
 assert.deepEqual(summarySizing({sizing:{mode:'window',titleWidth:50}}),{mode:'window',titleWidth:180});
 assert.deepEqual(summarySizing({sizing:{mode:'invalid',titleWidth:900}}),{mode:'manual',titleWidth:800});
 const layout=parseSummaryLayout(JSON.stringify({version:2,columns:defaultSummaryColumns,sizing:{mode:'window',titleWidth:330},private:'keep'}));
 assert.equal(summarySizing(layout.raw).titleWidth,330);assert.equal(layout.raw.private,'keep');
});
console.log(`Library summary core: ${passed} checks passed`);
