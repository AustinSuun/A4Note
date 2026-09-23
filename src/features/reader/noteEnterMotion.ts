import type { FloatingCardRect } from './noteWorkbench';

/* Motion helpers for the note workbench (tasks 1f484418 / 3932f561). The motion itself is
   CSS (reader-writing-layout.css + motion tokens); this module only derives the values the
   scene has to compute from state. Pure and DOM-free so it can be unit tested. */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Origin used when no floating geometry is known: the card grows out of its right edge,
 *  where the boundary bookmark lives. */
export const NOTE_POP_ORIGIN_DEFAULT = '100% 50%';

/** Transform origin for the floating card's pop, as a CSS `transform-origin` value.
 *  The bookmark handle sits on the workspace's right edge at mid height; expressing that
 *  point in the card's own percentage space makes scale() grow the card out of the handle
 *  and shrink it back into it, wherever the card was dragged to. */
export function floatingPopOrigin(rect: FloatingCardRect): string {
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  const x = ((1 - rect.x) / width) * 100;
  const y = ((0.5 - rect.y) / height) * 100;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NOTE_POP_ORIGIN_DEFAULT;
  return `${clamp(x, -40, 140).toFixed(2)}% ${clamp(y, -40, 140).toFixed(2)}%`;
}

export type FlipBox = { left: number; top: number; width: number; height: number };

/** FLIP transform that paints an element laid out at `last` back over `first`, so a mode
 *  switch (docked column ⇄ floating card ⇄ writing sheet) travels between the two boxes
 *  instead of disappearing and re-entering. Uniform scale keeps text undistorted; apply
 *  with `transform-origin: 0 0`. Returns null when the boxes already match. */
export function flipTransform(first: FlipBox, last: FlipBox): string | null {
  if (!(first.width > 0 && first.height > 0 && last.width > 0 && last.height > 0)) return null;
  const scale = first.width / last.width;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return null;
  return `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
}

export type FloatingCorner = 'nw' | 'ne' | 'sw' | 'se';
export const FLOATING_CORNERS: readonly FloatingCorner[] = ['nw', 'ne', 'sw', 'se'];
/** Smallest card edge, as a ratio of the workspace (matches the former single-corner resize). */
export const FLOATING_MIN_SIZE = 0.24;

/** Resize the card from one corner while the opposite corner stays put. `dx`/`dy` are
 *  pointer deltas in workspace ratios; the result never leaves the workspace. */
export function resizeFloatingRect(origin: FloatingCardRect, corner: FloatingCorner, dx: number, dy: number): FloatingCardRect {
  let { x, y, width, height } = origin;
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  if (corner === 'ne' || corner === 'se') width = clamp(origin.width + dx, FLOATING_MIN_SIZE, 1 - origin.x);
  if (corner === 'nw' || corner === 'sw') { x = clamp(origin.x + dx, 0, right - FLOATING_MIN_SIZE); width = right - x; }
  if (corner === 'sw' || corner === 'se') height = clamp(origin.height + dy, FLOATING_MIN_SIZE, 1 - origin.y);
  if (corner === 'nw' || corner === 'ne') { y = clamp(origin.y + dy, 0, bottom - FLOATING_MIN_SIZE); height = bottom - y; }
  return { x, y, width, height };
}

/** Move the card by a workspace-ratio delta, keeping it fully inside the workspace. */
export function moveFloatingRect(origin: FloatingCardRect, dx: number, dy: number): FloatingCardRect {
  return {
    ...origin,
    x: clamp(origin.x + dx, 0, Math.max(0, 1 - origin.width)),
    y: clamp(origin.y + dy, 0, Math.max(0, 1 - origin.height)),
  };
}
