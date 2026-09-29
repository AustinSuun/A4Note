// Task 1f8d8317: the merged 新建 menu, context menus for every file type and
// zoom-correct context-menu anchoring, driven against the REAL FileTreePanel with a mocked IPC.
// Old-code contract: the toolbar has no separate 新建白板 button (merged), non-markdown rows
// open the menu, the toolbar menu offers 新建笔记/新建白板.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const dir = path.join(root, '.tmp', 'tree-new-menu-browser');
const evidence = path.join(root, '.tmp', 'shots', 'tree-new-menu', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
fs.writeFileSync(path.join(dir, 'host.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {FileTreePanel} from '/src/features/explorer/FileTreePanel';import '/src/ui/styles/tokens.css';import '/src/ui/styles/workbench.css';
const w = window as any;
w.log = [];
const norm=(p:string)=>p.replace(/\\\\\\\\/g,'/');
w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{const r=args?.request??{};
if(command==='plugin:event|listen'||command==='plugin:event|unlisten')return 1;
if(command==='list_directory_entries'){const p=norm(r.path);if(p!=='D:/vault')throw new Error('目录不存在：'+r.path);
 const entries=[
  {name:'子',path:'D:/vault/子',is_directory:true,size:0,extension:''},
  {name:'论文.md',path:'D:/vault/论文.md',is_directory:false,size:12,extension:'md'},
  {name:'白板.a4board',path:'D:/vault/白板.a4board',is_directory:false,size:80,extension:'a4board'},
  {name:'page.html',path:'D:/vault/page.html',is_directory:false,size:30,extension:'html'},
  {name:'pic.png',path:'D:/vault/pic.png',is_directory:false,size:900,extension:'png'},
  {name:'paper.pdf',path:'D:/vault/paper.pdf',is_directory:false,size:4000,extension:'pdf'}];
 return {path:p,entries,truncated:false};}
throw Error('unexpected IPC '+command);}};
function App(){return <div data-tree style={{width:340,height:560,border:'1px solid #ccc'}}><FileTreePanel
  rootPath={'D:/vault'}
  onOpenFile={(e)=>w.log.push(['open',e.path])}
  onDeleteFile={(e)=>w.log.push(['delete',e.path])}
  onRenameFile={async(e,s)=>{w.log.push(['rename',e.path,s]);return {path:e.path,name:s+'.'+(e.path.split('.').pop()??'')};}}
  onRevealFile={(e)=>w.log.push(['reveal',e.path])}
  onCreateFile={async(p)=>{w.log.push(['createFile',p]);}}
  onCreateBoard={async(p)=>{w.log.push(['createBoard',p]);}}
  onCreateFolder={async(p)=>{w.log.push(['createFolder',p]);}}
  onMoveEntry={async()=>{}}
  activePath={'D:/vault/论文.md'}/></div>;}
createRoot(document.getElementById('root')!).render(<App/>);`);
let server, browser, checks = 0;
const failures = [];
const check = (ok, name, detail) => { if (!ok) failures.push(name + ' ' + JSON.stringify(detail ?? '')); else checks += 1; console.log((ok ? 'PASS ' : 'FAIL ') + name); };
try {
  server = await createServer({ configFile: false, root, cacheDir: path.join(dir, 'cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + server.config.server.port + '/.tmp/tree-new-menu-browser/index.html');
  await page.locator('[data-tree] .file-tree-row').first().waitFor();
  await page.addStyleTag({ content: '[data-tree] .file-tree-row{display:flex}[data-tree] .file-tree-name{min-width:0}' });

  // A: one merged trigger, no separate board icon button
  const toolbar = await page.evaluate(() => ({
    trigger: document.querySelectorAll('[data-tree] [data-create-trigger]').length,
    boardButton: document.querySelectorAll('[data-tree] .file-tree-toolbar [aria-label="新建白板"]').length,
    noteButton: document.querySelectorAll('[data-tree] .file-tree-toolbar [aria-label="新建笔记"]').length,
  }));
  check(toolbar.trigger === 1 && toolbar.boardButton === 0 && toolbar.noteButton === 0, 'toolbar has a single merged 新建 trigger (no separate 新建白板 icon button)', toolbar);

  // A: the menu offers 新建笔记 / 新建白板 and both fire their callbacks
  await page.locator('[data-tree] [data-create-trigger]').click();
  let menu = await page.evaluate(() => [...document.querySelectorAll('[data-tree] .file-tree-create-menu [role="menuitem"]')].map((b) => b.textContent?.trim()));
  check(JSON.stringify(menu) === JSON.stringify(['新建笔记', '新建白板']), 'the 新建 menu lists 新建笔记 / 新建白板', menu);
  await page.screenshot({ path: path.join(evidence, '01-create-menu.png') });
  await page.locator('[data-tree] .file-tree-create-menu [role="menuitem"]', { hasText: '新建白板' }).click();
  await page.waitForFunction(() => window.log.some((x) => x[0] === 'createBoard' && x[1] === 'D:/vault'), null, { timeout: 4000 });
  await page.locator('[data-tree] [data-create-trigger]').click();
  await page.locator('[data-tree] .file-tree-create-menu [role="menuitem"]', { hasText: '新建笔记' }).click();
  await page.waitForFunction(() => window.log.some((x) => x[0] === 'createFile' && x[1] === 'D:/vault'), null, { timeout: 4000 });
  check(true, 'menu items call onCreateBoard / onCreateFile with the tree root');

  // keyboard: Enter opens, ArrowDown moves into the items, Escape closes back on the trigger
  await page.locator('[data-tree] [data-create-trigger]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  const focusInMenu = await page.evaluate(() => (document.activeElement)?.textContent?.trim());
  check(focusInMenu === '新建笔记', 'Enter opens and ArrowDown focuses the first item', focusInMenu);
  await page.keyboard.press('Escape');
  const afterEsc = await page.evaluate(() => ({ open: Boolean(document.querySelector('[data-tree] .file-tree-create-menu')), focused: document.activeElement?.hasAttribute('data-create-trigger') }));
  check(!afterEsc.open && afterEsc.focused, 'Escape closes the menu and returns focus to the trigger', afterEsc);

  // C: every file type opens the context menu with the type-agnostic actions
  for (const name of ['白板.a4board', 'page.html', 'pic.png', 'paper.pdf', '论文.md']) {
    await page.locator(`[data-tree] [data-tree-row="D:/vault/${name}"]`).click({ button: 'right' });
    const state = await page.evaluate(() => {
      const menu = document.querySelector('.file-tree-context-menu');
      return { open: Boolean(menu), items: menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim()) : [] };
    });
    check(state.open && ['重命名', '在资源管理器中打开', '删除'].every((label) => state.items.some((t) => t?.includes(label))), `right-click ${name} opens the menu with rename/reveal/delete`, state.items);
    await page.keyboard.press('Escape');
  }
  // folder menu keeps the three create entries (compat)
  await page.locator('[data-tree] [data-tree-row="D:/vault/子"]').click({ button: 'right' });
  const folderItems = await page.evaluate(() => [...document.querySelectorAll('.file-tree-context-menu [role="menuitem"]')].map((b) => b.textContent?.trim()));
  check(['新建子文件夹', '新建笔记', '新建白板'].every((label) => folderItems.some((t) => t?.includes(label))), 'folder context menu offers 新建子文件夹/新建笔记/新建白板', folderItems);
  await page.keyboard.press('Escape');

  // B: zoom-correct anchoring (compat contract from ae61143f, kept green here)
  await page.evaluate(() => { document.documentElement.style.zoom = '118%'; });
  await page.waitForTimeout(150);
  await page.locator('[data-tree] [data-tree-row="D:/vault/论文.md"]').click({ button: 'right' });
  const anchored = await page.evaluate(() => {
    const row = document.querySelector('[data-tree] [data-tree-row="D:/vault/论文.md"]');
    const rect = row.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await page.mouse.click(anchored.x, anchored.y, { button: 'right' });
  const placed = await page.evaluate(() => { const menu = document.querySelector('.file-tree-context-menu'); const r = menu.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  check(Math.abs(placed.left - anchored.x) <= 2 && Math.abs(placed.top - anchored.y) <= 2, 'at 118% zoom the menu top-left sits on the pointer (≤2px)', { ...placed, ...anchored });
  await page.screenshot({ path: path.join(evidence, '02-zoom118-anchor.png') });
  await page.keyboard.press('Escape');
  // bottom-right edge: menu must stay inside the viewport
  await page.setViewportSize({ width: 560, height: 420 });
  await page.waitForTimeout(120);
  const corner = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-tree] [data-tree-row]')];
    const row = rows[rows.length - 1];
    const r = row.getBoundingClientRect();
    row.scrollIntoView({ block: 'center' });
    const r2 = row.getBoundingClientRect();
    return { x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2) };
  });
  await page.mouse.click(corner.x, corner.y, { button: 'right' });
  const edge = await page.evaluate(() => { const menu = document.querySelector('.file-tree-context-menu'); const r = menu.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
  check(edge.right <= edge.vw + 0.5 && edge.bottom <= edge.vh + 0.5 && edge.left >= 0 && edge.top >= 0, 'menu near the bottom-right edge stays inside the viewport', edge);
  await page.screenshot({ path: path.join(evidence, '03-edge-clamp.png') });

  check(errors.length === 0, 'no page errors', errors);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ checks, failures }, null, 2));
  if (failures.length) throw new Error('failures: ' + failures.join(' | '));
  console.log(JSON.stringify({ passed: checks, failed: 0, evidence }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ error: String(error), checks, failures }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
