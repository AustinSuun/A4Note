import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
const root = process.cwd();
await fs.mkdir('.tmp', { recursive: true });
const dir = await fs.mkdtemp(path.join(root, '.tmp', 'selection-policy-'));
try {
 const source = await fs.readFile('src/features/explorer/markdownSelectionPolicy.ts', 'utf8');
 await fs.writeFile(path.join(dir, 'policy.mjs'), source);
 const { markdownSingleSelection } = await import(pathToFileURL(path.join(dir, 'policy.mjs')).href);
 const baseline=EditorState.create({doc:'alpha beta gamma',extensions:[basicSetup]});
 assert.equal(baseline.facet(EditorState.allowMultipleSelections),true);
 let state=EditorState.create({doc:'alpha beta gamma',extensions:[basicSetup,markdownSingleSelection]});
 assert.equal(state.selection.ranges.length,1);
 for(const event of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true}]) {
   assert(state.facet(EditorView.clickAddsSelectionRange).every(test=>!test(event)));
 }
 state=state.update({selection:EditorSelection.create([EditorSelection.cursor(2),EditorSelection.cursor(8)],1)}).state;
 assert.equal(state.selection.ranges.length,1);assert.equal(state.selection.main.head,8);
 state=state.update(state.replaceSelection('X')).state;
 assert.equal(state.doc.toString(),'alpha beXta gamma');
 state=state.update({selection:{anchor:0,head:5}}).state;
 assert.equal(state.selection.main.from,0);assert.equal(state.selection.main.to,5);
 const editor=await fs.readFile('src/features/explorer/MarkdownLivePreviewEditor.tsx','utf8');
 assert.match(editor,/basicSetup,\s*markdownSingleSelection,/);
 const plugin=await fs.readFile('src/core/markdownPlugin.ts','utf8');
 assert.match(plugin,/id: 'markdown.documentLayout',\s*title: '正文宽度',\s*defaultValue: 'narrow'/);
 const settings=await fs.readFile('src/features/settings/index.tsx','utf8');
 assert.match(settings,/export const defaultSettings:[^\n]*documentLayout: 'narrow'/);
 console.log('Single-caret policy/default width tests passed; baseline reproduces multiple-selection enablement.');
} finally { await fs.rm(dir,{recursive:true,force:true}); }
