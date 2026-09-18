import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const MAX_COLUMNS = 12;
const MAX_ROWS = 30;
export function tableMarkdown(rows: number, columns: number): string {
  const r = Math.max(1, Math.min(MAX_ROWS, Math.trunc(rows) || 1));
  const c = Math.max(1, Math.min(MAX_COLUMNS, Math.trunc(columns) || 1));
  const row = '| ' + Array(c).fill(' ').join(' | ') + ' |';
  return [row, '| ' + Array(c).fill('---').join(' | ') + ' |', ...Array(r - 1).fill(row)].join('\n');
}

export function DockTablePicker({ onInsert }: { onInsert: (source: string) => void }) {
  const [size, setSize] = useState({ rows: 3, columns: 3 });
  const [visibleRows, setVisibleRows] = useState(8);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const hintId = useId();
  const cellAt = (event: PointerEvent) => {
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-table-cell]');
    if (!cell || !grid.current?.contains(cell)) return null;
    return { rows: Number(cell.dataset.row), columns: Number(cell.dataset.column) };
  };
  const focusCell = (rows: number, columns: number) => {
    setSize({ rows, columns });
    grid.current?.querySelector<HTMLElement>(`[data-row="${rows}"][data-column="${columns}"]`)?.focus({ preventScroll: true });
    grid.current?.querySelector<HTMLElement>(`[data-row="${rows}"][data-column="${columns}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    let { rows, columns } = size;
    if (event.key === 'ArrowRight') columns = Math.min(MAX_COLUMNS, columns + 1);
    else if (event.key === 'ArrowLeft') columns = Math.max(1, columns - 1);
    else if (event.key === 'ArrowDown') rows = Math.min(visibleRows, rows + 1);
    else if (event.key === 'ArrowUp') rows = Math.max(1, rows - 1);
    else if (event.key === 'Home') { columns = 1; if (event.ctrlKey) rows = 1; }
    else if (event.key === 'End') { columns = MAX_COLUMNS; if (event.ctrlKey) rows = visibleRows; }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInsert(tableMarkdown(rows, columns)); return; }
    else return;
    event.preventDefault(); focusCell(rows, columns);
  };
  return <div className="dock-table-picker">
    <div className="dock-table-size" aria-live="polite"><strong>{size.columns} 列 × {size.rows} 行</strong><span>含 1 行表头</span></div>
    <div className="dock-table-scroll">
      <div ref={grid} className="dock-table-grid" role="grid" aria-label="选择表格行列" aria-describedby={hintId}
        aria-rowcount={visibleRows} aria-colcount={MAX_COLUMNS} onKeyDown={keyDown}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          const cell = cellAt(event); if (!cell) return;
          event.preventDefault(); drag.current = event.pointerId; setSize(cell);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (event.pointerType !== 'mouse' && drag.current !== event.pointerId) return; const cell = cellAt(event); if (cell) setSize(cell); }}
        onPointerUp={event => {
          if (drag.current !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const cell = cellAt(event); if (cell) onInsert(tableMarkdown(cell.rows, cell.columns));
        }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {Array.from({ length: visibleRows }, (_, row) => <div key={row} role="row" className="dock-table-grid-row">
          {Array.from({ length: MAX_COLUMNS }, (_, column) => {
            const selected = row < size.rows && column < size.columns;
            return <button key={column} type="button" role="gridcell" data-table-cell="" data-row={row + 1} data-column={column + 1}
              aria-label={`${column + 1} 列 × ${row + 1} 行（含表头）`} aria-selected={selected}
              className={`dock-table-cell${selected ? ' is-selected' : ''}`}
              tabIndex={row + 1 === size.rows && column + 1 === size.columns ? 0 : -1}
              onFocus={() => setSize({ rows: row + 1, columns: column + 1 })}
              onClick={event => { if (event.detail === 0) onInsert(tableMarkdown(row + 1, column + 1)); }} />;
          })}
        </div>)}
      </div>
    </div>
    <div className="dock-table-footer"><span id={hintId}>划选后点击或松开鼠标插入 · 方向键 / Enter</span>
      {visibleRows < MAX_ROWS && <button type="button" className="dock-table-more" onClick={() => setVisibleRows(n => Math.min(MAX_ROWS, n + 8))}>更多行</button>}
    </div>
  </div>;
}
