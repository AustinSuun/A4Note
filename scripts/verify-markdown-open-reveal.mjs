import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';

// Load the real live-preview module through Vite's SSR loader (dependencies
// stay external, so CodeMirror instances are shared with this script) and
// expose its decoration builder.
const dir = path.resolve('.tmp/markdown-open-reveal');
fs.mkdirSync(dir, { recursive: true });
const editorPath = path.resolve('src/features/explorer/MarkdownLivePreviewEditor.tsx');
const gatePath = path.resolve('src/features/explorer/liveRevealGate.ts');
const hasGate = fs.existsSync(gatePath);
const server = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', appType: 'custom', cacheDir: path.join(dir, 'vite-cache'),
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [react(), { name: 'open-reveal-expose', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('src/features/explorer/MarkdownLivePreviewEditor.tsx')) return null;
    return code + '\nexport { buildLiveDecorations };\n' + (hasGate ? "export * as __gate from './liveRevealGate';\n" : '');
  } }],
});
let mod;
try { mod = await server.ssrLoadModule(editorPath); } finally { await server.close(); }
const { buildLiveDecorations } = mod;
const gate = mod.__gate;

const doc = '# 第一行标题\n\n正文 **粗体** 内容\n\n## 第二节\n';
const bold = doc.indexOf('**粗体**');
const extensions = [markdown(), ...(gate ? [gate.liveRevealArmed] : [])];
// Folded syntax is covered by a *-hidden mark (or a replacing decoration).
const hiddenAt = (state, from, to, measuring) => {
  let hidden = false;
  buildLiveDecorations(state, false, measuring).between(from, to, (start, end, value) => {
    if (start <= from && end >= to && (String(value.spec.class ?? '').includes('hidden') || (value.point && end > start))) hidden = true;
  });
  return hidden;
};
const headingHidden = (state, measuring) => hiddenAt(state, 0, 1, measuring);
const boldHidden = (state) => hiddenAt(state, bold, bold + 2);

const opened = EditorState.create({ doc, extensions });
assert.equal(opened.selection.main.head, 0, 'a newly opened note starts with its caret on line 1');
assert.ok(headingHidden(opened), 'opening a note must not reveal the first-line heading syntax (initial caret is not a user position)');
assert.ok(gate, 'liveRevealGate module provides the reveal state');
const { liveRevealArmed, setLiveRevealArmed, externalDocumentSync } = gate;
assert.equal(opened.field(liveRevealArmed), false);

const clicked = opened.update({ selection: { anchor: 3 }, userEvent: 'select.pointer' }).state;
assert.ok(!headingHidden(clicked), 'clicking the heading reveals its syntax');
const elsewhere = clicked.update({ selection: { anchor: bold + 3 }, userEvent: 'select.pointer' }).state;
assert.ok(headingHidden(elsewhere) && !boldHidden(elsewhere), 'moving to another line folds the heading and reveals that line');

const blurred = clicked.update({ effects: setLiveRevealArmed.of(false) }).state;
assert.ok(headingHidden(blurred), 'focus leaving the editor folds the revealed line');
assert.equal(blurred.selection.main.head, 3, 'folding keeps the caret position');
const keyboard = blurred.update({ selection: { anchor: 1 }, userEvent: 'select' }).state;
assert.ok(!headingHidden(keyboard), 'a keyboard move reveals again');
const typed = opened.update({ changes: { from: 2, insert: '新' }, selection: { anchor: 3 }, userEvent: 'input.type' }).state;
assert.ok(!headingHidden(typed), 'typing reveals');
const jumped = opened.update({ selection: { anchor: doc.indexOf('## 第二节') } }).state;
assert.ok(!hiddenAt(jumped, doc.indexOf('## 第二节'), doc.indexOf('## 第二节') + 2), 'programmatic jumps (TOC/search/scrollToLine) still reveal their target');

const replaced = opened.update({ changes: { from: 0, to: opened.doc.length, insert: '# 另一篇\n\n正文' }, annotations: externalDocumentSync.of(true) }).state;
assert.equal(replaced.field(liveRevealArmed), false, 'host document replacement does not arm the reveal');
assert.ok(headingHidden(replaced));
const reset = clicked.update({ changes: { from: 0, to: clicked.doc.length, insert: '# 另一篇\n\n正文' }, annotations: externalDocumentSync.of(true), effects: setLiveRevealArmed.of(false) }).state;
assert.ok(headingHidden(reset), 'an unfocused editor receiving another note starts folded');

// Measurement passes use explicit states and ignore the caret gate.
assert.ok(!headingHidden(opened, 'source'), 'source measurement always shows syntax');
assert.ok(headingHidden(opened, 'rendered'), 'rendered measurement always hides syntax');
assert.ok(!headingHidden(opened, 1), 'mixed-state measurement reveals at the probed position even before interaction');
// Hosts without the field keep selection-driven reveal.
assert.ok(!headingHidden(EditorState.create({ doc, extensions: [markdown()] })), 'legacy states without the gate keep caret reveal');

const editor = fs.readFileSync(editorPath, 'utf8');
assert.match(editor, /liveRevealGate,\r?\n\s+decorations,/, 'editor installs the gate before its decorations field');
assert.match(editor, /startState\.field\(liveRevealArmed, false\) !== transaction\.state\.field\(liveRevealArmed, false\)/, 'decorations rebuild when the gate changes');
assert.match(editor, /effects: view\.hasFocus \? \[\] : setLiveRevealArmed\.of\(false\)/, 'unfocused document replacement resets the gate');
const gateSource = fs.readFileSync(gatePath, 'utf8');
assert.match(gateSource, /addEventListener\('focusout'/);
assert.match(gateSource, /this\.view\.dom\.contains\(next\)/, 'focus moving inside the editor (image tools, table actions) keeps the reveal');
console.log('PASS markdown open reveal: first-line heading folded on open; click/keyboard/typing/jump reveal; blur folds; external replacement; measuring states; legacy hosts');
