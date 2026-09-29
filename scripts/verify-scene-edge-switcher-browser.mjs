import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Real SceneEdgeSwitcher in Chrome (fixture: scripts/fixtures/scene-edge-host.tsx).
// Every check is counted so a run on old code reports how much of the behaviour is missing.
const dir = path.resolve('.tmp/scene-edge-switcher-browser');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"/><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/scene-edge-host.tsx"></script></body></html>');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IDENTITY = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)']);
let server; let browser;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), fs.realpathSync(path.resolve('node_modules'))] }, watch: { ignored: ['**/.tmp/**', '**/.build/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console ' + msg.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/.tmp/scene-edge-switcher-browser/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="active"]', { timeout: 30000 });
  await sleep(300);

  const snap = () => page.evaluate(() => {
    const panel = document.querySelector('.scene-edge-panel');
    const handle = document.querySelector('.scene-edge-handle');
    if (!panel || !handle) return null;
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const grip = handle.querySelector('.scene-edge-handle-grip');
    const active = document.activeElement;
    return {
      open: panel.hasAttribute('data-open'), left: rect.left, top: rect.top, bottom: rect.bottom,
      opacity: Number(style.opacity), transform: style.transform, expanded: handle.getAttribute('aria-expanded'),
      grip: grip ? Number(getComputedStyle(grip).opacity) : null,
      focusHandle: active === handle, focusScene: active?.getAttribute?.('data-scene-id') ?? null,
      opened: [...window.__opened], clicks: window.__contentClicks, activeScene: document.querySelector('[data-testid="active"]').textContent,
    };
  });
  // Records every animation frame of the next enter/exit: animated properties, opacity, transform.
  const record = () => page.evaluate(() => {
    const panel = document.querySelector('.scene-edge-panel');
    window.__motion = { properties: [], frames: [] };
    if (!panel) return;
    const started = performance.now();
    const tick = () => {
      for (const animation of panel.getAnimations()) {
        const property = animation.transitionProperty ?? animation.animationName ?? 'unknown';
        if (!window.__motion.properties.includes(property)) window.__motion.properties.push(property);
      }
      const style = getComputedStyle(panel);
      window.__motion.frames.push([Number(style.opacity), style.transform]);
      if (performance.now() - started < 320) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const motion = async () => { await sleep(360); return page.evaluate(() => window.__motion); };
  const now = () => page.evaluate(() => performance.now());
  const waitOpen = async (limit = 700) => { const start = Date.now(); while (Date.now() - start < limit) { if ((await snap())?.open) return Date.now() - start; await sleep(10); } return null; };
  const away = async () => { await page.mouse.move(700, 520); await sleep(600); };

  const initial = await snap();
  check('switcher is mounted with its edge handle', initial);
  check('panel starts closed and invisible', initial && !initial.open && initial.opacity === 0 && initial.expanded === 'false', initial);
  check('handle is low-interference by default', initial && initial.grip !== null && initial.grip < 0.3, initial?.grip);

  // Quick pass across the edge.
  await page.mouse.move(400, 420);
  await page.mouse.move(4, 420); await sleep(50); await page.mouse.move(400, 420); await sleep(400);
  check('a quick pass across the edge does not open', !(await snap())?.open);

  // Dwell opens after the delay with a transform/opacity-only slide.
  await record();
  const t0 = await now();
  await page.mouse.move(4, 420);
  await sleep(70);
  const early = await snap();
  check('nothing opens before the dwell', early && !early.open, early);
  check('hovering arms the handle', early && early.grip > 0.5, early?.grip);
  const waited = await waitOpen();
  const dwell = (await now()) - t0;
  check('dwell opens the panel', waited !== null);
  check('dwell is 120-400ms from reaching the edge', waited !== null && dwell >= 120 && dwell <= 400, dwell);
  const enter = await motion();
  check('enter animates only transform and opacity', enter.properties.length > 0 && enter.properties.every((p) => p === 'transform' || p === 'opacity'), enter.properties);
  check('enter passes through intermediate frames', enter.frames.filter(([o]) => o > 0.02 && o < 0.98).length >= 3, enter.frames.slice(0, 12));
  check('enter slides in from the left', enter.frames.some(([, t]) => /^matrix\(1, 0, 0, 1, -\d/.test(t)), enter.frames.slice(0, 6));
  const opened = await snap();
  check('open panel sits 12px from the edge, opaque, untransformed', opened && Math.abs(opened.left - 12) <= 1.5 && opened.opacity === 1 && IDENTITY.has(opened.transform), opened);
  check('open panel is centred on the pointer', opened && Math.abs((opened.top + opened.bottom) / 2 - 420) <= 4, opened);
  check('handle reports aria-expanded', opened?.expanded === 'true');

  // Move to the panel and pick a scene.
  const item = await page.locator('.scene-edge-item[data-scene-id="markdown"]').boundingBox().catch(() => null);
  if (item) {
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 10 });
    await sleep(120);
    check('moving onto the panel keeps it open', (await snap())?.open);
    await record();
    await page.mouse.click(item.x + item.width / 2, item.y + item.height / 2);
    await sleep(40);
    const picked = await snap();
    check('clicking a scene calls onOpenScene once', JSON.stringify(picked.opened) === '["markdown"]' && picked.activeScene === 'markdown', picked);
    check('choosing a scene closes the panel', !picked.open && picked.expanded === 'false', picked);
    const exit = await motion();
    check('exit animates only transform and opacity', exit.properties.length > 0 && exit.properties.every((p) => p === 'transform' || p === 'opacity'), exit.properties);
    check('exit ends invisible', exit.frames.at(-1)?.[0] === 0, exit.frames.at(-1));
  } else {
    check('scene item is rendered in the panel', false);
  }
  const current = await page.locator('.scene-edge-item[aria-checked="true"]').getAttribute('data-scene-id').catch(() => null);
  check('current scene is highlighted', current === 'markdown', current);

  // Leaving: grace, then close.
  await away();
  await page.mouse.move(4, 300); await waitOpen();
  await page.mouse.move(700, 520); await sleep(120);
  check('leaving keeps the panel during the grace', (await snap())?.open);
  await sleep(450);
  check('leaving closes after the grace', !(await snap())?.open);

  // Misfire guards.
  const row = await page.locator('[data-testid="row"]').boundingBox();
  await page.mouse.move(row.x + 30, row.y + 14); await page.mouse.down();
  await page.mouse.move(40, 300, { steps: 6 }); await page.mouse.move(3, 300, { steps: 4 }); await sleep(450);
  check('dragging a file-tree row across the edge does not open', !(await snap())?.open);
  await page.mouse.up(); await away();
  const resizer = await page.locator('[data-testid="resizer"]').boundingBox();
  await page.mouse.move(resizer.x + 3, 300); await page.mouse.down();
  await page.mouse.move(3, 300, { steps: 8 }); await sleep(450);
  check('dragging the sidebar resizer to the edge does not open', !(await snap())?.open);
  await page.mouse.up(); await away();
  await page.mouse.move(3, 680); await sleep(450);
  check('the band yields to the reader note edge handle', !(await snap())?.open);
  await away();

  // Outside click closes and still reaches its target.
  await page.mouse.move(4, 300); await waitOpen(); await sleep(250);
  const button = await page.locator('[data-testid="content-button"]').boundingBox();
  await page.mouse.move(button.x + 10, button.y + 8, { steps: 2 });
  const clicksBefore = (await snap())?.clicks ?? 0;
  await page.mouse.click(button.x + 10, button.y + 8); await sleep(60);
  const outside = await snap();
  check('an outside click closes the panel', outside && !outside.open, outside);
  check('the outside click still reaches its target', outside && outside.clicks === clicksBefore + 1, outside);
  await away();

  // Keyboard path.
  await page.focus('.scene-edge-handle').catch(() => {});
  await page.keyboard.press('Enter'); await sleep(60);
  let keyboard = await snap();
  check('Enter on the handle opens and focuses the current scene', keyboard?.open && keyboard.focusScene === 'markdown', keyboard);
  await page.keyboard.press('ArrowDown'); await sleep(30);
  check('ArrowDown moves to the next scene', (await snap())?.focusScene === 'plugin.demo');
  await page.keyboard.press('ArrowDown'); await sleep(30);
  check('arrow navigation wraps', (await snap())?.focusScene === 'overview');
  await page.keyboard.press('Enter'); await sleep(60);
  keyboard = await snap();
  check('Enter on a scene switches, closes and returns focus to the handle', keyboard && keyboard.opened.at(-1) === 'overview' && !keyboard.open && keyboard.focusHandle, keyboard);
  await page.keyboard.press(' '); await sleep(60);
  check('Space opens the panel', (await snap())?.open);
  await page.keyboard.press('Escape'); await sleep(60);
  keyboard = await snap();
  check('Esc closes and returns focus to the handle', keyboard && !keyboard.open && keyboard.focusHandle, keyboard);
  await page.evaluate(() => document.activeElement?.blur());

  // Reduced motion: fade only.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.focus('.scene-edge-handle').catch(() => {});
  await record();
  await page.keyboard.press('Enter');
  const reduced = await motion();
  check('reduced motion never translates the panel', reduced.frames.length > 0 && reduced.frames.every(([, t]) => IDENTITY.has(t)), reduced.frames.slice(0, 6));
  check('reduced motion animates opacity only', reduced.properties.length > 0 && reduced.properties.every((p) => p === 'opacity'), reduced.properties);
  check('reduced motion still fades in', reduced.frames.some(([o]) => o > 0.02 && o < 0.98) && reduced.frames.at(-1)?.[0] === 1, reduced.frames.slice(0, 8));
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => document.activeElement?.blur());
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 118% interface zoom: hot zone and panel placement follow the root zoom.
  await page.evaluate(() => { document.documentElement.style.zoom = '118%'; });
  await sleep(150); await away();
  await page.mouse.move(8, 420); await waitOpen(); await sleep(300);
  const zoomed = await snap();
  check('118%: the edge band still triggers at clientX 8', zoomed?.open, zoomed);
  check('118%: panel sits 12 layout px (14.2 viewport px) from the edge', zoomed && Math.abs(zoomed.left - 12 * 1.18) <= 1.5, zoomed);
  check('118%: panel is centred on the pointer', zoomed && Math.abs((zoomed.top + zoomed.bottom) / 2 - 420) <= 5, zoomed);
  await away();
  await page.mouse.move(12, 420); await sleep(450);
  check('118%: pointer beyond the scaled band does not open', !(await snap())?.open);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  check('no console or page errors', errors.length === 0, errors);
} finally {
  await browser?.close();
  await server?.close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, errors }, null, 2));
if (failed.length) {
  console.error(`FAIL scene edge switcher browser ${results.length - failed.length}/${results.length}`);
  for (const r of failed) console.error(' -', r.name, JSON.stringify(r.detail ?? ''));
  assert.fail(`${failed.length} scene edge switcher browser checks failed`);
}
console.log(`PASS scene edge switcher browser ${results.length}/${results.length}: dwell/quick pass, transform+opacity slide, pick scene, grace, drag/resizer/reader-handle guards, outside click, keyboard, reduced motion, 118% zoom, 0 errors`);
