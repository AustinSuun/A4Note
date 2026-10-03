/**
 * Doc2X library entry evidence (65aab909): mounts the real LibraryScene, the real
 * PaperContextMenu and the real LibraryDetailPanel against a stub host entry, then
 * clicks the entries. The guidance text in the screenshots comes from
 * doc2xEntryPlan, so the images cannot drift from what users would read.
 *
 *   node scripts/verify-doc2x-entry-browser.mjs
 * Evidence: .tmp/shots/doc2x-entry/<run>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const root = process.cwd();
const hostDir = path.join(root, '.tmp', 'doc2x-entry-browser');
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, '.tmp', 'shots', 'doc2x-entry', run);
fs.mkdirSync(hostDir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });

fs.writeFileSync(path.join(hostDir, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>doc2x library entry</title>'
  + '<style>body{margin:0;background:#f4f6f4;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');

fs.writeFileSync(path.join(hostDir, 'host.tsx'), `
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
import '/src/ui/styles/library.css';
import { LibraryScene } from '/src/features/library/LibraryScene';
import { LibraryDetailPanel } from '/src/features/library/LibraryDetailPanel';
import { describeDoc2xEntryCli, describeDoc2xEntryFailure, DOC2X_ENTRY_LOGIN_HINT } from '/src/features/doc2x/doc2xEntryPlan';
import type { LibraryDoc2xEntry } from '/src/features/library/types';
import type { LibraryFolder, PaperDocument } from '/src/core/types';

const papers: PaperDocument[] = [
  { paperId: 'p1', title: 'Attention Is All You Need', authors: 'Ashish Vaswani et al.', year: 2017, venue: 'NeurIPS', doi: '10.5555/3295222', folderId: 'library', sourceFileId: 'file-1', sourcePdf: 'D:/papers/attention.pdf', translatedFileIds: [], translatedPdfs: [], tags: ['nlp'], notes: [], annotations: [], aiThreads: [], metadataSource: 'manual' },
  { paperId: 'p2', title: 'Deep Residual Learning for Image Recognition', authors: 'Kaiming He et al.', year: 2016, venue: 'CVPR', doi: '10.1109/CVPR.2016.90', folderId: 'f-cv', sourceFileId: 'file-2', sourcePdf: 'D:/papers/resnet.pdf', translatedFileIds: [], translatedPdfs: [], tags: ['cv'], notes: [], annotations: [], aiThreads: [], metadataSource: 'manual' },
];
const translatedPapers: PaperDocument[] = [
  { ...papers[0], translatedFileIds: ['file-1-zh'], translatedPdfs: ['D:/papers/attention.zh.pdf'] },
];
const folders: LibraryFolder[] = [
  { folderId: 'library', name: '默认资料库', parentId: null },
  { folderId: 'f-cv', name: '计算机视觉', parentId: null },
];
const noop = () => {};

const cliMissing = describeDoc2xEntryCli({ available: false, nodeMajor: 22 });
const authMissing = describeDoc2xEntryFailure({ kind: 'auth', message: 'Doc2X 登录已失效、额度或订阅不足，请重新登录或检查账号订阅' });

function Host() {
  const [state, setState] = useState({ enabled: true, busy: false, translated: false, notice: cliMissing as string });
  const calls = useRef<string[]>([]);
  const translate = (paperId: string) => {
    calls.current.push(paperId);
    const message = '已按 ' + paperId + ' 发起 Doc2X 翻译（示例）：译文会回到该文献。';
    setState((current) => ({ ...current, notice: message }));
    return Promise.resolve(message);
  };
  const doc2xEntry: LibraryDoc2xEntry = {
    enabled: state.enabled,
    busy: state.busy,
    notice: state.notice || undefined,
    onDismissNotice: () => setState((current) => ({ ...current, notice: '' })),
    onTranslate: translate,
  };
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__harness = {
      set: (patch: Partial<typeof state>) => setState((current) => ({ ...current, ...patch })),
      guidance: { cliMissing, authMissing, loginHint: DOC2X_ENTRY_LOGIN_HINT },
      calls: () => calls.current,
      reset: () => { calls.current = []; },
    };
  }, []);
  return (
    <div className="doc2x-harness">
      <div data-pane="library"><LibraryScene
        papers={papers} folders={folders} selectedPaper={papers[0]} tags={['nlp', 'cv']}
        activeTag="all" activeFolderId="all" query="" sort={{ key: 'title', direction: 'asc' }}
        detailOpen={false} aiThreadContexts={[]} bulkSelectedPaperIds={[]} searchInputRef={useRef(null)}
        sidePanels={[]} panelViews={[]} doc2xEntry={doc2xEntry}
        onQueryChange={noop} onSelectPaper={noop} onBulkSelectionChange={noop} onMovePapersToFolder={noop}
        onOpenPaper={noop} onOpenNote={noop} onCreateNote={noop} onSelectTag={noop} onSelectFolder={noop}
        onSortChange={noop} onDetailOpenChange={noop} onOpenImport={noop} onOpenReader={noop} onOpenRelations={noop}
        onOpenTranslationImport={noop} onRevealSourcePdf={noop} onRevealTranslatedPdf={noop}
        onOpenSourcePdfExternal={noop} onOpenTranslatedPdfExternal={noop} onOpenMetadataEdit={noop}
        onOpenTagsEdit={noop} onOpenBulkTagsEdit={noop} onBulkDelete={noop} onDeletePaper={noop}
        onCopyBibtex={noop} onCopyBulkBibtex={noop} />
      </div>
      <div data-pane="detail"><LibraryDetailPanel
        paper={state.translated ? translatedPapers[0] : papers[0]} aiThreadContexts={[]} onOpenReader={noop} onOpenRelations={noop}
        onOpenTranslationImport={noop} doc2xEntry={doc2xEntry}
        onRevealSourcePdf={() => calls.current.push('reveal-source')} onRevealTranslatedPdf={() => calls.current.push('reveal-translated')}
        onOpenSourcePdfExternal={noop} onOpenTranslatedPdfExternal={() => calls.current.push('open-translated-external')}
        onOpenMetadataEdit={noop} onOpenTagsEdit={noop} onCopyBibtex={noop} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root') as HTMLElement).render(<Host/>);
`);

const ITEM = 'Doc2X 翻译（本机 CLI）';
const results = [];
const check = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : detail });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const openRowMenu = async (page) => {
  const row = page.locator('.library-main tbody tr').first();
  await row.waitFor({ state: 'attached', timeout: 15000 });
  const box = await row.boundingBox();
  const x = (box ? box.x + box.width / 2 : 320);
  const y = (box ? box.y + box.height / 2 : 320);
  await row.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 });
  await pause(200);
};

let server;
try {
  server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(hostDir, 'cache'),
    optimizeDeps: { entries: ['.tmp/doc2x-entry-browser/index.html'] },
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/doc2x-entry-browser/index.html';
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const pageErrors = [];
    const ignored = [];
    // The isolated host has no dev asset pipeline and dispatches a synthetic
    // contextmenu event, so a stray 404 and the NaN menu offset are host noise,
    // not product behaviour. Uncaught exceptions are never ignored.
    const hostNoise = (text) => text.includes('404 (Not Found)') || text.includes('NaN');
    page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text().slice(0, 200);
      if (hostNoise(text)) ignored.push(text); else pageErrors.push(text);
    });
    await page.goto(url);
    await page.addStyleTag({ content: '.doc2x-harness{display:flex;gap:18px;padding:16px;align-items:stretch;height:760px}.doc2x-harness>[data-pane="library"]{width:820px;flex:none;min-height:0;display:flex}.doc2x-harness>[data-pane="library"]>.scene{flex:1;min-height:0}.doc2x-harness>[data-pane="detail"]{width:340px;flex:none;min-height:0;overflow:auto}.library-main{padding:0}' });
    const shot = (name) => page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true });

    try {
      await page.waitForSelector('.library-main tbody tr', { timeout: 15000 });
    } catch (error) {
      console.log('SCENE DID NOT RENDER: ' + pageErrors.join(' | '));
      console.log('DOM: ' + (await page.evaluate(() => (document.getElementById('root') || { innerHTML: '' }).innerHTML.replace(/\s+/g, ' ').slice(0, 400))));
      throw error;
    }

    // 1. guidance bar: text produced by production code, rendered by the real scene
    const guidance = await page.evaluate(() => window.__harness.guidance);
    check('CLI 缺失引导同时给出安装命令与登录命令', guidance.cliMissing.includes('npm i -g @noedgeai-org/doc2x-cli') && guidance.cliMissing.includes('doc2x login'), guidance.cliMissing);
    check('登录引导包含可复制的登录命令', guidance.authMissing.includes('doc2x login'), guidance.authMissing);
    const notice = page.locator('.library-doc2x-notice').first();
    check('文献库显示引导通知栏', await notice.isVisible());
    const noticeText = (await notice.innerText()).replace(/\s+/g, ' ').trim();
    check('通知栏文案与实现一致', noticeText.includes('npm i -g @noedgeai-org/doc2x-cli'), noticeText);
    await shot('01-library-guidance-cli-missing');

    // 2. detail panel entry
    const detailButton = page.locator('[data-pane="detail"] button', { hasText: ITEM });
    check('文献详情面板显示翻译入口', (await detailButton.count()) === 1 && (await detailButton.first().isVisible()));

    // 3. context menu entry, then the full click chain
    await openRowMenu(page);
    const menuItem = page.getByRole('menuitem', { name: ITEM });
    await menuItem.first().waitFor({ state: 'visible', timeout: 5000 });
    check('右键菜单显示翻译入口', await menuItem.first().isVisible());
    await shot('02-context-menu-entry');
    await menuItem.first().press('Enter');
    await pause(250);
    const calls = await page.evaluate(() => window.__harness.calls());
    check('菜单入口点击后调用翻译控制器', calls.length === 1 && calls[0] === 'p1', JSON.stringify(calls));
    check('点击后通知栏反馈结果', (await notice.innerText()).includes('发起'), (await notice.innerText()).replace(/\s+/g, ' ').trim());
    await shot('03-detail-panel-and-after-menu-click');

    // 4. detail panel entry drives the same controller
    await detailButton.first().click();
    await pause(250);
    const calls2 = await page.evaluate(() => window.__harness.calls());
    check('详情面板入口复用同一控制器', calls2.length === 2 && calls2[1] === 'p1', JSON.stringify(calls2));

    // 5. in-flight state disables both entries instead of double-submitting
    await page.evaluate(() => window.__harness.set({ busy: true }));
    await pause(150);
    check('翻译进行中：详情面板入口禁用', await detailButton.first().isDisabled());
    await openRowMenu(page);
    check('翻译进行中：右键入口同样禁用', await page.getByRole('menuitem', { name: ITEM }).first().isDisabled());
    await shot('04-busy-disabled');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__harness.set({ busy: false }));
    await pause(150);

    // 6. disabled plugin removes the entries entirely
    await page.evaluate(() => window.__harness.set({ enabled: false }));
    await pause(150);
    check('插件关闭后详情面板无入口', (await page.locator('[data-pane="detail"] button', { hasText: ITEM }).count()) === 0);
    await openRowMenu(page);
    await pause(200);
    check('插件关闭后右键菜单无入口', (await page.getByRole('menuitem', { name: ITEM }).count()) === 0);
    await shot('05-plugin-disabled');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__harness.set({ enabled: true }));
    await pause(150);

    // 7. dismissible: the in-flight result lives in scene state, so closing it
    //    clears both the local message and the host notice, and it stays closed.
    await page.locator('.library-doc2x-notice button').first().click();
    await pause(200);
    check('引导可关闭', (await page.locator('.library-doc2x-notice').count()) === 0);
    await page.evaluate(() => window.__harness.set({ busy: false }));
    await pause(200);
    check('关闭后不自动重现', (await page.locator('.library-doc2x-notice').count()) === 0);
    await shot('06-guidance-dismissed');

    // 8. not-logged-in / quota guidance names the login step
    await page.evaluate(() => window.__harness.set({ notice: window.__harness.guidance.authMissing }));
    await pause(200);
    const authText = (await notice.innerText()).replace(/\s+/g, ' ').trim();
    check('未登录/额度不足引导给出登录下一步', authText.includes('登录') && authText.includes('额度'), authText);
    await shot('07-guidance-not-logged-in');

    // 9. 收口遗留：译文回到文献后，详情面板能看到并可打开该译文文件
    const translatedRow = page.locator('[data-pane="detail"] .binding-row', { hasText: '译文' }).first();
    check('未导入译文时该行为未绑定且按钮禁用', (await translatedRow.innerText()).includes('未绑定')
      && await translatedRow.locator('button').first().isDisabled(), (await translatedRow.innerText()).replace(/\s+/g, ' ').trim());
    await page.evaluate(() => window.__harness.set({ translated: true, notice: '' }));
    await pause(200);
    const translatedText = (await translatedRow.innerText()).replace(/\s+/g, ' ').trim();
    check('译文回到文献后该行显示 1 份译文', translatedText.includes('1 份译文'), translatedText);
    check('译文行「显示」按钮可用', await translatedRow.locator('button').first().isEnabled());
    await translatedRow.locator('button').first().click();
    await pause(150);
    const calls3 = await page.evaluate(() => window.__harness.calls());
    check('「显示」按钮走宿主回调（打开译文所在位置）', calls3.includes('reveal-translated'), JSON.stringify(calls3.slice(-3)));
    await shot('08-translated-file-visible');

    check('页面无脚本错误（忽略宿主自身噪声）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    if (ignored.length) console.log('NOTE 已忽略隔离宿主噪声 ' + ignored.length + ' 条：' + ignored[0]);
  } finally {
    await browser.close();
  }
} finally {
  if (server) await server.close();
}

const failed = results.filter((entry) => !entry.passed);
for (const entry of results) console.log((entry.passed ? 'PASS ' : 'FAIL ') + entry.name + (entry.detail ? ' :: ' + entry.detail : ''));
console.log('doc2x-entry-browser: ' + (results.length - failed.length) + '/' + results.length + ' checks passed; evidence in ' + path.relative(root, evidence));
if (failed.length || !results.length) process.exitCode = 1;
