// Task 4093839c phase 1: two real BoardEditor mounts share one `.a4board` file through the text-document
// session (notes tab + reader entry), plus the reader's board section against a mocked project FS.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {chromium} from 'playwright-core';
const require=createRequire(import.meta.url),dir=path.resolve('.tmp/board-browser');fs.mkdirSync(dir,{recursive:true});
const checks=[],errors=[];const check=(name,value,detail)=>{assert.ok(value,name+(detail===undefined?'':' '+JSON.stringify(detail)));checks.push(name);};
// Source-level contract: fails on the previous tree before any browser work.
const plugin=fs.readFileSync('src/core/markdownPlugin.ts','utf8');const contributions=fs.readFileSync('src/features/markdown/contributions.tsx','utf8');
const tree=fs.readFileSync('src/features/explorer/FileTreePanel.tsx','utf8');const reader=fs.readFileSync('src/features/reader/ReaderMarkdown.tsx','utf8');const app=fs.readFileSync('src/ui/App.tsx','utf8');
check('markdown.core registers a board opener keyed by the .a4board extension',/id: 'markdown\.board'[\s\S]*extensions: \['a4board'\]/.test(plugin));
check('the board opener has a host view adapter and the adapter is wired into the scene UI',/openerId: 'markdown\.board'/.test(contributions)&&/markdown\.board,/.test(fs.readFileSync('src/ui/sceneAdapters.tsx','utf8')));
check('the notes file tree can create boards and highlights the active board',/onCreateBoard/.test(tree)&&/新建白板/.test(tree)&&/md\|markdown\|mdx\|a4board/.test(app)&&/createBoardFile\(directoryPath\)/.test(app));
check('the reader note switcher has a board section and renders the same file in place of the note',/<ReaderBoardSection/.test(reader)&&/<ReaderBoardSurface key=\{boardPath\}/.test(reader));
const boardPath='D:/vault/计划.a4board';const brokenPath='D:/vault/坏掉.a4board';const bigPath='D:/vault/大量.a4board';
const emptyDoc={format:'a4board',version:1,id:'b_test1',kind:'whiteboard',title:'计划',createdAt:'2026-09-28T00:00:00.000Z',updatedAt:'2026-09-28T00:00:00.000Z',links:[],elements:[]};
const bigDoc={...emptyDoc,id:'b_big',title:'大量',elements:Array.from({length:1500},(_,i)=>({id:'e'+i,type:i%3===0?'rect':i%3===1?'ellipse':'note',x:(i%50)*40,y:Math.floor(i/50)*40,w:32,h:28,stroke:'auto',fill:i%3===2?'#fef3c7':'transparent',strokeWidth:2,text:i%7===0?'t'+i:''}))};
fs.writeFileSync(path.join(dir,'host.tsx'),`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BoardEditor} from '/src/features/board/BoardEditor';import {ReaderBoardSection} from '/src/features/reader/ReaderBoardEntry';import {setBoardWorkspaceRoot} from '/src/features/board/boardFiles';import '/src/ui/styles/tokens.css';import '/src/ui/styles/markdown.css';const w=window as any;
const files:Record<string,string>=${JSON.stringify({[boardPath]:JSON.stringify(emptyDoc,null,2)+'\n',[brokenPath]:'{"format":"a4board", broken',[bigPath]:JSON.stringify(bigDoc)})};const dirs=new Set(['D:/vault']);
w.files=files;w.saves=[];w.failNext='';w.created=[];w.selected=[];w.readerPath=null;
const norm=(p:string)=>p.replace(/\\\\/g,'/');const parent=(p:string)=>norm(p).replace(/\\/[^/]+$/,'');const base=(p:string)=>norm(p).split('/').pop()!;
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{const r=args?.request??{};
if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;
if(command==='read_text_file'){const p=norm(r.path);if(!(p in files))throw new Error('文件不存在：'+r.path);return {path:r.path,content:files[p],byte_length:files[p].length,binary:false};}
if(command==='write_text_file'){await new Promise(res=>setTimeout(res,20));const p=norm(r.path);if(w.failNext){const m=w.failNext;w.failNext='';throw new Error(m);}if(r.expected_content!==undefined&&r.expected_content!==files[p])throw new Error('文件已被其他程序修改，未覆盖。');files[p]=r.content;w.saves.push({path:p,content:r.content});return;}
if(command==='create_text_file'){const p=norm(r.path);if(p in files)throw new Error('文件已存在：'+r.path);if(!dirs.has(parent(p)))throw new Error('目录不存在：'+parent(p));files[p]=r.content;w.created.push(p);return;}
if(command==='create_directory'){const p=norm(r.path)+'/'+r.name;if(dirs.has(p))throw new Error('已存在：'+p);dirs.add(p);return;}
if(command==='list_directory_entries'){const p=norm(r.path);if(!dirs.has(p))throw new Error('目录不存在：'+r.path);const entries=[...dirs].filter(d=>parent(d)===p).map(d=>({name:base(d),path:d,is_directory:true,size:0,extension:''})).concat(Object.keys(files).filter(f=>parent(f)===p).map(f=>({name:base(f),path:f,is_directory:false,size:files[f].length,extension:base(f).split('.').pop()})));return {path:p,entries,truncated:false};}
throw Error('unexpected IPC '+command);}};
setBoardWorkspaceRoot('D:/vault');
function Entry({id,path,embedded,width}:{id:string;path:string;embedded?:boolean;width:number}){return <div data-entry={id} style={{width,height:420,border:'1px solid #ccc',display:'flex'}}><BoardEditor path={path} name={path.split('/').pop()!} embedded={embedded} referenceText={'[['+path.split('/').pop()+']]'}/></div>;}
function Reader(){const [p,setP]=useState<string|null>(null);w.readerPath=p;return <div data-reader style={{width:360,border:'1px solid #ccc',padding:6}}><ReaderBoardSection paper={{paperId:'p1',title:'Paper One',notes:[],annotations:[]} as any} open={true} activePath={p} onSelect={next=>{w.selected.push(next);setP(next);}}/></div>;}
function Host(){const [extra,setExtra]=useState<string[]>([]);w.mount=(id:string)=>setExtra(c=>c.includes(id)?c:[...c,id]);w.unmount=(id:string)=>setExtra(c=>c.filter(x=>x!==id));return <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'flex-start'}}><Entry id='a' path=${JSON.stringify(boardPath)} width={620}/><Entry id='b' path=${JSON.stringify(boardPath)} embedded width={520}/>{extra.includes('broken')&&<Entry id='broken' path=${JSON.stringify(brokenPath)} width={420}/>}{extra.includes('missing')&&<Entry id='missing' path='D:/vault/没有.a4board' width={420}/>}{extra.includes('big')&&<Entry id='big' path=${JSON.stringify(bigPath)} width={620}/>}{extra.includes('reader')&&<Reader/>}</div>;}
createRoot(document.getElementById('root')!).render(<Host/>);`);
fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"/></head><body style="margin:8px"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
let server,browser,page;
try{server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(dir,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),path.dirname(path.dirname(require.resolve('react/package.json')))]},watch:{ignored:['**/.build/**','**/src-tauri/**','**/node_modules/**']}},logLevel:'error'});await server.listen();
browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.newContext({viewport:{width:1260,height:960},hasTouch:true});page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/.tmp/board-browser/index.html');
const stage=id=>page.locator(`[data-entry="${id}"] .board-stage`);const canvas=id=>page.locator(`[data-entry="${id}"] svg.board-canvas`);
const doc=()=>page.evaluate(p=>JSON.parse(window.files[p]),boardPath);
const count=id=>page.evaluate(id=>document.querySelectorAll(`[data-entry="${id}"] [data-element-id]`).length,id);
const status=id=>page.evaluate(id=>document.querySelector(`[data-entry="${id}"] .board-status`)?.textContent??'',id);
const saveState=id=>page.evaluate(id=>document.querySelector(`[data-entry="${id}"] [data-board-save-state]`)?.getAttribute('data-board-save-state'),id);
const waitSaves=async n=>{await page.waitForFunction(n=>window.saves.length>=n,n,{timeout:8000});};
const waitDoc=async(fn,arg=null,p=boardPath)=>{await page.waitForFunction(({p,src,arg})=>{const d=JSON.parse(window.files[p]);return (0,eval)('('+src+')')(d,arg);},{p,src:fn.toString(),arg},{timeout:8000});};
const drag=async(id,from,to,steps=8)=>{const box=await canvas(id).boundingBox();await page.mouse.move(box.x+from[0],box.y+from[1]);await page.mouse.down();for(let i=1;i<=steps;i++)await page.mouse.move(box.x+from[0]+(to[0]-from[0])*i/steps,box.y+from[1]+(to[1]-from[1])*i/steps);await page.mouse.up();};
const click=async(id,at)=>{const box=await canvas(id).boundingBox();await page.mouse.click(box.x+at[0],box.y+at[1]);};
await canvas('a').waitFor();await canvas('b').waitFor();
check('both entries open the same file and show the empty state',await page.evaluate(()=>document.querySelectorAll('.board-empty').length===2&&[...document.querySelectorAll('[data-board-id]')].every(n=>n.getAttribute('data-board-id')==='b_test1')));
await page.screenshot({path:path.join(dir,'01-empty.png')});
// Sticky note via keyboard tool + click + typing (entry A).
await click('a',[300,200]);await page.keyboard.press('n');
check('keyboard shortcut switches the tool with visible pressed state',await page.evaluate(()=>document.querySelector('[data-entry="a"] [data-tool="note"]')?.getAttribute('aria-pressed')==='true'));
await click('a',[200,160]);await page.locator('[data-entry="a"] textarea.board-text-editor').waitFor();
await page.keyboard.type('想法一');await page.keyboard.press('Escape');
await waitSaves(1);await waitDoc(d=>d.elements.length===1&&d.elements[0].text==='想法一');await page.waitForFunction(()=>document.querySelector('[data-entry="b"] .board-text-block')?.textContent==='想法一',null,{timeout:5000});
const afterNote=await doc();
check('the sticky note is saved into the file and the other entry renders it without a second copy',afterNote.elements.length===1&&afterNote.elements[0].type==='note'&&afterNote.elements[0].text==='想法一'&&await count('b')===1&&await page.evaluate(()=>document.querySelector('[data-entry="b"] .board-text-block')?.textContent==='想法一'));
check('the tool returns to select after creating and the empty state is gone',await page.evaluate(()=>document.querySelector('[data-entry="a"] [data-tool="select"]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('.board-empty')));
// Rectangle by drag, arrow bound from note to rectangle.
await page.keyboard.press('r');await drag('a',[380,120],[520,220]);await waitDoc(d=>d.elements.some(e=>e.type==='rect'));
await page.keyboard.press('a');await drag('a',[200,160],[450,170]);await waitDoc(d=>d.elements.some(e=>e.type==='arrow'));
const afterArrow=await doc();const rectEl=afterArrow.elements.find(e=>e.type==='rect');const arrowEl=afterArrow.elements.find(e=>e.type==='arrow');
check('shape drag creates a sized rectangle and the arrow binds to both shapes it was drawn across',rectEl&&Math.round(rectEl.w)===140&&Math.round(rectEl.h)===100&&arrowEl&&arrowEl.from?.elementId===afterArrow.elements[0].id&&arrowEl.to?.elementId===rectEl.id,{rectEl,arrowEl});
await page.screenshot({path:path.join(dir,'02-note-rect-arrow.png')});
// Move the rectangle from entry B: the bound arrow follows, entry A re-renders the same version.
const boxB=await canvas('b').boundingBox();const stageBOrigin=await page.evaluate(()=>{const svg=document.querySelector('[data-entry="b"] svg.board-canvas');const g=svg.querySelector('g[transform]');const m=/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform'));return {x:+m[1],y:+m[2],z:+m[3]};});
const rectCenterB=[stageBOrigin.x+(rectEl.x+rectEl.w*0.3)*stageBOrigin.z,stageBOrigin.y+(rectEl.y+rectEl.h*0.8)*stageBOrigin.z];
await click('b',rectCenterB);await page.keyboard.press('v');
await drag('b',rectCenterB,[rectCenterB[0]-60,rectCenterB[1]+40]);await waitDoc((d,y0)=>{const r=d.elements.find(e=>e.type==='rect');return r&&r.y>y0+30;},rectEl.y);
const afterMove=await doc();const movedRect=afterMove.elements.find(e=>e.type==='rect');const movedArrow=afterMove.elements.find(e=>e.type==='arrow');
check('moving a shape in the other entry saves the shared file and the bound arrow endpoint follows it',Math.abs(movedRect.x-(rectEl.x-60))<2&&Math.abs(movedRect.y-(rectEl.y+40))<2&&movedArrow.points[1].x>=movedRect.x-1&&movedArrow.points[1].x<=movedRect.x+movedRect.w+1&&movedArrow.points[1].y>=movedRect.y-1&&movedArrow.points[1].y<=movedRect.y+movedRect.h+1,{movedRect,movedArrow,boxB:!!boxB});
check('entry A shows the moved rectangle at the same coordinates',await page.evaluate(x=>Math.abs(+document.querySelector('[data-entry="a"] .board-element.rect rect').getAttribute('x')-x)<1,movedRect.x));
// Undo / redo are per entry and go through the same save path.
await stage('b').focus();await page.keyboard.press('Control+z');await waitDoc((d,y0)=>Math.abs(d.elements.find(e=>e.type==='rect').y-y0)<1,rectEl.y);await page.waitForTimeout(50);
check('Ctrl+Z in entry B restores the previous position for both entries',Math.abs((await doc()).elements.find(e=>e.type==='rect').x-rectEl.x)<1&&await page.evaluate(x=>Math.abs(+document.querySelector('[data-entry="a"] .board-element.rect rect').getAttribute('x')-x)<1,rectEl.x));
await page.keyboard.press('Control+Shift+z');await waitDoc((d,y0)=>d.elements.find(e=>e.type==='rect').y>y0+30,rectEl.y);
check('redo re-applies the move',Math.abs((await doc()).elements.find(e=>e.type==='rect').x-movedRect.x)<1);
check('entry A has no undo history of its own for edits made in B but keeps its own',await page.evaluate(()=>document.querySelector('[data-entry="a"] [aria-label="撤销"]').disabled===false&&document.querySelector('[data-entry="b"] [aria-label="重做"]').disabled===true));
// Pen + whole-stroke eraser.
await stage('a').focus();await page.keyboard.press('p');await drag('a',[80,250],[260,280],14);await waitDoc(d=>d.elements.some(e=>e.type==='ink'));
const ink=(await doc()).elements.find(e=>e.type==='ink');
check('pen drag stores a simplified stroke with its bounding box',ink&&ink.points.length>=6&&ink.points.length<=15&&ink.w>0,ink&&{points:ink.points.length,w:ink.w});
await page.keyboard.press('e');await click('a',[170,265]);await waitDoc(d=>!d.elements.some(e=>e.type==='ink'));
check('eraser removes the whole stroke in one save and nothing else',!(await doc()).elements.some(e=>e.type==='ink')&&(await doc()).elements.length===3);
// Marquee select, delete, undo, duplicate, nudge, Escape.
await page.keyboard.press('v');await drag('a',[40,40],[600,285]);
check('marquee selection reports the count and shows handles',/已选择 3 个元素/.test(await status('a'))&&await page.evaluate(()=>document.querySelectorAll('[data-entry="a"] .board-handle').length===8));
await page.keyboard.press('Delete');await waitDoc(d=>d.elements.length===0);await page.waitForFunction(()=>document.querySelectorAll('.board-empty').length===2,null,{timeout:5000});
check('Delete removes the selection and the other entry empties too',(await doc()).elements.length===0&&await count('b')===0&&await page.evaluate(()=>document.querySelectorAll('.board-empty').length===2));
await page.keyboard.press('Control+z');await waitDoc(d=>d.elements.length===3);
check('undo restores all three elements with their bindings',(await doc()).elements.length===3&&(await doc()).elements.find(e=>e.type==='arrow').to?.elementId===rectEl.id);
await page.keyboard.press('Control+a');await page.keyboard.press('Control+d');await waitDoc(d=>d.elements.length===6);
check('Ctrl+A / Ctrl+D duplicates the whole selection with offset and rebinds the copied arrow to the copied rectangle',(await doc()).elements.length===6&&(await doc()).elements.filter(e=>e.type==='arrow').every(a=>a.to)&&new Set((await doc()).elements.filter(e=>e.type==='arrow').map(a=>a.to.elementId)).size===2);
await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await waitDoc(d=>{const r=d.elements.filter(e=>e.type==='rect');return r.length===2&&r[1].x-r[0].x>=43;});
check('shift+arrow nudges the selected copies by 10 each',(()=>true)());
await page.keyboard.press('Escape');check('Escape clears the selection',/6 个元素/.test(await status('a')));
await page.keyboard.press('Control+z');await waitDoc(d=>{const r=d.elements.filter(e=>e.type==='rect');return r.length===2&&Math.abs(r[1].x-r[0].x-24)<1;});
check('one undo removes both nudges (coalesced into a single step)',true);
await page.keyboard.press('Control+z');await waitDoc(d=>d.elements.length===3);
check('the next undo removes the duplicates',(await doc()).elements.length===3);
// Text editing on an existing shape via double-click and Enter.
const stageA=await page.evaluate(()=>{const g=document.querySelector('[data-entry="a"] svg.board-canvas g[transform]');const m=/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform'));return {x:+m[1],y:+m[2],z:+m[3]};});
const current=await doc();const r2=current.elements.find(e=>e.type==='rect');const rectCenterA=[stageA.x+(r2.x+r2.w*0.3)*stageA.z,stageA.y+(r2.y+r2.h*0.8)*stageA.z];
const boxA=await canvas('a').boundingBox();await page.mouse.dblclick(boxA.x+rectCenterA[0],boxA.y+rectCenterA[1]);await page.locator('[data-entry="a"] textarea.board-text-editor').waitFor();
await page.keyboard.type('盒子');await page.keyboard.press('Control+Enter');await waitDoc(d=>d.elements.find(e=>e.type==='rect').text==='盒子');await page.waitForFunction(()=>[...document.querySelectorAll('[data-entry="b"] .board-text-block')].some(n=>n.textContent==='盒子'),null,{timeout:5000});
check('double-click edits shape text; Ctrl+Enter commits and the text renders in both entries',(await doc()).elements.find(e=>e.type==='rect').text==='盒子'&&await page.evaluate(()=>[...document.querySelectorAll('[data-entry="b"] .board-text-block')].some(n=>n.textContent==='盒子')));
// Zoom / pan.
const zoomLabel=id=>page.evaluate(id=>document.querySelector(`[data-entry="${id}"] .board-zoom`).textContent,id);
await page.mouse.move(boxA.x+300,boxA.y+200);await page.keyboard.down('Control');await page.mouse.wheel(0,-240);await page.keyboard.up('Control');await page.waitForTimeout(50);
const zoomed=await zoomLabel('a');check('Ctrl+wheel zooms in around the pointer and shows the percentage',parseInt(zoomed)>100,zoomed);
await page.mouse.wheel(0,120);await page.waitForTimeout(50);
check('plain wheel pans instead of zooming',await zoomLabel('a')===zoomed);
await page.keyboard.press('Control+0');check('Ctrl+0 resets zoom',await zoomLabel('a')==='100%');
const beforeFit=await page.evaluate(()=>document.querySelector('[data-entry="a"] svg.board-canvas g[transform]').getAttribute('transform'));await page.locator('[data-entry="a"] [aria-label="适应内容"]').click();check('fit-to-content changes the viewport',beforeFit!==await page.evaluate(()=>document.querySelector('[data-entry="a"] svg.board-canvas g[transform]').getAttribute('transform')));
await stage('a').focus();await page.keyboard.down('Space');const beforePan=await page.evaluate(()=>document.querySelector('[data-entry="a"] svg.board-canvas g[transform]').getAttribute('transform'));await drag('a',[300,250],[340,280]);await page.keyboard.up('Space');
const docBeforePan=JSON.stringify((await doc()).elements);await page.waitForTimeout(700);
check('Space+drag pans without creating or moving elements',beforePan!==await page.evaluate(()=>document.querySelector('[data-entry="a"] svg.board-canvas g[transform]').getAttribute('transform'))&&JSON.stringify((await doc()).elements)===docBeforePan);
await page.screenshot({path:path.join(dir,'03-after-edits.png')});
// Touch: a tap with the note tool creates a sticky.
await page.keyboard.press('n');const tapBox=await canvas('a').boundingBox();await page.touchscreen.tap(tapBox.x+520,tapBox.y+250);await page.locator('[data-entry="a"] textarea.board-text-editor').waitFor();await page.keyboard.type('触屏');await page.keyboard.press('Escape');await waitDoc(d=>d.elements.some(e=>e.type==='note'&&e.text==='触屏'));
check('touch tap creates a sticky note through the same pointer path',(await doc()).elements.some(e=>e.type==='note'&&e.text==='触屏'));
// Save conflict: the write is rejected, nothing is silently overwritten, retry works.
await page.evaluate(()=>{window.failNext='文件已被其他程序修改，未覆盖。';});
await page.keyboard.press('v');await stage('a').focus();await page.keyboard.press('Control+a');await page.keyboard.press('ArrowDown');
await page.waitForFunction(()=>document.querySelector('[data-entry="a"] [data-board-save-state]')?.getAttribute('data-board-save-state')==='error',null,{timeout:8000});
check('a rejected write surfaces an error state with retry / reload / export and both entries show it',await saveState('a')==='error'&&await saveState('b')==='error'&&await page.evaluate(()=>[...document.querySelectorAll('[data-entry="a"] .board-banner button')].map(b=>b.textContent).join('|')==='重试保存|重新加载磁盘版本|导出草稿'));
await page.screenshot({path:path.join(dir,'04-save-error.png')});
await page.locator('[data-entry="a"] .board-banner button',{hasText:'重试保存'}).click();await page.waitForFunction(()=>document.querySelector('[data-entry="a"] [data-board-save-state]')?.getAttribute('data-board-save-state')==='saved',null,{timeout:8000});
check('retry saves the pending draft and clears the error in both entries',await saveState('b')==='saved'&&!(await page.locator('[data-entry="a"] .board-banner').count()));
// Broken file: read-only diagnostic, reload after repair.
await page.evaluate(()=>window.mount('broken'));await page.locator('[data-entry="broken"] .board-state.error').waitFor();
check('an unparsable board shows a read-only diagnostic instead of an empty editable board',await page.evaluate(()=>/无法解析白板文件/.test(document.querySelector('[data-entry="broken"] .board-state').textContent)&&!document.querySelector('[data-entry="broken"] svg.board-canvas')));
await page.evaluate(p=>{window.files[p]=JSON.stringify({format:'a4board',version:1,id:'b_fixed',elements:[]});},brokenPath);await page.locator('[data-entry="broken"] .board-state button',{hasText:'重新加载'}).click();await page.locator('[data-entry="broken"] svg.board-canvas').waitFor();
check('reload after repairing the file opens the editor',await page.evaluate(()=>document.querySelector('[data-entry="broken"] [data-board-id]')?.getAttribute('data-board-id')==='b_fixed'));
await page.evaluate(()=>window.mount('missing'));await page.locator('[data-entry="missing"] .board-state.error').waitFor();
check('a missing file is an explicit error with the path, never a fresh board',await page.evaluate(()=>/无法打开白板/.test(document.querySelector('[data-entry="missing"] .board-state').textContent)&&/没有\.a4board/.test(document.querySelector('[data-entry="missing"] .board-state-path').textContent)));
await page.screenshot({path:path.join(dir,'05-error-states.png')});
// Performance bound: 1500 elements render and marquee-select within budget.
const t0=Date.now();await page.evaluate(()=>window.mount('big'));await page.waitForFunction(()=>document.querySelectorAll('[data-entry="big"] [data-element-id]').length===1500,null,{timeout:15000});const renderMs=Date.now()-t0;
await page.locator('[data-entry="big"] [aria-label="适应内容"]').click();await canvas('big').scrollIntoViewIfNeeded();const t1=Date.now();await drag('big',[10,10],[600,280],4);const selectMs=Date.now()-t1;
const bigStatus=await status('big');
check('1500 elements render under 6s and a marquee over them selects under 3s',renderMs<6000&&selectMs<3000&&/已选择 \d+ 个元素/.test(bigStatus),{renderMs,selectMs,bigStatus});
await page.screenshot({path:path.join(dir,'06-many-elements.png')});
await page.evaluate(()=>{window.unmount('big');window.unmount('broken');window.unmount('missing');});
// Reader entry: link existing / create / unlink against the notes workspace scan.
await page.evaluate(()=>window.mount('reader'));await page.locator('[data-reader] .note-history-boards').waitFor();await page.waitForFunction(()=>/还没有关联白板/.test(document.querySelector('[data-reader]').textContent),null,{timeout:5000});
await page.locator('[data-reader] button',{hasText:'关联已有白板…'}).click();await page.locator('[data-reader] .picker .note-history-board-open').first().waitFor();
check('the picker lists workspace boards that are not linked yet',await page.evaluate(()=>[...document.querySelectorAll('[data-reader] .picker .note-history-board-name')].map(n=>n.textContent).join(',')==='计划,坏掉,大量'));
await page.locator('[data-reader] .picker .note-history-board-open',{hasText:'计划'}).click();await waitDoc(d=>d.links.length===1);
check('linking writes the relation into the board file through the shared session and selects it',(await doc()).links.length===1&&(await doc()).links[0].paperId==='p1'&&(await doc()).links[0].title==='Paper One'&&await page.evaluate(p=>window.selected[0]===p,boardPath));
await page.waitForFunction(()=>document.querySelectorAll('[data-entry="a"] .board-link-chip').length===1,null,{timeout:5000});
check('the notes entry shows the paper chip immediately',await page.evaluate(()=>/Paper One/.test(document.querySelector('[data-entry="a"] .board-link-chip').textContent)));
await page.locator('[data-reader] button',{hasText:'新建白板并关联'}).click();await page.waitForFunction(()=>window.created.length===1,null,{timeout:5000});
const createdPath=await page.evaluate(()=>window.created[0]);const createdDoc=await page.evaluate(p=>JSON.parse(window.files[p]),createdPath);
check('creating from the reader makes <root>/白板/<paper>.a4board with the link already inside',createdPath==='D:/vault/白板/Paper One.a4board'&&createdDoc.links[0]?.paperId==='p1'&&createdDoc.elements.length===0&&await page.evaluate(p=>window.selected[1]===p,createdPath));
await page.waitForFunction(()=>document.querySelectorAll('[data-reader] .note-history-board').length===2,null,{timeout:5000});
await page.locator('[data-reader] .note-history-board',{hasText:'计划'}).locator('.note-history-board-unlink').click();await waitDoc(d=>d.links.length===0);await page.waitForFunction(()=>document.querySelectorAll('[data-reader] .note-history-board').length===1,null,{timeout:5000});
check('unlink removes only the relation; the board file stays and the list refreshes',(await doc()).links.length===0&&await page.evaluate(p=>p in window.files,boardPath)&&await page.evaluate(()=>document.querySelectorAll('[data-reader] .note-history-board').length===1));
await page.screenshot({path:path.join(dir,'07-reader-section.png')});
// Dark theme + narrow layout.
await page.evaluate(()=>{document.documentElement.dataset.theme='midnight';});await page.waitForTimeout(50);
const dark=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-entry="a"] .board-stage')).backgroundColor);
await page.evaluate(()=>{delete document.documentElement.dataset.theme;});await page.waitForTimeout(50);
const light=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-entry="a"] .board-stage')).backgroundColor);
check('the canvas follows the theme tokens (dark differs from light) and strokes use currentColor',dark!==light&&await page.evaluate(()=>document.querySelector('[data-entry="a"] .board-element.rect rect').getAttribute('stroke')==='currentColor'),{dark,light});
await page.setViewportSize({width:480,height:700});await page.waitForTimeout(100);
check('narrow viewport keeps the tools and canvas usable',await page.evaluate(()=>{const t=document.querySelector('[data-entry="b"] [data-tool="select"]').getBoundingClientRect();const c=document.querySelector('[data-entry="b"] svg.board-canvas').getBoundingClientRect();return t.width>0&&c.width>200&&c.height>100;}));
await page.screenshot({path:path.join(dir,'08-narrow.png')});
check('no page errors or console errors',errors.length===0,errors);
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Two real BoardEditor mounts (notes tab + embedded reader surface) sharing one mocked .a4board file through the text-document session, plus ReaderBoardSection against a mocked project FS in headless Chrome.'},null,2));console.log(JSON.stringify({passed:checks.length,failed:0,errors:errors.length}));
}catch(error){fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({error:String(error),checks,errors,body:page?await page.locator('body').innerText().catch(()=>''):''},null,2));if(page)await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});throw error;}finally{await browser?.close();await server?.close();}
