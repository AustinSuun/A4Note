import { type KeyboardEvent, useMemo } from 'react';
import { WorkspacePanelHost } from '../../workbench';
import { zh } from '../../ui/zh';
import { LibraryDetailPanel } from './LibraryDetailPanel';
import type { LibrarySceneProps, LibrarySortDirection, LibrarySortKey } from './types';

export function LibraryScene({
  papers,
  selectedPaper,
  tags,
  activeTag,
  query,
  sort,
  status,
  lastImportedPaperTitle,
  detailOpen,
  aiThreadContexts,
  bulkSelectedPaperIds,
  searchInputRef,
  sidePanels,
  onQueryChange,
  onSelectPaper,
  onBulkSelectionChange,
  onOpenPaper,
  onSelectTag,
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
  onCopyMarkdown,
  onCopyCsv,
  onCopyBibtex,
  onCopyBulkBibtex,
}: LibrarySceneProps) {
  const selectedIndex = selectedPaper ? papers.findIndex((paper) => paper.paperId === selectedPaper.paperId) : -1;
  const selectedSet = useMemo(() => new Set(bulkSelectedPaperIds), [bulkSelectedPaperIds]);
  const allVisibleSelected = papers.length > 0 && papers.every((paper) => selectedSet.has(paper.paperId));

  const toggleSort = (key: LibrarySortKey) => {
    if (sort.key === key) {
      onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
      return;
    }
    onSortChange({ key, direction: key === 'year' ? 'desc' : 'asc' });
  };

  const handleTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!papers.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, papers.length - 1);
      onSelectPaper(papers[nextIndex].paperId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
      onSelectPaper(papers[nextIndex].paperId);
      return;
    }
    if (event.key === 'Enter' && selectedPaper) {
      event.preventDefault();
      onOpenPaper(selectedPaper.paperId);
    }
  };

  const toggleBulkPaper = (paperId: string) => {
    onBulkSelectionChange(selectedSet.has(paperId) ? bulkSelectedPaperIds.filter((id) => id !== paperId) : [...bulkSelectedPaperIds, paperId]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onBulkSelectionChange(bulkSelectedPaperIds.filter((paperId) => !papers.some((paper) => paper.paperId === paperId)));
      return;
    }
    onBulkSelectionChange(Array.from(new Set([...bulkSelectedPaperIds, ...papers.map((paper) => paper.paperId)])));
  };

  return (
    <section className="scene active">
      <header className="topbar compact">
        <div>
          <h1>{zh.library.title}</h1>
          <p className="scene-description">{zh.library.subtitle}</p>
          <p className="library-status">{status}</p>
          <p className="library-status">{zh.library.shortcutsHint}</p>
          {lastImportedPaperTitle ? <p className="import-next-step">{zh.library.recentImport(lastImportedPaperTitle)}</p> : null}
        </div>
        <button type="button" className="primary import-primary rounded-button" onClick={onOpenImport}>
          {zh.library.importPdf}
        </button>
      </header>
      <div className="library-layout">
        <section className="library-main">
          <div className="search-strip">
            <input ref={searchInputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={zh.library.search} />
          </div>
          <div className="library-actions">
            <span>{selectedPaper ? `${zh.library.selected(selectedPaper.title)} - ${selectedIndex + 1}/${papers.length}` : zh.library.noSelection}</span>
            <div>
              <button type="button" onClick={onOpenReader} disabled={!selectedPaper}>
                {zh.library.openReader}
              </button>
              <button type="button" onClick={() => onDetailOpenChange(!detailOpen)} disabled={!selectedPaper}>
                {detailOpen ? zh.library.hideDetails : zh.library.details}
              </button>
              <button type="button" onClick={onOpenRelations} disabled={!selectedPaper}>
                {zh.library.viewRelations}
              </button>
              <button type="button" onClick={onOpenTranslationImport} disabled={!selectedPaper}>
                {zh.library.importTranslationPdf}
              </button>
              <button type="button" onClick={onOpenMetadataEdit} disabled={!selectedPaper}>
                {zh.library.edit}
              </button>
              <button type="button" onClick={onOpenTagsEdit} disabled={!selectedPaper}>
                {zh.library.tagsEdit}
              </button>
              <button type="button" onClick={onCopyBibtex} disabled={!selectedPaper}>
                {zh.library.copyBibtex}
              </button>
              <button type="button" onClick={onCopyMarkdown} disabled={!papers.length}>
                {zh.library.copyMarkdown}
              </button>
              <button type="button" onClick={onCopyCsv} disabled={!papers.length}>
                {zh.library.copyCsv}
              </button>
              <button type="button" className="danger" onClick={onDeletePaper} disabled={!selectedPaper}>
                {zh.library.delete}
              </button>
            </div>
          </div>
          <p className="table-hint">{zh.library.openHint}</p>
          {bulkSelectedPaperIds.length > 0 && (
            <div className="bulk-actions">
              <span>{zh.library.bulkSelected(bulkSelectedPaperIds.length)}</span>
              <div>
                <button type="button" onClick={onOpenBulkTagsEdit}>
                  {zh.library.bulkEditTags}
                </button>
                <button type="button" onClick={onCopyBulkBibtex}>
                  {zh.library.copyBibtex}
                </button>
                <button type="button" className="danger" onClick={onBulkDelete}>
                  {zh.library.bulkDelete}
                </button>
                <button type="button" onClick={() => onBulkSelectionChange([])}>
                  {zh.library.clearSelection}
                </button>
              </div>
            </div>
          )}
          {papers.length ? (
            <div className="paper-table-wrap" tabIndex={0} onKeyDown={handleTableKeyDown}>
              <table className="paper-table">
                <thead>
                  <tr>
                    <th className="select-col">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={zh.library.selectAll} />
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('title')}>
                        {zh.library.tableTitle}
                        <SortIndicator active={sort.key === 'title'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('authors')}>
                        {zh.library.tableAuthors}
                        <SortIndicator active={sort.key === 'authors'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('year')}>
                        {zh.library.tableYear}
                        <SortIndicator active={sort.key === 'year'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => toggleSort('venue')}>
                        {zh.library.tableVenue}
                        <SortIndicator active={sort.key === 'venue'} direction={sort.direction} />
                      </button>
                    </th>
                    <th>{zh.library.tableTags}</th>
                  </tr>
                </thead>
                <tbody>
                  {papers.map((paper) => (
                    <tr
                      key={paper.paperId}
                      className={paper.paperId === selectedPaper?.paperId ? 'selected' : ''}
                      onClick={() => onSelectPaper(paper.paperId)}
                      onDoubleClick={() => onOpenPaper(paper.paperId)}
                    >
                      <td className="select-col" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedSet.has(paper.paperId)} onChange={() => toggleBulkPaper(paper.paperId)} aria-label={zh.library.selectPaper(paper.title)} />
                      </td>
                      <td className="title-cell">{paper.title}</td>
                      <td>{paper.authors || zh.library.unknownAuthors}</td>
                      <td>{paper.year || '-'}</td>
                      <td>{paper.venue || zh.library.unknownVenue}</td>
                      <td>
                        <div className="tag-row compact-tags">
                          {paper.tags.slice(0, 3).map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LibraryEmptyState hasQuery={Boolean(query || activeTag !== 'all')} onOpenImport={onOpenImport} />
          )}
        </section>
        {detailOpen && selectedPaper ? (
          <WorkspacePanelHost
            panels={sidePanels}
            activePanelId="library.details"
            className="library-detail-panel"
            closeTitle={zh.reader.closePanel}
            onActivePanelChange={() => undefined}
            onClose={() => onDetailOpenChange(false)}
            renderPanel={() => (
              <LibraryDetailPanel
                paper={selectedPaper}
                aiThreadContexts={aiThreadContexts}
                onOpenReader={onOpenReader}
                onOpenRelations={onOpenRelations}
                onOpenTranslationImport={onOpenTranslationImport}
                onRevealSourcePdf={onRevealSourcePdf}
                onRevealTranslatedPdf={onRevealTranslatedPdf}
                onOpenSourcePdfExternal={onOpenSourcePdfExternal}
                onOpenTranslatedPdfExternal={onOpenTranslatedPdfExternal}
                onOpenMetadataEdit={onOpenMetadataEdit}
                onOpenTagsEdit={onOpenTagsEdit}
                onCopyBibtex={onCopyBibtex}
              />
            )}
          />
        ) : (
          <aside className="soft-panel tag-panel">
            <div className="panel-title">{zh.library.tags}</div>
            <div className="tag-wall">
              <button className={activeTag === 'all' ? 'active' : ''} type="button" onClick={() => onSelectTag('all')}>
                {zh.library.all}
              </button>
              {tags.map((tag) => (
                <button key={tag} className={activeTag === tag ? 'active' : ''} type="button" onClick={() => onSelectTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: LibrarySortDirection }) {
  return <span className={active ? 'sort-indicator active' : 'sort-indicator'}>{direction === 'asc' ? '^' : 'v'}</span>;
}

function LibraryEmptyState({ hasQuery, onOpenImport }: { hasQuery: boolean; onOpenImport: () => void }) {
  return (
    <div className="library-empty">
      <h2>{hasQuery ? zh.library.noMatchTitle : zh.library.emptyTitle}</h2>
      <p>{hasQuery ? zh.library.noMatchDescription : zh.library.emptyDescription}</p>
      {!hasQuery && (
        <button type="button" className="primary import-empty-button rounded-button" onClick={onOpenImport}>
          {zh.library.importPdf}
        </button>
      )}
    </div>
  );
}
