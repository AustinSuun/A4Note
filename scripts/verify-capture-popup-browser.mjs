/**
 * Popup UI regression for the IEEE Xplore fix (task 5fd94c28).
 *
 * Renders the real popup.html markup with the real popup.js module and a stubbed
 * chrome.* surface; scripting.executeScript is bridged to a recorded collectPage payload
 * captured from the live IEEE page (scripts/fixtures/capture-ieee-collected.json), so the
 * card, the gated entry point and the failure messaging are the shipping code paths.
 *
 *   node scripts/verify-capture-popup-browser.mjs
 * Evidence: .tmp/shots/capture-popup/<run>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = process.cwd();
const hostDir = path.join(root, '.tmp', 'capture-popup');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, '.tmp', 'shots', 'capture-popup', run);
fs.mkdirSync(hostDir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });

const popupHtml = fs.readFileSync(path.join(root, 'apps/browser-extension/popup.html'), 'utf8');
const markup = popupHtml.slice(popupHtml.indexOf('<body'), popupHtml.indexOf('</body>'))
  .replace(/<script[^>]*><\/script>/g, '').replace(/<script[^>]*\/>/g, '');

fs.writeFileSync(path.join(hostDir, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>capture popup</title>
<link rel="stylesheet" href="/apps/browser-extension/popup.css">
<link rel="stylesheet" href="/apps/browser-extension/folder-tree.css">
<link rel="stylesheet" href="/apps/browser-extension/compact-view.css"></head>
${markup}
<script type="module">
  // Stubbed browser plumbing; the popup module itself is unmodified.
  const recorded = await (await fetch('/.tmp/capture-popup/collected.json')).json();
  const calls = [];
  window.__calls = calls;
  window.chrome = {
    tabs: {
      query: async () => [{ id: 7, url: recorded.url }],
      create: async (options) => { calls.push('tabs.create:' + options.url); return {}; },
    },
    scripting: { executeScript: async () => [{ result: recorded }] },
    downloads: { download: async (options) => { calls.push('downloads.download:' + options.url); return 1; } },
    runtime: { sendMessage: async () => ({ ok: false }), connectNative: () => ({ postMessage() {}, disconnect() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }), onMessage: { addListener() {} }, getURL: (p) => p, lastError: null },
    storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}), set: async () => {} } },
  };
  await import('/apps/browser-extension/popup.js');
  window.__ready = true;
</script></body></html>`);
fs.copyFileSync(path.join(root, 'scripts/fixtures/capture-ieee-collected.json'), path.join(hostDir, 'collected.json'));
// The header renders the real icon; serve it so the harness has no stray 404s.
fs.mkdirSync(path.join(hostDir, 'icons'), { recursive: true });
fs.copyFileSync(path.join(root, 'apps/browser-extension/icons/48.png'), path.join(hostDir, 'icons/48.png'));

const ITEM = '在浏览器中打开';
const results = [];
const check = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : detail });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
try {
  server = await createServer({ configFile: false, root, cacheDir: path.join(hostDir, 'cache'), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/capture-popup/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2 });
    const errors = [];
    const ignored = [];
    page.on('response', (response) => { if (response.status() >= 400) console.log('HTTP ' + response.status() + ' ' + response.url()); });
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text().slice(0, 200);
      // Isolated harness assets (favicon and friends) are not product behaviour;
      // uncaught exceptions and other console errors still fail the run.
      if (text.includes('Failed to load resource')) ignored.push(text); else errors.push(text);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true });

    // Main view: the paper card a user sees right after clicking the extension.
    // compact-view.js moves #status into the ⚙ help view, so read its text, not its box.
    const status = (await page.evaluate(() => document.getElementById('status').textContent)).trim();
    check('识别成功，不再是静默失败', status.includes('已识别'), status);
    check('状态说明正文需要登录或订阅', status.includes('登录或订阅'), status);
    check('主视图直接可见论文卡片', await page.locator('#title').isVisible());
    check('标题显示论文名', (await page.locator('#title').innerText()).includes('MD3D'), await page.locator('#title').innerText());
    check('作者显示为真实作者名', (await page.locator('#authors').innerText()).includes('Jaeseok Choi'), await page.locator('#authors').innerText());
    check('标识显示 DOI', (await page.locator('#ids').innerText()).toLowerCase().includes('10.1109/access.2022.3210108'), await page.locator('#ids').innerText());
    check('正文证据标注为需要登录或订阅', (await page.locator('#pdf-evidence').innerText()).includes('登录或订阅'), await page.locator('#pdf-evidence').innerText());
    check('帮助按钮为“需要”类状态提示关注', (await page.locator('#help-toggle').getAttribute('data-attention')) === 'true', String(await page.locator('#help-toggle').getAttribute('data-attention')));
    await shot('01-ieee-popup-identified');

    // Help view: the file list lives behind ⚙ just like for a real user.
    await page.locator('#help-toggle').click();
    await pause(200);
    // The file list sits inside a collapsed disclosure; a user opens it to inspect files.
    await page.evaluate(() => document.querySelectorAll('details').forEach((node) => { node.open = true; }));
    await pause(150);
    check('帮助视图中可见完整状态说明', await page.locator('#status').isVisible());
    const gatedButton = page.locator('#files button', { hasText: ITEM }).first();
    check('受限入口按钮为“在浏览器中打开”', await gatedButton.isVisible());
    check('未对受限入口提供“仅保存文件到电脑”', (await page.locator('#files button', { hasText: '仅保存文件到电脑' }).count()) === 0);
    check('“浏览器辅助获取 PDF”不在受限入口旁', (await page.locator('#files .file button[data-assist="true"]').count()) === 0);
    const warnings = await page.locator('#warnings').innerText();
    check('警告说明需要登录/订阅且未绕过', warnings.includes('登录或订阅'), warnings.replace(/\s+/g, ' ').slice(0, 160));
    await shot('02-ieee-popup-gated-entry');

    await gatedButton.click();
    await pause(200);
    const calls = await page.evaluate(() => window.__calls);
    check('点击后打开浏览器标签而不是下载', calls.some((c) => c.startsWith('tabs.create:') && c.includes('stamp.jsp')), JSON.stringify(calls));
    check('受限入口未触发任何下载', !calls.some((c) => c.startsWith('downloads.download:') && c.includes('stamp.jsp')), JSON.stringify(calls));
    const afterClick = (await page.locator('#status').innerText()).trim();
    check('点击后有明确反馈（不静默）', afterClick.includes('登录或订阅'), afterClick);
    check('页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '));
    if (ignored.length) console.log('NOTE 已忽略宿主资源加载噪声 ' + ignored.length + ' 条：' + ignored[0]);
  } finally {
    await browser.close();
  }
} finally {
  if (server) await server.close();
}

const failed = results.filter((r) => !r.passed);
for (const r of results) console.log((r.passed ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' :: ' + r.detail : ''));
console.log('capture-popup-browser: ' + (results.length - failed.length) + '/' + results.length + ' checks passed; evidence in ' + path.relative(root, evidence));
if (failed.length || !results.length) process.exitCode = 1;
