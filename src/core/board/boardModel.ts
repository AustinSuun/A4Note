/**
 * Board document model (task 4093839c, phase 1: whiteboard).
 *
 * A board is one JSON text file (`*.a4board`) inside the notes workspace. The
 * file is the single identity of the board: every entry (notes file tree,
 * `[[name.a4board]]` wiki links, the reader note switcher) opens the same path
 * through the shared text-document session, so a save from one entry is the
 * version every other entry sees. Nothing here touches the DOM; the editor
 * layers gestures and rendering on top of these pure helpers.
 */

export const BOARD_FORMAT = 'a4board';
export const BOARD_VERSION = 1;
export const BOARD_EXTENSION = 'a4board';
/** Upper bound that keeps the JSON file, hit-testing and rendering predictable. */
export const BOARD_MAX_ELEMENTS = 5000;
export const BOARD_MAX_INK_POINTS = 4000;

export type BoardKind = 'whiteboard' | 'mindmap' | 'clueboard';

export interface BoardPoint { x: number; y: number }
export interface BoardRect { x: number; y: number; w: number; h: number }

export interface BoardElementStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
}

interface BoardElementBase extends BoardRect, BoardElementStyle {
  id: string;
  /** Free text shown inside shapes / sticky notes. */
  text?: string;
  fontSize?: number;
}

export interface BoardShapeElement extends BoardElementBase { type: 'rect' | 'ellipse' }
export interface BoardNoteElement extends BoardElementBase { type: 'note'; text: string }
export interface BoardTextElement extends BoardElementBase { type: 'text'; text: string }
export interface BoardInkElement extends BoardElementBase { type: 'ink'; points: BoardPoint[] }
export interface BoardArrowBinding { elementId: string; fx: number; fy: number }
export interface BoardArrowElement extends BoardElementBase {
  type: 'arrow';
  points: [BoardPoint, BoardPoint];
  head: 'none' | 'end' | 'both';
  /** Optional dashed stroke (shared arrow options, task 97fcfb6c); absent = solid. */
  dash?: 'dashed';
  from?: BoardArrowBinding;
  to?: BoardArrowBinding;
}

export type BoardElement = BoardShapeElement | BoardNoteElement | BoardTextElement | BoardInkElement | BoardArrowElement;
export type BoardElementType = BoardElement['type'];

export interface BoardPaperLink {
  kind: 'paper';
  paperId: string;
  /** Frozen title so a deleted paper still reads as something on the board. */
  title: string;
  linkedAt: string;
}
export type BoardLink = BoardPaperLink;

export interface BoardDocument {
  format: typeof BOARD_FORMAT;
  version: number;
  id: string;
  kind: BoardKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  links: BoardLink[];
  elements: BoardElement[];
}

export type BoardParseResult =
  | { ok: true; document: BoardDocument; warnings: string[] }
  | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

export function createBoardId(now: () => number = Date.now) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `b_${now().toString(36)}${random}`;
}

export function createElementId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8) + Math.random().toString(36).slice(2, 6)
    : Math.random().toString(36).slice(2, 14);
}

export function createBoardDocument(input: { title: string; kind?: BoardKind; links?: BoardLink[]; id?: string; now?: string }): BoardDocument {
  const now = input.now ?? new Date().toISOString();
  return {
    format: BOARD_FORMAT,
    version: BOARD_VERSION,
    id: input.id ?? createBoardId(),
    kind: input.kind ?? 'whiteboard',
    title: input.title,
    createdAt: now,
    updatedAt: now,
    links: input.links ?? [],
    elements: [],
  };
}

export function serializeBoardDocument(document: BoardDocument) {
  return JSON.stringify(document, null, 2) + '\n';
}

