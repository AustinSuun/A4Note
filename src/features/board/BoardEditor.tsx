import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ArrowUpRight, Check, Circle, Copy, Eraser, Hand, Layers, LoaderCircle, Maximize2, MousePointer2, PenLine, Redo2, Square, StickyNote, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useTextDocument } from '../explorer/useTextDocument';
import {
  BOARD_MAX_ELEMENTS, appendInkPoint, applyArrowBindings, bindingFor, bringToFront, createElementId, createHistory, deleteElements, duplicateElements,
  elementBounds, elementsInRect, fitViewport, hitTest, normalizeRect, parseBoardDocument, recordHistory, redoHistory, sendToBack, serializeBoardDocument,
  transformElement, translateElement, undoHistory, unionBounds, updateElements, withBounds, withElements, zoomViewport, boardDisplayName, screenToWorld,
  type BoardArrowElement, type BoardDocument, type BoardElement, type BoardHistory, type BoardInkElement, type BoardPoint, type BoardRect, type BoardViewport,
} from '../../core/board';
import './board.css';

export type BoardTool = 'select' | 'hand' | 'text' | 'note' | 'rect' | 'ellipse' | 'arrow' | 'pen' | 'eraser';

export interface BoardEditorProps {
  path: string;
  name: string;
  /** Hidden tabs keep their editor mounted; inactive editors never grab keyboard focus. */
  active?: boolean;
  /** Reader side panel: compact chrome, no file title row. */
  embedded?: boolean;
  /** Extra header controls owned by the host (e.g. the reader's "back to note"). */
  headerExtra?: ReactNode;
  /** Re-read the file after a read error (missing/moved file that came back). */
  onRetry?: () => void;
  /** Wiki-link text for this board; enables the copy-reference action. */
  referenceText?: string;
  onStatus?: (message: string) => void;
}

type Gesture =
  | { kind: 'pan'; pointerId: number; startScreen: BoardPoint; startViewport: BoardViewport }
  | { kind: 'move'; pointerId: number; start: BoardPoint; ids: Set<string>; base: BoardElement[]; moved: boolean }
  | { kind: 'resize'; pointerId: number; handle: HandleId; ids: Set<string>; base: BoardElement[]; box: BoardRect }
  | { kind: 'endpoint'; pointerId: number; id: string; index: 0 | 1; base: BoardElement[] }
  | { kind: 'marquee'; pointerId: number; start: BoardPoint; keep: string[] }
  | { kind: 'shape'; pointerId: number; start: BoardPoint; type: 'rect' | 'ellipse' | 'note' | 'text' }
  | { kind: 'arrow'; pointerId: number; start: BoardPoint }
  | { kind: 'ink'; pointerId: number; points: BoardPoint[] }
  | { kind: 'erase'; pointerId: number; ids: Set<string> };

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Array<{ id: HandleId; fx: number; fy: number; cursor: string }> = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' }, { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' }, { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' }, { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' }, { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' }, { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

const TOOLS: Array<{ id: BoardTool; label: string; key: string; icon: ReactNode }> = [
  { id: 'select', label: '选择', key: 'V', icon: <MousePointer2 size={16} aria-hidden="true" /> },
  { id: 'hand', label: '平移', key: 'H', icon: <Hand size={16} aria-hidden="true" /> },
  { id: 'text', label: '文本', key: 'T', icon: <Type size={16} aria-hidden="true" /> },
  { id: 'note', label: '便签', key: 'N', icon: <StickyNote size={16} aria-hidden="true" /> },
  { id: 'rect', label: '矩形', key: 'R', icon: <Square size={16} aria-hidden="true" /> },
  { id: 'ellipse', label: '椭圆', key: 'O', icon: <Circle size={16} aria-hidden="true" /> },
  { id: 'arrow', label: '连线', key: 'A', icon: <ArrowUpRight size={16} aria-hidden="true" /> },
  { id: 'pen', label: '画笔', key: 'P', icon: <PenLine size={16} aria-hidden="true" /> },
  { id: 'eraser', label: '橡皮（整笔擦除）', key: 'E', icon: <Eraser size={16} aria-hidden="true" /> },
];
const TOOL_BY_KEY = new Map(TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));

const STROKES = [
  { value: 'auto', label: '自动（跟随主题）' }, { value: '#dc2626', label: '红' }, { value: '#2563eb', label: '蓝' }, { value: '#16a34a', label: '绿' },
  { value: '#d97706', label: '橙' }, { value: '#7c3aed', label: '紫' }, { value: '#6b7280', label: '灰' },
];
const FILLS = [
  { value: 'transparent', label: '无填充' }, { value: '#fef3c7', label: '黄' }, { value: '#dbeafe', label: '蓝' }, { value: '#dcfce7', label: '绿' },
  { value: '#fce7f3', label: '粉' }, { value: '#ede9fe', label: '紫' }, { value: '#f3f4f6', label: '灰' },
];
const WIDTHS = [1, 2, 4, 8];
const DEFAULT_NOTE_FILL = '#fef3c7';
const paint = (value: string) => (value === 'auto' ? 'currentColor' : value);

