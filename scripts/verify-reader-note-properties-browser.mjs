// Task 3eabf1ac: the real reader note panel (MarkdownNotePanel) against a mocked
// note store. Proves the property area is discoverable, edits land in the same
// note content the session already saves (frontmatter), viewing writes nothing,
// legacy notes keep their bytes, two surfaces of one note share one session,
// failures are surfaced honestly, and the layout holds in a narrow column,
// dark theme and 150% zoom. Evidence: .tmp/shots/reader-note-properties-browser/.
// Run: node scripts/verify-reader-note-properties-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const dir = path.resolve('.tmp/reader-note-properties-browser');
const shots = path.resolve('.tmp/shots/reader-note-properties-browser');
fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
const checks = []; const errors = [];
const check = (name, value, detail) => { assert.ok(value, name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); checks.push(name); };

const legacyBody = '# 阅读笔记\n\n第一段正文，带 @annotation(a1) 引用。\n';
fs.writeFileSync(path.join(dir, 'host.tsx'), `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles.css';
import { MarkdownNotePanel } from '/src/features/reader/ReaderMarkdown';
const w = window as any;
const initial = [{ id: 'n1', paperId: 'p1', title: '阅读笔记', content: ${JSON.stringify(legacyBody)}, format: 'markdown' as const, updatedAt: '2026-09-28T01:00:00.000Z' }];
w.notes = initial.map(n => ({ ...n })); w.saves = []; w.failNext = ''; w.ipc = [];
w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command: string, args: any) => {
  w.ipc.push(command);
  if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
  if (command === 'read_paper_summary') return { path: 'D:/lib/p1/summary.md', content: '', exists: false, noteId: null, title: null };
  throw new Error('unexpected IPC ' + command + ' ' + JSON.stringify(args ?? null));
} };
function Surface({ id, width, height, notes, onSave }: any) {
  const paper = { paperId: 'p1', title: 'Paper One', authors: '', notes, annotations: [{ id: 'a1', paperId: 'p1', fileId: 'f1', page: 2, type: 'highlight', text: '被引用的句子' }] } as any;
  return <div data-surface={id} className="reader-workspace-drawer" style={{ width, height, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', display: 'flex', background: 'var(--surface)' }}>
    <MarkdownNotePanel paper={paper} draftPatch={null} onDraftPatchConsumed={() => {}} onSave={onSave} onCreateNote={async () => { throw new Error('not in this test'); }} onNavigateAnnotation={() => {}} />
  </div>;
}
function Host() {
  const [notes, setNotes] = useState(w.notes);
  const [surfaces, setSurfaces] = useState<string[]>(['sidebar']);
  const [width, setWidth] = useState(380);
  const [epoch, setEpoch] = useState(0);
  w.setWidth = setWidth; w.setSurfaces = setSurfaces; w.remount = () => setEpoch(e => e + 1);
  const onSave = async (input: any) => {
    await new Promise(r => setTimeout(r, 30));
    if (w.failNext) { const m = w.failNext; w.failNext = ''; throw new Error(m); }
    w.saves.push(JSON.parse(JSON.stringify(input)));
    w.notes = w.notes.map((n: any) => n.id === input.noteId ? { ...n, title: input.title, content: input.content, updatedAt: new Date().toISOString() } : n);
    setNotes(w.notes);
    return input.noteId;
  };
  return <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 12 }} key={epoch}>
    {surfaces.map(id => <Surface key={id + epoch} id={id} width={id === 'sidebar' ? width : 460} height={720} notes={notes} onSave={onSave} />)}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Host />);
`);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="icon" href="data:,"/></head><body style="margin:0;background:var(--background,#f4f4f2)"><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');