/** Parse with validation: malformed input is an explicit error, never a silently emptied board. */
export function parseBoardDocument(text: string): BoardParseResult {
  if (!text.trim()) return { ok: false, error: '白板文件为空。' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { return { ok: false, error: `白板文件不是有效的 JSON：${error instanceof Error ? error.message : String(error)}` }; }
  if (!isRecord(raw)) return { ok: false, error: '白板文件的顶层必须是对象。' };
  if (raw.format !== BOARD_FORMAT) return { ok: false, error: `不是 ${BOARD_FORMAT} 白板文件（format=${String(raw.format)}）。` };
  const version = num(raw.version, 0);
  if (version > BOARD_VERSION) return { ok: false, error: `白板文件版本 ${version} 高于当前支持的 ${BOARD_VERSION}，请升级应用后再编辑。` };
  if (typeof raw.id !== 'string' || !raw.id) return { ok: false, error: '白板缺少稳定 id。' };
  const warnings: string[] = [];
  const kind: BoardKind = raw.kind === 'mindmap' || raw.kind === 'clueboard' ? raw.kind : 'whiteboard';
  if (raw.kind !== undefined && raw.kind !== kind) warnings.push(`未知的板面类型 ${String(raw.kind)}，按白板打开。`);
  const links: BoardLink[] = [];
  if (Array.isArray(raw.links)) {
    for (const item of raw.links) {
      if (isRecord(item) && item.kind === 'paper' && typeof item.paperId === 'string' && item.paperId) {
        links.push({ kind: 'paper', paperId: item.paperId, title: str(item.title), linkedAt: str(item.linkedAt) });
      } else warnings.push('忽略了一条无法识别的关联记录。');
    }
  }
  const elements: BoardElement[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.elements)) {
    for (const item of raw.elements) {
      const element = normalizeElement(item);
      if (!element) { warnings.push('忽略了一个无法识别的元素。'); continue; }
      if (seen.has(element.id)) { warnings.push(`忽略了重复 id 的元素 ${element.id}。`); continue; }
      seen.add(element.id);
      elements.push(element);
      if (elements.length >= BOARD_MAX_ELEMENTS) { warnings.push(`元素数量超过 ${BOARD_MAX_ELEMENTS}，多余部分未加载。`); break; }
    }
  }
  return {
    ok: true,
    warnings,
    document: {
      format: BOARD_FORMAT,
      version: BOARD_VERSION,
      id: raw.id,
      kind,
      title: str(raw.title),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
      links,
      elements,
    },
  };
}

