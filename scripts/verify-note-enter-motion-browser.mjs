// Windows isolated Chromium regression for the reader note panel motion and floating-card
// chrome (tasks 1f484418 / 3932f561). Real reader modules (workbench state hook, presence
// hook, FLIP hook, floating controls, motion helpers, layout CSS + motion tokens) run in a
// synthetic host that mirrors ReaderScene's shell markup; no user profile, task service or
// native data is touched. Evidence lands in .tmp/shots/note-enter-motion-browser/<run>/.
//
// What it proves (and what fails on the previous code):
//   - the docked column opens/closes through its grid track (220ms, tokens), the drawer keeps
//     its target width and the PDF column gives way continuously — no jump, no reflow;
//   - the floating card pops out of the boundary bookmark (origin beyond its right edge) with
//     the back-out token, and its chrome is the slim drag lane + four corner grips, no save
//     badge, no left resizer, dock inside the card and wrapping to its width;
//   - corner grips resize from any corner with the opposite corner anchored (pointer + keys);
//   - mode switches while visible are FLIP transitions between the two boxes, never a
//     fade-out/re-entrance (also for the narrow-window fallback);
//   - prefers-reduced-motion opens instantly with no transition at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.NOTE_MOTION_FIXTURE || 'scripts/fixtures/note-enter-motion-host.tsx';
const HOST_SOURCE = fs.readFileSync(FIXTURE, 'utf8');
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>note enter motion</title>'
  + '<style>body{margin:0;padding:16px;background:#f5f5f4;font-family:sans-serif}.motion-harness-toolbar{display:flex;gap:6px;margin-bottom:10px}'
  + '.motion-harness-pdf{height:100%;background:#fff}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';

const own = path.resolve('.tmp/note-enter-motion-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/note-enter-motion-browser', run);
const screenshots = [];
const records = [];
const errors = [];
const sourceFiles = [
  'src/features/reader/ReaderScene.tsx',
  'src/features/reader/useNotePanelPresence.ts',
  'src/features/reader/useNoteLayoutFlip.ts',
  'src/features/reader/ReaderNoteFloatingControls.tsx',
  'src/features/reader/noteEnterMotion.ts',
  'src/features/reader/reader-writing-layout.css',
  'src/ui/styles/tokens.css',
];
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'missing';
const before = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));

function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const numbers = text => String(text || '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
const sameCurve = (a, b) => JSON.stringify(numbers(a)) === JSON.stringify(numbers(b)) && numbers(a).length === 4;
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
/* first timing function of a computed transition-timing-function list, as "x1, y1, x2, y2" */
const curveOf = timing => numbers(timing).slice(0, 4).join(', ');

let browserProcess = null, server = null, ws = null, seq = 0;
const requests = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { requests.delete(id); reject(Error('CDP timeout ' + method)); }, method === 'Browser.close' ? 5000 : 30000);
  requests.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
const pauseAll = () => { for (const { timer } of requests.values()) clearTimeout(timer); requests.clear(); };
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception?.description || ''));
  return result.result.value;
};
const wait = async (expression, tries = 150, interval = 100) => {
  for (let index = 0; index < tries; index += 1) {
    try { if (await ev(expression)) return true; } catch { /* keep waiting */ }
    await pause(interval);
  }
  throw Error('Timed out ' + expression);
};
const shot = async (name) => {
  const file = path.join(evidence, 'screenshots', name + '.png');
  fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  screenshots.push(name);
};
const state = () => ev('window.__motionState');
/* transitions run for 220ms; settle before geometry assertions */
const settle = () => pause(360);
const boxOf = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
const dragBy = async (selector, dx, dy) => {
  const box = await boxOf(selector);
  if (!box) throw Error('missing ' + selector);
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * step) / 6, y: y + (dy * step) / 6, button: 'left', buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
  await pause(80);
};

/* Discrete React event + microtask flush: returns the very first committed frame (before
   any paint) — presence attributes plus the drawer/controls computed pose and offset box. */
