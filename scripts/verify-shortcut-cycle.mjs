// Real component regression or isolated dev:live WebView evidence; never production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const native = process.argv.includes('--native');
const label = process.argv.includes('--baseline') ? 'baseline' : 'after';
const dir = path.resolve('.tmp/shots/shortcut-cycle', native ? 'native' : 'component', label);
fs.mkdirSync(dir, { recursive: true });
const errors = [], checks = [], samples = [];
let browser, server, page;
const record = (name, actual, expected) => checks.push({ name, actual, expected, pass: actual === expected });
try {
  if (native) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CYCLE_CDP_PORT || 9357}`);
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(`127.0.0.1:${process.env.CYCLE_VITE_PORT || 1457}`));
    assert.ok(page, 'isolated dev:live page');
    await page.waitForFunction(() => document.querySelector('#a4note-live-dev-badge')?.textContent.includes('qiuxu-shortcut') && document.querySelector('#a4note-live-dev-badge')?.textContent.includes('原生已核验'));
  } else {
    server = await createServer({root:process.cwd(),configFile:false,cacheDir:'.tmp/shortcut-cycle-vite',optimizeDeps:{entries:['scripts/fixtures/shortcuts.tsx']},plugins:[react(),{name:'cycle-fixture',configureServer(s){s.middlewares.use('/__cycle', async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__cycle','<html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/shortcuts.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
    await server.listen();
    const exe = process.env.SHORTCUT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
    assert.ok(exe, 'Set SHORTCUT_CHROME to an installed Chromium browser');
    browser = await chromium.launch({executablePath:exe,headless:true});
    page = await browser.newPage({viewport:{width:1400,height:900}});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__cycle`);
    await page.waitForFunction(()=>!!window.__shortcutsTest);
  }
  page.on('pageerror', e=>errors.push('pageerror: '+e.message));
  page.on('console', m=>{if(m.type()==='error')errors.push('console.error: '+m.text());});
  if(native) {
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#a4note-live-dev-badge')?.textContent.includes('qiuxu-shortcut') && document.querySelector('#a4note-live-dev-badge')?.textContent.includes('原生已核验'));
  }
  await page.evaluate(()=>{
    window.__cycleTimeline=[];
    for(const kind of ['keydown','keyup'])window.addEventListener(kind,e=>window.__cycleTimeline.push({kind,key:e.key,ctrl:e.ctrlKey,alt:e.altKey,shift:e.shiftKey,at:performance.now()}),true);
    new MutationObserver(()=>window.__cycleTimeline.push({kind:'hint',visible:!!document.querySelector('.shortcut-hints.is-visible'),at:performance.now()})).observe(document.querySelector('.shortcut-hints'),{attributes:true,attributeFilter:['class']});
  });
  await page.bringToFront();
  const shown = () => page.locator('.shortcut-hints.is-visible').count();
  const release = async()=>{for(const k of ['b','h','z','Shift','Alt','Control'])await page.keyboard.up(k);};
  const focus = async()=>{if(native)await page.evaluate(()=>{document.activeElement?.blur();document.body.tabIndex=-1;document.body.focus();});else await page.locator('#canvas').focus();};
  const snap = async(name)=>{
    const value=await page.evaluate(()=>({time:performance.now(),focus:document.hasFocus(),visible:!!document.querySelector('.shortcut-hints.is-visible'),hints:[...document.querySelectorAll('.shortcut-hints.is-visible [data-hint-id]')].map(n=>({id:n.dataset.hintId,placement:n.dataset.hintPlacement})),badge:document.querySelector('#a4note-live-dev-badge')?.textContent}));
    samples.push({name,...value});return value.visible?1:0;
  };
  for (const scene of native?['library','reader']:['reader']) {
    if(native){
      await page.evaluate(()=>[...document.querySelectorAll('.workbench-tool')].find(n=>n.textContent.trim()==='文献库')?.click());
      await page.waitForSelector('.workbench-tab-frame.active .paper-table tbody tr');
      if(scene==='reader'){
        await page.locator('.workbench-tab-frame.active .paper-table tbody tr').first().dblclick();
        await page.waitForSelector('.workbench-tab-frame.active .reader-note-workbench-button');
      }
    }
    await release();await focus();
    await page.keyboard.down('Control');await page.waitForTimeout(300);
    record(scene+' 300ms hidden',await snap(scene+'-300ms'),0);
    await page.waitForTimeout(350);record(scene+' 650ms visible',await snap(scene+'-650ms'),1);
    await page.screenshot({path:path.join(dir,scene+'-hold.png')});
    await page.keyboard.down('h');record(scene+' shown then chord hides',await snap(scene+'-chord'),0);
    await page.keyboard.up('h');await page.waitForTimeout(650);record(scene+' chord held never reappears',await shown(),0);
    await release();await focus();await page.keyboard.down('Control');await page.waitForTimeout(650);
    record(scene+' next cycle restores hints',await shown(),1);await release();
    for(const key of ['b','h','z']){
      await focus();await page.keyboard.down('Control');await page.waitForTimeout(60);await page.keyboard.down(key);await page.keyboard.up(key);await page.waitForTimeout(600);
      record(scene+' fast Ctrl+'+key,await shown(),0);await release();
    }
    await focus();await page.keyboard.down('Control');await page.waitForTimeout(450);await page.keyboard.down('h');await page.waitForTimeout(200);
    record(scene+' near threshold chord cancels timer',await shown(),0);await release();
    for(const modifier of ['Shift','Alt']){
      await focus();await page.keyboard.down(modifier);await page.keyboard.down('Control');await page.waitForTimeout(650);
      record(scene+' '+modifier+' before Ctrl suppresses',await snap(scene+'-'+modifier+'-first'),0);
      await page.keyboard.up(modifier);await page.waitForTimeout(600);record(scene+' modifier released Ctrl held stays suppressed',await shown(),0);
      await page.screenshot({path:path.join(dir,scene+'-'+modifier+'-first.png')});await release();
    }
    // Simulate a child editor owning a chord; it must not execute an application command.
    await focus();await page.evaluate(()=>{window.__cycleStop=e=>{if(e.ctrlKey&&e.key==='z'){e.preventDefault();e.stopPropagation();}};document.addEventListener('keydown',window.__cycleStop);});
    await page.keyboard.down('Control');await page.waitForTimeout(100);await page.keyboard.down('z');await page.keyboard.up('z');await page.waitForTimeout(600);
    record(scene+' child-owned chord suppresses',await snap(scene+'-child-owned'),0);
    await page.screenshot({path:path.join(dir,scene+'-child-owned.png')});
    await release();await page.evaluate(()=>document.removeEventListener('keydown',window.__cycleStop));
    await focus();await page.keyboard.down('Control');await page.waitForTimeout(650);record(scene+' final new cycle still works',await shown(),1);await release();
  }
  record('no pageerror / console error',errors.length,0);
  fs.writeFileSync(path.join(dir,'timeline.json'),JSON.stringify(await page.evaluate(()=>window.__cycleTimeline),null,2)+'\n');
} catch(e) { errors.push(e.stack||String(e)); process.exitCode=1; }
finally {
  const result={native,label,checkedAt:new Date().toISOString(),checks,samples,errors};
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({native,label,passed:checks.filter(c=>c.pass).length,total:checks.length,failed:checks.filter(c=>!c.pass),errors},null,2));
  if(checks.some(c=>!c.pass))process.exitCode=1;
  if(browser)await browser.close();if(server)await server.close();
}