function normalizeElement(item: unknown): BoardElement | null {
  if (!isRecord(item) || typeof item.id !== 'string' || !item.id) return null;
  const base = {
    id: item.id,
    x: num(item.x), y: num(item.y), w: Math.max(0, num(item.w)), h: Math.max(0, num(item.h)),
    stroke: str(item.stroke, '#1f2937'), fill: str(item.fill, 'transparent'), strokeWidth: Math.max(0.5, num(item.strokeWidth, 2)),
    ...(typeof item.text === 'string' ? { text: item.text } : {}),
    ...(typeof item.fontSize === 'number' ? { fontSize: item.fontSize } : {}),
  };
  const points = Array.isArray(item.points)
    ? item.points.filter(isRecord).map((point) => ({ x: num(point.x), y: num(point.y) }))
    : [];
  switch (item.type) {
    case 'rect': case 'ellipse': return { ...base, type: item.type };
    case 'note': return { ...base, type: 'note', text: str(item.text) };
    case 'text': return { ...base, type: 'text', text: str(item.text) };
    case 'ink': return points.length ? withBounds({ ...base, type: 'ink', points: points.slice(0, BOARD_MAX_INK_POINTS) }) : null;
    case 'arrow': {
      if (points.length < 2) return null;
      const binding = (value: unknown): BoardArrowBinding | undefined => isRecord(value) && typeof value.elementId === 'string'
        ? { elementId: value.elementId, fx: num(value.fx, 0.5), fy: num(value.fy, 0.5) } : undefined;
      const head = item.head === 'none' || item.head === 'both' ? item.head : 'end';
      const from = binding(item.from); const to = binding(item.to);
      return withBounds({ ...base, type: 'arrow', points: [points[0], points[1]], head, ...(item.dash === 'dashed' ? { dash: 'dashed' as const } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    }
    default: return null;
  }
}

/** Points-based elements derive their box from the points; other elements own their box. */
export function withBounds<T extends BoardElement>(element: T): T {
  if (element.type !== 'ink' && element.type !== 'arrow') return element;
  const xs = element.points.map((point) => point.x); const ys = element.points.map((point) => point.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { ...element, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function elementBounds(element: BoardElement): BoardRect {
  const pad = element.type === 'arrow' || element.type === 'ink' ? element.strokeWidth / 2 + 2 : 0;
  return { x: element.x - pad, y: element.y - pad, w: element.w + pad * 2, h: element.h + pad * 2 };
}

export function unionBounds(rects: BoardRect[]): BoardRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x)); const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w)); const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function normalizeRect(a: BoardPoint, b: BoardPoint): BoardRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: BoardRect, b: BoardRect) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function rectContains(outer: BoardRect, inner: BoardRect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function pointInRect(point: BoardPoint, rect: BoardRect, slop = 0) {
  return point.x >= rect.x - slop && point.x <= rect.x + rect.w + slop && point.y >= rect.y - slop && point.y <= rect.y + rect.h + slop;
}

export function distanceToSegment(point: BoardPoint, a: BoardPoint, b: BoardPoint) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  const px = a.x + t * dx - point.x; const py = a.y + t * dy - point.y;
  return Math.hypot(px, py);
}

/** Precise hit test in world units; `slop` is the pointer tolerance already divided by zoom. */
export function elementHit(element: BoardElement, point: BoardPoint, slop = 4): boolean {
  switch (element.type) {
    case 'rect': case 'note': case 'text':
      return pointInRect(point, element, slop);
    case 'ellipse': {
      const rx = element.w / 2 + slop; const ry = element.h / 2 + slop;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (point.x - (element.x + element.w / 2)) / rx; const ny = (point.y - (element.y + element.h / 2)) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case 'arrow':
      return distanceToSegment(point, element.points[0], element.points[1]) <= slop + element.strokeWidth / 2;
    case 'ink': {
      if (!pointInRect(point, element, slop + element.strokeWidth)) return false;
      const tolerance = slop + element.strokeWidth / 2;
      if (element.points.length === 1) return Math.hypot(point.x - element.points[0].x, point.y - element.points[0].y) <= tolerance;
      for (let index = 1; index < element.points.length; index += 1) {
        if (distanceToSegment(point, element.points[index - 1], element.points[index]) <= tolerance) return true;
      }
      return false;
    }
    default: return false;
  }
}

/** Topmost element under the pointer (last in z-order wins). */
export function hitTest(elements: readonly BoardElement[], point: BoardPoint, slop = 4): BoardElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (elementHit(elements[index], point, slop)) return elements[index];
  }
  return null;
}

export function elementsInRect(elements: readonly BoardElement[], rect: BoardRect): string[] {
  return elements.filter((element) => rectsIntersect(rect, elementBounds(element))).map((element) => element.id);
}

export function translateElement<T extends BoardElement>(element: T, dx: number, dy: number): T {
  if (!dx && !dy) return element;
  if (element.type === 'ink' || element.type === 'arrow') {
    const points = element.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    return withBounds({ ...element, points } as T);
  }
  return { ...element, x: element.x + dx, y: element.y + dy };
}

