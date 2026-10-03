// Unit regression for the library folder drag rules (task 0d0dbaed):
// persisted sibling order, drag plans (reorder / re-parent / back to top level),
// cycle refusal and the immutable 默认资料库 row — without a browser.
//   node --experimental-strip-types scripts/verify-library-folder-order.mjs
import assert from 'node:assert/strict';
import { buildLibraryFolderTree } from '../src/core/libraryViews.ts';
import { applyLibraryFolderMove, libraryFolderSubtreeIds, orderedLibrarySiblings, planLibraryFolderDrop } from '../src/features/library/folderOrdering.ts';

const ids = (nodes) => nodes.map((node) => node.folderId);
const childIds = (nodes, parentId) => {
  const find = (list) => {
    for (const node of list) { if (node.folderId === parentId) return node; const hit = find(node.children); if (hit) return hit; }
    return null;
  };
  return ids(find(nodes).children);
};

/* 1. Rows that were never dragged keep the historical name order. */
const legacy = [
  { folderId: 'library', name: '默认资料库', parentId: null },
  { folderId: 'b', name: 'Beta', parentId: null },
  { folderId: 'a', name: 'Alpha', parentId: null },
];
assert.deepEqual(ids(buildLibraryFolderTree(legacy)), ['library', 'a', 'b']);
assert.deepEqual(orderedLibrarySiblings(legacy, null), [legacy[0], legacy[2], legacy[1]]);

/* 2. A persisted sortOrder wins, and 默认资料库 stays first regardless of its number. */
const ordered = [
  { folderId: 'library', name: '默认资料库', parentId: null, sortOrder: 0 },
  { folderId: 'a', name: 'Alpha', parentId: null, sortOrder: 2 },
  { folderId: 'b', name: 'Beta', parentId: null, sortOrder: 1 },
];
assert.deepEqual(ids(buildLibraryFolderTree(ordered)), ['library', 'b', 'a']);

/* 3. The acceptance tree: 默认资料库 → CVPR → {核心参考, MeanFlow}, plus a top-level folder. */
const folders = [
  { folderId: 'library', name: '默认资料库', parentId: null, sortOrder: 0 },
  { folderId: 'gen', name: '生成模型', parentId: null, sortOrder: 1 },
  { folderId: 'cvpr', name: 'CVPR', parentId: 'library', sortOrder: 1 },
  { folderId: 'core', name: '核心参考', parentId: 'cvpr', sortOrder: 1 },
  { folderId: 'mf', name: 'MeanFlow', parentId: 'cvpr', sortOrder: 2 },
];
assert.deepEqual(childIds(buildLibraryFolderTree(folders), 'cvpr'), ['core', 'mf'], 'CVPR 仍含 核心参考/MeanFlow');

/* 4. Drop plans: beside a sibling, inside a folder, and onto the blank top-level strip. */
assert.deepEqual(planLibraryFolderDrop(folders, 'gen', { placement: 'before', folderId: 'cvpr' }), { ok: true, plan: { parentId: 'library', index: 0 } });
assert.deepEqual(planLibraryFolderDrop(folders, 'gen', { placement: 'after', folderId: 'cvpr' }), { ok: true, plan: { parentId: 'library', index: 1 } });
assert.deepEqual(planLibraryFolderDrop(folders, 'gen', { placement: 'inside', folderId: 'cvpr' }), { ok: true, plan: { parentId: 'cvpr', index: 2 } });
// index counts 默认资料库 too, so it matches the row the drop lands after.
assert.deepEqual(planLibraryFolderDrop(folders, 'mf', { placement: 'root' }), { ok: true, plan: { parentId: null, index: 2 } });

