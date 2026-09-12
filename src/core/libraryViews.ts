import type { LibraryFolder, PaperDocument } from './types';

export const librarySmartViews = ['all', 'recently-viewed', 'recently-imported', 'unread', 'favorites'] as const;
export function isLibrarySmartView(id: string) { return (librarySmartViews as readonly string[]).includes(id); }
function timestamp(value: string | undefined) { const result = value ? Date.parse(value) : NaN; return Number.isFinite(result) ? result : null; }
/** Query and tag filtering can be composed with this without a second folder filter. */
export function selectLibraryView(papers: PaperDocument[], id: string): PaperDocument[] {
  switch (id) {
    case 'all': return papers;
    case 'unread': return papers.filter((paper) => !paper.isRead);
    case 'favorites': return papers.filter((paper) => paper.isFavorite);
    case 'recently-viewed': return papers.filter((paper) => timestamp(paper.lastViewedAt) !== null)
      .sort((a, b) => timestamp(b.lastViewedAt)! - timestamp(a.lastViewedAt)! || a.paperId.localeCompare(b.paperId));
    case 'recently-imported': return papers.filter((paper) => timestamp(paper.createdAt) !== null)
      .sort((a, b) => timestamp(b.createdAt)! - timestamp(a.createdAt)! || a.paperId.localeCompare(b.paperId)).slice(0, 50);
    default: return papers.filter((paper) => (paper.folderId || 'library') === id);
  }
}

export type LibraryFolderNode = LibraryFolder & { children: LibraryFolderNode[] };
/** Include the immutable root so unfiled papers remain reachable; keep orphaned rows visible. */
export function buildLibraryFolderTree(folders: LibraryFolder[]): LibraryFolderNode[] {
  const nodes = new Map(folders.map((folder) => [folder.folderId, { ...folder, children: [] as LibraryFolderNode[] }]));
  if (!nodes.has('library')) nodes.set('library', { folderId: 'library', name: '默认资料库', parentId: null, children: [] });
  const roots: LibraryFolderNode[] = [];
  for (const node of nodes.values()) {
    let ancestor = node.parentId;
    const visited = new Set([node.folderId]);
    let cyclic = false;
    while (ancestor && nodes.has(ancestor)) {
      if (visited.has(ancestor)) { cyclic = true; break; }
      visited.add(ancestor); ancestor = nodes.get(ancestor)!.parentId;
    }
    const parent = !cyclic && node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const sort = (items: LibraryFolderNode[]) => {
    items.sort((a, b) => a.folderId === 'library' ? -1 : b.folderId === 'library' ? 1 : a.name.localeCompare(b.name, 'zh-CN'));
    items.forEach((item) => sort(item.children));
  };
  sort(roots); return roots;
}
