// Real-DOM regression for the library file storage location UI (task 6557dc15).
// The real LibraryStorageSettings block and LibraryStorageNotice run against a scripted
// window.__TAURI_INTERNALS__ (invoke + event callbacks), so the whole path from button to
// command arguments, progress events, cancellation and error reporting is exercised in
// headless Chrome. Evidence: .tmp/shots/library-storage-browser/<run>/.
//   node scripts/verify-library-storage-browser.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const FIXTURE = process.env.LIBRARY_STORAGE_FIXTURE || 'scripts/fixtures/library-storage-host.tsx';
const HOST_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>library storage</title>'
  + '<style>body{margin:0;padding:16px;background:#eef1ee;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>';
const own = path.resolve('.tmp/library-storage-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.resolve('.tmp/shots/library-storage-browser', run);
const records = [];
const errors = [];
const screenshots = [];
function check(passed, name, detail) { records.push({ name, passed: !!passed, detail: detail === undefined ? null : detail }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

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
const wait = async (expression, tries = 100, interval = 100) => {
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
const text = selector => ev(`(document.querySelector(${JSON.stringify(selector)})?.textContent||'').trim()`);
const exists = selector => ev(`!!document.querySelector(${JSON.stringify(selector)})`);
const click = selector => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click();return true})()`);
const calls = name => ev(`window.__storageMock.calls.filter(c=>c[0]===${JSON.stringify(name)}).map(c=>c[1])`);
const status = () => ev(`(()=>{const e=document.querySelector('#library-storage-status');return e?{role:e.getAttribute('role'),tone:e.dataset.statusTone,text:e.textContent.trim()}:null})()`);

try {
  fs.mkdirSync(path.join(evidence, 'screenshots'), { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'host.tsx'), fs.readFileSync(FIXTURE, 'utf8'));
  fs.writeFileSync(path.join(own, 'host.html'), HOST_HTML);
  server = await createServer({
    configFile: false, root: process.cwd(), cacheDir: path.join(own, run + '-vite-cache'), plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/.build/**', '**/.tmp/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } },
  });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/library-storage-browser/host.html';
  const profile = path.join(own, run + '-profile');
  browserProcess = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + profile, '--window-size=1200,900', 'about:blank',
  ], { stdio: 'ignore' });
  for (let index = 0; index < 150 && !fs.existsSync(path.join(profile, 'DevToolsActivePort')); index += 1) await pause(100);
  const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && requests.has(message.id)) {
      const entry = requests.get(message.id); clearTimeout(entry.timer); requests.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push((message.params.args || []).map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(`document.querySelector('#setting-library-storage-facts')?.textContent.includes('默认位置')`);
  await pause(150);

  /* 1. default state: facts, recommendation, buttons, notice */
  const facts = await text('#setting-library-storage-facts');
  check(facts.includes('默认位置') && facts.includes('位于系统盘') && facts.includes('已占用 2.3 GB') && facts.includes('剩余 30.0 GB'), '默认状态：位置/系统盘/占用/剩余空间齐全', facts);
  check((await text('#setting-library-storage-root code')) === 'C:\\Users\\demo\\AppData\\Roaming\\app.aster.research\\AsterData\\files', '当前文件目录显示默认 AppData 路径');
  check(await ev(`document.querySelector('#setting-library-storage').dataset.custom==='false' && document.querySelector('#setting-library-storage').dataset.systemDrive==='true'`), '数据属性标记默认位置且在系统盘');
  check((await text('#setting-library-storage-recommend')).includes('D:\\A4Note\\files'), '推荐位置提示显示 D:\\A4Note\\files');
  check(await exists('#setting-library-storage-choose') && await exists('#setting-library-storage-use-recommended') && !(await exists('#setting-library-storage-reset')), '默认态按钮：选择目录 + 使用推荐位置，无恢复默认');
  check(await ev(`document.querySelector('#setting-library-storage-migrate').checked===true`), '「同时迁移现有文件」默认勾选');
  const notice = await text('#library-storage-notice');
  check(notice.includes('系统盘') && notice.includes('D:\\A4Note\\files') && await exists('#library-storage-notice-accept') && await exists('#library-storage-notice-dismiss'), '资料库首次提示卡显示推荐位置与两个操作', notice.slice(0, 80));
  await shot('01-default-with-recommendation');

  /* 2. reveal + dismiss */
  await click('#setting-library-storage-open');
  check(JSON.stringify(await ev(`window.__storageMock.calls.filter(c=>c[0]==='onReveal').length`)) === '1', '「打开所在文件夹」触发 reveal 回调');
  await click('#library-storage-notice-dismiss');
  await wait(`!document.querySelector('#library-storage-notice')`);
  check((await calls('dismiss_library_storage_prompt')).length === 1, '「保持默认，不再提示」调用 dismiss 命令并隐藏提示卡');

  /* 3. migrate to the recommended root with progress + completion */
  await ev(`window.__storageMock.delay = 900`);
  await click('#setting-library-storage-use-recommended');
  await wait(`!!document.querySelector('#setting-library-storage-progress [role="progressbar"]')`);
  const busy = await ev(`(()=>{const bar=document.querySelector('#setting-library-storage-progress [role="progressbar"]');return {now:Number(bar.getAttribute('aria-valuenow')),cancel:!!document.querySelector('#setting-library-storage-cancel'),chooseDisabled:document.querySelector('#setting-library-storage-choose').disabled,migrateDisabled:document.querySelector('#setting-library-storage-migrate').disabled,statusTone:document.querySelector('#library-storage-status')?.dataset.statusTone,label:document.querySelector('#setting-library-storage-progress .settings-muted')?.textContent}})()`);
  check(busy.cancel && busy.chooseDisabled && busy.migrateDisabled && busy.statusTone === 'busy', '迁移进行中：进度条、取消按钮、禁用其它操作、busy 状态', busy);
  await wait(`Number(document.querySelector('#setting-library-storage-progress [role="progressbar"]')?.getAttribute('aria-valuenow'))>=33`);
  const mid = await ev(`(()=>{const bar=document.querySelector('#setting-library-storage-progress [role="progressbar"]');return {now:Number(bar.getAttribute('aria-valuenow')),width:bar.firstElementChild.style.width,label:document.querySelector('#setting-library-storage-progress .settings-muted').textContent}})()`);
  check(mid.now >= 33 && mid.width === mid.now + '%' && /复制中 [123]\/3/.test(mid.label), '进度事件驱动 aria-valuenow / 宽度 / 文案', mid);
  await shot('02-migration-progress');
  await wait(`document.querySelector('#library-storage-status')?.dataset.statusTone==='success'`, 60, 100);
  const done = await status();
  check(done.text.includes('已把 3 个文件') && done.text.includes('D:\\A4Note\\files\\papers') && done.text.includes('3 条记录'), '完成后 status 报告迁移文件数、目标与数据库行数', done);
  const setCalls = await calls('set_library_files_root');
  check(setCalls.length === 1 && setCalls[0].path === 'D:\\A4Note\\files' && setCalls[0].migrate === true, 'set_library_files_root 收到推荐路径 + migrate=true', setCalls);
  check(await ev(`document.querySelector('#setting-library-storage').dataset.custom==='true' && !document.querySelector('#setting-library-storage-recommend') && !!document.querySelector('#setting-library-storage-reset') && !document.querySelector('#setting-library-storage-use-recommended')`), '迁移后：自定义位置、推荐提示消失、出现「恢复默认位置」');
  check((await text('#setting-library-storage-facts')).includes('不在系统盘'), '迁移后 facts 显示不在系统盘');
  check(await ev(`window.__storageMock.calls.filter(c=>c[0]==='onChanged').length>=1`), '迁移后通知宿主刷新路径');
  check(!(await exists('#setting-library-storage-progress')), '完成后进度条移除');
  await shot('03-custom-root');

  /* 4. pick a directory without migrating */
  await click('#setting-library-storage-migrate');
  await ev(`window.__storageMock.delay = 0; window.__storageMock.pickResult = 'E:\\\\Papers\\\\A4Note'`);
  await click('#setting-library-storage-choose');
  await wait(`document.querySelector('#library-storage-status')?.textContent.includes('E:\\\\Papers\\\\A4Note')`);
  const validated = await calls('validate_library_files_root');
  const picked = await calls('set_library_files_root');
  check(validated.at(-1)?.path === 'E:\\Papers\\A4Note' && picked.at(-1)?.path === 'E:\\Papers\\A4Note' && picked.at(-1)?.migrate === false, '选择目录：先校验再以 migrate=false 保存', { validated: validated.at(-1), picked: picked.at(-1) });
  const noMigrate = await status();
  check(noMigrate.tone === 'success' && noMigrate.text.includes('新导入') && noMigrate.text.includes('已有文件保留在原位置'), '不迁移时说明只影响新文件', noMigrate);
  const dialog = await calls('plugin:dialog|open');
  check(dialog.at(-1)?.options?.directory === true, '文件夹选择器以 directory=true 打开', dialog.at(-1));

  /* 5. rejected directory */
  await ev(`window.__storageMock.pickResult = 'C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\app.aster.research\\\\AsterData\\\\inside'`);
  const setBefore = (await calls('set_library_files_root')).length;
  await click('#setting-library-storage-choose');
  await wait(`document.querySelector('#library-storage-status')?.getAttribute('role')==='alert'`);
  const rejected = await status();
  check(rejected.text.includes('不能位于资料库数据目录内部') && (await calls('set_library_files_root')).length === setBefore, '数据目录内部的目录被拒绝且不保存', rejected);
  await shot('04-rejected-directory');

  /* 6. cancelled picker is a no-op */
  await ev(`window.__storageMock.pickResult = null`);
  await click('#setting-library-storage-choose');
  await pause(200);
  check((await calls('set_library_files_root')).length === setBefore, '取消文件夹选择器不产生保存');

  /* 7. restore default */
  await click('#setting-library-storage-migrate');
  check(await ev(`document.querySelector('#setting-library-storage-migrate').checked===true`), '迁移复选框可重新勾选');
  await click('#setting-library-storage-reset');
  await wait(`document.querySelector('#library-storage-status')?.dataset.statusTone==='success' && document.querySelector('#library-storage-status')?.textContent.includes('AsterData\\\\files\\\\papers')`);
  const reset = (await calls('set_library_files_root')).at(-1);
  check(reset.path === null && reset.migrate === true, '恢复默认以 path=null 调用并迁移回去', reset);
  check((await status()).text.includes('已把 3 个文件'), '迁回默认位置同样报告迁移结果');
  check(await ev(`document.querySelector('#setting-library-storage').dataset.custom==='false' && !!document.querySelector('#setting-library-storage-use-recommended')`), '恢复默认后推荐位置重新出现');

  /* 8. cancellation mid-copy */
  await ev(`window.__storageMock.delay = 1500`);
  await click('#setting-library-storage-use-recommended');
  await wait(`!!document.querySelector('#setting-library-storage-cancel')`);
  await click('#setting-library-storage-cancel');
  await wait(`document.querySelector('#library-storage-status')?.getAttribute('role')==='alert'`, 60, 100);
  const cancelled = await status();
  check(cancelled.text.includes('取消') && (await calls('cancel_library_files_root_migration')).length === 1, '取消迁移：调用 cancel 命令并以 alert 报告', cancelled);
  check(await ev(`document.querySelector('#setting-library-storage').dataset.custom==='false' && !document.querySelector('#setting-library-storage-choose').disabled`), '取消后仍是默认位置且按钮恢复可用');
  await shot('05-cancelled');

  /* 9. backend failure */
  await ev(`window.__storageMock.delay = 0; window.__storageMock.failNext = '目标磁盘剩余空间不足：需要约 2400 MB（含 64 MB 余量），当前可用 512 MB。'`);
  await click('#setting-library-storage-use-recommended');
  await wait(`document.querySelector('#library-storage-status')?.textContent.includes('剩余空间不足')`);
  check((await status()).role === 'alert', '空间不足错误以 alert 播报');

  /* 10. keyboard reachability + copy */
  const reachable = await ev(`(()=>{const ids=['setting-library-storage-choose','setting-library-storage-use-recommended','setting-library-storage-open','setting-library-storage-migrate'];return ids.every(id=>{const e=document.getElementById(id);return e && e.tabIndex>=0 && !e.disabled;})})()`);
  check(reachable, '主要控件均可键盘到达');
  check(errors.length === 0, '无 pageerror / console error', errors.slice(0, 3));
} catch (error) {
  check(false, '执行失败', String(error && error.stack || error));
} finally {
  pauseAll();
  try { if (ws) await send('Browser.close'); } catch { /* ignore */ }
  try { browserProcess?.kill(); } catch { /* ignore */ }
  try { await server?.close(); } catch { /* ignore */ }
}
const failed = records.filter(record => !record.passed);
const result = { evidence, passed: records.length - failed.length, total: records.length, failed, screenshots, errors };
fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ ...result, records }, null, 2));
console.log(JSON.stringify({ evidence, failed, passed: result.passed, total: result.total }, null, 2));
process.exit(failed.length ? 1 : 0);