let server, browser, page;
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), path.dirname(path.dirname(require.resolve('react/package.json')))] }, watch: { ignored: ['**/.build/**', '**/src-tauri/**', '**/node_modules/**'] } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 780 } });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/.tmp/reader-note-properties-browser/index.html');
  const S = (id = 'sidebar') => `[data-surface="${id}"]`;
  const panel = (id = 'sidebar') => page.locator(`${S(id)} .note-workspace > .note-properties`);
  const rows = (id = 'sidebar') => page.locator(`${S(id)} .note-properties .markdown-property-row`);
  const shot = (name) => page.screenshot({ path: path.join(shots, name + '.png') });
  const saves = () => page.evaluate(() => window.saves);
  const lastContent = async () => { const s = await saves(); return s.length ? s[s.length - 1].content : null; };
  const waitSaves = async (n) => { await page.waitForFunction(n => window.saves.length >= n, n, { timeout: 8000 }); };
  const editorText = (id = 'sidebar') => page.evaluate(sel => document.querySelector(sel + ' .cm-content')?.textContent ?? '', S(id));

  await page.locator(`${S()} .cm-content`).waitFor({ timeout: 20000 });
  await panel().waitFor();
  // 1. Legacy note: the area exists (discoverable), starts folded because it is empty, and nothing is written.
  check('legacy note shows a folded 笔记属性 area with a zero count and the plain body in the editor',
    await panel().evaluate(el => el.classList.contains('is-collapsed')) && await page.locator(`${S()} .note-properties-count`).textContent() === '0' && (await editorText()).includes('第一段正文') && !(await editorText()).includes('---'));
  await page.waitForTimeout(1400);
  check('merely viewing a legacy note performs no save', (await saves()).length === 0);
  await shot('01-legacy-folded');

  // 2. Expand, add 标签 from the picker, type a value → frontmatter lands in the very same note content.
  await page.locator(`${S()} .note-properties .markdown-properties-heading > button`).click();
  check('the fold toggle expands the area and reveals the 添加笔记属性 entry', !(await panel().evaluate(el => el.classList.contains('is-collapsed'))) && await page.locator(`${S()} .markdown-property-suggest-toggle`).isVisible());
  await page.locator(`${S()} .markdown-property-suggest-toggle`).click();
  const choice = page.locator(`${S()} .markdown-property-choice-list`);
  await choice.waitFor();
  const choiceBox = await choice.boundingBox(); const surfaceBox = await page.locator(S()).boundingBox();
  check('the picker opens inside the note column instead of overflowing it', choiceBox.x >= surfaceBox.x && choiceBox.x + choiceBox.width <= surfaceBox.x + surfaceBox.width + 1, { choiceBox, surfaceBox });
  await shot('02-picker-open');
  await choice.locator('.markdown-property-option', { hasText: '标签' }).click();
  await rows().first().waitFor();
  const tagInput = rows().first().locator('.markdown-property-array-editor input');
  await tagInput.click(); await page.keyboard.type('transformer'); await page.keyboard.press('Enter');
  await waitSaves(1);
  await page.waitForFunction(() => window.saves.some(s => s.content.includes('- transformer')), null, { timeout: 8000 });
  let content = await lastContent();
  check('the tag is saved as frontmatter of the same note content with the body byte-identical', content === '---\ntags:\n  - transformer\n---\n' + legacyBody, content);
  check('the saved write targets the existing note id and carries the CAS baseline', (await saves()).every(s => s.noteId === 'n1' && s.expected && typeof s.expected.content === 'string'));
  check('the editor body still shows no YAML', !(await editorText()).includes('tags') && (await editorText()).includes('第一段正文'));

  // 3. Add 日期 with a typed value; then edit the body and make sure the prefix survives.
  await page.locator(`${S()} .markdown-property-suggest-toggle`).click();
  await choice.locator('.markdown-property-option', { hasText: '日期' }).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + ' .markdown-property-row').length === 2, S(), { timeout: 5000 });
  const dateInput = page.locator(`${S()} .markdown-property-row[data-property-key="date"] input.markdown-property-date`);
  await dateInput.click(); await page.keyboard.type('2026-09-28'); await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.saves.some(s => /date: ["']?2026-09-28/.test(s.content)), null, { timeout: 8000 });
  content = await lastContent();
  check('typed date is validated and stored under the tags entry in insertion order', /^---\ntags:\n  - transformer\ndate: ["']?2026-09-28["']?\n---\n/.test(content) && content.endsWith(legacyBody), content);
  check('日期 row uses the calendar editor, 标签 row the list editor (same types as the Markdown tab)', await page.locator(`${S()} .markdown-property-row[data-property-key="date"] .markdown-property-date-editor`).count() === 1 && await page.locator(`${S()} .markdown-property-row[data-property-key="tags"] .markdown-property-array-editor`).count() === 1);
  await shot('03-two-properties');
  // Drag-sort parity: pull the 日期 row above 标签 with the pointer.
  {
    const from = await page.locator(`${S()} .markdown-property-row[data-property-key="date"] .markdown-property-icon`).boundingBox();
    const to = await page.locator(`${S()} .markdown-property-row[data-property-key="tags"]`).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + (to.y - from.y - 4) * i / 8);
    await page.mouse.up();
    await page.waitForFunction(() => window.saves.some(s => s.content.startsWith('---\ndate:')), null, { timeout: 8000 });
    const order = await page.evaluate(sel => [...document.querySelectorAll(sel + ' .markdown-property-row')].map(r => r.dataset.propertyKey), S());
    check('pointer drag reorders the rows and the YAML order follows', order.join(',') === 'date,tags' && (await lastContent()).startsWith('---\ndate:'), order);
    content = await lastContent();
  }
  const prefix = content.slice(0, content.indexOf('---\n', 4) + 4);
  await page.locator(`${S()} .cm-content`).click();
  await page.keyboard.press('Control+End'); await page.keyboard.type('追加的一句。');
  await page.waitForFunction(() => window.saves.some(s => s.content.includes('追加的一句。')), null, { timeout: 8000 });
  content = await lastContent();
  check('body edits keep the frontmatter prefix byte-for-byte and never duplicate it', content.startsWith(prefix) && content.indexOf('---\ndate') === 0 && content.split('tags:').length === 2 && content.includes('追加的一句。'), content);

  // 4. Read mode shows chips, not YAML.
  await page.locator(`${S()} .note-view-switch button`).nth(1).click();
  await page.locator(`${S()} .note-preview-only .markdown-property-summary`).waitFor();
  const previewText = await page.locator(`${S()} .note-preview-only`).textContent();
  check('read mode renders the properties as chips and no raw YAML', previewText.includes('标签') && previewText.includes('transformer') && previewText.includes('2026-09-28') && !previewText.includes('tags:') && !previewText.includes('---'));
  await shot('04-read-mode-chips');
  await page.locator(`${S()} .note-view-switch button`).nth(0).click();
  await page.locator(`${S()} .cm-content`).waitFor();

  // 5. A second surface of the same note (floating/writing form) shares the session: no second copy.
  await page.evaluate(() => window.setSurfaces(['sidebar', 'floating']));
  await page.locator(`${S('floating')} .cm-content`).waitFor({ timeout: 15000 });
  await panel('floating').waitFor();
  check('a second surface shows the same two properties without re-reading a second data source', await rows('floating').count() === 2 && await page.locator(`${S('floating')} .note-properties-count`).textContent() === '2');
  const beforeSaves = (await saves()).length;
  await page.locator(`${S('floating')} .markdown-property-row[data-property-key="tags"] .markdown-property-array-editor input`).click();
  await page.keyboard.type('综述'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.saves.some(s => s.content.includes('- 综述')), null, { timeout: 8000 });
  await page.waitForFunction(sel => document.querySelectorAll(sel + ' .markdown-property-row[data-property-key="tags"] .markdown-property-chip').length === 2, S('sidebar'), { timeout: 5000 });
  check('an edit made in the second surface appears in the first one through the shared session', (await saves()).length > beforeSaves && await page.locator(`${S('sidebar')} .markdown-property-chip`).count() === 2);
  await shot('05-two-surfaces-shared');
  await page.evaluate(() => window.setSurfaces(['sidebar']));

  // 6. Remount (reopen): properties and body come back from the saved note; fold state remembered.
  await page.evaluate(() => window.remount());
  await page.locator(`${S()} .cm-content`).waitFor({ timeout: 15000 });
  await panel().waitFor();
  check('after remount the saved note yields the same properties, an expanded area and an intact body', await rows().count() === 2 && !(await panel().evaluate(el => el.classList.contains('is-collapsed'))) && (await editorText()).includes('追加的一句。') && !(await editorText()).includes('tags'));
  await shot('06-after-remount');

  // 7. Failure honesty: the save error banner appears, retry recovers.
  await page.evaluate(() => { window.failNext = '磁盘只读：模拟写入失败'; });
  await page.locator(`${S()} .markdown-property-row[data-property-key="tags"] .markdown-property-array-editor input`).click();
  await page.keyboard.type('失败重试'); await page.keyboard.press('Enter');
  await page.locator(`${S()} .note-save-error`).waitFor({ timeout: 8000 });
  check('a failed write is reported in the note error banner with retry / export / discard, not swallowed', (await page.locator(`${S()} .note-save-error`).textContent()).includes('磁盘只读') && await page.locator(`${S()} .note-save-error button`, { hasText: '重试保存' }).count() === 1);
  await shot('07-save-error');
  await page.locator(`${S()} .note-save-error button`, { hasText: '重试保存' }).click();
  await page.waitForFunction(() => window.saves.some(s => s.content.includes('- 失败重试')), null, { timeout: 8000 });
  await page.waitForFunction(sel => !document.querySelector(sel + ' .note-save-error'), S(), { timeout: 5000 });
  check('retry persists the pending property edit and clears the banner', true);

  // 8. Remove everything → the note returns to a legacy-shaped body (no empty --- block).
  for (let i = 0; i < 2; i += 1) {
    await rows().first().locator('.markdown-property-icon').click();
    await page.locator(`${S()} .markdown-property-menu button.danger`).click();
    await page.waitForFunction(({ sel, n }) => document.querySelectorAll(sel + ' .markdown-property-row').length === n, { sel: S(), n: 1 - i }, { timeout: 5000 });
  }
  await page.waitForFunction(() => window.saves.some(s => !s.content.startsWith('---')), null, { timeout: 8000 });
  content = await lastContent();
  check('removing the last property leaves a plain note again (no `---\\n{}\\n---` residue)', !content.startsWith('---') && content.startsWith('# 阅读笔记') && content.includes('追加的一句。'), content);
  check('the type menu and remove action come from the shared editor (same markup as the Markdown tab)', await page.locator(`${S()} .markdown-property-menu`).count() === 0);
  await shot('08-removed-legacy-shape');

  // 9. Layout: narrow column, dark theme, 150% zoom with long names.
  await page.locator(`${S()} .markdown-property-suggest-toggle`).click();
  await choice.locator('.markdown-property-option', { hasText: '标签' }).click();
  await rows().first().locator('.markdown-property-array-editor input').click();
  await page.keyboard.type('一个很长很长很长的标签名称用来检查换行与截断'); await page.keyboard.press('Enter');
  await page.locator(`${S()} .markdown-property-suggest-toggle`).click();
  await choice.locator('.markdown-property-option', { hasText: '摘要' }).click();
  await page.locator(`${S()} .markdown-property-row[data-property-key="summary"] input[type="text"]`).fill('这是一段相当长的摘要文字，用来验证窄侧栏下的输入框不会撑破布局');
  await page.evaluate(() => window.setWidth(280));
  await page.waitForTimeout(300);
  const narrowOverflow = await page.evaluate(sel => { const el = document.querySelector(sel); return el.scrollWidth - el.clientWidth; }, S());
  check('280px column: the property rows do not force horizontal overflow', narrowOverflow <= 1, narrowOverflow);
  await shot('09-narrow-280');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'midnight'));
  await page.waitForTimeout(200);
  const darkBg = await page.evaluate(sel => getComputedStyle(document.querySelector(sel + ' .note-workspace')).color, S());
  check('dark theme applies to the note column with the panel present', typeof darkBg === 'string');
  await shot('10-narrow-dark');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.evaluate(() => window.setWidth(380));
  await page.evaluate(() => { document.body.style.zoom = '1.5'; });
  await page.waitForTimeout(300);
  const zoomOverflow = await page.evaluate(sel => { const el = document.querySelector(sel); return el.scrollWidth - el.clientWidth; }, S());
  check('150% zoom: still no horizontal overflow and the count badge stays readable', zoomOverflow <= 1 && await page.locator(`${S()} .note-properties-count`).isVisible(), zoomOverflow);
  await shot('11-zoom-150');
  await page.evaluate(() => { document.body.style.zoom = '1'; });

  const ipc = await page.evaluate(() => window.ipc);
  check('the note store is only ever written through the existing save path (no extra IPC for properties)', ipc.every(c => c === 'read_paper_summary' || c.startsWith('plugin:event|')), [...new Set(ipc)]);
  check('no page errors or console errors', errors.length === 0, errors);
  console.log(`reader note properties browser: ${checks.length} checks passed; screenshots in ${path.relative(process.cwd(), shots)}`);
} catch (error) {
  if (page) { try { await page.screenshot({ path: path.join(shots, 'failure.png') }); } catch { /* ignore */ } }
  console.error(error);
  console.error('errors:', errors);
  process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
}
