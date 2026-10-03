// dev:live evidence for card e4c2fa22 (PDF link jumps + 「返回」 stack).
//
// Runs against an ISOLATED dev:live instance (never the production library):
//   node scripts/dev-live.mjs --instance pdf-links-arena --port 1462 --cdp-port 9262
//   PDF_LINKS_CDP=http://127.0.0.1:9262 PDF_LINKS_URL=http://127.0.0.1:1462 node scripts/verify-pdf-links-live.mjs
//
// Inside the real Tauri window this script:
//   1. verifies the WebView runs on app.aster.research.dev.pdf-links-arena.*;
//   2. imports two PDFs into that isolated library (the real arXiv paper
//      "Mean Flows for One-step Generative Modeling" and the repo's hand-built link
//      fixture) through the same IPC the import dialog uses;
//   3. drives the reader with real mouse input: hover tips, an internal citation jump
//      (scroll + one-shot flash + right-hand 「返回 第 N 页」), the return click, the
//      manual-scroll-back dismissal, a two-hop stack, external links (recorded
//      open_external_url IPC) and the javascript:/mailto: rejections;
//   4. re-checks link-box alignment at 150 % zoom on the flat and the /Rotate 90 page;
//   5. captures light + dark screenshots (note drawer closed / open) and asserts that
//      the console and pageerror streams stay empty.
//
// The reader keeps one scene per opened paper, so every query resolves the ACTIVE
// reader first (`window.__linksRoot`), never the first `.pdf-reader` in the DOM.
//
// Evidence: .tmp/pdf-links-live/<tag>/*.png + links-live.log + result.json
//   PDF_LINKS_TAG=<name>   evidence folder (default: after)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildPdfLinkFixture } from './fixtures/pdf-link-fixture.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const CDP = process.env.PDF_LINKS_CDP ?? 'http://127.0.0.1:9262';
const APP_URL = process.env.PDF_LINKS_URL ?? 'http://127.0.0.1:1462';
const instance = process.env.PDF_LINKS_INSTANCE ?? 'pdf-links-arena';
const tag = process.env.PDF_LINKS_TAG ?? 'after';
const outDir = path.join(root, '.tmp', 'pdf-links-live', tag);
const inputsDir = path.join(root, '.tmp', 'pdf-links-live', 'inputs');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(inputsDir, { recursive: true });
const logPath = path.join(outDir, 'links-live.log');
const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`);
};
const report = { instance, url: APP_URL, checks: [], pageerrors: [], consoleErrors: [], httpFailures: [], screenshots: [], observations: {} };
let checks = 0;
const check = (value, name, detail) => {
  checks += 1;
  report.checks.push({ name, passed: Boolean(value), detail });
  assert.ok(value, `${name}: ${JSON.stringify(detail ?? '')}`);
};
const round = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

let browser;
let page;

/**
 * Installed in the page after every reload: the reader scene that is actually on screen.
 * The app keeps one `.reader-scene-shell` per workbench tab; the hidden tab still has a
 * non-zero rect (it is only `visibility: hidden`), so the active frame is authoritative —
 * same selector the app itself uses (`.workbench-tab-frame.active .pdf-document`).
 */
const INSTALL_ROOT = () => {
  window.__linksRoot = () => {
    const active = document.querySelector('.workbench-tab-frame.active .reader-scene-shell');
    if (active) return active;
    return [...document.querySelectorAll('.reader-scene-shell')].find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }) ?? null;
  };
  // Careful: every scene keeps a full-size, fully laid-out box; only `visibility` tells the
  // scenes apart (all of them also carry the app's own `scene active` classes). Testing the
  // row index' rect therefore reported "the library is shown" while the reader was on screen,
  // which made openLibrary() skip the rail click and sent the row double-click into the reader.
  window.__linksShown = () => {
    const el = document.querySelector('.library-scene');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
};
const installRoot = () => page.evaluate(INSTALL_ROOT);

const state = () =>
  page.evaluate(() => {
    const root = window.__linksRoot();
    const doc = root?.querySelector('.pdf-document') ?? null;
    const back = root?.querySelector('.pdf-link-back') ?? null;
    const flash = root?.querySelector('.pdf-link-flash') ?? null;
    const hint = document.querySelector('.pdf-text-layer-hint');
    const ipc = window.__ipcCalls || [];
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      hasRoot: Boolean(root),
      scrollTop: doc ? doc.scrollTop : null,
      clientHeight: doc ? doc.clientHeight : null,
      cursorMode: doc ? doc.classList.contains('cursor-mode') : null,
      selecting: doc ? doc.dataset.textSelecting ?? null : null,
      links: [...(root?.querySelectorAll('.pdf-link') ?? [])].map((el) => ({
        kind: el.dataset.linkKind,
        page: el.dataset.linkPage ?? null,
        tip: el.dataset.tip,
        pointerEvents: getComputedStyle(el).pointerEvents,
        opacity: getComputedStyle(el).opacity,
        rect: rect(el),
      })),
      layerState: [...(root?.querySelectorAll('.pdf-link-layer') ?? [])].map((el) => `${el.closest('.pdf-page')?.dataset.page}:${el.dataset.linkState}:${el.dataset.linkCount}`),
      back: back
        ? {
            text: back.textContent,
            visible: back.classList.contains('is-visible'),
            page: back.dataset.linkBackPage ?? null,
            shortcutId: back.dataset.shortcutId ?? null,
            opacity: getComputedStyle(back).opacity,
            rect: rect(back),
          }
        : null,
      flash: flash
        ? {
            page: Number(flash.closest('.pdf-page')?.dataset.page),
            animation: getComputedStyle(flash).animationName,
            opacity: getComputedStyle(flash).opacity,
            rect: rect(flash),
          }
        : null,
      hint: hint ? hint.textContent : null,
      ipc: ipc.filter((c) => c.cmd === 'open_external_url'),
      theme: document.documentElement.dataset.theme ?? '',
      selection: window.getSelection()?.toString() ?? '',
    };
  });

/** Distance (px) between the top of `pageNumber` and the top of the scroller viewport. */
const pageOffsetFromTop = (pageNumber) =>
  page.evaluate((n) => {
    const root = window.__linksRoot();
    const doc = root?.querySelector('.pdf-document');
    const target = root?.querySelector(`.pdf-page[data-page="${n}"]`);
    if (!doc || !target) return null;
    return Math.round((target.getBoundingClientRect().top - doc.getBoundingClientRect().top) * 100) / 100;
  }, pageNumber);

const scrollToPage = async (pageNumber) => {
  await page.evaluate((n) => {
    window.__linksRoot()?.querySelector(`.pdf-page[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });
  }, pageNumber);
  await pause(360);
};

