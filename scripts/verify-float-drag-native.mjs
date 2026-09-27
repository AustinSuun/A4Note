// Isolated native WebView2 evidence for the floating note topbar + drag follow-through.
// before: records the legacy right-clustered layout and drag frame/lag metrics.
// after: asserts the centered layout group, right-side content actions, intact drag
// lane, narrow/zoom/theme coverage and re-measures drag metrics for comparison.
// Usage: node scripts/verify-float-drag-native.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'before';
const port = Number(process.env.FLOAT_DRAG_CDP_PORT || 9252);
const vitePort = Number(process.env.FLOAT_DRAG_VITE_PORT || 1445);
const instance = process.env.FLOAT_DRAG_INSTANCE || 'floatdrag';
const dir = path.resolve('.tmp/shots/float-drag-native', label);
fs.mkdirSync(dir, { recursive: true });
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = tabs.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${vitePort}`));
if (!page) throw Error('Isolated WebView target missing');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push('pageerror ' + m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map(x => x.value ?? x.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result?.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (expr, name) => { for (let i = 0; i < 150; i += 1) { try { if (await ev(expr)) return; } catch { /* retry */ } await pause(120); } throw Error('timeout ' + name); };
const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = selector => ev(`(document.querySelector(${JSON.stringify(selector)}).click(),true)`);
const FRAME = '.workbench-tab-frame.active ';
const checks = [];
const check = (ok, name, detail) => { checks.push({ ok: !!ok, name, detail }); if (!ok) console.log('FAIL', name, JSON.stringify(detail)); };
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
const stats = deltas => { const s = [...deltas].sort((a, b) => a - b); if (!s.length) return null; return { median: +quantile(s, .5).toFixed(1), p95: +quantile(s, .95).toFixed(1), max: +quantile(s, 1).toFixed(1) }; };
const disjoint = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;

/* Drag the floating card via CDP pointer events while the page samples rAF frames,
   pointer positions and the card rect. Returns frame-gap + follow-lag metrics. */
const dragMeasure = async (dxTotal, dyTotal, steps) => {
  await ev(`(()=>{window.__dragLog={frames:[],pointer:null,grab:null,longtasks:0,evts:[]};new PerformanceObserver(l=>{window.__dragLog.longtasks+=l.getEntries().length}).observe({type:'longtask',buffered:false});new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==='pointermove')window.__dragLog.evts.push(+(e.processingEnd-e.processingStart).toFixed(2))}).observe({type:'event',buffered:false});
    const card=document.querySelector('.reader-workspace-drawer');
    let raf=0;const loop=()=>{const c=card.getBoundingClientRect();const p=window.__dragLog.pointer;
      if(p&&!window.__dragLog.grab)window.__dragLog.grab={dx:p.x-c.left,dy:p.y-c.top};
      const g=window.__dragLog.grab;
      window.__dragLog.frames.push({t:performance.now(),gap:p&&g?+Math.hypot(c.left-(p.x-g.dx),c.top-(p.y-g.dy)).toFixed(1):0,left:c.left,top:c.top});
      if(!window.__dragLog.start)window.__dragLog.start={left:c.left,top:c.top};
      raf=requestAnimationFrame(loop)};window.__dragLog.stop=()=>cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);return true})()`);
  const pill = await ev(`(()=>{const r=document.querySelector('.reader-note-floating-drag').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await ev(`(window.__dragLog.pointer={x:${pill.x},y:${pill.y}},true)`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pill.x, y: pill.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i += 1) {
    const x = pill.x + dxTotal * i / steps, y = pill.y + dyTotal * i / steps;
    await ev(`(window.__dragLog.pointer={x:${x},y:${y}},true)`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await pause(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pill.x + dxTotal, y: pill.y + dyTotal, button: 'left' });
  const log = await ev(`(()=>{window.__dragLog.stop();return window.__dragLog.frames})()`);
  const deltas = []; const lags = [];
  for (let i = 1; i < log.length; i += 1) deltas.push(log[i].t - log[i - 1].t);
  for (const f of log) lags.push(f.gap);
  const longtasks = await ev(`(window.__dragLog.longtasks)`);
  const evts = await ev(`(window.__dragLog.evts)`);
  const evtStats = stats(evts);
  const start = await ev(`(window.__dragLog.start)`);
  const last = log[log.length-1];
  return { frames: log.length, delta: stats(deltas), follow: stats(lags), longtasks, pointermoveSlow16: evts.length, pointermoveMs: evtStats, moved: +Math.hypot(last.left-start.left, last.top-start.top).toFixed(1) };
};
const topbar = () => ev(`(()=>{const card=document.querySelector('${FRAME}.reader-workspace-drawer');const h=card.querySelector('.note-document-header');const sw=h.querySelector('.reader-note-mode-switch');const a=h.querySelector('.note-document-actions');const t=h.querySelector('.note-document-trigger');const d=document.querySelector('.reader-note-floating-drag');const r=x=>{const b=x.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};return {card:r(card),header:r(h),switch:sw?r(sw):null,actions:r(a),trigger:r(t),drag:r(d)}})()`);

let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  if (await ev(`Object.keys(localStorage).filter(k=>k.includes('noteWorkbench.paper')).length`)) {
    await ev(`Object.keys(localStorage).filter(k=>k.includes('noteWorkbench.paper')).forEach(k=>localStorage.removeItem(k));location.reload();true`);
    await pause(1000);
    await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard after reset');
    await send('Runtime.enable'); await send('Page.enable');
  }
  await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()==='文献库')?.click(),true)`);
  await wait(`!!document.querySelector('${FRAME}.paper-table tbody tr')`, 'library rows');
  await ev(`(document.querySelector('${FRAME}.paper-table tbody tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  await wait(`!!document.querySelector('${FRAME}.reader-note-workbench-button')`, 'reader open');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  const shellMode = await ev(`document.querySelector('${FRAME}.reader-workspace-shell')?.dataset.noteMode ?? 'reading'`);
  if (shellMode === 'reading') { await click(`${FRAME}.reader-note-workbench-button`); await wait(`document.querySelector('${FRAME}.reader-workspace-shell')?.dataset.notePresence==='entered'`, 'split open'); }
  await click(`${FRAME}.reader-note-mode-switch [aria-label="悬浮速记"]`);
  await wait(`document.querySelector('${FRAME}.reader-workspace-shell')?.dataset.noteMode==='floating' && document.querySelector('${FRAME}.reader-workspace-shell')?.dataset.notePresence==='entered'`, 'floating entered');
  await pause(400);

  /* --- topbar geometry --- */
  const tb = await topbar();
  const headerCenter = (tb.header.left + tb.header.right) / 2;
  const switchCenter = tb.switch ? (tb.switch.left + tb.switch.right) / 2 : null;
  const layout = {
    switchPresent: !!tb.switch,
    centerOffset: switchCenter != null ? +(switchCenter - headerCenter).toFixed(1) : null,
    titleLeft: +(tb.trigger.left - tb.header.left).toFixed(1),
    actionsRight: +(tb.header.right - tb.actions.right).toFixed(1),
    dragTopInLane: tb.drag.top - tb.card.top, dragBottomVsSwitchTop: +(tb.switch.top - tb.drag.bottom).toFixed(1),
    disjointSwitchActions: tb.switch ? disjoint(tb.switch, tb.actions) : null,
    disjointSwitchTrigger: tb.switch ? disjoint(tb.switch, tb.trigger) : null,
  };
  if (label === 'after') {
    check(layout.switchPresent, '顶栏存在三形态切换组', layout);
    check(Math.abs(layout.centerOffset) <= 8, '三形态组在顶栏水平居中（偏差≤8px）', layout);
    check(layout.actionsRight < 12, '内容状态操作组紧贴右侧', layout);
    check(layout.titleLeft < 12, '文档标题紧贴左侧', layout);
    check(layout.dragTopInLane >= 0 && layout.dragTopInLane <= 14 && layout.dragBottomVsSwitchTop >= -1, '中央拖动横条保留且不与形态组重叠', layout);
    check(layout.disjointSwitchActions && layout.disjointSwitchTrigger, '三个操作组互不重叠', layout);
  }
  await shot('00-topbar-light');

  /* Deterministic start position so runs compare like-for-like and resize has room. */
  const recenter = async () => {
    const cur = await ev(`(()=>{const s=document.querySelector('.reader-workspace-shell').getBoundingClientRect();const c=document.querySelector('.reader-workspace-drawer').getBoundingClientRect();return {x:(c.left-s.left)/s.width,y:(c.top-s.top)/s.height,w:s.width}})()`);
    await dragMeasure((0.12 - cur.x) * cur.w, (0.12 - cur.y) * cur.w, 20);
    await pause(250);
  };
  await recenter();
  const drag1 = await dragMeasure(-220, 120, 40);
  await pause(300);
  const after = await topbar();
  check(after.card.left >= 0 && after.card.top >= 0, '拖动后悬浮卡仍在内容区', after.card);
  await shot('01-after-drag');

  /* --- narrow window --- */
  await send('Emulation.setDeviceMetricsOverride', { width: 980, height: 700, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  const narrow = await topbar();
  const narrowOk = narrow.switch && disjoint(narrow.switch, narrow.actions) && disjoint(narrow.switch, narrow.trigger)
    && narrow.switch.left >= narrow.card.left && narrow.actions.right <= narrow.card.right + 1
    && narrow.trigger.width > 20;
  if (label === 'after') check(narrowOk, '窄窗980：标题/形态组/内容操作互不遮盖且可达', narrow);
  await shot('02-topbar-narrow');

  /* --- zoom levels (UI zoom emulated via element zoom on the app root) --- */
  for (const z of [1.25, 1.5, 2.2]) {
    await ev(`(document.querySelector('#root').style.zoom=${z},true)`);
    await pause(250);
    const zb = await topbar();
    const zOk = zb.switch && disjoint(zb.switch, zb.actions) && disjoint(zb.switch, zb.trigger) && zb.drag.bottom <= zb.switch.top + 1;
    if (label === 'after') check(zOk, `缩放${Math.round(z * 100)}%：顶栏三组不重叠、拖动条不遮形态组`, zb);
    if (z === 1.25) await shot('03-topbar-zoom125');
  }
  await ev(`(document.querySelector('#root').style.zoom='',true)`);
  await pause(250);

  /* --- dark theme --- */
  await ev(`(document.documentElement.setAttribute('data-theme','midnight'),true)`);
  await pause(300);
  await shot('04-topbar-dark');
  await ev(`(document.documentElement.removeAttribute('data-theme'),true)`);

  /* --- second drag after theme/zoom to confirm persistence behaviour --- */
  const drag2 = await dragMeasure(160, -80, 30);

  await recenter();
  /* --- corner resize still intact --- */
  const se = await ev(`(()=>{const c=document.querySelector('.reader-note-floating-corner[data-corner="se"]').getBoundingClientRect();return {x:c.left+c.width/2,y:c.top+c.height/2}})()`);
  const before = await topbar();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: se.x, y: se.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: se.x + i * 6, y: se.y + i * 4, button: 'left' }); await pause(16); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: se.x + 60, y: se.y + 40, button: 'left' });
  await pause(300);
  const resized = await topbar();
  check(resized.card.width > before.card.width + 20, '四角缩放在顶栏改版后仍可用', { before: before.card.width, after: resized.card.width });

  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ label, instance, layout, drag1, drag2, checks, errors }, null, 2));
  console.log(JSON.stringify({ dir, checks: checks.length, failed: checks.filter(c => !c.ok).length, errors }));
} catch (error) {
  problem = String(error && error.stack || error);
  fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ problem, checks, errors }, null, 2));
  console.log(problem);
  process.exitCode = 1;
} finally { try { ws.close(); } catch { /* noop */ } }
