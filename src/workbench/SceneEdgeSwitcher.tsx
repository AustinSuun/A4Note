import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatBinding } from '../core/shortcuts';
import { useShortcuts } from '../shared/shortcuts';
import { hintKeycaps } from '../shared/shortcuts/hintKeycaps';
import { modalIsOpen } from '../shared/shortcuts/dispatcher';
import { readRootZoom, viewportLengthToLayout } from '../shared/ui/viewportToLayout';
import type { SidebarSceneItem } from './ProjectSidebar';
import { groupSidebarScenes } from './sceneGroups';
import {
  SCENE_EDGE_HOT_ZONE_PX,
  SCENE_EDGE_PANEL_OFFSET_PX,
  SCENE_EDGE_YIELD_SELECTOR,
  initialSceneEdgeState,
  isSceneEdgeOpen,
  placeSceneEdgePanel,
  reduceSceneEdge,
  sceneEdgeMotion,
  type SceneEdgeEffect,
  type SceneEdgeEvent,
  type SceneEdgeInput,
  type SceneEdgeState,
  type SceneEdgeTimer,
  type SceneEdgeZone,
  type SceneRect,
} from './sceneEdgeSwitcherModel';
import './scene-edge-switcher.css';

export interface SceneEdgeSwitcherLabels {
  handle: string;
  panel: string;
  current: string;
}

export const SCENE_EDGE_SWITCHER_DEFAULT_LABELS: SceneEdgeSwitcherLabels = {
  handle: '快速切换场景',
  panel: '切换场景',
  current: '当前场景',
};

export interface SceneEdgeSwitcherProps {
  /** The same visible scene list the sidebar renders; no second data source. */
  scenes: SidebarSceneItem[];
  activeSceneId: string | null;
  onOpenScene: (sceneId: string) => void;
  labels?: Partial<SceneEdgeSwitcherLabels>;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Left-edge quick scene switcher. Hovering the window's left edge (or its thin
 * handle) for a short dwell slides a floating scene menu out over the sidebar;
 * picking a scene calls the host's `onOpenScene`. See
 * `sceneEdgeSwitcherModel.ts` for the timing rules and
 * `docs/mcp-scene-edge-switcher-arena-b-2026-09-29.md` for the yield rules.
 */
