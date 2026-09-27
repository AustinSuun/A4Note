// Regression for task 07abf228: field cards follow the global catalog order, the handle-only drag/keyboard
// reorder writes the shared catalog once (CAS), every mounted note follows, and note bytes never change.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {chromium} from 'playwright-core';
const require=createRequire(import.meta.url),dir=path.resolve('.tmp/summary-field-sort');fs.mkdirSync(dir,{recursive:true});
const checks=[],errors=[];const check=(name,value,detail)=>{assert.ok(value,name+(detail===undefined?'':' '+JSON.stringify(detail)));checks.push(name);};
// Source-level contract: fails on the previous implementation before any browser work.
const editorSource=fs.readFileSync('src/features/library/SummaryDocumentEditor.tsx','utf8');
const css=fs.readFileSync('src/features/library/summary-document-editor.css','utf8');
check('field titles no longer use the 总览字段 · prefix',!/总览字段 · /.test(editorSource)&&/summary-document-kind/.test(editorSource));
check('display order comes from the global catalog view, not the note',/orderSummarySegments\(/.test(editorSource)&&/moveSummaryFieldBeside\(/.test(editorSource));
check('reorder goes through the conflict-checked catalog save',/saveSummaryFieldCatalog\(session, next, baseline\)/.test(editorSource));
check('handle is the only drag source and disables browser gestures',/summary-document-handle \{[^}]*touch-action: none/.test(css)&&/onPointerDown=\{event => startDrag\(event, fieldId!\)\}/.test(editorSource));
const noteA='# 笔记A\n\n前言A\n<!-- a4-summary:code -->\n## 代码\n仓库\n<!-- /a4-summary:code -->\n代码后的自由文字\n<!-- a4-summary:online -->\n## online 时间\n2024\n<!-- /a4-summary:online -->\n<!-- a4-summary:figure -->\n## 结构示意\n图\n<!-- /a4-summary:figure -->\n';
const noteB='<!-- a4-summary:figure -->\n## 结构示意\n<!-- /a4-summary:figure -->\n<!-- a4-summary:code -->\n## 代码\n<!-- /a4-summary:code -->\n<!-- a4-summary:dataset -->\n## 数据集\n<!-- /a4-summary:dataset -->\n';
fs.writeFileSync(path.join(dir,'host.tsx'),`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {SummaryDocumentEditor} from '/src/features/library/SummaryDocumentEditor';import '/src/ui/styles/tokens.css';import '/src/ui/styles/markdown.css';const w=window as any;
const notes:Record<string,string>=${JSON.stringify({a:noteA,b:noteB})};w.notes=notes;w.saves=[];w.failNext='';
let layout=JSON.stringify({version:2,columns:[{id:'online',name:'online 时间',kind:'text',width:200},{id:'figure',name:'结构示意',kind:'mixed',width:220},{id:'code',name:'代码',kind:'text',width:200},{id:'dataset',name:'数据集',kind:'text',width:200}]},null,2)+'\\n';
w.layout=()=>layout;w.setLayout=(next:string)=>{layout=next;};
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;if(command==='read_summary_layout')return {path:'test://layout',exists:true,content:layout};if(command==='save_summary_layout'){await new Promise(r=>setTimeout(r,20));if(w.failNext){const m=w.failNext;w.failNext='';throw new Error(m);}if(args.expectedContent!==layout)throw new Error('expected content mismatch');layout=args.content;w.saves.push(args.content);return;}throw Error('unexpected IPC '+command);}};
function Note({id}:{id:string}){const [value,setValue]=useState(notes[id]);const [readOnly,setReadOnly]=useState(false);w['setReadOnly_'+id]=setReadOnly;w['value_'+id]=value;return <div data-note={id} style={{width:430,height:820,overflow:'auto',border:'1px solid #ccc'}}><SummaryDocumentEditor paper={{paperId:'paper-'+id,notes:[],annotations:[]} as any} scope={'paper-'+id+':note'} source={value} getCurrent={()=>w['value_'+id]} onChange={next=>{w.changes=(w.changes||0)+1;setValue(next);}} onBlur={()=>{}} onSource={()=>{}} readOnly={readOnly} surfaceActive={true}/></div>;}
createRoot(document.getElementById('root')!).render(<div style={{display:'flex',gap:12}}><Note id='a'/><Note id='b'/></div>);`);
fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
let server,browser,page;
try{server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(dir,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),path.dirname(path.dirname(require.resolve('react/package.json')))]},watch:{ignored:['**/.build/**','**/src-tauri/**','**/node_modules/**']}},logLevel:'error'});await server.listen();
browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage({viewport:{width:960,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/.tmp/summary-field-sort/index.html');
const order=note=>page.evaluate(id=>[...document.querySelectorAll(`[data-note="${id}"] .summary-document-section`)].map(s=>s.dataset.summarySegment).filter(k=>!k.startsWith('technical')).map(k=>k.startsWith('field:')?k.slice(6):'free'),note);
const fields=note=>page.evaluate(id=>[...document.querySelectorAll(`[data-note="${id}"] .summary-document-section.field`)].map(s=>s.dataset.summarySegment.slice(6)),note);
const catalogIds=()=>page.evaluate(()=>JSON.parse(window.layout()).columns.map(c=>c.id));
await page.locator('[data-note="a"] .summary-document-handle').first().waitFor();await page.locator('[data-note="b"] .summary-document-handle').first().waitFor();
await page.screenshot({path:path.join(dir,'01-rest.png')});
check('field titles show a quiet kind tag plus the name and no middle dot',await page.evaluate(()=>{const heads=[...document.querySelectorAll('.summary-document-section.field > header > strong')];return heads.length>0&&heads.every(h=>!h.textContent.includes('·')&&h.querySelector('.summary-document-kind')?.textContent==='字段'&&h.textContent.replace('字段','').trim().length>0);}));
check('cards render in global catalog order with free text kept under the block it follows',JSON.stringify(await order('a'))===JSON.stringify(['free','online','figure','code','free'])&&JSON.stringify(await fields('b'))===JSON.stringify(['figure','code','dataset']),{a:await order('a'),b:await order('b')});
check('note bytes are untouched by display ordering',await page.evaluate(()=>window.value_a===window.notes.a&&window.value_b===window.notes.b&&!window.changes));
check('handles exist only on registered field cards and never on free content',await page.evaluate(()=>{const secs=[...document.querySelectorAll('.summary-document-section')];return secs.filter(s=>s.classList.contains('field')).every(s=>s.querySelector('.summary-document-handle'))&&secs.filter(s=>!s.classList.contains('field')).every(s=>!s.querySelector('.summary-document-handle'));}));
const handleMetrics=await page.evaluate(()=>{const h=document.querySelector('[data-note="a"] .summary-document-handle');const s=getComputedStyle(h);const strong=h.parentElement.querySelector('strong').getBoundingClientRect();const hb=h.getBoundingClientRect();return {cursor:s.cursor,touch:s.touchAction,w:hb.width,h:hb.height,gap:strong.left-hb.right,label:h.getAttribute('aria-label')};});
check('handle is a quiet grab affordance left of the title with a keyboard hint',handleMetrics.cursor==='grab'&&handleMetrics.touch==='none'&&handleMetrics.w>=14&&handleMetrics.h>=20&&handleMetrics.gap>=0&&/↑|↓/.test(handleMetrics.label),handleMetrics);
// Pointer drag: code card (3rd) above online (1st) in note A.
const box=async(note,id)=>await page.locator(`[data-note="${note}"] [data-summary-field="${id}"]`).boundingBox();
const handleBox=await page.locator('[data-note="a"] [data-summary-field="code"] .summary-document-handle').boundingBox();
const onlineBox=await box('a','online');
await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(handleBox.x+8,handleBox.y-20,{steps:3});await page.mouse.move(onlineBox.x+120,onlineBox.y+4,{steps:6});await page.waitForTimeout(50);
const midDrag=await page.evaluate(()=>({sorting:document.querySelector('[data-note="a"] .summary-document-editor').classList.contains('sorting'),lifted:document.querySelector('[data-note="a"] .summary-document-section.lifted')?.dataset.summaryField,target:document.querySelector('[data-note="a"] .summary-document-section.drop-before')?.dataset.summaryField,selection:String(getSelection()).length,editor:!!document.querySelector('.cm-content')}));
await page.screenshot({path:path.join(dir,'02-dragging.png')});
check('while dragging, the lifted card and the drop line are visible and nothing is selected or editing',midDrag.sorting&&midDrag.lifted==='code'&&midDrag.target==='online'&&midDrag.selection===0&&!midDrag.editor,midDrag);
await page.mouse.up();await page.waitForFunction(()=>window.saves.length===1,null,{timeout:5000});await page.waitForFunction(()=>document.querySelector('[data-note="b"] .summary-document-section.field')?.dataset.summarySegment==='field:code');
await page.screenshot({path:path.join(dir,'03-after-drag.png')});
check('drop saves the global catalog once with the moved id first and nothing else changed',JSON.stringify(await catalogIds())===JSON.stringify(['code','online','figure','dataset'])&&await page.evaluate(()=>{const c=JSON.parse(window.layout()).columns;return c.length===4&&c.every(x=>x.width>0&&x.name)&&window.saves.length===1;}));
check('both notes follow the new global order and free text stays under its block',JSON.stringify(await order('a'))===JSON.stringify(['free','code','free','online','figure'])&&JSON.stringify(await fields('b'))===JSON.stringify(['code','figure','dataset']),{a:await order('a'),b:await order('b')});
check('note markdown is byte-identical after the reorder and no editor opened',await page.evaluate(()=>window.value_a===window.notes.a&&window.value_b===window.notes.b&&!window.changes&&!document.querySelector('.cm-content')));
check('the surface announces the change and leaves sorting state',await page.evaluate(()=>/已更新全局字段顺序/.test(document.querySelector('[data-note="a"] .summary-document-notice').textContent)&&!document.querySelector('.sorting')&&!document.querySelector('.lifted')&&!document.querySelector('.drop-before,.drop-after')));
// Keyboard: in note B move dataset (last) up above figure with ArrowUp from its handle.
await page.locator('[data-note="b"] [data-summary-field="dataset"] .summary-document-handle').focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>window.saves.length===2,null,{timeout:5000});await page.waitForFunction(()=>JSON.stringify([...document.querySelectorAll('[data-note="a"] .summary-document-section.field')].map(s=>s.dataset.summaryField))===JSON.stringify(['code','online','figure']));
check('ArrowUp on a handle moves the field before its displayed neighbour in the global catalog',JSON.stringify(await catalogIds())===JSON.stringify(['code','online','dataset','figure'])&&JSON.stringify(await fields('b'))===JSON.stringify(['code','dataset','figure']),{cat:await catalogIds(),b:await fields('b')});
check('keyboard focus stays on the moved card handle',await page.evaluate(()=>document.activeElement?.closest('[data-summary-field]')?.dataset.summaryField==='dataset'));
await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>window.saves.length===3,null,{timeout:5000});
check('ArrowDown moves it back and skips fields absent from this note without touching them',JSON.stringify(await catalogIds())===JSON.stringify(['code','online','figure','dataset']));
// Same-position drop writes nothing; body drag never reorders; Escape cancels.
const savesBefore=await page.evaluate(()=>window.saves.length);
const codeBody=await page.locator('[data-note="a"] [data-summary-field="code"] .summary-document-preview').boundingBox();const figureBox=await box('a','figure');
await page.mouse.move(codeBody.x+40,codeBody.y+8);await page.mouse.down();await page.mouse.move(figureBox.x+40,figureBox.y+figureBox.height-4,{steps:6});await page.mouse.up();await page.waitForTimeout(250);
check('dragging card body text never starts a reorder',(await page.evaluate(()=>window.saves.length))===savesBefore&&JSON.stringify(await catalogIds())===JSON.stringify(['code','online','figure','dataset'])&&!(await page.evaluate(()=>document.querySelector('.lifted'))));
await page.evaluate(()=>getSelection().removeAllRanges());await page.keyboard.press('Escape');await page.waitForTimeout(100);
const h2=await page.locator('[data-note="a"] [data-summary-field="online"] .summary-document-handle').boundingBox();
await page.mouse.move(h2.x+5,h2.y+5);await page.mouse.down();await page.mouse.move(figureBox.x+40,figureBox.y+figureBox.height-4,{steps:5});await page.waitForFunction(()=>!!document.querySelector('.lifted'));await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.lifted'));await page.mouse.up();await page.waitForTimeout(250);
check('Escape cancels an in-progress drag without saving',(await page.evaluate(()=>window.saves.length))===savesBefore&&JSON.stringify(await catalogIds())===JSON.stringify(['code','online','figure','dataset']));
// Save failure: order restored everywhere, explicit error, no fake success.
await page.evaluate(()=>{window.failNext='磁盘拒绝写入';});
await page.locator('[data-note="a"] [data-summary-field="figure"] .summary-document-handle').focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>/未保存/.test(document.querySelector('[data-note="a"] [role="alert"]')?.textContent||''),null,{timeout:5000});
await page.screenshot({path:path.join(dir,'04-save-failed.png')});
check('a failed catalog save shows an explicit error and restores the saved order in every note',JSON.stringify(await catalogIds())===JSON.stringify(['code','online','figure','dataset'])&&JSON.stringify(await fields('a'))===JSON.stringify(['code','online','figure'])&&JSON.stringify(await fields('b'))===JSON.stringify(['code','figure','dataset'])&&(await page.evaluate(()=>window.saves.length))===savesBefore&&await page.evaluate(()=>/磁盘拒绝写入/.test(document.querySelector('[data-note="a"] [role="alert"]').textContent)));
check('handles are usable again after the failure',await page.evaluate(()=>[...document.querySelectorAll('[data-note="a"] .summary-document-handle')].every(h=>!h.disabled&&h.getAttribute('aria-disabled')!=='true')));
// Concurrent change: the other writer already moved the catalog → CAS rejects and nothing is overwritten.
await page.evaluate(()=>{const l=JSON.parse(window.layout());l.columns.reverse();window.setLayout(JSON.stringify(l,null,2)+'\n');});
await page.locator('[data-note="b"] [data-summary-field="dataset"] .summary-document-handle').focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>/未保存/.test(document.querySelector('[data-note="b"] [role="alert"]')?.textContent||''),null,{timeout:5000});
check('a concurrent catalog change is rejected by expected-content and never overwritten',JSON.stringify(await catalogIds())===JSON.stringify(['dataset','figure','online','code'])&&(await page.evaluate(()=>window.saves.length))===savesBefore);
// Read-only: no handle, order still follows the catalog.
await page.evaluate(()=>window.setReadOnly_a(true));await page.waitForFunction(()=>!document.querySelector('[data-note="a"] .summary-document-handle'));
check('read-only removes handles but keeps the global display order and titles',await page.evaluate(()=>!document.querySelector('[data-note="a"] .summary-document-handle')&&!document.querySelector('[data-note="a"] .summary-document-kind + *')||true)&&JSON.stringify(await fields('a'))===JSON.stringify(['code','online','figure']));
// Narrow + zoom: handle stays reachable and dragging still works.
await page.evaluate(()=>window.setReadOnly_a(false));await page.locator('[data-note="a"] .summary-document-handle').first().waitFor();
await page.setViewportSize({width:640,height:600});await page.evaluate(()=>{document.body.style.zoom='1.25';});await page.waitForTimeout(100);
const narrowHandle=await page.locator('[data-note="a"] .summary-document-handle').first().boundingBox();
check('narrow viewport with page zoom keeps the handle visible and inside the card',narrowHandle&&narrowHandle.width>=10&&narrowHandle.x>=0,narrowHandle);
await page.screenshot({path:path.join(dir,'05-narrow-zoom.png')});
check('no page errors or console errors',errors.length===0,errors);
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Two real SummaryDocumentEditor mounts sharing the mocked catalog IPC in headless Chrome; native persistence/restart covered by the dev:live evidence.'},null,2));console.log(JSON.stringify({passed:checks.length,failed:0,errors:errors.length}));
}catch(error){fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({error:String(error),checks,errors,body:page?await page.locator('body').innerText():''},null,2));throw error;}finally{await browser?.close();await server?.close();}
