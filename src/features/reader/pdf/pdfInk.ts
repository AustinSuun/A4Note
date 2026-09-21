import type { PositionJson } from '../../../core/types';
import { numberValue } from './pdfGeometry';

type InkPoint = { x: number; y: number };
type EraserShape = 'round' | 'square';

/**
 * Remove only the part of the stroke the eraser actually covers.
 *
 * Ink is stored as a sparse polyline (the pen drops a sample only every ~0.16% of the page), so a
 * single edge can span a long visual run. Dropping a whole edge because the eraser grazed it made
 * the eraser wipe out glyphs it never touched. Instead every edge is clipped against the eraser at
 * the exact entry/exit parameter and the boundary points are re-inserted, so the surviving ends stay
 * put and the erased gap matches the cursor.
 */
export function eraseInkPosition(positionJson: PositionJson, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape): PositionJson | null {
  const rawPoints = positionJson.points;
  if (!Array.isArray(rawPoints)) return positionJson;
  const rx = Math.max(Math.abs(radiusX), 0.01);
  const ry = Math.max(Math.abs(radiusY), 0.01);

  const inputRuns: InkPoint[][] = [];
  let pending: InkPoint[] = [];
  for (const raw of rawPoints) {
    const point = inkPointFromJson(raw);
    if (!point) { if (pending.length) inputRuns.push(pending); pending = []; continue; }
    pending.push(point);
  }
  if (pending.length) inputRuns.push(pending);

  let changed = false;
  const runs: InkPoint[][] = [];
  for (const run of inputRuns) {
    if (run.length === 1) {
      if (pointInsideEraser(run[0], pointer, rx, ry, eraserShape)) changed = true;
      else runs.push(run);
      continue;
    }
    let active: InkPoint[] = [];
    const flush = () => { if (active.length >= 2) runs.push(active); active = []; };
    let previousInside = pointInsideEraser(run[0], pointer, rx, ry, eraserShape);
    if (previousInside) changed = true;
    else active.push(run[0]);
    for (let index = 1; index < run.length; index += 1) {
      const start = run[index - 1];
      const end = run[index];
      const endInside = pointInsideEraser(end, pointer, rx, ry, eraserShape);
      const span = eraserSpanOnSegment(start, end, pointer, rx, ry, eraserShape);
      if (!span) {
        active.push(end);
      } else {
        changed = true;
        const [enter, exit] = span;
        if (!previousInside && enter > 0) active.push(interpolate(start, end, enter));
        flush();
        if (!endInside) {
          if (exit < 1) active.push(interpolate(start, end, exit));
          active.push(end);
        }
      }
      previousInside = endInside;
    }
    flush();
  }

  if (!changed) return positionJson;
  if (!runs.length) return null;
  const remaining = runs.flat();
  const xs = remaining.map((point) => point.x);
  const ys = remaining.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { ...positionJson, x, y, width: Math.max(Math.max(...xs) - x, 0.1), height: Math.max(Math.max(...ys) - y, 0.1),
    points: runs.flatMap((points, index) => index ? [null, ...points] : points) };
}

function interpolate(start: InkPoint, end: InkPoint, t: number): InkPoint {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
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

/** Parameter range [enter, exit] of the segment that lies inside the eraser, or null when it misses. */
export function eraserSpanOnSegment(start: InkPoint, end: InkPoint, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape): [number, number] | null {
  const rx = Math.max(radiusX, 0.01);
  const ry = Math.max(radiusY, 0.01);
  const ax = (start.x - pointer.x) / rx;
  const ay = (start.y - pointer.y) / ry;
  const bx = (end.x - pointer.x) / rx;
  const by = (end.y - pointer.y) / ry;
  const span = eraserShape === 'square'
    ? unitSquareSpan(ax, ay, bx, by)
    : unitCircleSpan(ax, ay, bx, by);
  if (!span) return null;
  const enter = Math.max(0, Math.min(1, span[0]));
  const exit = Math.max(0, Math.min(1, span[1]));
  return exit > enter || (exit === enter && enter > 0 && enter < 1) ? [enter, exit] : (span[0] <= 0 && span[1] >= 0 ? [0, exit] : null);
}

function unitCircleSpan(ax: number, ay: number, bx: number, by: number): [number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return ax * ax + ay * ay <= 1 ? [0, 1] : null;
  const b = ax * dx + ay * dy;
  const c = ax * ax + ay * ay - 1;
  const discriminant = b * b - lengthSquared * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / lengthSquared;
  const second = (-b + root) / lengthSquared;
  if (second < 0 || first > 1) return null;
  return [first, second];
}

function unitSquareSpan(ax: number, ay: number, bx: number, by: number): [number, number] | null {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const [origin, delta] of [[ax, bx - ax], [ay, by - ay]]) {
    if (Math.abs(delta) < 1e-9) { if (origin < -1 || origin > 1) return null; continue; }
    const first = (-1 - origin) / delta;
    const second = (1 - origin) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  if (far < 0 || near > 1) return null;
  return [near === Number.NEGATIVE_INFINITY ? 0 : near, far === Number.POSITIVE_INFINITY ? 1 : far];
}

/** Kept for callers that only need a boolean hit test. */
export function segmentTouchesEraser(start: InkPoint, end: InkPoint, pointer: InkPoint, radiusX: number, radiusY: number, eraserShape: EraserShape) {
  return eraserSpanOnSegment(start, end, pointer, radiusX, radiusY, eraserShape) !== null;
}
