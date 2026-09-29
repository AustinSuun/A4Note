/**
 * Coordinate helpers for UI rendered under a root CSS `zoom`.
 *
 * `App` applies the interface scale with `document.documentElement.style.zoom`
 * (and mirrors it into `--ui-zoom`). Under standardized CSS zoom (Chromium ≥ 128,
 * which is what WebView2 ships) two coordinate spaces coexist:
 *
 *  - **viewport space** — `MouseEvent.clientX/Y`, `window.innerWidth/Height`
 *    and every `getBoundingClientRect()` result. These are real viewport CSS px.
 *  - **layout space** — the CSS `left/top/width/height` of any element below the
 *    zoomed root, *including `position: fixed` elements*. These are pre-zoom px:
 *    `layout = viewport / zoom`.
 *
 * Writing a `clientX` straight into a fixed popover's `left` therefore lands it at
 * `clientX * zoom` on screen, i.e. the error grows with the coordinate. Every
 * popover, drag preview or pointer-to-element conversion must go through the
 * helpers below instead of doing its own arithmetic.
 */

export interface LayoutPoint { x: number; y: number }
export interface LayoutSize { width: number; height: number }
export interface ViewportPointLike { clientX: number; clientY: number }

export interface PopoverPlacementOptions {
  /** Minimum distance from the layout viewport edges. Default 8. */
  margin?: number;
  /** Offset applied between the anchor point and the popover's top-left corner. Default 0/0. */
  offset?: Partial<LayoutPoint>;
  /**
   * When the popover does not fit to the right / below the anchor, mirror it to
   * the left / above instead of only clamping. Default true.
   */
  flip?: boolean;
  /** Explicit bounds in layout px; defaults to the layout-space window viewport. */
  viewport?: LayoutSize;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  flippedX: boolean;
  flippedY: boolean;
}

interface RootZoomSource {
  root: HTMLElement | null;
  view: (Window & typeof globalThis) | null;
}

function defaultSource(): RootZoomSource {
  if (typeof document === 'undefined') return { root: null, view: null };
  return { root: document.documentElement, view: document.defaultView ?? (typeof window === 'undefined' ? null : window) };
}

function sanitizeZoom(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0.05 && value < 20 ? value : null;
}

/** Parse the computed `zoom` (`"1.18"`, `"118%"` or `"normal"`) into a factor. */
export function parseZoomValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || text === 'normal' || text === 'none') return null;
  if (text.endsWith('%')) return sanitizeZoom(Number.parseFloat(text) / 100);
  return sanitizeZoom(Number.parseFloat(text));
}

/**
 * Effective root zoom factor (`viewport px / layout px`).
 *
 * Measured first (`getBoundingClientRect().width / offsetWidth` of the root),
 * which is implementation-agnostic: it reports 1 whenever the engine keeps both
 * spaces aligned (legacy zoom) and the real factor under standardized zoom. The
 * computed `zoom` and `--ui-zoom` are only fallbacks for detached/hidden roots.
 */
export function readRootZoom(root?: HTMLElement | null): number {
  const source = defaultSource();
  const element = root ?? source.root;
  if (!element) return 1;
  const measured = sanitizeZoom(element.offsetWidth > 0 ? element.getBoundingClientRect().width / element.offsetWidth : null);
  if (measured !== null) return Math.round(measured * 10000) / 10000;
  const view = element.ownerDocument?.defaultView ?? source.view;
  const computed = view ? parseZoomValue(view.getComputedStyle(element).zoom) : null;
  if (computed !== null) return computed;
  const variable = view ? parseZoomValue(view.getComputedStyle(element).getPropertyValue('--ui-zoom')) : null;
  return variable ?? 1;
}

/** Convert a viewport-space length (px) into layout px. */
export function viewportLengthToLayout(length: number, zoom: number = readRootZoom()): number {
  return zoom > 0 ? length / zoom : length;
}

