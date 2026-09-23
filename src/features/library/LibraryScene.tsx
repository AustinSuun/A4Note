import './library-typography.css';
import { SummaryProvisionNotice } from './SummaryProvisionNotice';
import { LibraryStorageNotice } from './LibraryStorageNotice';
import { PaperSignals } from '../PaperSignals';
import { LibraryNotesView } from './LibraryNotesView';
import { LibraryViewSwitch } from './LibraryViewSwitch';
import { ColumnSettings } from './ColumnSettings';
import { type DragEvent as ReactDragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PaperContextMenu, type PaperMenuAnchor } from './PaperContextMenu';
import type { LibraryFolder, PaperDocument } from '../../core/types';
import { WorkspacePanelHost } from '../../workbench';
import { zh } from '../../ui/zh';
import { LibraryOverview } from './LibraryOverview';
import type { LibrarySceneProps, LibrarySortDirection, LibrarySortKey } from './types';

type LibraryIconName = 'library' | 'folder' | 'translate' | 'search' | 'close' | 'import' | 'book' | 'details' | 'relations' | 'more' | 'export' | 'columns' | 'tag' | 'edit' | 'trash';
type LibraryColumnId = 'authors' | 'year' | 'venue' | 'tags';

const LIBRARY_COLUMNS_STORAGE_KEY = 'aster.libraryColumns';
const defaultLibraryColumns: Record<LibraryColumnId, boolean> = { authors: true, year: true, venue: true, tags: true };
const libraryColumnLabels: Record<LibraryColumnId, string> = { authors: '作者', year: '年份', venue: '来源', tags: '标签' };