/** Center of the link whose tooltip contains `needle` on `pageNumber` of the active reader. */
const linkBox = (pageNumber, needle) =>
  page.evaluate(
    ({ n, text }) => {
      const root = window.__linksRoot();
      const links = [...(root?.querySelectorAll(`.pdf-page[data-page="${n}"] .pdf-link`) ?? [])];
      const link = links.find((el) => (el.dataset.tip || '').includes(text));
      if (!link) return null;
      // The rect of a link that sits outside the scroller's viewport is useless for a real mouse
      // click (the rotated page 2 had cy = -10660 in run 25): centre it first, then measure.
      const first = link.getBoundingClientRect();
      if (first.top < 40 || first.bottom > window.innerHeight - 40 || first.left < 0 || first.right > window.innerWidth) {
        link.scrollIntoView({ block: 'center' });
      }
      const r = link.getBoundingClientRect();
      return {
        tip: link.dataset.tip,
        kind: link.dataset.linkKind,
        targetPage: link.dataset.linkPage ?? null,
        ownPage: Number(link.closest('.pdf-page')?.dataset.page),
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        pointerEvents: getComputedStyle(link).pointerEvents,
      };
    },
    { n: pageNumber, text: needle },
  );

/** First link on a page that matches any of `needles` (or the given kind) — logs what it saw. */
const firstLink = async (pageNumber, options = {}) => {
  const { needles = [], kind = null } = options;
  const result = await page.evaluate(
    ({ n, list, wanted }) => {
      const root = window.__linksRoot();
      const links = [...(root?.querySelectorAll(`.pdf-page[data-page="${n}"] .pdf-link`) ?? [])];
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { tip: el.dataset.tip, kind: el.dataset.linkKind, targetPage: el.dataset.linkPage ?? null, ownPage: Number(el.closest('.pdf-page')?.dataset.page), cx: r.left + r.width / 2, cy: r.top + r.height / 2, pointerEvents: getComputedStyle(el).pointerEvents };
      };
      const byNeedle = list.length ? links.find((el) => list.some((needle) => (el.dataset.tip || '').includes(needle))) : null;
      const byKind = wanted ? links.find((el) => el.dataset.linkKind === wanted) : null;
      const chosen = byNeedle ?? byKind ?? links[0] ?? null;
      if (chosen) {
        const first = chosen.getBoundingClientRect();
        if (first.top < 40 || first.bottom > window.innerHeight - 40 || first.left < 0 || first.right > window.innerWidth) {
          chosen.scrollIntoView({ block: 'center' });
        }
      }
      return { chosen: chosen ? box(chosen) : null, tips: links.map((el) => `${el.dataset.linkKind}|${el.dataset.tip}`).slice(0, 14) };
    },
    { n: pageNumber, list: needles, wanted: kind },
  );
  if (!result.chosen) log(`page ${pageNumber} links: ${JSON.stringify(result.tips)}`);
  return result;
};

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
  log(`shot ${name}.png`);
};
const pause = (ms = 320) => page.waitForTimeout(ms);
const until = async (fn, timeout = 15000, name = 'condition') => {
  try {
    await page.waitForFunction(fn, null, { timeout, polling: 120 });
    return true;
  } catch {
    log(`timeout waiting for ${name}`);
    return false;
  }
};
/**
 * The live window is only ~1280 px wide by default; the reader's note workbench falls back to
 * the floating quick-capture card below NOTE_WORKBENCH_NARROW_BREAKPOINT (980 px), so the docked
 * column (边读边记) needs a wider window. Same live window, only its bounds change.
 */
const WIDE_WINDOW = { width: 2000, height: 1300 };
let cdpSession = null;
let windowBefore = null;
const widenWindow = async () => {
  try {
    cdpSession = await page.context().newCDPSession(page);
    const win = await cdpSession.send('Browser.getWindowForTarget');
    windowBefore = win.bounds;
    if (win.bounds.width < WIDE_WINDOW.width) {
      await cdpSession.send('Browser.setWindowBounds', {
        windowId: win.windowId,
        bounds: { ...win.bounds, width: WIDE_WINDOW.width, height: Math.max(win.bounds.height, WIDE_WINDOW.height) },
      });
      await pause(900);
    }
    const after = await cdpSession.send('Browser.getWindowBounds', { windowId: win.windowId });
    report.observations.window = { before: windowBefore, after: after.bounds };
    log(`window bounds: ${windowBefore.width}x${windowBefore.height} → ${after.bounds.width}x${after.bounds.height}`);
  } catch (error) {
    log(`window resize unavailable: ${String(error).slice(0, 120)}`);
  }
};
const restoreWindow = async () => {
  try {
    if (cdpSession && windowBefore) {
      const win = await cdpSession.send('Browser.getWindowForTarget');
      await cdpSession.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: windowBefore });
      log('window bounds restored');
    }
  } catch (error) {
    log(`window restore failed: ${String(error).slice(0, 120)}`);
  }
};

const linksReadyExpr = (pageNumber) =>
  `(() => { const l = window.__linksRoot()?.querySelector('.pdf-page[data-page="${pageNumber}"] .pdf-link-layer'); return !!l && l.dataset.linkState === 'ready' && Number(l.dataset.linkCount) > 0; })()`;
const waitLinksReady = (pageNumber) => until(linksReadyExpr(pageNumber), 25000, `links of page ${pageNumber}`);

/** Back to the library scene through the workbench rail (scene.library / Ctrl+2). */
const openLibrary = async () => {
  if (await page.evaluate(() => window.__linksShown())) return true;
  await page.evaluate(() => document.querySelector('button[data-shortcut-id="scene.library"]')?.click());
  if (await until(`window.__linksShown()`, 10000, 'library scene')) return true;
  await page.keyboard.press('Control+2');
  return until(`window.__linksShown()`, 10000, 'library scene via Ctrl+2');
};

