import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Isolated browser run against the real resource/editor modules; never opens user notes.
// The first H1 becomes the document title, so the body's first line is a second H1:
// exactly the note shape where the initial caret used to reveal `# ` on open.
const dir = path.resolve('.tmp/markdown-open-reveal-browser');
fs.mkdirSync(dir, { recursive: true });
const note = [
  '# 文档标题', '', '# 第一行标题：分+治+合', '', '正文第一段 **粗体** 内容，用于点击其他行。', '',
  '## 第二节', '', '第二节正文。', '',
  ...Array.from({ length: 12 }, (_, i) => `## 后续段落 ${i + 1}\n\n${'填充正文。'.repeat(30)}\n`),
].join('\n');
fs.writeFileSync(path.join(dir, 'reveal-note.md'), note);
fs.writeFileSync(path.join(dir, 'reveal-mock.ts'), `import { useState } from 'react';\nimport fixture from './reveal-note.md?raw';\nexport function useTextDocument(path: string) { const [content, setContent] = useState(fixture); return {documentId:path,content,setContent,loading:false,error:'',saveState:'saved',saveError:'',save:()=>{},reload:async()=>{}}; }`);
fs.writeFileSync(path.join(dir, 'reveal-host.tsx'), `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { EditorView } from '@codemirror/view';\nimport { MarkdownResourceTab } from '/src/features/explorer/MarkdownResourceTab';\nimport '/src/ui/styles/tokens.css'; import '/src/ui/styles/base.css'; import '/src/ui/styles/workbench.css'; import '/src/ui/styles/markdown.css';\n(window as any).__view=()=>EditorView.findFromDOM(document.querySelector('.markdown-live-codemirror .cm-editor'));\nconst shell=document.getElementById('root')!;shell.style.cssText='height:760px;width:min(1200px,100vw);display:flex;position:relative;';\ncreateRoot(shell).render(<MarkdownResourceTab path="C:\\\\\\\\synthetic\\\\\\\\open-reveal.md" name="open-reveal.md" />);`);
fs.writeFileSync(path.join(dir, 'reveal.html'), '<!doctype html><html><head><meta charset="utf-8"/><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./reveal-host.tsx"></script></body></html>');
const errors = []; let server, browser;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'vite-cache'), plugins: [react()], resolve: { alias: [{ find: './useTextDocument', replacement: path.join(dir, 'reveal-mock.ts') }] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), fs.realpathSync(path.resolve('node_modules'))] }, watch: { ignored: ['**/.tmp/**', '**/.build/**', '**/.worktrees/**', '**/node_modules/**', '**/src-tauri/target/**'] } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console ' + msg.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
  const port = server.httpServer.address().port;
  // Sample every animation frame from navigation on, so the very first painted
  // editor frame is checked, not a later settled state.
  await page.addInitScript(() => {
    window.__frames = [];
    const sample = () => {
      const line = document.querySelector('.markdown-live-codemirror .cm-content > .cm-line');
      if (line && line.textContent.includes('第一行标题')) window.__frames.push([...line.querySelectorAll('.cm-md-source-marker')].filter((m) => m.getClientRects().length && getComputedStyle(m).display !== 'none' && getComputedStyle(m).visibility !== 'hidden' && parseFloat(getComputedStyle(m).fontSize) > 0 && m.getBoundingClientRect().width > 0).map((m) => m.textContent).join(''));
      if (window.__frames.length < 30) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`http://127.0.0.1:${port}/.tmp/markdown-open-reveal-browser/reveal.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.markdown-live-codemirror .cm-editor .cm-line', { timeout: 30000 });
  await page.waitForFunction(() => window.__frames.length >= 30, null, { timeout: 30000 });
  const state = () => page.evaluate(() => {
    const view = window.__view();
    const visible = (line) => line ? [...line.querySelectorAll('.cm-md-source-marker')].filter((m) => m.getBoundingClientRect().width > 0 && getComputedStyle(m).visibility !== 'hidden').map((m) => m.textContent).join('') : null;
    const lineOf = (text) => [...document.querySelectorAll('.markdown-live-codemirror .cm-content > .cm-line')].find((line) => line.textContent.includes(text));
    return { first: visible(lineOf('# 第一行') ?? lineOf('第一行')), second: visible(lineOf('第二节') && lineOf('## 第二节') || lineOf('第二节')), focused: view.hasFocus, head: view.state.selection.main.head, firstClass: lineOf('第一行标题')?.className };
  });
  const frames = await page.evaluate(() => window.__frames);
  const opened = await state();
  assert.equal(await page.inputValue('.markdown-document-title-input'), '文档标题', 'first H1 is the title; the body starts with another heading');
  assert.equal(opened.head, 0, 'the caret starts on the first body line');
  assert.ok(frames.every((markers) => markers === ''), `no frame after opening may show heading syntax on line 1: ${JSON.stringify(frames.slice(0, 8))}`);
  assert.equal(opened.first, '', `opened note shows "# " on its first heading: ${JSON.stringify(opened)}`);
  assert.equal(opened.focused, false);

  const firstLine = page.locator('.markdown-live-codemirror .cm-content > .cm-line', { hasText: '第一行标题' });
  const paragraph = page.locator('.markdown-live-codemirror .cm-content > .cm-line', { hasText: '正文第一段' });
  await firstLine.click({ position: { x: 120, y: 12 } }); await sleep(150);
  const clicked = await state();
  assert.ok(clicked.first.includes('#') && clicked.focused, `clicking the heading reveals it: ${JSON.stringify(clicked)}`);
  await paragraph.click({ position: { x: 40, y: 8 } }); await sleep(150);
  assert.equal((await state()).first, '', 'clicking another line folds the heading');

  await firstLine.click({ position: { x: 120, y: 12 } }); await sleep(150);
  assert.ok((await state()).first.includes('#'));
  await page.locator('.markdown-document-title-input').click(); await sleep(200);
  const blurred = await state();
  assert.ok(!blurred.focused && blurred.first === '', `focus leaving the editor folds the revealed line: ${JSON.stringify(blurred)}`);
  await page.keyboard.press('Escape');

  // Programmatic focus alone (reader "new note", context menu) must not reveal.
  await page.evaluate(() => { const view = window.__view(); view.focus(); });
  await sleep(150);
  const programmatic = await state();
  assert.ok(programmatic.focused && programmatic.first === '', `programmatic focus keeps line 1 folded: ${JSON.stringify(programmatic)}`);
  await page.keyboard.press('End'); await sleep(150);
  assert.ok((await state()).first.includes('#'), 'a keyboard move reveals the caret line');
  await paragraph.click({ position: { x: 40, y: 8 } }); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await sleep(150);
  const arrows = await state();
  assert.ok(arrows.first.includes('#'), `arrow keys onto the heading reveal it: ${JSON.stringify(arrows)}`);
  await page.keyboard.press('End'); await page.keyboard.type('新'); await sleep(150);
  assert.ok((await state()).first.includes('#'), 'typing keeps the line revealed');
  await page.keyboard.press('Backspace');

  // TOC jump keeps its existing behaviour: focus and reveal the target heading.
  await page.locator('.markdown-document-title-input').click(); await page.keyboard.press('Escape'); await sleep(150);
  await page.locator('.markdown-toc-toggle').click();
  await page.locator('.markdown-toc-item:has-text("第二节")').first().click();
  await sleep(600);
  const toc = await page.evaluate(() => {
    const view = window.__view(); const line = view.state.doc.lineAt(view.state.selection.main.head);
    const row = [...document.querySelectorAll('.markdown-live-codemirror .cm-content > .cm-line')].find((el) => el.textContent.includes('第二节') && !el.textContent.includes('正文'));
    return { text: line.text, focused: view.hasFocus, markers: row ? [...row.querySelectorAll('.cm-md-source-marker')].filter((m) => m.getBoundingClientRect().width > 0).map((m) => m.textContent).join('') : null };
  });
  assert.ok(toc.text === '## 第二节' && toc.focused && toc.markers.includes('##'), `TOC jump focuses and reveals its heading: ${JSON.stringify(toc)}`);
  assert.deepEqual(errors, []);
  console.log('PASS Markdown open reveal browser: first frames folded, click/keyboard/typing reveal, blur folds, programmatic focus stays folded, TOC jump reveals', JSON.stringify({ frames: frames.length, opened, clicked, toc }));
} catch (e) { console.error('FAILED Markdown open reveal browser:', e, JSON.stringify(errors)); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); }
