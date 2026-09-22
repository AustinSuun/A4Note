export interface TreeGuideRow {
  id: string;
  depth: number;
  expanded: boolean;
  top: number;
  bottom: number;
  caretCenter: number;
}
export interface TreeGuideRail {
  id: string; depth: number; top: number; height: number; left: number;
  start: number; end: number;
}

/**
 * Normalise measured caret centres onto one shared depth grid. Different row DOM
 * shapes may not move their guide axis. The median residual rejects a transient
 * styled outlier while preserving the actual root inset.
 */
export function normalizeTreeGuideAxes(rows: readonly TreeGuideRow[], depthStep: number): TreeGuideRow[] {
  if (!rows.length || !Number.isFinite(depthStep) || depthStep <= 0) return [...rows];
  const origins = rows.map(row => row.caretCenter - row.depth * depthStep).sort((a, b) => a - b);
  const middle = Math.floor(origins.length / 2);
  const origin = origins.length % 2 ? origins[middle] : (origins[middle - 1] + origins[middle]) / 2;
  return rows.map(row => ({ ...row, caretCenter: origin + row.depth * depthStep }));
}

/**
 * Visible rows are preorder. An expanded node owns its complete visible subtree,
 * matching the original rainbow-rail language: vertical rails only, without
 * connector arms. Opaque IDs deliberately do not use filesystem prefix matching.
 */
export function treeGuideRails(rows: readonly TreeGuideRow[]): TreeGuideRail[] {
  const rails: TreeGuideRail[] = [];
  const stack: number[] = [];
  const finish = (start: number, end: number) => {
    if (end <= start) return;
    const row = rows[start];
    const top = row.bottom + 3;
    rails.push({
      id: row.id,
      depth: row.depth,
      top,
      height: Math.max(4, rows[end].bottom - top - 3),
      left: row.caretCenter,
      start,
      end,
    });
  };
  rows.forEach((row, index) => {
    while (stack.length && rows[stack[stack.length - 1]].depth >= row.depth) finish(stack.pop()!, index - 1);
    if (row.expanded) stack.push(index);
  });
  while (stack.length) finish(stack.pop()!, rows.length - 1);
  return rails;
}