const openPaper = async (needle, expect = {}) => {
  check(await openLibrary(), 'the library scene is reachable in the isolated instance');
  // the row's title cell is the double-click target the library scene listens on
  const box = await page.evaluate((text) => {
    const row = [...document.querySelectorAll('.library-paper-index tbody tr')].find((el) => (el.textContent || '').includes(text));
    if (!row) return null;
    const cell = row.querySelector('.title-cell') ?? row;
    const rect = cell.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return { text: (row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), x: rect.left + Math.min(120, rect.width / 2), y: rect.top + rect.height / 2 };
  }, needle);
  check(Boolean(box), `the library lists a row for ${needle}`, box ?? needle);
  log(`open paper: ${JSON.stringify(box)}`);
  const look = () =>
    page.evaluate(() => {
      const root = window.__linksRoot();
      return { pages: root ? root.querySelectorAll('.pdf-page').length : 0, first: root ? (root.querySelector('.pdf-text-layer span')?.textContent ?? '').slice(0, 48) : null };
    });
  const matches = (info) => Boolean(info) && info.pages > 0 && (!expect.minPages || info.pages >= expect.minPages) && (!expect.maxPages || info.pages <= expect.maxPages);
  const poll = async (ms) => {
    const deadline = Date.now() + ms;
    let info = await look();
    while (Date.now() < deadline && !matches(info)) {
      await pause(400);
      info = await look();
    }
    return info;
  };
  const openers = [
    ['double-click the title cell', async () => { await openLibrary(); await page.mouse.dblclick(box.x, box.y); }],
    ['double-click again after Escape', async () => { await page.keyboard.press('Escape'); await pause(400); await openLibrary(); await page.mouse.dblclick(box.x, box.y); }],
    ['select the row and press Enter', async () => { await openLibrary(); await page.mouse.click(box.x, box.y); await pause(300); await page.keyboard.press('Enter'); }],
  ];
  let info = null;
  for (const [name, act] of openers) {
    await act();
    await until(`!!window.__linksRoot()`, 20000, 'reader scene');
    info = await poll(4000);
    if (matches(info)) {
      log(`opened ${needle} via: ${name}`);
      break;
    }
    log(`open attempt "${name}" did not switch to ${needle}: ${JSON.stringify(info)}`);
  }
  await until(`window.__linksRoot()?.querySelector('.pdf-page[data-page="1"] canvas.ready') !== null`, 40000, 'first canvas');
  await pause(400);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.workbench-tab-frame.hidden .reader-scene-shell')].map((el) => ({ pages: el.querySelectorAll('.pdf-page').length, first: (el.querySelector('.pdf-text-layer span')?.textContent ?? '').slice(0, 24) })),
  );
  check(matches(info), `the reader shows ${needle} (${info?.pages} pages)`, { info, hidden });
  log(`reader ready: ${JSON.stringify(info)} (hidden tabs: ${JSON.stringify(hidden)})`);
  const identity = await page.evaluate(() => {
    const root = window.__linksRoot();
    const active = document.querySelector('.workbench-tab-frame.active .reader-scene-shell');
    const title = root?.querySelector('.reader-paper-title, .pdf-document, header h1')?.textContent?.trim().slice(0, 60) ?? null;
    return {
      isActiveFrame: active === root,
      pages: [...(root?.querySelectorAll('.pdf-page') ?? [])].map((el) => el.dataset.page).slice(0, 20),
      linkPages: [...(root?.querySelectorAll('.pdf-page') ?? [])].map((el) => `${el.dataset.page}:${el.querySelectorAll('.pdf-link').length}`).slice(0, 20),
      layerStates: [...(root?.querySelectorAll('.pdf-link-layer') ?? [])].map((el) => `${el.closest('.pdf-page')?.dataset.page}:${el.dataset.linkState}:${el.dataset.linkCount}`).slice(0, 20),
      title,
    };
  });
  report.observations.readerIdentity = { ...(report.observations.readerIdentity ?? {}), [needle]: identity };
  log(`reader identity (${needle}): ${JSON.stringify(identity)}`);
  check(identity.isActiveFrame, 'the reader under test lives in the active workbench tab frame', identity);
};

const setTheme = async (theme) => {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await pause(220);
};

const setZoom150 = async () => {
  const label = () => page.evaluate(() => window.__linksRoot()?.querySelector('button.zoom-pct-btn')?.textContent ?? '');
  for (let i = 0; i < 12; i += 1) {
    if ((await label()).includes('150%')) break;
    await page.locator('button[data-shortcut-id="reader.zoomIn"]:visible').first().click();
    await pause(180);
  }
  await until(`window.__linksRoot()?.querySelector('button.zoom-pct-btn')?.textContent?.includes('150%') === true`, 8000, 'zoom 150%');
  await until(`window.__linksRoot()?.querySelector('.pdf-page[data-page="1"] canvas.ready') !== null`, 15000, 'canvas after zoom');
  await pause(300);
};

const setZoom100 = async () => {
  for (let i = 0; i < 12; i += 1) {
    const label = await page.evaluate(() => window.__linksRoot()?.querySelector('button.zoom-pct-btn')?.textContent ?? '');
    if (label.includes('100%')) break;
    await page.locator('button[data-shortcut-id="reader.zoomOut"]:visible').first().click();
    await pause(150);
  }
  await pause(250);
};