export function LibraryScene({
  papers,
  folders,
  selectedPaper,
  tags,
  activeTag,
  activeFolderId,
  query,
  sort,
  detailOpen,
  aiThreadContexts,
  bulkSelectedPaperIds,
  searchInputRef,
  sidePanels,
  panelViews = [],
  onQueryChange,
  onSelectPaper,
  onBulkSelectionChange,
  onMovePapersToFolder,
  onOpenPaper,
  onOpenNote,
  onCreateNote,
  onSelectTag,
  onSelectFolder,
  onSortChange,
  onDetailOpenChange,
  onOpenImport,
  onOpenReader,
  onOpenRelations,
  onOpenTranslationImport,
  onRevealSourcePdf,
  onRevealTranslatedPdf,
  onOpenSourcePdfExternal,
  onOpenTranslatedPdfExternal,
  onOpenMetadataEdit,
  onOpenTagsEdit,
  onOpenBulkTagsEdit,
  onBulkDelete,
  onDeletePaper,
  onCopyBibtex,
  onCopyBulkBibtex,
}: LibrarySceneProps) {
  const [paperMenu, setPaperMenu] = useState<PaperMenuAnchor | null>(null);
  const closePaperMenu = useCallback(() => setPaperMenu(null), []);
  const [view, setView] = useState<'list' | 'overview' | 'notes'>('list');
  const [visibleColumns, setVisibleColumns] = useState<Record<LibraryColumnId, boolean>>(loadLibraryColumns);

  // The host supplies the single filtered/sorted list used by the view and exports.
  const visiblePapers = papers;
  const selectedInView = selectedPaper && visiblePapers.some((paper) => paper.paperId === selectedPaper.paperId) ? selectedPaper : null;
  const selectedIndex = selectedInView ? visiblePapers.findIndex((paper) => paper.paperId === selectedInView.paperId) : -1;
  const selectedSet = useMemo(() => new Set(bulkSelectedPaperIds), [bulkSelectedPaperIds]);
  const allVisibleSelected = visiblePapers.length > 0 && visiblePapers.every((paper) => selectedSet.has(paper.paperId));
  const filtersActive = Boolean(query || activeTag !== 'all' || activeFolderId !== 'all');
  // Details are a plugin-owned workbench panel. Do not let stale UI state open
  // a host-only shell when the plugin has been disabled or its view is absent.
  const detailPanel = sidePanels.find((panel) => panel.id === 'library.details')?.panel;
  const detailView = panelViews.find((view) => view.id === 'library.details' && view.sceneId === 'library');
  const detailVisible = Boolean(detailOpen && selectedInView && detailPanel && detailView);

  const menuPaper = paperMenu && selectedInView?.paperId === paperMenu.paperId ? selectedInView : null;
  useEffect(() => { setPaperMenu(null); }, [query, activeTag, activeFolderId, view]);
  useEffect(() => {
    if (paperMenu && paperMenu.paperId !== selectedInView?.paperId) setPaperMenu(null);
  }, [paperMenu, selectedInView?.paperId]);
  const openPaperMenu = (paperId: string, x: number, y: number, trigger: HTMLElement) => {
    // Select before rendering actions: callbacks supplied by the host use the selected paper.
    onSelectPaper(paperId);
    setPaperMenu({ paperId, x, y, trigger });
  };


  useEffect(() => {
    localStorage.setItem(LIBRARY_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const toggleSort = (key: LibrarySortKey) => {
    if (sort.key === key) {
      onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
      return;
    }
    onSortChange({ key, direction: key === 'year' ? 'desc' : 'asc' });
  };

  const handleTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !visiblePapers.length) return;
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && selectedInView) {
      event.preventDefault();
      const row = event.currentTarget.querySelector('tr.selected');
      const rect = row?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
      openPaperMenu(selectedInView.paperId, rect.left + 36, rect.top + 24, event.currentTarget);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, visiblePapers.length - 1);
      onSelectPaper(visiblePapers[nextIndex].paperId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
      onSelectPaper(visiblePapers[nextIndex].paperId);
      return;
    }
    if (event.key === 'Enter' && selectedInView) {
      event.preventDefault();
      onOpenPaper(selectedInView.paperId);
    }
  };

  const toggleBulkPaper = (paperId: string) => {
    onBulkSelectionChange(selectedSet.has(paperId) ? bulkSelectedPaperIds.filter((id) => id !== paperId) : [...bulkSelectedPaperIds, paperId]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onBulkSelectionChange(bulkSelectedPaperIds.filter((paperId) => !visiblePapers.some((paper) => paper.paperId === paperId)));
      return;
    }
    onBulkSelectionChange(Array.from(new Set([...bulkSelectedPaperIds, ...visiblePapers.map((paper) => paper.paperId)])));
  };

  const clearFilters = () => {
    onSelectFolder('all');
    onSelectTag('all');
    onQueryChange('');
  };

  return (
    <section className={`scene active library-scene ${view === 'overview' ? 'overview-mode' : ''}`}>
      <div className={`library-layout ${detailVisible ? 'detail-open' : ''}`.trim()}>
        <section className="library-main">
          <SummaryProvisionNotice />
          <LibraryStorageNotice />
          <div className="library-commandbar">
            <LibraryViewSwitch view={view} onChange={setView} />
            <label className="library-search-field">
              <LibraryIcon name="search" />
              <input ref={searchInputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={zh.library.search} />
              {query && (
                <button type="button" onClick={() => onQueryChange('')} title="清除搜索" aria-label="清除搜索">
                  <LibraryIcon name="close" />
                </button>
              )}
            </label>
            <span className="library-result-count">{visiblePapers.length} 条结果</span>
            <button
              type="button"
              className={detailVisible ? 'library-icon-button active' : 'library-icon-button'}
              onClick={() => onDetailOpenChange(!detailOpen)}
              disabled={!selectedInView}
              title={detailVisible ? zh.library.hideDetails : zh.library.details}
              aria-label={detailVisible ? zh.library.hideDetails : zh.library.details}
            >
              <LibraryIcon name="details" />
            </button>
            {view === 'list' && <ColumnSettings columns={[
              { id: 'title', label: '标题', visible: true, fixed: true },
              ...(Object.keys(libraryColumnLabels) as LibraryColumnId[]).map(id => ({ id, label: libraryColumnLabels[id], visible: visibleColumns[id] })),
            ]} onChange={(id, visible) => {
              if (Object.hasOwn(libraryColumnLabels, id)) setVisibleColumns(current => ({ ...current, [id]: visible }));
            }} />}
            <button type="button" className="primary library-import-button" onClick={onOpenImport}>
              <LibraryIcon name="import" />
              <span>{zh.library.importPdf}</span>
            </button>
          </div>



          {bulkSelectedPaperIds.length > 0 ? (
            <div className="bulk-actions library-bulkbar">
              <span>{zh.library.bulkSelected(bulkSelectedPaperIds.length)}</span>
              <div>
                <FolderMoveMenu folders={folders} onMove={(folderId) => onMovePapersToFolder(bulkSelectedPaperIds, folderId)} />
                <button type="button" onClick={onOpenBulkTagsEdit}><LibraryIcon name="tag" />{zh.library.bulkEditTags}</button>
                <button type="button" onClick={onCopyBulkBibtex}><LibraryIcon name="export" />{zh.library.copyBibtex}</button>
                <button type="button" className="danger" onClick={onBulkDelete}><LibraryIcon name="trash" />{zh.library.bulkDelete}</button>
                <button type="button" onClick={() => onBulkSelectionChange([])}>{zh.library.clearSelection}</button>
              </div>
            </div>
          ) : null}

          {view === 'notes' ? (
            <LibraryNotesView papers={visiblePapers} onOpenPaper={onOpenPaper} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />
          ) : view === 'overview' ? (
            <LibraryOverview papers={visiblePapers} selectedIds={bulkSelectedPaperIds} selectedId={selectedInView?.paperId} onSelect={onSelectPaper} onSelection={onBulkSelectionChange} onOpen={onOpenPaper} />
          ) : visiblePapers.length ? (
            <div className="paper-table-wrap" tabIndex={0} onKeyDown={handleTableKeyDown}>
              <table className="paper-table library-paper-index">
                <thead>
                  <tr>
                    <th className="select-col"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={zh.library.selectAll} /></th>
                    <SortableHeader className="title-col" label={zh.library.tableTitle} sortKey="title" sort={sort} onToggle={toggleSort} />
                    {visibleColumns.authors && <SortableHeader className="authors-col" label={zh.library.tableAuthors} sortKey="authors" sort={sort} onToggle={toggleSort} />}
                    {visibleColumns.year && <SortableHeader className="year-col" label={zh.library.tableYear} sortKey="year" sort={sort} onToggle={toggleSort} />}
                    {visibleColumns.venue && <SortableHeader className="venue-col" label={zh.library.tableVenue} sortKey="venue" sort={sort} onToggle={toggleSort} />}
                    {visibleColumns.tags && <th className="tags-col">{zh.library.tableTags}</th>}
                    <th className="actions-col"><span className="library-visually-hidden">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePapers.map((paper) => (
                    <tr
                      key={paper.paperId}
                      className={`${paper.paperId === selectedInView?.paperId ? 'selected' : ''} ${selectedSet.has(paper.paperId) ? 'bulk-selected' : ''}`.trim()}
                      draggable
                      onDragStart={(event) => writePaperDragData(event, selectedSet.has(paper.paperId) ? bulkSelectedPaperIds : [paper.paperId])}
                      onClick={() => onSelectPaper(paper.paperId)}
                      onDoubleClick={() => onOpenPaper(paper.paperId)}
                      onContextMenu={(event) => {
                        event.preventDefault(); event.stopPropagation();
                        openPaperMenu(paper.paperId, event.clientX, event.clientY, event.currentTarget.closest<HTMLElement>('.paper-table-wrap') ?? event.currentTarget);
                      }}
                    >
                      <td className="select-col" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedSet.has(paper.paperId)} onChange={() => toggleBulkPaper(paper.paperId)} aria-label={zh.library.selectPaper(paper.title)} />
                      </td>
                      <td className="title-cell title-col">
                        <div className="paper-index-title" title={paper.title}>{paper.title}</div>
                        <PaperSignals paper={paper} />
                      </td>
                      {visibleColumns.authors && <td className="authors-col" title={paper.authors || zh.library.unknownAuthors}>{paper.authors || zh.library.unknownAuthors}</td>}
                      {visibleColumns.year && <td className="year-col">{paper.year || '-'}</td>}
                      {visibleColumns.venue && <td className="venue-col" title={paper.venue || zh.library.unknownVenue}>{paper.venue || zh.library.unknownVenue}</td>}
                      {visibleColumns.tags && <td className="tags-col">
                        <div className="tag-row compact-tags">
                          {paper.tags.slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                          {paper.tags.length > 2 && <span className="tag tag-more">+{paper.tags.length - 2}</span>}
                        </div>
                      </td>}
                      <td className="actions-col" onDoubleClick={(event) => event.stopPropagation()}>
                        <button type="button" className="library-icon-button library-row-menu-trigger"
                          title={`操作：${paper.title}`} aria-label={`操作：${paper.title}`} aria-haspopup="menu"
                          aria-expanded={menuPaper?.paperId === paper.paperId}
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            openPaperMenu(paper.paperId, rect.left, rect.bottom + 4, event.currentTarget);
                          }}><LibraryIcon name="more" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LibraryEmptyState hasFilters={filtersActive} onClearFilters={clearFilters} onOpenImport={onOpenImport} />
          )}
        </section>

        {detailVisible && selectedInView && (
          <WorkspacePanelHost
            panels={sidePanels}
            activePanelId="library.details"
            className="library-detail-panel"
            closeTitle={zh.reader.closePanel}
            onActivePanelChange={() => undefined}
            onClose={() => onDetailOpenChange(false)}
            renderPanel={() => {
              // detailVisible guarantees both contributions exist. Keep the
              // guard robust to a registry update between renders without
              // manufacturing fallback metadata.
              if (!detailPanel || !detailView) return null;
              return detailView.render({
                panel: detailPanel,
                sceneId: 'library',
                selectedPaper: selectedInView,
              });
            }}
          />
        )}
      </div>
      {paperMenu && menuPaper && <PaperContextMenu key={menuPaper.paperId} anchor={paperMenu} paper={menuPaper} folders={folders}
        onClose={closePaperMenu}
        onRead={() => onOpenPaper(menuPaper.paperId)} onDetails={() => onDetailOpenChange(true)}
        onRelations={onOpenRelations} onEdit={onOpenMetadataEdit} onTags={onOpenTagsEdit}
        onRevealSourcePdf={() => onRevealSourcePdf(menuPaper.paperId)}
        onTranslation={onOpenTranslationImport} onCopy={onCopyBibtex} onDelete={onDeletePaper}
        onMove={(folderId) => onMovePapersToFolder([menuPaper.paperId], folderId)} />}
    </section>
  );
}

function SortableHeader({
  className,
  label,
  sortKey,
  sort,
  onToggle,
}: {
  className?: string;
  label: string;
  sortKey: LibrarySortKey;
  sort: { key: LibrarySortKey; direction: LibrarySortDirection };
  onToggle: (key: LibrarySortKey) => void;
}) {
  return (
    <th className={className}>
      <button type="button" className="table-sort" onClick={() => onToggle(sortKey)}>
        {label}
        <SortIndicator active={sort.key === sortKey} direction={sort.direction} />
      </button>
    </th>
  );
}

function FolderMoveMenu({ folders, onMove }: { folders: LibraryFolder[]; onMove: (folderId: string | null) => void }) {
  return (
    <details className="library-menu library-folder-move-menu">
      <summary title="移动到文件夹" aria-label="移动到文件夹"><LibraryIcon name="folder" /></summary>
      <div className="library-menu-popover align-right">
        <button type="button" onClick={(event) => runMenuAction(event.currentTarget, () => onMove('library'))}><LibraryIcon name="folder" />默认资料库</button>
        {folders.filter((folder) => folder.folderId !== 'library').map((folder) => (
          <button key={folder.folderId} type="button" onClick={(event) => runMenuAction(event.currentTarget, () => onMove(folder.folderId))}><LibraryIcon name="folder" />{folder.name}</button>
        ))}
      </div>
    </details>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: LibrarySortDirection }) {
  return (
    <svg className={active ? 'sort-indicator active' : 'sort-indicator'} viewBox="0 0 16 16" aria-hidden="true">
      <path d={direction === 'asc' ? 'm4.5 10 3.5-4 3.5 4' : 'm4.5 6 3.5 4 3.5-4'} />
    </svg>
  );
}

function LibraryEmptyState({ hasFilters, onClearFilters, onOpenImport }: { hasFilters: boolean; onClearFilters: () => void; onOpenImport: () => void }) {
  return (
    <div className="library-empty">
      <h2>{hasFilters ? zh.library.noMatchTitle : zh.library.emptyTitle}</h2>
      <p>{hasFilters ? zh.library.noMatchDescription : zh.library.emptyDescription}</p>
      <button type="button" className={hasFilters ? '' : 'primary'} onClick={hasFilters ? onClearFilters : onOpenImport}>
        {hasFilters ? '清除筛选' : zh.library.importPdf}
      </button>
    </div>
  );
}



function runMenuAction(button: HTMLElement, action: () => void) {
  button.closest('details')?.removeAttribute('open');
  action();
}

function writePaperDragData(event: ReactDragEvent<HTMLElement>, paperIds: string[]) {
  const ids = Array.from(new Set(paperIds));
  if (!ids.length) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-a4note-paper-ids', JSON.stringify(ids));
  event.dataTransfer.setData('text/plain', ids.join(','));
}

function loadLibraryColumns(): Record<LibraryColumnId, boolean> {
  try {
    const stored = JSON.parse(localStorage.getItem(LIBRARY_COLUMNS_STORAGE_KEY) ?? '{}') as Partial<Record<LibraryColumnId, boolean>>;
    return {
      authors: typeof stored.authors === 'boolean' ? stored.authors : defaultLibraryColumns.authors,
      year: typeof stored.year === 'boolean' ? stored.year : defaultLibraryColumns.year,
      venue: typeof stored.venue === 'boolean' ? stored.venue : defaultLibraryColumns.venue,
      tags: typeof stored.tags === 'boolean' ? stored.tags : defaultLibraryColumns.tags,
    };
  } catch {
    return defaultLibraryColumns;
  }
}

const iconPaths: Record<LibraryIconName, string[]> = {
  library: ['M3 5.5h7l2 2h9v11H3z'],
  folder: ['M3 6h7l2 2h9v11H3z'],
  translate: ['M4 5h10', 'M9 3v2c0 4-2 7-5 9', 'M6 10c1 2 3 4 6 5', 'm14 9 5 12', 'm12 17h8'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z', 'm16 16 5 5'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  import: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  book: ['M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23z', 'M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23z'],
  details: ['M4 4h16v16H4z', 'M14 4v16'],
  relations: ['M6 6h.1', 'M18 5h.1', 'M17 18h.1', 'M7 18h.1', 'm7 7 4 4', 'm6 17 5-5', 'm7 1 9 3', 'm13 12 4 5'],
  more: ['M6 12h.1', 'M12 12h.1', 'M18 12h.1'],
  export: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  columns: ['M4 5h16v14H4z', 'M10 5v14', 'M16 5v14'],
  tag: ['M4 4h7l9 9-7 7-9-9z', 'M8 8h.1'],
  edit: ['M4 20h4L20 8l-4-4L4 16z', 'm14-14 4 4'],
  trash: ['M5 7h14', 'M9 7V4h6v3', 'm7 0 1 14h10l1-14'],
};

function LibraryIcon({ name }: { name: LibraryIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