/** Map every coordinate of the element from one box into another (used by resize handles). */
export function transformElement<T extends BoardElement>(element: T, from: BoardRect, to: BoardRect): T {
  const sx = from.w ? to.w / from.w : 1; const sy = from.h ? to.h / from.h : 1;
  const mapX = (x: number) => to.x + (x - from.x) * sx; const mapY = (y: number) => to.y + (y - from.y) * sy;
  if (element.type === 'ink' || element.type === 'arrow') {
    const points = element.points.map((point) => ({ x: mapX(point.x), y: mapY(point.y) }));
    return withBounds({ ...element, points } as T);
  }
  const x1 = mapX(element.x); const x2 = mapX(element.x + element.w); const y1 = mapY(element.y); const y2 = mapY(element.y + element.h);
  return { ...element, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

const bindable = (element: BoardElement) => element.type === 'rect' || element.type === 'ellipse' || element.type === 'note' || element.type === 'text';

/** Binding anchor for an arrow endpoint dropped on a shape. */
export function bindingFor(elements: readonly BoardElement[], point: BoardPoint, excludeId?: string): BoardArrowBinding | undefined {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.id === excludeId || !bindable(element) || !element.w || !element.h) continue;
    if (elementHit(element, point, 0)) {
      return { elementId: element.id, fx: (point.x - element.x) / element.w, fy: (point.y - element.y) / element.h };
    }
  }
  return undefined;
}

/** Re-anchor bound arrow endpoints after their target moved; drops bindings to missing elements. */
export function applyArrowBindings(elements: readonly BoardElement[]): BoardElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return elements.map((element) => {
    if (element.type !== 'arrow' || (!element.from && !element.to)) return element;
    const resolve = (binding: BoardArrowBinding | undefined, current: BoardPoint) => {
      if (!binding) return { point: current, binding };
      const target = byId.get(binding.elementId);
      if (!target) return { point: current, binding: undefined };
      return { point: { x: target.x + binding.fx * target.w, y: target.y + binding.fy * target.h }, binding };
    };
    const from = resolve(element.from, element.points[0]); const to = resolve(element.to, element.points[1]);
    const next: BoardArrowElement = { ...element, points: [from.point, to.point] };
    if (from.binding) next.from = from.binding; else delete next.from;
    if (to.binding) next.to = to.binding; else delete next.to;
    return withBounds(next);
  });
}

export function updateElements(elements: readonly BoardElement[], ids: ReadonlySet<string>, update: (element: BoardElement) => BoardElement) {
  return elements.map((element) => (ids.has(element.id) ? update(element) : element));
}

export function deleteElements(elements: readonly BoardElement[], ids: ReadonlySet<string>) {
  return applyArrowBindings(elements.filter((element) => !ids.has(element.id)));
}

export function duplicateElements(elements: readonly BoardElement[], ids: ReadonlySet<string>, offset = 24): { elements: BoardElement[]; ids: string[] } {
  const idMap = new Map<string, string>();
  const copies = elements.filter((element) => ids.has(element.id)).map((element) => {
    const id = createElementId(); idMap.set(element.id, id);
    return translateElement({ ...element, id }, offset, offset);
  }).map((element) => {
    if (element.type !== 'arrow') return element;
    const rebind = (binding?: BoardArrowBinding) => binding && idMap.has(binding.elementId) ? { ...binding, elementId: idMap.get(binding.elementId)! } : undefined;
    const next: BoardArrowElement = { ...element };
    const from = rebind(element.from); const to = rebind(element.to);
    if (from) next.from = from; else delete next.from;
    if (to) next.to = to; else delete next.to;
    return next;
  });
  return { elements: [...elements, ...copies], ids: copies.map((element) => element.id) };
}

export function bringToFront(elements: readonly BoardElement[], ids: ReadonlySet<string>) {
  return [...elements.filter((element) => !ids.has(element.id)), ...elements.filter((element) => ids.has(element.id))];
}

export function sendToBack(elements: readonly BoardElement[], ids: ReadonlySet<string>) {
  return [...elements.filter((element) => ids.has(element.id)), ...elements.filter((element) => !ids.has(element.id))];
}

/** Ink capture keeps at most one point per `minDistance` world units. */
export function appendInkPoint(points: BoardPoint[], point: BoardPoint, minDistance: number) {
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDistance) return points;
  if (points.length >= BOARD_MAX_INK_POINTS) return points;
  return [...points, point];
}