/** Convert a viewport point (`clientX/Y`) into layout px, e.g. for a fixed popover's `left/top`. */
export function viewportPointToLayout(point: ViewportPointLike, zoom: number = readRootZoom()): LayoutPoint {
  return { x: viewportLengthToLayout(point.clientX, zoom), y: viewportLengthToLayout(point.clientY, zoom) };
}

/** Convert a movement delta measured from `clientX/Y` into layout px (sidebar/column resizing). */
export function viewportDeltaToLayout(dx: number, dy: number, zoom: number = readRootZoom()): LayoutPoint {
  return { x: viewportLengthToLayout(dx, zoom), y: viewportLengthToLayout(dy, zoom) };
}

/** Layout-space size of the window viewport (what fixed elements can occupy). */
export function layoutViewportSize(zoom: number = readRootZoom(), view: Pick<Window, 'innerWidth' | 'innerHeight'> | null = typeof window === 'undefined' ? null : window): LayoutSize {
  if (!view) return { width: 0, height: 0 };
  return { width: viewportLengthToLayout(view.innerWidth, zoom), height: viewportLengthToLayout(view.innerHeight, zoom) };
}

/** Convert a viewport `DOMRect` into layout px. */
export function rectToLayout(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, zoom: number = readRootZoom()) {
  return {
    left: viewportLengthToLayout(rect.left, zoom),
    top: viewportLengthToLayout(rect.top, zoom),
    width: viewportLengthToLayout(rect.width, zoom),
    height: viewportLengthToLayout(rect.height, zoom),
  };
}

/**
 * Pointer position relative to an element's top-left corner, in that element's
 * layout px (what its children's CSS `left/top` or an SVG viewBox expect).
 */
export function pointerToElementLayout(point: ViewportPointLike, element: Element | null | undefined, zoom: number = readRootZoom()): LayoutPoint {
  const rect = element?.getBoundingClientRect();
  if (!rect) return viewportPointToLayout(point, zoom);
  return viewportDeltaToLayout(point.clientX - rect.left, point.clientY - rect.top, zoom);
}

/** Layout size of a rendered element (`offsetWidth/Height` are already layout px). */
export function measureLayoutSize(element: HTMLElement | null | undefined): LayoutSize | null {
  if (!element) return null;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * Place a popover of `size` next to `anchor` (both layout px) inside `viewport`.
 * The popover's top-left corner aligns with the anchor (+offset). When it would
 * overflow the right/bottom edge it flips to the other side of the anchor if that
 * side has room, otherwise it is clamped so it stays fully visible.
 */
export function clampPopoverPosition(anchor: LayoutPoint, size: LayoutSize, viewport: LayoutSize, options: PopoverPlacementOptions = {}): PopoverPlacement {
  const margin = options.margin ?? 8;
  const flip = options.flip ?? true;
  const offsetX = options.offset?.x ?? 0;
  const offsetY = options.offset?.y ?? 0;
  const placeAxis = (position: number, offset: number, extent: number, limit: number) => {
    const maxStart = limit - margin - extent;
    let start = position + offset;
    let flipped = false;
    if (start + extent > limit - margin) {
      const mirrored = position - offset - extent;
      if (flip && mirrored >= margin) { start = mirrored; flipped = true; }
      else start = Math.max(margin, maxStart);
    }
    if (start < margin) start = margin;
    return { start, flipped };
  };
  const horizontal = placeAxis(anchor.x, offsetX, size.width, viewport.width);
  const vertical = placeAxis(anchor.y, offsetY, size.height, viewport.height);
  return { left: horizontal.start, top: vertical.start, flippedX: horizontal.flipped, flippedY: vertical.flipped };
}

/**
 * One-stop helper: pointer event → layout placement for a fixed popover of `size`.
 * Reads the current root zoom and window size; pass `size` measured via
 * `measureLayoutSize` (or `{0,0}` before the first measurement).
 */
export function placePopoverAtPointer(point: ViewportPointLike, size: LayoutSize, options: PopoverPlacementOptions = {}, zoom: number = readRootZoom()): PopoverPlacement {
  return clampPopoverPosition(viewportPointToLayout(point, zoom), size, options.viewport ?? layoutViewportSize(zoom), options);
}