const PICK = `const pick=n=>{if(!n)return null;const s=getComputedStyle(n);return {opacity:s.opacity,transform:s.transform,origin:s.transformOrigin,duration:s.transitionDuration,timing:s.transitionTimingFunction,property:s.transitionProperty,animationName:s.animationName,willChange:s.willChange,width:n.offsetWidth,height:n.offsetHeight,left:n.offsetLeft,top:n.offsetTop,vleft:n.getBoundingClientRect().left,vtop:n.getBoundingClientRect().top}};`;
const SNAPSHOT = `const shell=document.querySelector('.reader-workspace-shell');const d=shell.querySelector(':scope > .reader-workspace-drawer');const c=shell.querySelector(':scope > .reader-note-floating-controls');const ss=getComputedStyle(shell);const cols=ss.gridTemplateColumns.split(' ');const main=shell.querySelector(':scope > .reader-main-workspace');return {presence:shell.dataset.notePresence,motionMode:shell.dataset.noteMotionMode,noteMode:shell.dataset.noteMode,drawer:pick(d),controls:pick(c),running:document.getAnimations().filter(a=>a.transitionProperty).map(a=>a.transitionProperty),track:{display:ss.display,track:parseFloat(cols[cols.length-1]),cols:ss.gridTemplateColumns,sideVar:ss.getPropertyValue('--reader-side-width').trim(),targetVar:ss.getPropertyValue('--reader-side-target').trim(),main:main?main.getBoundingClientRect().width:null,drawerLeft:d?d.getBoundingClientRect().left:null,shellRight:shell.getBoundingClientRect().right}};`;
const firstFrame = selector => ev(`(async()=>{${PICK}const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});window.__presenceLog=[];e.click();await Promise.resolve();await Promise.resolve();${SNAPSHOT}})()`);
const snapshot = () => ev(`(()=>{${PICK}${SNAPSHOT}})()`);
/* Polls frame by frame until the enter transition is running, then reports it. */
const transitionStart = () => ev(`(async()=>{${PICK}const shell=document.querySelector('.reader-workspace-shell');for(let i=0;i<40;i++){await new Promise(r=>requestAnimationFrame(r));const anims=document.getAnimations().filter(a=>a.transitionProperty&&a.effect&&a.effect.target&&a.effect.target.closest('.reader-workspace-shell'));if(anims.length&&shell.dataset.notePresence==='entered'){const d=shell.querySelector(':scope > .reader-workspace-drawer');const c=shell.querySelector(':scope > .reader-note-floating-controls');return {frames:i,presence:shell.dataset.notePresence,animations:anims.map(a=>({property:a.transitionProperty,target:a.effect.target.className.split(' ')[0],duration:a.effect.getTiming().duration,easing:a.effect.getTiming().easing,playState:a.playState})),drawer:pick(d),controls:pick(c)}}}return {frames:40,presence:shell.dataset.notePresence,animations:[],drawer:null,controls:null}})()`);
const freezeAt = ms => ev(`(async()=>{for(let i=0;i<40;i++){const anims=document.getAnimations().filter(a=>a.transitionProperty&&a.effect&&a.effect.target&&a.effect.target.closest('.reader-workspace-shell'));if(anims.length){for(const a of anims){a.pause();a.currentTime=${ms};}const d=document.querySelector('.reader-workspace-shell > .reader-workspace-drawer');const s=getComputedStyle(d);return {paused:anims.length,opacity:s.opacity,transform:s.transform}}await new Promise(r=>requestAnimationFrame(r));}return null})()`);
const thaw = () => ev('(()=>{for(const a of document.getAnimations())a.play();return true})()');
const stableAfterFrames = () => ev(`(async()=>{const d=document.querySelector('.reader-workspace-shell > .reader-workspace-drawer');const box=()=>[d.offsetLeft,d.offsetTop,d.offsetWidth,d.offsetHeight].join(',');const a=box();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {stable:a===box(),box:a,running:document.getAnimations().filter(x=>x.transitionProperty).length}})()`);
const log = () => ev('window.__presenceLog.map(e=>e.phase+":"+e.mode)');