const saveStateText = (state: string) => state === 'saving' ? '保存中…' : state === 'error' ? '保存失败' : state === 'paused' ? '等待文件操作…' : '已保存';

export function BoardEditor({ path, name, active = true, embedded = false, headerExtra, referenceText, onStatus, onRetry }: BoardEditorProps) {
  const { content, setContent, loading, error, saveState, saveError, save, reload } = useTextDocument(path);
  const parsed = useMemo(() => (loading || error ? null : parseBoardDocument(content)), [content, loading, error]);
  const document = parsed?.ok ? parsed.document : null;
  const documentRef = useRef<BoardDocument | null>(null); documentRef.current = document;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<BoardViewport>({ x: 0, y: 0, zoom: 1 });
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const viewportReadyRef = useRef<string | null>(null);
  const [tool, setTool] = useState<BoardTool>('select');
  const toolRef = useRef(tool); toolRef.current = tool;
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [preview, setPreview] = useState<{ elements?: BoardElement[]; marquee?: BoardRect; erasing?: Set<string> } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; created?: boolean } | null>(null);
  const editingRef = useRef(editing); editingRef.current = editing;
  const [stroke, setStroke] = useState('auto');
  const [fill, setFill] = useState('transparent');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [notice, setNotice] = useState('');
  const historyRef = useRef<BoardHistory>(createHistory());
  const [historyVersion, setHistoryVersion] = useState(0);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, BoardPoint>());
  const pinchRef = useRef<{ distance: number; center: BoardPoint; viewport: BoardViewport } | null>(null);
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const elements = preview?.elements ?? document?.elements ?? [];
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const selectedElements = useMemo(() => elements.filter((element) => selectedSet.has(element.id)), [elements, selectedSet]);
  const selectionBox = useMemo(() => unionBounds(selectedElements.map(elementBounds)), [selectedElements]);

  const announce = useCallback((message: string) => { setNotice(message); onStatus?.(message); }, [onStatus]);

  // Container size drives fit/reset and the grid.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Restore the last viewport per board id; fall back to fitting the content once.
  useEffect(() => {
    if (!document || !size.width || viewportReadyRef.current === document.id) return;
    viewportReadyRef.current = document.id;
    try {
      const stored = JSON.parse(localStorage.getItem(`a4note.board.viewport:${document.id}`) ?? 'null');
      if (stored && typeof stored.x === 'number' && typeof stored.y === 'number' && typeof stored.zoom === 'number') { setViewport(stored); return; }
    } catch { /* ignore */ }
    setViewport(fitViewport(unionBounds(document.elements.map(elementBounds)), size));
  }, [document, size]);
  useEffect(() => {
    if (!document || viewportReadyRef.current !== document.id) return;
    const timer = window.setTimeout(() => localStorage.setItem(`a4note.board.viewport:${document.id}`, JSON.stringify(viewport)), 300);
    return () => window.clearTimeout(timer);
  }, [viewport, document]);

  // Drop selection entries that no longer exist (deleted by the other entry, undo, …).
  useEffect(() => {
    if (!document) return;
    const ids = new Set(document.elements.map((element) => element.id));
    if (selection.some((id) => !ids.has(id))) setSelection((current) => current.filter((id) => ids.has(id)));
    // A freshly created element may not be in the parsed document yet on this render.
    if (editing && !editing.created && !ids.has(editing.id)) setEditing(null);
  }, [document, selection, editing]);

  const commit = useCallback((mutate: (current: BoardElement[]) => BoardElement[], key: string | null = null) => {
    const current = documentRef.current;
    if (!current) return;
    const next = applyArrowBindings(mutate(current.elements));
    if (next.length > BOARD_MAX_ELEMENTS) { announce(`白板最多容纳 ${BOARD_MAX_ELEMENTS} 个元素。`); return; }
    historyRef.current = recordHistory(historyRef.current, current.elements, key);
    setHistoryVersion((version) => version + 1);
    setContent(serializeBoardDocument(withElements(current, next)));
  }, [setContent, announce]);

  const undo = useCallback(() => {
    const current = documentRef.current; if (!current) return;
    const result = undoHistory(historyRef.current, current.elements);
    if (!result) { announce('没有可撤销的操作。'); return; }
    historyRef.current = result.history; setHistoryVersion((version) => version + 1);
    setContent(serializeBoardDocument(withElements(current, result.elements)));
  }, [setContent, announce]);
  const redo = useCallback(() => {
    const current = documentRef.current; if (!current) return;
    const result = redoHistory(historyRef.current, current.elements);
    if (!result) { announce('没有可重做的操作。'); return; }
    historyRef.current = result.history; setHistoryVersion((version) => version + 1);
    setContent(serializeBoardDocument(withElements(current, result.elements)));
  }, [setContent, announce]);

  const screenPoint = (event: { clientX: number; clientY: number }): BoardPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const worldPoint = (event: { clientX: number; clientY: number }) => screenToWorld(viewportRef.current, screenPoint(event));
  const slop = () => 6 / viewportRef.current.zoom;

  const finishEditing = useCallback((commitText = true) => {
    const current = editingRef.current;
    if (!current) return;
    const text = textareaRef.current?.value ?? current.text;
    setEditing(null);
    commit((list) => {
      const target = list.find((element) => element.id === current.id);
      if (!target) return list;
      if (!commitText) return current.created ? list.filter((element) => element.id !== current.id) : list;
      if (target.type === 'text' && !text.trim()) return list.filter((element) => element.id !== current.id);
      return list.map((element) => (element.id === current.id ? { ...element, text } : element));
    }, `text:${current.id}`);
  }, [commit]);

  const startEditing = (element: BoardElement, created = false) => {
    if (element.type === 'ink' || element.type === 'arrow') return;
    setSelection([element.id]);
    setEditing({ id: element.id, text: element.text ?? '', created });
  };

  const handleAt = (screen: BoardPoint): HandleId | null => {
    if (!selectionBox || selectedElements.length === 0) return null;
    if (selectedElements.length === 1 && selectedElements[0].type === 'arrow') return null;
    const { zoom, x, y } = viewportRef.current;
    for (const handle of HANDLES) {
      const hx = (selectionBox.x + handle.fx * selectionBox.w) * zoom + x;
      const hy = (selectionBox.y + handle.fy * selectionBox.h) * zoom + y;
      if (Math.abs(hx - screen.x) <= 7 && Math.abs(hy - screen.y) <= 7) return handle.id;
    }
    return null;
  };
  const arrowEndpointAt = (screen: BoardPoint): 0 | 1 | null => {
    const only = selectedElements.length === 1 ? selectedElements[0] : null;
    if (!only || only.type !== 'arrow') return null;
    const { zoom, x, y } = viewportRef.current;
    for (const index of [0, 1] as const) {
      const point = only.points[index];
      if (Math.abs(point.x * zoom + x - screen.x) <= 8 && Math.abs(point.y * zoom + y - screen.y) <= 8) return index;
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!document) return;
    if (editing) finishEditing(true);
    containerRef.current?.focus({ preventScroll: true });
    const screen = screenPoint(event);
    pointersRef.current.set(event.pointerId, screen);
    if (pointersRef.current.size === 2) {
      // Second touch: turn whatever was in progress into a pinch.
      gestureRef.current = null; setPreview(null);
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, viewport: viewportRef.current };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = worldPoint(event);
    const currentTool = toolRef.current;
    if (event.button === 1 || spaceRef.current || currentTool === 'hand') {
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, startScreen: screen, startViewport: viewportRef.current };
      return;
    }
    if (event.button !== 0) return;
    const list = document.elements;
    switch (currentTool) {
      case 'select': {
        const endpoint = arrowEndpointAt(screen);
        if (endpoint !== null) { gestureRef.current = { kind: 'endpoint', pointerId: event.pointerId, id: selection[0], index: endpoint, base: list }; return; }
        const handle = handleAt(screen);
        if (handle && selectionBox) { gestureRef.current = { kind: 'resize', pointerId: event.pointerId, handle, ids: new Set(selection), base: list, box: selectionBox }; return; }
        const hit = hitTest(list, world, slop());
        if (hit) {
          let ids: string[];
          if (event.shiftKey) ids = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
          else ids = selection.includes(hit.id) ? selection : [hit.id];
          setSelection(ids);
          if (ids.includes(hit.id)) gestureRef.current = { kind: 'move', pointerId: event.pointerId, start: world, ids: new Set(ids), base: list, moved: false };
          return;
        }
        if (!event.shiftKey) setSelection([]);
        gestureRef.current = { kind: 'marquee', pointerId: event.pointerId, start: world, keep: event.shiftKey ? selection : [] };
        return;
      }
      case 'rect': case 'ellipse': case 'note': case 'text':
        gestureRef.current = { kind: 'shape', pointerId: event.pointerId, start: world, type: currentTool };
        return;
      case 'arrow':
        gestureRef.current = { kind: 'arrow', pointerId: event.pointerId, start: world };
        return;
      case 'pen':
        gestureRef.current = { kind: 'ink', pointerId: event.pointerId, points: [world] };
        setPreview({ elements: [...list, inkElement([world])] });
        return;
      case 'eraser': {
        const ids = new Set<string>();
        const hit = hitTest(list, world, slop());
        if (hit) ids.add(hit.id);
        gestureRef.current = { kind: 'erase', pointerId: event.pointerId, ids };
        setPreview({ erasing: new Set(ids) });
        return;
      }
      default: return;
    }
  };

  const inkElement = (points: BoardPoint[]): BoardInkElement => withBounds({ id: '__ink_preview', type: 'ink', x: 0, y: 0, w: 0, h: 0, stroke, fill: 'transparent', strokeWidth, points });
  const newShape = (type: 'rect' | 'ellipse' | 'note' | 'text', rect: BoardRect): BoardElement => {
    const base = { id: createElementId(), ...rect, strokeWidth };
    if (type === 'note') return { ...base, type: 'note', text: '', stroke: 'transparent', fill: fill === 'transparent' ? DEFAULT_NOTE_FILL : fill, fontSize: 15 };
    if (type === 'text') return { ...base, type: 'text', text: '', stroke, fill: 'transparent', fontSize: 16 };
    return { ...base, type, stroke, fill, text: '' };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const screen = screenPoint(event);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, screen);
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomViewport(pinch.viewport, pinch.viewport.zoom * (distance / pinch.distance), pinch.center);
      setViewport({ ...zoomed, x: zoomed.x + center.x - pinch.center.x, y: zoomed.y + center.y - pinch.center.y });
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !document) return;
    const world = worldPoint(event);
    switch (gesture.kind) {
      case 'pan':
        setViewport({ ...gesture.startViewport, x: gesture.startViewport.x + screen.x - gesture.startScreen.x, y: gesture.startViewport.y + screen.y - gesture.startScreen.y });
        return;
      case 'move': {
        const dx = world.x - gesture.start.x; const dy = world.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) * viewportRef.current.zoom < 3) return;
        gesture.moved = true;
        setPreview({ elements: applyArrowBindings(moveSet(gesture.base, gesture.ids, dx, dy)) });
        return;
      }
      case 'resize': {
        const box = resizeBox(gesture.box, gesture.handle, world, event.shiftKey);
        setPreview({ elements: applyArrowBindings(updateElements(gesture.base, gesture.ids, (element) => transformElement(element, gesture.box, box))) });
        return;
      }
      case 'endpoint': {
        setPreview({ elements: gesture.base.map((element) => {
          if (element.id !== gesture.id || element.type !== 'arrow') return element;
          const points: [BoardPoint, BoardPoint] = [element.points[0], element.points[1]];
          points[gesture.index] = world;
          const binding = bindingFor(gesture.base, world, element.id);
          const next: BoardArrowElement = { ...element, points };
          if (gesture.index === 0) { if (binding) next.from = binding; else delete next.from; } else if (binding) next.to = binding; else delete next.to;
          return withBounds(next);
        }) });
        return;
      }
      case 'marquee': {
        const rect = normalizeRect(gesture.start, world);
        setPreview({ marquee: rect });
        setSelection([...new Set([...gesture.keep, ...elementsInRect(document.elements, rect)])]);
        return;
      }
      case 'shape': {
        const rect = event.shiftKey ? squareRect(gesture.start, world) : normalizeRect(gesture.start, world);
        setPreview({ elements: [...document.elements, { ...newShape(gesture.type, rect), id: '__shape_preview' }] });
        return;
      }
      case 'arrow': {
        const to = bindingFor(document.elements, world);
        const arrow: BoardArrowElement = withBounds({ id: '__arrow_preview', type: 'arrow', x: 0, y: 0, w: 0, h: 0, stroke, fill: 'transparent', strokeWidth, points: [gesture.start, world], head: 'end', ...(to ? { to } : {}) });
        setPreview({ elements: [...document.elements, arrow] });
        return;
      }
      case 'ink': {
        gesture.points = appendInkPoint(gesture.points, world, 1.2 / viewportRef.current.zoom);
        setPreview({ elements: [...document.elements, inkElement(gesture.points)] });
        return;
      }
      case 'erase': {
        const hit = hitTest(document.elements, world, slop());
        if (hit && !gesture.ids.has(hit.id)) { gesture.ids.add(hit.id); setPreview({ erasing: new Set(gesture.ids) }); }
        return;
      }
      default: return;
    }
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const world = worldPoint(event);
    const currentPreview = preview;
    setPreview(null);
    if (!document) return;
    switch (gesture.kind) {
      case 'move': {
        if (!gesture.moved) return;
        const dx = world.x - gesture.start.x; const dy = world.y - gesture.start.y;
        commit((list) => moveSet(list, gesture.ids, dx, dy));
        return;
      }
      case 'resize': {
        const box = resizeBox(gesture.box, gesture.handle, world, event.shiftKey);
        commit((list) => updateElements(list, gesture.ids, (element) => transformElement(element, gesture.box, box)));
        return;
      }
      case 'endpoint': {
        const moved = currentPreview?.elements?.find((element) => element.id === gesture.id);
        if (moved) commit((list) => list.map((element) => (element.id === gesture.id ? moved : element)));
        return;
      }
      case 'shape': {
        const dragged = Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * viewportRef.current.zoom >= 4;
        const rect = dragged
          ? (event.shiftKey ? squareRect(gesture.start, world) : normalizeRect(gesture.start, world))
          : defaultRect(gesture.type, gesture.start);
        const element = newShape(gesture.type, { ...rect, w: Math.max(rect.w, 8), h: Math.max(rect.h, 8) });
        commit((list) => [...list, element]);
        setTool('select');
        if (gesture.type === 'note' || gesture.type === 'text') startEditing(element, true); else setSelection([element.id]);
        return;
      }
      case 'arrow': {
        if (Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * viewportRef.current.zoom < 4) return;
        const from = bindingFor(document.elements, gesture.start); const to = bindingFor(document.elements, world);
        const arrow: BoardArrowElement = withBounds({ id: createElementId(), type: 'arrow', x: 0, y: 0, w: 0, h: 0, stroke, fill: 'transparent', strokeWidth, points: [gesture.start, world], head: 'end', ...(from ? { from } : {}), ...(to ? { to } : {}) });
        commit((list) => [...list, arrow]);
        setSelection([arrow.id]);
        setTool('select');
        return;
      }
      case 'ink': {
        const element: BoardInkElement = { ...inkElement(gesture.points), id: createElementId() };
        commit((list) => [...list, element]);
        return;
      }
      case 'erase': {
        if (gesture.ids.size) commit((list) => deleteElements(list, gesture.ids));
        return;
      }
      default: return;
    }
  };
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (gestureRef.current?.pointerId === event.pointerId) { gestureRef.current = null; setPreview(null); }
  };
  const onDoubleClick = (event: { clientX: number; clientY: number }) => {
    if (!document || toolRef.current !== 'select') return;
    const hit = hitTest(document.elements, worldPoint(event), slop());
    if (hit) startEditing(hit);
  };

  // Wheel must be non-passive to stop the host from scrolling the tab.
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewportRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect();
        setViewport(zoomViewport(current, current.zoom * Math.exp(-event.deltaY * 0.0018), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
      } else if (event.shiftKey && !event.deltaX) {
        setViewport({ ...current, x: current.x - event.deltaY });
      } else {
        setViewport({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [document?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (factor: number) => setViewport((current) => zoomViewport(current, current.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  const fitAll = () => { if (document) setViewport(fitViewport(unionBounds(document.elements.map(elementBounds)), size)); };
  const resetZoom = () => setViewport((current) => zoomViewport(current, 1, { x: size.width / 2, y: size.height / 2 }));

  const deleteSelection = () => { if (selection.length) { const ids = new Set(selection); setSelection([]); commit((list) => deleteElements(list, ids)); } };
  const duplicateSelection = () => {
    if (!selection.length) return;
    const ids = new Set(selection);
    let created: string[] = [];
    commit((list) => { const result = duplicateElements(list, ids); created = result.ids; return result.elements; });
    setSelection(created);
  };
  const selectAll = () => { if (document) setSelection(document.elements.map((element) => element.id)); };
  const nudge = (dx: number, dy: number) => { if (selection.length) { const ids = new Set(selection); commit((list) => moveSet(list, ids, dx, dy), 'nudge'); } };
  const applyStyle = (patch: Partial<Pick<BoardElement, 'stroke' | 'fill' | 'strokeWidth'>>) => {
    if (patch.stroke !== undefined) setStroke(patch.stroke);
    if (patch.fill !== undefined) setFill(patch.fill);
    if (patch.strokeWidth !== undefined) setStrokeWidth(patch.strokeWidth);
    if (selection.length) { const ids = new Set(selection); commit((list) => updateElements(list, ids, (element) => ({ ...element, ...patch })), 'style'); }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (key === ' ' && !spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); event.preventDefault(); return; }
    if (mod && key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (mod && key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
    if (mod && key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
    if (mod && key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
    if (mod && (key === '=' || key === '+')) { event.preventDefault(); zoomBy(1.2); return; }
    if (mod && key === '-') { event.preventDefault(); zoomBy(1 / 1.2); return; }
    if (mod && key === '0') { event.preventDefault(); resetZoom(); return; }
    if (mod && key === '1') { event.preventDefault(); fitAll(); return; }
    if (mod) return;
    if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if (key === 'Escape') {
      event.preventDefault();
      if (gestureRef.current) { gestureRef.current = null; setPreview(null); return; }
      if (selection.length) { setSelection([]); return; }
      setTool('select');
      return;
    }
    if (key === 'Enter' && selection.length === 1) {
      const only = elements.find((element) => element.id === selection[0]);
      if (only && only.type !== 'ink' && only.type !== 'arrow') { event.preventDefault(); startEditing(only); return; }
    }
    const step = event.shiftKey ? 10 : 1;
    if (key === 'ArrowLeft') { event.preventDefault(); nudge(-step, 0); return; }
    if (key === 'ArrowRight') { event.preventDefault(); nudge(step, 0); return; }
    if (key === 'ArrowUp') { event.preventDefault(); nudge(0, -step); return; }
    if (key === 'ArrowDown') { event.preventDefault(); nudge(0, step); return; }
    if (key === '[') { event.preventDefault(); if (selection.length) { const ids = new Set(selection); commit((list) => sendToBack(list, ids)); } return; }
    if (key === ']') { event.preventDefault(); if (selection.length) { const ids = new Set(selection); commit((list) => bringToFront(list, ids)); } return; }
    const nextTool = TOOL_BY_KEY.get(key.toLowerCase());
    if (nextTool && !event.altKey) { event.preventDefault(); setTool(nextTool); }
  };
  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') { spaceRef.current = false; setSpaceHeld(false); }
  };
  useEffect(() => {
    const clear = () => { spaceRef.current = false; setSpaceHeld(false); };
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);

  const copyReference = async () => {
    if (!referenceText) return;
    try { await navigator.clipboard.writeText(referenceText); announce(`已复制引用：${referenceText}`); }
    catch { announce(`复制失败，请手动输入：${referenceText}`); }
  };

  const exportDraft = () => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url; link.download = name || 'board.a4board'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);

  const displayName = boardDisplayName(name);
  const cursor = spaceHeld || tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair';
  const canUndo = historyRef.current.past.length > 0; const canRedo = historyRef.current.future.length > 0; void historyVersion;
  const single = selectedElements.length === 1 ? selectedElements[0] : null;
  const editingElement = editing ? elements.find((element) => element.id === editing.id) : null;
  useEffect(() => {
    const node = textareaRef.current;
    if (!editingElement || !node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [editingElement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`board-editor${embedded ? ' embedded' : ''}`} data-board-id={document?.id ?? ''} data-board-tool={tool}>
      <div className="board-toolbar" role="toolbar" aria-label="白板工具栏">
        {!embedded && <div className="board-title" title={path}><Layers size={15} aria-hidden="true" /><span>{displayName}</span></div>}
        <div className="board-tool-group" role="group" aria-label="工具">
          {TOOLS.map((item) => (
            <button key={item.id} type="button" className={`board-tool${tool === item.id ? ' active' : ''}`} aria-pressed={tool === item.id}
              title={`${item.label}（${item.key}）`} aria-label={item.label} data-tool={item.id} onClick={() => { finishEditing(true); setTool(item.id); }}>{item.icon}</button>
          ))}
        </div>
        <div className="board-tool-group" role="group" aria-label="样式">
          <span className="board-swatches" aria-label="描边颜色">
            {STROKES.map((item) => <button key={item.value} type="button" className={`board-swatch${stroke === item.value ? ' active' : ''}`} title={`描边：${item.label}`} aria-label={`描边 ${item.label}`} aria-pressed={stroke === item.value}
              style={{ ['--swatch' as string]: paint(item.value) } as CSSProperties} onClick={() => applyStyle({ stroke: item.value })} />)}
          </span>
          <span className="board-swatches" aria-label="填充颜色">
            {FILLS.map((item) => <button key={item.value} type="button" className={`board-swatch fill${fill === item.value ? ' active' : ''}${item.value === 'transparent' ? ' none' : ''}`} title={`填充：${item.label}`} aria-label={`填充 ${item.label}`} aria-pressed={fill === item.value}
              style={{ ['--swatch' as string]: item.value } as CSSProperties} onClick={() => applyStyle({ fill: item.value })} />)}
          </span>
          <select className="board-width" aria-label="线宽" value={strokeWidth} onChange={(event) => applyStyle({ strokeWidth: Number(event.target.value) })}>
            {WIDTHS.map((width) => <option key={width} value={width}>{width}px</option>)}
          </select>
        </div>
        <div className="board-tool-group" role="group" aria-label="编辑">
          <button type="button" className="board-tool" onClick={undo} disabled={!canUndo} title="撤销（Ctrl+Z）" aria-label="撤销"><Undo2 size={16} aria-hidden="true" /></button>
          <button type="button" className="board-tool" onClick={redo} disabled={!canRedo} title="重做（Ctrl+Shift+Z）" aria-label="重做"><Redo2 size={16} aria-hidden="true" /></button>
          <button type="button" className="board-tool" onClick={duplicateSelection} disabled={!selection.length} title="复制所选（Ctrl+D）" aria-label="复制所选"><Copy size={16} aria-hidden="true" /></button>
          <button type="button" className="board-tool" onClick={deleteSelection} disabled={!selection.length} title="删除所选（Delete）" aria-label="删除所选"><Trash2 size={16} aria-hidden="true" /></button>
        </div>
        <div className="board-tool-group" role="group" aria-label="视图">
          <button type="button" className="board-tool" onClick={() => zoomBy(1 / 1.2)} title="缩小（Ctrl+-）" aria-label="缩小"><ZoomOut size={16} aria-hidden="true" /></button>
          <button type="button" className="board-zoom" onClick={resetZoom} title="重置缩放（Ctrl+0）" aria-label="当前缩放，点击重置">{Math.round(viewport.zoom * 100)}%</button>
          <button type="button" className="board-tool" onClick={() => zoomBy(1.2)} title="放大（Ctrl+=）" aria-label="放大"><ZoomIn size={16} aria-hidden="true" /></button>
          <button type="button" className="board-tool" onClick={fitAll} title="适应内容（Ctrl+1）" aria-label="适应内容"><Maximize2 size={16} aria-hidden="true" /></button>
        </div>
        <div className="board-toolbar-spacer" />
        {referenceText && <button type="button" className="board-text-button" onClick={() => void copyReference()} title={`复制笔记引用 ${referenceText}`}>复制引用</button>}
        {headerExtra}
        <span className={`board-save-state ${saveState}`} data-board-save-state={saveState} title={saveStateText(saveState)}>
          {saveState === 'saving' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : saveState === 'saved' ? <Check size={14} aria-hidden="true" /> : null}
          <span>{saveStateText(saveState)}</span>
        </span>
      </div>
      {document && document.links.length > 0 && (
        <div className="board-links" aria-label="关联文献">
          {document.links.map((link) => <span key={link.paperId} className="board-link-chip" title={`已关联文献 ${link.paperId}`}>文献：{link.title || link.paperId}</span>)}
        </div>
      )}
      {(saveError || (parsed && parsed.ok && parsed.warnings.length > 0)) && (
        <div className="board-banner" role="alert">
          <span>{saveError || parsed?.ok && parsed.warnings.join(' ')}</span>
          {saveError && <>
            <button type="button" onClick={save}>重试保存</button>
            <button type="button" onClick={() => void reload()}>重新加载磁盘版本</button>
            <button type="button" onClick={exportDraft}>导出草稿</button>
          </>}
        </div>
      )}
      <div ref={containerRef} className="board-stage" tabIndex={0} role="application" aria-label={`白板 ${displayName}`} onKeyDown={onKeyDown} onKeyUp={onKeyUp} style={{ cursor }} data-board-active={active ? 'true' : 'false'}>
        {loading && <div className="board-state"><LoaderCircle className="spin" aria-hidden="true" /><span>正在读取白板…</span></div>}
        {!loading && error && (
          <div className="board-state error" role="alert">
            <strong>无法打开白板</strong>
            <span>{error}</span>
            <span className="board-state-path">{path}</span>
            {onRetry && <div className="board-state-actions"><button type="button" onClick={onRetry}>重试</button></div>}
            {headerExtra}
          </div>
        )}
        {!loading && !error && parsed && !parsed.ok && (
          <div className="board-state error" role="alert">
            <strong>无法解析白板文件</strong>
            <span>{parsed.error}</span>
            <span>为避免覆盖内容，白板已切换为只读。你可以重新加载磁盘版本，或导出当前内容后手工修复。</span>
            <div className="board-state-actions">
              <button type="button" onClick={() => void reload()}>重新加载</button>
              <button type="button" onClick={exportDraft}>导出当前内容</button>
            </div>
          </div>
        )}
        {document && (
          <>
            <svg ref={svgRef} className="board-canvas" width={size.width || '100%'} height={size.height || '100%'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onDoubleClick={onDoubleClick} onContextMenu={(event) => event.preventDefault()}>
              <defs>
                <pattern id={`board-grid-${document.id}`} width={24 * viewport.zoom} height={24 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x} y={viewport.y}>
                  <circle cx={0.5} cy={0.5} r={Math.max(0.6, Math.min(1.4, viewport.zoom))} className="board-grid-dot" />
                </pattern>
              </defs>
              <rect className="board-grid" width="100%" height="100%" fill={`url(#board-grid-${document.id})`} />
              <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
                {elements.map((element) => <ElementView key={element.id} element={element} selected={selectedSet.has(element.id)} erasing={preview?.erasing?.has(element.id) ?? false} editing={editing?.id === element.id} />)}
                {selectionBox && !editing && (
                  <g className="board-selection" pointerEvents="none">
                    <rect x={selectionBox.x} y={selectionBox.y} width={selectionBox.w} height={selectionBox.h} vectorEffect="non-scaling-stroke" />
                    {single?.type === 'arrow'
                      ? single.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={6 / viewport.zoom} className={`board-handle${(index === 0 ? single.from : single.to) ? ' bound' : ''}`} vectorEffect="non-scaling-stroke" />)
                      : HANDLES.map((handle) => <rect key={handle.id} x={selectionBox.x + handle.fx * selectionBox.w - 5 / viewport.zoom} y={selectionBox.y + handle.fy * selectionBox.h - 5 / viewport.zoom} width={10 / viewport.zoom} height={10 / viewport.zoom} className="board-handle" vectorEffect="non-scaling-stroke" />)}
                  </g>
                )}
                {preview?.marquee && <rect className="board-marquee" x={preview.marquee.x} y={preview.marquee.y} width={preview.marquee.w} height={preview.marquee.h} vectorEffect="non-scaling-stroke" />}
              </g>
            </svg>
            {document.elements.length === 0 && !preview && (
              <div className="board-empty" aria-hidden="true">
                <strong>空白白板</strong>
                <span>选择上方工具后在画布上点击或拖动：便签（N）、文本（T）、矩形（R）、连线（A）、画笔（P）。按住空格或滚轮拖动可平移，Ctrl+滚轮缩放。</span>
              </div>
            )}
            {editing && editingElement && (
              <textarea
                ref={textareaRef}
                className={`board-text-editor ${editingElement.type}`}
                aria-label="编辑文本"
                defaultValue={editing.text}
                style={{
                  left: editingElement.x * viewport.zoom + viewport.x,
                  top: editingElement.y * viewport.zoom + viewport.y,
                  width: Math.max(editingElement.w * viewport.zoom, 40),
                  height: Math.max(editingElement.h * viewport.zoom, 24),
                  fontSize: (editingElement.fontSize ?? 15) * viewport.zoom,
                  color: editingElement.type === 'note' ? '#1f2937' : paint(editingElement.stroke),
                  background: editingElement.type === 'note' ? editingElement.fill : 'transparent',
                }}
                onBlur={() => finishEditing(true)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') { event.preventDefault(); finishEditing(true); containerRef.current?.focus(); }
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finishEditing(true); containerRef.current?.focus(); }
                }}
                onPointerDown={(event) => event.stopPropagation()}
              />
            )}
            <div className="board-status" aria-live="polite">
              {notice || (selection.length ? `已选择 ${selection.length} 个元素` : `${document.elements.length} 个元素`)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Move a set of elements; a bound arrow moved without its target is released instead of snapping back. */
function moveSet(list: BoardElement[], ids: Set<string>, dx: number, dy: number): BoardElement[] {
  return updateElements(list, ids, (element) => {
    const moved = translateElement(element, dx, dy);
    if (moved.type !== 'arrow') return moved;
    const next: BoardArrowElement = { ...moved };
    if (next.from && !ids.has(next.from.elementId)) delete next.from;
    if (next.to && !ids.has(next.to.elementId)) delete next.to;
    return next;
  });
}

function resizeBox(box: BoardRect, handle: HandleId, world: BoardPoint, keepRatio: boolean): BoardRect {
  let { x, y, w, h } = box;
  const right = x + w; const bottom = y + h;
  const minSize = 4;
  if (handle.includes('w')) { x = Math.min(world.x, right - minSize); w = right - x; }
  if (handle.includes('e')) { w = Math.max(minSize, world.x - x); }
  if (handle.includes('n')) { y = Math.min(world.y, bottom - minSize); h = bottom - y; }
  if (handle.includes('s')) { h = Math.max(minSize, world.y - y); }
  if (keepRatio && box.w && box.h && handle.length === 2) {
    const ratio = box.w / box.h;
    if (w / h > ratio) w = h * ratio; else h = w / ratio;
    if (handle.includes('w')) x = right - w;
    if (handle.includes('n')) y = bottom - h;
  }
  return { x, y, w, h };
}

function squareRect(start: BoardPoint, end: BoardPoint): BoardRect {
  const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return { x: end.x < start.x ? start.x - side : start.x, y: end.y < start.y ? start.y - side : start.y, w: side, h: side };
}

function defaultRect(type: 'rect' | 'ellipse' | 'note' | 'text', at: BoardPoint): BoardRect {
  const size = type === 'note' ? { w: 180, h: 140 } : type === 'text' ? { w: 220, h: 44 } : { w: 160, h: 100 };
  return { x: at.x - size.w / 2, y: at.y - size.h / 2, ...size };
}

function ElementView({ element, selected, erasing, editing }: { element: BoardElement; selected: boolean; erasing: boolean; editing: boolean }) {
  const className = `board-element ${element.type}${selected ? ' selected' : ''}${erasing ? ' erasing' : ''}`;
  const strokeColor = paint(element.stroke);
  switch (element.type) {
    case 'rect':
      return <g className={className} data-element-id={element.id}>
        <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={6} fill={element.fill} stroke={strokeColor} strokeWidth={element.strokeWidth} />
        {!editing && <TextBlock element={element} color={strokeColor} />}
      </g>;
    case 'ellipse':
      return <g className={className} data-element-id={element.id}>
        <ellipse cx={element.x + element.w / 2} cy={element.y + element.h / 2} rx={element.w / 2} ry={element.h / 2} fill={element.fill} stroke={strokeColor} strokeWidth={element.strokeWidth} />
        {!editing && <TextBlock element={element} color={strokeColor} />}
      </g>;
    case 'note':
      return <g className={className} data-element-id={element.id}>
        <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={4} fill={element.fill} className="board-note-paper" />
        {!editing && <TextBlock element={element} color="#1f2937" align="start" />}
      </g>;
    case 'text':
      return <g className={className} data-element-id={element.id}>
        <rect x={element.x} y={element.y} width={element.w} height={element.h} fill="transparent" className="board-text-hit" />
        {!editing && <TextBlock element={element} color={strokeColor} align="start" />}
      </g>;
    case 'ink':
      return <path className={className} data-element-id={element.id} d={inkPath(element.points)} fill="none" stroke={strokeColor} strokeWidth={element.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
    case 'arrow': {
      const [a, b] = element.points;
      return <g className={className} data-element-id={element.id}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={strokeColor} strokeWidth={element.strokeWidth} strokeLinecap="round" />
        {(element.head === 'end' || element.head === 'both') && <polygon points={arrowHead(a, b, element.strokeWidth)} fill={strokeColor} />}
        {element.head === 'both' && <polygon points={arrowHead(b, a, element.strokeWidth)} fill={strokeColor} />}
      </g>;
    }
    default: return null;
  }
}

function TextBlock({ element, color, align = 'center' }: { element: BoardElement; color: string; align?: 'start' | 'center' }) {
  if (!element.text || element.w <= 0 || element.h <= 0) return null;
  return <foreignObject x={element.x} y={element.y} width={element.w} height={element.h} pointerEvents="none">
    <div className={`board-text-block ${align}`} style={{ color, fontSize: element.fontSize ?? 15 }}>{element.text}</div>
  </foreignObject>;
}

function inkPath(points: BoardPoint[]) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]; const point = points[index];
    const mid = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
    d += ` Q ${previous.x} ${previous.y} ${mid.x} ${mid.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function arrowHead(from: BoardPoint, to: BoardPoint, width: number) {
  const size = 8 + width * 2;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = { x: to.x - size * Math.cos(angle - Math.PI / 7), y: to.y - size * Math.sin(angle - Math.PI / 7) };
  const right = { x: to.x - size * Math.cos(angle + Math.PI / 7), y: to.y - size * Math.sin(angle + Math.PI / 7) };
  return `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`;
}
