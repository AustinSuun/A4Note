// Task ae61143f: fixed popovers / drag ghosts / board pointer mapping must follow the mouse under the root CSS zoom.
// Mounts the real FileTreePanel (mocked project FS) and BoardEditor, sets documentElement.style.zoom to
// 0.9 / 1 / 1.18 / 1.5 and right-clicks at the top, middle, bottom (≤ 40px from the edge) and right edge of the tree.
// Fails on the previous tree: the menu used to land at clientX/Y * zoom (and the hard-coded clamp made it worse).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const dir = path.resolve('.tmp/popover-zoom-browser');
const evidence = path.join(process.cwd(), '.tmp', 'shots', 'popover-zoom', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const errors = [];
const results = [];
const TOLERANCE = 2;

const boardPath = 'D:/vault/白板.a4board';
const boardDoc = { format: 'a4board', version: 1, id: 'b_zoom', kind: 'whiteboard', title: '白板', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', links: [], elements: [] };
const files = { [boardPath]: JSON.stringify(boardDoc, null, 2) + '\n' };
for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) files[`D:/vault/${name}.md`] = `# ${name}\n`;

fs.writeFileSync(path.join(dir, 'host.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';
import {FileTreePanel} from '/src/features/explorer/FileTreePanel';import {BoardEditor} from '/src/features/board/BoardEditor';import {setBoardWorkspaceRoot} from '/src/features/board/boardFiles';
import '/src/ui/styles/tokens.css';import '/src/ui/styles/workbench.css';import '/src/ui/styles/markdown.css';
const w=window as any;const files:Record<string,string>=${JSON.stringify(files)};const dirs=new Set(['D:/vault','D:/vault/decisions','D:/vault/research']);w.moves=[];
const norm=(p:string)=>p.replace(/\\\\/g,'/');const parent=(p:string)=>norm(p).replace(/\\/[^/]+$/,'');const base=(p:string)=>norm(p).split('/').pop()!;
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{const r=args?.request??{};
if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;
if(command==='read_text_file'){const p=norm(r.path);if(!(p in files))throw new Error('文件不存在：'+r.path);return {path:r.path,content:files[p],byte_length:files[p].length,binary:false};}
if(command==='write_text_file'){files[norm(r.path)]=r.content;return;}
if(command==='list_directory_entries'){const p=norm(r.path);if(!dirs.has(p))throw new Error('目录不存在：'+r.path);const entries=[...dirs].filter(d=>parent(d)===p).map(d=>({name:base(d),path:d,is_directory:true,size:0,extension:''})).concat(Object.keys(files).filter(f=>parent(f)===p).map(f=>({name:base(f),path:f,is_directory:false,size:files[f].length,extension:base(f).split('.').pop()})));return {path:p,entries,truncated:false};}
throw Error('unexpected IPC '+command);}};
setBoardWorkspaceRoot('D:/vault');
function Host(){return <div style={{position:'fixed',inset:0,display:'flex'}}>
 <div data-board style={{flex:1,minWidth:0,display:'flex'}}><BoardEditor path={${JSON.stringify(boardPath)}} name="白板.a4board" referenceText="[[白板.a4board]]"/></div>
 <div data-tree style={{width:300,flex:'0 0 300px',display:'flex',flexDirection:'column',borderLeft:'1px solid #ccc'}}><FileTreePanel rootPath="D:/vault" onOpenFile={()=>{}} onMoveEntry={(entry,dest)=>{w.moves.push([entry.path,dest]);}} onCreateFile={()=>{}} onCreateFolder={()=>{}} onRenameFile={()=>{}} onDeleteFile={()=>{}} onRevealFile={()=>{}}/></div>
</div>;}
createRoot(document.getElementById('root')!).render(<Host/>);`);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"/></head><body style="margin:0;overflow:hidden"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');

let server; let browser;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), path.dirname(path.dirname(require.resolve('react/package.json')))] }, watch: null }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/.tmp/popover-zoom-browser/index.html`);
  await page.addStyleTag({ content: '.file-tree-panel{height:100%;} .board-editor,.board-stage{min-height:0}' });
  await page.locator('.file-tree-row.file').first().waitFor({ timeout: 15000 });
  await page.locator('svg.board-canvas').first().waitFor({ timeout: 15000 });

  const view = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const menuRect = () => page.evaluate(() => {
    const menu = document.querySelector('.file-tree-context-menu');
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, flippedX: menu.getAttribute('data-flipped-x') === 'true', flippedY: menu.getAttribute('data-flipped-y') === 'true' };
  });
  const markPoint = (x, y, label) => page.evaluate(([x, y, label]) => {
    const dot = document.createElement('div');
    dot.className = 'verify-pointer-mark';
    // Fixed elements live in layout px: divide the viewport point by the zoom so the dot sits on the pointer.
    const zoom = Number.parseFloat(document.documentElement.style.zoom) || 1;
    dot.style.cssText = `position:fixed;left:${x / zoom}px;top:${y / zoom}px;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#e11d48;box-shadow:0 0 0 2px #fff;z-index:99999;pointer-events:none;`;
    dot.dataset.label = label;
    document.body.appendChild(dot);
  }, [x, y, label]);
  const clearMarks = () => page.evaluate(() => document.querySelectorAll('.verify-pointer-mark').forEach((n) => n.remove()));

  for (const zoom of [0.9, 1, 1.18, 1.5]) {
    await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    await page.waitForTimeout(150);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.file-tree-row.file[data-file-path$=".md"]')].map((row) => { const r = row.getBoundingClientRect(); return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 }; }));
    assert.ok(rows.length >= 3, 'tree rows rendered');
    const treeRect = await page.evaluate(() => { const r = document.querySelector('[data-tree]').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    const spots = [
      { label: 'top-row', x: rows[0].x, y: rows[0].y },
      { label: 'middle-row', x: rows[Math.floor(rows.length / 2)].x, y: rows[Math.floor(rows.length / 2)].y },
      { label: 'bottom-blank', x: treeRect.left + 40, y: view.height - 30 },
      { label: 'right-edge-blank', x: view.width - 12, y: Math.round((treeRect.top + view.height) / 2) },
    ];
    for (const spot of spots) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(30);
      // The blank spots must hit the scroll area itself (not a row) so the root-folder menu opens.
      const target = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className?.toString() ?? '', [spot.x, spot.y]);
      if (spot.label.endsWith('blank')) assert.ok(/file-tree-scroll|file-tree-tree/.test(target), `${spot.label} @${zoom} hits the tree background (${target})`);
      await page.mouse.click(spot.x, spot.y, { button: 'right' });
      await page.locator('.file-tree-context-menu').waitFor({ timeout: 3000 });
      await page.waitForTimeout(50);
      const rect = await menuRect();
      assert.ok(rect, `${spot.label} @${zoom}: menu rendered`);
      const dx = rect.flippedX ? rect.right - spot.x : rect.left - spot.x;
      const dy = rect.flippedY ? rect.bottom - spot.y : rect.top - spot.y;
      const inside = rect.left >= -0.5 && rect.top >= -0.5 && rect.right <= view.width + 0.5 && rect.bottom <= view.height + 0.5;
      const record = { zoom, spot: spot.label, pointer: [spot.x, spot.y], menu: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)], dx: Number(dx.toFixed(2)), dy: Number(dy.toFixed(2)), flippedX: rect.flippedX, flippedY: rect.flippedY, inside };
      results.push(record);
      await markPoint(spot.x, spot.y, spot.label);
      if (zoom === 1.18 || zoom === 1.5) await page.screenshot({ path: path.join(evidence, `menu-${Math.round(zoom * 100)}-${spot.label}.png`) });
      await clearMarks();
      assert.ok(Math.abs(dx) <= TOLERANCE && Math.abs(dy) <= TOLERANCE, `context menu follows the pointer ${JSON.stringify(record)}`);
      assert.ok(inside, `context menu stays inside the viewport ${JSON.stringify(record)}`);
      if (spot.label === 'right-edge-blank') assert.ok(rect.flippedX, `menu flips left at the right edge ${JSON.stringify(record)}`);
      if (spot.label === 'bottom-blank') assert.ok(rect.flippedY, `menu flips up at the bottom edge ${JSON.stringify(record)}`);
    }
    await page.keyboard.press('Escape');
    await page.locator('.file-tree-context-menu').waitFor({ state: 'detached', timeout: 3000 });

    // Drag ghost: 14px layout offset → 14 * zoom viewport px from the pointer.
    const start = rows[1];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Drag leftwards over the board so the ghost has room and is not edge-clamped.
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x - step * 70, start.y + step * 20);
    const target = { x: start.x - 420, y: start.y + 120 };
    await page.locator('.file-tree-drag-preview').waitFor({ timeout: 3000 });
    await page.waitForTimeout(50);
    const ghost = await page.evaluate(() => { const r = document.querySelector('.file-tree-drag-preview').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    const ghostRecord = { zoom, spot: 'drag-preview', pointer: [target.x, target.y], ghost: [Math.round(ghost.left), Math.round(ghost.top)], dx: Number((ghost.left - target.x - 14 * zoom).toFixed(2)), dy: Number((ghost.top - target.y - 14 * zoom).toFixed(2)) };
    results.push(ghostRecord);
    await markPoint(target.x, target.y, 'drag');
    if (zoom === 1.18) await page.screenshot({ path: path.join(evidence, 'drag-preview-118.png') });
    await clearMarks();
    assert.ok(Math.abs(ghostRecord.dx) <= TOLERANCE && Math.abs(ghostRecord.dy) <= TOLERANCE, `drag preview follows the pointer ${JSON.stringify(ghostRecord)}`);
    await page.mouse.move(40, 40);
    await page.mouse.up();
    await page.locator('.file-tree-drag-preview').waitFor({ state: 'detached', timeout: 3000 });

    // Board: a rectangle dragged from (x1,y1) must render with its top-left on (x1,y1).
    await page.locator('[data-board] .annotation-tool-btn[data-tool="shape"]').first().click();
    const canvas = await page.evaluate(() => { const r = document.querySelector('[data-board] svg.board-canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const before = await page.evaluate(() => document.querySelectorAll('[data-board] [data-element-id]').length);
    const from = { x: Math.round(canvas.left + canvas.width * 0.55), y: Math.round(canvas.top + canvas.height * 0.6) };
    const to = { x: from.x + 140, y: from.y + 90 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) await page.mouse.move(from.x + (to.x - from.x) * step / 5, from.y + (to.y - from.y) * step / 5);
    await page.mouse.up();
    await page.waitForFunction((count) => document.querySelectorAll('[data-board] [data-element-id]').length > count, before, { timeout: 3000 });
    const shape = await page.evaluate(() => { const nodes = document.querySelectorAll('[data-board] [data-element-id]'); const r = nodes[nodes.length - 1].getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    const strokeSlack = 2 * zoom + 1;
    const boardRecord = { zoom, spot: 'board-rect', from: [from.x, from.y], to: [to.x, to.y], shape: [Math.round(shape.left), Math.round(shape.top), Math.round(shape.right), Math.round(shape.bottom)], dx: Number((shape.left - from.x).toFixed(2)), dy: Number((shape.top - from.y).toFixed(2)), dx2: Number((shape.right - to.x).toFixed(2)), dy2: Number((shape.bottom - to.y).toFixed(2)) };
    results.push(boardRecord);
    await markPoint(from.x, from.y, 'board-from');
    await markPoint(to.x, to.y, 'board-to');
    if (zoom === 1.18) await page.screenshot({ path: path.join(evidence, 'board-rect-118.png') });
    await clearMarks();
    assert.ok(Math.abs(boardRecord.dx) <= strokeSlack && Math.abs(boardRecord.dy) <= strokeSlack && Math.abs(boardRecord.dx2) <= strokeSlack && Math.abs(boardRecord.dy2) <= strokeSlack, `board shape follows the pointer ${JSON.stringify(boardRecord)}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  assert.deepEqual(errors, [], 'no console/page errors');
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence, cases: results.length, maxMenuError: Math.max(...results.filter((r) => r.spot !== 'board-rect').map((r) => Math.max(Math.abs(r.dx), Math.abs(r.dy)))), maxBoardError: Math.max(...results.filter((r) => r.spot === 'board-rect').map((r) => Math.max(Math.abs(r.dx), Math.abs(r.dy), Math.abs(r.dx2), Math.abs(r.dy2)))) }, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: false, error: String(error), results, errors }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
