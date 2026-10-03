import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, Library, Plus, Tag, Clock, FileDown, BookOpen, Star } from 'lucide-react';
import type { LibraryFolder, PaperDocument } from '../../core/types';
import { FolderDraftRow as NewFolderTreeRow, TreeGuides } from '../../shared/tree';
import { toggleTreeExpansion } from '../../core/treeExpansion';
import type { LibraryFolderActionProps } from './types';

import { buildLibraryFolderTree, countLibraryFolderPapers, selectLibraryView, type LibraryFolderNode as FolderNode } from '../../core/libraryViews';
import { LIBRARY_FOLDER_DRAG_TYPE, LIBRARY_ROOT_FOLDER_ID, planLibraryFolderDrop, type LibraryFolderDropPlacement } from './folderOrdering';

let closeLibraryContextMenu: (() => void) | undefined;

export type LibrarySceneSidebarProps = LibraryFolderActionProps;

/** Library navigation and PDF folder management, using the Markdown tree language. */
export function LibrarySceneSidebar({
  folders,
  papers,
  activeFolderId,
  activeTag,
  tags,
  selectedPaperId,
  onSelectFolder,
  onSelectTag,
  onSelectPaper,
  onOpenPaper,
  onMovePapersToFolder,
  onMoveFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: LibraryFolderActionProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>(['library']);
  useEffect(() => () => closeLibraryContextMenu?.(), []);
  // `null` parent means the draft creates a top-level folder beside 默认资料库;
  // `null` state means no draft row is open at all.
  const [newFolderTarget, setNewFolderTarget] = useState<{ parentId: string | null } | null>(null);
  const newFolderParentId = newFolderTarget ? newFolderTarget.parentId : null;
  const [newFolderName, setNewFolderName] = useState('');
  const [folderActionError, setFolderActionError] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const folderSavingRef = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLElement>(null);
  const treeContentRef = useRef<HTMLDivElement>(null);
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<{ folderId: string | null; placement: LibraryFolderDropPlacement | 'root' } | null>(null);
  const [folderDropMessage, setFolderDropMessage] = useState('');

  const folderTree = useMemo(() => buildLibraryFolderTree(folders), [folders]);
  const creationPath = useMemo(() => newFolderTarget === null || newFolderTarget.parentId === null ? [] : findFolderPath(folderTree, newFolderTarget.parentId), [folderTree, newFolderTarget]);
  const renamePath = useMemo(() => renamingFolderId === null ? [] : findFolderPath(folderTree, renamingFolderId), [folderTree, renamingFolderId]);
  const protectedIds = useMemo(() => [...new Set([...creationPath, ...renamePath])], [creationPath, renamePath]);
  const branchIds = useMemo(() => {
    const ids: string[] = [];
    const visit = (nodes: FolderNode[]) => nodes.forEach(node => { if (node.children.length) ids.push(node.folderId); visit(node.children); });
    visit(folderTree); return ids;
  }, [folderTree]);
  const allExpanded = branchIds.length > 0 && branchIds.every(id => expandedIds.includes(id));
  const toggleAll = () => { if (folderSavingRef.current || newFolderTarget !== null || renamingFolderId !== null) return; setExpandedIds(allExpanded ? [] : branchIds); };
  const toggleExpanded = (id: string) => {
    // An editing row must not disappear when its parent/ancestor is collapsed.
    setExpandedIds((current) => toggleTreeExpansion(current, id, undefined, protectedIds));
  };
  const focusFolder = (folderId: string) => {
    window.requestAnimationFrame(() => {
      const rows = sidebarRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-folder-id]');
      Array.from(rows ?? []).find((row) => row.dataset.libraryFolderId === folderId)?.focus();
    });
  };
  const navigateFolder = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string, expanded: boolean, hasChildren: boolean) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const rows = [...(treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-folder-id]') ?? [])];
    const index = rows.findIndex(row => row.dataset.libraryFolderId === id);
    if (event.key === 'ArrowRight') { if (hasChildren && !expanded) toggleExpanded(id); else if (hasChildren) rows[index + 1]?.focus(); }
    else if (event.key === 'ArrowLeft') { if (hasChildren && expanded) toggleExpanded(id); else { const ancestors = findFolderPath(folderTree, id); if (ancestors.length > 1) focusFolder(ancestors[ancestors.length - 2]); } }
    else { const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1); rows[next]?.focus(); }
  };
  const startNewFolder = (parentId: string | null) => {
    if (folderSavingRef.current) return;
    // A top-level draft (parentId null) always has a valid place to go; a nested one
    // must still exist, otherwise the draft would be orphaned.
    const path = parentId === null ? [] : findFolderPath(folderTree, parentId);
    if (parentId !== null && !path.length) return;
    setExpandedIds((current) => Array.from(new Set([...current, ...path])));
    setRenamingFolderId(null);
    setFolderActionError('');
    if (!newFolderTarget || newFolderTarget.parentId !== parentId) setNewFolderName('新建文件夹');
    setNewFolderTarget({ parentId });
    // Reusing the same target keeps its unfinished name rather than discarding it.
    window.requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLInputElement>('[data-library-folder-draft-input]')?.focus());
  };
  const cancelNewFolder = () => {
    if (folderSavingRef.current) return;
    if (newFolderParentId) focusFolder(newFolderParentId);
    setNewFolderName('');
    setNewFolderTarget(null);
    setFolderActionError('');
  };
  useEffect(() => {
    if (newFolderTarget !== null && newFolderTarget.parentId !== null && !creationPath.length && !folderSaving) {
      setNewFolderTarget(null);
      setFolderActionError('目标文件夹已不存在，请重新选择创建位置。');
    }
  }, [creationPath, newFolderTarget, folderSaving]);
  const folderCounts = useMemo(() => countLibraryFolderPapers(papers, folderTree), [papers, folderTree]);

  const submitNewFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (folderSavingRef.current || newFolderTarget === null) return;
    if (!name) { setFolderActionError('请输入文件夹名称。'); return; }
    const parentId = newFolderTarget.parentId;
    folderSavingRef.current = true;
    setFolderSaving(true); setFolderActionError('');
    try {
      await onCreateFolder(name, parentId);
      if (parentId) setExpandedIds((current) => current.includes(parentId) ? current : [...current, parentId]);
      setNewFolderName(''); setNewFolderTarget(null);
      if (parentId) focusFolder(parentId);
    } catch (error) { setFolderActionError(String(error)); }
    finally { folderSavingRef.current = false; setFolderSaving(false); }
  };

  const startRename = (folder: LibraryFolder) => {
    if (folderSavingRef.current) return;
    setNewFolderTarget(null);
    setNewFolderName('');
    setFolderActionError('');
    setRenamingFolderId(folder.folderId);
    setRenameValue(folder.name);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>, folderId: string) => {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || folderSavingRef.current) return;
    folderSavingRef.current = true;
    setFolderSaving(true); setFolderActionError('');
    try { await onRenameFolder(folderId, name); setRenamingFolderId(null); }
    catch (error) { setFolderActionError(String(error)); }
    finally { folderSavingRef.current = false; setFolderSaving(false); }
  };

  const readNativePaperDrag = (event: ReactDragEvent<HTMLElement>) => {
    try {
      const raw = event.dataTransfer.getData('application/x-a4note-paper-ids');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  const readNativeFolderDrag = (event: ReactDragEvent<HTMLElement>) => {
    try { return event.dataTransfer.getData(LIBRARY_FOLDER_DRAG_TYPE) || null; } catch { return null; }
  };
  const carriesNativeFolderDrag = (event: ReactDragEvent<HTMLElement>) => {
    try { return event.dataTransfer.types.includes(LIBRARY_FOLDER_DRAG_TYPE); } catch { return false; }
  };
  /** Top/bottom quarter of a row reorders beside it; the middle nests inside it. */
  const placementFromPointer = (event: ReactDragEvent<HTMLElement>): LibraryFolderDropPlacement => {
    const element = event.currentTarget as HTMLElement | null;
    const rect = element?.getBoundingClientRect();
    if (!rect || !rect.height) return 'inside';
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio <= 0.3) return 'before';
    if (ratio >= 0.7) return 'after';
    return 'inside';
  };
  const runFolderMove = (folderId: string, plan: { parentId: string | null; index: number }) => {
    setDraggingFolderId(null); setFolderDropTarget(null); setFolderDropMessage(''); setFolderActionError('');
    // A folder dropped into a collapsed target would otherwise vanish from view.
    if (plan.parentId) setExpandedIds((current) => current.includes(plan.parentId!) ? current : [...current, plan.parentId!]);
    void Promise.resolve(onMoveFolder(folderId, plan.parentId, plan.index))
      .catch((error) => setFolderActionError(error instanceof Error ? error.message : String(error)));
  };
  const handleFolderDragStart = (event: ReactDragEvent<HTMLElement>, folderId: string) => {
    // 默认资料库 is not draggable; the attribute already blocks the real gesture, this
    // keeps a synthetic/replayed drag from pretending otherwise.
    if (folderId === LIBRARY_ROOT_FOLDER_ID) return;
    try {
      event.dataTransfer.setData(LIBRARY_FOLDER_DRAG_TYPE, folderId);
      event.dataTransfer.effectAllowed = 'move';
    } catch { /* a synthetic drag without dataTransfer still reorders via state */ }
    setDraggingFolderId(folderId);
    setFolderDropMessage('');
  };
  const handleFolderDragEnd = () => { setDraggingFolderId(null); setFolderDropTarget(null); setFolderDropMessage(''); };
  const handleFolderDragOver = (event: ReactDragEvent<HTMLElement>, folderId: string) => {
    if (carriesNativeFolderDrag(event)) {
      // Refusing a drop is still feedback: the row is marked, the cursor says no and
      // the reason is shown, so a cycle never fails silently.
      const placement = placementFromPointer(event);
      const result = planLibraryFolderDrop(folders, draggingFolderId ?? '', { placement, folderId });
      event.stopPropagation();
      setFolderDropTarget(result.ok ? { folderId, placement } : null);
      setFolderDropMessage(result.ok ? '' : result.reason);
      if (result.ok) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
      return;
    }
    if (!event.dataTransfer.types.includes('application/x-a4note-paper-ids')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetFolderId(folderId);
  };
  const handleFolderDrop = (event: ReactDragEvent<HTMLElement>, folderId: string) => {
    const movingFolderId = readNativeFolderDrag(event);
    if (movingFolderId) {
      event.preventDefault();
      event.stopPropagation();
      const result = planLibraryFolderDrop(folders, movingFolderId, { placement: placementFromPointer(event), folderId });
      if (result.ok) runFolderMove(movingFolderId, result.plan);
      else { setFolderDropTarget(null); setFolderDropMessage(result.reason); }
      return;
    }
    const paperIds = readNativePaperDrag(event);
    if (!paperIds.length) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTargetFolderId(null);
    const movingIds = paperIds.filter((paperId) => (papers.find((paper) => paper.paperId === paperId)?.folderId || 'library') !== folderId);
    if (movingIds.length) void Promise.resolve(onMovePapersToFolder(movingIds, folderId)).catch(() => undefined);
  };
  /** The blank strip below the tree: dropping there returns a folder to the top level. */
  const handleRootDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesNativeFolderDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const result = planLibraryFolderDrop(folders, draggingFolderId ?? '', { placement: 'root' });
    setFolderDropTarget({ folderId: null, placement: 'root' });
    setFolderDropMessage(result.ok ? '' : result.reason);
  };
  const handleRootDrop = (event: ReactDragEvent<HTMLElement>) => {
    const movingFolderId = readNativeFolderDrag(event);
    if (!movingFolderId) return;
    event.preventDefault();
    const result = planLibraryFolderDrop(folders, movingFolderId, { placement: 'root' });
    if (result.ok) runFolderMove(movingFolderId, result.plan);
    else { setFolderDropTarget(null); setFolderDropMessage(result.reason); }
  };

  const creation: FolderCreation | null = newFolderTarget === null ? null : {
    parentId: newFolderParentId,
    ancestorIds: creationPath,
    name: newFolderName,
    error: folderActionError,
    saving: folderSaving,
    onNameChange: (name) => { setNewFolderName(name); setFolderActionError(''); },
    onSubmit: submitNewFolder,
    onCancel: cancelNewFolder,
  };

  const renderFolder = (folder: FolderNode, depth: number) => (
    <FolderTreeNode
      key={folder.folderId}
      folder={folder}
      depth={depth}
      expandedIds={expandedIds}
      activeFolderId={activeFolderId}
      folderCounts={folderCounts}
      dropTargetFolderId={dropTargetFolderId}
      folderDropTarget={folderDropTarget}
      draggingFolderId={draggingFolderId}
      renamingFolderId={renamingFolderId}
      renameValue={renameValue}
      saving={folderSaving}
      creation={creation}
      protectedIds={protectedIds}
      onHover={setHoveredFolderId}
      onNavigate={navigateFolder}
      onSelectFolder={onSelectFolder}
      onToggleExpanded={toggleExpanded}
      onFolderDragOver={handleFolderDragOver}
      onFolderDrop={handleFolderDrop}
      onFolderDragStart={handleFolderDragStart}
      onFolderDragEnd={handleFolderDragEnd}
      onStartRename={startRename}
      onRenameValueChange={setRenameValue}
      onSubmitRename={submitRename}
      onCancelRename={() => { if (!folderSavingRef.current) { setRenamingFolderId(null); setFolderActionError(''); } }}
      onCreateSubfolder={startNewFolder}
      onCreateTopLevelFolder={() => startNewFolder(null)}
      onDeleteFolder={onDeleteFolder}
    />
  );

  const recentlyViewedPapers = useMemo(() => selectLibraryView(papers, 'recently-viewed'), [papers]);
  const recentlyImportedPapers = useMemo(() => selectLibraryView(papers, 'recently-imported'), [papers]);
  const unreadPapers = useMemo(() => selectLibraryView(papers, 'unread'), [papers]);
  const favoritePapers = useMemo(() => selectLibraryView(papers, 'favorites'), [papers]);

  return (
    <div ref={sidebarRef} className="scene-context-sidebar library-scene-sidebar">
      <div className="library-sidebar-heading">
        <div>
          <strong>文献库</strong>
          <span>{papers.length} 篇文献</span>
        </div>
      </div>

      {folderActionError && newFolderTarget === null && <p className="file-tree-hint error" role="alert">{folderActionError}</p>}
      <div className="library-sidebar-scroll">
        <section className="library-sidebar-section" aria-label="快速访问">
          <header className="library-sidebar-section-heading">
            <span>快速访问</span>
          </header>
          <button type="button" className={activeFolderId === 'all' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectFolder('all')}>
            <Library size={15} aria-hidden="true" />
            <span>全部文献</span>
            <output>{papers.length}</output>
          </button>
          <button type="button" className={activeFolderId === 'recently-viewed' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectFolder('recently-viewed')}>
            <Clock size={15} aria-hidden="true" />
            <span>最近查看</span>
            <output>{recentlyViewedPapers.length}</output>
          </button>
          <button type="button" className={activeFolderId === 'recently-imported' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectFolder('recently-imported')}>
            <FileDown size={15} aria-hidden="true" />
            <span>最近导入</span>
            <output>{recentlyImportedPapers.length}</output>
          </button>
          <button type="button" className={activeFolderId === 'unread' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectFolder('unread')}>
            <BookOpen size={15} aria-hidden="true" />
            <span>未读文献</span>
            <output>{unreadPapers.length}</output>
          </button>
          <button type="button" className={activeFolderId === 'favorites' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectFolder('favorites')}>
            <Star size={15} aria-hidden="true" />
            <span>收藏文献</span>
            <output>{favoritePapers.length}</output>
          </button>
        </section>

        <section className="library-sidebar-section library-sidebar-folders" aria-label="文件类">
          <header className="library-sidebar-section-heading">
            <span>文件类</span>
            <div className="library-folder-tree-actions">
              <button type="button" className="library-sidebar-mini-button" disabled={!branchIds.length || folderSaving || newFolderTarget !== null || renamingFolderId !== null} onClick={toggleAll} title={allExpanded ? '全部折叠文件类' : '全部展开文件类'} aria-label={allExpanded ? '全部折叠文件类' : '全部展开文件类'}>
                {allExpanded ? <ChevronsDownUp size={16} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
              </button>
              <button type="button" className="library-sidebar-mini-button" disabled={folderSaving} onClick={() => startNewFolder(null)} title="新建文件类（顶层，与「默认资料库」并排）" aria-label="新建文件类"><Plus size={14} aria-hidden="true" /></button>
            </div>
          </header>
          <nav ref={treeRef} className="library-sidebar-folder-tree file-tree-tree" aria-label="文件类列表" onDragOver={handleRootDragOver} onDrop={handleRootDrop}>
            <TreeGuides containerRef={treeRef} contentRef={treeContentRef} emphasizedId={hoveredFolderId ?? activeFolderId} />
            <div ref={treeContentRef} className="file-tree-tree-content" role="tree" aria-label="文献文件类目录">
            {folderTree.length === 0 ? (
              <p className="file-tree-hint">暂无文件类</p>
            ) : (
              folderTree.map((folder) => renderFolder(folder, 0))
            )}
            {creation && creation.parentId === null && <NewFolderTreeRow depth={0} parentName="顶层（与「默认资料库」并排）" creation={creation} />}
            {draggingFolderId && (
              <div
                className="library-folder-root-drop"
                data-library-folder-root-drop="true"
                data-active={folderDropTarget?.placement === 'root' ? 'true' : undefined}
                onDragOver={handleRootDragOver}
                onDrop={handleRootDrop}
              >移到顶层（与「默认资料库」并排）</div>
            )}
            {folderDropMessage && <p className="file-tree-hint error" role="alert" data-library-folder-drop-reason="true">{folderDropMessage}</p>}
            </div>
          </nav>
        </section>

        <section className="library-sidebar-section library-sidebar-tags" aria-label="标签">
          <header className="library-sidebar-section-heading">
            <span>标签</span>
            <output>{tags.length}</output>
          </header>
          <nav className="library-sidebar-tag-list">
            <button type="button" className={activeTag === 'all' ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectTag('all')}>
              <Tag size={14} aria-hidden="true" />
              <span>全部标签</span>
            </button>
            {tags.map((tag) => (
              <button key={tag} type="button" className={activeTag === tag ? 'library-sidebar-nav active' : 'library-sidebar-nav'} onClick={() => onSelectTag(tag)} title={tag}>
                <span className="library-sidebar-tag-mark">#</span>
                <span>{tag}</span>
                <output>{papers.filter((paper) => paper.tags.includes(tag)).length}</output>
              </button>
            ))}
          </nav>
        </section>
      </div>
    </div>
  );
}

function FolderTreeNode({
  folder,
  depth,
  expandedIds,
  activeFolderId,
  folderCounts,
  dropTargetFolderId,
  folderDropTarget,
  draggingFolderId,
  renamingFolderId,
  renameValue,
  saving,
  creation,
  protectedIds,
  onHover,
  onNavigate,
  onSelectFolder,
  onToggleExpanded,
  onFolderDragOver,
  onFolderDrop,
  onFolderDragStart,
  onFolderDragEnd,
  onCreateTopLevelFolder,
  onStartRename,
  onRenameValueChange,
  onSubmitRename,
  onCancelRename,
  onCreateSubfolder,
  onDeleteFolder,
}: {
  folder: FolderNode;
  depth: number;
  expandedIds: string[];
  activeFolderId: string;
  folderCounts: Map<string, number>;
  dropTargetFolderId: string | null;
  folderDropTarget: { folderId: string | null; placement: LibraryFolderDropPlacement | 'root' } | null;
  draggingFolderId: string | null;
  renamingFolderId: string | null;
  renameValue: string;
  saving: boolean;
  creation: FolderCreation | null;
  protectedIds: string[];
  onHover(id: string | null): void;
  onNavigate(event: ReactKeyboardEvent<HTMLButtonElement>, id: string, expanded: boolean, hasChildren: boolean): void;
  onSelectFolder: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
  onFolderDragOver: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
  onFolderDrop: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
  onFolderDragStart: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
  onFolderDragEnd: () => void;
  onCreateTopLevelFolder: () => void;
  onStartRename: (folder: LibraryFolder) => void;
  onRenameValueChange: (value: string) => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>, folderId: string) => void;
  onCancelRename: () => void;
  onCreateSubfolder: (parentId: string | null) => void;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
}) {
  const containsDraft = protectedIds.includes(folder.folderId);
  const expanded = expandedIds.includes(folder.folderId) || containsDraft;
  const hasDraft = creation?.parentId === folder.folderId;
  const isRenaming = renamingFolderId === folder.folderId;
  const folderIsDropTarget = dropTargetFolderId === folder.folderId;
  const folderDropPosition = folderDropTarget?.folderId === folder.folderId ? folderDropTarget.placement : null;
  const folderIsProtected = folder.folderId === LIBRARY_ROOT_FOLDER_ID;

  return (
    <div className="library-sidebar-folder-node">
      {isRenaming ? (
        <form data-tree-row={folder.folderId} data-tree-depth={depth} data-tree-expanded={expanded ? 'true' : undefined} className="library-sidebar-inline-form folder-rename" onSubmit={(event) => onSubmitRename(event, folder.folderId)} style={{ paddingLeft: `calc(4px + ${depth} * var(--file-tree-depth-step))` }}>
          <input autoFocus disabled={saving} value={renameValue} onChange={(event) => onRenameValueChange(event.target.value)} aria-label={`重命名${folder.name}`} />
          <button type="submit" disabled={saving} title="保存" aria-label="保存">保存</button>
          <button type="button" className="cancel" disabled={saving} onClick={onCancelRename} title="取消" aria-label="取消">取消</button>
        </form>
      ) : (
        <div className="file-tree-row-wrap" data-tree-row={folder.folderId} data-tree-depth={depth} data-tree-expanded={expanded ? 'true' : undefined} onMouseEnter={() => onHover(folder.folderId)} onMouseLeave={() => onHover(null)}>
          <button
            type="button"
            className={`file-tree-row directory${activeFolderId === folder.folderId ? ' active' : ''}`}
            style={{ paddingLeft: `calc(8px + ${depth} * var(--file-tree-depth-step))` }}
            title={folder.name}
            data-library-folder-id={folder.folderId}
            role="treeitem" aria-level={depth + 1} aria-selected={activeFolderId === folder.folderId}
            aria-expanded={folder.children.length || hasDraft ? expanded : undefined}
            onFocus={() => onHover(folder.folderId)} onBlur={() => onHover(null)}
            onKeyDown={event => onNavigate(event, folder.folderId, expanded, folder.children.length > 0 || !!hasDraft)}
            data-directory="true"
            data-drop-target={folderIsDropTarget || folderDropPosition ? 'true' : undefined}
            data-drop-position={folderDropPosition ?? undefined}
            data-library-root={folderIsProtected ? 'true' : undefined}
            data-dragging={draggingFolderId === folder.folderId ? 'true' : undefined}
            draggable={!folderIsProtected && !saving}
            onDragStart={(event) => onFolderDragStart(event, folder.folderId)}
            onDragEnd={onFolderDragEnd}
            onDragOver={(event) => onFolderDragOver(event, folder.folderId)}
            onDrop={(event) => onFolderDrop(event, folder.folderId)}
            onClick={() => { onSelectFolder(folder.folderId); if (folder.children.length || hasDraft) onToggleExpanded(folder.folderId); }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              // 默认资料库 cannot be renamed, deleted or re-parented; its menu only
              // creates another top-level folder next to it.
              if (!saving) showContextMenu(event, folder, folderIsProtected ? onCreateTopLevelFolder : onCreateSubfolder, onStartRename, onDeleteFolder);
            }}
          >
            {folder.children.length > 0 || hasDraft ? <span data-tree-caret className={expanded ? 'file-tree-caret open' : 'file-tree-caret'} aria-hidden="true"><ChevronRight size={17} strokeWidth={2.35} /></span> : <span className="file-tree-caret" aria-hidden="true" />}
            {expanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
            <span className="file-tree-name">{folder.name}</span>
            <output className="library-file-tree-count">{folderCounts.get(folder.folderId) ?? 0}</output>
          </button>
        </div>
      )}
      {hasDraft && creation && <NewFolderTreeRow key={folder.folderId} depth={depth + 1} parentName={folder.name} creation={creation} />}
      {expanded && <div role="group">{folder.children.map((child) => <FolderTreeNode
        key={child.folderId} folder={child} depth={depth + 1} expandedIds={expandedIds}
        activeFolderId={activeFolderId} folderCounts={folderCounts} dropTargetFolderId={dropTargetFolderId}
        folderDropTarget={folderDropTarget} draggingFolderId={draggingFolderId}
        renamingFolderId={renamingFolderId} renameValue={renameValue} saving={saving} creation={creation} protectedIds={protectedIds} onHover={onHover} onNavigate={onNavigate} onSelectFolder={onSelectFolder}
        onToggleExpanded={onToggleExpanded} onFolderDragOver={onFolderDragOver} onFolderDrop={onFolderDrop}
        onFolderDragStart={onFolderDragStart} onFolderDragEnd={onFolderDragEnd}
        onCreateTopLevelFolder={onCreateTopLevelFolder}
        onStartRename={onStartRename} onRenameValueChange={onRenameValueChange} onSubmitRename={onSubmitRename}
        onCancelRename={onCancelRename} onCreateSubfolder={onCreateSubfolder} onDeleteFolder={onDeleteFolder}
      />)}</div>}
    </div>
  );
}


