// Isolated Chromium layout regression for annotation tool popovers; run from repo root.
// Asserts: no horizontal overflow/scroll, preset swatches and selection ring fully visible,
// text-box palette columns aligned, and 无背景 toggle causes no shift. Real components + CSS.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {createServer} from 'vite';import react from '@vitejs/plugin-react';
const own=path.resolve('.tmp/reader-popover-layout');const run='layout-'+new Date().toISOString().replace(/[:.]/g,'-');const evidence=path.resolve('.a4-tests/reader-popover-layout',run);fs.mkdirSync(path.join(evidence,'screenshots'),{recursive:true});const profile=path.join(own,run+'-profile');const records=[],screenshots=[],errors=[];let server,chrome,ws;let seq=0;const requests=new Map();const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(ok,name,detail)=>records.push({name,passed:!!ok,...(detail===undefined?{}:{detail})});
async function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{requests.delete(id);reject(Error('CDP timeout '+method))},method==='Browser.close'?3000:method==='Page.navigate'?60000:15000);requests.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+': '+r.exceptionDetails.exception?.description);return r.result?.value}
async function wait(expression){for(let i=0;i<150;i++){try{if(await ev(expression))return}catch{}await pause(200)}throw Error('Timed out '+expression)}
async function click(selector){await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing element '+${JSON.stringify(selector)});e.click();return true})()`);await pause(120)}
async function shot(name){const f=path.join(evidence,'screenshots',name+'.png');fs.writeFileSync(f,Buffer.from((await rpc('Page.captureScreenshot',{format:'png'})).data,'base64'));screenshots.push(f)}
async function closePopover(){await ev(`(()=>{const p=document.querySelector('.reader-tool-popover');if(!p)return true;const c=p.querySelector('button,input,select');if(c)c.focus();p.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true})()`);for(let i=0;i<50;i++){if(!await ev(`!!document.querySelector('.reader-tool-popover')`))return;await pause(100)}}
const MEASURE=`(()=>{const p=document.querySelector('.reader-tool-popover');if(!p)return null;const bar=p.querySelector('.reader-tool-options-bar');const pr=p.getBoundingClientRect();const groups=[...p.querySelectorAll('.tool-option-color-group')].map(g=>{const custom=g.querySelector('.tool-option-color-custom');const presets=g.querySelector('.tool-option-color-presets');const btns=[...(presets?.querySelectorAll('button')||[])];const last=btns[btns.length-1]?.getBoundingClientRect();const first=btns[0]?.getBoundingClientRect();return {customLeft:custom?.getBoundingClientRect().left??null,presetsLeft:presets?.getBoundingClientRect().left??null,lastRight:last?.right??null,lastTop:last?.top??null,lastBottom:last?.bottom??null,firstLeft:first?.left??null,count:btns.length}});return {scrollW:p.scrollWidth,clientW:p.clientWidth,barScrollW:bar?.scrollWidth??0,barClientW:bar?.clientWidth??0,left:pr.left,right:pr.right,top:pr.top,bottom:pr.bottom,innerWidth,innerHeight,devicePixelRatio,groups}})()`;
const PALETTE_TOOLS=['高亮','下划线','自由画笔','箭头','文本框','图形'];
try{
 fs.mkdirSync(own,{recursive:true});
 server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(own,run+'-vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await server.listen();const addr=server.httpServer.address();
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});chrome.stderr.on('data',()=>{});
 for(let i=0;i<150&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await pause(100);
 const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=tabs.find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&requests.has(m.id)){const p=requests.get(m.id);requests.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)});
 await rpc('Page.enable');await rpc('Runtime.enable');
 await rpc('Page.navigate',{url:`http://127.0.0.1:${addr.port}/tests/fixtures/reader-popover-focus.html`});await wait('document.querySelectorAll(".annotation-tool-btn").length>=7');
 const scenarios=[{w:1280,h:800,zoom:1},{w:1280,h:800,zoom:1.25},{w:1280,h:800,zoom:1.5},{w:800,h:600,zoom:1},{w:460,h:700,zoom:1}];
 for(const s of scenarios){
  await rpc('Emulation.setDeviceMetricsOverride',{width:s.w,height:s.h,deviceScaleFactor:1,mobile:false});
  await ev(`document.documentElement.style.zoom=${s.zoom}`);
  for(const label of PALETTE_TOOLS){
   const ctx=`${label}@${s.w}x${s.h}z${s.zoom}`;const selector='.annotation-tool-btn[aria-label='+JSON.stringify(label)+']';
   try{
    const has=await ev(`!!document.querySelector(${JSON.stringify(selector)})`);if(!has){check(false,ctx+' tool button exists');continue}
    await click('.annotation-tool-btn[aria-label="鼠标"]');await click(selector);await click(selector);await wait('!!document.querySelector(".reader-tool-popover")');
    const m=await ev(MEASURE);if(!m){check(false,ctx+' popover measured');continue}
    check(m.scrollW<=m.clientW&&m.barScrollW<=m.barClientW,ctx+' no horizontal overflow/scroll',{scrollW:m.scrollW,clientW:m.clientW,barScrollW:m.barScrollW,barClientW:m.barClientW});
    check(m.groups.length>=1&&m.groups.every(g=>g.count===20),ctx+' all 20 presets rendered',m.groups.map(g=>g.count));
    check(m.groups.every(g=>g.lastRight!==null&&g.lastRight+4<=m.right+1),ctx+' last swatch + selection ring inside popover',{right:m.right,lastRights:m.groups.map(g=>g.lastRight)});
    check(m.groups.every(g=>g.firstLeft!==null&&g.firstLeft>=m.left-1),ctx+' first swatch inside popover');
    if(m.groups.length>1){
     const customSpread=Math.max(...m.groups.map(g=>g.customLeft))-Math.min(...m.groups.map(g=>g.customLeft));
     const presetSpread=Math.max(...m.groups.map(g=>g.presetsLeft))-Math.min(...m.groups.map(g=>g.presetsLeft));
     check(customSpread<=1&&presetSpread<=1,ctx+' palette columns aligned (<=1px)',{customSpread,presetSpread});
    }
    if(label==='文本框'){
     const toggle=await ev(`document.querySelector('.tool-option-transparent-toggle input')?.checked??null`);
     const before=m.groups[m.groups.length-1];
     await ev(`(()=>{const i=document.querySelector('.tool-option-transparent-toggle input');if(i&&!i.checked)i.click()})()`);await pause(150);
     const on=await ev(MEASURE);
     await ev(`(()=>{const i=document.querySelector('.tool-option-transparent-toggle input');if(i&&i.checked)i.click()})()`);await pause(150);
     const off=await ev(MEASURE);
     check(on&&off&&Math.abs(on.groups[on.groups.length-1].presetsLeft-off.groups[off.groups.length-1].presetsLeft)<=1,ctx+' 无背景 toggle does not shift background palette',{toggleBefore:toggle,on:on?.groups.at(-1)?.presetsLeft,off:off?.groups.at(-1)?.presetsLeft});
     check(on&&on.scrollW<=on.clientW&&off&&off.scrollW<=off.clientW,ctx+' no overflow with 无背景 on/off');
    }
    // selection ring not clipped: activate last preset then re-measure
    await ev(`(()=>{const b=[...document.querySelectorAll('.reader-tool-popover .tool-option-color-presets button')];b[b.length-1]?.click()})()`);await pause(120);
    const act=await ev(MEASURE);
    check(act&&act.groups.every(g=>g.lastRight===null||g.lastRight+4<=act.right+1),ctx+' active ring visible at right edge');
    if(s.w===1280&&s.zoom===1)await shot('popover-'+PALETTE_TOOLS.indexOf(label));
    if(label==='文本框'&&s.w===800)await shot('popover-text-800x600');
    if(label==='文本框'&&s.zoom===1.5)await shot('popover-text-z150');
    await closePopover();
    await click('.annotation-tool-btn[aria-label="鼠标"]');
   }catch(e){check(false,ctx+' execution',String(e));try{await closePopover()}catch{}}
  }
 }
 check(errors.length===0,'No runtime page exceptions',errors);
}catch(e){records.push({name:'Execution failure',passed:false,error:String(e),stack:e.stack})}
finally{
 const result={at:new Date().toISOString(),scope:'popover layout regression in isolated headless Chrome; not native persistence or installed acceptance',run,evidence,passed:records.filter(r=>r.passed).length,failed:records.filter(r=>!r.passed).length,records,screenshots};fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
 if(ws?.readyState===1){try{await rpc('Browser.close')}catch{}ws.close()}if(chrome&&!chrome.killed)chrome.kill();if(server)await server.close();console.log(JSON.stringify({evidence,passed:result.passed,failed:result.failed,failures:records.filter(r=>!r.passed).map(r=>({name:r.name,error:r.error,detail:r.detail}))},null,2));
}
if(records.some(r=>r.passed===false))process.exitCode=1;
