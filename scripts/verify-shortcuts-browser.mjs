import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const evidence = path.join(root,'.tmp/shots/shortcuts-browser'); fs.mkdirSync(evidence,{recursive:true});
const baseline=process.argv.includes('--baseline-hints');
const baselinePlugin={name:'baseline-shortcut-hints',enforce:'pre',resolveId(id,importer){
  if(!baseline || !importer?.endsWith('/ShortcutProvider.tsx')) return;
  if(id==='./ShortcutHints') return path.join(root,'.tmp/shortcuts-baseline/ShortcutHints.tsx');
  if(id==='./shortcuts.css') return path.join(root,'.tmp/shortcuts-baseline/shortcuts.css');
}};
if(baseline){
  fs.mkdirSync('.tmp/shortcuts-baseline',{recursive:true});
  for(const file of ['ShortcutHints.tsx','shortcuts.css','hintLayout.ts']) {
    let content=execFileSync('git',['show',`d6d70d8:src/shared/shortcuts/${file}`],{encoding:'utf8'});
    if(file.endsWith('.tsx')) content=content.replaceAll('../../core/','/src/core/').replaceAll("'./dispatcher'","'/src/shared/shortcuts/dispatcher'").replaceAll("'./store'","'/src/shared/shortcuts/store'");
    fs.writeFileSync(`.tmp/shortcuts-baseline/${file}`,content);
  }
}
let browser, server; const errors=[],checks=[];
const check=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks.push(label);};
try {
  server=await createServer({root,configFile:false,plugins:[baselinePlugin,react(),{name:'shortcut-harness',configureServer(s){s.middlewares.use('/__shortcuts',async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__shortcuts','<html><head><link rel="icon" href="data:,"><style>:root{--ink:#243b31;--surface:#fff;--muted:#64746c;--line:#bbc8bf;--accent:#48835d}body{margin:0;font:14px sans-serif}button{margin:3px}</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/shortcuts.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});
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
  check(await page.locator('.shortcut-hint-panel').count(),0,'spec2: boxed command list removed');
  check(await page.locator('[data-hint-id] .shortcut-hint-keys kbd').count()>30,true,'spec3: real keycaps instead of plain text');
  check(await page.locator('[data-hint-placement="adjacent"] .shortcut-hint-label').count(),0,'spec3: button hints do not repeat action names');
  check(await page.locator('[data-hint-id="reader.undo"] .shortcut-hint-label').innerText(),'撤销标注','spec3: unanchored keys have real action on their right');
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-keys').textContent(),'Ctrl+H','primary effective binding by its button');
  check(await page.locator('[data-hint-id="reader.zoomIn"]').getAttribute('data-hint-placement'),'adjacent','right-side zoom no longer relegated to panel');
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
  // Reader canvas geometry: the standalone editor test form is not a Reader overlay.
  await page.locator('.shortcut-editor').evaluate(n=>n.hidden=true);
  // Geometry is checked on the actual rendered hints at both CSS viewport sizes
  // and application zoom levels; no synthetic screenshot composition.
  for (const [width,height] of [[800,600],[1280,800]]) for (const zoom of [1,1.25,1.5]) {
    await page.setViewportSize({width,height});
    await page.evaluate(z=>{document.documentElement.style.zoom=String(z);document.documentElement.style.setProperty('--ui-zoom',String(z));},zoom);
    await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
    const geometry=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.shortcut-key-hint')];
      const badges=nodes.map(n=>n.getBoundingClientRect());
      const controls=[...document.querySelectorAll('[data-shortcut-id],#a4note-live-dev-badge')].filter(n=>{
        const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0;
      }).map(n=>n.getBoundingClientRect());
      const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {viewport:[innerWidth,innerHeight],outside:badges.filter(r=>r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1).length,
        hidden:nodes.filter(n=>getComputedStyle(n).visibility==='hidden').length,
        backgrounds:nodes.filter(n=>getComputedStyle(n).backgroundColor!=='rgba(0, 0, 0, 0)'||getComputedStyle(n).boxShadow!=='none'||getComputedStyle(n).borderTopWidth!=='0px').length,
        bareKeys:nodes.flatMap(n=>[...n.querySelectorAll('kbd')]).filter(k=>getComputedStyle(k).borderBottomWidth==='0px'||getComputedStyle(k).borderRadius==='0px').length,
        wrongLabels:nodes.filter(n=>{const label=n.querySelector('.shortcut-hint-label'),keys=n.querySelector('.shortcut-hint-keys');if(n.dataset.hintPlacement==='adjacent')return !!label;return !label||!label.textContent.trim()||label.getBoundingClientRect().left<keys.getBoundingClientRect().right;}).length,
        overlaps:badges.some((r,i)=>badges.slice(i+1).some(s=>overlap(r,s))),
        coversControl:badges.some(r=>controls.some(s=>overlap(r,s))),
        dockFloating:[...document.querySelectorAll('#tool-dock [data-shortcut-id]')].filter(n=>document.querySelector(`[data-hint-id="${n.dataset.shortcutId}"]`)?.dataset.hintPlacement!=='adjacent').length};
    });
    if(geometry.dockFloating||geometry.hidden){
      console.log('MEASURE',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-measure-id]')].map(n=>({id:n.dataset.measureId,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,keys:n.querySelector('.shortcut-hint-keys').getBoundingClientRect().width})))));
      console.log('FAILED GEOMETRY',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#tool-dock [data-shortcut-id]')].map(n=>{const r=n.getBoundingClientRect();const h=document.querySelector(`[data-hint-id="${n.dataset.shortcutId}"]`);return {id:n.dataset.shortcutId,rect:r.toJSON(),hint:h?.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,180)};}))));
      await page.screenshot({path:path.join(evidence,'failure.png')});
    }
    check(geometry.outside,0,`${width}x${height} zoom ${zoom}: hints inside viewport`);
    check(geometry.hidden,0,`${width}x${height} zoom ${zoom}: every bound command displayed`);
    check(geometry.backgrounds,0,`${width}x${height} zoom ${zoom}: transparent text without boxes`);
    check(geometry.bareKeys,0,`${width} zoom ${zoom}: individual keys have keycap edges`);
    check(geometry.wrongLabels,0,`${width} zoom ${zoom}: only floating rows have right-hand action labels`);
    check(geometry.overlaps,false,`${width}x${height} zoom ${zoom}: hints do not overlap`);
    check(geometry.coversControl,false,`${width}x${height} zoom ${zoom}: no icons or DEV strip covered`);
    check(geometry.dockFloating,0,`${width}x${height} zoom ${zoom}: every dense toolbar button has adjacent key`);
    await page.screenshot({path:path.join(evidence,`geometry-${width}-${zoom}.png`)});await page.keyboard.up('Control');
  }
  // While Ctrl stays down, reflow and dynamic anchors must remeasure without a
  // new keydown, including non-window resize and portal/menu visibility changes.
  await page.evaluate(()=>{document.documentElement.style.zoom='1';document.documentElement.style.setProperty('--ui-zoom','1');});
  await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
  const before=await page.locator('[data-hint-id="reader.tool.highlight"]').boundingBox();
  await page.locator('#tool-dock').evaluate(n=>n.style.bottom='180px');await page.waitForTimeout(120);
  const after=await page.locator('[data-hint-id="reader.tool.highlight"]').boundingBox();
  const movedControl=await page.locator('[data-shortcut-id="reader.tool.highlight"]').boundingBox();
  check(after.y<before.y,true,'anchor reflow followed while Ctrl held');
  check(Math.min(Math.abs(after.y+after.height-movedControl.y),Math.abs(after.y-movedControl.y-movedControl.height))<=after.height+15,true,'reflow hint stays next to current control bounds');
  await page.locator('#tool-dock [data-shortcut-id="reader.tool.highlight"]').evaluate(n=>{n.style.display='none';});await page.waitForTimeout(180);
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-label').innerText(),'高亮','hidden button becomes a floating named action');
  await page.locator('#tool-dock [data-shortcut-id="reader.tool.highlight"]').evaluate(n=>{n.style.display='';});await page.waitForTimeout(180);
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-label').count(),0,'restored button removes duplicate action name');
  await page.locator('[data-shortcut-id="reader.tool.highlight"]').evaluate(n=>n.style.display='none');await page.waitForTimeout(120);
  check(await page.locator('[data-hint-id="reader.tool.highlight"]').getAttribute('data-hint-placement'),'floating','hidden control becomes bare floating hint');
  await page.locator('[data-shortcut-id="reader.tool.highlight"]').evaluate(n=>n.style.display='');await page.waitForTimeout(120);
  check(await page.locator('[data-hint-id="reader.tool.highlight"]').getAttribute('data-hint-placement'),'adjacent','restored control regains nearby hint');
  await page.keyboard.up('Control');await page.waitForTimeout(180);
  await page.keyboard.down('Control');await page.keyboard.up('Control');await page.waitForTimeout(200);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).opacity),'0','quick Ctrl tap never leaves overlay visible');
  check(errors,[],'no browser console/page errors');
} finally {
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({checks,errors,kind:'real-browser-component-harness-not-native-desktop'},null,2));
  await browser?.close();await server?.close();
}
console.log(`Shortcut browser verification passed: ${checks.length} checks`);