// ---------------------------------------------------------------------------
// History: snapshots of the element array. Coalescing keys let a text edit or
// nudge sequence collapse into one undo step.

export interface BoardHistory {
  past: BoardElement[][];
  future: BoardElement[][];
  lastKey: string | null;
}

export const BOARD_HISTORY_LIMIT = 200;

export function createHistory(): BoardHistory { return { past: [], future: [], lastKey: null }; }

export function recordHistory(history: BoardHistory, previous: BoardElement[], key: string | null = null): BoardHistory {
  if (key && key === history.lastKey && history.past.length) return { ...history, future: [] };
  const past = [...history.past, previous];
  if (past.length > BOARD_HISTORY_LIMIT) past.shift();
  return { past, future: [], lastKey: key };
}

export function undoHistory(history: BoardHistory, current: BoardElement[]): { history: BoardHistory; elements: BoardElement[] } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future], lastKey: null }, elements: previous };
}

export function redoHistory(history: BoardHistory, current: BoardElement[]): { history: BoardHistory; elements: BoardElement[] } | null {
  const next = history.future[0];
  if (!next) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1), lastKey: null }, elements: next };
}

// ---------------------------------------------------------------------------
// Links between a board and papers.

export function linkBoardToPaper(document: BoardDocument, paper: { paperId: string; title: string }, now = new Date().toISOString()): BoardDocument {
  if (document.links.some((link) => link.kind === 'paper' && link.paperId === paper.paperId)) return document;
  return { ...document, updatedAt: now, links: [...document.links, { kind: 'paper', paperId: paper.paperId, title: paper.title, linkedAt: now }] };
}

export function unlinkBoardFromPaper(document: BoardDocument, paperId: string, now = new Date().toISOString()): BoardDocument {
  if (!document.links.some((link) => link.kind === 'paper' && link.paperId === paperId)) return document;
  return { ...document, updatedAt: now, links: document.links.filter((link) => !(link.kind === 'paper' && link.paperId === paperId)) };
}

export function boardLinkedToPaper(document: BoardDocument, paperId: string) {
  return document.links.some((link) => link.kind === 'paper' && link.paperId === paperId);
}

/** Replace elements and bump `updatedAt` without touching identity or links. */
export function withElements(document: BoardDocument, elements: BoardElement[], now = new Date().toISOString()): BoardDocument {
  return { ...document, updatedAt: now, elements };
}

export function isBoardPath(path: string) {
  return /\.a4board$/i.test(path);
}

export function boardDisplayName(name: string) {
  return name.replace(/\.a4board$/i, '') || '未命名白板';
}

// ---------------------------------------------------------------------------
// Viewport math shared by the editor and its tests.

export interface BoardViewport { x: number; y: number; zoom: number }
export const BOARD_MIN_ZOOM = 0.1;
export const BOARD_MAX_ZOOM = 8;

export function clampZoom(zoom: number) { return Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom)); }

export function screenToWorld(viewport: BoardViewport, point: BoardPoint): BoardPoint {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function worldToScreen(viewport: BoardViewport, point: BoardPoint): BoardPoint {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

/** Zoom around a screen anchor so the world point under the pointer stays put. */
export function zoomViewport(viewport: BoardViewport, nextZoom: number, anchor: BoardPoint): BoardViewport {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(viewport, anchor);
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

export function fitViewport(bounds: BoardRect | null, size: { width: number; height: number }, padding = 48): BoardViewport {
  if (!bounds || !size.width || !size.height) return { x: size.width / 2, y: size.height / 2, zoom: 1 };
  const zoom = clampZoom(Math.min(
    (size.width - padding * 2) / Math.max(bounds.w, 1),
    (size.height - padding * 2) / Math.max(bounds.h, 1),
    2,
  ));
  return {
    zoom,
    x: (size.width - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (size.height - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}
