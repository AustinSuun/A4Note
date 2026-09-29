// Isolated Tauri WebView2 regression via CDP; never open production data.
// Requires dev:live --instance readerreturn --port 1438 --cdp-port 9245
// and 21 uniquely hashed Reader Return Fixture PDFs in its verified isolated library.
// The DEV guard is checked before any UI mutation; no imports/installations occur here.
import fs from 'node:fs'; import path from 'node:path';
const home=process.cwd(); const run=new Date().toISOString().replace(/[:.]/g,'-');
const dir=path.join(home,'.tmp/shots/reader-return-native',run);fs.mkdirSync(dir,{recursive:true});
const port=9245;const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page=tabs.find(t=>t.type==='page'&&t.url.includes('127.0.0.1:1438'));if(!page)throw Error('Missing isolated WebView target');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let seq=0;const pending=new Map(),errors=[],checks=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push('pageerror '+m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description??''));else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error '+m.params.args.map(a=>a.value??a.description??'').join(' '))};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
const ev=async code=>{const r=await send('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception?.description??''));return r.result?.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(code,label)=>{for(let i=0;i<60;i++){if(await ev(code))return;await pause(150)}throw Error('wait: '+label)};
const check=(name,okay,data)=>{checks.push({name,passed:!!okay,data});if(!okay)throw Error('FAIL '+name+' '+JSON.stringify(data))};
const shot=async name=>fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const snapshot=()=>ev(`(()=>{const tab=document.querySelector('.paper-table-wrap');const search=document.querySelector('.library-search-field input');return {query:search?.value,view:document.querySelector('.library-titlebar-switch')?.dataset.view,sort:[...document.querySelectorAll('.paper-table .sort-indicator.active')].map(e=>e.closest('th')?.textContent?.trim()),selected:[...document.querySelectorAll('.paper-table tbody tr.selected')].map(e=>e.querySelector('.title-cell')?.textContent?.trim()),rows:document.querySelectorAll('.paper-table tbody tr').length,scroll:tab?.scrollTop,scrollMax:tab?.scrollHeight-tab?.clientHeight,header:[...document.querySelectorAll('.paper-table thead th')].map(e=>e.textContent.trim()),tabs:[...document.querySelectorAll('.workbench-tab-frame')].length,dev:document.body.innerText.includes('DEV\\nreaderreturn · 独立测试库（原生已核验')};})()`);
try{
await send('Runtime.enable');await send('Page.enable');
if(!(await ev(`document.body.innerText.includes('DEV\\nreaderreturn · 独立测试库（原生已核验')`)))throw Error('Refusing non-isolated Tauri app');
await ev(`([...document.querySelectorAll('.workbench-tool')].find(e=>e.textContent.trim()==='文献库').click(),true)`);
await wait(`!!document.querySelector('.library-titlebar-switch')`,'initial library');
await ev(`(()=>{const sw=document.querySelector('.library-titlebar-switch');if(sw.dataset.view!=='list') [...sw.querySelectorAll('button')].find(e=>e.textContent.includes('列表')).click();return true})()`);
await wait(`!!document.querySelector('.paper-table tbody tr')`,'initial list');
await ev(`(()=>{const e=document.querySelector('.library-search-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Reader Return Fixture');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
await wait(`document.querySelectorAll('.paper-table tbody tr').length===21`,'prepared list');
const before=await snapshot();check('isolated native DEV guard and seeded list',before.dev&&before.rows>=20,before);
await ev(`(()=>{const e=document.querySelector('.library-search-field input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'Reader Return Fixture');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.paper-table th.title-col .table-sort').click();document.querySelector('.paper-table th.title-col .table-sort').click();return true})()`);
await wait(`document.querySelectorAll('.paper-table tbody tr').length===21`,'search results');
await ev(`(()=>{document.querySelector('.column-settings-trigger').click();return true})()`);
await wait(`!!document.querySelector('.column-settings-panel')`,'column popover');
const options=await ev(`[...document.querySelectorAll('.column-settings-panel label')].map(x=>x.textContent.trim())`);
if(options.some(x=>x.includes('作者')))await ev(`([...document.querySelectorAll('.column-settings-panel label')].find(x=>x.textContent.includes('作者'))?.querySelector('input')?.click(),document.querySelector('.column-settings-trigger').click(),true)`);
else await ev(`document.querySelector('.column-settings-trigger').click()`);
await ev(`(()=>{const tab=document.querySelector('.paper-table-wrap');tab.scrollTop=360;document.querySelectorAll('.paper-table tbody tr')[6].click();return true})()`);
const expected=await snapshot();check('filtered, sorted and scrolled before opening',expected.rows===21&&expected.scroll>0&&expected.selected.length===1,expected);await ev(`(window.__readerReturnFrame=document.querySelector('.workbench-tab-frame.active'),true)`);await shot('01-before-library');
await ev(`document.querySelector('.paper-table tbody tr.selected').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
await wait(`!!document.querySelector('.reader-titlebar-tools .reader-return-library')`,'reader return button');
const reader=await ev(`(()=>{const e=document.querySelector('.reader-titlebar-tools .reader-return-library'),l=document.querySelector('.reader-toolbar-primary'),r=document.querySelector('.reader-toolbar-end');const b=x=>{const q=x.getBoundingClientRect();return {left:q.left,right:q.right,top:q.top,bottom:q.bottom,width:q.width}};return {label:e.textContent,aria:e.getAttribute('aria-label'),left:b(l),button:b(e),right:b(r),url:location.href,dev:document.body.innerText.includes('DEV\\nreaderreturn · 独立测试库（原生已核验')}})()`);
check('reader source, native guard and three zones',reader.label==='文献库'&&reader.aria==='返回文献库'&&reader.dev&&reader.left.right<=reader.button.left+1&&reader.button.right<=reader.right.left+1,reader);await shot('02-reader-library-entry');
if(!(await ev(`!!document.querySelector('.workbench-tab-frame.active .reader-note-floating-controls')`)))await ev(`(document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button').click(),true)`);await pause(180);
const float=await ev(`({floating:!!document.querySelector('.workbench-tab-frame.active .reader-note-floating-controls'),returnButton:!!document.querySelector('.reader-titlebar-tools .reader-return-library')})`);
check('floating note does not hide return control',float.floating&&float.returnButton,float);await shot('02a-floating-note-reader');
await ev(`document.querySelector('.reader-titlebar-tools .reader-return-library').click()`);await wait(`!!document.querySelector('.workbench-tab-frame.active .library-scene')`,'return library');const returned=await snapshot();check('original library state and tab preserved',returned.query===expected.query&&returned.view===expected.view&&returned.scroll===expected.scroll&&returned.selected.join()===expected.selected.join()&&returned.sort.join()===expected.sort.join()&&returned.header.join()===expected.header.join()&&(await ev(`window.__readerReturnFrame===document.querySelector('.workbench-tab-frame.active')`)), {expected,returned});await shot('03-after-library');
await ev(`document.querySelector('.paper-table tbody tr.selected').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);await wait(`!!document.querySelector('.reader-titlebar-tools .reader-return-library')`,'repeat reader');
await send('Emulation.setDeviceMetricsOverride',{width:980,height:740,deviceScaleFactor:1,mobile:false});await pause(250);
const narrow=await ev(`(()=>{const n=document.querySelector('.reader-titlebar-tools'),e=n?.querySelector('.reader-return-library:not([inert] *)'),c=n?.querySelector('.reader-responsive-compact'),a=c?.querySelector('.reader-responsive-trigger')||n?.querySelector('.reader-toolbar-primary'),r=n?.querySelector('.reader-toolbar-end');return {compact:!!c,button:!!e,buttonCount:n?.querySelectorAll('.reader-return-library').length,bar:n?.getBoundingClientRect().width,leftRight:a?.getBoundingClientRect().right,buttonLeft:e?.getBoundingClientRect().left,buttonRight:e?.getBoundingClientRect().right,rightLeft:r?.getBoundingClientRect().left}})()`);
check('narrow layout has accessible non-overlapping return',narrow.button&&narrow.leftRight<=narrow.buttonLeft+1&&(narrow.compact||narrow.buttonRight<=narrow.rightLeft+1),narrow);await shot('04-narrow-reader');
await ev(`document.documentElement.style.zoom='125%'`);await pause(250);const zoomed=await ev(`!!document.querySelector('.reader-titlebar-tools .reader-return-library')`);check('zoom keeps return',zoomed);await shot('05-zoom-reader');await ev(`document.documentElement.style.zoom=''`);await send('Emulation.clearDeviceMetricsOverride');
await ev(`document.querySelector('.reader-titlebar-tools .reader-return-library:not([inert] *)').click()`);await wait(`!!document.querySelector('.workbench-tab-frame.active .library-scene')`,'repeat return');const again=await snapshot();check('repeat round trip',again.scroll===expected.scroll&&again.query===expected.query,again);await shot('06-repeat-after');
// The overview title selects and opens in the same React event; returning must keep that selection and local view.
await ev(`([...document.querySelectorAll('.library-titlebar-switch button')].find(e=>e.textContent.includes('综览')).click(),true)`);
await wait(`document.querySelector('.library-titlebar-switch')?.dataset.view==='overview'`,'overview view');
await ev(`(()=>{document.querySelector('.summary-viewport').scrollTop=120;return true})()`);await pause(150);
const overviewBefore=await ev(`(()=>({scroll:document.querySelector('.summary-viewport').scrollTop,first:document.querySelector('.summary-paper-title')?.textContent}))()`);check('overview source ready',!!overviewBefore.first,overviewBefore);await shot('07-before-overview');
await ev(`(document.querySelector('.summary-paper-title').click(),true)`);await wait(`!!document.querySelector('.reader-titlebar-tools .reader-return-library')`,'overview reader');await shot('08-overview-reader');
await ev(`(document.querySelector('.reader-titlebar-tools .reader-return-library:not([inert] *)').click(),true)`);await wait(`!!document.querySelector('.workbench-tab-frame.active .library-scene')`,'overview return');
const overviewAfter=await ev(`(()=>({view:document.querySelector('.library-titlebar-switch')?.dataset.view,scroll:document.querySelector('.summary-viewport')?.scrollTop,current:document.querySelector('.summary-row.current .summary-paper-title')?.textContent}))()`);
check('overview view, same-event selection and scroll',overviewAfter.view==='overview'&&overviewAfter.scroll===overviewBefore.scroll&&overviewAfter.current===overviewBefore.first,{overviewBefore,overviewAfter});await shot('09-after-overview');
// While the reader tab is open, the user may intentionally change library filters and selection.
await ev(`([...document.querySelectorAll('.library-titlebar-switch button')].find(e=>e.textContent.includes('列表')).click(),true)`);
await wait(`document.querySelector('.library-titlebar-switch')?.dataset.view==='list'`,'list view');
await ev(`(document.querySelector('.paper-table tbody tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
await wait(`!!document.querySelector('.reader-titlebar-tools .reader-return-library')`,'reader for live-state test');
// The library scene remains mounted under TabHost while reading. Simulate an
// in-session library update from a background contribution without navigation.
await ev(`(()=>{const e=document.querySelector('.library-search-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Reader Return Fixture 2');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
await wait(`document.querySelectorAll('.paper-table tbody tr').length>=2`,'new background search');
await ev(`(document.querySelector('.paper-table tbody tr').click(),true)`);
const changed=await snapshot();await shot('10-library-modified-while-reading');
await ev(`(document.querySelector('.reader-titlebar-tools .reader-return-library:not([inert] *)').click(),true)`);
await wait(`!!document.querySelector('.workbench-tab-frame.active .library-scene')`,'return after live edits');
const latest=await snapshot();check('latest library changes are not overwritten',latest.query===changed.query&&latest.selected.join()===changed.selected.join()&&latest.view==='list'&&latest.scroll===changed.scroll,{changed,latest});await shot('11-return-to-latest-library');
await ev(`([...document.querySelectorAll('.workbench-tool')].find(e=>e.textContent.trim()==='总览').click(),true)`);await wait(`!!document.querySelector('.workbench-tab-frame.active .overview-paper-row')`,'outside scene');
await ev(`(document.querySelector('.workbench-tab-frame.active .overview-paper-row').click(),true)`);await wait(`!!document.querySelector('.reader-titlebar-tools')`,'outside reader');
const outside=await ev(`({returnButtons:document.querySelectorAll('.reader-titlebar-tools .reader-return-library').length,dev:document.body.innerText.includes('独立测试库（原生已核验')})`);
check('overview source never shows library return',outside.returnButtons===0&&outside.dev,outside);await shot('10-other-source-no-return');
check('pageerror and console.error',errors.length===0,errors);
}catch(error){errors.push('TEST '+String(error));try{await shot('failure')}catch{}}
finally{fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({run,dir,checks,errors},null,2));ws.close();console.log(JSON.stringify({dir,checks,errors},null,2));if(errors.length||checks.some(c=>!c.passed))process.exitCode=1}
