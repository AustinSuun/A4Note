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
/** Visible rows are in preorder. An open branch owns its entire visible subtree,
 * not just its direct children; opaque IDs never use filesystem-prefix matching. */
export function treeGuideRails(rows: readonly TreeGuideRow[]): TreeGuideRail[] {
  const rails: TreeGuideRail[] = [];
  const stack: number[] = [];
  const finish = (start: number, end: number) => {
    if (end <= start) return;
    const row = rows[start], top = row.bottom + 3;
    rails.push({ id: row.id, depth: row.depth, top, height: Math.max(4, rows[end].bottom - top - 3), left: row.caretCenter, start, end });
  };
  rows.forEach((row, index) => {
    while (stack.length && rows[stack[stack.length - 1]].depth >= row.depth) finish(stack.pop()!, index - 1);
    if (row.expanded) stack.push(index);
  });
  while (stack.length) finish(stack.pop()!, rows.length - 1);
  return rails;
}