/** The browser regression's alignment probe, re-run inside the live window. */
const align = async (pageNumber, spanNeedle, linkNeedle) => {
  const linkNeedles = Array.isArray(linkNeedle) ? linkNeedle : [linkNeedle];
  const data = await page.evaluate(
    ({ n, spanText, linkText }) => {
      const root = window.__linksRoot();
      const layer = root?.querySelector(`.pdf-page[data-page="${n}"] .pdf-render-layer`);
      if (!layer) return null;
      const link = [...layer.querySelectorAll('.pdf-link')].find((el) => linkText.some((needle) => (el.dataset.tip || '').includes(needle)));
      const span = [...layer.querySelectorAll('.pdf-text-layer span')].find((el) => el.textContent === spanText);
      if (!link || !span) return { missing: { link: !link, span: !span } };
      const lr = layer.getBoundingClientRect();
      const b = link.getBoundingClientRect();
      const pct = (v) => parseFloat(v) / 100;
      const geo = { left: lr.left + pct(span.style.left) * lr.width, top: lr.top + pct(span.style.top) * lr.height };
      const fontPx = parseFloat(getComputedStyle(span).fontSize);
      const canvas = layer.querySelector('canvas');
      const cr = canvas.getBoundingClientRect();
      const sx = canvas.width / cr.width;
      const sy = canvas.height / cr.height;
      const pad = fontPx * 0.3 + 4;
      const x0 = Math.max(0, Math.floor((b.left - pad - cr.left) * sx));
      const y0 = Math.max(0, Math.floor((b.top - pad - cr.top) * sy));
      const x1 = Math.min(canvas.width, Math.ceil((b.right + pad - cr.left) * sx));
      const y1 = Math.min(canvas.height, Math.ceil((b.bottom + pad - cr.top) * sy));
      const img = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0);
      let il = Infinity;
      let it = Infinity;
      let ir = -Infinity;
      let ib = -Infinity;
      for (let y = 0; y < img.height; y += 1)
        for (let x = 0; x < img.width; x += 1) {
          const i = (y * img.width + x) * 4;
          if ((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 < 140) {
            il = Math.min(il, x);
            ir = Math.max(ir, x);
            it = Math.min(it, y);
            ib = Math.max(ib, y);
          }
        }
      const ink = il === Infinity ? null : { left: cr.left + (x0 + il) / sx, right: cr.left + (x0 + ir + 1) / sx, top: cr.top + (y0 + it) / sy, bottom: cr.top + (y0 + ib + 1) / sy };
      return { box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }, geo, fontPx, ink };
    },
    { n: pageNumber, spanText: spanNeedle, linkText: linkNeedles },
  );
  if (!data || data.missing) {
    log(`align page ${pageNumber} ${spanNeedle}: link or span missing`, data);
    return { geoDiff: Infinity, inkInside: false, inkCoverage: 0 };
  }
  const { box, geo, fontPx, ink } = data;
  const geoDiff = Math.max(Math.abs(box.left - geo.left), Math.abs(box.top - geo.top));
  const allowance = 2 + fontPx * 0.3;
  const inkInside = Boolean(ink) && ink.left >= box.left - allowance && ink.right <= box.right + allowance && ink.top >= box.top - allowance && ink.bottom <= box.bottom + allowance;
  const inkCoverage = ink ? Math.min((ink.right - ink.left) / box.width, (ink.bottom - ink.top) / box.height) : 0;
  log(`align page ${pageNumber} ${spanNeedle}: link=${JSON.stringify(box)} geoDiff=${round(geoDiff)} allowance=${round(allowance)} coverage=${round(inkCoverage)}`);
  return { box, geo, ink, geoDiff, inkInside, inkCoverage };
};

/**
 * Records the external-open IPC without letting it spawn real browser windows.
 *
 * `window.__TAURI_INTERNALS__.invoke` (and every other property of that object, plus
 * `window.ipc.postMessage`) is defined with `writable: false, configurable: false`, so
 * wrapping it silently does nothing — the earlier revision of this helper recorded an empty
 * array forever. Tauri's own `sendIpcMessage` is visible above that wall though: it either
 * POSTs to `http://ipc.localhost/<cmd>` (custom protocol, the Windows default) or hands the
 * serialized message to `window.ipc.postMessage` → `window.chrome.webview.postMessage`, both
 * of which are plain writable globals. Intercepting there records the exact command + payload
 * and lets `open_external_url` be answered locally instead of opening a browser window.
 */
const installIpcRecorder = () =>
  page.evaluate(() => {
    if (window.__ipcCalls) return;
    window.__ipcCalls = [];
    const record = (cmd, body, transport, extra = {}) => {
      const pickPath = (value) => {
        if (!value || typeof value !== 'object') return null;
        if (typeof value.request?.path === 'string') return value.request.path;
        if (typeof value.path === 'string') return value.path;
        if (typeof value.url === 'string') return value.url;
        return null;
      };
      const args = (() => {
        if (typeof body !== 'string') return body ?? null;
        try { return JSON.parse(body); } catch { return body; }
      })();
      window.__ipcCalls.push({ cmd, args, path: pickPath(args), transport, at: Date.now(), ...extra });
      return cmd === 'open_external_url';
    };
    // 1) custom protocol path: fetch('http://ipc.localhost/<cmd>', { method: 'POST', body })
    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    const originalFetch = window.fetch.bind(window);
    const fetchSpy = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (/ipc\.localhost/.test(url)) {
        let cmd = null;
        try { cmd = decodeURIComponent(new URL(url, location.href).pathname.replace(/^\//, '').split('?')[0]); } catch { cmd = null; }
        const swallowed = record(cmd, init?.body ?? null, 'fetch');
        if (swallowed) {
          // Answer locally: the Rust side is never reached, so no browser window opens, while
          // the caller's promise resolves exactly like a successful IPC reply.
          return Promise.resolve(
            new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }),
          );
        }
      }
      return originalFetch(input, init);
    };
    fetchSpy.__recorder = true;
    Object.defineProperty(window, 'fetch', { ...(descriptor ?? { writable: true, enumerable: true }), value: fetchSpy });
    // 2) postMessage path (used when the custom protocol is unavailable)
    const webview = window.chrome?.webview;
    if (webview && Object.getOwnPropertyDescriptor(webview, 'postMessage')?.writable) {
      const originalPost = webview.postMessage.bind(webview);
      const postSpy = (message) => {
        let cmd = null;
        try { cmd = JSON.parse(message)?.cmd ?? null; } catch { cmd = null; }
        if (cmd && record(cmd, message, 'postMessage')) return undefined;
        return originalPost(message);
      };
      webview.postMessage = postSpy;
    }
    window.__ipcRecorderReady = true;
  });

