// Card 6a2240f7: the PDF find bar has no resident "查找" button; search opens only through the
// reader.search shortcut / command path. Real React + production components in an isolated
// headless Chrome via Vite; fails on the old code (button rendered, hint anchored to it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const evidence = path.join(root, '.tmp/shots/pdf-find-entry'); fs.mkdirSync(evidence, { recursive: true });
const errors = [], checks = [];
const check = (value, expected, label) => { assert.deepEqual(value, expected, label); checks.push(label); };
// ---- source contracts: no hidden button, no second entry ----
const findBar = fs.readFileSync('src/features/reader/pdf/PdfFindBar.tsx', 'utf8');
const css = fs.readFileSync('src/features/reader/reader-reliability.css', 'utf8');
check(/pdf-find-trigger/.test(findBar) || /pdf-find-trigger/.test(css), false, 'no .pdf-find-trigger control or style remains');
check(/>查找</.test(findBar), false, 'no resident 查找 button markup');
check(/if \(!open\) return null;/.test(findBar), true, 'closed find bar renders nothing (not display:none)');
check(/useShortcutProps/.test(findBar), false, 'find bar no longer registers itself as a shortcut anchor');
const commands = fs.readFileSync('src/ui/shortcuts/appShortcutCommands.ts', 'utf8');
check(/id: 'reader\.search'[^\n]*defaultBindings: \[key\('f'\)\][^\n]*execute: a\.pdfSearch/.test(commands), true, 'reader.search command keeps its Ctrl+F default and pdfSearch action');
check(/addEventListener\('reader-find', show\)/.test(findBar), true, 'find bar still opens on the reader-find surface event');
check(/requestAnimationFrame\(\(\) => \{ input\.current\?\.focus\(\)/.test(findBar), false, 'focus is committed by effect, not raced through requestAnimationFrame');
let browser, server;
try {
  server = await createServer({ root, cacheDir: path.join(root, '.tmp/pdf-find-entry-vite'), configFile: false, optimizeDeps: { entries: ['scripts/fixtures/pdf-find-entry.tsx'] }, plugins: [react(), { name: 'find-harness', configureServer(s) { s.middlewares.use('/__find', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__find', '<html><head><link rel="icon" href="data:,"><style>:root{--ink:#243b31;--surface:#fff;--muted:#64746c;--line:#bbc8bf;--accent:#48835d;--accent-strong:#2f6a45}body{margin:0;font:14px sans-serif}button{margin:3px}</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/pdf-find-entry.tsx"></script></body></html>')); }); } }], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen(); const port = server.httpServer.address().port;
  const exe = process.env.SHORTCUT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(exe, 'Set SHORTCUT_CHROME to an installed browser executable');
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/__find`); await page.waitForFunction(() => window.__findTest?.store.commands().length > 10); await page.bringToFront();
  const events = () => page.evaluate(() => window.__findTest.events.splice(0));
  const buttonsInSurface = () => page.evaluate(() => [...document.querySelectorAll('.pdf-reader-surface button')].map(b => b.textContent.trim()));
  const focusedIsFindInput = async () => { await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查找文本', null, { timeout: 2000 }).catch(() => {}); return page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '查找文本'); };
  // 1. No resident control at rest.
  check(await page.locator('.pdf-find-trigger').count(), 0, 'closed state: no .pdf-find-trigger in DOM');
  check(await page.locator('.pdf-find-bar').count(), 0, 'closed state: no find bar');
  check(await buttonsInSurface(), [], 'closed state: no button at all inside the reader surface');
  check(await page.locator('.pdf-reader-surface [data-shortcut-id]').count(), 0, 'no shortcut anchor element inside the surface');
  await page.screenshot({ path: path.join(evidence, '01-closed-no-button.png') });
  // 2. Ctrl+F opens and focuses the input via the command path.
  await page.locator('#canvas').focus(); await page.keyboard.press('Control+f');
  check(await events(), ['pdf-search:dispatched'], 'Ctrl+F dispatches reader.search → requestPdfFind on the visible surface');
  await page.waitForSelector('.pdf-find-bar');
  check(await focusedIsFindInput(), true, 'find input focused after Ctrl+F');
  await page.keyboard.type('flow');
  check(await page.locator('.pdf-find-bar [role="status"]').innerText(), '1/3', 'typing highlights matches');
  check(await page.locator('[data-pdf-find="current"]').count() >= 1, true, 'current match marked in the text layer');
  await page.keyboard.press('Enter'); check(await page.locator('.pdf-find-bar [role="status"]').innerText(), '2/3', 'Enter moves to next match');
  await page.keyboard.press('Shift+Enter'); check(await page.locator('.pdf-find-bar [role="status"]').innerText(), '1/3', 'Shift+Enter moves back');
  await page.screenshot({ path: path.join(evidence, '02-open-by-shortcut.png') });
  // 3. Ctrl+F while open only reselects the input (bar stays single, query kept).
  await page.keyboard.press('Control+f');
  check(await page.locator('.pdf-find-bar').count(), 1, 'second Ctrl+F keeps a single find bar');
  check(await page.evaluate(() => { const i = document.activeElement; return i instanceof HTMLInputElement && i.selectionStart === 0 && i.selectionEnd === i.value.length; }), true, 'second Ctrl+F reselects the query');
  check(await events(), [], 'second Ctrl+F is consumed by the bar, not re-dispatched');
  // 4. Esc closes and nothing is left behind.
  await page.keyboard.press('Escape');
  check(await page.locator('.pdf-find-bar').count(), 0, 'Escape closes the bar');
  check(await buttonsInSurface(), [], 'closed again: still no resident button');
  check(await page.locator('[data-pdf-find]').count(), 0, 'match marks cleared on close');
  // 5. Command palette / programmatic path still works.
  await page.evaluate(() => window.dispatchEvent(new Event('noop')));
  check(await page.evaluate(() => { const s = document.querySelector('.pdf-reader-surface'); s.dispatchEvent(new Event('reader-find')); return true; }), true, 'reader-find dispatched');
  await page.waitForSelector('.pdf-find-bar'); check(await focusedIsFindInput(), true, 'reader-find event (command palette path) opens and focuses');
  await page.locator('.pdf-find-bar button[aria-label="关闭搜索"]').click(); check(await page.locator('.pdf-find-bar').count(), 0, '× closes');
  // 6. Non-PDF mode: no surface, no bar, no error.
  await page.evaluate(() => window.__findTest.setPdfMode(false)); await page.waitForSelector('.markdown-reader-surface');
  await page.locator('#canvas').focus(); await page.keyboard.press('Control+f');
  check(await events(), [], 'reader.search disabled in non-PDF mode (no dispatch)');
  check(await page.locator('.pdf-find-bar').count(), 0, 'non-PDF mode: nothing opens');
  await page.evaluate(() => window.__findTest.setPdfMode(true)); await page.waitForSelector('.pdf-reader-surface');
  // 7. Ctrl hint overlay: reader.search still appears, as a floating scene hint (no anchor).
  await page.locator('#canvas').focus(); await page.keyboard.down('Control'); await page.waitForTimeout(250);
  const hint = page.locator('[data-hint-id="reader.search"]');
  check(await hint.count(), 1, 'Ctrl overlay lists reader.search');
  check(await hint.getAttribute('data-hint-placement'), 'floating', 'reader.search hint floats (no button anchor)');
  check(await hint.locator('.shortcut-hint-keys').textContent(), 'Ctrl+F', 'hint shows the effective Ctrl+F keycaps');
  check(await hint.locator('.shortcut-hint-label').innerText(), '搜索当前 PDF', 'floating hint carries the action name');
  check(await page.locator('[data-hint-id="reader.zoomIn"]').getAttribute('data-hint-placement'), 'adjacent', 'button-backed hints still anchor beside their buttons');
  await page.screenshot({ path: path.join(evidence, '03-ctrl-hints.png') });
  await page.keyboard.up('Control');
  // 8. Switching document resets state and still no trigger.
  await page.evaluate(() => window.__findTest.setDocumentKey('doc-b')); await page.waitForTimeout(50);
  check(await buttonsInSurface(), [], 'after document switch: still no resident button');
  check(errors, [], 'no pageerror / console error');
} finally {
  await browser?.close(); await server?.close();
}
fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ checks, errors, at: new Date().toISOString() }, null, 2));
console.log(`verify-pdf-find-entry-browser: ${checks.length} checks passed; evidence in ${path.relative(root, evidence)}`);
