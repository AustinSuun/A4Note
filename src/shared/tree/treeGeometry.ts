export interface TreeGuideRow {
  id: string;
  depth: number;
  expanded: boolean;
  top: number;
  bottom: number;
  caretCenter: number;
  caretHalfWidth?: number;
}
export interface TreeGuideRail {
  id: string; depth: number; top: number; height: number; left: number;
  start: number; end: number;
}
export interface TreeGuideBranch {
  id: string; depth: number; top: number; left: number; width: number;
}
export interface TreeGuideLayout {
  rails: TreeGuideRail[];
  branches: TreeGuideBranch[];
}

const rowCenter = (row: TreeGuideRow) => (row.top + row.bottom) / 2;

/**
 * Normalise every measured caret onto one shared depth grid. A row can use a
 * button, wrapper, rename form or draft DOM shape; none of those may move its
 * guide axis. The median residual rejects a single transient/styled outlier.
 */
export function normalizeTreeGuideAxes(rows: readonly TreeGuideRow[], depthStep: number): TreeGuideRow[] {
  if (!rows.length || !Number.isFinite(depthStep) || depthStep <= 0) return [...rows];
  const origins = rows.map(row => row.caretCenter - row.depth * depthStep).sort((a, b) => a - b);
  const middle = Math.floor(origins.length / 2);
  const origin = origins.length % 2 ? origins[middle] : (origins[middle - 1] + origins[middle]) / 2;
  return rows.map(row => ({ ...row, caretCenter: origin + row.depth * depthStep }));
}

/** Visible rows are in preorder. Rails join direct children; they do not run
 * down to the bottom of the deepest descendant. Branch arms terminate before
 * the current row's caret/spacer, so a parent line cannot cross a child icon. */
export function treeGuideLayout(rows: readonly TreeGuideRow[]): TreeGuideLayout {
  const rails: TreeGuideRail[] = [];
  const branches: TreeGuideBranch[] = [];
  const stack: Array<{ start: number; lastDirect: number | null }> = [];
  const finish = (branch: { start: number; lastDirect: number | null }, end: number) => {
    if (branch.lastDirect == null) return;
    const owner = rows[branch.start];
    const top = owner.bottom + 3;
    const bottom = rowCenter(rows[branch.lastDirect]);
    rails.push({
      id: owner.id,
      depth: owner.depth,
      top,
      height: Math.max(1, bottom - top),
      left: owner.caretCenter,
      start: branch.start,
      end,
    });
  };

  rows.forEach((row, index) => {
    while (stack.length && rows[stack[stack.length - 1].start].depth >= row.depth) {
      finish(stack.pop()!, index - 1);
    }
    const parent = stack[stack.length - 1];
    if (parent && row.depth === rows[parent.start].depth + 1) {
      parent.lastDirect = index;
      const parentAxis = rows[parent.start].caretCenter;
      const end = row.caretCenter - (row.caretHalfWidth ?? 8) - 2;
      branches.push({
        id: `${rows[parent.start].id}::${row.id}`,
        depth: rows[parent.start].depth,
        top: rowCenter(row),
        left: parentAxis,
        width: Math.max(1, end - parentAxis),
      });
    }
    if (row.expanded) stack.push({ start: index, lastDirect: null });
  });
  while (stack.length) finish(stack.pop()!, rows.length - 1);
  return { rails, branches };
}

export function treeGuideRails(rows: readonly TreeGuideRow[]): TreeGuideRail[] {
  return treeGuideLayout(rows).rails;
}
