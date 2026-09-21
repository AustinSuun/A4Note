import type { PositionJson } from '../../../core/types';
import { numberValue } from './pdfGeometry';

type InkPoint = { x: number; y: number };
type EraserShape = 'round' | 'square';

/** Remove every touched point or edge, splitting runs so erased sides never reconnect. */
export function eraseInkPosition(positionJson: PositionJson, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape): PositionJson | null {
  const rawPoints = positionJson.points;
  if (!Array.isArray(rawPoints)) return positionJson;
  const rx = Math.max(Math.abs(radiusX), 0.01);
  const ry = Math.max(Math.abs(radiusY), 0.01);
  const next: Array<InkPoint | null> = [];
  let previous: InkPoint | null = null;
  let changed = false;
  const separate = () => { if (next.length && next[next.length - 1] !== null) next.push(null); };
  for (const raw of rawPoints) {
    const point = inkPointFromJson(raw);
    if (!point) { separate(); previous = null; continue; }
    const pointHit = pointInsideEraser(point, pointer, rx, ry, eraserShape);
    const edgeHit = previous && !pointInsideEraser(previous, pointer, rx, ry, eraserShape)
      ? segmentTouchesEraser(previous, point, pointer, rx, ry, eraserShape) : false;
    if (pointHit) { changed = true; separate(); }
    else { if (edgeHit) { changed = true; separate(); } next.push(point); }
    previous = point;
  }
  if (!changed) return positionJson;
  const runs: InkPoint[][] = [];
  let run: InkPoint[] = [];
  for (const point of next) {
    if (point) run.push(point);
    else { if (run.length >= 2) runs.push(run); run = []; }
  }
  if (run.length >= 2) runs.push(run);
  if (!runs.length) return null;
  const remaining = runs.flat();
  const xs = remaining.map(point => point.x);
  const ys = remaining.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { ...positionJson, x, y, width: Math.max(Math.max(...xs) - x, 0.1), height: Math.max(Math.max(...ys) - y, 0.1),
    points: runs.flatMap((points, index) => index ? [null, ...points] : points) };
}

export function inkPointFromJson(point: unknown): InkPoint | null {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  const value = point as Record<string, unknown>;
  const x = numberValue(value.x, Number.NaN);
  const y = numberValue(value.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function pointInsideEraser(point: InkPoint, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape) {
  const nx = (point.x - pointer.x) / Math.max(radiusX, 0.01);
  const ny = (point.y - pointer.y) / Math.max(radiusY, 0.01);
  return eraserShape === 'square' ? Math.abs(nx) <= 1 && Math.abs(ny) <= 1 : nx * nx + ny * ny <= 1;
}

export function segmentTouchesEraser(start: InkPoint, end: InkPoint, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape) {
  const ax = (start.x - pointer.x) / Math.max(radiusX, 0.01);
  const ay = (start.y - pointer.y) / Math.max(radiusY, 0.01);
  const bx = (end.x - pointer.x) / Math.max(radiusX, 0.01);
  const by = (end.y - pointer.y) / Math.max(radiusY, 0.01);
  if (eraserShape === 'square') return segmentIntersectsUnitSquare(ax, ay, bx, by);
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
  const x = ax + dx * t, y = ay + dy * t;
  return x * x + y * y <= 1;
}

function segmentIntersectsUnitSquare(ax: number, ay: number, bx: number, by: number) {
  let near = 0, far = 1;
  for (const [origin, delta] of [[ax, bx - ax], [ay, by - ay]]) {
    if (Math.abs(delta) < 1e-9) { if (origin < -1 || origin > 1) return false; continue; }
    const first = (-1 - origin) / delta, second = (1 - origin) / delta;
    near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}
