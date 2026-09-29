// Optional, local performance check for note switching (task 2891f95a). Not part of `npm run verify`.
// Needs a running dev:live instance whose open folder contains a `perf/` folder made by
// `node scripts/perf-markdown-switch-notes.mjs <folder>/perf`.
//   npm run perf:markdown-switch -- --cdp-port 9251 [--out .tmp/markdown-switch-perf] [--label run] [--no-trace]
// Flow: reload, 5 cold opens, 5 warm switches, 10 rapid clicks. The report (first frame after the content
// matches, long tasks, top self-time functions, optional trace + CPU profile) is written to --out.
// Timings are reported, not asserted (they depend on the machine). The run fails when the last rapid click
// does not win (title, content, selected row, property count), a switch never shows its note, or the page
// logs console errors / page errors.
import fs from 'node:fs'; import path from 'node:path';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const port = arg('--cdp-port');
if (!port) { console.error('usage: node scripts/perf-markdown-switch.mjs --cdp-port <port> [--out dir] [--label name] [--no-trace]'); process.exit(2); }
const outDir = arg('--out', '.tmp/markdown-switch-perf');
const label = arg('--label', 'run');
const withTrace = !process.argv.includes('--no-trace');
fs.mkdirSync(outDir, { recursive: true });
const { chromium } = await import('playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools'));
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: e.message }));
page.on('console', (m) => { if (m.type() === 'error') errors.push({ kind: 'console.error', text: m.text() }); });
await page.reload(); await page.waitForSelector('.workbench-sidebar', { timeout: 30000 }); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const back = [...document.querySelectorAll('.window-titlebar button')].find((x) => (x.getAttribute('aria-label') || x.textContent || '').includes('返回场景')); back?.click();
});
await page.waitForTimeout(600);
await page.evaluate(() => { const b = [...document.querySelectorAll('.workbench-sidebar button')].find((x) => (x.getAttribute('aria-label') || x.title || x.textContent || '').trim().startsWith('笔记')); b?.click(); });
await page.waitForTimeout(1500);
const NOTES = [
  { row: '01-分支法思想', title: '分支法思想：分+治+合', marker: '分治（Divide', props: 3 },
  { row: '02-长文', title: '长文样例（≥100KB）', marker: '第 1 节', props: 0 },
  { row: '03-公式', title: '公式样例（≥10 个 KaTeX）', marker: '公式 1', props: 0 },
  { row: '04-图片', title: '图片样例（≥5 张本地图片）', marker: '图 1', props: 0 },
  { row: '05-混合', title: '混合样例', marker: '小节 1', props: 0 },
];
await page.evaluate(() => {
  window.__visibleContent = () => document.querySelector('.workbench-tab-frame.active .markdown-live-codemirror .cm-content');
  // Test-only: close every Markdown tab through the app's own sidebar handler (closeWorkspaceTab).
  window.__closeMdTabs = () => {
    const fiberOf = (el) => { const k = el && Object.keys(el).find((key) => key.startsWith('__reactFiber$')); return k ? el[k] : null; };
    let f = fiberOf(document.querySelector('.workbench-sidebar')); let close = null;
    while (f) { if (f.memoizedProps && typeof f.memoizedProps.onCloseOpenItem === 'function') { close = f.memoizedProps.onCloseOpenItem; break; } f = f.return; }
    if (!close) return -1;
    const ids = [...document.querySelectorAll('.workbench-tab-frame')].filter((fr) => fr.querySelector('.markdown-resource-tab')).map((fr) => fiberOf(fr)?.key).filter(Boolean);
    ids.forEach((id) => close(id));
    return ids.length;
  };
  window.__lt = [];
  if (!window.__ltObserver) {
    window.__ltObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lt.push({ start: e.startTime, duration: e.duration }); });
    window.__ltObserver.observe({ type: 'longtask', buffered: false });
  }
  window.__switchTo = (rowText, title, marker) => new Promise((resolve) => {
    const row = [...document.querySelectorAll('.workbench-sidebar .file-tree-row')].find((x) => x.textContent.trim().startsWith(rowText));
    if (!row) { resolve({ error: 'row missing ' + rowText }); return; }
    const t0 = performance.now();
    row.click();
    const check = () => {
      const frame = document.querySelector('.workbench-tab-frame.active');
      const titleOk = frame?.querySelector('.markdown-document-title-input')?.value === title;
      const content = titleOk ? window.__visibleContent() : null;
      const text = content ? content.textContent : '';
      if (titleOk && text.includes(marker)) {
        const matched = performance.now();
        requestAnimationFrame(() => resolve({ t0, matched: matched - t0, firstFrame: performance.now() - t0 }));
        return;
      }
      if (performance.now() - t0 > 15000) { resolve({ t0, timeout: true }); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  window.__quiet = (t0, quietMs, maxMs) => new Promise((resolve) => {
    const began = performance.now();
    const tick = () => {
      const now = performance.now();
      const last = window.__lt.filter((e) => e.start >= t0).reduce((m, e) => Math.max(m, e.start + e.duration), t0);
      const images = [...(window.__visibleContent()?.querySelectorAll('img') ?? [])];
      const pendingImages = images.filter((img) => !img.complete || !img.getAttribute('src')).length;
      if ((now - last >= quietMs && pendingImages === 0) || now - began > maxMs) { resolve({ settled: last - t0, imagesDone: pendingImages === 0, waited: now - t0, images: images.length }); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
});
const others = (i) => NOTES.filter((_, k) => k !== i).map((n) => n.marker);
const expandPerf = await page.evaluate(() => {
  const has = [...document.querySelectorAll('.workbench-sidebar .file-tree-row')].some((x) => x.textContent.trim().startsWith('01-分支法思想'));
  if (has) return 'already';
  const r = [...document.querySelectorAll('.workbench-sidebar .file-tree-row')].find((x) => x.textContent.trim() === 'perf');
  if (!r) return 'missing'; r.click(); return 'expanded';
});
await page.waitForTimeout(800);
const switchTo = async (i) => page.evaluate(([row, title, marker]) => window.__switchTo(row, title, marker), [NOTES[i].row, NOTES[i].title, NOTES[i].marker]);
const quiet = async (t0, q = 800, max = 8000) => page.evaluate(([a, b, c]) => window.__quiet(a, b, c), [t0, q, max]);
const closedAtStart = await page.evaluate(() => window.__closeMdTabs());
await page.waitForTimeout(800);
// Warm-up on notes outside the sample set (loads KaTeX/editor chunks), then close them again.
for (const [row, marker] of [['分支法思想：分+治+合', '分治法的设计思想'], ['读书笔记', '']]) {
  await page.evaluate((rw) => { [...document.querySelectorAll('.workbench-sidebar .file-tree-row')].find((x) => x.textContent.trim().startsWith(rw))?.click(); }, row);
  await page.waitForTimeout(2500);
}
await page.evaluate(() => window.__closeMdTabs());
await page.waitForTimeout(1000);
const ORDER = [0, 1, 2, 3, 4, 2, 0, 4, 1, 3]; // first five are cold opens, the rest switch between mounted tabs
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
let traceDone = null; const traceChunks = [];
if (withTrace) {
  cdp.on('Tracing.dataCollected', (e) => traceChunks.push(...e.value));
  traceDone = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8.execute,loading', transferMode: 'ReportEvents' });
}
await cdp.send('Profiler.start');
const switches = [];
for (const i of ORDER) {
  await page.evaluate(() => { window.__lt = []; });
  const r = await switchTo(i);
  const q = await quiet(r.t0 ?? 0, 800, 8000);
  const lts = await page.evaluate((t0) => window.__lt.filter((e) => e.start >= t0 - 1), r.t0 ?? 0);
  const upToFrame = lts.filter((e) => e.start <= (r.t0 ?? 0) + (r.firstFrame ?? 0));
  switches.push({ note: NOTES[i].row, kind: switches.length < 5 ? 'cold' : 'warm', firstFrameMs: r.firstFrame, matchedMs: r.matched, timeout: !!r.timeout, error: r.error,
    longTasks: lts.length, longestTaskMs: Math.max(0, ...lts.map((e) => e.duration)), longTaskTotalMs: lts.reduce((s, e) => s + e.duration, 0),
    longTasksBeforeFirstFrame: upToFrame.length, settledMs: q.settled, imagesDone: q.imagesDone, images: q.images });
}
const { profile } = await cdp.send('Profiler.stop');
if (withTrace) { await cdp.send('Tracing.end'); await traceDone; fs.writeFileSync(path.join(outDir, `trace-${label}.json`), JSON.stringify({ traceEvents: traceChunks })); }
fs.writeFileSync(path.join(outDir, `profile-${label}.cpuprofile`), JSON.stringify(profile));
// Self time per function from the sampled profile.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dts = profile.timeDeltas; const samples = profile.samples;
for (let k = 0; k < samples.length; k++) {
  const n = byId.get(samples[k]); const dt = (dts[k + 1] ?? 0) / 1000;
  const cf = n.callFrame; const key = `${cf.functionName || '(anonymous)'} ${(cf.url || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt);
}
const top = [...self.entries()].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([fn, ms]) => ({ fn, selfMs: Math.round(ms) }));
const special = ['(idle)', '(program)', '(garbage collector)'].map((s) => ({ fn: s, selfMs: Math.round([...self.entries()].filter(([k]) => k.startsWith(s)).reduce((a, [, v]) => a + v, 0)) }));
// Burst: close all Markdown tabs, then 10 clicks 60 ms apart over cold notes; last click must win.
await page.evaluate(() => window.__closeMdTabs());
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__lt = []; });
const BURST = [2, 3, 1, 4, 0, 3, 2, 4, 1, 3];
const burstStart = await page.evaluate(() => performance.now());
for (const i of BURST) {
  await page.evaluate((row) => { const r = [...document.querySelectorAll('.workbench-sidebar .file-tree-row')].find((x) => x.textContent.trim().startsWith(row)); r?.click(); }, NOTES[i].row);
  await page.waitForTimeout(60);
}
const lastClick = await page.evaluate(() => performance.now());
const last = BURST[BURST.length - 1];
const burstFrame = await page.evaluate(([marker, o, t]) => new Promise((resolve) => {
  const check = () => { const ok = document.querySelector('.workbench-tab-frame.active .markdown-document-title-input')?.value === o; const text = ok ? (window.__visibleContent()?.textContent ?? '') : ''; if (ok && text.includes(marker)) { resolve(performance.now() - t); return; } if (performance.now() - t > 15000) { resolve(null); return; } requestAnimationFrame(check); };
  check();
}), [NOTES[last].marker, NOTES[last].title, lastClick]);
await page.evaluate(([t0]) => window.__quiet(t0, 1000, 10000), [burstStart]);
await page.waitForTimeout(1500);
const finalState = await page.evaluate(([markers]) => {
  const text = window.__visibleContent()?.textContent ?? '';
  const title = document.querySelector('.workbench-tab-frame.active .markdown-document-title-input')?.value ?? '';
  const selectedRow = document.querySelector('.workbench-sidebar .file-tree-row.active, .workbench-sidebar .file-tree-row[aria-selected="true"], .workbench-sidebar .file-tree-row.selected')?.textContent?.trim() ?? '';
  const props = document.querySelectorAll('.workbench-tab-frame.active .markdown-property-row, .workbench-tab-frame.active [data-property-key]').length;
  const saveState = [...document.querySelectorAll('.workbench-topbar *')].map((e) => e.textContent.trim()).find((t) => /已保存|保存中|未保存|保存失败/.test(t) && t.length < 8) ?? '';
  const toc = [...document.querySelectorAll('.workbench-tab-frame.active .markdown-toc-list button[title]')].slice(0, 3).map((e) => e.textContent.trim());
  return { markersInEditor: markers.filter((m) => text.includes(m)), title, selectedRow, propertyRows: props, saveState, tocFirst: toc };
}, [NOTES.map((n) => n.marker)]);
const burstLts = await page.evaluate((t0) => window.__lt.filter((e) => e.start >= t0), burstStart);
const ff = switches.map((s) => s.firstFrameMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const stat = (arr) => { const v = arr.filter((x) => typeof x === 'number').sort((a, b) => a - b); const q = (p) => v.length ? Math.round(v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)]) : null; return { n: v.length, p50: q(0.5), p95: q(0.95), max: v.length ? Math.round(v[v.length - 1]) : null, mean: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null }; };
const pct = (p) => ff.length ? Math.round(ff[Math.min(ff.length - 1, Math.ceil(p * ff.length) - 1)]) : null;
const report = {
  label, at: new Date().toISOString(), url: page.url(), expandPerf,
  firstFrame: { p50: pct(0.5), p95: pct(0.95), max: ff.length ? Math.round(ff[ff.length - 1]) : null, min: ff.length ? Math.round(ff[0]) : null, mean: ff.length ? Math.round(ff.reduce((a, b) => a + b, 0) / ff.length) : null },
  cold: stat(switches.filter((x) => x.kind === 'cold').map((x) => x.firstFrameMs)), warm: stat(switches.filter((x) => x.kind === 'warm').map((x) => x.firstFrameMs)), settled: stat(switches.map((x) => x.settledMs)), closedAtStart,
  longTasks: { total: switches.reduce((s, x) => s + x.longTasks, 0), over200ms: switches.reduce((s, x) => s + (x.longestTaskMs > 200 ? 1 : 0), 0), longestMs: Math.round(Math.max(0, ...switches.map((s) => s.longestTaskMs))) },
  switches: switches.map((s) => ({ ...s, firstFrameMs: s.firstFrameMs && Math.round(s.firstFrameMs), matchedMs: s.matchedMs && Math.round(s.matchedMs), longestTaskMs: Math.round(s.longestTaskMs), longTaskTotalMs: Math.round(s.longTaskTotalMs), settledMs: s.settledMs && Math.round(s.settledMs) })),
  topSelf: top, special,
  burst: { order: BURST.map((i) => NOTES[i].row), expected: NOTES[last].row, lastClickToFrameMs: burstFrame && Math.round(burstFrame), longTasks: burstLts.length, longestMs: Math.round(Math.max(0, ...burstLts.map((e) => e.duration))), over200ms: burstLts.filter((e) => e.duration > 200).length, finalState,
    lastClickWins: finalState.title === NOTES[last].title && finalState.markersInEditor.length === 1 && finalState.markersInEditor[0] === NOTES[last].marker && finalState.selectedRow.startsWith(NOTES[last].row) && finalState.propertyRows === NOTES[last].props },
  errors,
};
fs.writeFileSync(path.join(outDir, `switch-report-${label}.json`), JSON.stringify(report, null, 1));
await page.evaluate(() => window.__closeMdTabs());
console.log(JSON.stringify({ firstFrame: report.firstFrame, cold: report.cold, warm: report.warm, settled: report.settled, longTasks: report.longTasks, burst: { lastClickToFrameMs: report.burst.lastClickToFrameMs, over200ms: report.burst.over200ms, longestMs: report.burst.longestMs, lastClickWins: report.burst.lastClickWins, finalState: report.burst.finalState }, top5: top.slice(0, 5), errors: errors.length }, null, 1));

const problems = [];
if (!report.burst.lastClickWins) problems.push(`last rapid click did not win: ${JSON.stringify(report.burst.finalState)}`);
const unmatched = report.switches.filter((s) => s.timeout || s.error || typeof s.matchedMs !== 'number');
if (unmatched.length) problems.push(`switches never showed their note: ${unmatched.map((s) => s.note).join(', ')}`);
if (errors.length) problems.push(`console/page errors: ${JSON.stringify(errors.slice(0, 5))}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`PASS markdown switch perf: report ${path.join(outDir, `switch-report-${label}.json`)}`);
process.exit(0);
