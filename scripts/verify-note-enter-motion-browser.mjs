// Windows isolated Chromium regression for the reader note enter motion (task 1f484418).
// Real reader modules (workbench state hook, presence hook, pop-origin helper, geometry,
// layout CSS + motion tokens) run in a synthetic host that mirrors ReaderScene's shell
// markup; no user profile, task service or native data is touched.
// Evidence lands in .tmp/shots/note-enter-motion-browser/<run>/.
//
// What it proves (and what fails on the pre-motion code):
//   - the first committed frame of an entrance is the start pose (opacity 0, translated /
//     scaled) and it is applied as a snap, so mode switches replay the whole entrance;
//   - only transform/opacity transition, 220ms, with the easing tokens from tokens.css;
//   - layout geometry (offset box) is identical before, during and after the motion;
//   - the floating card pops from a position-aware origin with a back-out easing, and drag
//     still works afterwards;
//   - prefers-reduced-motion skips the 'entering' phase entirely (no transition at all).
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
const PICK = `const pick=n=>{if(!n)return null;const s=getComputedStyle(n);return {opacity:s.opacity,transform:s.transform,origin:s.transformOrigin,duration:s.transitionDuration,timing:s.transitionTimingFunction,property:s.transitionProperty,animationName:s.animationName,willChange:s.willChange,width:n.offsetWidth,height:n.offsetHeight,left:n.offsetLeft,top:n.offsetTop}};`;
const SNAPSHOT = `const shell=document.querySelector('.reader-workspace-shell');const d=shell.querySelector(':scope > .reader-workspace-drawer');const c=shell.querySelector(':scope > .reader-note-floating-controls');return {presence:shell.dataset.notePresence,motionMode:shell.dataset.noteMotionMode,noteMode:shell.dataset.noteMode,drawer:pick(d),controls:pick(c),running:document.getAnimations().filter(a=>a.transitionProperty).map(a=>a.transitionProperty)};`;
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
  check(tokens.duration === '220ms' && tokens.slide === '28px' && tokens.lift === '10px' && numbers(tokens.scale)[0] === 0.96, '动效令牌（时长/位移/缩放）定义在 tokens.css', tokens);
  check(numbers(tokens.easeOut).length === 4 && numbers(tokens.easeIn).length === 4 && numbers(tokens.easePop).length === 4, '三条缓动令牌均为 cubic-bezier', tokens);
  check(numbers(tokens.easePop)[1] > 1, '悬浮弹出缓动带轻微回弹（y1 > 1）', tokens.easePop);
  check(tokens.shellDuration === '220ms' && sameCurve(tokens.shellEase, tokens.easeOut), 'reader shell 通过令牌解析出 220ms 与 ease-out', tokens);

  /* 2. split entrance: first frame is the start pose (snap), then a 220ms transform/opacity slide */
  const splitFirst = await firstFrame('.motion-open[data-mode="split"]');
  check(splitFirst.presence === 'entering' && splitFirst.motionMode === 'split', '打开侧栏：首帧 presence=entering/motion-mode=split', splitFirst);
  check(splitFirst.drawer && splitFirst.drawer.opacity === '0' && splitFirst.drawer.transform === 'matrix(1, 0, 0, 1, 28, 0)', '打开侧栏：首帧透明并向右偏移 28px', splitFirst.drawer);
  check(splitFirst.drawer && /^0s(, 0s)?$/.test(splitFirst.drawer.duration) && splitFirst.running.length === 0, '入场起始姿态瞬时落位（entering 不跑过渡）', splitFirst.drawer && splitFirst.drawer.duration);
  check(splitFirst.drawer && splitFirst.drawer.willChange === 'transform, opacity' && splitFirst.drawer.property === 'transform, opacity' && splitFirst.drawer.animationName === 'none', '只声明 transform/opacity，无关键帧动画叠加', splitFirst.drawer);
  const splitRun = await transitionStart();
  check(splitRun.presence === 'entered' && splitRun.animations.length >= 2, '下一帧进入 entered 并开始 CSS transition', splitRun);
  check(splitRun.animations.every(a => a.property === 'transform' || a.property === 'opacity'), '过渡属性仅 transform/opacity', splitRun.animations.map(a => a.property));
  check(splitRun.animations.every(a => a.duration === 220 && sameCurve(a.easing, tokens.easeOut)), '侧栏滑入 220ms + ease-out 令牌', splitRun.animations);
  check(splitRun.drawer && splitRun.drawer.width === splitFirst.drawer.width && splitRun.drawer.left === splitFirst.drawer.left && splitRun.drawer.height === splitFirst.drawer.height, '过渡中布局盒（offset）与首帧一致，无重排', { first: splitFirst.drawer, running: splitRun.drawer });
  await settle();
  const splitSettled = await snapshot();
  check(splitSettled.presence === 'entered' && splitSettled.drawer.opacity === '1' && splitSettled.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && splitSettled.running.length === 0, '滑入结束：不透明、无位移、无残留过渡', splitSettled.drawer);
  check(splitSettled.drawer.width === splitFirst.drawer.width && splitSettled.drawer.left === splitFirst.drawer.left, '结束后的布局盒与首帧一致', { first: splitFirst.drawer, settled: splitSettled.drawer });
  const splitStable = await stableAfterFrames();
  check(splitStable.stable && splitStable.running === 0, '连续两帧几何稳定', splitStable);
  const splitLog = await log();
  check(splitLog.indexOf('entering:split') >= 0 && splitLog.indexOf('entering:split') < splitLog.indexOf('entered:split') && !splitLog.some(entry => entry.startsWith('exiting')), 'presence 顺序 entering → entered', splitLog);
  await shot('01-split-settled');

  /* 3. exit keeps ease-in and unmounts after the motion */
  const closeFirst = await firstFrame('.motion-close');
  check(closeFirst.presence === 'exiting' && closeFirst.drawer && sameCurve(curveOf(closeFirst.drawer.timing), tokens.easeIn), '收起：exiting 使用 ease-in 令牌', closeFirst);
  await settle();
  check(await ev("document.querySelector('.reader-workspace-shell').dataset.notePresence === 'hidden' && !document.querySelector('.reader-workspace-drawer')"), '收起结束后卸载面板', await log());

  /* 4. floating entrance: scale + opacity pop, position-aware origin, overshoot easing */
  await ev("document.querySelector('.motion-float[data-side=\"right\"]').click()"); await pause(60);
  const floatFirst = await firstFrame('.motion-open[data-mode="floating"]');
  check(floatFirst.presence === 'entering' && floatFirst.motionMode === 'floating', '打开浮卡：首帧 presence=entering/motion-mode=floating', floatFirst);
  check(floatFirst.drawer && floatFirst.drawer.opacity === '0' && floatFirst.drawer.transform === 'matrix(0.96, 0, 0, 0.96, 0, 10)', '打开浮卡：首帧 scale(.96) + 10px 下沉 + 透明', floatFirst.drawer);
  check(floatFirst.controls && floatFirst.controls.opacity === '0' && floatFirst.controls.transform === floatFirst.drawer.transform, '拖动/缩放控件与卡片同步弹出', floatFirst.controls);
  const originRight = numbers(floatFirst.drawer && floatFirst.drawer.origin);
  check(floatFirst.drawer && near(originRight[0], floatFirst.drawer.width * 0.88) && originRight[1] === 0, '右侧浮卡 transform-origin = 88% 0%', { origin: floatFirst.drawer && floatFirst.drawer.origin, width: floatFirst.drawer && floatFirst.drawer.width });
  const floatRun = await transitionStart();
  check(floatRun.presence === 'entered' && floatRun.animations.length >= 4, '浮卡与控件均进入 CSS transition', floatRun.animations);
  check(floatRun.animations.every(a => (a.property === 'transform' || a.property === 'opacity') && a.duration === 220 && sameCurve(a.easing, tokens.easePop)), '浮卡弹出 220ms + 回弹缓动令牌，仅 transform/opacity', floatRun.animations);
  check(floatRun.drawer && floatRun.drawer.width === floatFirst.drawer.width && floatRun.drawer.left === floatFirst.drawer.left && floatRun.drawer.top === floatFirst.drawer.top, '弹出过程中卡片布局盒不变', { first: floatFirst.drawer, running: floatRun.drawer });
  const frozen = await freezeAt(60);
  check(frozen && frozen.paused >= 4 && Number(frozen.opacity) > 0 && Number(frozen.opacity) < 1 && frozen.transform !== 'matrix(1, 0, 0, 1, 0, 0)', '60ms 中间帧：透明度与缩放均处于中途', frozen);
  await shot('02-floating-mid-60ms');
  await thaw();
  await settle();
  const floatSettled = await snapshot();
  const floatState = await state();
  check(floatSettled.drawer.opacity === '1' && floatSettled.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && floatSettled.controls.opacity === '1' && floatSettled.running.length === 0, '弹出结束：卡片与控件完全呈现、无残留过渡', floatSettled);
  /* offset box includes the card's 1px border on each side; floatingCardBox is the CSS box */
  check(near(floatSettled.drawer.left, floatState.floatingBox.left) && near(floatSettled.drawer.top, floatState.floatingBox.top) && near(floatSettled.drawer.width, floatState.floatingBox.width, 2.5) && near(floatSettled.drawer.height, floatState.floatingBox.height, 2.5), '浮卡最终几何 = floatingCardBox 计算值（位置/尺寸不受动效影响）', { settled: floatSettled.drawer, expected: floatState.floatingBox });
  await shot('03-floating-settled');

  /* 5. drag still works and does not replay the entrance */
  await ev('window.__presenceLog=[]');
  const beforeDrag = await state();
  await dragBy('.reader-note-floating-drag', 120, 60);
  await pause(120);
  const afterDrag = await state();
  const dragSnap = await snapshot();
  check(afterDrag.floatingRect.x > beforeDrag.floatingRect.x && afterDrag.floatingRect.y > beforeDrag.floatingRect.y, '拖动后浮卡位置更新', { before: beforeDrag.floatingRect, after: afterDrag.floatingRect });
  check(dragSnap.presence === 'entered' && dragSnap.drawer.opacity === '1' && !(await log()).some(entry => entry.startsWith('entering')), '拖动不重放入场', await log());

  /* 6. origin follows the card position */
  await ev("document.querySelector('.motion-float[data-side=\"left\"]').click()"); await pause(80);
  const leftSnap = await snapshot();
  check(near(numbers(leftSnap.drawer.origin)[0], leftSnap.drawer.width * 0.12), '左侧浮卡 transform-origin = 12% 0%', leftSnap.drawer.origin);
  await ev("document.querySelector('.motion-float[data-side=\"centre\"]').click()"); await pause(80);
  const centreSnap = await snapshot();
  check(near(numbers(centreSnap.drawer.origin)[0], centreSnap.drawer.width * 0.5), '居中浮卡 transform-origin = 50% 0%', centreSnap.drawer.origin);
  check(centreSnap.presence === 'entered' && centreSnap.running.length === 0, '改变位置不触发过渡', centreSnap);
  await ev("document.querySelector('.motion-float[data-side=\"right\"]').click()"); await pause(80);

  /* 7. mode switches replay the entrance from the start pose */
  const toSplit = await firstFrame('.reader-note-mode-switch [aria-label="边读边记"]');
  check(toSplit.presence === 'entering' && toSplit.motionMode === 'split' && toSplit.drawer.opacity === '0' && toSplit.drawer.transform === 'matrix(1, 0, 0, 1, 28, 0)', '浮卡 → 分屏：首帧回到滑入起始姿态', toSplit.drawer);
  const toSplitRun = await transitionStart();
  check(toSplitRun.animations.length >= 2 && toSplitRun.animations.every(a => sameCurve(a.easing, tokens.easeOut)), '浮卡 → 分屏：重放 ease-out 滑入', toSplitRun.animations);
  await settle();
  const toFloating = await firstFrame('.reader-note-mode-switch [aria-label="悬浮速记"]');
  check(toFloating.presence === 'entering' && toFloating.motionMode === 'floating' && toFloating.drawer.opacity === '0' && toFloating.drawer.transform === 'matrix(0.96, 0, 0, 0.96, 0, 10)', '分屏 → 浮卡：首帧回到弹出起始姿态', toFloating.drawer);
  const toFloatingRun = await transitionStart();
  check(toFloatingRun.animations.length >= 4 && toFloatingRun.animations.every(a => sameCurve(a.easing, tokens.easePop)), '分屏 → 浮卡：重放回弹弹出', toFloatingRun.animations);
  await settle();
  const toWriting = await firstFrame('.reader-note-mode-switch [aria-label="专注写作"]');
  check(toWriting.presence === 'entering' && toWriting.motionMode === 'writing' && toWriting.drawer.opacity === '0' && toWriting.drawer.transform === 'matrix(1, 0, 0, 1, 28, 0)', '浮卡 → 专注写作：写作面板滑入起始姿态', toWriting.drawer);
  await settle();
  await shot('04-writing-settled');

  /* 8. reopen after close replays, narrow-window fallback replays as a pop */
  await ev("document.querySelector('.motion-close').click()"); await settle();
  const reopen = await firstFrame('.motion-open[data-mode="split"]');
  check(reopen.presence === 'entering' && reopen.drawer.opacity === '0', '收起后再次打开重放入场', reopen);
  await settle();
  await ev('window.__presenceLog=[]');
  await ev("document.querySelector('.motion-width[data-width=\"900\"]').click()");
  await wait('window.__motionState.mode === "floating" && window.__motionState.presence === "entered"', 30, 50);
  check((await log()).includes('entering:floating'), '窄窗回退为浮卡时重放弹出', await log());
  await settle();
  await ev('window.__presenceLog=[]');
  await ev("document.querySelector('.motion-width[data-width=\"1440\"]').click()");
  await wait('window.__motionState.mode === "split" && window.__motionState.presence === "entered"', 30, 50);
  check((await log()).includes('entering:split'), '恢复宽窗时重放滑入', await log());
  await settle();

  /* 9. prefers-reduced-motion: straight to entered, no transition */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev("document.querySelector('.motion-close').click()"); await settle();
  const reducedFirst = await firstFrame('.motion-open[data-mode="floating"]');
  check(reducedFirst.presence === 'entered' && reducedFirst.drawer.opacity === '1' && reducedFirst.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)', 'reduced-motion：首帧直接 entered 且完全呈现', reducedFirst);
  check(/^0s(, 0s)?$/.test(reducedFirst.drawer.duration) && reducedFirst.running.length === 0, 'reduced-motion：过渡时长 0s', reducedFirst.drawer.duration);
  const reducedFrames = await stableAfterFrames();
  check(reducedFrames.running === 0 && !(await log()).some(entry => entry.startsWith('entering')), 'reduced-motion：不经过 entering、无 CSS transition', await log());
  check(await ev("getComputedStyle(document.querySelector('.reader-workspace-shell')).getPropertyValue('--note-transition-duration').trim() === '0s'"), 'reduced-motion：shell 时长令牌归零', null);
  await send('Emulation.setEmulatedMedia', { features: [] });
  await ev("document.querySelector('.motion-close').click()"); await settle();

  check(errors.length === 0, '无运行时异常与控制台错误', errors);
} catch (error) {
  check(false, '执行失败', String(error && error.stack ? error.stack : error));
} finally {
  pauseAll();
  const after = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]));
  check(JSON.stringify(before) === JSON.stringify(after), '产品源码在运行期间未被修改');
  const result = {
    task: '1f484418',
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
