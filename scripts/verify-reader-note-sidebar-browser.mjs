import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const root=process.cwd();
const hostDir=path.join(root,'.tmp','reader-note-sidebar-browser');
const evidence=path.join(root,'.tmp','shots','reader-note-sidebar',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(hostDir,{recursive:true}); fs.mkdirSync(evidence,{recursive:true});
fs.writeFileSync(path.join(hostDir,'index.html'),'<div id="root"></div><script type="module" src="./host.tsx"></script>');
fs.writeFileSync(path.join(hostDir,'mock-summaries.ts'),`export async function loadSummary(){return {noteId:'note-2'}};export async function editSummary(){};export async function createSummaryNote(){return {noteId:'note-2',title:'总览笔记',content:'# 总览'}};`);
fs.writeFileSync(path.join(hostDir,'mock-sessions.ts'),`
const sessions=new Map();
export function existingLibraryNoteSession(paperId,noteId){return sessions.get(paperId+':'+noteId)}
export function acquireLibraryNoteSession(paperId,note,writer,fallback){const key=paperId+':'+(note?.id||'draft');if(sessions.has(key))return sessions.get(key);let snap={noteId:note?.id||'draft',title:note?.title||fallback,content:note?.content||'',status:'saved',error:''};const listeners=new Set();let save=writer;const emit=()=>listeners.forEach(x=>x());const api={subscribe(cb){listeners.add(cb);return()=>listeners.delete(cb)},getSnapshot(){return snap},setWriter(w){save=w},update(title,content){snap={...snap,title,content,status:'dirty'};emit()},async flush(){if(snap.status==='dirty'){snap={...snap,status:'saving'};emit();await save({id:snap.noteId,title:snap.title,content:snap.content});snap={...snap,status:'saved'};emit()}},async discard(){}};sessions.set(key,api);return api}`);
fs.writeFileSync(path.join(hostDir,'host.tsx'),`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MarkdownNotePanel}from'/src/features/reader/ReaderMarkdown';
import'/src/ui/styles/tokens.css';import'/src/ui/styles/reader.css';
const initial=Array.from({length:12},(_,i)=>({id:'note-'+(i+1),title:i===0?'阅读笔记 2':i===11?'一个非常长的中文 English document title '+i:'论文文档 '+(i+1),content:'# 文档 '+(i+1)+'\\n\\n@annotation(a-'+i+')',updatedAt:new Date().toISOString()}));
function App(){const[notes,setNotes]=useState(initial);const paper={paperId:'paper-a',title:'Paper',notes,annotations:[]};return <aside className="reader-workspace-drawer notes-active" style={{width:360,height:680}}><div className="workspace-panel-content"><div className="reader-retained-note"><MarkdownNotePanel paper={paper} draftPatch={null} onDraftPatchConsumed={()=>{}} onSave={async n=>setNotes(x=>x.map(v=>v.id===n.id?{...v,...n}:v))} onCreateNote={async()=>{const id='note-'+(notes.length+1);setNotes(x=>[...x,{id,title:'阅读笔记 '+(x.length+1),content:''}]);return id}} onNavigateAnnotation={()=>{}}/></div></div></aside>};createRoot(document.getElementById('root')).render(<App/>);`);
let server,browser;const errors=[];
try{server=await createServer({configFile:false,root,cacheDir:path.join(hostDir,'cache'),optimizeDeps:{entries:['.tmp/reader-note-sidebar-browser/index.html']},plugins:[react()],resolve:{alias:[{find:path.resolve(root,'src/platform/library/summaries.ts'),replacement:path.join(hostDir,'mock-summaries.ts')},{find:path.resolve(root,'src/platform/library/noteDocuments.ts'),replacement:path.join(hostDir,'mock-sessions.ts')}]},server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});await server.listen();
 const url=`http://127.0.0.1:${server.config.server.port}/.tmp/reader-note-sidebar-browser/index.html`;browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:720,height:760}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())});await page.goto(url);await page.waitForSelector('.note-document-trigger');
 const initialMetrics=await page.evaluate(()=>({workspaceHeader:!!document.querySelector('.reader-workspace-header'),titleInput:!!document.querySelector('.note-title-input'),meta:!!document.querySelector('.note-meta-row'),trigger:document.querySelector('.note-document-trigger')?.textContent}));
 await page.click('.note-document-trigger');await page.waitForSelector('.note-history-popover');const count=await page.locator('[role="option"]').count();
 await page.keyboard.press('End');const endFocused=await page.evaluate(()=>document.activeElement?.textContent?.includes('一个非常长的中文'));
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.classList.contains('note-document-trigger'));const focusRestored=await page.evaluate(()=>document.activeElement?.classList.contains('note-document-trigger'));
 await page.click('.note-document-trigger');await page.getByText('重命名当前文档',{exact:true}).click();await page.fill('#reader-note-rename','重命名后的阅读笔记');await page.locator('.note-history-rename button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.note-document-trigger')?.textContent?.includes('重命名后的阅读笔记'));
 await page.click('.note-document-trigger');await page.getByText('新建文档',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.note-document-trigger')?.textContent?.includes('阅读笔记 13'));
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.zoom='1.25'});await page.screenshot({path:path.join(evidence,'reader-note-sidebar-dark-125.png'),fullPage:true});
 const result={initialMetrics,count,endFocused,focusRestored,created:await page.locator('.note-document-trigger').textContent(),errors};fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));if(initialMetrics.workspaceHeader||initialMetrics.titleInput||initialMetrics.meta||count!==12||!endFocused||!focusRestored||errors.length)throw Error(JSON.stringify(result));console.log(JSON.stringify({passed:true,evidence,result},null,2));
}finally{await browser?.close();await server?.close();}
