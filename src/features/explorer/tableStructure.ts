export type TableAction = 'add-row' | 'add-column' | 'delete-row' | 'delete-column';
export function changeTableStructure(rows: string[][], align: Array<'left' | 'center' | 'right' | null>, action: TableAction, row: number, column: number): string | null {
  const width = Math.max(align.length, ...rows.map((cells) => cells.length));
  if (!rows.length || !width) return null;
  const cells = rows.map((values) => Array.from({ length: width }, (_, index) => values[index] ?? ''));
  const alignment = Array.from({ length: width }, (_, index) => align[index] ?? null);
  if (action === 'add-row') cells.splice(Math.min(Math.max(1, row + 1), cells.length), 0, Array(width).fill(''));
  if (action === 'add-column') {
    const at = Math.min(Math.max(0, column + 1), width);
    cells.forEach((values) => values.splice(at, 0, ''));
    alignment.splice(at, 0, null);
  }
  if (action === 'delete-row') {
    if (row <= 0 || row >= cells.length) return null;
    cells.splice(row, 1);
  }
  if (action === 'delete-column') {
    if (width <= 1 || column < 0 || column >= width) return null;
    cells.forEach((values) => values.splice(column, 1));
    alignment.splice(column, 1);
  }
  const render = (values: string[]) => '| ' + values.join(' | ') + ' |';
  return [render(cells[0]), render(alignment.map((value) => value === 'center' ? ':---:' : value === 'right' ? '---:' : value === 'left' ? ':---' : '---')), ...cells.slice(1).map(render)].join('\n');
}
