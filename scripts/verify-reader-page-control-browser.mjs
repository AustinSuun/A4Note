// Real component and application CSS; no native/production data. Native PDF evidence is separate.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const dir = path.resolve('.tmp/shots/page-control', process.env.PAGE_CONTROL_BASELINE ? 'baseline' : 'after');
fs.mkdirSync(dir, { recursive: true });
const checks = [], errors = [];
const check = (value, label) => { checks.push({ label, passed: !!value }); if (!value) console.error('FAIL', label); };
let browser, server;
try {
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'page-control-fixture', configureServer(s) { s.middlewares.use('/__page-control', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__page-control', '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/page-control-host.tsx"></script></body></html>'));
    }); },
  }], optimizeDeps: { entries: ['scripts/fixtures/page-control-host.tsx'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const exe = process.env.SHORTCUT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__page-control`); await page.bringToFront();
  const input = page.locator('.reader-page-overlay input'), shell = page.locator('.reader-page-overlay');
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const patch = async value => { await page.evaluate(v => window.pageControlTest.patch(v), value); await tick(); };
  const calls = () => page.evaluate(() => window.pageControlTest.calls);
  const reset = async (extra = {}) => {
    await page.locator('#after').focus(); await tick();
    await patch({ paperId: 'a', documentKey: 'source-a', totalPages: 16, currentPage: 2, active: true, visible: true, ...extra });
    await page.evaluate(() => { window.pageControlTest.calls = []; });
  };
  const focus = () => input.evaluate(n => n === document.activeElement);
  const enter = async value => { await input.click(); await input.fill(value); await page.keyboard.press('Enter'); await tick(); };
  await input.waitFor(); await reset();
  await page.screenshot({ path: path.join(dir, 'rest.png') });
  for (const [name, fraction] of [['current', .15], ['separator', .48], ['total', .88]]) {
    await reset();
    if (name === 'current') await input.click();
    else { const span = shell.locator('span').first(); const r = await span.boundingBox(); await page.mouse.click(r.x + r.width * (name === 'separator' ? .08 : .8), r.y + r.height / 2); }
    check(await focus(), `${name}: focuses same input`);
    check((await calls()).length === 0, `${name}: no jump entering`);
    check(await input.evaluate(n => n.selectionStart === 0 && n.selectionEnd === n.value.length), `${name}: current number selected`);
  }
  await reset(); const i = await input.boundingBox(), span = await shell.locator('span').first().boundingBox();
  await page.mouse.click((i.x + i.width + span.x) / 2, i.y + i.height / 2);
  check(await focus(), 'gap enters editor'); check((await calls()).length === 0, 'gap does not jump');
  const box = await shell.boundingBox(); check(box.height >= 24 && box.width >= 60, 'whole hit target at least 60 by 24');
  await reset(); await input.click(); await input.fill('1');
  await patch({ currentPage: 5 }); check(await input.inputValue() === '1', 'scroll update preserves draft');
  await input.press('End'); await input.press('2'); check(await input.inputValue() === '12', 'multi-digit input retains all digits');
  check((await calls()).length === 0, 'typing and rerender do not jump');
  await shell.locator('span').first().click(); check(await focus(), 'internal click retains focus');
  check(await input.inputValue() === '12' && (await calls()).length === 0, 'internal click does not submit or replace draft');
  await page.screenshot({ path: path.join(dir, 'editing.png') });
  await input.press('Enter'); await tick(); check(JSON.stringify(await calls()) === '[12]', 'Enter commits exactly once');
  await page.locator('#after').click(); check(JSON.stringify(await calls()) === '[12]', 'blur after Enter does not duplicate');
  await page.screenshot({ path: path.join(dir, 'submitted.png') });
  for (const outside of ['#after', '#blank']) {
    await reset(); await input.click(); await input.fill('13'); await page.locator(outside).click(); await tick();
    check(JSON.stringify(await calls()) === '[13]', `${outside}: real outside blur commits once`);
  }
  await reset(); await input.click(); await input.fill('14'); await input.press('Escape'); await page.locator('#after').click();
  check((await calls()).length === 0 && await input.inputValue() === '2', 'Escape cancels and restores actual page');
  for (const value of ['', 'abc', '12abc', '0', '17', '1.5', '-1', '2', '02', '99999999']) {
    await reset(); await enter(value); check((await calls()).length === 0 && await input.inputValue() === '2', `invalid/unchanged ${JSON.stringify(value)}: no jump, actual page restored`);
  }
  for (const value of ['1', '16']) { await reset(); await enter(value); check(JSON.stringify(await calls()) === `[${value}]`, `valid boundary ${value}`); }
  await reset(); await input.focus(); await patch({ currentPage: 5 }); await page.locator('#after').click(); await tick();
  check((await calls()).length === 0 && await input.inputValue() === '5', 'untouched draft during scroll does not jump backwards');
  await reset(); await input.focus(); await input.fill('8'); await patch({ currentPage: 8 }); await input.press('Enter');
  check((await calls()).length === 0, 'target already current: no jump');
  for (const changed of [{ paperId: 'b', currentPage: 3 }, { documentKey: 'translation-b', currentPage: 3 }, { totalPages: 20, currentPage: 3 }]) {
    await reset(); await input.focus(); await input.fill('12'); await patch(changed); await page.locator('#after').focus(); await tick();
    check((await calls()).length === 0 && await input.inputValue() === '3', `context invalidates draft ${JSON.stringify(changed)}`);
  }
  for (const selector of ['#switch-file', '#switch-paper']) {
    await reset(); await input.focus(); await input.fill('12'); await page.locator(selector).click(); await tick();
    check((await calls()).length === 0 && await input.inputValue() === '3', `${selector}: click-driven context change cancels pending blur`);
  }
  for (const selector of ['#switch-file', '#switch-paper']) {
    await reset(); await input.focus(); await input.fill('12'); await page.locator(selector).click({ delay: 120 }); await tick();
    check((await calls()).length === 0 && await input.inputValue() === '3', `${selector}: held pointer releases before context commit`);
  }
  for (const key of ['active', 'visible']) {
    await reset(); await input.focus(); await input.fill('12'); await patch({ [key]: false }); await patch({ [key]: true, currentPage: 4 });
    check((await calls()).length === 0 && await input.inputValue() === '4', `${key}: retained/hidden control cancels draft`);
  }
  await reset({ totalPages: 0 }); check(await input.isDisabled(), 'unloaded document disables input');
  await shell.click({ force: true }); check(!await focus() && (await calls()).length === 0, 'disabled group cannot submit');
  await reset(); await page.locator('#before').focus(); await page.keyboard.press('Tab'); check(await focus(), 'Tab reaches input');
  check((await input.getAttribute('aria-label') || '').includes('页'), 'accessible page name');
  check(await input.evaluate(n => getComputedStyle(n).outlineStyle !== 'none' || getComputedStyle(n.parentElement).outlineStyle !== 'none'), 'keyboard focus indication');
  await input.fill('9'); await page.evaluate(() => { const n = document.querySelector('.reader-page-overlay input'); n.blur(); n.focus(); }); await tick();
  check((await calls()).length === 0 && await input.inputValue() === '9', 'same-turn temporary focus loss does not commit or reset');
  await input.press('Escape');
  for (const currentPage of [2, 12, 120]) {
    await reset({ currentPage, totalPages: 160 }); const r = await shell.boundingBox(); const q = await input.boundingBox();
    check(q.width >= 20 && q.x + q.width <= r.x + r.width, `${currentPage}/160 readable hit geometry`);
  }
  await reset(); await input.focus(); await input.fill('9');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  check((await calls()).length === 0 && await input.inputValue() === '9', 'IME Enter does not submit'); await input.press('Escape');
  for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom); await tick();
    const r = await shell.boundingBox(); check(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1200, `CSS zoom ${zoom}: control within viewport`);
  }
  check(errors.length === 0, 'no pageerror or console.error');
} catch (error) { errors.push(String(error.stack)); }
finally {
  await browser?.close(); await server?.close();
  const result = { passed: errors.length === 0 && checks.every(c => c.passed), checks, errors };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, errors, evidence: dir }));
  if (!result.passed) process.exitCode = 1;
}
