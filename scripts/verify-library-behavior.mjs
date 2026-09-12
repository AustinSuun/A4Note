import { toggleTreeExpansion } from '../src/core/treeExpansion.ts';
import { treeGuideRails } from '../src/shared/tree/treeGeometry.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLibraryFolderTree, selectLibraryView, isLibrarySmartView } from '../src/core/libraryViews.ts';
import { nativePaperToDocument } from '../src/platform/nativeApi.ts';

const paper = (id, extra = {}) => ({ paperId: id, title: id, folderId: 'library', tags: [], isRead: false, isFavorite: false, ...extra });
const papers = [
  paper('a', { createdAt: '2026-09-01T00:00:00Z', lastViewedAt: '2026-09-05T00:00:00Z', isRead: true }),
  paper('b', { createdAt: '2026-09-02T00:00:00Z', lastViewedAt: '2026-09-06T00:00:00Z', isFavorite: true, folderId: 'child' }),
  paper('c', { createdAt: 'invalid', lastViewedAt: '' }),
];
const ids = (view) => selectLibraryView(papers, view).map((item) => item.paperId);
assert.deepEqual(ids('all'), ['a','b','c']);
assert.deepEqual(ids('unread'), ['b','c']); assert.deepEqual(ids('favorites'), ['b']);
assert.deepEqual(ids('recently-viewed'), ['b','a']); assert.deepEqual(ids('recently-imported'), ['b','a']);
assert.deepEqual(ids('library'), ['a','c']); assert.deepEqual(ids('child'), ['b']);
assert.deepEqual(papers.map((item) => item.paperId), ['a','b','c'], 'sorting must not mutate the document store');
for (const id of ['all','unread','favorites','recently-viewed','recently-imported']) assert.ok(isLibrarySmartView(id));
assert.ok(!isLibrarySmartView('child'));
const many = Array.from({length: 60}, (_, index) => paper(String(index), { createdAt: new Date(index * 1000).toISOString() }));
assert.equal(selectLibraryView(many, 'recently-imported').length, 50);
assert.equal(selectLibraryView(many, 'recently-imported')[0].paperId, '59');
const folders = [
 {folderId:'library', name:'Root', parentId:null}, {folderId:'top', name:'Top', parentId:'library'},
 {folderId:'child', name:'Child', parentId:'top'}, {folderId:'orphan', name:'Orphan', parentId:'missing'},
];
const tree = buildLibraryFolderTree(folders);
assert.equal(tree[0].folderId, 'library'); assert.equal(tree[0].children[0].folderId, 'top');
assert.equal(tree[0].children[0].children[0].folderId, 'child'); assert.equal(tree[1].folderId, 'orphan');
assert.equal(buildLibraryFolderTree([])[0].folderId, 'library');
const cyclic = buildLibraryFolderTree([{folderId:'a', name:'A', parentId:'b'}, {folderId:'b', name:'B', parentId:'a'}]);
assert.equal(cyclic.length, 3, 'cycles must remain visible without recursive rendering loops');
assert.equal(folders[1].parentId, 'library');
const native = {paper_id:'native', title:'Title', authors:'Author', year:2025, venue:'Venue', doi:'', source_file_id:null, source_pdf:null, translated_file_ids:[], translated_pdfs:[], tags:[], notes:[], annotations:[], ai_threads:[], created_at:123, last_viewed_at:456, is_read:true, is_favorite:true};
const mapped = nativePaperToDocument(native);
assert.equal(mapped.createdAt, new Date(123).toISOString()); assert.equal(mapped.lastViewedAt, new Date(456).toISOString());
assert.equal(mapped.isRead, true); assert.equal(mapped.isFavorite, true);
const legacy = nativePaperToDocument({...native, created_at:undefined, last_viewed_at:null, is_read:undefined, is_favorite:undefined});
assert.equal(legacy.lastViewedAt, undefined); assert.equal(legacy.isRead, false); assert.equal(legacy.isFavorite, false);
const app = readFileSync('src/ui/App.tsx', 'utf8');
assert.match(app, /!isLibrarySmartView\(activeFolderId\)/);
assert.match(app, /selectLibraryView\(aster\.documents\.list\(\), activeFolderId\)/);
assert.match(app, /paperState\.update\(paperId, 'viewed'\)/);
assert.match(app, /stateBusy: selectedPaper \? paperState\.busyIds\.has/);
const sidebar = readFileSync('src/features/library/LibrarySceneSidebar.tsx', 'utf8') + '\n' + readFileSync('src/shared/tree/FolderDraftRow.tsx', 'utf8');
assert.match(sidebar, /expanded && <div role="group">\{folder\.children\.map/); assert.match(sidebar, /onToggleExpanded/);
assert.doesNotMatch(sidebar, /folderTree\.filter\(.*folderId !== 'library'/);
assert.match(sidebar, /menu\.remove\(\)/);
assert.match(readFileSync('src/shared/hooks/usePersistedUiState.ts', 'utf8'), /sort\.key === 'lastViewedAt'/);
// Inline creation belongs to the target tree node, never the section header.
const header = sidebar.slice(sidebar.indexOf('<section className="library-sidebar-section library-sidebar-folders"'), sidebar.indexOf('<nav ref={treeRef}'));
assert.doesNotMatch(header, /<form|data-library-folder-draft-input/);
assert.match(sidebar, /hasDraft && creation && <NewFolderTreeRow[^\n]+depth=\{depth \+ 1\}/);
assert.match(sidebar, /creation=\{creation\}[^\n]+onSelectFolder/);
assert.match(sidebar, /data-library-folder-draft-parent=\{creation.parentId\}/);
assert.match(sidebar, /setExpandedIds\(\(current\) => Array.from\(new Set\(\[...current, ...path\]\)\)\)/);
assert.match(sidebar, /onCreateSubfolder=\{startNewFolder\}/);
assert.match(sidebar, /startNewFolder\('library'\)/);
assert.match(sidebar, /if \(folderSavingRef.current \|\| newFolderParentId === null\) return/);
assert.match(sidebar, /await onCreateFolder\(name, parentId\)/);
assert.match(sidebar, /composingRef.current \|\| event.nativeEvent.isComposing \|\| event.keyCode === 229/);
assert.match(sidebar, /event.key === 'Escape'.*creation.onCancel\(\)/);
assert.match(sidebar, /creation.error && <span[^\n]+role="alert"/);
assert.match(sidebar, /folder.folderId === 'library' \? '' : `<button/);
const workbenchCss = readFileSync('src/ui/styles/workbench.css', 'utf8');
assert.match(workbenchCss, /\.library-folder-draft-row input \{[^}]+min-width: 0/);
assert.match(workbenchCss, /\.library-folder-draft-spacer \{ flex: 0 0 26px/);
console.log('Library behavior verification passed (smart views, chronology, folders, cycles, native state mapping, inline folder creation and wiring)');

// Shared expansion behavior: exact category IDs, optional normalized filesystem paths.
assert.deepEqual(toggleTreeExpansion(['root','child'],'root'),['child']);
assert.deepEqual(toggleTreeExpansion(['child'],'root'),['child','root']);
assert.deepEqual(toggleTreeExpansion(['root','child'],'root',undefined,['root']),['root','child']);
assert.deepEqual(toggleTreeExpansion(['A'],'a'),['A','a']);
assert.deepEqual(toggleTreeExpansion(['C:/Notes'],'c:/notes',x=>x.toLowerCase()),[]);
const rows=[
 {id:'root',depth:0,expanded:true,top:0,bottom:30,caretCenter:16},
 {id:'branch',depth:1,expanded:true,top:31,bottom:61,caretCenter:36},
 {id:'leaf',depth:2,expanded:false,top:62,bottom:92,caretCenter:56},
 {id:'sibling',depth:1,expanded:false,top:93,bottom:123,caretCenter:36},
 {id:'otherRoot',depth:0,expanded:false,top:124,bottom:154,caretCenter:16},
];
const rails=treeGuideRails(rows);
assert.deepEqual(rails.find(r=>r.id==='root'),{id:'root',depth:0,top:33,height:87,left:16,start:0,end:3});
assert.equal(rails.find(r=>r.id==='branch').end,2);
assert.equal(rails.find(r=>r.id==='branch').left,36);
assert.equal(treeGuideRails([{...rows[0],expanded:false},rows[4]]).length,0);
assert.equal(treeGuideRails([{...rows[0],expanded:true}]).length,0,'empty branches have no phantom rail');
const newDraft={id:'draft',depth:2,expanded:false,top:62,bottom:140,caretCenter:56};
assert.equal(treeGuideRails(rows.slice(0,2).concat(newDraft)).find(r=>r.id==='root').height,104,'variable-height draft participates in the parent rail');
assert.match(sidebar,/TreeGuides containerRef=\{treeRef\}/);
assert.match(sidebar,/toggleTreeExpansion\(current, id, undefined, protectedIds\)/);
assert.match(sidebar,/onClick=\{toggleAll\}/);
assert.match(sidebar,/onKeyDown=\{event => onNavigate/);
const markdownTree=readFileSync('src/features/explorer/FileTreePanel.tsx','utf8');
assert.match(markdownTree,/TreeGuides containerRef=\{treeContentRef\}/);
assert.match(markdownTree,/toggleTreeExpansion\(current, entry.path, normalizePath\)/);
console.log('Shared tree guide geometry, editor protection, expansion and both adapters passed');
