// Isolated native WebView2 note motion evidence. Requires the readermotion dev:live instance.
// Captures frozen transition frames (0/40/80/120/160/220 ms) for direct comparison.
import fs from 'node:fs'; import path from 'node:path';
const label=process.argv[2] || 'before', port=9246;
const dir=path.resolve('.tmp/shots/reader-note-motion-native',label); fs.mkdirSync(dir,{recursive:true});
const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page=tabs.find(t=>t.type==='page'&&t.url.includes('127.0.0.1:1439'));
if(!page) throw Error('Isolated WebView target missing');
const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let seq=0;const pending=new Map(),errors=[],measurements=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result)}else if(m.method==='Runtime.exceptionThrown') errors.push('pageerror '+m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error '+m.params.args.map(x=>x.value??x.description??'').join(' '))};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception?.description??''));return r.result?.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async (expr,name)=>{for(let i=0;i<90;i++){if(await ev(expr))return;await pause(120)}throw Error('timeout '+name)};
const shot=async name=>fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const SNAP_EXPR=`(()=>{const s=document.querySelector('.workbench-tab-frame.active .reader-workspace-shell');if(!s)return null;const d=s.querySelector(':scope > .reader-workspace-drawer'),pdf=s.querySelector('.reader-main-workspace'),controls=s.querySelector(':scope > .reader-note-floating-controls');const b=x=>{if(!x)return null;const r=x.getBoundingClientRect();return {x:+r.x.toFixed(2),y:+r.y.toFixed(2),w:+r.width.toFixed(2),h:+r.height.toFixed(2),opacity:getComputedStyle(x).opacity,transform:getComputedStyle(x).transform}};return {phase:s.dataset.notePresence,mode:s.dataset.noteMode,visualMode:s.dataset.noteMotionMode,track:getComputedStyle(s).gridTemplateColumns,drawer:b(d),pdf:b(pdf),controls:b(controls),active:document.activeElement?.className,animations:document.getAnimations().filter(a=>a.transitionProperty&&a.effect?.target?.closest?.('.reader-workspace-shell')).map(a=>({property:a.transitionProperty,time:a.currentTime,playState:a.playState}))}})()`;const snapshot=()=>ev(SNAP_EXPR);
const click=selector=>ev(`(document.querySelector(${JSON.stringify(selector)}).click(),true)`);
let problem=null;
try {
 await send('Runtime.enable'); await send('Page.enable');
 await wait(`document.body.innerText.includes('DEV\\nreadermotion · 独立测试库（原生已核验')`,'DEV guard');
 await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
 await wait(`!!document.querySelector('.workbench-tab-frame.active .paper-table tbody tr')`,'isolated fixture papers');
 await ev(`(document.querySelector('.workbench-tab-frame.active .paper-table tbody tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
 await wait(`!!document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button')`,'reader');
 await send('Emulation.setDeviceMetricsOverride',{width:1800,height:900,deviceScaleFactor:1,mobile:false});await pause(500);
 if((await snapshot())?.phase!=='hidden'){await click('.workbench-tab-frame.active .reader-note-workbench-button');await wait("document.querySelector('.workbench-tab-frame.active .reader-workspace-shell')?.dataset.notePresence==='hidden'",'reset note');await pause(300)}
 measurements.push({case:'before-menu',...await snapshot()});await shot('00-before');
 // Open the mode menu from the handle, choose docked split, and freeze every animation at a known time.
 await ev(`(()=>{const b=document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button');b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true})()`);
 await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitem"]')`,'mode menu');
 measurements.push({case:'before-select',...await snapshot()});const frame=await ev(`(async()=>{const s=document.querySelector('.workbench-tab-frame.active .reader-workspace-shell');const item=[...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(x=>x.textContent.includes('边读边记'));item.click();const log=[];for(let i=0;i<20;i++){const a=document.getAnimations().find(x=>x.transitionProperty==='grid-template-columns'&&x.effect?.target===s);log.push({i,phase:s.dataset.notePresence,mode:s.dataset.noteMode,track:getComputedStyle(s).gridTemplateColumns,anim:document.getAnimations().filter(x=>x.transitionProperty&&x.effect?.target===s).map(x=>x.transitionProperty)});if(a){for(const x of document.getAnimations().filter(x=>x.transitionProperty&&x.effect?.target?.closest?.('.reader-workspace-shell'))){x.pause();x.currentTime=0}return {ok:true,log}}await new Promise(r=>requestAnimationFrame(r))}return {ok:false,log}})()`);
 if(!frame.ok)throw Error('split grid track transition not observed '+JSON.stringify(frame.log));
 for(const time of [0,40,80,120,160,220]){
  await ev(`(()=>{for(const a of document.getAnimations().filter(x=>x.transitionProperty&&x.effect?.target?.closest?.('.reader-workspace-shell'))){a.pause();a.currentTime=${time}}return true})()`);
  measurements.push({case:'split-enter',time,...await snapshot()});await shot('split-'+String(time).padStart(3,'0'));
 }
 await ev(`(()=>{for(const a of document.getAnimations())a.finish();return true})()`);await pause(350);
 await shot('01-split-settled');
 // Drive the reversal entirely inside the WebView's event loop: a CDP screenshot can
 // block longer than the 220 ms exit and otherwise turn this into a hidden-state reopen.
 const reversal=await ev(`(async()=>{const button=document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button');button.click();const gaps=[];let previous=performance.now();for(let i=0;i<5;i++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();gaps.push(+(now-previous).toFixed(2));previous=now}const before=${SNAP_EXPR};button.click();await Promise.resolve();await Promise.resolve();const immediate=${SNAP_EXPR};await new Promise(r=>requestAnimationFrame(r));const next=${SNAP_EXPR};return {before,immediate,next,gaps}})()`);
 measurements.push({case:'split-exit-frame-intervals',ms:reversal.gaps});
 measurements.push({case:'exit-before-reverse',...reversal.before});
 measurements.push({case:'exit-immediate-reverse',...reversal.immediate});
 measurements.push({case:'exit-next-frame',...reversal.next});
 await shot('02-reverse-first-painted');
 await pause(65);measurements.push({case:'exit-reverse-65ms',...await snapshot()});await shot('03-reverse-65ms');
 await pause(300);measurements.push({case:'exit-reverse-settled',...await snapshot()});await shot('04-reverse-settled');
 if(label==='after' && (reversal.before.phase!=='exiting'||reversal.immediate.phase!=='entered'||Math.abs(reversal.before.pdf.w-reversal.next.pdf.w)>3))throw Error('split reversal jumped '+JSON.stringify({before:reversal.before.pdf.w,next:reversal.next.pdf.w}));
 // The floating note is a compositor-only transform/opacity transition; do not restart
 // its zero-opacity entrance when reversing its exit.
 await ev(`(()=>{document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true})()`);
 await wait(`!!document.querySelector('.reader-note-workbench-menu [role="menuitemradio"]')`,'floating menu');
 await ev(`([...document.querySelectorAll('.reader-note-workbench-menu [role="menuitemradio"]')].find(x=>x.textContent.includes('悬浮速记')).click(),true)`);
 await pause(400);measurements.push({case:'floating-settled',...await snapshot()});await shot('05-floating-settled');
 const floatingReverse=await ev(`(async()=>{const button=document.querySelector('.workbench-tab-frame.active .reader-note-workbench-button');button.click();const gaps=[];let prev=performance.now();for(let i=0;i<5;i++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();gaps.push(+(now-prev).toFixed(2));prev=now}const before=${SNAP_EXPR};button.click();await Promise.resolve();await Promise.resolve();const immediate=${SNAP_EXPR};await new Promise(r=>requestAnimationFrame(r));return {before,immediate,next:${SNAP_EXPR},gaps}})()`);
 measurements.push({case:'floating-exit-frame-intervals',ms:floatingReverse.gaps});
 for(const [caseName,value] of [['floating-before-reverse',floatingReverse.before],['floating-immediate-reverse',floatingReverse.immediate],['floating-next-frame',floatingReverse.next]])measurements.push({case:caseName,...value});
 await shot('06-floating-reverse-first');await pause(320);await shot('07-floating-reverse-settled');
 if(label==='after' && (floatingReverse.before.phase!=='exiting'||floatingReverse.immediate.phase!=='entered'||+floatingReverse.next.drawer.opacity < +floatingReverse.before.drawer.opacity - 0.08))throw Error('floating card blinked '+JSON.stringify({before:floatingReverse.before.drawer.opacity,next:floatingReverse.next.drawer.opacity}));
 await send('Emulation.setDeviceMetricsOverride',{width:980,height:740,deviceScaleFactor:1,mobile:false});await pause(320);
 measurements.push({case:'narrow',...await snapshot()});await shot('08-narrow-floating');
 await ev(`document.documentElement.style.zoom='125%'`);await pause(250);
 measurements.push({case:'zoom-125',...await snapshot()});await shot('09-zoom-125');
 await ev(`document.documentElement.style.zoom=''`);await send('Emulation.clearDeviceMetricsOverride');

}catch(e){problem=String(e);errors.push('TEST '+problem);errors.push('STATE '+JSON.stringify(await snapshot()));try{await shot('failure')}catch{}}
finally{fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({label,dir,measurements,errors},null,2));ws.close();console.log(JSON.stringify({dir,frames:measurements.length,errors},null,2));if(errors.length)process.exitCode=1}
