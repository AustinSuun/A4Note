import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type OutlineItem = {
  title: string;
  page: number | null;
  depth: number;
  items: OutlineItem[];
};

type PdfOutlineNode = {
  title: string;
  dest: unknown;
  items: PdfOutlineNode[];
};

async function resolveOutlinePages(
  nodes: PdfOutlineNode[],
  pdfDoc: PDFDocumentProxy,
  depth: number
): Promise<OutlineItem[]> {
  if (depth > 4) return [];
  const results: OutlineItem[] = [];
  for (const node of nodes) {
    let page: number | null = null;
    try {
      const dest = Array.isArray(node.dest) ? node.dest : typeof node.dest === 'string' ? await pdfDoc.getDestination(node.dest) : null;
      if (dest && Array.isArray(dest) && dest[0]) {
        const ref = dest[0];
        page = await pdfDoc.getPageIndex(ref).then((idx) => idx + 1);
      }
    } catch { /* dest 解析失败时跳过 */ }
    const children = node.items?.length ? await resolveOutlinePages(node.items, pdfDoc, depth + 1) : [];
    results.push({ title: node.title ?? '(无标题)', page, depth, items: children });
  }
  return results;
}

export function PdfOutlinePanel({
  pdfDocument,
  onJumpToPage,
}: {
  pdfDocument: PDFDocumentProxy | null;
  onJumpToPage: (page: number) => void;
}) {
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pdfDocument) { setLoading(false); setOutline([]); return; }
    setLoading(true);
    pdfDocument.getOutline().then(async (rawOutline) => {
      if (!rawOutline?.length) { setOutline([]); setLoading(false); return; }
      const resolved = await resolveOutlinePages(rawOutline as PdfOutlineNode[], pdfDocument, 0);
      setOutline(resolved);
      setLoading(false);
    }).catch(() => { setOutline([]); setLoading(false); });
  }, [pdfDocument]);

  if (loading) {
    return <div className="pdf-outline-loading">加载中…</div>;
  }
  if (!outline.length) {
    return <div className="pdf-outline-empty"><span>本文档没有目录</span></div>;
  }
  return (
    <nav className="pdf-outline" aria-label="PDF 目录">
      <OutlineList items={outline} onJumpToPage={onJumpToPage} />
    </nav>
  );
}

function OutlineList({ items, onJumpToPage }: { items: OutlineItem[]; onJumpToPage: (page: number) => void }) {
  return (
    <>
      {items.map((item, idx) => (
        <OutlineEntry key={idx} item={item} onJumpToPage={onJumpToPage} />
      ))}
    </>
  );
}

function OutlineEntry({ item, onJumpToPage }: { item: OutlineItem; onJumpToPage: (page: number) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.items.length > 0;

  return (
    <div className="pdf-outline-entry" style={{ paddingLeft: `${item.depth * 10}px` }}>
      <div className="pdf-outline-row">
        {hasChildren && (
          <button
            className="pdf-outline-expand"
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '折叠' : '展开'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        {!hasChildren && <span className="pdf-outline-spacer" />}
        <button
          className="pdf-outline-item"
          type="button"
          onClick={() => item.page !== null && onJumpToPage(item.page)}
          disabled={item.page === null}
          title={item.page !== null ? `第 ${item.page} 页` : undefined}
        >
          <span className="pdf-outline-title">{item.title}</span>
          {item.page !== null && <span className="pdf-outline-page">{item.page}</span>}
        </button>
      </div>
      {hasChildren && expanded && (
        <div className="pdf-outline-children">
          <OutlineList items={item.items} onJumpToPage={onJumpToPage} />
        </div>
      )}
    </div>
  );
}
