// Isolated native WebView2 evidence for task 1f6e50b2 (arena-two takeover): the sidebar's permanent
// "Ctrl+K / Ctrl+Shift+P" label next to 命令面板 is gone while the button, its accessible shortcuts and
// dispatch stay; the reader's floating Ctrl hint rows use a flat opaque surface (no shadow / blur / halo)
// in light and midnight themes. Attaches to a running isolated dev:live instance (never production).
// Usage: node scripts/verify-shortcut-light-native.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'after';
const port = Number(process.env.LIGHT_CDP_PORT || 9329);
const vitePort = Number(process.env.LIGHT_VITE_PORT || 1499);
const instance = process.env.LIGHT_INSTANCE || 'arena-two-light';
const base = path.resolve('.tmp/shots/shortcut-light-native');
const dir = path.join(base, label);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = tabs.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${vitePort}`));
if (!page) throw Error('Isolated WebView target missing');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(); const errors = []; const steps = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push('pageerror ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map(x => x.value ?? x.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.exception?.value ?? '')); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (expr, name, tries = 120) => { for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* retry */ } await pause(120); } throw Error('timeout ' + name); };
const shot = async (name, clip) => fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })).data, 'base64'));
const step = (name, data) => { steps.push({ step: name, ...data }); console.log(name, JSON.stringify(data).slice(0, 200)); return data; };
const ACTIVE = '.workbench-tab-frame.active';
const ctrl = async down => send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: down ? 2 : 0 });
const enterScene = async name => {
  if (await ev(`!!document.querySelector('.workbench-scene-list')`)) {
    await ev(`(()=>{const el=[...document.querySelectorAll('.workbench-scene-list button, .workbench-scene-list [role=button], .workbench-scene-list a')].find(b=>new RegExp(${JSON.stringify(name)}).test(b.textContent));el?.click();return !!el})()`);
  } else await ev(`([...document.querySelectorAll('.workbench-tool')].find(x=>x.textContent.trim()===${JSON.stringify(name)})?.click(),true)`);
  await pause(600);
};
const sidebarState = () => ev(`(()=>{const b=document.querySelector('[data-shortcut-id="global.palette"]');if(!b)return {present:false};const r=b.getBoundingClientRect();const kbd=b.querySelector('kbd');return {present:true,kbdCount:b.querySelectorAll('kbd').length,kbdText:kbd?kbd.textContent:null,label:b.querySelector('.workbench-tool-label')?.textContent,title:b.getAttribute('title'),keys:b.getAttribute('aria-keyshortcuts'),name:b.getAttribute('aria-label')||b.textContent.trim(),rect:{x:r.left,y:r.top,w:r.width,h:r.height},settings:!!document.querySelector('.workbench-sidebar-footer .workbench-tool:nth-child(2)'),footerText:document.querySelector('.workbench-sidebar-footer')?.innerText,footerIcons:document.querySelectorAll('.workbench-sidebar-footer .workbench-tool-icon').length,badge:document.querySelector('.workbench-workspace-meta')?.textContent??null}})()`);
const hintState = () => ev(`(()=>{const rows=[...document.querySelectorAll('.shortcut-hints .shortcut-floating-hint')];const layer=document.querySelector('.shortcut-hints');const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');const alpha=v=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]};const one=rows[0];if(!one)return {visible:!!layer&&layer.classList.contains('is-visible'),rows:0};const s=getComputedStyle(one,'::before');const k=getComputedStyle(one.querySelector('kbd'));const l=getComputedStyle(one.querySelector('.shortcut-hint-label'));const kb=one.querySelector('kbd').getBoundingClientRect();return {visible:layer.classList.contains('is-visible'),rows:rows.length,rowBackground:s.backgroundColor,rowAlpha:alpha(s.backgroundColor),rowShadow:s.boxShadow,rowBlur:s.backdropFilter,rowRadius:s.borderRadius,rowBorder:s.borderTopWidth,keyBackground:k.backgroundColor,keyAlpha:alpha(k.backgroundColor),keyShadow:k.boxShadow,keyBlur:k.backdropFilter,keyFont:k.fontSize,keyHeight:Math.round(kb.height),labelFont:l.fontSize,labelShadow:l.textShadow,inViewport:rows.every(r=>{const b=r.getBoundingClientRect();return b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight}),sample:rows.slice(0,3).map(r=>r.innerText.replace(/\\n/g,' '))}})()`);
const withTheme = async (theme, fn) => {
  const prev = await ev(`document.documentElement.getAttribute('data-theme')`);
  await ev(`(document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)}),true)`);
  await pause(250);
  try { await fn(); } finally { await ev(`(${prev === null ? 'document.documentElement.removeAttribute(\'data-theme\')' : `document.documentElement.setAttribute('data-theme',${JSON.stringify(prev)})`},true)`); await pause(150); }
};
const PALETTE = '[role="dialog"], .command-palette, [class*="command-palette"]';
const closePalette = async () => {
  for (let i = 0; i < 3 && await ev(`!!document.querySelector('${PALETTE}')`); i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await pause(300);
    if (await ev(`!!document.querySelector('${PALETTE}')`)) await ev(`(()=>{const b=[...document.querySelectorAll('${PALETTE} button')].find(x=>x.textContent.trim()==='Esc');b?.click();return !!b})()`);
    await pause(300);
  }
  return !(await ev(`!!document.querySelector('${PALETTE}')`));
};
let problem = null;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await wait(`document.body.innerText.includes('DEV\\n${instance} · 独立测试库（原生已核验')`, 'DEV guard');
  await ev(`(window.confirm=()=>true,true)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  errors.length = 0;
  await enterScene('文献');
  await wait(`!!document.querySelector('.workbench-sidebar-footer')`, 'sidebar footer', 60);
  await pause(400);
  const sidebar = step('sidebar footer', await sidebarState());
  await shot('01-sidebar-full');
  if (sidebar.present) await shot('02-sidebar-footer-closeup', { x: 0, y: Math.max(0, sidebar.rect.y - 60), width: 360, height: 150 });
  // Palette button still works and Ctrl+K / Ctrl+Shift+P still open it.
  await ev(`(document.querySelector('[data-shortcut-id="global.palette"]').click(),true)`);
  const opened = await wait(`!!document.querySelector('[role="dialog"], .command-palette, [class*="command-palette"]')`, 'palette open', 30).catch(() => false);
  step('palette click opens', { opened });
  await shot('03-palette-open');
  step('palette closes', { closed: await closePalette() });
  await ev(`(document.activeElement?.blur(),document.body.focus(),true)`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
  const viaKey = await wait(`!!document.querySelector('[role="dialog"], .command-palette, [class*="command-palette"]')`, 'palette via Ctrl+K', 30).catch(() => false);
  step('Ctrl+K opens palette', { viaKey });
  step('palette closes again', { closed: await closePalette() });
  // Reader: hold Ctrl for the floating hints (a restored reader tab is used as-is).
  if (!(await ev(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`))) {
    await wait(`document.querySelectorAll('${ACTIVE} .paper-table tbody tr').length>=1`, 'library rows');
    await ev(`(document.querySelectorAll('${ACTIVE} .paper-table tbody tr')[0].dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})),true)`);
  }
  await wait(`!!document.querySelector('${ACTIVE} .reader-note-workbench-button')`, 'reader');
  await wait(`document.querySelectorAll('${ACTIVE} canvas').length>=1`, 'pdf canvas', 200);
  await pause(1200);
  await ev(`(document.activeElement?.blur(),true)`);
  for (const theme of ['light', 'midnight']) {
    await withTheme(theme === 'light' ? null : 'midnight', async () => {
      if (theme === 'light') await ev(`(document.documentElement.removeAttribute('data-theme'),true)`);
      await ctrl(true);
      await wait(`document.querySelector('.shortcut-hints')?.classList.contains('is-visible')`, 'hints visible ' + theme, 40);
      await pause(300);
      step('reader hints ' + theme, await hintState());
      await shot(`04-reader-hints-${theme}`);
      const first = await ev(`(()=>{const r=document.querySelector('.shortcut-hints .shortcut-floating-hint')?.getBoundingClientRect();return r?{x:r.left,y:r.top,w:r.width,h:r.height}:null})()`);
      if (first) await shot(`05-reader-hint-closeup-${theme}`, { x: Math.max(0, first.x - 40), y: Math.max(0, first.y - 40), width: Math.min(420, 1600 - first.x + 40), height: 260 });
      await ctrl(false);
      await wait(`!document.querySelector('.shortcut-hints')?.classList.contains('is-visible')`, 'hints hidden ' + theme, 40);
    });
  }
  step('hints hide on release', { hidden: !(await ev(`document.querySelector('.shortcut-hints')?.classList.contains('is-visible')`)) });
} catch (error) { problem = String(error); try { await shot('failure'); } catch { /* ignore */ } }
finally { try { await ctrl(false); await send('Emulation.clearDeviceMetricsOverride'); } catch { /* ignore */ } }
fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify({ label, instance, steps, errors, problem }, null, 2));
console.log(JSON.stringify({ label, steps: steps.length, errors: errors.length, problem }));
ws.close();
if (problem) process.exit(1);