try {
  fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'host.tsx'), HOST_SOURCE);
  fs.writeFileSync(path.join(own, 'host.html'), HOST_HTML);

  /* The repo root also hosts dev:live cargo targets (.build), WebView profiles (.tmp) and
     sibling worktrees; keep the watcher off them or the first page load stalls. */
  server = await createServer({
    configFile: false, root: process.cwd(), cacheDir: path.join(own, run + '-vite-cache'), plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/.build/**', '**/.tmp/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } },
  });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/note-enter-motion-browser/host.html';

  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1568,760', 'about:blank',
  ], { stdio: 'ignore' });
  for (let index = 0; index < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); index += 1) await pause(100);
  const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = tabs.find(tab => tab.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const entry = requests.get(message.id);
      requests.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1568, height: 760, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait('!!window.__motionState && window.__motionState.mode === "reading"');
  await settle();

  /* 1. tokens exist on :root and the shell consumes them */
  const tokens = await ev(`(()=>{const root=getComputedStyle(document.documentElement);const shell=getComputedStyle(document.querySelector('.reader-workspace-shell'));const get=(s,n)=>s.getPropertyValue(n).trim();return {duration:get(root,'--motion-panel-duration'),easeOut:get(root,'--motion-panel-ease-out'),easeIn:get(root,'--motion-panel-ease-in'),easePop:get(root,'--motion-panel-ease-pop'),slide:get(root,'--motion-panel-slide-distance'),lift:get(root,'--motion-panel-pop-lift'),scale:get(root,'--motion-panel-pop-scale'),shellDuration:get(shell,'--note-transition-duration'),shellEase:get(shell,'--note-transition-ease')}})()`);
  check(tokens.duration === '220ms' && tokens.slide === '28px' && tokens.lift === '6px' && numbers(tokens.scale)[0] === 0.88, '动效令牌（时长/位移/弹出缩放 .88）定义在 tokens.css', tokens);
  check(numbers(tokens.easeOut).length === 4 && numbers(tokens.easeIn).length === 4 && numbers(tokens.easePop).length === 4, '三条缓动令牌均为 cubic-bezier', tokens);
  check(numbers(tokens.easePop)[1] > 1, '悬浮弹出缓动带轻微回弹（y1 > 1）', tokens.easePop);
  check(tokens.shellDuration === '220ms' && sameCurve(tokens.shellEase, tokens.easeOut), 'reader shell 通过令牌解析出 220ms 与 ease-out', tokens);

  /* 2. split entrance: the note grid track slides open (workbench-sidebar style) while the
        drawer keeps its target width and the PDF column gives way continuously */
  const trackOf = () => ev(`(()=>{const shell=document.querySelector('.reader-workspace-shell');const s=getComputedStyle(shell);const cols=s.gridTemplateColumns.split(' ');const main=shell.querySelector(':scope > .reader-main-workspace');const d=shell.querySelector(':scope > .reader-workspace-drawer');return {display:s.display,track:parseFloat(cols[cols.length-1]),cols:s.gridTemplateColumns,transition:s.transitionProperty,duration:s.transitionDuration,timing:s.transitionTimingFunction,main:main?main.getBoundingClientRect().width:null,drawerWidth:d?d.offsetWidth:null,drawerLeft:d?d.getBoundingClientRect().left:null,shellRight:shell.getBoundingClientRect().right,sideVar:s.getPropertyValue('--reader-side-width').trim(),targetVar:s.getPropertyValue('--reader-side-target').trim()}})()`);
  /* click + first committed frame + 24 sampled frames in ONE evaluation, so the 220ms track
     transition is observed from its very first frames (CDP round trips would miss them). */
  const splitOpen = await ev(`(async()=>{${PICK}const e=document.querySelector('.motion-open[data-mode="split"]');window.__presenceLog=[];e.click();await Promise.resolve();await Promise.resolve();const first=(()=>{${SNAPSHOT}})();const shell=document.querySelector('.reader-workspace-shell');const main=shell.querySelector(':scope > .reader-main-workspace');const d=shell.querySelector(':scope > .reader-workspace-drawer');const samples=[];let anims=[];for(let i=0;i<24;i++){await new Promise(r=>requestAnimationFrame(r));const cols=getComputedStyle(shell).gridTemplateColumns.split(' ');samples.push({track:+parseFloat(cols[cols.length-1]).toFixed(1),main:+main.getBoundingClientRect().width.toFixed(1),drawerWidth:d.offsetWidth,drawerLeft:+d.getBoundingClientRect().left.toFixed(1),presence:shell.dataset.notePresence});const a=document.getAnimations().filter(x=>x.transitionProperty&&x.effect&&x.effect.target===shell);if(a.length&&!anims.length)anims=a.map(x=>({property:x.transitionProperty,duration:x.effect.getTiming().duration,easing:x.effect.getTiming().easing}));}return {first,samples,anims}})()`);
  const splitFirst = splitOpen.first;
  const splitTrackFirst = splitFirst.track;
  const splitTrackStyle = await trackOf();
  check(splitFirst.presence === 'entering' && splitFirst.motionMode === 'split', '打开侧栏：首帧 presence=entering/motion-mode=split', splitFirst);
  check(splitTrackFirst.track === 0 && splitTrackFirst.sideVar === '0px' && parseFloat(splitTrackFirst.targetVar) > 300, '打开侧栏：首帧笔记轨道为 0（--reader-side-width: 0px），目标宽度已在 --reader-side-target', splitTrackFirst);
  check(splitFirst.drawer && near(splitFirst.drawer.width, parseFloat(splitTrackFirst.targetVar), 2) && splitFirst.drawer.opacity === '1' && splitFirst.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)', '打开侧栏：抽屉首帧即为目标宽度、不透明、无自身位移（由轨道推动，不叠加第二重动效）', { drawer: splitFirst.drawer, target: splitTrackFirst.targetVar });
  check(splitTrackFirst.drawerLeft !== null && splitTrackFirst.drawerLeft >= splitTrackFirst.shellRight - 1, '打开侧栏：首帧抽屉整体位于外壳右缘之外（被裁切，尚不可见）', splitTrackFirst);
  check(/grid-template-columns/.test(splitTrackStyle.transition) && splitTrackStyle.duration.startsWith('0.22s') && sameCurve(curveOf(splitTrackStyle.timing), tokens.easeOut), '轨道过渡 220ms + ease-out 令牌（grid-template-columns）', splitTrackStyle);
  const trackRun = splitOpen;
  const tracks = trackRun.samples.map(sample => sample.track);
  const monotone = tracks.every((value, index) => index === 0 || value >= tracks[index - 1] - 0.5);
  check(trackRun.anims.length === 1 && trackRun.anims[0].property === 'grid-template-columns' && trackRun.anims[0].duration === 220, '轨道以单条 grid-template-columns CSSTransition 展开（220ms）', trackRun.anims);
  check(monotone && tracks[0] === 0 && tracks[tracks.length - 1] > 300, '自由运行采样：轨道从 0 单调增长到目标宽度', tracks);
  check(new Set(trackRun.samples.map(sample => sample.drawerWidth)).size === 1, '过渡期间抽屉 offsetWidth 恒定（内容不重排）', [...new Set(trackRun.samples.map(sample => sample.drawerWidth))]);
  check(trackRun.samples.every((sample, index) => index === 0 || sample.drawerLeft <= trackRun.samples[index - 1].drawerLeft + 0.5), '抽屉左缘逐帧向左滑入（从右缘进入）', trackRun.samples.map(sample => sample.drawerLeft));
  await settle();
  const splitSettled = await snapshot();
  const splitTrackSettled = await trackOf();
  check(splitSettled.presence === 'entered' && splitSettled.drawer.opacity === '1' && splitSettled.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && splitSettled.running.length === 0, '滑入结束：不透明、无位移、无残留过渡', splitSettled.drawer);
  check(near(splitTrackSettled.track, splitSettled.drawer.width) && near(splitTrackSettled.drawerLeft + splitSettled.drawer.width, splitTrackSettled.shellRight, 1), '结束后轨道 = 抽屉宽度，抽屉贴合外壳右缘', splitTrackSettled);
  const splitStable = await stableAfterFrames();
  check(splitStable.stable && splitStable.running === 0, '连续两帧几何稳定', splitStable);
  const splitLog = await log();
  check(splitLog.indexOf('entering:split') >= 0 && splitLog.indexOf('entering:split') < splitLog.indexOf('entered:split') && !splitLog.some(entry => entry.startsWith('exiting')), 'presence 顺序 entering → entered', splitLog);
  /* deterministic mid-motion geometry: replay the same transition paused at fixed times
     (headless frame pacing is too coarse to rely on free-running samples) */
  await ev('document.querySelector(".motion-close").click()'); await settle();
  const stepped = await ev(`(async()=>{const e=document.querySelector('.motion-open[data-mode="split"]');e.click();await Promise.resolve();await Promise.resolve();const shell=document.querySelector('.reader-workspace-shell');const main=shell.querySelector(':scope > .reader-main-workspace');const d=shell.querySelector(':scope > .reader-workspace-drawer');let anim=null;for(let i=0;i<12&&!anim;i++){await new Promise(r=>requestAnimationFrame(r));anim=document.getAnimations().find(x=>x.transitionProperty==='grid-template-columns'&&x.effect&&x.effect.target===shell)||null;}if(!anim)return null;anim.pause();const steps=[];for(const t of [0,40,80,120,160,200,220]){anim.currentTime=t;const cols=getComputedStyle(shell).gridTemplateColumns.split(' ');steps.push({t,track:+parseFloat(cols[cols.length-1]).toFixed(1),main:+main.getBoundingClientRect().width.toFixed(1),drawerWidth:d.offsetWidth,drawerLeft:+d.getBoundingClientRect().left.toFixed(1)});}anim.play();return steps})()`);
  check(stepped && stepped.length === 7 && stepped.every((step, index) => index === 0 || step.track >= stepped[index - 1].track) && new Set(stepped.map(step => Math.round(step.track))).size >= 6 && stepped[0].track < 1 && near(stepped[6].track, stepped[6].drawerWidth, 2), '定点采样 0/40/80/120/160/200/220ms：轨道宽度单调、逐点不同、终点 = 抽屉宽度', stepped);
  check(stepped && stepped.every((step, index) => index === 0 || step.main <= stepped[index - 1].main) && stepped[0].main - stepped[6].main > 300, '定点采样：PDF 列同步连续让位（总让位 = 轨道宽度）', stepped && stepped.map(step => step.main));
  check(stepped && new Set(stepped.map(step => step.drawerWidth)).size === 1 && stepped.every((step, index) => index === 0 || step.drawerLeft <= stepped[index - 1].drawerLeft), '定点采样：抽屉宽度恒定、左缘持续左移', stepped && stepped.map(step => [step.drawerWidth, step.drawerLeft]));
  await settle();
  await shot('01-split-settled');

  /* 2b. header layout in the docked column: picker left, controls right, save badge visible */
  const headerSplit = await ev(`(()=>{const h=document.querySelector('.note-document-header');const shell=h.querySelector('.note-history-shell');const t=h.querySelector('.note-document-trigger');const a=h.querySelector('.note-document-actions');const s=h.querySelector('.note-save-state');const r=x=>x.getBoundingClientRect();return {header:r(h).width,shell:r(shell).width,trigger:r(t).width,triggerLeft:r(t).left-r(h).left,actionsRight:r(h).right-r(a).right,save:getComputedStyle(s).display,resizer:!!document.querySelector('.reader-workspace-drawer .reader-drawer-resize-handle')}})()`);
  check(headerSplit.trigger < headerSplit.header * 0.6 && headerSplit.triggerLeft < 12 && headerSplit.actionsRight < 12, '分屏标题行：文档标题紧贴左侧、模式/编辑切换紧贴右侧', headerSplit);
  check(headerSplit.save !== 'none', '分屏保留「已保存」状态', headerSplit.save);

  /* 3. exit: the track slides shut with the ease-in token; drawer unmounts after the motion */
  const closeFirst = await firstFrame('.motion-close');
  const closeTrack = await trackOf();
  check(closeFirst.presence === 'exiting' && closeFirst.track.sideVar === '0px' && sameCurve(curveOf(closeTrack.timing), tokens.easeIn), '收起：exiting 令轨道目标为 0，使用 ease-in 令牌', { closeFirst, closeTrack });
  const closeRun = await ev(`(async()=>{const shell=document.querySelector('.reader-workspace-shell');const samples=[];for(let i=0;i<10;i++){await new Promise(r=>requestAnimationFrame(r));const cols=getComputedStyle(shell).gridTemplateColumns.split(' ');samples.push(+parseFloat(cols[cols.length-1]).toFixed(1));}return samples})()`);
  check(closeRun.every((value, index) => index === 0 || value <= closeRun[index - 1] + 0.5) && closeRun[0] > closeRun[closeRun.length - 1], '收起：轨道逐帧单调收窄', closeRun);
  await settle();
  const closed = await snapshot();
  check(closed.presence === 'hidden' && closed.drawer === null, '退场结束后卸载抽屉（presence=hidden）', closed);

  /* 4. floating entrance: a scale/opacity pop out of the boundary bookmark (right edge, mid height) */
  await ev('document.querySelector(".motion-float[data-side=\\"right\\"]").click()');
  await pause(50);
  const floatFirst = await firstFrame('.motion-open[data-mode="floating"]');
  const floatState = await state();
  const expectedOrigin = (rect, box) => { const x = ((1 - rect.x) / rect.width) * 100, y = ((0.5 - rect.y) / rect.height) * 100; return { x: box.width * Math.min(140, Math.max(-40, x)) / 100, y: box.height * Math.min(140, Math.max(-40, y)) / 100 }; };
  check(floatFirst.presence === 'entering' && floatFirst.motionMode === 'floating' && floatFirst.drawer && floatFirst.drawer.opacity === '0' && floatFirst.drawer.transform === 'matrix(0.88, 0, 0, 0.88, 0, 6)', '打开浮卡：首帧 scale(.88) + 6px 下沉 + 透明', floatFirst.drawer);
  check(floatFirst.controls && floatFirst.controls.transform === floatFirst.drawer.transform && floatFirst.controls.opacity === '0', '浮卡控件层与卡片同姿态', floatFirst.controls);
  const originRight = expectedOrigin(floatState.floatingRect, floatFirst.drawer);
  check(near(numbers(floatFirst.drawer.origin)[0], originRight.x, 1) && near(numbers(floatFirst.drawer.origin)[1], originRight.y, 1) && numbers(floatFirst.drawer.origin)[0] > floatFirst.drawer.width, '右侧浮卡 transform-origin 指向右缘把手（超出卡片右边、约中高）', { origin: floatFirst.drawer.origin, expected: originRight, popOrigin: floatState.popOrigin });
  const floatRun = await transitionStart();
  check(floatRun.presence === 'entered' && floatRun.animations.length === 4 && floatRun.animations.every(a => a.duration === 220 && sameCurve(a.easing, tokens.easePop) && (a.property === 'transform' || a.property === 'opacity')), '浮卡弹出 220ms + 回弹缓动令牌，仅 transform/opacity（卡片 + 控件各两条）', floatRun.animations);
  check(floatRun.drawer && floatRun.drawer.width === floatFirst.drawer.width && floatRun.drawer.left === floatFirst.drawer.left && floatRun.drawer.top === floatFirst.drawer.top, '弹出过程中卡片 offset 盒不变', { first: floatFirst.drawer, running: floatRun.drawer });
  const frozen = await freezeAt(60);
  check(frozen && frozen.paused >= 4 && Number(frozen.opacity) > 0 && Number(frozen.opacity) < 1 && frozen.transform !== 'matrix(1, 0, 0, 1, 0, 0)', '60ms 中间帧：透明度与缩放均处于中途', frozen);
  await shot('02-floating-mid-60ms');
  await thaw();
  await settle();
  const floatSettled = await snapshot();
  check(floatSettled.drawer.opacity === '1' && floatSettled.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && floatSettled.running.length === 0, '弹出结束：不透明、scale(1)、无残留过渡', floatSettled.drawer);
  /* offset box includes the card's 1px border on each side; floatingCardBox is the CSS box */
  check(near(floatSettled.drawer.left, floatState.floatingBox.left) && near(floatSettled.drawer.top, floatState.floatingBox.top) && near(floatSettled.drawer.width, floatState.floatingBox.width, 2.5) && near(floatSettled.drawer.height, floatState.floatingBox.height, 2.5), '浮卡最终几何 = floatingCardBox 计算值（位置/尺寸不受动效影响）', { settled: floatSettled.drawer, expected: floatState.floatingBox });
  await shot('03-floating-settled');

  /* 4b. floating card chrome: slim drag lane, no save badge, no left resizer, dock inside the card */
  const cardChrome = await ev(`(()=>{const card=document.querySelector('.reader-workspace-drawer');const h=card.querySelector('.note-document-header');const drag=document.querySelector('.reader-note-floating-drag');const corners=[...document.querySelectorAll('.reader-note-floating-corner')];const dock=card.querySelector('.markdown-authoring-dock');const actions=dock.querySelector('.markdown-authoring-actions');const r=x=>x.getBoundingClientRect();const c=r(card);const shell=h.querySelector('.note-history-shell');const a=h.querySelector('.note-document-actions');return {headerPaddingTop:getComputedStyle(h).paddingTop,dragTop:r(drag).top-c.top,dragHeight:r(drag).height,save:getComputedStyle(card.querySelector('.note-save-state')).display,resizer:!!card.querySelector('.reader-drawer-resize-handle'),oldResize:!!document.querySelector('.reader-note-floating-resize'),corners:corners.map(x=>({corner:x.dataset.corner,left:r(x).left-c.left,top:r(x).top-c.top,right:c.right-r(x).right,bottom:c.bottom-r(x).bottom,cursor:getComputedStyle(x).cursor,size:r(x).width})),dock:{left:r(dock).left-c.left,right:c.right-r(dock).right,bottom:c.bottom-r(dock).bottom,width:r(dock).width,height:r(dock).height,display:getComputedStyle(actions).display,wrap:getComputedStyle(actions).flexWrap,card:c.width},header:{trigger:r(h.querySelector('.note-document-trigger')).width,width:r(h).width,shellLeft:r(shell).left-c.left,actionsRight:c.right-r(a).right}}})()`);
  check(cardChrome.headerPaddingTop === '14px' && cardChrome.dragTop >= 1 && cardChrome.dragTop + cardChrome.dragHeight <= 18, '顶部拖动握把区收窄：header 顶部留白 14px，握把 16px 高', cardChrome);
  check(cardChrome.save === 'none' && !cardChrome.resizer && !cardChrome.oldResize, '悬浮卡：无「已保存」、无左缘拖宽条、无旧的右下角 ◢ 按钮', cardChrome);
  check(cardChrome.corners.length === 4 && ['nw', 'ne', 'sw', 'se'].every(corner => cardChrome.corners.some(c => c.corner === corner)) && cardChrome.corners.every(c => c.size === 26), '四个角柄均渲染（26px）', cardChrome.corners);
  check(cardChrome.corners.every(c => (c.corner.includes('w') ? c.left < 0 : c.right < 0) && (c.corner.includes('n') ? c.top < 0 : c.bottom < 0)), '角柄位于卡片四角外侧（伸出卡片边缘）', cardChrome.corners);
  check(cardChrome.corners.every(c => (c.corner === 'nw' || c.corner === 'se') ? c.cursor === 'nwse-resize' : c.cursor === 'nesw-resize'), '角柄光标按对角方向区分', cardChrome.corners.map(c => c.corner + ':' + c.cursor));
  check(cardChrome.dock.left >= 8 && cardChrome.dock.right >= 8 && cardChrome.dock.bottom >= 8 && cardChrome.dock.display === 'flex' && cardChrome.dock.wrap === 'wrap', '格式工具栏位于卡片内（左右各 ≥8px）、flex 换行', cardChrome.dock);
  check(cardChrome.header.trigger < cardChrome.header.width * 0.6 && cardChrome.header.shellLeft < 16 && cardChrome.header.actionsRight < 16, '悬浮卡标题行：标题靠左、按钮组靠右', cardChrome.header);

  /* 4c. corner resize from each corner: opposite corner anchored, geometry + dock follow */
  const cornerCases = [
    { corner: 'se', dx: 60, dy: 40, expect: (a, b) => b.width > a.width + 50 && b.height > a.height + 30 && near(a.left, b.left) && near(a.top, b.top) },
    { corner: 'nw', dx: -50, dy: -30, expect: (a, b) => b.left < a.left - 40 && b.top < a.top - 20 && near(a.left + a.width, b.left + b.width, 1.5) && near(a.top + a.height, b.top + b.height, 1.5) },
    { corner: 'ne', dx: 30, dy: -30, expect: (a, b) => b.width > a.width + 20 && b.top < a.top - 20 && near(a.left, b.left) && near(a.top + a.height, b.top + b.height, 1.5) },
    { corner: 'sw', dx: -30, dy: 30, expect: (a, b) => b.left < a.left - 20 && b.height > a.height + 20 && near(a.left + a.width, b.left + b.width, 1.5) && near(a.top, b.top) },
  ];
  await ev('document.querySelector(".motion-float[data-side=\\"centre\\"]").click()');
  await pause(120);
  for (const testCase of cornerCases) {
    const before = await boxOf('.reader-workspace-drawer');
    await ev('window.__presenceLog=[]');
    await dragBy(`.reader-note-floating-corner[data-corner="${testCase.corner}"]`, testCase.dx, testCase.dy);
    await pause(60);
    const after = await boxOf('.reader-workspace-drawer');
    const replayed = (await ev('window.__presenceLog.map(e=>e.phase)')).includes('entering');
    check(testCase.expect(before, after) && !replayed, `从 ${testCase.corner} 角拖动缩放：对角固定、不重放动效`, { before, after });
  }
  const dockAfterResize = await ev(`(()=>{const card=document.querySelector('.reader-workspace-drawer');const dock=card.querySelector('.markdown-authoring-dock');const r=x=>x.getBoundingClientRect();const c=r(card),d=r(dock);return {left:d.left-c.left,right:c.right-d.right,width:d.width,height:d.height,card:c.width}})()`);
  check(dockAfterResize.left >= 8 && dockAfterResize.right >= 8, '缩放后格式工具栏仍在卡片内', dockAfterResize);
  await shot('04-floating-resized');
  /* shrink to the minimum: the dock wraps into more rows instead of overflowing */
  await ev('document.querySelector(".motion-float[data-side=\\"small\\"]").click()');
  await pause(120);
  const dockSmall = await ev(`(()=>{const card=document.querySelector('.reader-workspace-drawer');const dock=card.querySelector('.markdown-authoring-dock');const r=x=>x.getBoundingClientRect();const c=r(card),d=r(dock);const rows=new Set([...dock.querySelectorAll('button')].map(b=>Math.round(r(b).top))).size;return {left:d.left-c.left,right:c.right-d.right,width:d.width,rows,card:c.width,scroll:dock.querySelector('.markdown-authoring-actions').scrollWidth<=dock.querySelector('.markdown-authoring-actions').clientWidth+1}})()`);
  check(dockSmall.left >= 8 && dockSmall.right >= 8 && dockSmall.rows >= 3 && dockSmall.scroll, '最小卡片下工具栏换成更多行、不溢出不横向滚动', dockSmall);
  await shot('05-floating-small');
  const keyResize = await ev(`(async()=>{const b=document.querySelector('.reader-note-floating-corner[data-corner="se"]');const before=window.__motionState.floatingRect;b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await new Promise(r=>setTimeout(r,60));document.querySelector('.reader-note-floating-corner[data-corner="se"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await new Promise(r=>setTimeout(r,60));const after=window.__motionState.floatingRect;return {before,after}})()`);
  check(near(keyResize.after.width, keyResize.before.width + 0.02, 0.001) && near(keyResize.after.height, keyResize.before.height + 0.02, 0.001) && keyResize.after.x === keyResize.before.x, '角柄支持键盘方向键缩放（2% 步进）', keyResize);
  await ev('document.querySelector(".motion-float[data-side=\\"right\\"]").click()');
  await pause(120);

  /* 5. drag: geometry follows the pointer without replaying the motion */
  const beforeDrag = await boxOf('.reader-workspace-drawer');
  await ev('window.__presenceLog=[]');
  await dragBy('.reader-note-floating-drag', -160, 70);
  await pause(60);
  const afterDrag = await boxOf('.reader-workspace-drawer');
  const dragLog = await log();
  check(afterDrag.left < beforeDrag.left - 100 && afterDrag.top > beforeDrag.top + 40 && !dragLog.some(entry => entry.startsWith('entering')), '拖动浮卡：位置更新、不重放入场', { beforeDrag, afterDrag, dragLog });

  /* 6. mode switches while visible travel between layouts (FLIP) instead of re-entering */
  const flipObserver = `window.__flipSeen=false;new MutationObserver(()=>{if(document.querySelector('.reader-workspace-shell').dataset.noteFlip==='true')window.__flipSeen=true}).observe(document.querySelector('.reader-workspace-shell'),{attributes:true,attributeFilter:['data-note-flip']});`;
  await ev(flipObserver);
  const cardBeforeSplit = await boxOf('.reader-workspace-drawer');
  const toSplit = await firstFrame('.reader-note-mode-switch [aria-label="边读边记"]');
  const toSplitTrack = await trackOf();
  check(toSplit.presence === 'entered' && toSplit.motionMode === 'split' && toSplit.drawer.opacity === '1', '浮卡 → 分屏：presence 保持 entered（不淡出重进）', toSplit);
  check(/matrix\(/.test(toSplit.drawer.transform) && toSplit.drawer.transform !== 'matrix(1, 0, 0, 1, 0, 0)' && toSplit.drawer.origin === '0px 0px' && toSplit.running.length === 0, '浮卡 → 分屏：首帧以 FLIP 变换停留在旧位置（无过渡，origin 0 0）', toSplit.drawer);
  const flipMatrix = numbers(toSplit.drawer.transform);
  check(near(flipMatrix[0], cardBeforeSplit.width / toSplit.drawer.width, 0.02) && near(toSplit.drawer.vleft, cardBeforeSplit.left, 2) && near(toSplit.drawer.vtop, cardBeforeSplit.top, 2), '浮卡 → 分屏：FLIP 变换正好覆盖旧卡片盒（变换后的包围盒 = 旧卡片位置，统一缩放）', { matrix: flipMatrix, from: cardBeforeSplit, to: toSplit.drawer });
  check(toSplitTrack.track > 300, '浮卡 → 分屏：网格轨道立即为目标宽度（由 FLIP 而非轨道承担过渡）', toSplitTrack);
  const flipRun = await transitionStart();
  check(flipRun.animations.length >= 1 && flipRun.animations.every(a => a.property === 'transform' && a.duration === 220), '浮卡 → 分屏：下一帧仅 transform 过渡到新位置', flipRun.animations);
  await settle();
  check((await log()).every(entry => !entry.startsWith('entering')) && await ev('window.__flipSeen'), '浮卡 → 分屏：无 entering 重放，FLIP 标记出现', await log());
  const settledSplit = await snapshot();
  check(settledSplit.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && settledSplit.running.length === 0, '浮卡 → 分屏：过渡结束回到无变换', settledSplit.drawer);
  await ev('window.__flipSeen=false');
  const colBeforeFloat = await boxOf('.reader-workspace-drawer');
  const toFloat = await firstFrame('.reader-note-mode-switch [aria-label="悬浮速记"]');
  check(toFloat.presence === 'entered' && toFloat.motionMode === 'floating' && toFloat.drawer.opacity === '1' && /matrix\(/.test(toFloat.drawer.transform) && toFloat.drawer.transform !== 'matrix(1, 0, 0, 1, 0, 0)', '分屏 → 浮卡：首帧 FLIP 停留在旧侧栏盒', toFloat.drawer);
  const flipMatrix2 = numbers(toFloat.drawer.transform);
  check(near(flipMatrix2[0], colBeforeFloat.width / toFloat.drawer.width, 0.02) && toFloat.controls && toFloat.controls.transform === toFloat.drawer.transform, '分屏 → 浮卡：卡片与控件层共用同一 FLIP 变换', { matrix: flipMatrix2, controls: toFloat.controls && toFloat.controls.transform });
  await settle();
  check((await log()).every(entry => !entry.startsWith('entering')) && (await snapshot()).drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)', '分屏 → 浮卡：无重进，落到新盒', await log());
  const toWriting = await firstFrame('.reader-note-mode-switch [aria-label="专注写作"]');
  check(toWriting.presence === 'entered' && toWriting.motionMode === 'writing' && /matrix\(/.test(toWriting.drawer.transform) && toWriting.drawer.transform !== 'matrix(1, 0, 0, 1, 0, 0)', '浮卡 → 专注写作：同样以 FLIP 连续过渡', toWriting.drawer);
  await settle();
  await shot('06-writing-settled');

  /* 7. close and reopen: a fresh entrance again uses the track (split) */
  await ev('document.querySelector(".motion-close").click()');
  await settle();
  const reopen = await firstFrame('.motion-open[data-mode="split"]');
  const reopenTrack = await trackOf();
  check(reopen.presence === 'entering' && reopenTrack.track === 0, '收起后再次打开：重新走轨道入场（首帧轨道 0）', { reopen, reopenTrack });
  await settle();

  /* 8. narrow-window fallback and restore: mode changes while visible are continuous (FLIP), not re-entrances */
  await ev('window.__presenceLog=[];window.__flipSeen=false');
  await ev('document.querySelector(".motion-width[data-width=\\"900\\"]").click()');
  await wait('window.__motionState.mode === "floating"', 50, 50);
  await settle();
  const narrowLog = await log();
  check(narrowLog.includes('entered:floating') && !narrowLog.some(entry => entry.startsWith('entering')) && await ev('window.__flipSeen'), '窄窗回退为浮卡：连续过渡（FLIP），不重放入场', narrowLog);
  await ev('window.__presenceLog=[];window.__flipSeen=false');
  await ev('document.querySelector(".motion-width[data-width=\\"1440\\"]").click()');
  await wait('window.__motionState.mode === "split"', 50, 50);
  await settle();
  const wideLog = await log();
  check(wideLog.includes('entered:split') && !wideLog.some(entry => entry.startsWith('entering')) && await ev('window.__flipSeen'), '恢复宽窗：连续过渡回分屏', wideLog);

  /* 9. reduced motion: no entering phase, track opens instantly, no transitions */
  await ev('document.querySelector(".motion-close").click()');
  await settle();
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(100);
  const reducedFirst = await firstFrame('.motion-open[data-mode="split"]');
  const reducedTrack = await trackOf();
  check(reducedFirst.presence === 'entered' && reducedTrack.track > 300 && reducedTrack.duration === '0s', 'reduced-motion：首帧即 entered、轨道直接到位、无过渡时长', { reducedFirst, reducedTrack });
  const reducedRun = await ev(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return document.getAnimations().filter(a=>a.transitionProperty).length})()`);
  check(reducedRun === 0, 'reduced-motion：没有任何 CSSTransition', reducedRun);
  const reducedFloat = await firstFrame('.reader-note-mode-switch [aria-label="悬浮速记"]');
  check(reducedFloat.presence === 'entered' && reducedFloat.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && reducedFloat.drawer.opacity === '1', 'reduced-motion：模式切换直接到位（无 FLIP）', reducedFloat.drawer);
  const reducedShell = await ev(`getComputedStyle(document.querySelector('.reader-workspace-shell')).getPropertyValue('--note-transition-duration').trim()`);
  check(reducedShell === '0s', 'reduced-motion：shell 时长令牌归零', reducedShell);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
  await shot('07-reduced-motion');

  check(errors.length === 0, '无运行时异常与控制台错误', errors);
} catch (error) {
  check(false, '执行失败', String(error && error.stack ? error.stack : error));
} finally {
  pauseAll();
  const after = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
  check(JSON.stringify(before) === JSON.stringify(after), '产品源码在运行期间未被修改');
  const result = {
    task: '1f484418 / 3932f561',
    scope: 'real reader note modules + application CSS/motion tokens in isolated headless Chrome; synthetic host mirrors ReaderScene shell; not the packaged app',
    fixture: FIXTURE,
    run,
    evidence,
    screenshots,
    passed: records.filter(record => record.passed).length,
    total: records.length,
    records,
  };
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  if (ws && ws.readyState === 1) { try { await send('Browser.close'); } catch { /* already gone */ } ws.close(); }
  if (browserProcess && !browserProcess.killed) browserProcess.kill();
  if (server) await server.close();
  console.log(JSON.stringify({ evidence, failed: records.filter(record => !record.passed), passed: result.passed, total: result.total }, null, 2));
}
if (records.some(record => record.passed === false)) process.exitCode = 1;
