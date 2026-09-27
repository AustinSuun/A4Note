// Run only against the owned isolated dev:live instance xunchuan-storage.
// Captures actual native WebView screenshots and exercises migration and dismissal
// exclusively inside its dev identity. The fixture is never a production library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const origin = 'http://127.0.0.1:1486';
const shots = path.resolve('.tmp/shots/storage-notice');
fs.mkdirSync(shots, { recursive: true });
const report = { checks: [], pageerrors: [], consoleErrors: [], shots: [] };
const check = (name, condition, detail) => {
  report.checks.push({ name, passed: Boolean(condition), detail });
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
};
let browser;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9386');
  const page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith(origin));
  assert.ok(page, 'Expected owned dev:live page');
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.pageerrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.reload();
  await page.getByText('原生已核验', { exact: false }).waitFor();
  const invoke = (command, args = {}) => page.evaluate(([cmd, options]) => window.__TAURI_INTERNALS__.invoke(cmd, options), [command, args]);
  const paths = await invoke('get_aster_paths');
  check('owned isolated native identity', paths.root.includes('app.aster.research.dev.xunchuan-storage.'), paths.root);
  let initial = await invoke('get_library_storage');
  // Re-arm only this owned test identity when the previous run dismissed the notice.
  if (initial.promptDismissed) {
    assert.equal(initial.isCustom, false);
    const configPath = path.join(paths.root, 'storage.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.filesRoot, null);
    config.promptDismissedAt = null;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    initial = await invoke('get_library_storage');
  }
  check('recommendation remains inside dev identity', initial.isolated && !initial.isCustom && initial.recommendedRoot?.includes('app.aster.research.dev.xunchuan-storage.'), initial.recommendedRoot);
  if (!await page.locator('#library-storage-notice').count()) await page.getByText('文献库', { exact: true }).first().click();
  const notice = page.locator('#library-storage-notice');
  await notice.waitFor();
  check('both paths preserved', (await notice.innerText()).includes(initial.filesRoot) && (await notice.innerText()).includes(initial.recommendedRoot));
  check('same two action labels', JSON.stringify(await notice.locator('button').allInnerTexts()) === JSON.stringify(['使用推荐位置', '保持默认，不再提示']));
  const shot = async name => {
    await page.getByText('原生已核验', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    report.shots.push(name);
  };
  const styles = () => notice.evaluate(el => {
    const p = el.querySelector('.library-storage-notice-copy p');
    const paths = [...el.querySelectorAll('.library-storage-notice-path')];
    const primary = el.querySelector('#library-storage-notice-accept');
    const secondary = el.querySelector('#library-storage-notice-dismiss');
    const actions = el.querySelector('.library-storage-notice-actions');
    const rect = el.getBoundingClientRect();
    return {
      paths: paths.map(node => ({ family: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, text: node.textContent })),
      bodyFamily: getComputedStyle(p).fontFamily, bodySize: getComputedStyle(p).fontSize,
      primary: { bg: getComputedStyle(primary).backgroundColor, color: getComputedStyle(primary).color, radius: getComputedStyle(primary).borderRadius, height: primary.getBoundingClientRect().height },
      secondary: { bg: getComputedStyle(secondary).backgroundColor, height: secondary.getBoundingClientRect().height },
      noticeWidth: el.clientWidth, noticeScroll: el.scrollWidth,
      actionsWidth: actions.clientWidth, actionsScroll: actions.scrollWidth,
      rect: { left: rect.left, right: rect.right, viewport: innerWidth },
      buttons: [primary, secondary].map(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right }; }),
      theme: document.documentElement.dataset.theme,
    };
  });
  const normal = await styles();
  check('Windows paths use exactly the paragraph family and size', normal.paths.length === 2 && normal.paths.every(p => p.family === normal.bodyFamily && p.size === normal.bodySize), normal);
  check('green main action contrasts neutral secondary and matches height', normal.primary.bg !== normal.secondary.bg && normal.primary.color === 'rgb(255, 255, 255)' && normal.primary.height >= 32 && normal.primary.height === normal.secondary.height && normal.primary.radius !== '0px', normal);
  await shot('after-light-100pct');
  await page.locator('#library-storage-notice-accept').hover();
  const hovered = await styles();
  check('primary hover gets a distinct green', hovered.primary.bg !== normal.primary.bg, { normal: normal.primary.bg, hover: hovered.primary.bg });
  await page.locator('#library-storage-notice-accept').focus();
  const focused = await page.locator('#library-storage-notice-accept').evaluate(el => ({ focus: document.activeElement === el, outline: getComputedStyle(el).outlineStyle }));
  check('primary action is keyboard focusable', focused.focus, focused);
  const disabled = await page.locator('#library-storage-notice-accept').evaluate(el => { el.disabled = true; const opacity = getComputedStyle(el).opacity; el.disabled = false; return Number(opacity); });
  check('disabled action dims visibly', disabled <= .6, disabled);
  const cdp = await page.context().newCDPSession(page);
  // The native window cannot be narrower than 980px. Scale UI typography at
  // supported widths instead of CSS-zooming the entire shell beyond its minimum.
  for (const [name, width, uiSize, theme] of [
    ['after-dark-1100-ui125pct', 1100, 22.5, 'midnight'],
    ['after-light-980-ui150pct', 980, 27, 'paper'],
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 0, mobile: false });
    await page.evaluate(([selectedTheme, selectedSize]) => { document.documentElement.dataset.theme = selectedTheme; document.documentElement.style.setProperty('--ui-font-size', `${selectedSize}px`); }, [theme, uiSize]);
    await page.waitForTimeout(450);
    const metric = await styles();
    check(`${name}: actual theme and UI font scale`, metric.theme === theme && Math.abs(parseFloat(metric.bodySize) - uiSize * 2 / 3) < .1, metric);
    await shot(name);
    check(`${name}: paths and both buttons fit supported narrow window`, metric.paths.every(p => p.family === metric.bodyFamily && p.size === metric.bodySize) && metric.noticeScroll <= metric.noticeWidth + 1 && metric.actionsScroll <= metric.actionsWidth + 1 && metric.rect.left >= -1 && metric.rect.right <= width + 1 && metric.buttons.every(b => b.left >= -1 && b.right <= width + 1), metric);
    check(`${name}: primary/secondary remain distinct`, metric.primary.bg !== metric.secondary.bg, metric);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'paper'; document.documentElement.style.removeProperty('--ui-font-size'); });
  await notice.getByRole('button', { name: '使用推荐位置' }).click();
  await page.waitForFunction(() => !document.querySelector('#library-storage-notice'), null, { timeout: 30000 });
  const migrated = await invoke('get_library_storage');
  check('recommendation action migrated only isolated library', migrated.isCustom && migrated.filesRoot === initial.recommendedRoot, migrated.filesRoot);
  await invoke('set_library_files_root', { path: null, migrate: true });
  await page.reload();
  await notice.waitFor();
  check('reset fixture restores prompt without altering dismissal', !(await invoke('get_library_storage')).promptDismissed);
  await notice.getByRole('button', { name: '保持默认，不再提示' }).click();
  await notice.waitFor({ state: 'hidden' });
  check('dismissal persists in isolated library', (await invoke('get_library_storage')).promptDismissed);
  await page.reload();
  await page.getByText('原生已核验', { exact: false }).waitFor();
  check('dismissed prompt stays hidden after reload', await notice.count() === 0);
  check('no page errors', report.pageerrors.length === 0, report.pageerrors);
  check('no console errors', report.consoleErrors.length === 0, report.consoleErrors);
} finally {
  fs.writeFileSync(path.join(shots, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close();
}
console.log(JSON.stringify({ checks: report.checks.length, failures: report.checks.filter(c => !c.passed), shots: report.shots, pageerrors: report.pageerrors, consoleErrors: report.consoleErrors }));
