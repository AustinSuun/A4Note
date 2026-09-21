// Real React/Chromium lifecycle tests plus the current PdfReader finish callback.
// This is an isolated component test, not native-app/SQLite acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = process.cwd();
const dir = path.join(root, '.tmp', 'reader-shape-cancel');
await fs.mkdir(dir, { recursive: true });
const source = await fs.readFile('src/features/reader/pdf/PdfReader.tsx', 'utf8');
const ast = ts.createSourceFile('PdfReader.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let finishSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'finishShapeAnnotation') finishSource = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(finishSource, 'extract production finish callback, not a test reimplementation');
const harness = `
import React, { useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { usePdfShapeDraft } from '/src/features/reader/pdf/usePdfShapeDraft';
import { normalizeBox, numberValue } from '/src/features/reader/pdf/pdfGeometry';
import { arrowPositionFromDrag } from '/src/features/reader/pdf/pdfInteraction';
import { buildAnnotationDraft, annotationLabel } from '/src/features/reader/pdf/pdfAnnotationHelpers';
import { textSelectionFromDrag } from '/src/features/reader/pdf/pdfSelection';
const saved = [];
let completed = 0;
const root = createRoot(document.getElementById('root'));
function Harness() {
  const [activeTool, setTool] = useState('rect');
  const [documentKey, setKey] = useState('first');
  const { draft: dragDraft, setDraft: setDragDraft, takeDraft: takeDragDraft } = usePdfShapeDraft(documentKey, activeTool);
  const shapeToolsActive = ['rect','arrow','area'].includes(activeTool);
  const activeAnnotationColor = 'yellow';
  const pages = [];
  const toolSettings = { shapeKind:'rect', shapeFillEnabled:false, shapeStrokeWidth:2, arrowStyle:'solid', arrowEnding:'arrow', arrowStrokeWidth:2 };
  const onCompleteOneShotTool = () => { completed++; };
  const saveAnnotationDraft = async (draft) => { saved.push(draft); };
  const finishShapeAnnotation = ${finishSource};
  window.testApi = {
    start: (zero = false) => setDragDraft({page:1,startX:10,startY:10,currentX:zero?10:40,currentY:zero?10:30}),
    move: () => setDragDraft(d => d ? {...d,currentX:55} : d),
    finish: finishShapeAnnotation,
    saved, get completed() { return completed; }, get draft() { return dragDraft; },
    configure: (tool, key = 'first') => {setTool(tool);setKey(key);},
    unmount: () => root.unmount(),
  };
  return <main><h1>Isolated shape-cancel component regression</h1><p>Not native app acceptance; persistence callback is a spy.</p>
    <div id="surface" tabIndex={0} onMouseDown={() => window.testApi.start()} onMouseMove={() => window.testApi.move()} onMouseUp={finishShapeAnnotation}
      style={{width:600,height:260,background:'#eee',position:'relative'}}>
      {dragDraft && <div id="draft" style={{position:'absolute',left:60,top:40,width:200,height:100,border:'2px solid green',pointerEvents:'none'}} />}
    </div>
    <input id="input" aria-label="Independent input" />
    <div id="editor" contentEditable suppressContentEditableWarning tabIndex={0}>Inline text editor</div>
    <output id="state">{dragDraft?'draft':'empty'} / {activeTool} / {documentKey}</output>
  </main>;
}
root.render(<StrictMode><Harness /></StrictMode>);
`;
await fs.writeFile(path.join(dir, 'harness.tsx'), harness);
await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="./harness.tsx"></script></body></html>');
const results = [];
const errors = [];
let browser, server;
try {
  server = await createServer({ root, configFile:false, server:{host:'127.0.0.1',port:0}, esbuild:{jsx:'automatic'}, logLevel:'error' });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  const page = await browser.newPage({viewport:{width:1000,height:700}});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}/.tmp/reader-shape-cancel/index.html`);
  await page.waitForFunction(() => window.testApi);
  async function check(name, run) { await run(); results.push(name); console.log('PASS '+name); }
  const count = () => page.evaluate(() => window.testApi.saved.length);
  const start = async (zero=false) => {await page.evaluate(z=>window.testApi.start(z),zero);await page.waitForSelector('#draft');};
  const finish = () => page.evaluate(() => window.testApi.finish());
  for (const tool of ['rect','arrow','area']) {
    await page.evaluate(t=>window.testApi.configure(t),tool);
    await page.waitForFunction(t=>document.querySelector('#state').textContent.includes(t),tool);
    await check(tool+': Escape removes preview and mouseup cannot persist', async()=>{
      const before = await count(); await page.locator('#surface').focus(); await start();
      await page.keyboard.press('Escape'); await page.waitForSelector('#draft',{state:'detached'});
      await finish();assert.equal(await count(),before);
    });
    await check(tool+': synchronous Escape then stale finish is cancelled',async()=>{
      const before=await count();await start();
      await page.evaluate(()=>{const staleFinish=window.testApi.finish;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.testApi.move();return staleFinish();});
      assert.equal(await count(),before);await page.waitForSelector('#draft',{state:'detached'});
    });
    await check(tool+': blur cancels without saving',async()=>{
      const before=await count();await start();
      await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));return window.testApi.finish();});
      assert.equal(await count(),before);await page.waitForSelector('#draft',{state:'detached'});
    });
    await check(tool+': zero-size click does not save',async()=>{const before=await count();await start(true);await finish();assert.equal(await count(),before);});
    await check(tool+': normal finish saves exactly once',async()=>{const before=await count();await start();await page.evaluate(async()=>{const f=window.testApi.finish;await f();await f();});assert.equal(await count(),before+1);});
  }
  await check('real mouse drag followed by Escape and mouse release',async()=>{
    const before=await count();const box=await page.locator('#surface').boundingBox();
    await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+180,box.y+100);
    await page.waitForSelector('#draft');await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await count(),before);await page.waitForSelector('#draft',{state:'detached'});
  });
  for(const selector of ['#input','#editor'])await check(selector+' keeps its Escape',async()=>{
    await start();await page.locator(selector).focus();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#draft').count(),1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  });
  for (const kind of ['composing','prevented','other-key']) await check(kind+' is not consumed',async()=>{
    await start();const consumed=await page.evaluate(k=>{const e=new KeyboardEvent('keydown',{key:k==='other-key'?'Enter':'Escape',cancelable:true,isComposing:k==='composing'});if(k==='prevented')e.preventDefault();window.dispatchEvent(e);return e.defaultPrevented;},kind);
    assert.equal(await page.locator('#draft').count(),1);assert.equal(consumed,kind==='prevented');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  });
  await check('document switch invalidates live draft',async()=>{const before=await count();await start();await page.evaluate(()=>window.testApi.configure('area','second'));await page.waitForSelector('#draft',{state:'detached'});await finish();assert.equal(await count(),before);});
  await check('tool switch invalidates live draft',async()=>{const before=await count();await start();await page.evaluate(()=>window.testApi.configure('arrow','second'));await page.waitForSelector('#draft',{state:'detached'});await finish();assert.equal(await count(),before);});
  await check('idle Escape is not swallowed',async()=>{assert.equal(await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'Escape',cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),false);});
  await page.screenshot({path:path.join(dir,'component-after.png')});
  await check('unmount removes listeners and invalidates stale finish',async()=>{
    await start();assert.deepEqual(await page.evaluate(async()=>{const a=window.testApi;const before=a.saved.length;a.unmount();const e=new KeyboardEvent('keydown',{key:'Escape',cancelable:true});window.dispatchEvent(e);await a.finish();return [e.defaultPrevented,a.saved.length-before];}),[false,0]);
  });
  assert.deepEqual(errors,[],'browser console and page errors');
} catch(error) { errors.push(error.stack || String(error)); process.exitCode=1; console.error(error); }
finally {
  await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({kind:'isolated React component; native SQLite not exercised',passed:results.length,results,errors},null,2));
  await browser?.close();await server?.close();
}
