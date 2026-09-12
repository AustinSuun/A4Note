import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PaperDocument } from '../../core/types';
import type { TextDocumentSession } from '../../core/textDocumentSession';
import { defaultSummaryColumns, summarySizing, fitSummaryWidths, type SummarySizing, summaryPaperMetadata, parseSummaryLayout, summaryExcerpt, summaryFields, summaryRowHeight, type SummaryColumn } from '../../core/librarySummary';
import { editSummary, invalidateSummaryPreviews, loadSummary, onSummaryChange, openSummaryUrl, summaryImage, summaryLayoutSession, type SummaryFile } from '../../platform/library/summaries';
import { SummaryEditor } from './SummaryEditor';
import './summary.css';
interface Props { papers: PaperDocument[]; selectedIds: string[]; selectedId?: string; onSelect(id: string): void; onSelection(ids: string[]): void; onOpen(id: string): void }
export function LibraryOverview({ papers, selectedIds, selectedId, onSelect, onSelection, onOpen }: Props) {
  const [columns, setColumns] = useState<SummaryColumn[]>(defaultSummaryColumns.map(c => ({ ...c })));
  const [zoom, setZoom] = useState(60), [compare, setCompare] = useState(false), [focus, setFocus] = useState<string | null>(null);
  const [settings, setSettings] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ paper: PaperDocument; column?: SummaryColumn; session: TextDocumentSession } | null>(null);
  const [opening, setOpening] = useState(false);
  const [sizing, setSizing] = useState<SummarySizing>({ mode: 'manual', titleWidth: 280 });
  const [viewportWidth, setViewportWidth] = useState(0), [resizeWidths, setResizeWidths] = useState<number[] | null>(null);
  const drag = useRef<{ index: number; x: number; initial: number[]; current: number[]; pointer: number } | null>(null);
  const layout = useRef<TextDocumentSession | null>(null), rawLayout = useRef<Record<string, unknown>>({ version: 2 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true), root = useRef<HTMLDivElement>(null), [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const anchor = useRef<{ id: string; ratio: number; y: number } | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = useMemo(() => papers.filter(p => (!compare || selected.has(p.paperId)) && (!focus || p.paperId === focus)), [papers, compare, selected, focus]);
  const cols = useMemo(() => columns.filter(c => !c.hidden), [columns]);
  const baseHeight = summaryRowHeight(zoom);
  const rows = useMemo(() => { let top = 0; return visible.map(paper => { const height = zoom >= 120 ? Math.max(baseHeight, heights[paper.paperId] ?? baseHeight) : baseHeight; const row = { paper, top, height }; top += height; return row; }); }, [visible, zoom, baseHeight, heights]);
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
  const first = Math.max(0, rows.findIndex(row => row.top + row.height >= Math.max(0, scroll.top - 34)) - 2);
  let last = first; while (last < rows.length && rows[last].top < scroll.top + scroll.height) last++;
  const displayed = rows.slice(first, Math.min(rows.length, last + 2));
  const desiredWidths = [sizing.titleWidth, ...cols.map(c => c.width)];
  const widths = resizeWidths ?? (sizing.mode === 'window' && viewportWidth > 0 ? fitSummaryWidths(viewportWidth, desiredWidths) : desiredWidths);
  const template = widths.map(w => `${w}px`).join(' ');
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const rowState = useRef({ rows, zoom }); rowState.current = { rows, zoom };
  const wheelFrame = useRef(0), nextZoom = useRef(zoom);
  useEffect(() => {
    mounted.current = true;
    let stop: (() => void) | undefined;
    void summaryLayoutSession().then(session => {
      if (!mounted.current) return;
      const state = parseSummaryLayout(session.getSnapshot().content); rawLayout.current = state.raw; layout.current = session; setColumns(state.columns); setSizing(summarySizing(state.raw));
      if (session.getSnapshot().error) setError(session.getSnapshot().error);
      stop = session.subscribe(() => { if (session.getSnapshot().error) setError(session.getSnapshot().error); });
    }).catch(e => { if (mounted.current) setError(`列设置加载失败：${String(e)}。默认列仅供显示，不覆盖原文件。`); });
    return () => { mounted.current = false; stop?.(); clearTimeout(saveTimer.current); cancelAnimationFrame(wheelFrame.current); void layout.current?.flush().catch(() => {}); };
  }, []);
  const scopeKey = papers.map(p => p.paperId).join('\0');
  useEffect(() => { anchor.current = null; setFocus(null); setCompare(false); }, [scopeKey]);
  useEffect(() => { setHeights({}); }, [zoom, columns, template]);
  useLayoutEffect(() => {
    const node = root.current; if (!node) return;
    const observer = new ResizeObserver(() => { setScroll({ top: node.scrollTop, height: node.clientHeight }); setViewportWidth(node.clientWidth); }); observer.observe(node); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = root.current, point = anchor.current; if (!node || !point) return;
    const row = rows.find(r => r.paper.paperId === point.id); if (row) node.scrollTop = Math.max(0, 34 + row.top + row.height * point.ratio - point.y);
  }, [rows]);
  useEffect(() => {
    const node = root.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) { anchor.current = null; return; }
      event.preventDefault();
      if (!wheelFrame.current) {
        const y = event.clientY - node.getBoundingClientRect().top, local = node.scrollTop + y - 34;
        const row = rowState.current.rows.find(r => local >= r.top && local < r.top + r.height);
        anchor.current = row ? { id: row.paper.paperId, ratio: (local - row.top) / row.height, y } : null;
        nextZoom.current = rowState.current.zoom;
        wheelFrame.current = requestAnimationFrame(() => { wheelFrame.current = 0; setZoom(nextZoom.current); });
      }
      nextZoom.current = Math.max(40, Math.min(180, nextZoom.current + (event.deltaY > 0 ? -5 : 5)));
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const renew = () => { invalidateSummaryPreviews(); setRefresh(v => v + 1); };
    window.addEventListener('focus', renew); return () => window.removeEventListener('focus', renew);
  }, []);
  const configure = (next: SummaryColumn[], nextSizing: SummarySizing = sizing) => {
    if (!layout.current) return;
    try {
      const text = JSON.stringify({ ...rawLayout.current, version: 2, columns: next, sizing: nextSizing }, null, 2) + '\n'; parseSummaryLayout(text);
      layout.current.update(text); rawLayout.current = JSON.parse(text); setColumns(next); setSizing(nextSizing); setError(''); clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void layout.current?.flush().catch(e => { if (mounted.current) setError(String(e)); }); }, 500);
    } catch (e) { setError(String(e)); }
  };
  const commitWidths = (next: number[]) => {
    configure(columns.map(c => { const index = cols.findIndex(v => v.id === c.id); return index < 0 ? c : { ...c, width: next[index + 1] }; }), { mode: 'manual', titleWidth: next[0] });
  };
  const cancelResize = () => { drag.current = null; setResizeWidths(null); };
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
    className="summary-column-resizer" title="拖动调整列宽；双击按标题和当前已显示内容自适应；方向键微调，Esc取消拖动"
    onPointerDown={event => {
      if (!layout.current || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      drag.current = { index, x: event.clientX, initial: [...widths], current: [...widths], pointer: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { const state = drag.current; if (!state || state.pointer !== event.pointerId) return;
      const next = [...state.initial]; next[state.index] = Math.max(state.index === 0 ? 180 : 80, Math.min(800, Math.round(state.initial[state.index] + event.clientX - state.x)));
      state.current = next; setResizeWidths(next);
    }}
    onPointerUp={event => { const state = drag.current; if (!state || state.pointer !== event.pointerId) return; drag.current = null;
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
  const changeZoom = (value: number) => { anchor.current = null; setZoom(Math.max(40, Math.min(180, value))); };
  const resetScope = () => { anchor.current = null; setFocus(null); setCompare(false); changeZoom(60); if (root.current) root.current.scrollTop = 0; };
  const target = visible.find(p => p.paperId === selectedId) ?? visible[0];
  return <div className="library-overview">
    <div className="summary-toolbar">
      <span>{visible.length} 篇 · 总结</span>
      <button type="button" className={compare ? 'active' : ''} disabled={!selectedIds.length} onClick={() => { setFocus(null); setCompare(!compare); changeZoom(compare ? 60 : 130); }}>比较所选</button>
      {focus && <button type="button" onClick={resetScope}>返回当前范围</button>}
      <button type="button" disabled={!target || opening} onClick={() => target && void openEditor(target)}>编辑完整总结</button>
      <button type="button" onClick={() => { invalidateSummaryPreviews(); setRefresh(v => v + 1); }}>刷新</button>
      <button type="button" disabled={!layout.current} className={sizing.mode === 'window' ? 'active' : ''} aria-pressed={sizing.mode === 'window'} title="随窗口宽度自动分配列宽；拖动列边界切换为固定宽度" onClick={() => { cancelResize(); configure(columns, { ...sizing, mode: 'window' }); }}>适应窗口</button>
      <div className="summary-zoom" title="Ctrl/⌘＋滚轮缩放；普通滚轮浏览">
        <button type="button" aria-label="缩小综览" onClick={() => changeZoom(zoom - 10)}>−</button><button type="button" onClick={() => changeZoom(60)}>{zoom}%</button><button type="button" aria-label="放大综览" onClick={() => changeZoom(zoom + 10)}>＋</button>
      </div><button type="button" aria-label="总结列设置" onClick={() => setSettings(!settings)}>列设置</button>
    </div>
    {error && <div role="alert" className="summary-warning">{error}<button type="button" onClick={() => void layout.current?.flush().then(() => setError('')).catch(e => setError(String(e)))}>重试保存列设置</button></div>}
    {settings && <SummaryColumns columns={columns} enabled={!!layout.current} onChange={next => configure(next, { ...sizing, mode: next.some(c => columns.find(old => old.id === c.id)?.width !== c.width) ? 'manual' : sizing.mode })} onClose={() => setSettings(false)} />}
    <div ref={root} className={`summary-viewport ${zoom >= 120 ? 'expanded' : 'compact'} ${zoom <= 45 ? 'tiny' : ''}`} style={{ '--summary-grid': template, '--summary-lines': zoom <= 45 ? 1 : zoom <= 65 ? 2 : 4 } as CSSProperties} onPointerDown={() => { anchor.current = null; }} onScroll={event => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
      <div className="summary-grid-head" style={{ width: tableWidth }}>
        <div className="summary-pinned"><input type="checkbox" aria-label="选择当前综览全部文献" checked={visible.length > 0 && visible.every(p => selected.has(p.paperId))} onChange={event => onSelection(event.target.checked ? [...new Set([...selectedIds, ...visible.map(p => p.paperId)])] : selectedIds.filter(id => !visible.some(p => p.paperId === id)))} /><span>论文名称</span>{resizeHandle(0, '论文名称')}</div>
        {cols.map((column, index) => <div key={column.id} title={column.name}><span>{column.name}</span>{resizeHandle(index + 1, column.name)}</div>)}
      </div>
      <div className="summary-rows" style={{ height: total, width: tableWidth }}>
        {displayed.map(row => <SummaryRow key={row.paper.paperId} paper={row.paper} columns={cols} zoom={zoom} top={row.top} height={row.height} selected={selected.has(row.paper.paperId)} refresh={refresh}
          onHeight={height => setHeights(old => Math.abs((old[row.paper.paperId] ?? 0) - height) < 2 ? old : { ...old, [row.paper.paperId]: height })}
          onSelect={() => onSelect(row.paper.paperId)} onToggle={() => onSelection(selected.has(row.paper.paperId) ? selectedIds.filter(id => id !== row.paper.paperId) : [...selectedIds, row.paper.paperId])}
          onFocus={() => { setFocus(row.paper.paperId); setCompare(false); changeZoom(150); if (root.current) root.current.scrollTop = 0; }} onOpen={() => onOpen(row.paper.paperId)} onEdit={column => void openEditor(row.paper, column)} />)}
      </div>
      {!visible.length && <p className="summary-empty">当前范围没有文献{compare ? '或没有选中文献' : ''}。{(compare || focus) && <button type="button" onClick={resetScope}>返回当前范围</button>}</p>}
    </div>
    {editor && <SummaryEditor {...editor} onClose={() => setEditor(null)} />}
  </div>;
}
function SummaryRow({ paper, columns, zoom, top, height, selected, refresh, onHeight, onSelect, onToggle, onFocus, onOpen, onEdit }: { paper: PaperDocument; columns: SummaryColumn[]; zoom: number; top: number; height: number; selected: boolean; refresh: number; onHeight(height: number): void; onSelect(): void; onToggle(): void; onFocus(): void; onOpen(): void; onEdit(column?: SummaryColumn): void }) {
  const [file, setFile] = useState<SummaryFile | null>(null), [error, setError] = useState(''); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const load = (fresh = false) => void loadSummary(paper.paperId, fresh).then(value => { if (active) { setFile(value); setError(''); } }).catch(e => { if (active) setError(String(e)); });
    load(); const stop = onSummaryChange(id => { if (id === paper.paperId) load(); });
    return () => { active = false; stop(); };
  }, [paper.paperId, refresh]);
  const heightCallback = useRef(onHeight); heightCallback.current = onHeight;
  useLayoutEffect(() => { const node = ref.current; if (!node || zoom < 120) return; const observer = new ResizeObserver(() => heightCallback.current(Math.ceil(node.getBoundingClientRect().height))); observer.observe(node); return () => observer.disconnect(); }, [zoom]);
  const parsed = useMemo(() => { try { return { fields: summaryFields(file?.content ?? ''), error: '' }; } catch (e) { return { fields: new Map<string, { value: string }>(), error: String(e) }; } }, [file?.content]);
  const metadata = summaryPaperMetadata(paper);
  const online = parsed.fields.get('online')?.value.trim();
  return <div ref={ref} className={`summary-row ${selected ? 'selected' : ''}`} data-paper-id={paper.paperId} style={{ top, ...(zoom >= 120 ? { minHeight: summaryRowHeight(zoom) } : { height }) }}>
    <div className="summary-pinned summary-title"><input type="checkbox" aria-label={`选择${paper.title}`} checked={selected} onChange={onToggle} /><div><button type="button" className="summary-paper-title" title={`打开文献：${metadata.title}`} onClick={() => { onSelect(); onOpen(); }}>{metadata.title}</button><div className="summary-meta-tags" aria-label="论文时间与期刊会议">
      <span className="summary-meta-tag summary-year-tag" title={metadata.year ? `出版年份：${metadata.year}` : '文献元数据尚未填写年份'}>{metadata.year || '年份待补充'}</span>
      <span className="summary-meta-tag summary-venue-tag" title={`期刊/会议：${metadata.venue || '未填写'}`}>{metadata.venue || '期刊/会议待补充'}</span>
      {online && <button type="button" className="summary-meta-tag summary-online-tag" disabled={!file || !!error || !!parsed.error} title={`用户记录的 online 时间：${online}；点击编辑`} aria-label={`编辑上线时间：${metadata.title}`} onClick={() => onEdit(defaultSummaryColumns.find(c => c.id === 'online')!)}>online {online}</button>}

    </div>{zoom >= 120 && <p>{paper.authors}</p>}<button type="button" className="summary-focus" onClick={onFocus}>聚焦</button></div></div>
    {columns.map(column => {
      const value = column.source === 'venue' ? paper.venue : parsed.fields.get(column.id)?.value ?? '';
      const noteId = /^\[[^\]]*\]\(a4note-note:([^\s)]+)\)$/.exec(value.trim())?.[1]; const note = noteId ? paper.notes.find(n => n.id === noteId) : undefined;
      const shown = note ? `${note.title}\n${note.content}` : value;
      return <div key={column.id} className="summary-cell" data-summary-field={column.id} tabIndex={column.source ? -1 : 0} onDoubleClick={() => !column.source && onEdit(column)} onKeyDown={event => { if (event.key === 'Enter' && !column.source) { event.preventDefault(); onEdit(column); } }} aria-label={`${column.name}：${paper.title}`}>
        {column.source ? <p className="summary-excerpt">{value || '—'}</p> : error || parsed.error ? <button type="button" className="summary-warning" onClick={() => onEdit()}>{error || parsed.error}</button> : !file ? <span className="summary-muted">加载中…</span> : !value ? <button type="button" className="summary-add" onClick={() => onEdit(column)}>＋ 填写</button> : zoom < 120 ? <p className="summary-excerpt">{summaryExcerpt(shown, zoom)}</p> : <>{note && <small>↗ 引用已有笔记，不复制正文</small>}{noteId && !note ? <span className="summary-warning">引用的笔记不存在</span> : <SummaryRich paperId={paper.paperId} value={shown} />}</>}
      </div>;
    })}
  </div>;
}
function SummaryRich({ paperId, value }: { paperId: string; value: string }) {
  return <div className="summary-rich"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ src, alt }) => typeof src === 'string' && /^summary-assets\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(src) ? <SummaryImage paperId={paperId} name={src.split('/')[1]} alt={alt ?? '结构图'} /> : <span className="summary-muted">〔非托管图片未加载〕</span>,
    a: ({ href, children }) => <a href={href && /^https?:\/\//i.test(href) ? href : undefined} onClick={event => { event.preventDefault(); if (href) void openSummaryUrl(href).catch(() => {}); }}>{children}</a>,
  }}>{value}</ReactMarkdown></div>;
}
function SummaryImage({ paperId, name, alt }: { paperId: string; name: string; alt: string }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => { let active = true, objectUrl = ''; setUrl(''); setFailed(false); void summaryImage(paperId, name).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (active) setFailed(true); }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [paperId, name]);
  return url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : <span className="summary-muted">{failed ? '图片不可用' : '图片加载中…'}</span>;
}
function SummaryColumns({ columns, enabled, onChange, onClose }: { columns: SummaryColumn[]; enabled: boolean; onChange(next: SummaryColumn[]): void; onClose(): void }) {
  const [name, setName] = useState(''), [kind, setKind] = useState<SummaryColumn['kind']>('text');
  return <aside className="summary-columns" aria-label="总结列设置"><header><strong>总结列设置</strong><button type="button" onClick={onClose}>关闭</button></header><p className="summary-help">时间与期刊/会议默认在标题下显示；也可勾选为独立列。隐藏列保留全部内容，修改后自动保存。</p><fieldset disabled={!enabled}>
    {columns.map((c, i) => <div className="summary-column-setting" key={c.id}>
      <input type="checkbox" aria-label={`显示${c.name}`} checked={!c.hidden} onChange={() => onChange(columns.map(x => x.id === c.id ? { ...x, hidden: !x.hidden } : x))} />
      <input aria-label={`列名称${i + 1}`} value={c.name} maxLength={80} onChange={e => onChange(columns.map(x => x.id === c.id ? { ...x, name: e.target.value } : x))} />
      <input type="number" aria-label={`${c.name}列宽`} min={80} max={800} value={c.width} onChange={e => { const width = Number(e.target.value); if (width >= 80 && width <= 800) onChange(columns.map(x => x.id === c.id ? { ...x, width } : x)); }} />
      <button type="button" aria-label={`上移${c.name}`} disabled={!i} onClick={() => { const next = [...columns]; [next[i-1], next[i]] = [next[i], next[i-1]]; onChange(next); }}>↑</button>
      <button type="button" aria-label={`下移${c.name}`} disabled={i === columns.length - 1} onClick={() => { const next = [...columns]; [next[i+1], next[i]] = [next[i], next[i+1]]; onChange(next); }}>↓</button>
    </div>)}
    <div className="summary-column-add"><input aria-label="新总结列名称" placeholder="新列名称" value={name} maxLength={40} onChange={e => setName(e.target.value)} /><select aria-label="新总结列类型" value={kind} onChange={e => setKind(e.target.value as SummaryColumn['kind'])}><option value="text">文字</option><option value="mixed">图文</option><option value="image">图片</option><option value="note">笔记引用</option></select><button type="button" disabled={!name.trim() || columns.length >= 24} onClick={() => { onChange([...columns, { id: 'custom-' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`), name: name.trim(), kind, width: 220 }]); setName(''); }}>添加</button></div>
    <button type="button" onClick={() => { const ids = new Set(defaultSummaryColumns.map(c => c.id)); onChange([...defaultSummaryColumns.map(c => ({ ...c })), ...columns.filter(c => !ids.has(c.id))]); }}>恢复默认布局（保留自定义列及内容）</button>
  </fieldset></aside>;
}
