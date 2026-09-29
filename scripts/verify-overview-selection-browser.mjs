// Three-paper real-React browser regression. Only native summary reads are scripted;
// the overview component, checkbox, sorting/filtering host and CSS are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url);
const dir = path.resolve('.tmp/overview-selection-browser');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'host.tsx'), `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{LibraryOverview}from'/src/features/library/LibraryOverview';
import'/src/ui/styles/tokens.css';import'/src/ui/styles/base.css';import'/src/ui/styles/library.css';
const w=window as any;w.opened=[];w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(cmd,args)=>{
  if(cmd==='read_summary_layout')return {path:'test://layout',exists:true,content:''};
  if(cmd==='read_paper_summary')return {path:'test://summary/'+args.paperId,exists:true,content:'',noteId:null};
  if(cmd==='plugin:event|listen'||cmd==='plugin:event|unlisten')return 1;
  throw Error('unexpected IPC '+cmd);
}};
const paper=(id:string,title:string)=>({paperId:id,title,authors:'Author '+id,year:2026,venue:'Example',tags:[],notes:[],annotations:[],sourcePdf:null,translatedPdfs:[]});
function Host(){const[current,setCurrent]=useState<string|undefined>('b'),[bulk,setBulk]=useState<string[]>([]),[mode,setMode]=useState('overview'),[reverse,setReverse]=useState(false),[filtered,setFiltered]=useState(false),[deleted,setDeleted]=useState(false);
 const papers=[paper('a','Alpha guide'),paper('b','Beta very long title'),paper('c','Gamma')].filter(p=>(!deleted||p.paperId!=='b')&&(!filtered||p.paperId==='c'));if(reverse)papers.reverse();
 w.snapshot=()=>({current,bulk,mode,order:papers.map(p=>p.paperId)});return <div className='scene active library-scene' style={{height:'100vh',display:'flex',flexDirection:'column'}}><div id='fixture-actions'><button id='fixture-toggle' onClick={()=>setMode(mode==='overview'?'list':'overview')}>切换列表综览</button><button id='fixture-reverse' onClick={()=>setReverse(!reverse)}>反转排序</button><button id='fixture-filter' onClick={()=>setFiltered(!filtered)}>过滤当前行</button><button id='fixture-delete' onClick={()=>{setDeleted(true);if(current==='b')setCurrent(undefined);setBulk(bulk.filter(x=>x!=='b'));}}>删除 B</button></div>
 {mode==='overview'?<LibraryOverview papers={papers as any} selectedId={papers.some(p=>p.paperId===current)?current:undefined} selectedIds={bulk} onSelect={setCurrent} onSelection={setBulk} onOpen={id=>w.opened.push(id)}/>:<div id='fixture-list'>列表当前文献：{current||'无'}</div>}</div>}
createRoot(document.getElementById('root')!).render(<Host/>);
`);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
const checks = [], errors = [];
const check = (name, value, detail) => { checks.push({ name, passed: Boolean(value), detail }); assert.ok(value, name + ': ' + JSON.stringify(detail)); };
let server, browser, page;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache-' + Date.now()), plugins: [react()], logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), path.dirname(path.dirname(require.resolve('react/package.json')))] }, watch: { ignored: ['**/.build/**', '**/src-tauri/**', '**/node_modules/**'] } } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/.tmp/overview-selection-browser/index.html');
  const row = id => page.locator(`.summary-row[data-paper-id="${id}"]`);
  await row('a').waitFor();
  check('current B independent of unchecked bulk', await row('b').getAttribute('aria-current') === 'true' && await row('a').getAttribute('aria-current') === null && !(await row('b').locator('input[type=checkbox]').isChecked()));
  const styles = id => row(id).evaluate(el => ({ background: getComputedStyle(el).backgroundColor, pinned: getComputedStyle(el.querySelector('.summary-pinned')).backgroundColor, bar: getComputedStyle(el.querySelector('.summary-pinned')).boxShadow, cell: getComputedStyle(el.querySelector('.summary-cell')).backgroundColor }));
  const currentStyle = await styles('b');
  check('active row is full-width and pinned accent matches list token', currentStyle.background === currentStyle.pinned && currentStyle.background.includes('213, 239, 225') && currentStyle.bar.includes('69, 184, 121') && currentStyle.cell === 'rgba(0, 0, 0, 0)', currentStyle);
  await row('a').hover();
  check('hover has a separate surface, never an implicit selection', (await styles('a')).background !== currentStyle.background && (await row('a').getAttribute('aria-current')) === null);
  await row('a').locator('input[type=checkbox]').check();
  check('checkbox selects bulk A without changing active B or opening it', (await page.evaluate(() => window.snapshot())).current === 'b' && (await page.evaluate(() => window.snapshot())).bulk.join() === 'a' && (await page.evaluate(() => window.opened)).length === 0 && (await row('a').getAttribute('class')).includes('bulk-selected'));
  await page.getByLabel('选择当前综览全部文献').check();
  check('select all still controls only bulk selection', (await page.evaluate(() => window.snapshot())).bulk.length === 3 && (await row('b').getAttribute('class')).includes('current'));
  await page.getByLabel('选择当前综览全部文献').uncheck();
  check('clear all keeps the active paper', (await page.evaluate(() => window.snapshot())).bulk.length === 0 && (await row('b').getAttribute('class')).includes('current'));
  await row('c').locator('.summary-cell').first().click();
  check('click on empty field activates row C without opening or bulk selection', (await page.evaluate(() => window.snapshot())).current === 'c' && (await page.evaluate(() => window.opened)).length === 0 && (await page.evaluate(() => window.snapshot())).bulk.length === 0);
  await page.locator('.summary-viewport').focus(); await page.keyboard.press('ArrowUp');
  check('keyboard up selects B without toggling checkbox', (await page.evaluate(() => window.snapshot())).current === 'b' && (await row('b').getAttribute('aria-current')) === 'true' && !(await row('b').locator('input[type=checkbox]').isChecked()));
  await page.keyboard.press('ArrowDown');
  check('keyboard down returns to C', (await page.evaluate(() => window.snapshot())).current === 'c');
  await page.keyboard.press('Enter');
  check('Enter opens current paper only', (await page.evaluate(() => window.opened)).join() === 'c');
  await page.locator('#fixture-toggle').click(); await page.locator('#fixture-toggle').click();
  check('cross-view unmount/remount preserves C identity', (await row('c').getAttribute('aria-current')) === 'true');
  await page.locator('#fixture-reverse').click();
  check('reorder keeps selection on C ID not previous row index', (await row('c').getAttribute('aria-current')) === 'true' && (await row('b').getAttribute('aria-current')) === null);
  await row('b').locator('.summary-pinned').click({ position: { x: 130, y: 45 } });
  check('selection can move to B without opening or checking it', (await page.evaluate(() => window.snapshot())).current === 'b' && !(await row('b').locator('input[type=checkbox]').isChecked()));
  await page.locator('#fixture-filter').click();
  check('filter hides current B without selecting unrelated visible C', await row('c').count() === 1 && await row('b').count() === 0 && await page.locator('.summary-row.current').count() === 0 && (await page.evaluate(() => window.snapshot())).current === 'b');
  await page.locator('#fixture-filter').click();
  check('clearing filter restores B selection by ID', (await row('b').getAttribute('aria-current')) === 'true');
  await page.locator('#fixture-delete').click();
  check('deleted active row is absent and host clears current identity', await row('b').count() === 0 && !(await page.evaluate(() => window.snapshot())).current);
  for (const theme of ['paper', 'midnight']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await row('a').locator('.summary-pinned').click({ position: { x: 130, y: 45 } });
    const m = await styles('a');
    check(`${theme}: current row and sticky title share one surface`, m.background === m.pinned && !m.bar.includes('none'), m);
  }
  await page.setViewportSize({ width: 980, height: 800 });
  // The toolbar offers 10-point increments. Exercise the same sheet CSS zoom at
  // the intermediate 125% boundary without claiming an unsupported toolbar value.
  await page.locator('.summary-sheet').evaluate(el => { el.style.zoom = '1.25'; });
  const interim = await styles('a');
  check('125% CSS sheet zoom keeps current row continuous', interim.background === interim.pinned && interim.bar.includes('145, 182, 154'), interim);
  await page.locator('.summary-sheet').evaluate(el => { el.style.zoom = '1'; });
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大综览' }).click();
  await page.waitForFunction(() => document.querySelector('.summary-zoom button:nth-child(2)')?.textContent?.includes('150%'));
  const viewport = page.locator('.summary-viewport');
  if (!(await viewport.getAttribute('class')).includes('title-pinned')) await page.getByRole('button', { name: '固定标题列', exact: true }).click();
  await viewport.evaluate(el => { el.scrollLeft = 240; });
  const geometry = await row('a').evaluate(el => ({ pinned: el.querySelector('.summary-pinned').getBoundingClientRect().left, viewport: el.closest('.summary-viewport').getBoundingClientRect().left, scroll: el.closest('.summary-viewport').scrollLeft }));
  check('980px viewport, 150% zoom and horizontal scroll preserve sticky active title', geometry.scroll > 0 && Math.abs(geometry.pinned - geometry.viewport) < 4 && (await styles('a')).pinned === (await styles('a')).background, geometry);
  check('no script or console errors', errors.length === 0, errors);
  console.log(JSON.stringify({ passed: checks.length, errors }));
} finally {
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); await server?.close();
}
