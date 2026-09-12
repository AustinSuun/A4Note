import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NoteDocumentSession } from '../src/core/noteDocumentSession.ts';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise((r) => setTimeout(r,0));
let cases=0;
async function test(name,run) { await run(); console.log('PASS',name); cases++; }
await test('single drain, latest edit, fixed new-note ID, advancing expected baseline',async()=>{
 const calls=[];const first=deferred();const drafts=[];
 const session=new NoteDocumentSession('paper-a','note-fixed','Title','baseline',async(note)=>{calls.push(note);if(calls.length===1) await first.promise;return note.noteId;},s=>drafts.push(s));
 session.update('Title','one');const a=session.flush();const b=session.flush();await tick();assert.equal(calls.length,1);
 session.update('Title two','two');const c=session.flush();first.resolve();await Promise.all([a,b,c]);
 assert.deepEqual(calls.map(x=>[x.noteId,x.content]),[['note-fixed','one'],['note-fixed','two']]);
 assert.deepEqual(calls[1].expected,{title:'Title',content:'one'});assert.equal(session.dirty(),false);assert.equal(session.getSnapshot().status,'saved');assert.equal(drafts.at(-1).baselineContent,'two');
 await session.flush();assert.equal(calls.length,2);
});
await test('failed save retains buffer + baseline, retry never invents another ID',async()=>{
 let fail=true;const calls=[];const s=new NoteDocumentSession('p','n','T','old',async n=>{calls.push(n);if(fail)throw Error('disk busy');return n.noteId;},()=>{});
 s.update('T','unsaved');await assert.rejects(s.flush(),/disk busy/);assert.equal(s.getSnapshot().content,'unsaved');assert.equal(s.getSnapshot().baselineContent,'old');assert.equal(s.getSnapshot().status,'error');
 fail=false;await s.flush();assert.equal(s.dirty(),false);assert.equal(calls.length,2);assert.equal(calls[1].noteId,'n');
});
await test('reverting during a pending write still blocks close and drains the revert',async()=>{
 const pending=deferred();const calls=[];const s=new NoteDocumentSession('p','n','T','original',async n=>{calls.push(n.content);if(calls.length===1)await pending.promise;},()=>{});
 s.update('T','new');const flush=s.flush();await tick();s.update('T','original');assert.equal(s.dirty(),false);assert.equal(s.pending(),true);pending.resolve();await flush;assert.deepEqual(calls,['new','original']);assert.equal(s.pending(),false);
});
await test('recovered draft keeps original expected content for conflict detection',async()=>{
 const calls=[];const s=new NoteDocumentSession('p','n','T','external edit',async n=>{calls.push(n);throw Error('conflict');},()=>{});
 s.recover({title:'T',content:'local draft',baselineTitle:'T',baselineContent:'original'});assert.equal(s.getSnapshot().status,'error');assert.equal(calls.length,0);
 await assert.rejects(s.flush(),/conflict/);assert.equal(calls[0].expected.content,'original');assert.equal(s.getSnapshot().content,'local draft');
});
await test('cache quota failure does not prevent database save',async()=>{
 let writes=0;const s=new NoteDocumentSession('p','n','T','old',()=>{writes++;},()=>{throw Error('quota');});s.update('T','new');assert.match(s.getSnapshot().error,/草稿缓存不可用/);await s.flush();assert.equal(writes,1);assert.equal(s.dirty(),false);
});
await test('paper sessions never share in-flight completion or buffers',async()=>{
 const pending=deferred();const a=new NoteDocumentSession('a','na','A','old-a',async()=>{await pending.promise;},()=>{});
 const b=new NoteDocumentSession('b','nb','B','old-b',()=>{},()=>{});a.update('A','new-a');const flush=a.flush();b.update('B','new-b');pending.resolve();await flush;assert.equal(b.getSnapshot().content,'new-b');assert.equal(b.getSnapshot().baselineContent,'old-b');assert.equal(b.dirty(),true);
});
await test('unexpected returned identity never marks the draft saved',async()=>{
 const s=new NoteDocumentSession('p','n','T','old',async()=> 'wrong-id',()=>{});s.update('T','new');await assert.rejects(s.flush(),/不同的笔记ID/);assert.equal(s.dirty(),true);assert.equal(s.getSnapshot().noteId,'n');
});
await test('explicit discard releases failed draft without writing over the database',async()=>{
 let writes=0;const drafts=[];const s=new NoteDocumentSession('p','n','T','baseline',async()=>{writes++;throw Error('conflict');},d=>drafts.push(d));
 s.update('T','failed');await assert.rejects(s.flush());await s.discard();assert.equal(s.dirty(),false);assert.equal(s.getSnapshot().content,'baseline');assert.equal(writes,1);assert.equal(drafts.at(-1).content,'baseline');
});
await test('discard refuses to drop edits made while waiting for a write',async()=>{
 const wait=deferred();const s=new NoteDocumentSession('p','n','T','baseline',()=>wait.promise,()=>{});
 s.update('T','first');const flush=s.flush();await tick();const discard=s.discard();s.update('T','second');wait.reject(Error('write failed'));
 await assert.rejects(flush);await assert.rejects(discard,/新编辑/);assert.equal(s.getSnapshot().content,'second');assert.equal(s.dirty(),true);
});
// Boundary coverage supplements (does not replace) native filesystem and UI tests.
await test('every library command is inside the maintenance boundary',async()=>{
 for(const name of ['app_paths','diagnostics','library_ai','library_annotations','library_import','library_notes','library_papers','library_state','resource_annotations','state_commands','sync_commands']) {
  const source=await readFile(`src-tauri/src/${name}.rs`,'utf8');const commands=[...source.matchAll(/#\[tauri::command(?:\(async\))?\]\s*pub(?:\(crate\))? fn \w+\([^}]*?\) -> Result<[^{}]*?> \{([^\n]*\n[^\n]*)/g)];
  assert.ok(commands.length, name);for(const command of commands) assert.match(command[1],/library_access::operation\(\)\?/,name);
 }
 const backup=await readFile('src-tauri/src/backup.rs','utf8');assert.match(backup,/Backup::new/);assert.match(backup,/require_restart\(\)/);assert.match(backup,/recover_interrupted_restore/);
 const app=await readFile('src/ui/App.tsx','utf8');assert.match(app,/await flushPendingSaves\(\);\s*const result = await restoreLibraryBackup/);assert.match(app,/setRestoreRestartPath\(result.safety_backup_path\)/);
 const pdf=await readFile('src/features/reader/pdf/PdfReader.tsx','utf8');assert.match(pdf,/cancelled = true;\s*disposeLoadingTask\(\)/);
});
console.log(`Reliability verification: ${cases} cases passed`);
