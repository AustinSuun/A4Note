// Task 97fcfb6c browser regression: the whiteboard renders the reader's annotation tools and
// shares their settings, and pointer-driven tools still land exactly on the cursor under root zoom.
// Fails on the previous tree: the board had its own swatch/width controls, no shared store, and
// separate rect/ellipse tools.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const dir = path.resolve('.tmp/annotation-tools-browser');
const evidence = path.join(process.cwd(), '.tmp', 'shots', 'annotation-tools', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const errors = [];
const results = [];
const checks = [];
const check = (name, value, detail) => { assert.ok(value, name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); checks.push(name); };

const boardPath = 'D:/vault/白板.a4board';
const boardDoc = { format: 'a4board', version: 1, id: 'b_tools', kind: 'whiteboard', title: '白板', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', links: [], elements: [] };
const files = { [boardPath]: JSON.stringify(boardDoc, null, 2) + '\n' };

fs.writeFileSync(path.join(dir, 'host.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';
import {BoardEditor} from '/src/features/board/BoardEditor';
import '/src/ui/styles/tokens.css';import '/src/ui/styles/workbench.css';import '/src/ui/styles/reader.css';import '/src/ui/styles/markdown.css';
const w=window as any;const files:Record<string,string>=${JSON.stringify(files)};const dirs=new Set(['D:/vault']);w.doc=()=>JSON.parse(files[${JSON.stringify(boardPath)}]);
const norm=(p:string)=>p.replace(/\\\\/g,'/');const parent=(p:string)=>norm(p).replace(/\\/[^/]+$/,'');const base=(p:string)=>norm(p).split('/').pop()!;
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{const r=args?.request??{};
if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;
if(command==='read_text_file'){const p=norm(r.path);if(!(p in files))throw new Error('文件不存在：'+r.path);return {path:r.path,content:files[p],byte_length:files[p].length,binary:false};}
if(command==='write_text_file'){files[norm(r.path)]=r.content;return;}
if(command==='list_directory_entries'){const p=norm(r.path);if(!dirs.has(p))throw new Error('目录不存在：'+r.path);const entries=[...dirs].filter(d=>parent(d)===p).map(d=>({name:base(d),path:d,is_directory:true,size:0,extension:''})).concat(Object.keys(files).filter(f=>parent(f)===p).map(f=>({name:base(f),path:f,is_directory:false,size:files[f].length,extension:base(f).split('.').pop()})));return {path:p,entries,truncated:false};}
throw Error('unexpected IPC '+command);}};
function Host(){return <div style={{position:'fixed',inset:0,display:'flex'}}><div data-board style={{flex:1,minWidth:0,display:'flex'}}><BoardEditor path=${JSON.stringify(boardPath)} name="白板.a4board" referenceText="[[白板.a4board]]"/></div></div>;}
createRoot(document.getElementById('root')!).render(<Host/>);`);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"/></head><body style="margin:0;overflow:hidden"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');

let server; let browser;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), path.dirname(path.dirname(require.resolve('react/package.json')))] }, watch: null }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 860 } })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/.tmp/annotation-tools-browser/index.html`);
  await page.locator('svg.board-canvas').first().waitFor({ timeout: 15000 });

  const toolbarTools = () => page.evaluate(() => [...document.querySelectorAll('[data-board] .annotation-toolbar [data-tool]')].map((b) => b.getAttribute('data-tool')));
  const stage = page.locator('[data-board] .board-stage');
  const elementCount = () => page.evaluate(() => document.querySelectorAll('[data-board] [data-element-id]').length);
  // 1. Same tool set as the reader's annotation toolbar (board drops the PDF-only highlight/underline/comment).
  check('board renders the reader tool set with shared ids', JSON.stringify(await toolbarTools()) === JSON.stringify(['select', 'hand', 'text', 'note', 'shape', 'arrow', 'pen', 'eraser']), await toolbarTools());
  check('board tool buttons use the shared annotation classes and colour dots', await page.evaluate(() => {
    const pen = document.querySelector('[data-board] [data-tool="pen"] .annotation-tool-color-dot');
    return Boolean(pen) && Boolean(document.querySelector('[data-board] .annotation-toolbar .annotation-tool-btn'));
  }));

  // 2. Option popover reuses the reader option panel (shared classes) with the shared ranges.
  await page.locator('[data-board] [data-tool="pen"]').click();
  await page.locator('[data-board] [data-tool="pen"]').click();
  await page.locator('.reader-tool-popover').waitFor({ timeout: 3000 });
  check('pen popover is the shared reader options panel', await page.evaluate(() => {
    const bar = document.querySelector('.reader-tool-popover .reader-tool-options-bar.tool-options-ink');
    if (!bar) return false;
    const range = bar.querySelector('input[type="range"]');
    return Boolean(range) && range.min === '1.5' && range.max === '10' && /画笔颜色/.test(bar.textContent ?? '');
  }));
  await page.keyboard.press('Escape');

  // 3. Colour change inside the panel updates the tool dot and is persisted for a second host.
  // The pen tool is already active here, so ONE click reopens its options panel.
  await page.locator('[data-board] [data-tool="pen"]').click();
  await page.locator('.reader-tool-popover .tool-option-color-row button[title="#d92d20"]').click();
  await page.waitForTimeout(100);
  check('chosen colour shows on the tool dot and lands in the shared store', await page.evaluate(() => {
    const dot = document.querySelector('[data-board] [data-tool="pen"] .annotation-tool-color-dot');
    const stored = JSON.parse(localStorage.getItem('aster.annotationTools.toolColors.v1') ?? '{}');
    return dot instanceof HTMLElement && dot.style.background.includes('rgb(217, 45, 32)') && stored.ink === '#d92d20';
  }));
  check('a fresh store instance (as the reader would create) reads the same colour', await page.evaluate(async () => {
    const mod = await import('/src/features/annotationTools/toolSettings.ts');
    return mod.annotationToolStore().getToolColors().ink === '#d92d20';
  }));
  await page.keyboard.press('Escape');

  // 4. One 图形 tool with the shared rect/ellipse kind (old tree had separate rect/ellipse buttons).
  check('old separate rect/ellipse buttons are gone', await page.evaluate(() => !document.querySelector('[data-board] [data-tool="rect"], [data-board] [data-tool="ellipse"]')));
  await stage.focus();
  await page.keyboard.press('o');
  check('O selects the shared shape tool with ellipse kind', await page.evaluate(() => {
    const shape = document.querySelector('[data-board] [data-tool="shape"]');
    return shape?.getAttribute('aria-pressed') === 'true' && JSON.parse(localStorage.getItem('aster.reader.annotationToolSettings.v1')).shapeKind === 'ellipse';
  }));
  await page.keyboard.press('r');
  await page.waitForTimeout(50);
  const countBeforeInk = await elementCount();

  // 5. Pointer accuracy under root zoom 125%: pen stroke starts on the pointer; shape corners follow.
  await page.evaluate(() => { document.documentElement.style.zoom = '125%'; });
  await page.waitForTimeout(150);
  const canvas = await page.evaluate(() => { const r = document.querySelector('[data-board] svg.board-canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const mark = (x, y) => page.evaluate(([x, y]) => { const zoom = Number.parseFloat(document.documentElement.style.zoom); const dot = document.createElement('div'); dot.className = 'verify-pointer-mark'; dot.style.cssText = `position:fixed;left:${x / zoom}px;top:${y / zoom}px;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#e11d48;box-shadow:0 0 0 2px #fff;z-index:99999;pointer-events:none;`; document.body.appendChild(dot); }, [x, y]);
  const shot = (name) => page.screenshot({ path: path.join(evidence, name) });
  const unmark = () => page.evaluate(() => document.querySelectorAll('.verify-pointer-mark').forEach((n) => n.remove()));

  // pen stroke
  await stage.focus();
  await page.keyboard.press('p');
  const from = { x: Math.round(canvas.left + canvas.width * 0.45), y: Math.round(canvas.top + canvas.height * 0.5) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) await page.mouse.move(from.x + step * 30, from.y + step * 16);
  await page.mouse.up();
  await page.waitForFunction((count) => document.querySelectorAll('[data-board] [data-element-id]').length > count, countBeforeInk, { timeout: 4000 });
  const ink = await page.evaluate(() => { const nodes = document.querySelectorAll('[data-board] [data-element-id]'); const r = nodes[nodes.length - 1].getBoundingClientRect(); return { left: r.left, top: r.top }; });
  results.push({ tool: 'pen', from, ink, dx: Number((ink.left - from.x).toFixed(2)), dy: Number((ink.top - from.y).toFixed(2)) });
  await mark(from.x, from.y);
  await shot('tools-125-pen.png');
  await unmark();
  check('pen starts on the pointer at 125% zoom', Math.abs(results[0].dx) <= 1 && Math.abs(results[0].dy) <= 1, results[0]);

  // shape follows both corners
  await stage.focus();
  await page.keyboard.press('r');
  const countBeforeShape = await elementCount();
  const s1 = { x: Math.round(canvas.left + canvas.width * 0.55), y: Math.round(canvas.top + canvas.height * 0.55) };
  const s2 = { x: s1.x + 140, y: s1.y + 90 };
  await page.mouse.move(s1.x, s1.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) await page.mouse.move(s1.x + (s2.x - s1.x) * step / 5, s1.y + (s2.y - s1.y) * step / 5);
  await page.mouse.up();
  await page.waitForFunction((count) => document.querySelectorAll('[data-board] [data-element-id]').length > count, countBeforeShape, { timeout: 4000 });
  const shape = await page.evaluate(() => { const nodes = document.querySelectorAll('[data-board] [data-element-id]'); const r = nodes[nodes.length - 1].getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
  const slack = 2 * 1.25 + 1;
  const shapeRecord = { tool: 'shape', from: [s1.x, s1.y], to: [s2.x, s2.y], shape: [Math.round(shape.left), Math.round(shape.top), Math.round(shape.right), Math.round(shape.bottom)], dx: Number((shape.left - s1.x).toFixed(2)), dy: Number((shape.top - s1.y).toFixed(2)), dx2: Number((shape.right - s2.x).toFixed(2)), dy2: Number((shape.bottom - s2.y).toFixed(2)) };
  results.push(shapeRecord);
  await mark(s1.x, s1.y); await mark(s2.x, s2.y);
  await shot('tools-125-shape.png');
  await unmark();
  check('shape corners follow the pointer at 125% zoom', Math.abs(shapeRecord.dx) <= slack && Math.abs(shapeRecord.dy) <= slack && Math.abs(shapeRecord.dx2) <= slack && Math.abs(shapeRecord.dy2) <= slack, shapeRecord);

  // text insertion point: the editor's centre lands on the click (default box is centred)
  await stage.focus();
  await page.keyboard.press('t');
  const t1 = { x: Math.round(canvas.left + canvas.width * 0.3), y: Math.round(canvas.top + canvas.height * 0.3) };
  await page.mouse.click(t1.x, t1.y);
  await page.locator('.board-text-editor').waitFor({ timeout: 3000 });
  const editor = await page.evaluate(() => { const r = document.querySelector('.board-text-editor').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const textRecord = { tool: 'text', at: [t1.x, t1.y], editor: [Math.round(editor.left), Math.round(editor.top)], dx: Number((editor.left + editor.width / 2 - t1.x).toFixed(2)), dy: Number((editor.top + editor.height / 2 - t1.y).toFixed(2)) };
  results.push(textRecord);
  await mark(t1.x, t1.y);
  await shot('tools-125-text.png');
  await unmark();
  check('text editor opens at the click point at 125% zoom', Math.abs(textRecord.dx) <= slack && Math.abs(textRecord.dy) <= slack, textRecord);
  await page.keyboard.press('Escape');

  // eraser removes with reach from the shared thickness
  const countBeforeErase = await elementCount();
  await stage.focus();
  await page.keyboard.press('e');
  await page.mouse.click(Math.round((s1.x + s2.x) / 2), Math.round((s1.y + s2.y) / 2));
  await page.waitForFunction((count) => document.querySelectorAll('[data-board] [data-element-id]').length < count, countBeforeErase, { timeout: 4000 });
  check('eraser removes the shape under the cursor', true);

  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  check('no console/page errors', errors.length === 0, errors.slice(0, 3));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, results, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence, checks: checks.length, results }, null, 1));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: false, error: String(error), results, checks, errors }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
