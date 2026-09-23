import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const root = process.cwd();
const hostDir = path.join(root, '.tmp', 'reader-note-markdown-browser');
const evidence = path.join(root, '.tmp', 'shots', 'reader-note-markdown');
fs.mkdirSync(hostDir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(hostDir, 'index.html'), '<div id="root"></div><script type="module" src="./host.tsx"></script>');
fs.writeFileSync(path.join(hostDir, 'mock-summaries.ts'), "export async function loadSummary(){return {noteId:null}} export async function editSummary(){} export async function createSummaryNote(){return {noteId:'sum',title:'总结',content:''}}");
fs.writeFileSync(path.join(hostDir, 'mock-sessions.ts'), `
const sessions = new Map();
export function existingLibraryNoteSession(paperId, noteId){ return sessions.get(paperId + ':' + noteId); }
export function acquireLibraryNoteSession(paperId, note, writer, fallback){
  const key = paperId + ':' + (note?.id || 'draft');
  if (sessions.has(key)) return sessions.get(key);
  let snap = { noteId: note?.id || 'draft', title: note?.title || fallback, content: note?.content || '', status: 'saved', error: '' };
  const listeners = new Set();
  let save = writer;
  const emit = () => listeners.forEach((listener) => listener());
  const api = {
    subscribe(cb){ listeners.add(cb); return () => listeners.delete(cb); },
    getSnapshot(){ return snap; },
    setWriter(next){ save = next; },
    update(title, content){ snap = { ...snap, title, content, status: 'dirty' }; emit(); },
    async flush(){ if (snap.status !== 'dirty') return; snap = { ...snap, status: 'saving' }; emit(); await save({ noteId: snap.noteId, title: snap.title, content: snap.content }); snap = { ...snap, status: 'saved' }; emit(); },
    async discard(){},
  };
  sessions.set(key, api);
  return api;
}
`);
fs.writeFileSync(path.join(hostDir, 'host.tsx'), `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownNotePanel } from '/src/features/reader/ReaderMarkdown';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/base.css';
import '/src/ui/styles/reader.css';
const note = { id: 'note-1', title: '阅读笔记', content: '# 阅读笔记\\n\\n先写一句。\\n', updatedAt: new Date().toISOString() };
function App(){
  const [saved, setSaved] = useState(note.content);
  const paper = { paperId: 'paper-a', title: 'Paper', notes: [{ ...note, content: saved }], annotations: [{ id: 'ann-text', type: 'text', page: 2, quote: '样本' }] };
  return <aside className="reader-workspace-drawer notes-active" style={{ width: 420, height: 720, position: 'relative' }}>
    <div className="workspace-panel-content" style={{ height: '100%' }}>
      <MarkdownNotePanel paper={paper} draftPatch={null} onDraftPatchConsumed={() => {}} focusedAnnotationId="ann-text" onSave={async (next) => { setSaved(next.content); }} onCreateNote={async () => 'note-2'} onNavigateAnnotation={() => {}} />
    </div>
  </aside>;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
const errors = [];
let server;
let browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: path.join(hostDir, 'cache'), plugins: [react()], resolve: { alias: [
    { find: path.resolve(root, 'src/platform/library/summaries.ts'), replacement: path.join(hostDir, 'mock-summaries.ts') },
    { find: path.resolve(root, 'src/platform/library/noteDocuments.ts'), replacement: path.join(hostDir, 'mock-sessions.ts') },
  ] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const url = 'http://127.0.0.1:' + server.config.server.port + '/.tmp/reader-note-markdown-browser/index.html';
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  await page.goto(url);
  await page.waitForSelector('.markdown-authoring-dock');
  const labels = await page.locator('.markdown-dock-label').allTextContents();
  for (const label of ['粗体', '标题', '列表', '代码块', '实时']) {
    if (!labels.includes(label)) throw new Error('缺少工具栏按钮 ' + label + ' / ' + labels.join(','));
  }
  const citation = page.locator('.note-citation-insert');
  if (await citation.count() !== 1) throw new Error('缺少引用按钮');
  if ((await citation.innerText()) !== '文本框 · 第 2 页') throw new Error('引用标签不符: ' + await citation.innerText());
  await page.screenshot({ path: path.join(evidence, 'edit-dock.png') });
  await citation.click();
  await page.waitForFunction(() => document.body.innerText.includes('@annotation(ann-text)') || !!document.querySelector('.cm-content')?.textContent?.includes('@annotation(ann-text)'));
  await page.locator('.note-view-switch button[aria-label="阅读模式"]').click();
  await page.waitForSelector('.annotation-reference');
  const rendered = await page.locator('.annotation-reference').innerText();
  if (rendered !== '文本框 · 第 2 页') throw new Error('预览引用不符: ' + rendered);
  await page.screenshot({ path: path.join(evidence, 'read-citation.png') });
  if (errors.length) throw new Error(errors.join('\\n'));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ ok: true, labels, rendered, errors }, null, 2));
  console.log('reader note markdown browser: dock + citation passed');
} finally {
  await browser?.close();
  await server?.close();
}
