// Windows isolated Chromium regression; run from repo root. CHROME_PATH overrides browser.
// Real menu components and application CSS; no user profile, task service or native data.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {createServer} from 'vite';import react from '@vitejs/plugin-react';
const own=path.resolve('.tmp/reader-list');const run='reader-list-'+new Date().toISOString().replace(/[:.]/g,'-');const evidence=path.resolve('.a4-tests/reader-list',run);fs.mkdirSync(path.join(evidence,'screenshots'),{recursive:true});const profile=path.join(own,run+'-profile');const records=[],screenshots=[],errors=[];const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');const files=['src/features/reader/ReaderSceneSidebar.tsx','src/features/paper-notes.css'];const before=Object.fromEntries(files.map(f=>[f,hash(f)]));let server,chrome,ws;let seq=0;const requests=new Map();const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(ok,name,detail)=>records.push({name,passed:!!ok,...(detail===undefined?{}:{detail})});
async function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{requests.delete(id);reject(Error('CDP timeout '+method))},method==='Browser.close'?3000:method==='Page.navigate'?60000:15000);requests.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+':'+r.exceptionDetails.exception?.description);return r.result?.value;}
async function wait(expression){for(let i=0;i<40;i++){if(await ev(expression))return;await pause(200)}throw Error('Timed out '+expression)}
async function click(selector){const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing element');e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await rpc('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await pause(100)}
async function key(key,code,vk){await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,...(key==='Enter'?{text:'\r'}:{})});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});await pause(100)}
async function shot(name){const f=path.join(evidence,'screenshots',name+'.png');fs.writeFileSync(f,Buffer.from((await rpc('Page.captureScreenshot',{format:'png'})).data,'base64'));screenshots.push(f)}
try{
 fs.mkdirSync(own,{recursive:true});
 server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(own,run+'-vite-cache'),plugins:[react()],optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client']},server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/.tmp/**','**/.build/**','**/.a4-tests/**','**/src-tauri/target/**']}},logLevel:'error'});await server.listen();const addr=server.httpServer.address();
 chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});chrome.stderr.on('data',()=>{});
 for(let i=0;i<150&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await pause(100);
 const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=tabs.find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&requests.has(m.id)){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)});
  await rpc('Page.enable');await rpc('Runtime.enable');await rpc('Emulation.setDeviceMetricsOverride',{width:900,height:800,deviceScaleFactor:1,mobile:false});await rpc('Page.navigate',{url:`http://127.0.0.1:${addr.port}/tests/fixtures/reader-list.html`});await wait('!!window.resetFixture');
  const baseline=process.argv.includes('--baseline');
  for(const width of [320,220]) {
   await ev(`document.querySelector('#fixture-sidebar').style.width='${width}px'`);await pause(100);
   await shot(`${baseline?'before':'after'}-${width}`);
   const metrics=await ev(`Array.from(document.querySelectorAll('.reader-paper-expand,.scene-context-item-close')).map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height}})`);
   check(baseline||metrics.every(m=>m.width>=32&&m.height>=32),`32px targets at ${width}`,metrics);
   check(await ev(`document.querySelector('#fixture-sidebar').scrollWidth<=${width}`),`No overflow ${width}`);
  }
  await ev(`document.querySelector('#fixture-sidebar').style.width='320px'`);
  const titleVisual=()=>ev(`(()=>{const button=document.querySelector('.scene-context-item');const row=button.closest('li');const style=getComputedStyle(button);return {boxShadow:style.boxShadow,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,borderTopWidth:style.borderTopWidth,borderRightWidth:style.borderRightWidth,borderBottomWidth:style.borderBottomWidth,borderLeftWidth:style.borderLeftWidth,rowBackground:getComputedStyle(row).backgroundColor,buttonBackground:style.backgroundColor}})()`);
  const titlePoint=()=>ev(`(()=>{const e=document.querySelector('.scene-context-item');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await ev('window.resetFixture()');await pause(100);await click('.scene-context-item');
  const selectedRest=await titleVisual();
  const titleP=await titlePoint();await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...titleP});await rpc('Input.dispatchMouseEvent',{type:'mousePressed',...titleP,button:'left',clickCount:1});await pause(100);
  const selectedPressed=await titleVisual();check(baseline||(selectedPressed.boxShadow==='none'&&(selectedPressed.outlineStyle==='none'||selectedPressed.outlineWidth==='0px')&&['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].every(key=>selectedPressed[key]==='0px')),'Mouse press keeps selected title borderless',{selectedRest,selectedPressed});await shot(`${baseline?'before':'after'}-title-pressed`);
  await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',...titleP,button:'left',clickCount:1});await pause(100);
  const selectedReleased=await titleVisual();check(baseline||(selectedReleased.boxShadow==='none'&&(selectedReleased.outlineStyle==='none'||selectedReleased.outlineWidth==='0px')),'Mouse release keeps selected title borderless',selectedReleased);check(baseline||selectedReleased.rowBackground!==selectedReleased.buttonBackground,'Selected row uses one background layer',selectedReleased);await shot(`${baseline?'before':'after'}-title-selected`);
  await key('Tab','Tab',9);await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await pause(100);
  const keyboardFocus=await titleVisual();check(baseline||(await ev(`document.activeElement.classList.contains('scene-context-item')`))&&keyboardFocus.outlineStyle!=='none'&&keyboardFocus.outlineWidth!=='0px','Keyboard title focus remains visible',keyboardFocus);await shot(`${baseline?'before':'after'}-title-keyboard-focus`);
  await ev('window.resetFixture()');await pause(100);
  if(!baseline){
   check(await ev(`Array.from(document.querySelectorAll('.reader-file-type')).map(e=>e.textContent).join(',')==='PDF,Markdown,未知类型'`),'Explicit types, unknown title does not guess PDF');
   await click('.reader-paper-expand');check(await ev(`window.events.length===0&&document.querySelector('.reader-paper-expand').getAttribute('aria-expanded')==='true'`),'Expand does not select or close');await shot('expanded');
   await click('.paper-note-card');check(await ev(`window.events.length===1&&window.events[0].type==='note'`),'Note callback only');
   await ev(`document.querySelector('.reader-paper-expand').focus()`);await key('Enter','Enter',13);check(await ev(`document.querySelector('.reader-paper-expand').getAttribute('aria-expanded')==='false'`),'Enter collapses');
   await key(' ','Space',32);check(await ev(`document.querySelector('.reader-paper-expand').getAttribute('aria-expanded')==='true'`),'Space expands');await shot('focus');
   await ev('window.resetFixture()');await pause(100);await click('.scene-context-item');check(await ev(`window.events.length===1&&window.events[0].type==='select'`),'Title selects only');
   await ev('window.resetFixture()');await pause(100);await click('.scene-context-item-close');check(await ev(`window.events.length===1&&window.events[0].type==='close'&&document.querySelectorAll('.scene-context-list>li').length===2`),'Close noncurrent item only');
   await ev('window.resetFixture()');await pause(100);await click('.scene-context-list>li:nth-child(2) .scene-context-item-close');check(await ev(`window.events.length===1&&window.events[0].id==='md'`),'Close current item only');
   await ev('window.resetFixture()');await pause(100);check(await ev(`Array.from(document.querySelectorAll('.reader-file-type')).map(e=>e.textContent).join(',')==='PDF,Markdown,未知类型'`),'Reopen no stale types');
   await click('.scene-context-list>li:nth-child(2) .reader-paper-expand');check(await ev(`!!document.querySelector('.paper-notes-empty')`),'Zero-note item expands');
   await shot('empty-notes');
  }
  if(!baseline){
   await ev('window.resetFixture()');await pause(100);
   const p=await ev(`(()=>{const r=document.querySelector('.scene-context-item-close').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   const rest=await ev(`getComputedStyle(document.querySelector('.scene-context-item-close')).backgroundColor`);
   await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(100);
   check(await ev(`getComputedStyle(document.querySelector('.scene-context-item-close')).backgroundColor`)!==rest,'Visible hover background');await shot('hover');
   await rpc('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
   const closePressed=await ev(`(()=>{const s=getComputedStyle(document.querySelector('.scene-context-item-close'));return {backgroundColor:s.backgroundColor,boxShadow:s.boxShadow,outlineStyle:s.outlineStyle,borderColor:s.borderTopColor}})()`);check(closePressed.backgroundColor!==rest&&closePressed.boxShadow==='none'&&closePressed.borderColor==='rgba(0, 0, 0, 0)','Visible pressed state is background only',closePressed);await shot('pressed');
   await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
   await ev('window.resetFixture()');await pause(100);
   await ev(`document.querySelector('.scene-context-item-close').focus()`);await key('Tab','Tab',9);await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   check(await ev(`document.activeElement.classList.contains('scene-context-item-close')&&getComputedStyle(document.activeElement).outlineStyle!=='none'`),'Keyboard close focus visible');await shot('close-focus');
   await key('Enter','Enter',13);check(await ev(`window.events.length===1&&window.events[0].type==='close'`),'Keyboard close no select');
    // 3580532a: expand/close mouse feedback is background-only. Border, inset shadow and outline must stay invisible on hover, press, release with the pointer still over, after leaving and in the expanded state; keyboard focus-visible stays.
    const frameOf=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const s=getComputedStyle(e);const r=e.getBoundingClientRect();const clear=c=>c==='rgba(0, 0, 0, 0)'||c==='transparent';const widths=[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth];const colors=[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor];return {width:r.width,height:r.height,backgroundColor:s.backgroundColor,boxShadow:s.boxShadow,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,borderWidth:widths.join(' '),borderColor:colors.join(' '),ariaExpanded:e.getAttribute('aria-expanded'),hover:e.matches(':hover'),focusVisible:e.matches(':focus-visible'),frameless:s.boxShadow==='none'&&(s.outlineStyle==='none'||s.outlineWidth==='0px')&&(widths.every(w=>w==='0px')||colors.every(clear))}})()`);
    const pointOf=sel=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const away={x:800,y:700};const geometryOk=m=>!m||(Math.abs(m.width-34)<=1&&Math.abs(m.height-34)<=1);
    const sweep=async(label,sel,{release=true}={})=>{
     await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...away});await pause(100);const rest=await frameOf(sel);const p=await pointOf(sel);
     await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(100);const hover=await frameOf(sel);check(hover.hover&&hover.frameless&&hover.backgroundColor!==rest.backgroundColor,`${label}: hover shows background only`,{rest,hover});
     await rpc('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await pause(100);const pressed=await frameOf(sel);check(pressed.frameless&&pressed.backgroundColor!==rest.backgroundColor,`${label}: press shows background only`,pressed);await shot(label.replace(/\s+/g,'-').toLowerCase()+'-pressed');
     let released=null;if(release){await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await pause(150);released=await frameOf(sel);check(released.frameless&&!released.focusVisible,`${label}: released with pointer still over shows no frame`,released);await shot(label.replace(/\s+/g,'-').toLowerCase()+'-released');}
     else{await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...away,button:'left',buttons:1});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',...away,button:'left',clickCount:1});}
     await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',...away});await pause(150);const left=await frameOf(sel);check(left.frameless&&!left.focusVisible&&left.backgroundColor===rest.backgroundColor,`${label}: no residue after the pointer leaves`,left);
     check([rest,hover,pressed,released,left].every(geometryOk),`${label}: 34px geometry unchanged through the sweep`,{rest,hover,pressed,released,left});
     return {rest,hover,pressed,released,left};
    };
    await ev('window.resetFixture()');await pause(100);if(await ev(`document.querySelector('.reader-paper-expand').getAttribute('aria-expanded')==='true'`)){await click('.reader-paper-expand');await pause(100);}
    const expandSweep=await sweep('Expand chevron','.reader-paper-expand');check(expandSweep.released.ariaExpanded==='true'&&await ev(`!!document.querySelector('.paper-note-list,.paper-notes-empty')`),'Expand click still toggles the note list',expandSweep.released);
    const expandedRest=await frameOf('.reader-paper-expand');check(expandedRest.frameless&&expandedRest.ariaExpanded==='true','Expanded state is marked by the chevron only',expandedRest);await shot('expanded-rest');
    const collapseSweep=await sweep('Expanded chevron','.reader-paper-expand');check(collapseSweep.released.ariaExpanded==='false','Second click collapses without a frame',collapseSweep.released);
    await sweep('Close button','.scene-context-item-close',{release:false});
    await ev(`document.querySelector('.reader-paper-expand').focus()`);await key('Tab','Tab',9);await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await pause(100);
    const expandKeyboard=await frameOf('.reader-paper-expand');check(expandKeyboard.focusVisible&&expandKeyboard.outlineStyle!=='none'&&expandKeyboard.outlineWidth!=='0px','Keyboard expand focus stays visible after the mouse sweep',expandKeyboard);await shot('expand-keyboard-focus');
   await ev('window.resetFixture()');await pause(100);
   check(await ev(`document.querySelector('.scene-context-item').title.includes('long title.pdf')`),'Full long title tooltip retained');
   check(await ev(`Array.from(document.querySelectorAll('.reader-paper-row button')).every(e=>e.getAttribute('aria-label')||e.textContent.trim())`),'All buttons named');
  }
  check(errors.length===0,'No runtime exceptions',errors);
 }catch(e){records.push({name:'Execution failure',passed:false,error:String(e),stack:e.stack})}
finally{
 const after=Object.fromEntries(files.map(f=>[f,hash(f)]));check(JSON.stringify(before)===JSON.stringify(after),'Read-only product source hashes preserved');
 const result={at:new Date().toISOString(),scope:'actual React components in isolated headless Chrome; not whole PDF reader, native persistence or installed acceptance',run,evidence,passed:records.filter(r=>r.passed).length,failed:records.filter(r=>!r.passed).length,records,screenshots,sourceBefore:before,sourceAfter:after};fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(own,'latest-reader-list.json'),JSON.stringify({evidence,result:path.join(evidence,'result.json'),passed:result.passed,failed:result.failed},null,2));
 if(ws?.readyState===1){try{await rpc('Browser.close')}catch{}ws.close()}if(chrome&&!chrome.killed)chrome.kill();if(server)await server.close();console.log(JSON.stringify({evidence,passed:result.passed,failed:result.failed,failures:records.filter(r=>!r.passed).map(r=>({name:r.name,error:r.error}))},null,2));
}
if(records.some(r=>r.passed===false))process.exitCode=1;