/** The draft is UI-only: no native folder exists until the user confirms. */
type FolderCreation = {
  /** null = top level, beside 默认资料库. */
  parentId: string | null;
  ancestorIds: string[];
  name: string;
  error: string;
  saving: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCancel: () => void;
};

function findFolderPath(nodes: FolderNode[], folderId: string): string[] {
  for (const node of nodes) {
    if (node.folderId === folderId) return [node.folderId];
    const childPath = findFolderPath(node.children, folderId);
    if (childPath.length) return [node.folderId, ...childPath];
  }
  return [];
}


function showContextMenu(
  event: React.MouseEvent,
  folder: LibraryFolder,
  onCreateSubfolder: (parentId: string) => void,
  onStartRename: (folder: LibraryFolder) => void,
  onDeleteFolder: (folderId: string) => void | Promise<void>
) {
  closeLibraryContextMenu?.();
  const menu = document.createElement('div');
  menu.className = 'library-sidebar-context-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.zIndex = '1000';

  const menuItems = `
    <button type="button" data-action="subfolder"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M3 6h7l2 2h9v11H3z M12 12h6 M15 9v6" stroke="currentColor" fill="none"/></svg>${folder.folderId === 'library' ? '新建文件类（顶层）' : '新建子文件类'}</button>
    ${folder.folderId === 'library' ? '' : `<button type="button" data-action="rename"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 20h4L20 8l-4-4L4 16z M14 4l4 4" stroke="currentColor" fill="none"/></svg>重命名</button>
    <button type="button" class="danger" data-action="delete"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M5 7h14 M9 7V4h6v3 M7 7l1 14h10l1-14" stroke="currentColor" fill="none"/></svg>删除</button>`}
  `;

  menu.innerHTML = menuItems;
  document.body.appendChild(menu);

  menu.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'subfolder') {
      onCreateSubfolder(folder.folderId);
    } else if (action === 'rename') {
      onStartRename(folder);
    } else if (action === 'delete') {
      void onDeleteFolder(folder.folderId);
    }

    closeMenu();
  });

  const onOutside = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) closeMenu(); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu(); };
  const closeMenu = () => {
    window.clearTimeout(timer);
    menu.remove();
    document.removeEventListener('click', onOutside);
    document.removeEventListener('keydown', onKeyDown);
    if (closeLibraryContextMenu === closeMenu) closeLibraryContextMenu = undefined;
  };
  closeLibraryContextMenu = closeMenu;
  const timer = window.setTimeout(() => {
    document.addEventListener('click', onOutside);
    document.addEventListener('keydown', onKeyDown);
  }, 0);
}
