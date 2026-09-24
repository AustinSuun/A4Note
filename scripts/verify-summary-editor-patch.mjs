import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const compile=name=>ts.transpileModule(fs.readFileSync(new URL('../src/core/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),library=data(compile('librarySummary'));
const {summaryEditorPatch:patch,replaceSummaryFieldText:edit}=await import(data(compile('summaryEditorPatch').replace(/from ['"]\.\/librarySummary['"]/g,'from '+JSON.stringify(library))));let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
for(const raw of ['a\nb\n','a\r\nb\r\n','a\r\nb\nc\r','😀\r\n后文\n'])check('normalized no-op preserves raw '+JSON.stringify(raw),()=>assert.equal(patch(raw,raw.replace(/\r\n?|\n/g,'\n')),raw));
check('middle edit keeps both surrounding mixed EOLs',()=>assert.equal(patch('a\r\nb\nc\r\n','a\nB\nc\n'),'a\r\nB\nc\r\n'));
check('insert adopts CRLF without rewriting old LF',()=>assert.equal(patch('a\r\nb\nc','a\nb\nnew\nc'),'a\r\nb\nnew\r\nc'));
check('Unicode replacement preserves suffix offsets',()=>assert.equal(patch('😀\r\n后文\n','😁\n后文\n'),'😁\r\n后文\n'));
check('deletion spans CRLF without leaving CR',()=>assert.equal(patch('a\r\nb\r\nc','ac'),'ac'));
for(const eol of ['\n','\r\n']){const block=(id,v)=>`<!-- a4-summary:${id} -->${eol}## old${eol}${v}${eol}<!-- /a4-summary:${id} -->${eol}`,source='前文'+eol+block('figure','old')+'测试1'+eol+block('dataset','data')+'后文'+eol,column={id:'figure',name:'新显示名'};
check('edit preserves free bytes and old heading '+JSON.stringify(eol),()=>assert.equal(edit(source,source,column,'new'),source.replace('old'+eol+'<!-- /','new'+eol+'<!-- /')));
check('no-op byte identical '+JSON.stringify(eol),()=>assert.equal(edit(source,source,column,'old'),source));
check('stale baseline rejected '+JSON.stringify(eol),()=>assert.throws(()=>edit(source,source+'x',column,'new')));
check('marker injection rejected '+JSON.stringify(eol),()=>assert.throws(()=>edit(source,source,column,`x${eol}<!-- /a4-summary:figure -->${eol}<!-- a4-summary:injected -->${eol}bad`)));
check('missing field needs explicit add '+JSON.stringify(eol),()=>assert.throws(()=>edit(source,source,{id:'custom',name:'新列'},'')));
check('explicit add retains entire original prefix '+JSON.stringify(eol),()=>assert.ok(edit(source,source,{id:'custom',name:'新列'},'',true).startsWith(source)));
check('metadata cannot become field '+JSON.stringify(eol),()=>assert.throws(()=>edit(source,source,{id:'venue',name:'期刊',source:'venue'},'',true)));
}
console.log(JSON.stringify({passed,scope:'Pure editing guards and LF/raw offset mapping; no persistence claims.'}));
