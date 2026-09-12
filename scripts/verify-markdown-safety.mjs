import { commitMarkdownTitle } from '../src/core/markdownTitleEdit.ts';
// Header rename must also invalidate the sidebar listing, not only the tab URI.
assert.match(readFileSync('src/ui/App.tsx', 'utf8'), /onRenamed: \(tabId, file\) => \{[\s\S]*?setMarkdownTreeRevision\(\(current\) => current \+ 1\)/);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { splitFrontmatter, replaceMarkdownBody, replaceMarkdownLiveBody, replaceMarkdownTitle, updateMarkdownProperties, titleFromBody, stripDocumentTitle } from '../src/core/markdownDocument.ts';
import { TextDocumentSession } from '../src/core/textDocumentSession.ts';
import { resolveWikiLink } from '../src/core/wikiLinks.ts';

const original = '\uFEFF---\r\n# retain comment\r\ntitle: "Old"\r\nnested:\r\n  custom: [a, b]\r\nsummary: |\r\n  first\r\n  second\r\ntags: [one, two]\r\n---\r\n\r\n# Document\r\n\r\nBody\r\n\r\n\r\n';
const split = splitFrontmatter(original);
assert.equal(split.body, '\r\n# Document\r\n\r\nBody\r\n\r\n\r\n');
assert.equal(split.properties.summary, 'first\nsecond\n');
assert.equal(replaceMarkdownBody(original, split.body), original);
assert.equal(replaceMarkdownLiveBody(original, stripDocumentTitle(split.body)), original);
assert.equal(replaceMarkdownLiveBody('plain\n\n\n', 'edited\n\n\n'), 'edited\n\n\n');
assert.equal(replaceMarkdownBody('\uFEFFplain\r\n', 'edit\n'), '\uFEFFedit\r\n');
assert.equal(titleFromBody('text\n# Later'), '');
assert.equal(splitFrontmatter('---\n---\nbody').body, 'body');
assert.equal(replaceMarkdownBody('---\n---\nbody', 'edit'), '---\n---\nedit');
assert.equal(splitFrontmatter('***\r\n***\r\nbody').body, 'body');
assert.equal(stripDocumentTitle('# Title\n\nbody\n\n# Title'), 'body\n\n# Title');
assert.equal(replaceMarkdownTitle('body', 'New $1'), '# New $1\n\nbody');
assert.equal(replaceMarkdownTitle('# Old\r\n\r\nbody', 'New $1'), '# New $1\r\n\r\nbody');
const edited = replaceMarkdownLiveBody(original, 'Edited\n\n\n');
assert.ok(edited.startsWith(original.slice(0, original.indexOf('Body'))));
assert.ok(edited.endsWith('Edited\r\n\r\n\r\n'));
const propertiesEdited = updateMarkdownProperties(original, { ...split.properties, title: 'New', enabled: true });
assert.ok(propertiesEdited.includes('# retain comment'));
const yamlText = propertiesEdited.replace(/^\uFEFF/, '').split('---')[1];
assert.deepEqual(parse(yamlText).nested, { custom: ['a', 'b'] });
assert.equal(parse(yamlText).summary, 'first\nsecond\n');
assert.equal(parse(yamlText).title, 'New');
assert.ok(propertiesEdited.endsWith(split.body));
assert.throws(() => updateMarkdownProperties('---\na: [\n---\nbody', { x: 1 }));
assert.throws(() => updateMarkdownProperties(original, { ...split.properties, nested: 'oops' }));
assert.equal(replaceMarkdownBody('---\na: [\n---\nbody', 'changed'), '---\na: [\n---\nchanged');

let disk = 'old'; let writes = []; let release;
const adapter = { draft() {}, async write(path, content, expected) {
  writes.push({ path, content, expected });
  if (writes.length === 1) await new Promise((resolve) => { release = resolve; });
  assert.equal(expected, disk); disk = content;
} };
const session = new TextDocumentSession('/note.md', disk, adapter);
await session.flush(); assert.equal(writes.length, 0, 'opening an unchanged file must not save');
session.update('first'); const pending = session.flush(); session.update('second'); const duplicate = session.flush();
release(); await Promise.all([pending, duplicate]);
assert.equal(disk, 'second'); assert.deepEqual(writes.map((write) => write.expected), ['old', 'first']);
assert.equal(session.getSnapshot().status, 'saved');
await session.pause(); session.update('after rename'); session.resume('/renamed.md'); await session.flush();
assert.equal(writes.at(-1).path, '/renamed.md');
let fail = true;
const conflicted = new TextDocumentSession('/conflict.md', 'original', { draft() {}, async write() { if (fail) throw new Error('conflict'); } });
conflicted.update('local draft'); await assert.rejects(conflicted.flush());
assert.equal(conflicted.getSnapshot().content, 'local draft'); assert.equal(conflicted.getSnapshot().baseline, 'original'); assert.equal(conflicted.getSnapshot().status, 'error');
await conflicted.settle(); conflicted.reload('external'); assert.equal(conflicted.dirty(), false);
fail = false; conflicted.update('merged'); await conflicted.flush(); assert.equal(conflicted.getSnapshot().status, 'saved');

const entry = (path, directory = false) => ({ path, name: path.split('/').at(-1), is_directory: directory, extension: directory ? '' : path.split('.').at(-1) });
const tree = new Map([
 ['/vault', [entry('/vault/start.md'), entry('/vault/root.md'), entry('/vault/sub', true), entry('/vault/other', true)]],
 ['/vault/sub', [entry('/vault/sub/deep.md'), entry('/vault/sub/local.md')]],
 ['/vault/other', [entry('/vault/other/local.md')]],
]);
const list = async (path) => { if (!tree.has(path)) throw new Error('目录不存在'); return { entries: tree.get(path), truncated: false }; };
assert.equal((await resolveWikiLink('/vault', '/vault/start.md', 'deep', list)).path, '/vault/sub/deep.md');
assert.equal((await resolveWikiLink('/vault', '/vault/sub/deep.md', 'local', list)).path, '/vault/sub/local.md');
assert.equal((await resolveWikiLink('/vault', '/vault/sub/deep.md', '../root', list)).path, '/vault/root.md');
assert.equal((await resolveWikiLink('/vault', '/vault/start.md', 'sub/deep.md', list)).path, '/vault/sub/deep.md');
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', 'local', list), /同名/);
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', '../../outside', list));
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', 'https://example.com', list));
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', 'deep#heading', list), /尚未支持/);
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', 'absent', list), /未找到/);
await assert.rejects(resolveWikiLink('/vault', '/vault/start.md', 'deep', async () => ({ entries: [], truncated: true })), /过多/);
const windowsList = async () => ({ entries: [entry('D:/Notes/中文.md')], truncated: false });
assert.equal((await resolveWikiLink('D:\\Notes', 'D:\\Notes\\start.md', '中文', windowsList)).name, '中文.md');

const editor = readFileSync('src/features/explorer/MarkdownResourceTab.tsx', 'utf8');
assert.doesNotMatch(editor, /ensureDocumentHeading|renameTextFile|writeTextFile/);
assert.match(editor, /replaceMarkdownLiveBody/);
assert.match(editor, /onOpenWikiLink=\{openWikiLink\}/);
assert.match(readFileSync('src/features/markdown/contributions.tsx', 'utf8'), /onOpenWikiLink=/);
assert.match(readFileSync('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8'), /onOpenWikiLinkRef\.current\(wiki\[1\]\.trim\(\)\)/);
assert.match(readFileSync('src/platform/projects/textDocuments.ts', 'utf8'), /expected_content: expected/);
console.log('Markdown safety verification passed (lossless content, YAML, queued writes, conflicts, rename, wiki navigation and wiring)');

assert.match(readFileSync('src-tauri/capabilities/default.json', 'utf8'), /core:window:allow-destroy/);

// Title draft commits: real session + controlled rename/filesystem callbacks.
{
 const original = '# Old\n\nBody\n'; let disk = original; let renames = 0; let notified = 0;
 const session = new TextDocumentSession('/Old.md', disk, { draft() {}, async write(path, content, expected) {
   assert.equal(expected, disk); assert.equal(path, session.getSnapshot().path); disk = content;
 } });
 const base = { session, file: {path:'/Old.md',name:'Old.md'}, original:'Old', onRenamed(){notified++;},
   async rename(path, stem){renames++; assert.equal(path,'/Old.md');session.resume('/'+stem+'.md');return {path:'/'+stem+'.md',name:stem+'.md'};} };
 await commitMarkdownTitle({...base,draft:''}); await commitMarkdownTitle({...base,draft:'   '});
 assert.equal(disk,original);assert.equal(renames,0);
 await commitMarkdownTitle({...base,draft:'Old'});assert.equal(renames,0);
 await assert.rejects(commitMarkdownTitle({...base,draft:'bad/name'}));assert.equal(disk,original);
 await assert.rejects(commitMarkdownTitle({...base,draft:'Taken',rename:async()=>{throw Error('exists');}}),/exists/);
 assert.equal(disk,original);assert.equal(session.getSnapshot().content,original);assert.equal(notified,0);
 await commitMarkdownTitle({...base,draft:'  中文新标题  '});
 assert.equal(disk,'# 中文新标题\n\nBody\n');assert.equal(session.getSnapshot().path,'/中文新标题.md');assert.equal(notified,1);
 await assert.rejects(commitMarkdownTitle({...base,draft:'Stale'}),/路径/);
}
{
 let release;let renames=0;let notified=0;
 const session=new TextDocumentSession('/Old.md','# Old\n\nBody',{draft(){},async write(){}});
 const opts={session,file:{path:'/Old.md',name:'Old.md'},original:'Old',draft:'New',
   rename:async()=>{renames++;await new Promise(r=>{release=r;});session.resume('/New.md');return {path:'/New.md',name:'New.md'};},onRenamed(){notified++;}};
 const pending=commitMarkdownTitle(opts);
 await assert.rejects(commitMarkdownTitle(opts),/正在保存/);
 session.update('# Old\n\nNew body while renaming');release();await pending;
 assert.equal(session.getSnapshot().content,'# New\n\nNew body while renaming');assert.equal(renames,1);assert.equal(notified,1);
}
{
 let notified=0;
 const session=new TextDocumentSession('/Old.md','# Old\n\nBody',{draft(){},async write(){throw Error('disk full');}});
 await assert.rejects(commitMarkdownTitle({session,file:{path:'/Old.md',name:'Old.md'},original:'Old',draft:'New',
   rename:async()=>{session.resume('/New.md');return {path:'/New.md',name:'New.md'};},onRenamed(){notified++;}}),/disk full/);
 assert.equal(notified,1);assert.equal(session.getSnapshot().path,'/New.md');assert.equal(session.getSnapshot().status,'error');
 assert.equal(session.getSnapshot().content,'# New\n\nBody');
}
{
 const session=new TextDocumentSession('/总结.md','# Old\n\nBody',{draft(){},async write(){}});
 await commitMarkdownTitle({session,file:{path:'/总结.md',name:'总结.md'},original:'Old',draft:'Summary'});
 assert.equal(session.getSnapshot().path,'/总结.md');assert.equal(session.getSnapshot().content,'# Summary\n\nBody');
 await assert.rejects(commitMarkdownTitle({session,file:{path:'/总结.md',name:'总结.md'},original:'Old',draft:'Stale'}),/其他视图/);
}
console.log('Markdown title commit safety passed (empty/no-op/invalid/collision/sync/stale/concurrent/body edits/save failure/managed path).');