async function main() {
  // ---------- inputs ----------
  const fixtureSalt = process.env.PDF_LINKS_SALT ?? String(Date.now());
  const fixturePath = path.join(inputsDir, `link-fixture-${fixtureSalt}.pdf`);
  fs.writeFileSync(fixturePath, buildPdfLinkFixture({ salt: fixtureSalt }));
  report.observations.fixtureSalt = fixtureSalt;
  const arxivPath = path.join(inputsDir, 'arxiv-2505.13447.pdf');
  if (!fs.existsSync(arxivPath) || fs.statSync(arxivPath).size < 100000) {
    log('downloading the real arXiv PDF (2505.13447, Mean Flows)');
    const response = await fetch('https://arxiv.org/pdf/2505.13447', { redirect: 'follow' });
    assert.ok(response.ok, `arXiv download failed: ${response.status}`);
    fs.writeFileSync(arxivPath, Buffer.from(await response.arrayBuffer()));
  }
  report.observations.inputs = { arxivBytes: fs.statSync(arxivPath).size, fixtureBytes: fs.statSync(fixturePath).size };
  log(`inputs ready: arxiv=${report.observations.inputs.arxivBytes}B fixture=${report.observations.inputs.fixtureBytes}B`);

  // ---------- connect to the isolated live instance ----------
  browser = await chromium.connectOverCDP(CDP);
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(APP_URL)) ?? browser.contexts().flatMap((c) => c.pages())[0];
  assert.ok(page, `no page for ${APP_URL} on ${CDP}`);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => report.pageerrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) report.httpFailures.push({ url: response.url(), status: response.status() });
  });
  log(`connected: ${page.url()}`);

  await page.reload();
  await page.getByText('原生已核验', { exact: false }).first().waitFor({ state: 'visible', timeout: 40000 });
  await installRoot();
  const paths = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_aster_paths'));
  check(String(paths.root).includes(`app.aster.research.dev.${instance}.`), 'the window is the isolated dev:live library', paths.root);
  report.observations.paths = paths;
  await widenWindow();

  await installIpcRecorder();

  // ---------- seed the isolated library ----------
  const seeded = await page.evaluate(async ({ arxiv, fixture, salt }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const one = (original_path, title, venue, year) =>
      invoke('import_pdf_to_library', { request: { original_path, paper_id: null, title, authors: '', year, venue, doi: '', tags: ['链路跳转取证'] } });
    return {
      arxiv: await one(arxiv, 'Mean Flows for One-step Generative Modeling (arXiv 2505.13447)', 'arXiv', 2025),
      // a per-run copy: a paper that is not open yet in the reader, so opening it really switches
      fixture: await one(fixture, `PDF link fixture (live ${salt})`, 'fixture', 2026),
    };
  }, { arxiv: arxivPath, fixture: fixturePath, salt: fixtureSalt });
  report.observations.seeded = seeded;
  log(`seeded: ${JSON.stringify(seeded)}`);
  check(Boolean(seeded.arxiv?.paper_id) && Boolean(seeded.fixture?.paper_id), 'both PDFs are in the isolated library', seeded);

  await page.reload();
  await page.getByText('原生已核验', { exact: false }).first().waitFor({ state: 'visible', timeout: 40000 });
  await installRoot();
  check(await openLibrary(), 'the seeded library scene renders after the reload');
  await pause(400);

  // ---------- 1. real arXiv paper: hover tip, jump, flash, back button ----------
  await openPaper('Mean Flows', { minPages: 10 });
  const ready = await waitLinksReady(1);
  check(ready, 'link layer of the real arXiv page 1 reaches state ready', await page.evaluate(() => window.__linksRoot()?.querySelector('.pdf-page[data-page="1"] .pdf-link-layer')?.dataset.linkState));
  const first = await state();
  report.observations.arxivLinks = first.links.length;
  log(`arxiv page 1 links=${first.links.length} layer=${JSON.stringify(first.layerState)}`);
  check(first.links.length > 0, 'the real arXiv page exposes link boxes', first.links.length);

  const anyInternal = (await linkBox(1, '参考文献')) ?? (await linkBox(1, '跳转到第'));
  check(Boolean(anyInternal), 'an internal (citation) link is present on the arXiv page', anyInternal?.tip);
  await page.mouse.move(anyInternal.cx, anyInternal.cy);
  await pause(600);
  const hovered = (await linkBox(1, anyInternal.tip.includes('参考文献') ? '参考文献' : '跳转到第')) ?? anyInternal;
  check(hovered.pointerEvents === 'auto', 'in the cursor tool the link takes the pointer', hovered.pointerEvents);
  check(/第 \d+ 页/.test(hovered.tip), 'the hover tip names the target page', hovered.tip);
  await shot('01-live-hover-citation');
  report.observations.arxivCitation = hovered;

  const beforeJump = await state();
  const originScroll = beforeJump.scrollTop;
  await page.mouse.click(hovered.cx, hovered.cy);
  const flashSeen = await until(`!!(window.__linksRoot()?.querySelector('.pdf-link-flash'))`, 900, 'link flash');
  report.observations.flash = await page.evaluate(() => {
    const root = window.__linksRoot();
    const flash = root?.querySelector('.pdf-link-flash');
    if (!flash) return null;
    const doc = root?.querySelector('.pdf-document');
    const rect = flash.getBoundingClientRect();
    return {
      page: Number(flash.closest('.pdf-page')?.dataset.page),
      animation: getComputedStyle(flash).animationName,
      duration: getComputedStyle(flash).animationDuration,
      style: flash.getAttribute('style'),
      topPx: doc ? Math.round((rect.top - doc.getBoundingClientRect().top) * 100) / 100 : null,
      heightPx: Math.round(rect.height * 100) / 100,
    };
  });
  check(flashSeen, 'the jump paints the one-shot link flash', report.observations.flash);
  const backSeen = await until(`!!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 1500, 'back button after the jump');
  const mid = await state();
  check(backSeen && mid.back !== null && mid.back.visible === true, '「返回 第 N 页」 appears on the right after the jump', mid.back);
  check(mid.scrollTop !== originScroll, 'the jump scrolled the document', { origin: originScroll, now: mid.scrollTop });
  // the button names the ORIGIN page; the target page comes from the link itself
  const targetPage = Number(hovered.targetPage ?? report.observations.flash?.page ?? mid.back.page);
  const pageOffset = await pageOffsetFromTop(targetPage);
  check(mid.back.page === String(hovered.ownPage), 'the back button names the page the jump started from', { origin: mid.back.page, ownPage: hovered.ownPage });
  const flashTop = report.observations.flash?.topPx ?? null;
  check(flashTop !== null && flashTop >= 0 && flashTop <= 80, 'the cited line lands at the upper viewport (target top margin)', { flashTop, scrollTop: mid.scrollTop, targetPage, pageOffset });
  await shot('02-live-jump-flash-and-back');
  const flashGone = await until(`!window.__linksRoot()?.querySelector('.pdf-link-flash')`, 3000, 'flash removal');
  check(flashGone, 'the flash removes itself right after the animation');

  // ---------- 2. the return click ----------
  const backBox = await page.evaluate(() => {
    const el = window.__linksRoot()?.querySelector('.pdf-link-back.is-visible');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: (el.textContent || '').trim(), rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  });
  check(Boolean(backBox), 'the 「返回 第 N 页」 button is clickable in the active reader', backBox);
  await page.mouse.click(backBox.x, backBox.y);
  await pause(150);
  const returning = await state();
  check(Math.abs(returning.scrollTop - originScroll) <= 2, 'the return click restores the exact scroll offset', { origin: originScroll, now: returning.scrollTop });
  check(returning.back === null || returning.back.visible === false, 'the back button starts fading right after the return', returning.back);
  const faded = await until(`!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 3000, 'back fade');
  check(faded, 'the back button fades out after the return');
  await shot('04-live-after-return');

  // ---------- 3. manual scroll back dismisses the button ----------
  const again = (await linkBox(1, hovered.tip.includes('参考文献') ? '参考文献' : '跳转到第')) ?? anyInternal;
  await page.mouse.click(again.cx, again.cy);
  const secondSeen = await until(`!!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 1500, 'back button after the second jump');
  const jumped = await state();
  check(secondSeen && jumped.back?.visible === true, 'a second jump shows the button again', jumped.back);
  await page.evaluate((value) => {
    const doc = window.__linksRoot()?.querySelector('.pdf-document');
    if (doc) doc.scrollTop = value;
  }, originScroll);
  await pause(140);
  const dismissed = await until(`!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 4000, 'manual return dismissal');
  const home = await state();
  check(dismissed, 'the button fades out when the viewport is back at the origin', { scrollTop: home.scrollTop, back: home.back });
  await shot('05-live-manual-return-fade');

  // ---------- 3b. the docked note column stays clear of the button ----------
  // The reader's note workbench docks its column beside the PDF (`Control+Alt+2`, 边读边记);
  // that mode keeps the PDF's own scroller, so the link jump and the 「返回」button stay live.
  // (The floating quick-capture card lays the PDF out at full height instead — see the
  // delivery note; the jump cannot scroll there.)
  const shellMode = () =>
    page.evaluate(() => {
      const shell = document.querySelector('.workbench-tab-frame.active .reader-workspace-shell');
      return shell ? { noteMode: shell.dataset.noteMode ?? null, cls: String(shell.className) } : null;
    });
  const pressNote = async (keys, needle) => {
    await page.keyboard.press(keys);
    const switched = await until(
      `(() => { const s = document.querySelector('.workbench-tab-frame.active .reader-workspace-shell'); return !!s && (s.dataset.noteMode === '${needle}' || String(s.className).includes('note-mode-${needle}')); })()`,
      4000,
      `note mode ${needle}`,
    );
    if (!switched) {
      // some builds only route the command while the reader has the focus
      const spot = await page.evaluate(() => {
        const rect = window.__linksRoot()?.querySelector('.pdf-document')?.getBoundingClientRect();
        return rect ? { x: rect.left + 60, y: rect.top + 60 } : null;
      });
      if (spot) await page.mouse.click(spot.x, spot.y);
      await page.keyboard.press(keys);
      return until(
        `(() => { const s = document.querySelector('.workbench-tab-frame.active .reader-workspace-shell'); return !!s && (s.dataset.noteMode === '${needle}' || String(s.className).includes('note-mode-${needle}')); })()`,
        4000,
        `note mode ${needle} (after focus)`,
      );
    }
    return true;
  };
  const docked = await pressNote('Control+Alt+2', 'split');
  report.observations.noteMode = { before: await shellMode(), docked };
  check(docked, 'the reader note workbench switches to the docked column (边读边记)', await shellMode());
  if (docked) {
    await page.evaluate(() => {
      const doc = window.__linksRoot()?.querySelector('.pdf-document');
      if (doc) doc.scrollTop = 0;
    });
    await pause(600);
    const dockedLink = (await linkBox(1, hovered.tip.includes('参考文献') ? '参考文献' : '跳转到第')) ?? anyInternal;
    await page.mouse.click(dockedLink.cx, dockedLink.cy);
    const dockedBackSeen = await until(`!!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 3000, 'back button in the docked note mode');
    const dockedState = await state();
    check(dockedBackSeen && dockedState.back?.visible === true, 'the jump and the 「返回」button work with the note column docked', dockedState.back);
    const clearance = await page.evaluate(() => {
      const button = window.__linksRoot()?.querySelector('.pdf-link-back');
      const pane = window.__linksRoot()?.querySelector('.pdf-keepalive-pane.active .pdf-document') ?? window.__linksRoot()?.querySelector('.pdf-document');
      if (!button || !pane) return null;
      const b = button.getBoundingClientRect();
      const r = pane.getBoundingClientRect();
      return { buttonRight: b.right, paneRight: r.right, insidePdfPane: b.right <= r.right + 1 && b.left >= r.left - 1, heightRatio: Math.round(((b.top + b.height / 2 - r.top) / r.height) * 100) / 100 };
    });
    check(clearance?.insidePdfPane === true, 'the button stays inside the PDF column, clear of the docked notes', clearance);
    await shot('03-live-back-with-note-drawer');
    report.observations.noteMode.dockedClearance = clearance;
    report.observations.noteMode.dockedBack = dockedState.back;
    const backToReading = await pressNote('Control+Alt+P', 'reading');
    check(backToReading, '「PDF 专注」 returns the reader to the plain reading mode', await shellMode());
    await pause(400);
  }

  // ---------- 4. two-hop stack on the fixture (flat + /Rotate 90) ----------
  // A paper that is already open in the reader does not come back to the front when the library
  // opens it again (the reader keeps the previous document alive in a hidden pane). Dropping the
  // restored selection makes this open a fresh one — exactly what the manual walk-through does
  // when the paper was not opened before.
  // A clean reader is not required: `openLibrary()` really switches the scene now, so a row
  // double-click opens (or re-activates) the fixture even while the arXiv paper keeps its tab.
  // (Deleting the arXiv paper here used to leave its reader tab behind, which logged
  // 「Selected source PDF is not bound to current paper」 — the console-error check caught it.)
  await page.reload();
  await page.getByText('原生已核验', { exact: false }).first().waitFor({ state: 'visible', timeout: 40000 });
  await installRoot();
  await installIpcRecorder();
  check(await page.evaluate(() => Array.isArray(window.__ipcCalls)), 'the IPC recorder survives the reload (open_external_url stub installed)');
  await pause(900);
  await openPaper('PDF link fixture (live', { maxPages: 8 });
  await waitLinksReady(1);
  const firstHopLink = await firstLink(1, { needles: ['[12]', '跳转到第'], kind: 'internal' });
  const fix1 = firstHopLink.chosen;
  check(Boolean(fix1) && fix1.kind === 'internal', 'the fixture exposes an internal [12] link on page 1', fix1?.tip ?? firstHopLink.tips);
  log(`fixture page 1 links: ${JSON.stringify(firstHopLink.tips)}`);
  await page.mouse.click(fix1.cx, fix1.cy);
  const hop1Seen = await until(`window.__linksRoot()?.querySelector('.pdf-link-back')?.dataset.linkBackPage === '${fix1.ownPage}'`, 2500, 'back button after the first hop');
  const hop1 = await state();
  check(hop1Seen && hop1.back?.visible === true, 'first hop of the stack shows 「返回 第 1 页」', hop1.back);
  const page2Ready = await waitLinksReady(2);
  check(page2Ready, 'the /Rotate 90 page loads its own link layer', await page.evaluate(() => window.__linksRoot()?.querySelector('.pdf-page[data-page="2"] .pdf-link-layer')?.dataset.linkState));
  // The first hop landed on page 3, so the rotated page sits far above the viewport: bring it
  // back on screen before clicking its rect (page 2 is not the origin page, so the pending
  // 「返回 第 1 页」 button is not auto-dismissed by this scroll).
  await scrollToPage(2);
  const secondHop = await firstLink(2, { needles: ['参考文献 [7]', '[7]', '跳转到第'], kind: 'internal' });
  log(`fixture page 2 click target: ${JSON.stringify(secondHop.chosen)} viewport ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`);
  const hop2 = secondHop.chosen;
  check(Boolean(hop2), 'the rotated page exposes its [7] citation link', hop2?.tip ?? secondHop.tips);
  log(`fixture page 2 links: ${JSON.stringify(secondHop.tips)}`);
  await page.mouse.click(hop2.cx, hop2.cy);
  const hop2Seen = await until(`window.__linksRoot()?.querySelector('.pdf-link-back')?.dataset.linkBackPage === '${hop2.ownPage}'`, 2500, 'back button naming the second origin');
  const stacked = await state();
  check(hop2Seen && stacked.back?.visible === true && stacked.back.page === String(hop2.ownPage), `the stack keeps the most recent origin (page ${hop2.ownPage})`, { back: stacked.back, link: hop2 });
  await shot('06-live-two-hop-stack');

  // Alt+← through the shortcut system pops one level at a time
  const beforeShortcut = await page.evaluate(() => window.__linksRoot()?.querySelector('.pdf-document')?.scrollTop ?? null);
  await page.keyboard.press('Alt+ArrowLeft');
  await pause(320);
  const popped = await state();
  check(popped.back?.visible === true && popped.back.page === String(fix1.ownPage), `Alt+← popped one level back to the page-${fix1.ownPage} origin`, popped.back);
  await page.keyboard.press('Alt+ArrowLeft');
  await pause(320);
  const home2 = await state();
  check(home2.back === null || home2.back.visible === false, 'the second Alt+← empties the stack and hides the button', home2.back);
  log(`shortcut return: ${beforeShortcut} → ${popped.scrollTop} → ${home2.scrollTop}`);

  // ---------- 5. external links and the security policy ----------
  await scrollToPage(1);
  const ext = await linkBox(1, 'https://');
  check(Boolean(ext) && ext.kind === 'external', 'the fixture exposes an https link', ext?.tip);
  await page.mouse.move(ext.cx, ext.cy);
  await pause(600);
  check(/https:\/\/[^/]+\.[^/]+/.test(ext.tip), 'the hover tip shows the full external URL (domain visible)', ext.tip);
  await shot('07-live-external-hover');
  log(
    `external click target: ${JSON.stringify({ ...ext, viewport: await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`) })} under=${await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : null; }, { x: ext.cx, y: ext.cy })}`,
  );
  await page.mouse.click(ext.cx, ext.cy);
  await pause(280);
  const extState = await state();
  check(
    extState.ipc.length === 1 && extState.ipc[0].cmd === 'open_external_url' && (extState.ipc[0].path === ext.tip || extState.ipc[0].args?.request?.path === ext.tip),
    'the click reached open_external_url with the exact https URL',
    extState.ipc,
  );
  check(extState.hint === null, 'an https link opens without a confirmation hint', extState.hint);

  const jsLink = await linkBox(1, 'javascript:');
  check(Boolean(jsLink), 'the fixture carries a javascript: link', jsLink?.tip);
  await page.mouse.click(jsLink.cx, jsLink.cy);
  await pause(320);
  const jsState = await state();
  check(jsState.ipc.length === 1 && typeof jsState.hint === 'string' && jsState.hint.includes('javascript:'), 'javascript: is rejected with a hint and never reaches the IPC', { ipc: jsState.ipc.length, hint: jsState.hint });
  await shot('08-live-javascript-blocked');
  const mailto = await linkBox(1, 'mailto:');
  if (mailto) {
    await page.mouse.click(mailto.cx, mailto.cy);
    await pause(320);
    const mailState = await state();
    check(mailState.ipc.length === 1 && typeof mailState.hint === 'string' && mailState.hint.includes('mailto:'), 'mailto: is rejected with a hint and never reaches the IPC', { ipc: mailState.ipc.length, hint: mailState.hint });
  }

  // ---------- 6. tools and text selection ----------
  await scrollToPage(1);
  const highlightTool = page.locator('button[data-shortcut-id="reader.tool.highlight"]:visible').first();
  if (await highlightTool.count()) {
    await highlightTool.click();
    await pause(240);
    const toolState = await state();
    check(toolState.links.length > 0 && toolState.links.every((l) => l.pointerEvents === 'none'), 'with a drawing tool active every link box ignores the pointer', toolState.links.map((l) => l.pointerEvents).slice(0, 4));
    const any = (await linkBox(1, '跳转到第')) ?? fix1;
    const scrollBefore = await page.evaluate(() => window.__linksRoot()?.querySelector('.pdf-document')?.scrollTop ?? null);
    await page.mouse.click(any.cx, any.cy);
    await pause(280);
    const afterTool = await state();
    check(afterTool.scrollTop === scrollBefore && (afterTool.back === null || afterTool.back.visible === false), 'a click on a link box with a tool active never jumps', { before: scrollBefore, after: afterTool.scrollTop });
    await shot('09-live-tool-sees-through');
    await page.locator('button[data-shortcut-id="reader.tool.cursor"]:visible').first().click();
    await pause(240);
  } else {
    report.observations.highlightTool = 'not found';
  }

  const drag = await page.evaluate(() => {
    const root = window.__linksRoot();
    const span = [...(root?.querySelectorAll('.pdf-page[data-page="1"] .pdf-text-layer span') ?? [])].find((el) => el.textContent.includes('Wide line'));
    if (!span) return null;
    const r = span.getBoundingClientRect();
    return { x0: r.left + 2, y: r.top + r.height / 2, x1: r.right - 2 };
  });
  if (drag) {
    await page.mouse.move(drag.x0, drag.y);
    await page.mouse.down();
    await page.mouse.move((drag.x0 + drag.x1) / 2, drag.y, { steps: 8 });
    await page.mouse.move(drag.x1, drag.y, { steps: 8 });
    await page.mouse.up();
    await pause(340);
    const selected = await state();
    check(selected.selection.length > 3, 'a drag across a line that carries a link still selects text', selected.selection);
    check(selected.back === null || selected.back.visible === false, 'selecting across the link does not trigger a jump', selected.back);
    await shot('10-live-selection-across-links');
  }

  // ---------- 7. 150 % alignment (flat + /Rotate 90) ----------
  await page.evaluate(() => {
    const doc = window.__linksRoot()?.querySelector('.pdf-document');
    if (doc) doc.scrollTop = 0;
  });
  await pause(220);
  await setZoom150();
  const flat = await align(1, '[12]', ['参考文献 [12]', '[12]']);
  check(flat.geoDiff <= 2, 'at 150 % the [12] link box matches the text-layer geometry (≤2 px)', round(flat.geoDiff));
  check(flat.inkInside && flat.inkCoverage >= 0.5, 'at 150 % the painted glyphs sit inside the link box', { inside: flat.inkInside, coverage: round(flat.inkCoverage) });
  await shot('11-live-150-flat');
  await scrollToPage(2);
  await waitLinksReady(2);
  const rotatedOffset = await pageOffsetFromTop(2);
  check(Math.abs(rotatedOffset) <= 80, 'page 2 of the fixture sits at the upper viewport for the rotated probe', rotatedOffset);
  const rotated = await align(2, '[7]', ['参考文献 [7]', '[7]']);
  check(rotated.geoDiff <= 2, 'at 150 % on the /Rotate 90 page the [7] box matches the text layer (≤2 px)', round(rotated.geoDiff));
  check(rotated.inkInside && rotated.inkCoverage >= 0.5, 'at 150 % on the rotated page the glyphs sit inside the box', { inside: rotated.inkInside, coverage: round(rotated.inkCoverage) });
  await shot('12-live-150-rotated');
  await setZoom100();

  // ---------- 8. dark theme ----------
  await page.evaluate(() => {
    const doc = window.__linksRoot()?.querySelector('.pdf-document');
    if (doc) doc.scrollTop = 0;
  });
  await setTheme('midnight');
  const darkLink = (await firstLink(1, { needles: ['参考文献', '跳转到第'], kind: 'internal' })).chosen;
  await page.mouse.move(darkLink.cx, darkLink.cy);
  await pause(620);
  await shot('13-live-dark-hover');
  await page.mouse.click(darkLink.cx, darkLink.cy);
  await until(`!!window.__linksRoot()?.querySelector('.pdf-link-back.is-visible')`, 1500, 'back button on the dark theme');
  const darkJump = await state();
  check(darkJump.back?.visible === true, 'the back button is visible on the dark theme too', darkJump.back);
  await shot('14-live-dark-back');
  await page.locator('.pdf-link-back.is-visible').last().click();
  await pause(280);
  await setTheme('paper');
  await shot('15-live-light-restored');

  // ---------- 9. clean console ----------
  check(report.pageerrors.length === 0, 'no pageerror during the whole live walk-through', report.pageerrors);
  check(report.consoleErrors.length === 0, 'no console error during the whole live walk-through', report.consoleErrors);
}

try {
  await main();
  report.passed = checks;
  console.log(JSON.stringify({ passed: checks, screenshots: report.screenshots.length, pageerrors: report.pageerrors, consoleErrors: report.consoleErrors }));
} catch (error) {
  report.failure = String(error?.stack ?? error);
  try {
    if (page) await page.screenshot({ path: path.join(outDir, 'failed.png') }).catch(() => {});
  } catch {}
  throw error;
} finally {
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(report, null, 2));
  await restoreWindow();
  await browser?.close();
  log(`evidence written to ${path.relative(root, outDir)} (${report.screenshots.length} screenshots)`);
}