export function SceneEdgeSwitcher({ scenes, activeSceneId, onOpenScene, labels: labelOverrides }: SceneEdgeSwitcherProps) {
  const labels = { ...SCENE_EDGE_SWITCHER_DEFAULT_LABELS, ...labelOverrides };
  const shortcuts = useShortcuts();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneEdgeState>(initialSceneEdgeState(true));
  const [state, setState] = useState<SceneEdgeState>(stateRef.current);
  const timersRef = useRef<Record<SceneEdgeTimer, number | null>>({ open: null, close: null });
  const suppressUntilRef = useRef(0);
  const pressInputRef = useRef<SceneEdgeInput | null>(null);
  const [placement, setPlacement] = useState<{ top: number; maxHeight: number } | null>(null);
  // Keeps the compositor layer (will-change) alive through the exit transition only.
  const [layerHeld, setLayerHeld] = useState(false);
  const open = isSceneEdgeOpen(state);
  const groups = useMemo(() => groupSidebarScenes(scenes), [scenes]);
  const flatScenes = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const applyEffects = useCallback((effects: SceneEdgeEffect[]) => {
    for (const effect of effects) {
      if (effect.type === 'cancel') {
        const id = timersRef.current[effect.timer];
        if (id !== null) window.clearTimeout(id);
        timersRef.current[effect.timer] = null;
      } else if (effect.type === 'schedule') {
        const existing = timersRef.current[effect.timer];
        if (existing !== null) window.clearTimeout(existing);
        timersRef.current[effect.timer] = window.setTimeout(() => {
          timersRef.current[effect.timer] = null;
          dispatchRef.current({ type: 'timer', timer: effect.timer });
        }, effect.ms);
      } else if (effect.type === 'focusHandle') {
        handleRef.current?.focus({ preventScroll: true });
      } else if (effect.type === 'focusPanel') {
        pendingPanelFocusRef.current = true;
      }
    }
  }, []);

  const pendingPanelFocusRef = useRef(false);
  const dispatch = useCallback((event: SceneEdgeEvent) => {
    const { state: next, effects } = reduceSceneEdge(stateRef.current, event);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    if (effects.length) applyEffects(effects);
  }, [applyEffects]);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => () => {
    for (const timer of ['open', 'close'] as const) {
      const id = timersRef.current[timer];
      if (id !== null) window.clearTimeout(id);
    }
  }, []);

  /** Target rect of the open panel in viewport px, independent of the running transform. */
  const panelRect = useCallback((): SceneRect | null => {
    const panel = panelRef.current;
    if (!panel || !isSceneEdgeOpen(stateRef.current)) return null;
    const zoom = readRootZoom();
    const top = parseFloat(panel.style.top || '0');
    const left = SCENE_EDGE_PANEL_OFFSET_PX;
    return { left: left * zoom, top: top * zoom, right: (left + panel.offsetWidth) * zoom, bottom: (top + panel.offsetHeight) * zoom };
  }, []);

  const shellBounds = useCallback(() => {
    const shell = rootRef.current?.parentElement?.querySelector<HTMLElement>('.workbench-shell');
    const rect = shell?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom } : { top: 0, bottom: window.innerHeight };
  }, []);

  const classifyPoint = useCallback((x: number, y: number, target: EventTarget | null): SceneEdgeZone => {
    const current = stateRef.current;
    const handle = handleRef.current;
    if (target instanceof Node && handle?.contains(target)) return 'edge';
    if (isSceneEdgeOpen(current)) {
      const rect = panelRect();
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return 'panel';
    }
    const zoom = readRootZoom();
    if (x > SCENE_EDGE_HOT_ZONE_PX * zoom) return 'outside';
    const bounds = shellBounds();
    if (y < bounds.top || y > bounds.bottom) return 'outside';
    if (document.body.classList.contains('is-horizontal-resizing')) return 'outside';
    if (performance.now() < suppressUntilRef.current) return 'outside';
    const hit = document.elementFromPoint(x, y);
    if (hit && !rootRef.current?.contains(hit) && hit.closest(SCENE_EDGE_YIELD_SELECTOR)) return 'outside';
    if (current.phase === 'closed' && modalIsOpen(document)) return 'outside';
    return 'edge';
  }, [panelRect, shellBounds]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = stateRef.current;
      // Cheap early exit: far from the edge with nothing open never touches the DOM.
      if (current.phase === 'closed' && event.clientX > SCENE_EDGE_HOT_ZONE_PX * readRootZoom() + 1 && !handleRef.current?.contains(event.target as Node)) return;
      const zone = classifyPoint(event.clientX, event.clientY, event.target);
      dispatch({ type: 'pointer', zone, point: { x: event.clientX, y: event.clientY }, buttons: event.buttons, pointerType: event.pointerType, panel: panelRect() });
    };
    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget === null) dispatch({ type: 'pointerExitWindow' });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const inside = Boolean(target && (panelRef.current?.contains(target) || handleRef.current?.contains(target)));
      pressInputRef.current = inside ? (event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse') : null;
      // The event is never cancelled: an outside click closes the panel and still reaches its target.
      dispatch({ type: 'pointerDown', inside });
    };
    const suppress = () => {
      suppressUntilRef.current = performance.now() + 400;
      dispatch({ type: 'suppress' });
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('dragenter', suppress, { capture: true });
    window.addEventListener('dragover', suppress, { capture: true, passive: true });
    window.addEventListener('blur', suppress);
    window.addEventListener('workbench-resize-end', suppress);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('dragenter', suppress, { capture: true });
      window.removeEventListener('dragover', suppress, { capture: true });
      window.removeEventListener('blur', suppress);
      window.removeEventListener('workbench-resize-end', suppress);
    };
  }, [classifyPoint, dispatch, panelRect]);

  // Esc closes a hover-opened panel even when focus is elsewhere; it only claims the key when focus is inside.
  useEffect(() => {
    if (state.phase === 'closed') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const focusInside = Boolean(rootRef.current?.contains(document.activeElement));
      if (focusInside) {
        event.preventDefault();
        dispatch({ type: 'escape' });
      } else {
        // Close without moving focus away from an editor that may also react to Esc.
        dispatch({ type: 'suppress' });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dispatch, state.phase]);

  // Place the panel before paint whenever it opens (or the anchor changes).
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!panel) return;
    const zoom = readRootZoom();
    const bounds = shellBounds();
    const handleRect = handle?.getBoundingClientRect();
    const anchorViewport = state.anchorY ?? (handleRect ? handleRect.top + handleRect.height / 2 : (bounds.top + bounds.bottom) / 2);
    setPlacement(placeSceneEdgePanel({
      anchorY: viewportLengthToLayout(anchorViewport, zoom),
      panelHeight: panel.scrollHeight,
      boundsTop: viewportLengthToLayout(bounds.top, zoom),
      boundsBottom: viewportLengthToLayout(bounds.bottom, zoom),
    }));
  }, [open, state.anchorY, shellBounds, flatScenes.length]);

  useEffect(() => {
    if (open) {
      setLayerHeld(true);
      return undefined;
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
    const id = window.setTimeout(() => setLayerHeld(false), sceneEdgeMotion(reduced).exitMs + 40);
    return () => window.clearTimeout(id);
  }, [open]);

  // Keyboard openings move focus to the current scene (or the first one).
  useEffect(() => {
    if (!open || !pendingPanelFocusRef.current) return;
    pendingPanelFocusRef.current = false;
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('.scene-edge-item') ?? [])];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  }, [open]);

  // A disappearing panel must not strand focus inside an inert subtree. Keyboard paths
  // already moved focus to the handle; a pointer path just lets go of it.
  useEffect(() => {
    if (open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur();
  }, [open]);

  const selectScene = (sceneId: string, viaKeyboard: boolean) => {
    const active = document.activeElement;
    const focusInside = active instanceof HTMLElement && Boolean(panelRef.current?.contains(active));
    dispatch({ type: 'select' });
    if (focusInside && viaKeyboard) handleRef.current?.focus({ preventScroll: true });
    else if (focusInside) active.blur();
    if (sceneId !== activeSceneId) onOpenScene(sceneId);
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('.scene-edge-item') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      dispatch({ type: 'escape' });
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      items[next].focus({ preventScroll: true });
    }
  };

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'ArrowRight' || event.key === 'ArrowDown') && !isSceneEdgeOpen(stateRef.current)) {
      event.preventDefault();
      dispatch({ type: 'activate', input: 'keyboard' });
    }
  };

  const shortcutFor = (sceneId: string) => {
    const bindings = shortcuts.bindings(`scene.${sceneId}`);
    const binding = bindings[0];
    return {
      keycaps: binding ? hintKeycaps(binding) : [],
      text: bindings.map(formatBinding).join(' / '),
    };
  };

  const panelStyle = (placement ? { top: `${placement.top}px`, maxHeight: `${placement.maxHeight}px` } : undefined) as CSSProperties | undefined;

  return (
    <div ref={rootRef} className="scene-edge" data-phase={state.phase} data-layer={layerHeld || state.phase !== 'closed' ? 'on' : undefined}>
      <button
        ref={handleRef}
        type="button"
        className="scene-edge-handle"
        aria-label={labels.handle}
        title={labels.handle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        data-armed={state.phase !== 'closed' || undefined}
        onClick={(event) => {
          // Keyboard-generated clicks (Enter/Space) have detail 0 and no preceding pointerdown.
          const input: SceneEdgeInput = event.detail === 0 ? 'keyboard' : pressInputRef.current ?? 'mouse';
          pressInputRef.current = null;
          dispatch({ type: 'activate', input });
        }}
        onKeyDown={onHandleKeyDown}
      >
        <span className="scene-edge-handle-grip" aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="scene-edge-panel"
        role="menu"
        aria-label={labels.panel}
        aria-hidden={!open}
        inert={!open}
        data-open={open || undefined}
        style={panelStyle}
        onKeyDown={onPanelKeyDown}
      >
        {groups.map((group) => (
          <div key={group.id} className="scene-edge-group" role="group" aria-labelledby={`${panelId}-${group.id}`}>
            <div id={`${panelId}-${group.id}`} className="scene-edge-group-label" role="presentation">{group.label}</div>
            {group.items.map((scene) => {
              const active = scene.id === activeSceneId;
              const shortcut = shortcutFor(scene.id);
              const title = [scene.hint ?? scene.label, shortcut.text].filter(Boolean).join(' · ');
              return (
                <button
                  key={scene.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={-1}
                  className={active ? 'scene-edge-item active' : 'scene-edge-item'}
                  data-scene-id={scene.id}
                  title={title}
                  onClick={(event) => selectScene(scene.id, event.detail === 0)}
                >
                  <span className="scene-edge-item-icon" aria-hidden="true">{scene.icon}</span>
                  <span className="scene-edge-item-label">{scene.label}</span>
                  {active && <span className="scene-edge-item-current">{labels.current}</span>}
                  {shortcut.keycaps.length > 0 && (
                    <span className="scene-edge-item-keys" aria-hidden="true">
                      {shortcut.keycaps.map((cap) => <kbd key={cap}>{cap}</kbd>)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
