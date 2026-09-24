// Task 23671e62: real CodeMirror + native DEV evidence. Start isolated dev:live first.
// Defaults: --instance note-panel-xingxu --port 1493 --cdp-port 9293.
// NOTE_PANEL_CDP / NOTE_PANEL_URL can select another explicitly isolated instance.
import crypto from 'node:crypto';import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
const dir='.tmp/shots/note-panel-native/after';fs.mkdirSync(dir,{recursive:true});
const sourceFiles=['src/features/reader/ReaderScene.tsx','src/features/reader/ReaderNoteWorkbenchMenu.tsx','src/features/reader/noteWorkbench.ts','src/features/reader/useNoteWorkbench.ts','src/features/reader/reader-writing-layout.css','src/features/reader/ReaderMarkdown.tsx','src/features/reader/useReaderDrawerLayout.ts','src/features/explorer/MarkdownLivePreviewEditor.tsx','src/features/explorer/useNoteDockBounds.ts','src/workbench/TabHost.tsx','src/shared/shortcuts/dispatcher.ts','package.json','src-tauri/Cargo.toml','src-tauri/tauri.conf.json'];
const fingerprint=()=>Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex')]));
const source=fingerprint();
let b, p;
const errors=[],observations={},shots=[],checks=[];
const check=(value,name,detail)=>{checks.push({name,passed:!!value,detail});assert.ok(value,name+' '+JSON.stringify(detail??''));};
const visible=s=>p.locator(s).filter({visible:true}).first();const pause=()=>p.waitForTimeout(550);
const shot=async name=>{await p.getByText('原生已核验',{exact:false}).waitFor();await p.screenshot({path:dir+'/'+name+'.png'});shots.push(name);};
const geometry=()=>p.evaluate(()=>{const pick=s=>[...document.querySelectorAll(s)].find(e=>e.getBoundingClientRect().height&&e.checkVisibility());const card=pick('.reader-workspace-drawer'),scroller=pick('.reader-workspace-drawer .cm-scroller'),body=pick('.reader-workspace-drawer .cm-content'),panel=pick('.reader-workspace-drawer .workspace-panel-content');const rect=e=>e?e.getBoundingClientRect().toJSON():null;return {card:rect(card),scroller:rect(scroller),body:rect(body),padding:panel&&getComputedStyle(panel).padding,mode:pick('.reader-workspace-shell')?.dataset.noteMode};});
try {
 b=await chromium.connectOverCDP(process.env.NOTE_PANEL_CDP ?? 'http://127.0.0.1:9293');p=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(process.env.NOTE_PANEL_URL ?? 'http://127.0.0.1:1493'));assert.ok(p);p.setDefaultTimeout(30000);
 observations.consoleErrors=[];observations.httpFailures=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'){errors.push(m.text());observations.consoleErrors.push({text:m.text(),location:m.location()});}});
 p.on('response',r=>{if(r.status()>=400)observations.httpFailures.push({url:r.url(),status:r.status()});});
 await p.getByText('原生已核验',{exact:false}).waitFor();const paths=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_aster_paths'));assert.ok(paths.root.includes('app.aster.research.dev.note-panel-xingxu.'));
 assert.ok(fs.existsSync('.tmp/note-panel/fixture.json'),'Existing isolated fixture required; this driver never reseeds a library');
 const fixture=JSON.parse(fs.readFileSync('.tmp/note-panel/fixture.json','utf8'));assert.equal(fixture.paths.root,paths.root,'fixture belongs to this isolated library');
 await p.evaluate(id=>{const key='a4note.reader.noteWorkbench.'+id;const prefs=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...prefs,floating:{x:.35,y:.12,width:.42,height:.62}}));},fixture.id);
 await p.reload();await p.getByText('原生已核验',{exact:false}).waitFor();await p.bringToFront();await p.keyboard.press('Control+2');await p.getByText('Note Panel Fixture',{exact:true}).filter({visible:true}).first().dblclick();await visible('.reader-workspace-shell').waitFor();
 const session=await p.context().newCDPSession(p);await session.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});

 const mode=()=>visible('.reader-workspace-shell').getAttribute('data-note-mode');
 const choose=async next=>{await p.keyboard.press('Control+Alt+'+({floating:'4',split:'2',writing:'3',reading:'p'}[next]));await pause();};
 const edge=()=>visible('.reader-note-edge-handle');
 await choose('floating');await visible('.cm-content').waitFor();
 await p.evaluate(()=>window.__notePanelEditor=[...document.querySelectorAll('.reader-workspace-drawer .cm-content')].find(e=>e.checkVisibility()));
 for(const next of ['floating','split','writing']) {
  await choose(next);await choose('reading');check(await mode()==='reading',next+' closes');
  await edge().click();await pause();check(await mode()===next,next+' reopens in same mode');
  check(await p.evaluate(()=>window.__notePanelEditor?.isConnected&&window.__notePanelEditor.checkVisibility()),next+' retains editor DOM');
 }
 await choose('floating');await choose('reading');await p.reload();await p.getByText('原生已核验',{exact:false}).waitFor();await edge().click();await pause();check(await mode()==='floating','floating memory survives reload');
 // Genuine pointer long press and keyboard focus guidance, with no synthetic click substitute.
 await edge().hover();check(await visible('.reader-note-edge-hint').innerText()==='短按收起 · 长按切换模式','hover guidance');
 await p.mouse.move(20,20);await p.keyboard.press('Tab');await edge().focus();check(await visible('.reader-note-edge-hint').innerText()==='短按收起 · 长按切换模式','keyboard focus guidance');await shot('floating-keyboard-guidance');
 let r=await edge().boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.waitForTimeout(500);await p.mouse.up();await pause();check(await visible('.reader-note-workbench-menu').isVisible()&&await mode()==='floating','long press opens menu without collapsing');await shot('floating-long-press-menu');await p.keyboard.press('Escape');
 // All four arcs: unchanged drag and keyboard resizing, opposite corner stays anchored.
 for(const corner of ['nw','ne','sw','se']) {
  const control=visible('.reader-note-floating-corner[data-corner="'+corner+'"]');
  const before=(await geometry()).card;r=await control.boundingBox();const dx=corner.includes('w')?-12:12,dy=corner.includes('n')?-10:10;
  await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await p.mouse.up();await pause();
  const after=(await geometry()).card;check(after.width>before.width+5&&after.height>before.height+5,corner+' pointer grows card',{before,after});
  check(Math.abs((corner.includes('w')?before.right:before.left)-(corner.includes('w')?after.right:after.left))<2,corner+' opposite horizontal anchor');
  check(Math.abs((corner.includes('n')?before.bottom:before.top)-(corner.includes('n')?after.bottom:after.top))<2,corner+' opposite vertical anchor');
  await control.focus();await control.press(corner.includes('w')?'ArrowLeft':'ArrowRight');await pause();check((await geometry()).card.width>after.width+2,corner+' keyboard resize');
  const stroke=await control.evaluate(e=>getComputedStyle(e,'::before').borderTopWidth);check(stroke==='4px',corner+' 4px arc stroke');
 }
 // Fixed logical viewport keeps all requested modes available at each CSS UI scale.
 // This is not an OS multi-monitor/DPI certification.
 await session.send('Emulation.setDeviceMetricsOverride',{width:2400,height:1400,deviceScaleFactor:1,mobile:false});
 for(const theme of ['paper','midnight']) for(const zoom of [1,1.25,1.5]) {
  await p.evaluate(({theme,zoom})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.zoom=String(zoom);document.documentElement.style.setProperty('--ui-zoom',String(zoom));},{theme,zoom});await pause();
  for(const next of ['floating','split','writing']) {
   await choose(next);check(await mode()===next,theme+'/'+zoom+' actual '+next);
   const g=await geometry();observations[theme+'/'+zoom+'/'+next]=g;
   check(g.padding==='0px','no outer padding '+theme+'/'+zoom+'/'+next,g.padding);
   check(Math.abs(g.card.right-g.scroller.right)<=1.6*zoom,'right-edge scroller '+theme+'/'+zoom+'/'+next,g.card.right-g.scroller.right);
   check(g.body.width<=720*zoom+2,'readable inner width '+theme+'/'+zoom+'/'+next,g.body.width);
   const backgrounds=await visible('.reader-workspace-drawer .note-workspace').evaluate(e=>[getComputedStyle(e).backgroundColor,getComputedStyle(e.querySelector('.markdown-authoring-dock')).backgroundColor]);
   check(backgrounds.every(color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number);return theme==='midnight'?Math.max(...rgb)<128:Math.min(...rgb)>128;}),'theme-appropriate opaque surfaces '+theme+'/'+zoom+'/'+next,backgrounds);
   if(next==='writing')check(Math.abs((g.body.left+g.body.right)/2-(g.scroller.left+g.scroller.right)/2)<12*zoom,'writing body centered '+theme+'/'+zoom);
   check(g.scroller.height>120*zoom,'editor has usable height '+theme+'/'+zoom,g.scroller.height);
   if(next==='floating'){r=await edge().boundingBox();check(Math.abs(r.width-24*zoom)<2&&Math.abs(r.height-72*zoom)<2,'visible floating handle '+theme+'/'+zoom,r);await edge().hover();}
   else await p.mouse.move(20,20);
   await shot(theme+'-'+zoom+'-'+next);
  }
 }
 await p.evaluate(()=>{document.documentElement.style.zoom='1';document.documentElement.style.setProperty('--ui-zoom','1');document.documentElement.dataset.theme='paper';});
 await session.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});await choose('floating');
 await visible('.reader-workspace-drawer .cm-content').focus();await p.keyboard.press('Control+End');await pause();
 await visible('.reader-workspace-drawer .cm-scroller').evaluate(e=>e.scrollTop=e.scrollHeight);await pause();
 const end=await p.locator('.reader-workspace-drawer .cm-line').filter({visible:true,hasText:'最后一行'}).last().boundingBox();const dock=await visible('.reader-workspace-drawer .markdown-authoring-dock').boundingBox();
 check(end&&end.y+end.height<dock.y,'last line remains above bottom dock',{end,dock});await shot('floating-scroll-end');
 // Read-only article is also a full-width scroll shell, with centered readable prose.
 await choose('writing');await visible('.reader-workspace-drawer .note-view-switch').locator('button').nth(1).click();await pause();
 const preview=await visible('.reader-workspace-drawer .markdown-preview').boundingBox();const card=await visible('.reader-workspace-drawer').boundingBox();check(Math.abs(preview.x+preview.width-card.x-card.width)<2,'preview scroll shell reaches right edge');await shot('writing-preview');
 await visible('.reader-workspace-drawer .note-view-switch').locator('button').nth(0).click();await pause();
 await choose('split');await session.send('Emulation.setDeviceMetricsOverride',{width:1160,height:850,deviceScaleFactor:1,mobile:false});await pause();
 check(await mode()==='floating','narrow window temporarily floats');await edge().click();await pause();await edge().click();await pause();
 await session.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});await pause();check(await mode()==='split','wide window restores explicit split after temporary close/reopen');
 check(JSON.stringify(source)===JSON.stringify(fingerprint()),'product sources unchanged throughout native run');
 check(errors.length===0&&observations.httpFailures.length===0,'no pageerror, console.error or failed HTTP responses',{errors,httpFailures:observations.httpFailures});console.log(JSON.stringify({passed:checks.length,errors,shots}));
}catch(e){observations.failure=String(e.stack);if(p)await p.screenshot({path:dir+'/failed.png'}).catch(()=>{});throw e;}finally{if(p){await p.keyboard.up('Control').catch(()=>{});await p.keyboard.up('Alt').catch(()=>{});await p.evaluate(()=>{document.documentElement.style.zoom='1';document.documentElement.style.setProperty('--ui-zoom','1');document.documentElement.dataset.theme='paper';}).catch(()=>{});}fs.writeFileSync(dir+'/result.json',JSON.stringify({checks,observations,errors,shots,source},null,2));await b?.close();}
