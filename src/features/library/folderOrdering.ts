/** Folder drag semantics for the library sidebar (task 0d0dbaed).
 *
 * Everything that decides whether a drop is legal lives here, so the sidebar only
 * renders the plan and the host only persists it. No DOM and no platform access:
 * the rules stay unit-testable and identical in web and Tauri builds.
 */
import type { LibraryFolder } from '../../core/types';

export const LIBRARY_ROOT_FOLDER_ID = 'library';
/** Custom drag type: papers use application/x-a4note-paper-ids, folders use this. */
export const LIBRARY_FOLDER_DRAG_TYPE = 'application/x-a4note-folder-id';
export type LibraryFolderDropPlacement = 'before' | 'inside' | 'after';
export type LibraryFolderDrop =
  | { placement: LibraryFolderDropPlacement; folderId: string }
  /** The blank strip below the tree: move back to the top level, next to 默认资料库. */
  | { placement: 'root' };
export type LibraryFolderDropPlan = { parentId: string | null; index: number };
export type LibraryFolderDropResult = { ok: true; plan: LibraryFolderDropPlan } | { ok: false; reason: string };

/** `folderId`, itself and every descendant, without looping on broken ancestry. */
export function libraryFolderSubtreeIds(folders: LibraryFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parentId || ids.has(folder.folderId) || !ids.has(folder.parentId)) continue;
      ids.add(folder.folderId);
      changed = true;
    }
  }
  return ids;
}

/** Siblings of one level, in the order the sidebar renders them. */
export function orderedLibrarySiblings(folders: LibraryFolder[], parentId: string | null, excludeFolderId?: string): LibraryFolder[] {
  const siblings = folders.filter((folder) => (folder.parentId ?? null) === parentId && folder.folderId !== excludeFolderId);
  const byOrder = siblings.some((folder) => folder.folderId !== LIBRARY_ROOT_FOLDER_ID && Number.isFinite(folder.sortOrder));
  return [...siblings].sort((a, b) => {
    if (a.folderId === LIBRARY_ROOT_FOLDER_ID) return -1;
    if (b.folderId === LIBRARY_ROOT_FOLDER_ID) return 1;
    if (byOrder) {
      const order = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (order) return order;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

/**
 * Resolve one drop intent for `movingId`. Returns the reason to show when the drop
 * is refused (self, own descendant, the immutable root, or a duplicate name), so the
 * sidebar never has to duplicate these rules to explain itself.
 */
export function planLibraryFolderDrop(folders: LibraryFolder[], movingId: string, drop: LibraryFolderDrop): LibraryFolderDropResult {
  const moving = folders.find((folder) => folder.folderId === movingId);
  if (!moving) return { ok: false, reason: '文件夹不存在，请刷新后重试。' };
  if (movingId === LIBRARY_ROOT_FOLDER_ID) return { ok: false, reason: '「默认资料库」不能移动。' };
  if (drop.placement === 'root') {
    const conflict = duplicateNameAt(folders, moving, null, movingId);
    if (conflict) return { ok: false, reason: conflict };
    return { ok: true, plan: { parentId: null, index: orderedLibrarySiblings(folders, null, movingId).length } };
  }
  const target = folders.find((folder) => folder.folderId === drop.folderId);
  if (!target) return { ok: false, reason: '目标文件夹不存在，请刷新后重试。' };
  if (target.folderId === movingId) return { ok: false, reason: '不能把文件夹移动到自身。' };
  if (target.folderId === LIBRARY_ROOT_FOLDER_ID) return { ok: false, reason: '「默认资料库」不能作为目标位置。' };
  if (libraryFolderSubtreeIds(folders, movingId).has(target.folderId)) return { ok: false, reason: '不能把文件夹移动到它的子文件夹中。' };
  if (drop.placement === 'inside') {
    const conflict = duplicateNameAt(folders, moving, target.folderId, movingId);
    if (conflict) return { ok: false, reason: conflict };
    return { ok: true, plan: { parentId: target.folderId, index: orderedLibrarySiblings(folders, target.folderId, movingId).length } };
  }
  const parentId = target.parentId ?? null;
  const conflict = duplicateNameAt(folders, moving, parentId, movingId);
  if (conflict) return { ok: false, reason: conflict };
  const siblings = orderedLibrarySiblings(folders, parentId, movingId);
  const position = siblings.findIndex((folder) => folder.folderId === target.folderId);
  const index = position < 0 ? siblings.length : position + (drop.placement === 'after' ? 1 : 0);
  return { ok: true, plan: { parentId, index } };
}

function duplicateNameAt(folders: LibraryFolder[], moving: LibraryFolder, parentId: string | null, movingId: string): string | null {
  const clash = folders.some((folder) => folder.folderId !== movingId
    && (folder.parentId ?? null) === parentId
    && folder.name.trim().toLowerCase() === moving.name.trim().toLowerCase());
  return clash ? '目标位置存在同名文件夹。' : null;
}

/**
 * Apply a plan locally, assigning 0-based sortOrder to every sibling of both levels.
 * The host uses this in browser builds; the native command persists the same numbers.
 */
export function applyLibraryFolderMove(folders: LibraryFolder[], folderId: string, parentId: string | null, index: number): LibraryFolder[] {
  const moving = folders.find((folder) => folder.folderId === folderId);
  if (!moving || folderId === LIBRARY_ROOT_FOLDER_ID) return folders;
  const previousParent = moving.parentId ?? null;
  const destination = orderedLibrarySiblings(folders, parentId, folderId);
  const position = Math.max(0, Math.min(index, destination.length));
  const reordered = [...destination.slice(0, position), moving, ...destination.slice(position)];
  const next = new Map<string, LibraryFolder>(folders.map((folder) => [folder.folderId, { ...folder }]));
  next.get(folderId)!.parentId = parentId;
  // 默认资料库 always keeps 0 within its level so the persisted numbers stay stable
  // whether the level is rendered by the sidebar or reloaded from the database.
  let nextOrder = 0;
  reordered.forEach((folder) => {
    const entry = next.get(folder.folderId)!;
    if (folder.folderId === LIBRARY_ROOT_FOLDER_ID) { entry.sortOrder = 0; return; }
    nextOrder += 1;
    entry.sortOrder = nextOrder;
  });
  if (previousParent !== parentId) {
    let siblingPosition = 0;
    orderedLibrarySiblings(folders, previousParent, folderId).forEach((folder) => {
      const entry = next.get(folder.folderId)!;
      if (folder.folderId === LIBRARY_ROOT_FOLDER_ID) { entry.sortOrder = 0; return; }
      siblingPosition += 1;
      entry.sortOrder = siblingPosition;
    });
  }
  return folders.map((folder) => next.get(folder.folderId)!);
}
