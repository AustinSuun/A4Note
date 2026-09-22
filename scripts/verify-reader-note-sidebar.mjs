import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const markdown = read('src/features/reader/ReaderMarkdown.tsx');
const drawer = read('src/features/reader/ReaderSideDrawer.tsx');
const css = read('src/ui/styles/reader.css');
const retained = read('src/features/reader/ReaderNoteActivity.tsx');

const checks = [
  ['notes drawer removes the redundant workspace tab row from DOM', /\{!notesActive && <header className="reader-workspace-header">/.test(drawer)],
  ['notes drawer collapses to one content grid row', /\.reader-workspace-drawer\.notes-active\s*\{[^}]*grid-template-rows:minmax\(0,1fr\)/s.test(css)],
  ['document title is a popup trigger rather than an editable title input', /className=\{historyOpen \? 'note-document-trigger active'/.test(markdown) && !/<input\s+className="note-title-input"/.test(markdown)],
  ['picker exposes listbox semantics', /aria-haspopup="listbox"/.test(markdown) && /role="listbox"/.test(markdown) && /role="option"/.test(markdown)],
  ['picker restores trigger focus on Escape', /closeHistory\(true\)/.test(markdown) && /historyTriggerRef\.current\?\.focus/.test(markdown)],
  ['picker supports arrows plus Home and End', /ArrowDown/.test(markdown) && /ArrowUp/.test(markdown) && /Home/.test(markdown) && /End/.test(markdown)],
  ['new document is inside the picker, not a header icon', /note-history-actions[\s\S]*新建文档/.test(markdown) && !/className="note-icon-button" onClick=\{\(\) => void createNote/.test(markdown)],
  ['rename remains reachable through the unified picker', /重命名当前文档/.test(markdown) && /renameCurrent/.test(markdown)],
  ['summary remains reachable through the unified picker', /note-history-actions[\s\S]*打开总览笔记/.test(markdown)],
  ['redundant Markdown status row is absent from component DOM', !/className="note-meta-row"/.test(markdown) && !/Markdown · 普通笔记/.test(markdown)],
  ['switching flushes pending content before changing sessions', /await session\.flush\(\);[\s\S]*setSession\(acquireLibraryNoteSession/.test(markdown)],
  ['switch/create guard prevents duplicate asynchronous actions', /switchingRef\.current/.test(markdown) && /if \(switchingRef\.current\) return/.test(markdown)],
  ['editor still uses the shared MarkdownLiveEditor', /<MarkdownLiveEditor/.test(markdown)],
  ['annotation reference navigation remains wired', /renderMarkdownWithAnnotationRefs\(content, paper, onNavigateAnnotation\)/.test(markdown)],
  ['retained reader focus fallback targets the new document trigger', /\.note-document-trigger, button/.test(retained)],
  ['picker styles use shared theme tokens and reduced motion', /background:var\(--surface\)/.test(css) && /prefers-reduced-motion:reduce/.test(css)],
];

for (const [name, ok] of checks) assert.ok(ok, name);
console.log(`reader note sidebar checks passed: ${checks.length}/${checks.length}`);
