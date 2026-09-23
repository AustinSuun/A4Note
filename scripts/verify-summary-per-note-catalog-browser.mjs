import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url), dir = path.resolve('.tmp/summary-per-note-catalog');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'host.tsx'), `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SummaryDocumentEditor} from '/src/features/library/SummaryDocumentEditor';
import {LibraryOverview} from '/src/features/library/LibraryOverview';
import {summaryLayoutSession} from '/src/platform/library/summaries';
import {saveSummaryFieldCatalog} from '/src/platform/library/summaryFieldCatalog';
import {updateSummaryField,parseSummaryLayout} from '/src/core/librarySummary';
import {addSummaryField} from '/src/core/summaryFieldCatalog';
import '/src/ui/styles/tokens.css';
const w=window as any;
w.initial='前文\\r\\n<!-- a4-summary:figure -->\\r\\n## 原标题\\r\\n原文\\r\\n<!-- /a4-summary:figure -->\\r\\n自由末尾  ';
w.disk=JSON.stringify({version:2,columns:[{id:'figure',name:'结构示意',kind:'mixed',width:233}],rowHeights:{untouched:157},future:{keep:true}});w.writes=[];w.changes=[];w.fail=false;w.parentKeys=0;
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command,args)=>{
if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;
if(command==='read_summary_layout')return {path:'test://per-note-layout',exists:true,content:w.disk};
if(command==='save_summary_layout'){w.writes.push(args);if(w.fail)throw Error('injected catalog failure');if(args.expectedContent!==w.disk)throw Error('native CAS conflict');w.disk=args.content;return;}
throw Error('unexpected IPC '+command);}};
w.conflict=async()=>{const session=await summaryLayoutSession(),base=parseSummaryLayout(session.getSnapshot().content);const external=addSummaryField(base.columns,'external','外部字段');session.update(JSON.stringify({...base.raw,columns:external}));try{await saveSummaryFieldCatalog(session,addSummaryField(base.columns,'stale','过期字段'),base.columns);return false;}catch(e){return String(e).includes('列设置已变化')&&parseSummaryLayout(session.getSnapshot().content).columns.some(c=>c.id==='external');}};
w.expected=(column)=>updateSummaryField(w.initial,column,'');
function Host(){const [value,setValue]=useState(w.initial),[readOnly,setReadOnly]=useState(false);w.value=value;return <div onKeyDown={()=>w.parentKeys++}><button onClick={()=>setReadOnly(v=>!v)}>切换只读</button><div style={{display:'flex',height:580}}><SummaryDocumentEditor paper={{paperId:'fixture',notes:[],annotations:[]} as any} scope='fixture:note' source={value} getCurrent={()=>w.value} onChange={v=>{w.changes.push(v);setValue(v);}} onBlur={()=>{}} onSource={()=>{}} readOnly={readOnly}/></div><LibraryOverview papers={[]} selectedIds={[]} onSelect={()=>{}} onSelection={()=>{}} onOpen={()=>{}}/></div>;}createRoot(document.getElementById('root')!).render(<Host/>);
`);
fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
let server, browser, page;const checks=[],errors=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try {
 server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(dir,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),path.dirname(path.dirname(require.resolve('react/package.json')))]},watch:{ignored:['**/.build/**','**/src-tauri/**','**/node_modules/**']}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage({viewport:{width:1300,height:1050}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/.tmp/summary-per-note-catalog/index.html');const trigger=page.getByRole('button',{name:'新建或管理字段',exact:true});await trigger.click();let dialog=page.locator('dialog[open]');
 await dialog.getByLabel('新字段名称',{exact:true}).fill('取消字段');await dialog.getByRole('button',{name:'添加到目录',exact:true}).click();await page.keyboard.press('Escape');
 check('cancel does not save catalog or edit note and restores trigger focus',await page.evaluate(()=>window.writes.length===0&&window.changes.length===0&&document.activeElement?.textContent==='新建或管理字段'));
 await trigger.click();dialog=page.locator('dialog[open]');await dialog.getByLabel('新字段名称',{exact:true}).fill('结构示意');await dialog.getByRole('button',{name:'添加到目录',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'同名字段'}).waitFor();check('duplicate labels rejected before any write',await page.evaluate(()=>window.writes.length===0));
 await dialog.getByLabel('新字段名称',{exact:true}).fill('本篇自定义');await dialog.getByRole('button',{name:'添加到目录',exact:true}).click();await page.evaluate(()=>window.fail=true);await dialog.getByRole('button',{name:'保存字段目录',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'injected catalog failure'}).waitFor();
 check('catalog save failure retains dialog and original note',await page.evaluate(()=>window.value===window.initial&&window.changes.length===0&&document.querySelector('dialog[open] fieldset')?.disabled));
 const failed=await page.evaluate(()=>JSON.parse(window.writes[0].content).columns.at(-1));await page.evaluate(()=>{window.fail=false;window.parentKeys=0;});await page.keyboard.press('Control+s');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 check('retry keeps stable ID and native CAS baseline, preserves layout extras',await page.evaluate(f=>{const l=JSON.parse(window.disk);return l.columns.at(-1).id===f.id&&window.writes[0].expectedContent===window.writes[1].expectedContent&&l.rowHeights.untouched===157&&l.future.keep&&l.columns[0].width===233;},failed));
 check('catalog shortcut stays inside dialog instead of saving parent note',await page.evaluate(()=>window.parentKeys===0&&window.changes.length===0));
 await page.locator('.summary-grid-head').getByText('本篇自定义',{exact:true}).waitFor();checks.push('mounted overview reflects catalog changes from note without reopening');
 check('successful creation selects new ID without writing any note',await page.getByLabel('添加已有字段',{exact:true}).inputValue()===failed.id&&await page.evaluate(()=>window.value===window.initial));
 await page.getByRole('button',{name:'添加到本篇',exact:true}).click();await page.waitForFunction(id=>window.value.includes('a4-summary:'+id),failed.id);
 check('only explicit add patches current note, preserving original mixed EOL and free bytes',await page.evaluate(f=>window.value===window.expected(f)&&window.changes.length===1,failed));
 await page.getByRole('button',{name:'切换只读',exact:true}).click();check('read-only cannot open custom-field controls',await trigger.count()===0);
 check('stale catalog proposal cannot overwrite another surface',await page.evaluate(()=>window.conflict()));
 check('no page errors',errors.length===0);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Real editor, field dialog, overview, catalog helper and text session; mocked native CAS IO.'},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
} catch(error) {fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({error:String(error),checks,errors,body:page?await page.locator('body').innerText():''},null,2));throw error;} finally {await browser?.close();await server?.close();}