/* 5. Refusals carry the sentence the sidebar shows. */
assert.equal(planLibraryFolderDrop(folders, 'cvpr', { placement: 'inside', folderId: 'cvpr' }).reason, '不能把文件夹移动到自身。');
assert.equal(planLibraryFolderDrop(folders, 'cvpr', { placement: 'inside', folderId: 'core' }).reason, '不能把文件夹移动到它的子文件夹中。');
assert.equal(planLibraryFolderDrop(folders, 'cvpr', { placement: 'before', folderId: 'mf' }).reason, '不能把文件夹移动到它的子文件夹中。');
assert.equal(planLibraryFolderDrop(folders, 'library', { placement: 'root' }).reason, '「默认资料库」不能移动。');
assert.equal(planLibraryFolderDrop(folders, 'gen', { placement: 'inside', folderId: 'library' }).reason, '「默认资料库」不能作为目标位置。');
assert.equal(planLibraryFolderDrop(folders, 'gen', { placement: 'before', folderId: 'library' }).ok, false, '默认资料库行不接受任何放置');
assert.equal(planLibraryFolderDrop(folders, 'gen', { placement: 'inside', folderId: 'missing' }).ok, false);
assert.deepEqual([...libraryFolderSubtreeIds(folders, 'cvpr')].sort(), ['core', 'cvpr', 'mf']);
assert.deepEqual([...libraryFolderSubtreeIds(folders, 'missing')], ['missing'], '未知文件夹本身也是它的子树');

/* 6. Same-level move: order changes, level and 默认资料库 survive a restart. */
const reordered = applyLibraryFolderMove(folders, 'gen', 'library', 0);
assert.equal(reordered.find((folder) => folder.folderId === 'gen').parentId, 'library');
assert.deepEqual(orderedLibrarySiblings(reordered, 'library').map((folder) => folder.folderId), ['gen', 'cvpr'], '默认资料库的既有子级可以相互排序');
assert.deepEqual(orderedLibrarySiblings(reordered, null).map((folder) => folder.folderId), ['library'], '移入下级后不再出现在顶层');
assert.equal(reordered.find((folder) => folder.folderId === 'library').sortOrder, 0);
assert.deepEqual(childIds(buildLibraryFolderTree(reordered), 'cvpr'), ['core', 'mf'], '排序不得改变已有子级结构');
// Reloading the array the host persisted (a restarted app) keeps the dragged order.
const reloaded = reordered.map((folder) => ({ ...folder }));
assert.deepEqual(orderedLibrarySiblings(reloaded, 'library').map((folder) => folder.folderId), ['gen', 'cvpr']);

/* 7. Re-parent into a folder, then back to the top level. */
const nested = applyLibraryFolderMove(folders, 'gen', 'cvpr', 2);
assert.equal(nested.find((folder) => folder.folderId === 'gen').parentId, 'cvpr');
assert.deepEqual(childIds(buildLibraryFolderTree(nested), 'cvpr'), ['core', 'mf', 'gen']);
const restored = applyLibraryFolderMove(nested, 'gen', null, 1);
assert.equal(restored.find((folder) => folder.folderId === 'gen').parentId, null);
assert.deepEqual(orderedLibrarySiblings(restored, null).map((folder) => folder.folderId), ['library', 'gen']);
assert.deepEqual(childIds(buildLibraryFolderTree(restored), 'cvpr'), ['core', 'mf']);

/* 8. Refused moves and the immutable root never mutate the input. */
assert.equal(applyLibraryFolderMove(folders, 'library', null, 0), folders);
assert.equal(applyLibraryFolderMove(folders, 'missing', null, 0), folders);
assert.deepEqual(folders.map((folder) => folder.parentId), [null, null, 'library', 'cvpr', 'cvpr']);

/* 9. A duplicate name at the destination is refused before the IPC round trip. */
const duplicate = [...folders, { folderId: 'gen-2', name: '生成模型', parentId: 'cvpr', sortOrder: 3 }];
assert.equal(planLibraryFolderDrop(duplicate, 'gen-2', { placement: 'root' }).reason, '目标位置存在同名文件夹。');

console.log('library folder order: 9 groups passed (order, drag plans, refusals, restart, structure)');
