import { ArrowDownAZ, ArrowDownZA, ChevronsDownUp, ChevronsUpDown, ChevronRight, FilePlus, FileText, FolderOpen, FolderPlus, LocateFixed, Pencil, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { listDirectoryEntries, type DirectoryEntry } from '../../platform/projects';
import { FolderDraftRow, TreeGuides } from '../../shared/tree';
import { toggleTreeExpansion } from '../../core/treeExpansion';
import { zh } from '../../ui/zh';

interface DirectoryNode {
  loading: boolean;
  error: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}

export type FileTreeSortMode = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc' | 'created-desc' | 'created-asc';

export interface FileTreePanelProps {
  rootPath: string;
  /** Kept for callers that still provide the old root label; the toolbar no longer renders it. */
  rootName?: string;
  onOpenFile: (entry: DirectoryEntry) => void;
  onDeleteFile?: (entry: DirectoryEntry) => void;
  onRenameFile?: (entry: DirectoryEntry, newStem: string) => Promise<void> | void;
  onRevealFile?: (entry: DirectoryEntry) => Promise<void> | void;
  onCreateFile?: (directoryPath: string) => Promise<void> | void;
  onCreateFolder?: (directoryPath: string, name: string) => Promise<void> | void;
  onMoveEntry?: (entry: DirectoryEntry, destinationDirectory: string) => Promise<void> | void;
  activePath?: string;
}

interface FileTreeContextMenuState {
  entry: DirectoryEntry;
  x: number;
  y: number;
}

interface FileTreeDragPreviewPosition {
  left: number;
  top: number;
}

const FILE_TREE_DRAG_THRESHOLDS = {
  mouse: 6,
  pen: 8,
  touch: 12,
} as const;

const sortOptions: Array<{ value: FileTreeSortMode; label: string }> = [
  { value: 'name-asc', label: '文件名（A-Z）' },
  { value: 'name-desc', label: '文件名（Z-A）' },
  { value: 'modified-desc', label: '编辑时间（从新到旧）' },
  { value: 'modified-asc', label: '编辑时间（从旧到新）' },
  { value: 'created-desc', label: '创建时间（从新到旧）' },
  { value: 'created-asc', label: '创建时间（从旧到新）' },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePath(path: string) {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

function isMarkdownFile(entry: DirectoryEntry) {
  return !entry.is_directory && /\.(md|markdown|mdx)$/i.test(entry.name);
}

function fileStem(name: string) {
  return name.replace(/\.(?:md|markdown|mdx)$/i, '');
}

function fileExtension(name: string) {
  return name.match(/\.(?:md|markdown|mdx)$/i)?.[0] ?? '';
}

function parentPath(path: string) {
  return path.replace(/[\\/][^\\/]+[\\/]?$/, '');
}

function isWithin(rootPath: string, path: string) {
  const root = normalizePath(rootPath);
  const candidate = normalizePath(path);
  return candidate === root || candidate.startsWith(root + '\\') || candidate.startsWith(root + '/');
}

function nodeAt(nodes: Record<string, DirectoryNode>, path: string) {
  return nodes[path] ?? Object.entries(nodes).find(([candidate]) => normalizePath(candidate) === normalizePath(path))?.[1];
}

function pathIsExpanded(expandedPaths: string[], path: string) {
  return expandedPaths.some((candidate) => normalizePath(candidate) === normalizePath(path));
}

function compareOptionalTimestamp(left?: number | null, right?: number | null) {
  return (left ?? 0) - (right ?? 0);
}

function sortEntries(entries: DirectoryEntry[], mode: FileTreeSortMode) {
  return [...entries].sort((left, right) => {
    if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1;
    let comparison = 0;
    if (mode === 'name-asc' || mode === 'name-desc') {
      comparison = left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
      if (mode === 'name-desc') comparison *= -1;
    } else if (mode === 'modified-desc' || mode === 'modified-asc') {
      comparison = compareOptionalTimestamp(left.modified_at, right.modified_at);
      if (mode === 'modified-desc') comparison *= -1;
    } else {
      comparison = compareOptionalTimestamp(left.created_at, right.created_at);
      if (mode === 'created-desc') comparison *= -1;
    }
    return comparison || left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

function dragThresholdFor(pointerType: string) {
  if (pointerType === 'touch') return FILE_TREE_DRAG_THRESHOLDS.touch;
  if (pointerType === 'pen') return FILE_TREE_DRAG_THRESHOLDS.pen;
  return FILE_TREE_DRAG_THRESHOLDS.mouse;
}

function computeDragPreviewPosition(clientX: number, clientY: number): FileTreeDragPreviewPosition {
  const maxLeft = Math.max(8, window.innerWidth - 248);
  const maxTop = Math.max(8, window.innerHeight - 54);
  return {
    left: Math.max(8, Math.min(clientX + 14, maxLeft)),
    top: Math.max(8, Math.min(clientY + 14, maxTop)),
  };
}

/** Lazy folder tree: each directory is read only when it is first expanded. */
export function FileTreePanel({ rootPath, onOpenFile, onDeleteFile, onRenameFile, onRevealFile, onCreateFile, onCreateFolder, onMoveEntry, activePath }: FileTreePanelProps) {
  const [nodes, setNodes] = useState<Record<string, DirectoryNode>>({});
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<FileTreeSortMode>('name-asc');
  const [sortOpen, setSortOpen] = useState(false);
  const [allFoldersExpanded, setAllFoldersExpanded] = useState(false);
  const [treeBusy, setTreeBusy] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<DirectoryEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [folderDraft, setFolderDraft] = useState<{ parent: string; name: string; error: string; saving: boolean } | null>(null);
  const folderSaving = useRef(false);
  const composing = useRef(false);
  const [renamePending, setRenamePending] = useState(false);
  const [draggingEntry, setDraggingEntry] = useState<DirectoryEntry | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<FileTreeDragPreviewPosition | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const renameSubmittingRef = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const treeContentRef = useRef<HTMLDivElement | null>(null);
  const treeRowsRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const dragEntryRef = useRef<DirectoryEntry | null>(null);
  const pointerDragRef = useRef<{ entry: DirectoryEntry; pointerId: number; pointerType: string; startX: number; startY: number; dragging: boolean } | null>(null);
  const draggedRef = useRef(false);
  const movePendingRef = useRef(false);

  const loadDirectory = useCallback(async (path: string) => {
    setNodes((current) => ({
      ...current,
      [path]: { loading: true, error: '', entries: current[path]?.entries ?? [], truncated: false },
    }));
    try {
      const listing = await listDirectoryEntries(path, false);
      setNodes((current) => ({
        ...current,
        [path]: { loading: false, error: '', entries: listing.entries, truncated: listing.truncated },
      }));
      return listing;
    } catch (error) {
      setNodes((current) => ({
        ...current,
        [path]: { loading: false, error: errorMessage(error), entries: [], truncated: false },
      }));
      return null;
    }
  }, []);

  useEffect(() => {
    setNodes({});
    setExpandedPaths([]);
    setAllFoldersExpanded(false);
    setHoveredPath(null);
    setContextMenu(null);
    setFolderDraft(null); setEditError(''); folderSaving.current = false;
    setRenamingEntry(null);
    setRenameDraft('');
    setRenamePending(false);
    setDraggingEntry(null);
    setDragPreviewPosition(null);
    setDropTargetPath(null);
    dragEntryRef.current = null;
    pointerDragRef.current = null;
    draggedRef.current = false;
    movePendingRef.current = false;
    renameSubmittingRef.current = false;
    rowRefs.current.clear();
    void loadDirectory(rootPath);
  }, [loadDirectory, rootPath]);

  useEffect(() => {
    if (!sortOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sortOpen]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const toggleDirectory = (entry: DirectoryEntry) => {
    if ((folderDraft && isWithin(entry.path, folderDraft.parent)) || (renamingEntry && isWithin(entry.path, renamingEntry.path))) return;
    const isExpanded = pathIsExpanded(expandedPaths, entry.path);
    setAllFoldersExpanded(false);
    setExpandedPaths((current) => toggleTreeExpansion(current, entry.path, normalizePath));
    if (!isExpanded && !nodes[entry.path]) void loadDirectory(entry.path);
  };

  const createFileIn = (directoryPath: string) => {
    if (!onCreateFile || folderDraft || renamingEntry) return;
    void Promise.resolve(onCreateFile(directoryPath)).then(() => void loadDirectory(directoryPath));
  };

  const createFolderIn = (directoryPath: string) => {
    if (!onCreateFolder || folderSaving.current || renamePending) return;
    setContextMenu(null); setRenamingEntry(null); setEditError('');
    const ancestors: string[] = []; let current = directoryPath;
    while (current && isWithin(rootPath, current)) {
      ancestors.push(current); if (normalizePath(current) === normalizePath(rootPath)) break;
      current = parentPath(current);
    }
    setExpandedPaths(paths => [...new Set([...paths, ...ancestors])]); setAllFoldersExpanded(false);
    setFolderDraft(previous => previous?.parent === directoryPath ? previous : { parent: directoryPath, name: '新建文件夹', error: '', saving: false });
    void loadDirectory(directoryPath);
  };
  const submitFolder = async () => {
    const draft = folderDraft; if (!draft || !onCreateFolder || folderSaving.current || !draft.name.trim()) return;
    folderSaving.current = true; setFolderDraft({ ...draft, saving: true, error: '' });
    try { await onCreateFolder(draft.parent, draft.name.trim()); setFolderDraft(null); await loadDirectory(draft.parent); }
    catch (error) { setFolderDraft({ ...draft, saving: false, error: String(error) }); }
    finally { folderSaving.current = false; }
  };

  const expandAll = async () => {
    if (treeBusy) return;
    setTreeBusy(true);
    try {
      const loaded = new Map(Object.entries(nodes));
      const queue = [rootPath];
      const directories: string[] = [];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const path = queue.shift();
        if (!path || visited.has(normalizePath(path))) continue;
        visited.add(normalizePath(path));
        const existing = loaded.get(path);
        const listing = existing && !existing.error ? { entries: existing.entries, truncated: existing.truncated } : await loadDirectory(path);
        if (!listing) continue;
        if (normalizePath(path) !== normalizePath(rootPath)) directories.push(path);
        listing.entries.filter((entry) => entry.is_directory).forEach((entry) => queue.push(entry.path));
        loaded.set(path, { loading: false, error: '', entries: listing.entries, truncated: listing.truncated });
      }
      setExpandedPaths(directories);
      setAllFoldersExpanded(true);
    } finally {
      setTreeBusy(false);
    }
  };

  const collapseAll = () => {
    if (folderDraft || renamingEntry) return;
    setExpandedPaths([]);
    setAllFoldersExpanded(false);
  };

  const locateCurrentFile = async () => {
    if (!activePath || !isWithin(rootPath, activePath) || treeBusy) return;
    setTreeBusy(true);
    try {
      const loaded = new Map(Object.entries(nodes));
      const ancestors: string[] = [];
      let current = parentPath(activePath);
      while (current && isWithin(rootPath, current)) {
        if (normalizePath(current) !== normalizePath(rootPath)) ancestors.unshift(current);
        if (normalizePath(current) === normalizePath(rootPath)) break;
        current = parentPath(current);
      }
      for (const directory of ancestors) {
        if (loaded.has(directory) && !loaded.get(directory)?.error) continue;
        const listing = await loadDirectory(directory);
        if (listing) loaded.set(directory, { loading: false, error: '', entries: listing.entries, truncated: listing.truncated });
      }
      if (!loaded.has(rootPath)) await loadDirectory(rootPath);
      setExpandedPaths((currentPaths) => [...new Set([...currentPaths, ...ancestors])]);
      setAllFoldersExpanded(false);
      window.requestAnimationFrame(() => {
        const row = rowRefs.current.get(activePath) ?? [...rowRefs.current.entries()].find(([path]) => normalizePath(path) === normalizePath(activePath))?.[1];
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        row?.focus({ preventScroll: true });
      });
    } finally {
      setTreeBusy(false);
    }
  };

  const openFileContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, entry: DirectoryEntry) => {
    if ((!entry.is_directory && !isMarkdownFile(entry)) || folderDraft || renamingEntry) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = entry.is_directory ? 225 : 150;
    setContextMenu({
      entry,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  };

  const invokeContextAction = (action: (entry: DirectoryEntry) => Promise<void> | void) => {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry) return;
    void Promise.resolve().then(() => action(entry)).catch(error => setEditError(String(error)));
  };

  const finishRename = () => {
    setRenamingEntry(null);
    setRenameDraft('');
    setRenamePending(false);
    renameSubmittingRef.current = false;
  };

  const cancelRename = () => {
    if (renamePending) return;
    finishRename();
  };

  const commitRename = () => {
    const entry = renamingEntry;
    if (!entry || !onRenameFile || renameSubmittingRef.current) return;
    const currentStem = entry.is_directory ? entry.name : fileStem(entry.name);
    let nextStem = renameDraft.trim();
    const extension = entry.is_directory ? '' : fileExtension(entry.name);
    if (extension && nextStem.toLowerCase().endsWith(extension.toLowerCase())) nextStem = nextStem.slice(0, -extension.length).trim();
    if (!nextStem || nextStem === currentStem) {
      finishRename();
      return;
    }
    renameSubmittingRef.current = true;
    setRenamePending(true);
    void Promise.resolve()
      .then(() => onRenameFile(entry, nextStem))
      .then(() => { finishRename(); void loadDirectory(parentPath(entry.path)); })
      .catch(error => { setEditError(String(error)); setRenamePending(false); renameSubmittingRef.current = false; });
  };

  const renameFromContextMenu = () => {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry || !onRenameFile) return;
    setRenamingEntry(entry);
    setEditError(''); setRenameDraft(entry.is_directory ? entry.name : fileStem(entry.name));
  };

  const canDropInto = useCallback((entry: DirectoryEntry, source = dragEntryRef.current) => {
    if (!source || !onMoveEntry || !entry.is_directory) return false;
    if (normalizePath(source.path) === normalizePath(entry.path)) return false;
    if (source.is_directory && isWithin(source.path, entry.path)) return false;
    // Moving into the current parent would be a no-op and should not flash a
    // misleading drop target.
    if (normalizePath(parentPath(source.path)) === normalizePath(entry.path)) return false;
    return true;
  }, [onMoveEntry]);

  const clearDragState = () => {
    setDraggingEntry(null);
    setDragPreviewPosition(null);
    setDropTargetPath(null);
    dragEntryRef.current = null;
  };

  const entryAtPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('.file-tree-row.directory[data-directory="true"]');
    const path = row?.dataset.filePath;
    if (!path) return null;
    return Object.values(nodes)
      .flatMap((node) => node.entries)
      .find((entry) => normalizePath(entry.path) === normalizePath(path)) ?? null;
  }, [nodes]);

  const startEntryPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, entry: DirectoryEntry) => {
    if (folderDraft || renamingEntry) return;
    if (event.button !== 0 || !onMoveEntry || renamingEntry || movePendingRef.current) return;
    pointerDragRef.current = {
      entry,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    dragEntryRef.current = entry;
    draggedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      if (!pointerDrag.dragging) {
        const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
        if (distance < dragThresholdFor(pointerDrag.pointerType)) return;
        pointerDrag.dragging = true;
        draggedRef.current = true;
        setDraggingEntry(pointerDrag.entry);
      }
      event.preventDefault();
      setDragPreviewPosition(computeDragPreviewPosition(event.clientX, event.clientY));
      const target = entryAtPoint(event.clientX, event.clientY);
      setDropTargetPath(target && canDropInto(target) ? target.path : null);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      pointerDragRef.current = null;
      if (!pointerDrag.dragging) {
        dragEntryRef.current = null;
        draggedRef.current = false;
        return;
      }
      event.preventDefault();
      const source = pointerDrag.entry;
      const target = entryAtPoint(event.clientX, event.clientY);
      const canMove = Boolean(target && canDropInto(target, source) && !movePendingRef.current);
      clearDragState();
      window.setTimeout(() => { draggedRef.current = false; }, 0);
      if (!canMove || !target) return;
      movePendingRef.current = true;
      setTreeBusy(true);
      void Promise.resolve(onMoveEntry?.(source, target.path))
        .catch(() => undefined)
        .finally(() => {
          movePendingRef.current = false;
          setTreeBusy(false);
        });
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      pointerDragRef.current = null;
      draggedRef.current = false;
      clearDragState();
    };
    const cancelActiveDrag = () => {
      if (!pointerDragRef.current) return;
      pointerDragRef.current = null;
      draggedRef.current = false;
      clearDragState();
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', cancelActiveDrag);
    document.addEventListener('visibilitychange', cancelActiveDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', cancelActiveDrag);
      document.removeEventListener('visibilitychange', cancelActiveDrag);
    };
  }, [canDropInto, entryAtPoint, onMoveEntry]);

  const renderNode = (path: string, depth: number): ReactNode => {
    const node = nodeAt(nodes, path);
    const draftRow = folderDraft && normalizePath(folderDraft.parent) === normalizePath(path) ? <FolderDraftRow depth={depth} parentName={path.split(/[\\/]/).pop() || path} creation={{ parentId: path, name: folderDraft.name, error: folderDraft.error, saving: folderDraft.saving,
      onNameChange: name => setFolderDraft(previous => previous ? { ...previous, name } : null), onSubmit: submitFolder, onCancel: () => { if (!folderSaving.current) setFolderDraft(null); } }} /> : null;
    if (!node) return draftRow;
    if (node.error) return <>{draftRow}<p className="file-tree-error">{node.error}</p></>;
    if (node.loading && node.entries.length === 0) return <>{draftRow}<p className="file-tree-hint">{zh.workbench.fileTreeLoading}</p></>;
    if (node.entries.length === 0) return draftRow ?? <p className="file-tree-hint">{zh.workbench.fileTreeEmpty}</p>;
    return (
      <ul className="file-tree-list">
        {draftRow && <li key="folder-draft">{draftRow}</li>}
        {sortEntries(node.entries, sortMode).map((entry) => {
          const isExpanded = expandedPaths.some((candidate) => normalizePath(candidate) === normalizePath(entry.path));
          const isActive = !entry.is_directory && Boolean(activePath) && normalizePath(entry.path) === normalizePath(activePath ?? '');
          const isContextSelected = contextMenu?.entry.path === entry.path;
          const isRenaming = Boolean(renamingEntry && normalizePath(renamingEntry.path) === normalizePath(entry.path));
          const isDragging = draggingEntry?.path === entry.path;
          const isDropTarget = dropTargetPath !== null && normalizePath(dropTargetPath) === normalizePath(entry.path);
          return (
            <li key={entry.path}>
              <div className="file-tree-row-wrap" onMouseEnter={() => setHoveredPath(entry.path)} onMouseLeave={() => setHoveredPath(null)}>
                {isRenaming ? (
                  <div
                    ref={(element) => {
                      if (element) rowRefs.current.set(entry.path, element);
                      else rowRefs.current.delete(entry.path);
                    }}
                    className="file-tree-row file renaming"
                    style={{ paddingLeft: `calc(8px + ${depth} * var(--file-tree-depth-step))` }}
                    data-tree-row={entry.path}
                    data-tree-depth={depth}
                    data-tree-expanded={entry.is_directory && isExpanded ? 'true' : undefined}
                    data-file-path={entry.path}
                  >
                    <span className="file-tree-caret-spacer" aria-hidden="true" />
                    <input
                      className="file-tree-rename-input"
                      type="text"
                      value={renameDraft}
                      autoFocus
                      disabled={renamePending}
                      aria-label={`重命名 ${entry.name}`}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onFocus={(event) => {
                        setHoveredPath(entry.path);
                        event.currentTarget.select();
                      }}
                      onCompositionStart={() => { composing.current = true; }}
                      onCompositionEnd={() => { composing.current = false; }}
                      onKeyDown={(event) => {
                        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelRename();
                        }
                      }}
                    />
                    <span className="file-tree-rename-extension" aria-hidden="true">{entry.is_directory ? '' : fileExtension(entry.name)}</span>
                    <div className="tree-edit-actions"><button type="button" className="tree-edit-confirm" disabled={renamePending} onClick={commitRename}>保存</button><button type="button" className="tree-edit-cancel" disabled={renamePending} onClick={cancelRename}>取消</button></div>
                  </div>
                ) : (
                  <button
                    ref={(element) => {
                      if (element) rowRefs.current.set(entry.path, element);
                      else rowRefs.current.delete(entry.path);
                    }}
                    type="button"
                    className={`${entry.is_directory ? 'file-tree-row directory' : 'file-tree-row file'}${isActive ? ' active' : ''}${isContextSelected ? ' context-selected' : ''}`}
                    style={{ paddingLeft: `calc(8px + ${depth} * var(--file-tree-depth-step))` }}
                    title={entry.path}
                    data-tree-row={entry.path}
                    data-tree-depth={depth}
                    data-tree-expanded={entry.is_directory && isExpanded ? 'true' : undefined}
                    data-file-path={entry.path}
                    data-directory={entry.is_directory ? 'true' : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    onFocus={() => setHoveredPath(entry.path)}
                    onContextMenu={(event) => openFileContextMenu(event, entry)}
                    onPointerDown={(event) => startEntryPointerDrag(event, entry)}
                    onClick={() => {
                      if (draggedRef.current) {
                        draggedRef.current = false;
                        return;
                      }
                      if (entry.is_directory) toggleDirectory(entry);
                      else onOpenFile(entry);
                    }}
                    data-dragging={isDragging ? 'true' : undefined}
                    data-drop-target={isDropTarget ? 'true' : undefined}
                  >
                    {entry.is_directory ? (
                      <span className={isExpanded ? 'file-tree-caret open' : 'file-tree-caret'} aria-hidden="true"><ChevronRight size={17} strokeWidth={2.35} /></span>
                    ) : (
                      <span className="file-tree-caret-spacer" aria-hidden="true" />
                    )}
                    <span className="file-tree-name">{entry.name}</span>
                  </button>
                )}
              </div>
              {entry.is_directory && isExpanded && renderNode(entry.path, depth + 1)}
            </li>
          );
        })}
        {node.truncated && <li className="file-tree-hint">{zh.workbench.fileTreeTruncated}</li>}
      </ul>
    );
  };

  const activeSortLabel = sortOptions.find((option) => option.value === sortMode)?.label ?? sortOptions[0].label;
  const canCreate = Boolean(onCreateFile);
  const canCreateFolder = Boolean(onCreateFolder);
  const emphasizedPath = hoveredPath ?? activePath ?? null;

  return (
    <aside className="file-tree-panel" aria-label={zh.workbench.fileTree}>
      <header className="file-tree-toolbar" role="toolbar" aria-label="文件树操作">
        {canCreate && <button type="button" className="workbench-icon-button" title="新建笔记" aria-label="新建笔记" onClick={() => createFileIn(rootPath)}><FilePlus size={17} aria-hidden="true" /></button>}
        {canCreateFolder && <button type="button" className="workbench-icon-button" title="新建文件夹" aria-label="新建文件夹" disabled={folderDraft?.saving || renamePending} onClick={() => createFolderIn(rootPath)}><FolderPlus size={17} aria-hidden="true" /></button>}
        <div ref={sortMenuRef} className="file-tree-sort-wrap">
          <button type="button" className={'workbench-icon-button' + (sortOpen ? ' active' : '')} title={`排序：${activeSortLabel}`} aria-label={`排序：${activeSortLabel}`} aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}>
            {sortMode === 'name-desc' || sortMode === 'modified-asc' || sortMode === 'created-asc' ? <ArrowDownZA size={17} aria-hidden="true" /> : <ArrowDownAZ size={17} aria-hidden="true" />}
          </button>
          {sortOpen && <div className="file-tree-sort-menu" role="menu" aria-label="排序方式">{sortOptions.map((option) => <button type="button" role="menuitemradio" aria-checked={sortMode === option.value} className={sortMode === option.value ? 'selected' : ''} key={option.value} onClick={() => { setSortMode(option.value); setSortOpen(false); }}>{option.label}{sortMode === option.value && <span aria-hidden="true">✓</span>}</button>)}</div>}
        </div>
        <button type="button" className="workbench-icon-button" title={activePath ? '自动显示当前文件' : '当前没有打开的文件'} aria-label={activePath ? '自动显示当前文件' : '当前没有打开的文件'} disabled={!activePath || treeBusy} onClick={() => void locateCurrentFile()}><LocateFixed size={17} aria-hidden="true" /></button>
        <button type="button" className={'workbench-icon-button' + (allFoldersExpanded ? ' active' : '')} title={allFoldersExpanded ? '全部折叠' : '全部展开'} aria-label={allFoldersExpanded ? '全部折叠' : '全部展开'} disabled={treeBusy || !!folderDraft || !!renamingEntry} onClick={() => void (allFoldersExpanded ? collapseAll() : expandAll())}>{allFoldersExpanded ? <ChevronsDownUp size={17} aria-hidden="true" /> : <ChevronsUpDown size={17} aria-hidden="true" />}</button>
      </header>
      {editError && <p className="file-tree-error" role="alert">{editError}</p>}
      <div ref={scrollRef} className="file-tree-scroll" onContextMenu={event => {
        if ((event.target as HTMLElement).closest('[data-file-path], input, button, form')) return;
        openFileContextMenu(event as unknown as ReactMouseEvent<HTMLButtonElement>, { path: rootPath, name: rootPath.split(/[\\/]/).pop() || rootPath, is_directory: true, size: 0, extension: '' });
      }}>
        <div ref={treeContentRef} className="file-tree-tree">
          <TreeGuides containerRef={treeContentRef} contentRef={treeRowsRef} emphasizedId={emphasizedPath} normalizeId={normalizePath} />
          <div ref={treeRowsRef} className="file-tree-tree-content">{renderNode(rootPath, 0)}</div>
        </div>
      </div>
      {contextMenu && createPortal(
        <div ref={contextMenuRef} className="file-tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label={`${contextMenu.entry.name} 文件操作`} onClick={(event) => event.stopPropagation()}>
          {contextMenu.entry.is_directory && <><button type="button" role="menuitem" disabled={!onCreateFolder} onClick={() => createFolderIn(contextMenu.entry.path)}><FolderPlus size={15} aria-hidden="true" /><span>新建子文件夹</span></button><button type="button" role="menuitem" disabled={!onCreateFile} onClick={() => { createFileIn(contextMenu.entry.path); setContextMenu(null); }}><FilePlus size={15} aria-hidden="true" /><span>新建笔记</span></button></>}
          <button type="button" role="menuitem" disabled={!onRenameFile || normalizePath(contextMenu.entry.path) === normalizePath(rootPath)} onClick={renameFromContextMenu}><Pencil size={15} aria-hidden="true" /><span>{zh.workbench.fileRename}</span></button>
          <button type="button" role="menuitem" disabled={!onRevealFile} onClick={() => onRevealFile && invokeContextAction(onRevealFile)}><FolderOpen size={15} aria-hidden="true" /><span>{zh.workbench.fileOpenLocation}</span></button>
          <div className="file-tree-context-divider" role="separator" />
          <button type="button" role="menuitem" className="danger" disabled={!onDeleteFile || normalizePath(contextMenu.entry.path) === normalizePath(rootPath)} onClick={() => onDeleteFile && invokeContextAction(onDeleteFile)}><Trash2 size={15} aria-hidden="true" /><span>{contextMenu.entry.is_directory ? '删除空文件夹' : zh.workbench.fileDelete}</span></button>
        </div>,
        document.body,
      )}
      {draggingEntry && dragPreviewPosition && createPortal(
        <div className="file-tree-drag-preview" style={{ left: dragPreviewPosition.left, top: dragPreviewPosition.top }} aria-hidden="true">
          <span className="file-tree-drag-preview-icon">{draggingEntry.is_directory ? <FolderOpen size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}</span>
          <span className="file-tree-drag-preview-name">{draggingEntry.name}</span>
          <span className="file-tree-drag-preview-status">拖到文件夹</span>
        </div>,
        document.body,
      )}
    </aside>
  );
}
