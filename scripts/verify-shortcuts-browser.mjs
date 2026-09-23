import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const evidence = path.join(root,process.env.SHORTCUT_EVIDENCE_DIR || '.tmp/shots/shortcuts-browser'); fs.mkdirSync(evidence,{recursive:true});
const baseline=process.argv.includes('--baseline-hints');
const baselinePlugin={name:'baseline-shortcut-hints',enforce:'pre',resolveId(id,importer){
  if(!baseline || !importer?.endsWith('/ShortcutProvider.tsx')) return;
  if(id==='./ShortcutHints') return path.join(root,'.tmp/shortcuts-baseline/ShortcutHints.tsx');
  if(id==='./shortcuts.css') return path.join(root,'.tmp/shortcuts-baseline/shortcuts.css');
}};
if(baseline){
  fs.mkdirSync('.tmp/shortcuts-baseline',{recursive:true});
  for(const file of ['ShortcutHints.tsx','shortcuts.css','hintLayout.ts','hintKeycaps.ts']) {
    let content=execFileSync('git',['show',`c056588:src/shared/shortcuts/${file}`],{encoding:'utf8'});
    if(file.endsWith('.tsx')) content=content.replaceAll('../../core/','/src/core/').replaceAll("'./dispatcher'","'/src/shared/shortcuts/dispatcher'").replaceAll("'./store'","'/src/shared/shortcuts/store'");
    fs.writeFileSync(`.tmp/shortcuts-baseline/${file}`,content);
  }
}
let browser, server; const errors=[],checks=[];
const check=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks.push(label);if(process.env.SHORTCUT_TEST_TRACE)console.log('PASS',checks.length,label);};
try {
  // Static harness: scan only its entry and avoid watching parallel worktrees/build outputs.
  server=await createServer({root,cacheDir:path.join(root,'.tmp/shortcuts-browser-vite'),configFile:false,optimizeDeps:{entries:['scripts/fixtures/shortcuts.tsx']},plugins:[baselinePlugin,react(),{name:'shortcut-harness',configureServer(s){s.middlewares.use('/__shortcuts',async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__shortcuts','<html><head><link rel="icon" href="data:,"><style>:root{--ink:#243b31;--surface:#fff;--muted:#64746c;--line:#bbc8bf;--accent:#48835d}body{margin:0;font:14px Georgia,serif}button{margin:3px}</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/shortcuts.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
  await server.listen(); const port=server.httpServer.address().port;
  const exe = process.env.SHORTCUT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(exe,'Set SHORTCUT_CHROME to an installed browser executable');
  browser=await chromium.launch({executablePath:exe,headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}/__shortcuts`); await page.waitForFunction(()=>window.__shortcutsTest?.store.commands().length>20); await page.bringToFront();
  const events=()=>page.evaluate(()=>window.__shortcutsTest.events.splice(0));
  const key=async(combo,selector='#canvas')=>{await page.locator(selector).focus();await page.keyboard.press(combo);return events();};
  check(await key('Control+h'),['highlight'],'one dispatch under StrictMode');
  for(const selector of ['#input','#textarea','#select','#editable','#cm']) check(await key('Control+z',selector),[],selector+' protects undo');
  check(await key('Control+Alt+Enter','#textarea'),['reader.notes.mode.focus'],'writing command explicit editable opt-in');
  check(await key('Control+='),[],'legacy PDF zoom key removed');check(await key('Control+-'),[],'legacy PDF zoom-out key removed');
  check(await key('Control+Alt+='),[],'legacy UI zoom key removed');check(await key('Control+Alt+0'),[],'legacy UI reset key removed');
  check(await key('Control+F1'),['file-source'],'source view shortcut');
  check(await key('Control+F2'),['file-translated'],'translated view shortcut');
  check(await key('Control+F3'),['file-parallel'],'parallel view shortcut');
  check(await page.locator('[data-file-mode="parallel"]').getAttribute('aria-pressed'),'true','view switch updates selected control');
  check(await page.locator('[data-file-mode="parallel"]').getAttribute('aria-keyshortcuts'),'Control+F3','view switch is discoverable on toolbar');
  await page.evaluate(()=>window.__shortcutsTest.setHasTranslation(false));
  await page.waitForFunction(()=>document.querySelector('[data-file-mode="translated"]')?.disabled);
  check(await key('Control+F2'),[],'translation absent disables translated shortcut');
  check(await key('Control+F3'),[],'translation absent disables comparison shortcut');
  await page.evaluate(()=>window.__shortcutsTest.setHasTranslation(true));
  await page.waitForFunction(()=>!document.querySelector('[data-file-mode="translated"]')?.disabled);
  await page.locator('#canvas').hover();await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');
  check(await events(),['pdf-zoom'],'Ctrl+wheel outside PDF page zooms reader PDF');
  const inputWheelConsumed=await page.evaluate(()=>{const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:100});document.getElementById('input').dispatchEvent(event);return event.defaultPrevented;});
  check(inputWheelConsumed,true,'Ctrl+wheel over an input does not zoom the browser');
  check(await events(),['pdf-zoom'],'Ctrl+wheel over an input still zooms the reader');
  const pdfOwnsWheel=await page.evaluate(()=>{const n=document.createElement('div');n.className='pdf-document';document.body.append(n);const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120});n.dispatchEvent(event);n.remove();return event.defaultPrevented;});
  check(pdfOwnsWheel,true,'Ctrl+wheel inside PDF document never reaches browser zoom');
  check(await events(),[],'PDF native wheel handler is not double-dispatched');
  await page.getByRole('button',{name:'Modal',exact:true}).click();
  const modalWheelConsumed=await page.evaluate(()=>{const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:100});document.querySelector('[role="dialog"]').dispatchEvent(event);return event.defaultPrevented;});
  check(modalWheelConsumed,true,'modal Ctrl+wheel cannot zoom the browser');check(await events(),[],'modal wheel cannot zoom the reader');
  await page.getByRole('button',{name:'Modal',exact:true}).click();
  const hiddenModalWheel=await page.evaluate(()=>{const n=document.createElement('div');n.role='dialog';n.setAttribute('aria-modal','true');n.hidden=true;document.body.append(n);const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120});document.getElementById('canvas').dispatchEvent(event);n.remove();return event.defaultPrevented;});
  check(hiddenModalWheel,true,'invisible dialog cannot block Ctrl+wheel');check(await events(),['pdf-zoom'],'hidden modal does not intercept reader zoom');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.locator('#canvas').hover();await page.keyboard.down('Control');await page.mouse.wheel(0,120);await page.keyboard.up('Control');
  check(await events(),['ui-zoom'],'Ctrl+wheel outside reader zooms interface');
  await page.getByRole('button',{name:'Reader',exact:true}).click();
  await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(200);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).pointerEvents),'none','hints never intercept pointers');
  check(await page.locator('.shortcut-hints').getAttribute('aria-hidden'),'true','hints do not duplicate accessible controls');
  check(await page.locator('.shortcut-hint-panel').count(),0,'spec2: boxed command list removed');
  check(await page.locator('[data-hint-id] .shortcut-hint-keys kbd').count()>30,true,'spec3: real keycaps instead of plain text');
  check(await page.locator('[data-hint-placement="adjacent"] .shortcut-hint-label').count(),0,'spec3: button hints do not repeat action names');
  check(await page.locator('[data-hint-id="reader.undo"] .shortcut-hint-label').innerText(),'撤销标注','spec3: unanchored keys have real action on their right');
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-keys').textContent(),'H','primary effective binding by its button');
  check(await page.locator('[data-hint-id="reader.zoomIn"]').getAttribute('data-hint-placement'),'adjacent','right-side zoom no longer relegated to panel');
  check(await page.locator('[data-hint-id="reader.zoomIn"] .shortcut-hint-keys').textContent(),'滚轮↑','reader zoom hint shows fixed Ctrl+wheel gesture');
  check(await page.locator('[data-hint-id="reader.file.parallel"] .shortcut-hint-keys').textContent(),'F3','file mode hint appears beside control');
  check((await page.locator('[data-shortcut-id="reader.zoomIn"]').getAttribute('title')).includes('Ctrl+鼠标滚轮向上'),true,'zoom tooltip matches wheel gesture');
  const backdrop=await page.locator('[data-hint-id="reader.undo"]').evaluate(n=>{const s=getComputedStyle(n,'::before');return {content:s.content,background:s.backgroundColor,blur:s.backdropFilter};});
  check(backdrop.content!=='none'&&backdrop.background!=='rgba(0, 0, 0, 0)'&&backdrop.blur.includes('blur('),true,'floating action hints have translucent frosted backing');
  check(await page.locator('[data-hint-id="reader.undo"] kbd').first().evaluate(n=>getComputedStyle(n).backdropFilter.includes('blur(')),true,'keycaps also shield document text');
  await page.screenshot({path:path.join(evidence,'01-reader-hints.png')});
  const initialSize=await page.locator('[data-hint-id="reader.tool.highlight"] kbd').evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),height:n.getBoundingClientRect().height}));
  fs.writeFileSync(path.join(evidence,'initial-size.json'),JSON.stringify(initialSize));
  check(initialSize.font>=16 && initialSize.height>=28,true,'size regression: readable 16px / >=28px dock keycap');
  check(await page.locator('[data-hint-placement="adjacent"] kbd').allTextContents().then(keys=>keys.includes('Ctrl')),false,'spec4: no repeated Ctrl on button hints');
  check(await page.locator('[data-hint-id="reader.undo"] .shortcut-hint-keys').textContent(),'Ctrl+Z','floating hints keep full combination');
  await page.keyboard.up('Control');await page.waitForTimeout(180);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).opacity),'0','release hides hints');
  check(await page.locator('[data-shortcut-row="reader.zoomIn"] .shortcut-keycaps').getAttribute('aria-label'),'Ctrl+鼠标滚轮向上','settings display fixed zoom gesture');
  check(await page.locator('[data-shortcut-row="reader.zoomIn"] button').count(),0,'fixed wheel gesture cannot be recorded or cleared');
  check((await page.locator('.shortcut-editor-lead').innerText()).includes('Ctrl + 鼠标滚轮'),true,'settings instructions use wheel instead of old zoom keys');
  // The fixture renders a standalone editor and mock canvas together; the real
  // app opens settings above the dock in a modal. Hide only the mock dock for
  // editing, then restore it for the dedicated anchor/occlusion geometry matrix.
  await page.locator('#tool-dock').evaluate(n=>n.style.visibility='hidden');
  const row=page.locator('[data-shortcut-row="reader.tool.highlight"]');
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.keyboard.press('Control+u');
  check(await row.locator('.shortcut-editor-inline-feedback').getByRole('alert').count(),1,'conflict visible');
  check(await page.evaluate(()=>window.__shortcutsTest.store.recording),true,'dispatcher paused while confirming');
  check(await events(),[],'recorder chord did not dispatch');
  await page.getByRole('button',{name:'取消',exact:true}).click();check(await key('Control+h'),['highlight'],'cancel preserves mapping');
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.keyboard.press('Control+u');await page.getByRole('button',{name:'替换并保存'}).click();
  check(await key('Control+u'),['highlight'],'replace executes selected command');check(await key('Control+h'),[],'old key inactive');
  check(await page.locator('[data-shortcut-row="reader.tool.underline"] .shortcut-keycaps-empty').innerText(),'未绑定','conflicting default removed');
  check(await page.locator('[data-shortcut-id="reader.tool.highlight"]').getAttribute('aria-keyshortcuts'),'Control+U','ARIA reflects override');
  await page.reload();await page.waitForFunction(()=>window.__shortcutsTest?.store.commands().length>20);await page.locator('#tool-dock').evaluate(n=>n.style.visibility='hidden');check(await key('Control+u'),['highlight'],'reload restores override');
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.keyboard.press('Delete');await row.getByRole('button',{name:/保存/}).click();check(await key('Control+u'),[],'Delete clears mapping');
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.keyboard.press('Escape');check(await row.locator('.shortcut-inline-capture').count(),0,'Escape cancels recorder');
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));check(await row.locator('.shortcut-inline-capture').count(),0,'blur cancels recorder');
  await page.getByRole('checkbox',{name:'按物理键位识别',exact:false}).check();
  await row.getByRole('button',{name:'更改',exact:true}).click();await page.keyboard.press('Control+Shift+F9');await row.getByRole('button',{name:/保存/}).click();
  check(await page.evaluate(()=>window.__shortcutsTest.store.overrides.bindings['reader.tool.highlight'][0].code),'F9','physical code recorded');
  check(await key('Control+Shift+F9'),['highlight'],'physical code dispatched');
  await row.getByRole('button',{name:/^恢复.+默认快捷键$/}).click();await row.getByRole('button',{name:/保存/}).click();
  check(await page.evaluate(()=>Object.hasOwn(window.__shortcutsTest.store.overrides.bindings,'reader.tool.highlight')),false,'single default reset removes override for future defaults');
  await page.getByRole('checkbox',{name:'按物理键位识别',exact:false}).uncheck();
  const cdp=await page.context().newCDPSession(page);
  const side=async()=>{await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:60,y:140,button:'back',buttons:8,clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:60,y:140,button:'back',buttons:0,clickCount:1});};
  await row.getByRole('button',{name:'更改',exact:true}).click();await side();await row.getByRole('button',{name:/保存/}).click();
  check(await row.locator('.shortcut-keycaps').getAttribute('aria-label'),'鼠标后退键','side mouse recorded in real DOM');
  check(await row.locator('.shortcut-keycaps kbd').innerText(),'M4','settings use the shared short side-key label');
  await page.locator('#canvas').focus();await side();check(await events(),['highlight'],'side mouse executes once');
  await cdp.detach();
  await page.getByRole('button',{name:'恢复本组默认'}).click();await page.getByRole('button',{name:'确认恢复'}).click();check(await key('Control+h'),['highlight'],'group reset');check(await key('Control+u'),['underline'],'reset restores conflict victim');
  await page.getByRole('button',{name:'Library',exact:true}).click();check(await key('Control+h'),[],'scene isolation');check(await key('Control+f'),['library-search'],'library search preserved');
  await page.getByRole('button',{name:'恢复本组默认'}).click();await page.getByRole('button',{name:'确认恢复'}).click();check(await page.getByRole('alert').allTextContents(),[],'default library/reader CtrlF not false conflict');
  await page.getByRole('button',{name:'Reader',exact:true}).click();check(await key('Control+f'),['pdf-search'],'reader search preserved');
  await page.getByRole('button',{name:'Modal',exact:true}).click();check(await key('Control+h'),[],'modal protection');await page.getByRole('button',{name:'Modal',exact:true}).click();
  await page.setViewportSize({width:800,height:600});await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).transitionDuration),'0s','reduced motion');
  await page.screenshot({path:path.join(evidence,'02-narrow-hints.png')});await page.keyboard.up('Control');
  await page.screenshot({path:path.join(evidence,'03-reader-editor.png')});
  // Reader canvas geometry: the standalone editor test form is not a Reader overlay.
  await page.locator('.shortcut-editor').evaluate(n=>n.hidden=true);
  await page.locator('#tool-dock').evaluate(n=>n.style.visibility='');
  // Geometry is checked on the actual rendered hints at both CSS viewport sizes
  // and application zoom levels; no synthetic screenshot composition.
  for (const variant of ['default','long-mouse']) for (const theme of ['light','dark']) for (const [width,height] of [[800,600],[1280,800]]) for (const zoom of [.8,1,1.25,1.5]) {
    await page.evaluate(({variant,theme})=>{const s=window.__shortcutsTest.store; s.save({schemaVersion:1,bindings:variant==='default'?{}:{'reader.tool.highlight':[{type:'keyboard',key:'F9',ctrl:true,alt:true,shift:true}],'reader.tool.underline':[{type:'mouse',button:3}],'reader.tool.area':[{type:'mouse',button:4}]}});const r=document.documentElement;r.dataset.theme=theme;r.style.setProperty('--surface',theme==='dark'?'#202b27':'#fff');r.style.setProperty('--ink',theme==='dark'?'#e6ede8':'#243b31');}, {variant,theme});
    await page.setViewportSize({width,height});
    await page.evaluate(z=>{document.documentElement.style.zoom=String(z);document.documentElement.style.setProperty('--ui-zoom',String(z));},zoom);
    const dockBefore=await page.locator('#tool-dock').boundingBox();
    await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
    const geometry=await page.evaluate(()=>{
      const paintStyle=document.createElement('style');paintStyle.textContent='.shortcut-hints [data-hint-id] kbd { pointer-events: auto !important; }';document.head.append(paintStyle);
      const coveredKeys=[...document.querySelectorAll('[data-hint-id] kbd')].filter(n=>{const r=n.getBoundingClientRect();return [[r.left+4,r.top+4],[r.right-4,r.bottom-4],[r.left+r.width/2,r.top+r.height/2]].some(([x,y])=>document.elementFromPoint(x,y)!==n);}).length;
      paintStyle.remove();
      const nodes=[...document.querySelectorAll('.shortcut-key-hint')];
      const badges=nodes.map(n=>n.getBoundingClientRect());
      const controls=[...document.querySelectorAll('[data-shortcut-id],#a4note-live-dev-badge')].filter(n=>{
        const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0;
      }).map(n=>n.getBoundingClientRect());
      const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {coveredKeys,positions:nodes.map(n=>({id:n.dataset.hintId,placement:n.dataset.hintPlacement,visible:getComputedStyle(n).visibility,rect:n.getBoundingClientRect().toJSON(),keys:[...n.querySelectorAll('kbd')].map(k=>({text:k.textContent,rect:k.getBoundingClientRect().toJSON()}))})), density:document.querySelector('.shortcut-hints').dataset.floatingDensity,minDockFont:Math.min(...nodes.filter(n=>n.dataset.hintPlacement==='adjacent').flatMap(n=>[...n.querySelectorAll('kbd')]).map(n=>parseFloat(getComputedStyle(n).fontSize))), minFont:Math.min(...nodes.flatMap(n=>[...n.querySelectorAll('kbd')]).map(n=>parseFloat(getComputedStyle(n).fontSize))),minLabelFont:Math.min(...nodes.flatMap(n=>[...n.querySelectorAll('.shortcut-hint-label')]).map(n=>parseFloat(getComputedStyle(n).fontSize))),viewport:[innerWidth,innerHeight],outside:badges.filter(r=>r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1).length,
        hidden:nodes.filter(n=>getComputedStyle(n).visibility==='hidden').length,
        backgrounds:nodes.filter(n=>getComputedStyle(n).backgroundColor!=='rgba(0, 0, 0, 0)'||getComputedStyle(n).boxShadow!=='none'||getComputedStyle(n).borderTopWidth!=='0px').length,
        bareKeys:nodes.flatMap(n=>[...n.querySelectorAll('kbd')]).filter(k=>getComputedStyle(k).borderBottomWidth==='0px'||getComputedStyle(k).borderRadius==='0px').length,
        wrongLabels:nodes.filter(n=>{const label=n.querySelector('.shortcut-hint-label'),keys=n.querySelector('.shortcut-hint-keys');if(n.dataset.hintPlacement==='adjacent')return !!label;return !label||!label.textContent.trim()||label.getBoundingClientRect().left<keys.getBoundingClientRect().right;}).length,
        overlaps:badges.some((r,i)=>badges.slice(i+1).some(s=>overlap(r,s))),
        coversControl:badges.some(r=>controls.some(s=>overlap(r,s))),
        dockFloating:[...document.querySelectorAll('#tool-dock [data-shortcut-id]')].filter(n=>document.querySelector(`[data-hint-id="${n.dataset.shortcutId}"]`)?.dataset.hintPlacement!=='adjacent').length};
    });
    fs.writeFileSync(path.join(evidence,'geometry-current.json'),JSON.stringify({variant,theme,width,zoom,...geometry},null,2));
    if(geometry.coveredKeys)await page.screenshot({path:path.join(evidence,'failure.png')});
    check(geometry.minDockFont>=16 && geometry.minFont>=(geometry.density==='compact'?14:16) && geometry.minLabelFont>=(geometry.density==='compact'?14:15),true,`${variant}/${theme}/${width}/${zoom}: enlarged keys and action labels`);
    check(await page.locator('#tool-dock').boundingBox(),dockBefore,'overlay never changes dock geometry');
    if(variant==='long-mouse'){
      check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-keys').textContent(),'Alt+Shift+F9','long adjacent chord remains complete, no held Ctrl');
      check(await page.locator('[data-hint-id="reader.tool.underline"] kbd').innerText(),'M4','back short name');
      check(await page.locator('[data-hint-id="reader.tool.area"] kbd').innerText(),'M5','forward short name');
    }
    if(geometry.dockFloating||geometry.hidden){
      console.log('MEASURE',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-measure-id]')].map(n=>({id:n.dataset.measureId,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,keys:n.querySelector('.shortcut-hint-keys').getBoundingClientRect().width})))));
      console.log('FAILED GEOMETRY',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#tool-dock [data-shortcut-id]')].map(n=>{const r=n.getBoundingClientRect();const h=document.querySelector(`[data-hint-id="${n.dataset.shortcutId}"]`);return {id:n.dataset.shortcutId,rect:r.toJSON(),hint:h?.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,180)};}))));
      await page.screenshot({path:path.join(evidence,'failure.png')});
    }
    check(geometry.coveredKeys,0,`${width}x${height} zoom ${zoom}: keycaps are top-painted and not occluded`);
    check(geometry.outside,0,`${width}x${height} zoom ${zoom}: hints inside viewport`);
    check(geometry.hidden,0,`${width}x${height} zoom ${zoom}: every bound command displayed`);
    check(geometry.backgrounds,0,`${width}x${height} zoom ${zoom}: transparent text without boxes`);
    check(geometry.bareKeys,0,`${width} zoom ${zoom}: individual keys have keycap edges`);
    check(geometry.wrongLabels,0,`${width} zoom ${zoom}: only floating rows have right-hand action labels`);
    check(geometry.overlaps,false,`${width}x${height} zoom ${zoom}: hints do not overlap`);
    check(geometry.coversControl,false,`${width}x${height} zoom ${zoom}: no icons or DEV strip covered`);
    check(geometry.dockFloating,0,`${width}x${height} zoom ${zoom}: every dense toolbar button has adjacent key`);
    await page.screenshot({path:path.join(evidence,`geometry-${variant}-${theme}-${width}-${zoom}.png`)});await page.keyboard.up('Control');
  }
  check(await key('Control+Alt+Shift+F9'),['highlight'],'enlarged long chord dispatch unchanged');
  await page.evaluate(()=>window.__shortcutsTest.store.save({schemaVersion:1,bindings:{}}));
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
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-keys').textContent(),'Ctrl+H','hidden anchor restores full Ctrl binding');
  await page.locator('#tool-dock [data-shortcut-id="reader.tool.highlight"]').evaluate(n=>{n.style.display='';});await page.waitForTimeout(180);
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-label').count(),0,'restored button removes duplicate action name');
  check(await page.locator('[data-hint-id="reader.tool.highlight"] .shortcut-hint-keys').textContent(),'H','restored anchor uses compact binding again');
  await page.locator('[data-shortcut-id="reader.tool.highlight"]').evaluate(n=>n.style.display='none');await page.waitForTimeout(120);
  check(await page.locator('[data-hint-id="reader.tool.highlight"]').getAttribute('data-hint-placement'),'floating','hidden control becomes bare floating hint');
  await page.locator('[data-shortcut-id="reader.tool.highlight"]').evaluate(n=>n.style.display='');await page.waitForTimeout(120);
  check(await page.locator('[data-hint-id="reader.tool.highlight"]').getAttribute('data-hint-placement'),'adjacent','restored control regains nearby hint');
  await page.keyboard.up('Control');await page.waitForTimeout(180);
  await page.keyboard.down('Control');await page.keyboard.up('Control');await page.waitForTimeout(200);
  check(await page.locator('.shortcut-hints').evaluate(n=>getComputedStyle(n).opacity),'0','quick Ctrl tap never leaves overlay visible');
  await page.locator('#canvas').focus();await page.keyboard.down('Control');await page.waitForTimeout(180);
  for (const surface of ['tooltip','annotation-inline-actions','annotation-color-palette']) {
  const oldHint=await page.locator('[data-hint-id="reader.tool.highlight"]').boundingBox();
  await page.evaluate(({rect,surface})=>{const n=document.createElement('div');n.id='hint-obstacle';if(surface==='tooltip')n.role='tooltip';else n.className=surface;Object.assign(n.style,{position:'fixed',left:(rect.x-8)+'px',top:(rect.y-2)+'px',width:(rect.width+16)+'px',height:(rect.height+4)+'px',zIndex:'20000',background:'red'});document.body.append(n);},{rect:oldHint,surface});
  await page.waitForTimeout(180);
  const avoidsPopup=await page.evaluate(()=>{const o=document.getElementById('hint-obstacle').getBoundingClientRect();return [...document.querySelectorAll('[data-hint-id]')].every(n=>{const r=n.getBoundingClientRect();return r.right<=o.left||r.left>=o.right||r.bottom<=o.top||r.top>=o.bottom;});});
  check(avoidsPopup,true,`${surface}: whole higher-z popup surface avoids keycaps after reflow`);
  await page.locator('#hint-obstacle').evaluate(n=>n.remove());await page.waitForTimeout(180);
  }
  await page.keyboard.up('Control');await page.waitForTimeout(180);
  // A disabled row must mute its ink, not its entire glass card. Fading the
  // parent makes the PDF text show through the action label again.
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{window.__disabledProbe=window.__shortcutsTest.store.register('disabled-probe',[{
    id:'reader.disabledProbe',title:'不可用操作',group:'阅读',scope:{kind:'scene',sceneId:'reader'},
    defaultBindings:[{type:'keyboard',key:'F10',ctrl:true}],isEnabled:()=>false,
  }]);});
  await page.locator('#canvas').focus();await page.keyboard.down('Control');
  await page.waitForFunction(()=>document.querySelector('[data-hint-id="reader.disabledProbe"]')?.dataset.hintPlacement==='floating');
  const disabledGlass=await page.locator('[data-hint-id="reader.disabledProbe"]').evaluate(n=>({
    opacity:getComputedStyle(n).opacity,visible:getComputedStyle(n).visibility,
    background:getComputedStyle(n,'::before').backgroundColor,blur:getComputedStyle(n,'::before').backdropFilter,
  }));
  check(disabledGlass.opacity,'1','disabled floating row does not fade its glass card');
  check(disabledGlass.visible,'visible','disabled floating action remains visible');
  check(/0\.97/.test(disabledGlass.background)&&disabledGlass.blur.includes('blur(12px)'),true,'disabled floating row shields underlying PDF text');
  await page.keyboard.up('Control');await page.evaluate(()=>window.__disabledProbe());
  check(errors,[],'no browser console/page errors');
} finally {
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({checks,errors,kind:'real-browser-component-harness-not-native-desktop'},null,2));
  await browser?.close();await server?.close();
}
console.log(`Shortcut browser verification passed: ${checks.length} checks`);
