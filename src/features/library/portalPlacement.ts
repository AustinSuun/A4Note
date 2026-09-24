/** Placement maths for body-level `position: fixed` popovers (task ae98615a).
 *
 * The app scales its UI with CSS `zoom` on the root element. Under zoom,
 * `getBoundingClientRect()` and `window.innerWidth/innerHeight` report visual-viewport
 * pixels, but `left`/`top` on a fixed element are interpreted in the zoomed coordinate
 * space — a value copied straight from a rect renders at `value × zoom`, which is what
 * pushed the column-settings panel hundreds of pixels sideways at 80 % / 125 % UI scale.
 * Every rule here works in viewport pixels and converts once at the end. */

export type ViewportRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type Placement = { left: number; top: number };

const EDGE = 8;

/** Effective scale between the element's CSS pixels and the viewport (CSS zoom on any
 *  ancestor, or a scale transform). `1` when nothing scales it. */
export function viewportScale(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const layoutWidth = element.offsetWidth;
  if (!rect.width || !layoutWidth) return 1;
  const scale = rect.width / layoutWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Anchor a panel to a trigger: right-aligned, directly below it, above when the space
 *  below is short, always clamped inside the viewport (all inputs in viewport px). */
export function anchoredPlacement(trigger: ViewportRect, panel: ViewportRect, viewport: { width: number; height: number }, gap = 4): Placement {
  const left = Math.max(EDGE, Math.min(trigger.right - panel.width, viewport.width - panel.width - EDGE));
  const fitsBelow = trigger.bottom + gap + panel.height + EDGE <= viewport.height;
  const preferred = fitsBelow ? trigger.bottom + gap : trigger.top - gap - panel.height;
  const top = Math.max(EDGE, Math.min(preferred, viewport.height - panel.height - EDGE));
  return { left, top };
}

/** Place a menu at a pointer/anchor point, flipping upwards when it would overflow the
 *  bottom and clamping inside the viewport (all inputs in viewport px). */
export function pointPlacement(point: { x: number; y: number }, panel: ViewportRect, viewport: { width: number; height: number }): Placement {
  const left = Math.max(EDGE, Math.min(point.x, viewport.width - panel.width - EDGE));
  const preferred = point.y + panel.height + EDGE > viewport.height ? point.y - panel.height : point.y;
  const top = Math.max(EDGE, Math.min(preferred, viewport.height - panel.height - EDGE));
  return { left, top };
}

/** Convert a viewport-pixel placement into the CSS pixels a fixed element needs. */
export function toCssPixels(placement: Placement, scale: number): Placement {
  const factor = scale > 0 ? scale : 1;
  return { left: placement.left / factor, top: placement.top / factor };
}
