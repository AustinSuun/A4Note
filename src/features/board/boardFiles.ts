import { useSyncExternalStore } from 'react';
import { createDirectory, createTextFile, listDirectoryEntries, readTextFile, type DirectoryEntry } from '../../platform/projects';
import { acquireTextDocument } from '../../platform/projects';
import {
  BOARD_EXTENSION, boardLinkedToPaper, createBoardDocument, linkBoardToPaper, parseBoardDocument, serializeBoardDocument, unlinkBoardFromPaper,
  type BoardDocument, type BoardLink, type BoardKind,
} from '../../core/board';

/**
 * The notes workspace root is the only place boards live. The reader has no
 * project prop of its own, so the host publishes the active folder here and
 * the reader note switcher subscribes to it.
 */
let workspaceRoot: string | null = null;
const rootListeners = new Set<() => void>();
export function setBoardWorkspaceRoot(root: string | null) {
  if (workspaceRoot === root) return;
  workspaceRoot = root;
  rootListeners.forEach((listener) => listener());
}
export function getBoardWorkspaceRoot() { return workspaceRoot; }
export function useBoardWorkspaceRoot() {
  return useSyncExternalStore((listener) => { rootListeners.add(listener); return () => { rootListeners.delete(listener); }; }, getBoardWorkspaceRoot, getBoardWorkspaceRoot);
}

const joinPath = (directory: string, name: string) => `${directory.replace(/[\\/]$/, '')}${directory.includes('\\') ? '\\' : '/'}${name}`;

export function sanitizeBoardFileStem(value: string) {
  const stem = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return stem || '未命名白板';
}

export interface CreatedBoardFile { path: string; name: string; document: BoardDocument }

/** Fired after a board file is created so an already-open tab for that path (e.g. one left in a "file missing" state) can re-read it. */
export const BOARD_FILE_CREATED_EVENT = 'a4note:board-file-created';
export const sameBoardPath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** Create `<stem>.a4board` in `directory`, appending a counter when the name is taken. */
export async function createBoardFile(directory: string, input: { stem?: string; kind?: BoardKind; links?: BoardLink[] } = {}): Promise<CreatedBoardFile> {
  const stem = sanitizeBoardFileStem(input.stem ?? '未命名白板');
  let lastError: unknown = null;
  for (let index = 0; index < 100; index += 1) {
    const name = `${index === 0 ? stem : `${stem} ${index + 1}`}.${BOARD_EXTENSION}`;
    const path = joinPath(directory, name);
    const document = createBoardDocument({ title: name.replace(/\.a4board$/i, ''), kind: input.kind, links: input.links });
    try {
      await createTextFile(path, serializeBoardDocument(document));
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BOARD_FILE_CREATED_EVENT, { detail: { path } }));
      return { path, name, document };
    } catch (error) {
      lastError = error;
      if (!/已存在/.test(String(error))) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Ensure `<root>/白板` exists and create a board there. Used by the reader entry. */
export async function createBoardInWorkspace(root: string, input: { stem: string; links?: BoardLink[] }) {
  const folderName = '白板';
  const directory = joinPath(root, folderName);
  try { await createDirectory(root, folderName); } catch (error) { if (!/已存在/.test(String(error))) throw error; }
  return createBoardFile(directory, input);
}

export interface BoardFileSummary {
  path: string;
  name: string;
  document: BoardDocument | null;
  error?: string;
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'target', 'dist', '.next', '.venv', '__pycache__', '.obsidian', '.trash']);
export const BOARD_SCAN_LIMITS = { directories: 300, boards: 200, depth: 8 } as const;

/** Breadth-first scan of the workspace for `*.a4board` files. Bounded so a huge vault degrades instead of hanging. */
export async function listWorkspaceBoards(root: string): Promise<{ entries: DirectoryEntry[]; truncated: boolean }> {
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const entries: DirectoryEntry[] = [];
  let visited = 0; let truncated = false;
  while (queue.length) {
    const { path, depth } = queue.shift()!;
    if (visited >= BOARD_SCAN_LIMITS.directories) { truncated = true; break; }
    visited += 1;
    let listing: { entries: DirectoryEntry[]; truncated: boolean };
    try { listing = await listDirectoryEntries(path); } catch { continue; }
    if (listing.truncated) truncated = true;
    for (const entry of listing.entries) {
      if (entry.is_directory) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.') && depth < BOARD_SCAN_LIMITS.depth) queue.push({ path: entry.path, depth: depth + 1 });
      } else if (entry.extension.toLowerCase() === BOARD_EXTENSION) {
        entries.push(entry);
        if (entries.length >= BOARD_SCAN_LIMITS.boards) { truncated = true; return { entries, truncated }; }
      }
    }
  }
  return { entries, truncated };
}

export async function readBoardSummary(entry: DirectoryEntry): Promise<BoardFileSummary> {
  try {
    const file = await readTextFile(entry.path);
    if (file.binary) return { path: entry.path, name: entry.name, document: null, error: '不是文本文件' };
    const parsed = parseBoardDocument(file.content);
    return parsed.ok ? { path: entry.path, name: entry.name, document: parsed.document } : { path: entry.path, name: entry.name, document: null, error: parsed.error };
  } catch (error) {
    return { path: entry.path, name: entry.name, document: null, error: String(error) };
  }
}

/** Boards whose file declares a link to `paperId`. The board file is the source of truth for the relation. */
export async function findBoardsLinkedToPaper(root: string, paperId: string) {
  const scan = await listWorkspaceBoards(root);
  const summaries = await Promise.all(scan.entries.map(readBoardSummary));
  return {
    truncated: scan.truncated,
    linked: summaries.filter((summary) => summary.document && boardLinkedToPaper(summary.document, paperId)),
    all: summaries,
  };
}

/**
 * Add a paper link to an existing board through the shared document session,
 * so an editor that already has the board open sees the change immediately and
 * the write still goes through the compare-and-swap path.
 */
export async function linkExistingBoardToPaper(path: string, paper: { paperId: string; title: string }) {
  const session = await acquireTextDocument(path);
  const snapshot = session.getSnapshot();
  const parsed = parseBoardDocument(snapshot.content);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = linkBoardToPaper(parsed.document, paper);
  if (next !== parsed.document) {
    session.update(serializeBoardDocument(next));
    await session.flush();
  }
  return next;
}

/** Remove the paper link from a board file; the file itself is never deleted here. */
export async function unlinkBoardFromPaperFile(path: string, paperId: string) {
  const session = await acquireTextDocument(path);
  const parsed = parseBoardDocument(session.getSnapshot().content);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = unlinkBoardFromPaper(parsed.document, paperId);
  if (next !== parsed.document) {
    session.update(serializeBoardDocument(next));
    await session.flush();
  }
  return next;
}
