import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const baseline=process.argv.includes('--baseline'),root=process.cwd();
const evidence=path.resolve('.tmp/stage-count',baseline?'before':'after');fs.mkdirSync(evidence,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'stage-count-'));let web,browser,ws,seq=0;const pending=new Map(),records=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,m=>{clearTimeout(t);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const frame=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
try{
 const entry=path.join(root,'.tmp/stage-count-entry.tsx');
 fs.writeFileSync(entry,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TaskStageSwitcher} from '../src/features/taskboard/TaskStageViews';
 function Fixture(){const [stage,setStage]=useState('all'),[disabled,setDisabled]=useState(false);window.fixture={setDisabled};return <><h1>任务场景切换条</h1><div className="taskboard"><TaskStageSwitcher value={stage as any} tasks={[]} supportsQueue disabled={disabled} onChange={setStage as any}/></div><p id="selected">{stage}</p></>};createRoot(document.getElementById('root')!).render(<Fixture/>);`);
 await build({root,configFile:false,logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':'"production"'},build:{outDir:scratch,emptyOutDir:false,minify:true,cssCodeSplit:false,lib:{entry,formats:['es'],fileName:()=> 'entry.js',cssFileName:'entry'}}});
 web=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(['/entry.js','/entry.css'].includes(p)){res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(scratch,path.basename(p))));}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<meta charset="utf-8"><link rel="stylesheet" href="/entry.css"><style>:root{--line:#ddd;--surface:#fff;--surface-soft:#f1f3f2;--text:#273c32;--muted:#69736d;--accent-strong:#246448;--ui-control-font-size:18px}body{font-family:Arial,sans-serif;color:var(--text);background:var(--surface);margin:0;padding:16px;box-sizing:border-box}h1{font-size:20px}.taskboard{display:flex;width:100%;min-width:0;overflow:hidden}html[data-theme=dark]{--line:#454b48;--surface:#242a27;--surface-soft:#333b37;--text:#eee;--muted:#adbab2;--accent-strong:#b6e4c9}</style><div id="root"></div><script type="module" src="/entry.js"></script>');}});
 await new Promise(r=>web.listen(0,'127.0.0.1',r));
 const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(exe);
 const profile=path.join(scratch,'profile');browser=spawn(exe,['--headless=new','--no-first-run','--disable-extensions','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pause(100);
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0],target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);};
 await rpc('Page.enable');await rpc('Runtime.enable');await rpc('Page.navigate',{url:'http://127.0.0.1:'+web.address().port});for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector(".tb-stage-switch button")'))break;await pause(100);}
 await rpc('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(const width of [1440,1280,1024,360])for(const zoom of [1,1.25])for(const theme of ['light','dark']){
 await rpc('Emulation.setDeviceMetricsOverride',{width,height:500,deviceScaleFactor:1,mobile:false});await evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.zoom=${zoom}`);
 for(let index=0;index<5;index++){
 await evaluate(`document.querySelectorAll('.tb-stage-switch button')[${index}].click()`);await frame();
 const m=await evaluate(`(()=>{const s=document.querySelector('.tb-stage-switch'),bs=[...s.querySelectorAll('button')],b=bs[${index}],r=s.getBoundingClientRect(),br=b.getBoundingClientRect(),last=bs.at(-1).getBoundingClientRect(),p=getComputedStyle(s,'::before'),g=getComputedStyle(s),x=new DOMMatrix(p.transform).m41,z=${zoom};return {count:bs.length,tail:(r.right-last.right)/z,leftError:Math.abs(r.left+(parseFloat(g.borderLeftWidth)+parseFloat(p.left)+x)*z-br.left),widthError:Math.abs(parseFloat(p.width)*z-br.width),selected:bs.filter(b=>b.getAttribute('aria-pressed')==='true').length,active:b.getAttribute('aria-pressed'),overflow:document.documentElement.scrollWidth-innerWidth,transition:p.transitionDuration}})()`);
 assert.equal(m.count,5);assert.equal(m.selected,1);assert.equal(m.active,'true');assert.ok(m.overflow<=2,JSON.stringify(m));assert.ok(m.leftError<2&&m.widthError<2,JSON.stringify(m));
 if(baseline)assert.ok(m.tail>40,'baseline must reproduce empty sixth slot');else assert.ok(m.tail<=4,'extra blank slot '+JSON.stringify(m));
 records.push({width,zoom,theme,index,...m});
 }
 if(width===1440&&zoom===1&&theme==='light'||width===360&&zoom===1.25&&theme==='dark')fs.writeFileSync(path.join(evidence,`${width}-${theme}.png`),Buffer.from((await rpc('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 // Narrow host: no visible scrollbar, yet keyboard navigation keeps the active stage inside the strip.
 await rpc('Emulation.setDeviceMetricsOverride',{width:360,height:500,deviceScaleFactor:1,mobile:false});await evaluate("document.documentElement.dataset.theme='dark';document.documentElement.style.zoom=1.25");
 await evaluate("document.querySelectorAll('.tb-stage-switch button')[0].click()");await frame();
 const narrow=await evaluate(`(()=>{const n=document.querySelector('.tb-stage-nav');return {overflowing:n.scrollWidth>n.clientWidth,scrollbarThickness:n.offsetHeight-n.clientHeight,scrollbarWidth:getComputedStyle(n).scrollbarWidth}})()`);
 assert.ok(narrow.overflowing&&narrow.scrollbarThickness===0&&narrow.scrollbarWidth==='none','narrow strip must overflow without a visible scrollbar '+JSON.stringify(narrow));
 await evaluate("document.querySelectorAll('.tb-stage-switch button')[0].focus()");
 for(const key of ['End','Home','ArrowLeft']){await rpc('Input.dispatchKeyEvent',{type:'keyDown',key});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key});await frame();
  const reach=await evaluate(`(()=>{const n=document.querySelector('.tb-stage-nav').getBoundingClientRect(),b=document.querySelector('.tb-stage-switch button[aria-pressed=true]').getBoundingClientRect();return {label:document.querySelector('.tb-stage-switch button[aria-pressed=true]').textContent,inside:b.left>=n.left-1&&b.right<=n.right+1}})()`);
  assert.ok(reach.inside,'active stage must be scrolled into the strip after '+key+' '+JSON.stringify(reach));}
 fs.writeFileSync(path.join(evidence,'360-dark-keyboard-end.png'),Buffer.from((await rpc('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await rpc('Emulation.setDeviceMetricsOverride',{width:1440,height:500,deviceScaleFactor:1,mobile:false});await evaluate("document.documentElement.dataset.theme='light';document.documentElement.style.zoom=1");
 await evaluate("document.querySelectorAll('.tb-stage-switch button')[0].click()");await frame();
 await evaluate("document.querySelectorAll('.tb-stage-switch button')[0].focus()");
 for(const [key,expected] of [['End','archived'],['Home','all'],['ArrowRight','queued'],['ArrowLeft','all']]){await rpc('Input.dispatchKeyEvent',{type:'keyDown',key});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key});await frame();assert.equal(await evaluate('document.querySelector("#selected").textContent'),expected);assert.ok(await evaluate("document.activeElement.getAttribute('aria-pressed')==='true'"));}
 await evaluate('window.fixture.setDisabled(true)');await frame();await evaluate("document.querySelectorAll('.tb-stage-switch button')[4].click()");await frame();assert.equal(await evaluate('document.querySelector("#selected").textContent'),'all');assert.equal(await evaluate("[...document.querySelectorAll('.tb-stage-switch button')].filter(b=>b.disabled).length"),5);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.tb-stage-switch'),'::before').transitionDuration"),'0s');
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,baseline,matrix:records.length,keyboardCases:4,records},null,2));console.log(JSON.stringify({passed:true,baseline,matrix:records.length,keyboardCases:4,evidence}));
}catch(e){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:String(e),records},null,2));throw e;}
finally{if(ws){try{await rpc('Browser.close');}catch{}ws.close();}if(browser&&browser.exitCode===null){const exited=new Promise(r=>browser.once("exit",r));browser.kill();await Promise.race([exited,pause(5000)]);}if(web){web.closeAllConnections();await new Promise(r=>web.close(r));}try{fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch(e){console.warn("Temporary browser profile cleanup:",String(e));}}
