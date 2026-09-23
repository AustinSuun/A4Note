import { SummaryCompactImages, SummaryManagedImage } from './SummaryManagedImages';
import { SummaryEditableCell } from './SummaryEditableCell';
import { PaperSignals } from '../PaperSignals';
import { SummaryRowResizer, type RowResizeActions } from './SummaryRowResizer';
import { Pin } from 'lucide-react';
import { ColumnSettings } from './ColumnSettings';
import { SummaryFieldSettings } from './SummaryFieldSettings';
import { validateSummaryFieldCatalog } from '../../core/summaryFieldCatalog';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkAsterInline } from '../../shared/markdown/remarkAsterInline';
import type { PaperDocument } from '../../core/types';
import type { TextDocumentSession } from '../../core/textDocumentSession';
import { defaultSummaryColumns, summarySizing, fitSummaryWidths, type SummarySizing, summaryPaperMetadata, parseSummaryLayout, summaryExcerpt, summaryFields, summaryRowHeight, type SummaryColumn } from '../../core/librarySummary';
import { editSummary, invalidateSummaryPreviews, loadSummary, onSummaryChange, openSummaryUrl, summaryLayoutSession, type SummaryFile } from '../../platform/library/summaries';
import { SummaryEditor } from './SummaryEditor';
import './summary.css';
interface Props { papers: PaperDocument[]; selectedIds: string[]; selectedId?: string; onSelect(id: string): void; onSelection(ids: string[]): void; onOpen(id: string): void }
export function LibraryOverview({ papers, selectedIds, selectedId, onSelect, onSelection, onOpen }: Props) {
  const [titlePinned, setTitlePinned] = useState(() => {
    try { return localStorage.getItem('aster.overviewTitlePinned') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('aster.overviewTitlePinned', String(titlePinned)); } catch { /* Keep the toggle usable when storage is unavailable. */ }
  }, [titlePinned]);
  const [columns, setColumns] = useState<SummaryColumn[]>(defaultSummaryColumns.map(c => ({ ...c })));
  const [zoom, setZoom] = useState(100), [compare, setCompare] = useState(false), [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ paper: PaperDocument; column?: SummaryColumn; session: TextDocumentSession } | null>(null);
  const [opening, setOpening] = useState(false);
  const [sizing, setSizing] = useState<SummarySizing>({ mode: 'manual', titleWidth: 280 });
  const [viewportWidth, setViewportWidth] = useState(0), [resizeWidths, setResizeWidths] = useState<number[] | null>(null);
  const [hoverColumn, setHoverColumn] = useState<number | null>(null);
  const columnFrame = useRef(0);
  const drag = useRef<{ index: number; x: number; initial: number[]; current: number[]; pointer: number } | null>(null);
  const layout = useRef<TextDocumentSession | null>(null), rawLayout = useRef<Record<string, unknown>>({ version: 2 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true), root = useRef<HTMLDivElement>(null), [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  const contentZoom = expanded || compare || focus ? 130 : 60;
  const scale = zoom / 100;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const zoomPoint = useRef<{ y: number; logicalLeft: number; logicalY: number } | null>(null);
  const scaleRef = useRef(scale);
  const scrollFrame = useRef(0);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = useMemo(() => papers.filter(p => (!compare || selected.has(p.paperId)) && (!focus || p.paperId === focus)), [papers, compare, selected, focus]);
  const cols = useMemo(() => columns.filter(c => !c.hidden), [columns]);
  const baseHeight = Math.max(84, summaryRowHeight(contentZoom));
  const rows = useMemo(() => { let top = 0; return visible.map(paper => { const height = rowHeights[paper.paperId] ?? (contentZoom >= 120 ? Math.max(baseHeight, heights[paper.paperId] ?? baseHeight) : baseHeight); const row = { paper, top, height }; top += height; return row; }); }, [visible, contentZoom, baseHeight, heights, rowHeights]);
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
  // Binary search in logical coordinates: magnification does not rebuild all row offsets.
  const logicalTop = Math.max(0, scroll.top / scale - 34);
  let low = 0, high = rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].top + rows[mid].height < logicalTop) low = mid + 1; else high = mid; }
  const first = Math.max(0, low - 4);
  let last = first; while (last < rows.length && rows[last].top < (scroll.top + scroll.height) / scale) last++;
  const displayed = rows.slice(first, Math.min(rows.length, last + 4));
  const desiredWidths = [sizing.titleWidth, ...cols.map(c => c.width)];
  const widths = resizeWidths ?? (sizing.mode === 'window' && viewportWidth > 0 ? fitSummaryWidths(viewportWidth, desiredWidths) : desiredWidths);
  const template = widths.map(w => `${w}px`).join(' ');
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const wheelFrame = useRef(0), nextZoom = useRef(zoom);
  useEffect(() => {
    mounted.current = true;
    let stop: (() => void) | undefined;
    void summaryLayoutSession().then(session => {
      if (!mounted.current) return;
      const state = parseSummaryLayout(session.getSnapshot().content); rawLayout.current = state.raw; layout.current = session; setColumns(state.columns); setSizing(summarySizing(state.raw));
      const saved = state.raw.rowHeights;
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) setRowHeights(Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 44 && value <= 2000)));
      if (session.getSnapshot().error) setError(session.getSnapshot().error);
      stop = session.subscribe(() => { if (session.getSnapshot().error) setError(session.getSnapshot().error); });
    }).catch(e => { if (mounted.current) setError(`列设置加载失败：${String(e)}。默认列仅供显示，不覆盖原文件。`); });
    return () => { mounted.current = false; stop?.(); clearTimeout(saveTimer.current); cancelAnimationFrame(wheelFrame.current); cancelAnimationFrame(scrollFrame.current); cancelAnimationFrame(columnFrame.current); void layout.current?.flush().catch(() => {}); };
  }, []);
  const scopeKey = papers.map(p => p.paperId).join('\0');
  useEffect(() => { zoomPoint.current = null; setFocus(null); setCompare(false); }, [scopeKey]);
  useEffect(() => { setHeights({}); }, [contentZoom, columns, template]);
  useLayoutEffect(() => {
    const node = root.current; if (!node) return;
    const observer = new ResizeObserver(() => { setScroll({ top: node.scrollTop, height: node.clientHeight }); setViewportWidth(node.clientWidth); }); observer.observe(node); return () => observer.disconnect();
  }, []);
  const captureZoomPoint = useCallback((clientY?: number) => {
    const node = root.current; if (!node) return;
    const rect = node.getBoundingClientRect();
    const y = Math.max(0, Math.min(node.clientHeight, clientY === undefined ? node.clientHeight / 2 : clientY - rect.top));
    // The title is frozen at the left edge. A cursor/center X anchor would
    // introduce horizontal scrolling even from scrollLeft=0 on zoom-in, hiding
    // the adjacent column under that title. Preserve the logical scroll start:
    // next column screen X = (titleWidth - logicalLeft) * scale.
    zoomPoint.current = { y, logicalLeft: node.scrollLeft / scaleRef.current, logicalY: (node.scrollTop + y) / scaleRef.current };
  }, []);
  const animateZoom = useCallback(() => {
    if (wheelFrame.current) return;
    let lastTime = performance.now();
    const step = (time: number) => {
      const current = scaleRef.current * 100, target = nextZoom.current;
      const elapsed = Math.max(1, Math.min(32, time - lastTime)); lastTime = time;
      const immediate = matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - current) < .05;
      const next = immediate ? target : current + (target - current) * (1 - Math.exp(-elapsed / 45));
      setZoom(next);
      wheelFrame.current = immediate ? 0 : requestAnimationFrame(step);
    };
    wheelFrame.current = requestAnimationFrame(step);
  }, []);
  const cancelZoom = useCallback(() => {
    cancelAnimationFrame(wheelFrame.current); wheelFrame.current = 0;
    nextZoom.current = scaleRef.current * 100; zoomPoint.current = null;
  }, []);
  const changeZoom = useCallback((value: number) => {
    captureZoomPoint();
    nextZoom.current = Math.max(20, Math.min(500, value));
    animateZoom();
  }, [captureZoomPoint, animateZoom]);
  useLayoutEffect(() => {
    const node = root.current, point = zoomPoint.current;
    scaleRef.current = scale;
    if (node && point) {
      node.scrollLeft = point.logicalLeft * scale;
      node.scrollTop = point.logicalY * scale - point.y;
      setScroll({ top: node.scrollTop, height: node.clientHeight });
    }
  }, [scale]);
  useEffect(() => {
    const node = root.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) { cancelZoom(); return; }
      event.preventDefault();
      if (!event.deltaY) return;
      if (!wheelFrame.current) captureZoomPoint(event.clientY);
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      nextZoom.current = Math.max(20, Math.min(500, nextZoom.current * Math.exp(-Math.max(-120, Math.min(120, pixels)) * .0015)));
      animateZoom();
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { node.removeEventListener('wheel', wheel); cancelAnimationFrame(wheelFrame.current); wheelFrame.current = 0; };
  }, [captureZoomPoint, animateZoom, cancelZoom]);
  useEffect(() => {
    const renew = () => { invalidateSummaryPreviews(); setRefresh(v => v + 1); };
    window.addEventListener('focus', renew); return () => window.removeEventListener('focus', renew);
  }, []);
  const configure = (next: SummaryColumn[], nextSizing: SummarySizing = sizing, nextRowHeights: Record<string, number> = rowHeights) => {
    if (!layout.current) return;
    try {
      const text = JSON.stringify({ ...rawLayout.current, version: 2, columns: next, sizing: nextSizing, rowHeights: nextRowHeights }, null, 2) + '\n'; parseSummaryLayout(text);
      layout.current.update(text); rawLayout.current = JSON.parse(text); setColumns(next); setSizing(nextSizing); setRowHeights(nextRowHeights); setError(''); clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void layout.current?.flush().catch(e => { if (mounted.current) setError(String(e)); }); }, 500);
    } catch (e) { setError(String(e)); }
  };
  const saveCatalog = async (next: SummaryColumn[], baseline: SummaryColumn[]) => {
    const session = layout.current;
    if (!session) throw new Error('列设置尚未加载，未保存。');
    try {
      validateSummaryFieldCatalog(next);
      const current = parseSummaryLayout(session.getSnapshot().content);
      const actual = JSON.stringify(current.columns);
      if (actual !== JSON.stringify(baseline) && actual !== JSON.stringify(next)) throw new Error('列设置已变化，请关闭并重新打开字段目录；未覆盖其他修改。');
      const text = JSON.stringify({ ...current.raw, version: 2, columns: next }, null, 2) + '\n';
      parseSummaryLayout(text); clearTimeout(saveTimer.current);
      session.update(text); rawLayout.current = JSON.parse(text); setColumns(next);
      await session.flush(); setError('');
    } catch (reason) { setError(String(reason)); throw reason; }
  };
  const commitWidths = (next: number[]) => {
    configure(columns.map(c => { const index = cols.findIndex(v => v.id === c.id); return index < 0 ? c : { ...c, width: next[index + 1] }; }), { mode: 'manual', titleWidth: next[0] });
  };
  const cancelResize = () => { cancelAnimationFrame(columnFrame.current); columnFrame.current = 0; drag.current = null; setResizeWidths(null); setHoverColumn(null); };
  const contentFit = (index: number) => {
    if (!root.current || !layout.current) return;
    const headers = root.current.querySelectorAll<HTMLElement>('.summary-grid-head > div');
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); if (!context) return;
    const header = headers[index]; if (!header) return;
    context.font = getComputedStyle(header).font;
    const name = index === 0 ? '论文名称' : cols[index - 1].name;
    let target = context.measureText(name).width + 40;
    // Measure the currently rendered sample only; never scan/read every summary file.
    for (const row of root.current.querySelectorAll<HTMLElement>('.summary-row')) {
      const cell = row.children[index] as HTMLElement | undefined; if (!cell) continue;
      const textNode = index === 0 ? cell.querySelector<HTMLElement>('.summary-paper-title') : cell;
      if (textNode) {
        context.font = getComputedStyle(textNode).font;
        for (const line of (textNode.textContent ?? '').split(/\n/).slice(0, 100)) target = Math.max(target, context.measureText(line.slice(0, 2000)).width + (index === 0 ? 55 : 28));
      }
      for (const image of cell.querySelectorAll('img')) target = Math.max(target, Math.min(640, image.naturalWidth) + 24);
    }
    const next = [...widths]; next[index] = Math.max(index === 0 ? 180 : 80, Math.min(640, Math.ceil(target))); commitWidths(next);
  };
  const resizeHandle = (index: number, name: string) => <span role="separator" tabIndex={layout.current ? 0 : -1} aria-disabled={!layout.current}
    aria-label={`调整${name}列宽`} aria-orientation="vertical" aria-valuemin={index === 0 ? 180 : 80} aria-valuemax={800} aria-valuenow={widths[index]}
    className="summary-column-resizer"
    onPointerEnter={() => setHoverColumn(index)} onPointerLeave={() => { if (!drag.current) setHoverColumn(null); }}
    onFocus={() => setHoverColumn(index)} onBlur={() => { if (!drag.current) setHoverColumn(null); }}
    onPointerDown={event => {
      if (!layout.current || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); cancelZoom(); setHoverColumn(index); event.currentTarget.focus({ preventScroll: true });
      drag.current = { index, x: event.clientX, initial: [...widths], current: [...widths], pointer: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { const state = drag.current; if (!state || state.pointer !== event.pointerId) return;
      const next = [...state.initial]; next[state.index] = Math.max(state.index === 0 ? 180 : 80, Math.min(800, Math.round(state.initial[state.index] + (event.clientX - state.x) / scaleRef.current)));
      state.current = next;
      if (!columnFrame.current) columnFrame.current = requestAnimationFrame(() => { columnFrame.current = 0; if (drag.current) setResizeWidths(drag.current.current); });
    }}
    onPointerUp={event => { const state = drag.current; if (!state || state.pointer !== event.pointerId) return; cancelAnimationFrame(columnFrame.current); columnFrame.current = 0; drag.current = null;
      if (state.current.some((w, i) => w !== state.initial[i])) commitWidths(state.current);
      setResizeWidths(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); contentFit(index); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); cancelResize(); return; }
      if (!layout.current || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') { contentFit(index); return; }
      const next = [...widths], minimum = index === 0 ? 180 : 80;
      next[index] = event.key === 'Home' ? minimum : event.key === 'End' ? 800 : Math.max(minimum, Math.min(800, next[index] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10)));
      commitWidths(next);
    }} />;
  const openEditor = async (paper: PaperDocument, column?: SummaryColumn) => {
    if (opening) return; setOpening(true); setError('');
    try { const session = await editSummary(paper.paperId); if (column) summaryFields(session.getSnapshot().content); if (mounted.current) setEditor({ paper, column, session }); }
    catch (e) { if (mounted.current) setError(String(e) + '；字段格式有问题时可用“编辑完整总结”修复。'); }
    finally { if (mounted.current) setOpening(false); }
  };
  const resetScope = () => { zoomPoint.current = null; setFocus(null); setCompare(false); changeZoom(100); if (root.current) root.current.scrollTop = 0; };
  const rowActions = {
    resizeRow: (id: string, height: number | undefined, save: boolean) => {
      if (!mounted.current || !layout.current) return;
      const next = { ...rowHeights };
      if (height === undefined) delete next[id]; else next[id] = height;
      if (save) configure(columns, sizing, next); else setRowHeights(next);
    },
    resizeScale: () => scaleRef.current,
    canResize: () => !!layout.current,
    stopZoom: cancelZoom,
    height: (id: string, height: number) => setHeights(old => Math.abs((old[id] ?? 0) - height) < 2 ? old : { ...old, [id]: height }),
    select: onSelect,
    toggle: (id: string) => onSelection(selected.has(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]),
    focus: (id: string) => { setFocus(id); setCompare(false); changeZoom(100); if (root.current) root.current.scrollTop = 0; zoomPoint.current = null; },
    open: onOpen,
    edit: (paper: PaperDocument, column?: SummaryColumn) => { void openEditor(paper, column); },
  };
  const actions = useRef<SummaryRowActions>(rowActions); actions.current = rowActions;
  const target = visible.find(p => p.paperId === selectedId) ?? visible[0];
  return <div className="library-overview">
    <div className="summary-toolbar">
      <span>{visible.length} 篇 · 总结</span>
      <button type="button" className={compare ? 'active' : ''} disabled={!selectedIds.length} onClick={() => { setFocus(null); setCompare(!compare); changeZoom(100); }}>比较所选</button>
      <button type="button" className={contentZoom >= 120 ? 'active' : ''} aria-pressed={contentZoom >= 120} onClick={() => { setExpanded(contentZoom < 120); setFocus(null); setCompare(false); }}>展开内容</button>
      {focus && <button type="button" onClick={resetScope}>返回当前范围</button>}
      <button type="button" disabled={!target || opening} onClick={() => target && void openEditor(target)}>编辑完整总结</button>
      <button type="button" onClick={() => { invalidateSummaryPreviews(); setRefresh(v => v + 1); }}>刷新</button>
      <button type="button" disabled={!layout.current} className={sizing.mode === 'window' ? 'active' : ''} aria-pressed={sizing.mode === 'window'} title="随窗口宽度自动分配列宽；拖动列边界切换为固定宽度" onClick={() => { cancelResize(); configure(columns, { ...sizing, mode: 'window' }); }}>适应窗口</button>
      <div className="summary-zoom" title="Ctrl/⌘＋滚轮缩放；普通滚轮浏览">
        <button type="button" aria-label="缩小综览" onClick={() => changeZoom(nextZoom.current - 10)}>−</button><button type="button" onClick={() => changeZoom(100)}>{Math.round(zoom)}%</button><button type="button" aria-label="放大综览" onClick={() => changeZoom(nextZoom.current + 10)}>＋</button>
      </div><SummaryFieldSettings columns={columns} disabled={!layout.current} onSave={saveCatalog} /><ColumnSettings disabled={!layout.current} columns={[
        { id: '__title', label: '论文名称', visible: true, fixed: true },
        ...columns.map(column => ({ id: column.id, label: column.name, visible: !column.hidden })),
      ]} onChange={(id, visible) => configure(columns.map(column => column.id === id ? { ...column, hidden: !visible } : column))} />
    </div>
    {error && <div role="alert" className="summary-warning">{error}<button type="button" onClick={() => void layout.current?.flush().then(() => setError('')).catch(e => setError(String(e)))}>重试保存列设置</button></div>}
    <div ref={root} className={`summary-viewport ${titlePinned ? 'title-pinned' : 'title-scrolls'} ${contentZoom >= 120 ? 'expanded' : 'compact'}`} style={{ '--summary-grid': template, '--summary-lines': 2 } as CSSProperties} onPointerDown={cancelZoom} onScroll={() => {
      if (!scrollFrame.current) scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = 0; const node = root.current;
        if (node) setScroll({ top: node.scrollTop, height: node.clientHeight });
      });
    }}>
      <div className="summary-sheet" style={{ zoom: scale, width: tableWidth }}>
        {hoverColumn !== null && <div className="summary-column-guide" aria-hidden="true" style={{ left: widths.slice(0, hoverColumn + 1).reduce((sum, width) => sum + width, 0), top: scroll.top / scale, height: scroll.height / scale }} />}
      <div className="summary-grid-head" style={{ width: tableWidth }}>
        <div className="summary-pinned"><input type="checkbox" aria-label="选择当前综览全部文献" checked={visible.length > 0 && visible.every(p => selected.has(p.paperId))} onChange={event => onSelection(event.target.checked ? [...new Set([...selectedIds, ...visible.map(p => p.paperId)])] : selectedIds.filter(id => !visible.some(p => p.paperId === id)))} /><span className="summary-title-heading">论文名称</span><button type="button" className="summary-title-pin" aria-pressed={titlePinned}
          title={titlePinned ? '取消固定标题列' : '固定标题列'} aria-label={titlePinned ? '取消固定标题列' : '固定标题列'}
          onClick={() => setTitlePinned(value => !value)}><Pin aria-hidden="true" /></button>{resizeHandle(0, '论文名称')}</div>
        {cols.map((column, index) => <div key={column.id} title={column.name}><span>{column.name}</span>{resizeHandle(index + 1, column.name)}</div>)}
      </div>
      <div className="summary-rows" style={{ height: total, width: tableWidth }}>
        {displayed.map(row => <SummaryRow key={row.paper.paperId} paper={row.paper} columns={cols} zoom={contentZoom} top={row.top} height={row.height} selected={selected.has(row.paper.paperId)} refresh={refresh}
          actions={actions} manualHeight={rowHeights[row.paper.paperId]} />)}
      </div>
      {!visible.length && <p className="summary-empty">当前范围没有文献{compare ? '或没有选中文献' : ''}。{(compare || focus) && <button type="button" onClick={resetScope}>返回当前范围</button>}</p>}
      </div>
    </div>
    {editor && <SummaryEditor {...editor} onClose={() => setEditor(null)} />}
  </div>;
}
type SummaryRowActions = RowResizeActions & {
  height(id: string, height: number): void;
  select(id: string): void;
  toggle(id: string): void;
  focus(id: string): void;
  open(id: string): void;
  edit(paper: PaperDocument, column?: SummaryColumn): void;
};
const SummaryRow = memo(function SummaryRow({ paper, columns, zoom, top, height, selected, refresh, actions, manualHeight }: {
  paper: PaperDocument; columns: SummaryColumn[]; zoom: number; top: number; height: number; selected: boolean; refresh: number;
  actions: { current: SummaryRowActions }; manualHeight?: number;
}) {
  const onHeight = (value: number) => actions.current.height(paper.paperId, value);
  const onSelect = () => actions.current.select(paper.paperId);
  const onToggle = () => actions.current.toggle(paper.paperId);
  const onFocus = () => actions.current.focus(paper.paperId);
  const onOpen = () => actions.current.open(paper.paperId);
  const onEdit = (column?: SummaryColumn) => actions.current.edit(paper, column);
  const [file, setFile] = useState<SummaryFile | null>(null), [error, setError] = useState(''); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const load = (fresh = false) => void loadSummary(paper.paperId, fresh).then(value => { if (active) { setFile(value); setError(''); } }).catch(e => { if (active) setError(String(e)); });
    load(); const stop = onSummaryChange(id => { if (id === paper.paperId) load(); });
    return () => { active = false; stop(); };
  }, [paper.paperId, refresh]);
  const heightCallback = useRef(onHeight); heightCallback.current = onHeight;
  useLayoutEffect(() => { const node = ref.current; if (!node || zoom < 120 || manualHeight !== undefined) return; const observer = new ResizeObserver(() => heightCallback.current(node.offsetHeight)); observer.observe(node); return () => observer.disconnect(); }, [zoom, manualHeight]);
  const parsed = useMemo(() => { try { return { fields: summaryFields(file?.content ?? ''), error: '' }; } catch (e) { return { fields: new Map<string, { value: string }>(), error: String(e) }; } }, [file?.content]);
  const metadata = useMemo(() => summaryPaperMetadata(paper), [paper]);
  const online = parsed.fields.get('online')?.value.trim();
  return <div ref={ref} className={`summary-row ${selected ? 'selected' : ''} ${manualHeight !== undefined ? 'manual-height' : ''}`} data-paper-id={paper.paperId} style={{ top, ...(zoom >= 120 && manualHeight === undefined ? { minHeight: summaryRowHeight(zoom) } : { height }) }}>
    <div className="summary-pinned summary-title"><input type="checkbox" aria-label={`选择${paper.title}`} checked={selected} onChange={onToggle} /><div><button type="button" className="summary-paper-title" title={`打开文献：${metadata.title}`} onClick={() => { onSelect(); onOpen(); }}>{metadata.title}</button><PaperSignals paper={paper} /><div className="summary-meta-tags" aria-label="论文时间与期刊会议">
      <span className="summary-meta-tag summary-year-tag" title={metadata.year ? `出版年份：${metadata.year}` : '文献元数据尚未填写年份'}>{metadata.year || '年份待补充'}</span>
      <span className="summary-meta-tag summary-venue-tag" title={`期刊/会议：${metadata.venue || '未填写'}`}>{metadata.venue || '期刊/会议待补充'}</span>
      {online && <span className="summary-meta-tag summary-online-tag" title={`用户记录的 online 时间：${online}`}>online {online}</span>}

    </div>{zoom >= 120 && <p>{paper.authors}</p>}<button type="button" className="summary-focus" onClick={onFocus}>聚焦</button></div><SummaryRowResizer id={paper.paperId} title={paper.title} height={height} manualHeight={manualHeight} actions={actions} /></div>
    {columns.map(column => {
      const value = column.source === 'venue' ? paper.venue : parsed.fields.get(column.id)?.value ?? '';
      const noteId = /^\[[^\]]*\]\(a4note-note:([^\s)]+)\)$/.exec(value.trim())?.[1]; const note = noteId ? paper.notes.find(n => n.id === noteId) : undefined;
      const shown = note ? `${note.title}\n${note.content}` : value;
      if (column.source) return <div key={column.id} className="summary-cell" title="来自论文信息，请在论文详情中编辑"><p className="summary-excerpt">{value || '—'}</p></div>;
      return <SummaryEditableCell key={column.id} paperId={paper.paperId} column={column} value={value}
        unavailable={error || parsed.error || (!file ? '正在读取总览 MD…' : undefined)} onRepair={() => onEdit()}>
        {!value ? null : zoom < 120 ? <div className="summary-compact-content"><SummaryCompactImages paperId={paper.paperId} value={shown} /><p className="summary-excerpt">{summaryExcerpt(shown, zoom).replaceAll('〔图片〕', '')}</p></div> : <>{note && <small>↗ 引用已有笔记，不复制正文</small>}{noteId && !note ? <span className="summary-warning">引用的笔记不存在</span> : <SummaryRich paperId={paper.paperId} value={shown} />}</>}
      </SummaryEditableCell>;
    })}
  </div>;
});
const SummaryRich = memo(function SummaryRich({ paperId, value }: { paperId: string; value: string }) {
  return <div className="summary-rich"><ReactMarkdown remarkPlugins={[remarkGfm, remarkAsterInline]} skipHtml components={{
    img: ({ src, alt, title }) => <SummaryManagedImage paperId={paperId} source={typeof src === 'string' ? src : undefined} alt={alt} title={title} />,
    a: ({ href, children }) => <a href={href && /^https?:\/\//i.test(href) ? href : undefined} onClick={event => { event.preventDefault(); if (href) void openSummaryUrl(href).catch(() => {}); }}>{children}</a>,
  }}>{value}</ReactMarkdown></div>;
});
