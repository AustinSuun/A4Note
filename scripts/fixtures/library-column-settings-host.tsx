/* Fixture for scripts/verify-library-column-settings-browser.mjs (task ae98615a): the real
 * ColumnSettings popover in a command-bar-like row, plus the placement helpers for unit checks. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/library.css';
import { ColumnSettings } from '/src/features/library/ColumnSettings';
import { anchoredPlacement, pointPlacement, toCssPixels, viewportScale } from '/src/features/library/portalPlacement';

const calls: unknown[] = [];
(window as unknown as Record<string, unknown>).__columnCalls = calls;
(window as unknown as Record<string, unknown>).__placement = { anchoredPlacement, pointPlacement, toCssPixels, viewportScale };

function Host() {
  const [visible, setVisible] = useState<Record<string, boolean>>({ authors: true, year: true, venue: true, tags: true });
  const [bottom, setBottom] = useState(false);
  (window as unknown as Record<string, unknown>).__columnHost = { setBottom, visible: () => visible };
  const columns = [
    { id: 'title', label: '标题', visible: true, fixed: true },
    ...(['authors', 'year', 'venue', 'tags'] as const).map((id) => ({ id, label: { authors: '作者', year: '年份', venue: '来源', tags: '标签' }[id], visible: visible[id] })),
  ];
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: bottom ? 'flex-end' : 'flex-start', boxSizing: 'border-box', padding: 12 }}>
      <div className="library-commandbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="library-result-count" style={{ marginLeft: 'auto' }}>3 条结果</span>
        <ColumnSettings columns={columns} onChange={(id, next) => { calls.push([id, next]); setVisible((current) => ({ ...current, [id]: next })); }} />
        <button type="button" className="primary library-import-button">导入 PDF</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
