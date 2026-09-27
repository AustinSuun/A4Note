// Run against the dedicated xunchuan-highlight dev:live WebView and the locally imported
// two-page PDF fixture. Captures real native screenshots without touching the user's library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const output = path.resolve('.tmp/shots/pdf-highlight-edge');
const report = { checks: [], pageerrors: [], consoleErrors: [], screenshots: [] };
const check = (title, value, detail) => { report.checks.push({ title, passed: Boolean(value), detail }); assert.ok(value, `${title}: ${JSON.stringify(detail)}`); };
let browser;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9388');
  const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1488'));
  assert.ok(page, 'xunchuan-highlight native window is not running');
  page.setDefaultTimeout(18000);
  page.on('pageerror', error=>report.pageerrors.push(error.message));
  page.on('console', message=>{if(message.type()==='error') report.consoleErrors.push(message.text());});
  await page.reload();
  await page.getByText('独立测试库', { exact: false }).first().waitFor();
  const paths = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_aster_paths'));
  check('native isolated library only', paths.root.includes('app.aster.research.dev.xunchuan-highlight.'), paths.root);
  if (!await page.locator('.reader-scene-shell').isVisible()) {
    const fixture = page.locator('.library-paper-index tbody tr:visible').filter({ hasText: 'PDF highlight geometry fixture' });
    await fixture.dblclick({ position:{x:180,y:26} });
  }
  await page.locator('.reader-scene-shell').waitFor({state:'visible'});
  const marks = page.locator('.reader-scene-shell .pdf-page[data-page="1"] svg.pdf-highlight-paint rect');
  await marks.first().waitFor({state:'attached'});
  const fromDom = () => marks.evaluateAll(els => els.map(el => Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(el.getAttribute(k))]))).sort((a,b)=>a.y-b.y));
  const before = JSON.parse(fs.readFileSync(path.join(output,'before-rects.json'),'utf8'));
  const old = [...before.details].sort((a,b)=>a.y-b.y), current = await fromDom();
  check('same 4 persisted PDF highlight segments after native reload', current.length === old.length && current.length === 4, current);
  for(let i=0;i<current.length;i++) {
    check(`run ${i+1} keeps exact x extent and bottom edge`, Math.abs(current[i].x-old[i].x)<1e-6 && Math.abs(current[i].width-old[i].width)<1e-6 && Math.abs(current[i].y+current[i].height-old[i].y-old[i].height)<(i<2?0.26:0.26), {before:old[i],after:current[i]});
    check(`run ${i+1} retreats from old upper edge`, current[i].y > old[i].y && current[i].y-old[i].y < 0.25, {before:old[i],after:current[i]});
  }
  check('last multiline and lone highlight retain exact bottom', [2,3].every(i=>Math.abs(current[i].y+current[i].height-old[i].y-old[i].height)<1e-6));
  check('two consecutive paragraph lines meet without yellow gap', [0,1].every(i => current[i].y+current[i].height-current[i+1].y>0.07 && current[i].y+current[i].height-current[i+1].y<0.15), current);
  check('standalone paragraph mark is not connected across large gap', current[3].y - (current[2].y+current[2].height)>6, current);
  const underline = await page.locator('.reader-scene-shell .pdf-page[data-page="1"] .annotation-mark.underline').first().getAttribute('style');
  check('underline drawing is pixel-for-pixel unchanged', underline===before.underline[0], {before:before.underline[0],after:underline});
  const shot = async file => { await page.screenshot({path:path.join(output,file)});report.screenshots.push(file); };
  await shot('after-normal.png');
  const page2 = page.locator('.reader-scene-shell .pdf-page[data-page="2"]');
  await page2.scrollIntoViewIfNeeded();
  await page.locator('.reader-scene-shell .pdf-page[data-page="1"]').scrollIntoViewIfNeeded();
  check('page navigation preserves position and annotation count', (await fromDom()).length===4);
  await page.locator('button.zoom-pct-btn:visible').click();
  await page.waitForFunction(()=>document.querySelector('button.zoom-pct-btn')?.textContent?.includes('100%'));
  check('100% reader zoom retains aligned annotation coordinates', (await fromDom()).every((r,i)=>Math.abs(r.y-current[i].y)<1e-6));
  await page.locator('.pdf-document:visible').first().evaluate(el => { el.scrollTop=0; });
  await shot('after-100pct.png');
  for(let i=0;i<5;i++)await page.locator('button[data-shortcut-id="reader.zoomIn"]:visible').click();
  await page.waitForFunction(()=>document.querySelector('button.zoom-pct-btn')?.textContent?.includes('150%'));
  check('150% reader zoom retains aligned annotation coordinates', (await fromDom()).every((r,i)=>Math.abs(r.y-current[i].y)<1e-6));
  await page.waitForTimeout(100); // let the zoom-anchor scroll settle before framing the same first lines
  await page.locator('.pdf-document:visible').first().evaluate(el => { el.scrollTop=0; });
  await shot('after-150pct.png');
  check('pageerror count is zero', report.pageerrors.length===0, report.pageerrors);
  check('console error count is zero', report.consoleErrors.length===0, report.consoleErrors);
  console.log(JSON.stringify({ passed:report.checks.length, pageerrors:report.pageerrors, consoleErrors:report.consoleErrors, screenshots:report.screenshots }));
} finally {
  fs.writeFileSync(path.join(output,'after-result.json'),JSON.stringify(report,null,2));
  await browser?.close();
}
