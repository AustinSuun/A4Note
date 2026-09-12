import { useEffect, useState, type RefObject } from 'react';
import { treeGuideRails, type TreeGuideRow } from './treeGeometry';

/** Shared by Markdown's disk tree and the library's ID-based category tree.
 * Only DOM geometry is shared here; no filesystem or repository access. */
export function TreeGuides({ containerRef, contentRef, emphasizedId, normalizeId = identity }: {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  emphasizedId?: string | null;
  normalizeId?: (id: string) => string;
}) {
  const [layout, setLayout] = useState<{ height: number; rows: TreeGuideRow[] }>({ height: 0, rows: [] });
  useEffect(() => {
    const container = containerRef.current, content = contentRef.current;
    if (!container || !content) return;
    let frame = 0, disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const bounds = container.getBoundingClientRect();
      const rows = [...content.querySelectorAll<HTMLElement>('[data-tree-row]')].filter(row => row.getClientRects().length > 0).map(row => {
        const rect = row.getBoundingClientRect();
        const caret = row.querySelector<HTMLElement>('[data-tree-caret], .file-tree-caret')?.getBoundingClientRect();
        const depth = Number(row.dataset.treeDepth) || 0;
        const step = parseFloat(getComputedStyle(container).getPropertyValue('--file-tree-depth-step')) || 20;
        return { id: row.dataset.treeRow!, depth, expanded: row.dataset.treeExpanded === 'true',
          top: rect.top - bounds.top, bottom: rect.bottom - bounds.top,
          caretCenter: caret ? caret.left + caret.width / 2 - bounds.left : 16 + depth * step };
      });
      const next = { height: content.getBoundingClientRect().height, rows };
      setLayout(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (!disposed) { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); } };
    const resize = new ResizeObserver(schedule); resize.observe(content); resize.observe(container);
    const mutation = new MutationObserver(schedule);
    mutation.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-tree-row', 'data-tree-depth', 'data-tree-expanded', 'class', 'style'] });
    window.addEventListener('resize', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); document.fonts?.removeEventListener('loadingdone', schedule); };
  }, [containerRef, contentRef]);
  const active = emphasizedId == null ? -1 : layout.rows.findIndex(row => normalizeId(row.id) === normalizeId(emphasizedId));
  return <div className="file-tree-guides" aria-hidden="true" style={{ height: Math.max(1, layout.height) }}>
    {treeGuideRails(layout.rows).map(rail => <span key={rail.id}
      className={`file-tree-guide-rail${active >= rail.start && active <= rail.end ? ' highlighted' : ''}`}
      data-guide-depth={rail.depth} data-guide-color={rail.depth % 6} data-guide-id={rail.id}
      style={{ top: rail.top, height: rail.height, left: rail.left }} />)}
  </div>;
}
function identity(id: string) { return id; }
