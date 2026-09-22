import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const evidence = path.join(root,'.tmp/shots/shortcuts-browser'); fs.mkdirSync(evidence,{recursive:true});
let browser, server; const errors=[],checks=[];
const check=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks.push(label);};
try {
  server=await createServer({root,configFile:false,plugins:[react(),{name:'shortcut-harness',configureServer(s){s.middlewares.use('/__shortcuts',async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__shortcuts','<html><head><link rel="icon" href="data:,"><style>:root{--ink:#243b31;--surface:#fff;--muted:#64746c;--line:#bbc8bf;--accent:#48835d}body{margin:0;font:14px sans-serif}button{margin:3px}</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/shortcuts.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await server.listen(); const port=server.httpServer.address().port;
  const exe = process.env.SHORTCUT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(exe,'Set SHORTCUT_CHROME to an installed browser executable');
  browser=await chromium.launch({executablePath:exe,headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}/__shortcuts`); await page.waitForFunction(()=>window.__shortcutsTest?.store.commands().length>20); await page.bringToFront();
  const events=()=>page.evaluate(()=>window.__shortcutsTest.events.splice(0));
  const key=async(combo,selector='#canvas')=>{await page.locator(selector).focus();await page.keyboard.press(combo);return events();};
  check(await key('Control+h'),['highlight'],'one dispatch under StrictMode');
  for(const selector of ['#input','#textarea','#select','#editable','#cm']) check(await key('Control+z',selector),[],selector+' protects undo');
  check(await key('Control+Alt+Enter','#textarea'),['reader.notes.mode.focus'],'writing command explicit editable opt-in');
  check(await key('Control+='),['pdf-zoom'],'PDF zoom command');check(await key('Control+Alt+='),['ui-zoom'],'UI zoom separate');
  await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(200);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).pointerEvents),'none','hints never intercept pointers');
  check(await page.locator('.shortcut-hints').getAttribute('aria-hidden'),'true','hints do not duplicate accessible controls');
  await page.screenshot({path:path.join(evidence,'01-reader-hints.png')});
  await page.keyboard.up('Control');await page.waitForTimeout(180);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).opacity),'0','release hides hints');
  const row=page.locator('[data-shortcut-row="reader.tool.highlight"]');
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.keyboard.press('Control+u');
  check(await page.locator('.shortcut-recorder').getByRole('alert').count(),1,'conflict visible');
  check(await page.evaluate(()=>window.__shortcutsTest.store.recording),true,'dispatcher paused while confirming');
  check(await events(),[],'recorder chord did not dispatch');
  await page.getByRole('button',{name:'取消',exact:true}).click();check(await key('Control+h'),['highlight'],'cancel preserves mapping');
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.keyboard.press('Control+u');await page.getByRole('button',{name:'替换并保存'}).click();
  check(await key('Control+u'),['highlight'],'replace executes selected command');check(await key('Control+h'),[],'old key inactive');
  check(await page.locator('[data-shortcut-row="reader.tool.underline"] kbd').innerText(),'未绑定','conflicting default removed');
  check(await page.locator('[data-shortcut-id="reader.tool.highlight"]').getAttribute('aria-keyshortcuts'),'Control+U','ARIA reflects override');
  await page.reload();await page.waitForFunction(()=>window.__shortcutsTest?.store.commands().length>20);check(await key('Control+u'),['highlight'],'reload restores override');
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.keyboard.press('Delete');await page.getByRole('button',{name:'保存绑定'}).click();check(await key('Control+u'),[],'Delete clears mapping');
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.keyboard.press('Escape');check(await page.locator('.shortcut-recorder').count(),0,'Escape cancels recorder');
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));check(await page.locator('.shortcut-recorder').count(),0,'blur cancels recorder');
  await page.getByRole('checkbox',{name:'按物理键位录制',exact:false}).check();
  await row.getByRole('button',{name:'录制',exact:true}).click();await page.keyboard.press('Control+Shift+F9');await page.locator('.shortcut-recorder').getByRole('button',{name:/保存/}).click();
  check(await page.evaluate(()=>window.__shortcutsTest.store.overrides.bindings['reader.tool.highlight'][0].code),'F9','physical code recorded');
  check(await key('Control+Shift+F9'),['highlight'],'physical code dispatched');
  await row.getByRole('button',{name:'默认',exact:true}).click();await page.getByRole('button',{name:'保存绑定'}).click();
  check(await page.evaluate(()=>Object.hasOwn(window.__shortcutsTest.store.overrides.bindings,'reader.tool.highlight')),false,'single default reset removes override for future defaults');
  await page.getByRole('checkbox',{name:'按物理键位录制',exact:false}).uncheck();
  const cdp=await page.context().newCDPSession(page);
  const side=async()=>{await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:60,y:140,button:'back',buttons:8,clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:60,y:140,button:'back',buttons:0,clickCount:1});};
  await row.getByRole('button',{name:'录制',exact:true}).click();await side();await page.getByRole('button',{name:'保存绑定'}).click();
  check(await row.locator('kbd').innerText(),'鼠标后退键','side mouse recorded in real DOM');
  await page.locator('#canvas').focus();await side();check(await events(),['highlight'],'side mouse executes once');
  await cdp.detach();
  await page.getByRole('button',{name:'恢复本组默认'}).click();await page.getByRole('button',{name:'确认恢复'}).click();check(await key('Control+h'),['highlight'],'group reset');check(await key('Control+u'),['underline'],'reset restores conflict victim');
  await page.getByRole('button',{name:'Library',exact:true}).click();check(await key('Control+h'),[],'scene isolation');check(await key('Control+f'),['library-search'],'library search preserved');
  await page.getByRole('button',{name:'恢复本组默认'}).click();await page.getByRole('button',{name:'确认恢复'}).click();check(await page.getByRole('alert').count(),0,'default library/reader CtrlF not false conflict');
  await page.getByRole('button',{name:'Reader',exact:true}).click();check(await key('Control+f'),['pdf-search'],'reader search preserved');
  await page.getByRole('button',{name:'Modal',exact:true}).click();check(await key('Control+h'),[],'modal protection');await page.getByRole('button',{name:'Modal',exact:true}).click();
  await page.setViewportSize({width:800,height:600});await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).transitionDuration),'0s','reduced motion');
  await page.screenshot({path:path.join(evidence,'02-narrow-hints.png')});await page.keyboard.up('Control');
  await page.screenshot({path:path.join(evidence,'03-reader-editor.png')});
  // Geometry is checked on the actual rendered hints at both CSS viewport sizes
  // and application zoom levels; no synthetic screenshot composition.
  for (const [width,height] of [[800,600],[1280,800]]) for (const zoom of [1,1.25,1.5]) {
    await page.setViewportSize({width,height});
    await page.evaluate(z=>{document.documentElement.style.zoom=String(z);document.documentElement.style.setProperty('--ui-zoom',String(z));},zoom);
    await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
    const geometry=await page.evaluate(()=>{
      const panel=document.querySelector('.shortcut-hint-panel').getBoundingClientRect();
      const badges=[...document.querySelectorAll('.shortcut-anchor-hint')].map(n=>n.getBoundingClientRect());
      return {viewport:[innerWidth,innerHeight],outside:badges.filter(r=>r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1).length,
        clipped:[...document.querySelectorAll('.shortcut-hint-panel section > div')].filter(n=>{const r=n.getBoundingClientRect();return r.right>panel.right+1||r.bottom>panel.bottom+1;}).length,
        overlaps:badges.some((r,i)=>badges.slice(i+1).some(s=>r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top))};
    });
    check(geometry.outside,0,`${width}x${height} zoom ${zoom}: hints inside viewport`);
    check(geometry.clipped,0,`${width}x${height} zoom ${zoom}: fallback labels not clipped`);
    check(geometry.overlaps,false,`${width}x${height} zoom ${zoom}: anchor badges do not overlap`);
    await page.screenshot({path:path.join(evidence,`geometry-${width}-${zoom}.png`)});await page.keyboard.up('Control');
  }
  check(errors,[],'no browser console/page errors');
} finally {
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({checks,errors,kind:'real-browser-component-harness-not-native-desktop'},null,2));
  await browser?.close();await server?.close();
}
console.log(`Shortcut browser verification passed: ${checks.length} checks`);
