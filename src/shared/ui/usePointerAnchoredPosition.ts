import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { clampPopoverPosition, layoutViewportSize, measureLayoutSize, readRootZoom, viewportPointToLayout, type LayoutSize, type PopoverPlacement, type PopoverPlacementOptions, type ViewportPointLike } from './viewportToLayout';

export interface PointerAnchoredPosition {
  /** Attach to the fixed popover element so its real size can be measured. */
  ref: (element: HTMLElement | null) => void;
  /** `left/top` in layout px, already clamped/flipped inside the viewport. */
  style: CSSProperties;
  placement: PopoverPlacement | null;
  /** Layout size measured from the element; `null` until the first layout pass. */
  size: LayoutSize | null;
}

const NO_PLACEMENT_STYLE: CSSProperties = { left: 0, top: 0 };
const EMPTY_SIZE: LayoutSize = { width: 0, height: 0 };

/**
 * Position a `position: fixed` popover at a pointer anchor (`clientX/Y`) under
 * the root zoom. The popover is measured with `useLayoutEffect` (before paint,
 * so there is no visible jump) and re-measured through a `ResizeObserver`
 * whenever its content changes; the placement is recomputed on window resize.
 */
export function usePointerAnchoredPosition(anchor: ViewportPointLike | null, options: PopoverPlacementOptions = {}): PointerAnchoredPosition {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<LayoutSize | null>(null);
  const [viewport, setViewport] = useState<LayoutSize>(EMPTY_SIZE);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const active = Boolean(anchor);

  const ref = useCallback((node: HTMLElement | null) => { setElement(node); }, []);

  useLayoutEffect(() => {
    if (!element || !active) { setSize(null); return undefined; }
    const update = () => {
      const next = measureLayoutSize(element);
      setSize((current) => (current && next && current.width === next.width && current.height === next.height ? current : next));
      const nextViewport = layoutViewportSize();
      setViewport((current) => (current.width === nextViewport.width && current.height === nextViewport.height ? current : nextViewport));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [element, active]);

  const placement = useMemo(() => {
    if (!anchor) return null;
    const zoom = readRootZoom();
    const bounds = viewport.width > 0 && viewport.height > 0 ? viewport : layoutViewportSize(zoom);
    return clampPopoverPosition(viewportPointToLayout(anchor, zoom), size ?? EMPTY_SIZE, bounds, optionsRef.current);
  }, [anchor, size, viewport]);

  const style = useMemo<CSSProperties>(() => (placement ? { left: placement.left, top: placement.top } : NO_PLACEMENT_STYLE), [placement]);

  return { ref, style, placement, size };
}
