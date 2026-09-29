/**
 * Pure rules of the left-edge scene switcher: hot-zone size, open/close timing
 * state machine, the "safe triangle" towards the panel, panel placement and the
 * motion contract. `SceneEdgeSwitcher.tsx` owns DOM reads and timers; it feeds
 * events in and applies the returned effects, so every timing rule is unit
 * testable without a browser.
 *
 * Coordinates handed to the reducer are viewport px (`clientX/Y`,
 * `getBoundingClientRect()`), which keeps them consistent under the root CSS
 * zoom. Only placement returns layout px (see `shared/ui/viewportToLayout.ts`).
 */

/** Width of the invisible trigger band along the window's left edge, in layout px. */
export const SCENE_EDGE_HOT_ZONE_PX = 8;
/** Dwell needed inside the band before the panel opens; a quick pass is ignored. */
export const SCENE_EDGE_OPEN_DELAY_MS = 150;
/** Grace after the pointer leaves the panel and the band before it closes. */
export const SCENE_EDGE_CLOSE_GRACE_MS = 240;
/** Longer grace while the pointer travels inside the safe triangle towards the panel. */
export const SCENE_EDGE_SAFE_PATH_GRACE_MS = 480;
/** Horizontal gap between the window edge and the floating panel, in layout px. */
export const SCENE_EDGE_PANEL_OFFSET_PX = 12;
/** Minimum distance between the panel and the top/bottom of its bounds, in layout px. */
export const SCENE_EDGE_PANEL_MARGIN_PX = 8;
/** Elements under the pointer that the edge band yields to. */
export const SCENE_EDGE_YIELD_SELECTOR = [
  '[data-scene-edge-yield]',
  '.reader-note-edge-entry',
  '.reader-note-edge-handle',
  '.workbench-sidebar-resizer',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.file-tree-context-menu',
  '.markdown-editor-context-menu',
].join(', ');

export interface SceneEdgeMotion {
  enterMs: number;
  exitMs: number;
  /**
   * Per-item cascade step and the number of steps before it stops growing. Kept at 0:
   * the panel moves as one compositor layer, animating rows would repaint it every frame.
   */
  staggerMs: number;
  maxStaggerSteps: number;
  /** Horizontal travel of the panel on enter/exit; 0 means fade only. */
  translate: boolean;
  enterEasing: string;
  exitEasing: string;
  /** The only properties the switcher is allowed to animate. */
  properties: readonly ['transform', 'opacity'];
}

const MOTION_PROPERTIES = ['transform', 'opacity'] as const;

/** Motion contract mirrored by `scene-edge-switcher.css`. */
export function sceneEdgeMotion(reducedMotion: boolean): SceneEdgeMotion {
  return reducedMotion
    ? { enterMs: 160, exitMs: 120, staggerMs: 0, maxStaggerSteps: 0, translate: false, enterEasing: 'linear', exitEasing: 'linear', properties: MOTION_PROPERTIES }
    : { enterMs: 200, exitMs: 140, staggerMs: 0, maxStaggerSteps: 0, translate: true, enterEasing: 'var(--motion-panel-ease-out)', exitEasing: 'var(--motion-panel-ease-in)', properties: MOTION_PROPERTIES };
}

/** Longest enter sequence (panel plus cascaded items) for `itemCount` items. */
export function sceneEdgeEnterTotalMs(itemCount: number, motion: SceneEdgeMotion = sceneEdgeMotion(false)) {
  const steps = Math.max(0, Math.min(itemCount - 1, motion.maxStaggerSteps));
  return motion.enterMs + steps * motion.staggerMs;
}

export interface ScenePoint { x: number; y: number }
export interface SceneRect { left: number; top: number; right: number; bottom: number }

export type SceneEdgeZone = 'edge' | 'panel' | 'outside';
export type SceneEdgePhase = 'closed' | 'pending' | 'open' | 'leaving';
export type SceneEdgeOpenSource = 'hover' | 'press' | 'keyboard';
export type SceneEdgeInput = 'mouse' | 'touch' | 'pen' | 'keyboard';
export type SceneEdgeTimer = 'open' | 'close';

export interface SceneEdgeState {
  enabled: boolean;
  phase: SceneEdgePhase;
  source: SceneEdgeOpenSource | null;
  /** Last pointer position inside the band or the panel: the safe-triangle apex. */
  apex: ScenePoint | null;
  /** Pointer y (viewport px) the hover-opened panel is centred on; null centres on the handle. */
  anchorY: number | null;
  /** Current close grace comes from the safe triangle. */
  safePath: boolean;
}

export type SceneEdgeEvent =
  | { type: 'pointer'; zone: SceneEdgeZone; point: ScenePoint; buttons?: number; pointerType?: string; panel?: SceneRect | null }
  | { type: 'pointerExitWindow' }
  | { type: 'pointerDown'; inside: boolean }
  | { type: 'timer'; timer: SceneEdgeTimer }
  | { type: 'activate'; input: SceneEdgeInput }
  | { type: 'escape' }
  | { type: 'select' }
  | { type: 'suppress' }
  | { type: 'setEnabled'; enabled: boolean };

export type SceneEdgeEffect =
  | { type: 'schedule'; timer: SceneEdgeTimer; ms: number }
  | { type: 'cancel'; timer: SceneEdgeTimer }
  | { type: 'focusPanel' }
  | { type: 'focusHandle' };

export interface SceneEdgeTransition { state: SceneEdgeState; effects: SceneEdgeEffect[] }

export function initialSceneEdgeState(enabled = true): SceneEdgeState {
  return { enabled, phase: 'closed', source: null, apex: null, anchorY: null, safePath: false };
}

export function isSceneEdgeOpen(state: Pick<SceneEdgeState, 'phase'>) {
  return state.phase === 'open' || state.phase === 'leaving';
}

const CANCEL_ALL: SceneEdgeEffect[] = [{ type: 'cancel', timer: 'open' }, { type: 'cancel', timer: 'close' }];

function closed(state: SceneEdgeState, extra: SceneEdgeEffect[] = []): SceneEdgeTransition {
  return { state: { ...state, phase: 'closed', source: null, apex: null, anchorY: null, safePath: false }, effects: [...CANCEL_ALL, ...extra] };
}

function same(state: SceneEdgeState): SceneEdgeTransition {
  return { state, effects: [] };
}

/** Barycentric point-in-triangle test; points on an edge count as inside. */
export function pointInTriangle(p: ScenePoint, a: ScenePoint, b: ScenePoint, c: ScenePoint) {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * The pointer is "on its way" to the panel when it lies in the triangle spanned
 * by the last in-zone point and the panel's near (left) edge. Only meaningful
 * while the apex is left of the panel, i.e. the pointer came from the edge band.
 */
export function isOnSafePath(point: ScenePoint, apex: ScenePoint | null, panel: SceneRect | null | undefined) {
  if (!apex || !panel || apex.x > panel.left) return false;
  if (point.x < apex.x || point.x > panel.left) return false;
  return pointInTriangle(point, apex, { x: panel.left, y: panel.top }, { x: panel.left, y: panel.bottom });
}

export function reduceSceneEdge(state: SceneEdgeState, event: SceneEdgeEvent): SceneEdgeTransition {
  if (event.type === 'setEnabled') {
    if (event.enabled === state.enabled) return same(state);
    return event.enabled ? { state: { ...initialSceneEdgeState(true) }, effects: [] } : closed({ ...state, enabled: false });
  }
  if (!state.enabled) return same(state);

  switch (event.type) {
    case 'pointer': {
      const { zone, point } = event;
      const pressed = (event.buttons ?? 0) !== 0;
      const touchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
      if (state.phase === 'closed') {
        // Hover only: a pressed button means a drag, selection or resize is under way.
        if (zone !== 'edge' || pressed || touchLike) return same(state);
        return { state: { ...state, phase: 'pending', apex: point, anchorY: point.y }, effects: [{ type: 'schedule', timer: 'open', ms: SCENE_EDGE_OPEN_DELAY_MS }] };
      }
      if (state.phase === 'pending') {
        if (zone === 'edge' && !pressed) return { state: { ...state, apex: point, anchorY: point.y }, effects: [] };
        // Left the band (or pressed) before the delay: a quick pass, not a request.
        return closed(state);
      }
      // open / leaving
      if (zone === 'edge' || zone === 'panel') {
        const effects: SceneEdgeEffect[] = state.phase === 'leaving' ? [{ type: 'cancel', timer: 'close' }] : [];
        return { state: { ...state, phase: 'open', apex: point, safePath: false }, effects };
      }
      // Press/keyboard openings stay until an explicit dismissal.
      if (state.source !== 'hover') return same(state);
      const safe = isOnSafePath(point, state.apex, event.panel);
      if (state.phase === 'leaving') {
        if (state.safePath && !safe) {
          return { state: { ...state, safePath: false }, effects: [{ type: 'cancel', timer: 'close' }, { type: 'schedule', timer: 'close', ms: SCENE_EDGE_CLOSE_GRACE_MS }] };
        }
        return same(state);
      }
      return {
        state: { ...state, phase: 'leaving', safePath: safe },
        effects: [{ type: 'schedule', timer: 'close', ms: safe ? SCENE_EDGE_SAFE_PATH_GRACE_MS : SCENE_EDGE_CLOSE_GRACE_MS }],
      };
    }
    case 'pointerExitWindow': {
      // Leaving the webview on the left usually means the native resize border.
      if (state.phase === 'pending') return closed(state);
      if (state.phase === 'open' && state.source === 'hover') {
        return { state: { ...state, phase: 'leaving', safePath: false }, effects: [{ type: 'schedule', timer: 'close', ms: SCENE_EDGE_CLOSE_GRACE_MS }] };
      }
      return same(state);
    }
    case 'pointerDown':
      if (event.inside || state.phase === 'closed') return same(state);
      return closed(state);
    case 'timer':
      if (event.timer === 'open' && state.phase === 'pending') {
        return { state: { ...state, phase: 'open', source: 'hover', safePath: false }, effects: [] };
      }
      if (event.timer === 'close' && state.phase === 'leaving') return closed(state);
      return same(state);
    case 'activate': {
      const open = isSceneEdgeOpen(state);
      if (event.input === 'keyboard') {
        if (open) return closed(state, [{ type: 'focusHandle' }]);
        return { state: { ...state, phase: 'open', source: 'keyboard', anchorY: null, safePath: false }, effects: [...CANCEL_ALL, { type: 'focusPanel' }] };
      }
      if (event.input === 'mouse' && open && state.source === 'hover') {
        // The click that follows a hover-open keeps the panel instead of toggling it away.
        return { state: { ...state, phase: 'open', source: 'press', safePath: false }, effects: [{ type: 'cancel', timer: 'close' }] };
      }
      if (open) return closed(state);
      return { state: { ...state, phase: 'open', source: 'press', anchorY: null, safePath: false }, effects: CANCEL_ALL };
    }
    case 'escape':
      if (state.phase === 'closed') return same(state);
      return closed(state, [{ type: 'focusHandle' }]);
    case 'select':
      return closed(state);
    case 'suppress':
      if (state.phase === 'closed') return same(state);
      return closed(state);
    default:
      return same(state);
  }
}

/**
 * Vertical position of the panel in layout px: centred on `anchorY` and clamped
 * into `[boundsTop, boundsBottom]`. A panel taller than the bounds is pinned to
 * the top and must scroll (`maxHeight`).
 */
export function placeSceneEdgePanel(options: { anchorY: number; panelHeight: number; boundsTop: number; boundsBottom: number; margin?: number }) {
  const margin = options.margin ?? SCENE_EDGE_PANEL_MARGIN_PX;
  const minTop = options.boundsTop + margin;
  const available = Math.max(0, options.boundsBottom - options.boundsTop - margin * 2);
  const height = Math.min(options.panelHeight, available);
  const maxTop = options.boundsBottom - margin - height;
  const top = Math.round(Math.min(Math.max(options.anchorY - height / 2, minTop), Math.max(minTop, maxTop)));
  return { top, maxHeight: Math.round(available) };
}

/** Persisted preference: anything but an explicit `false` keeps the default (on). */
export function normalizeSceneEdgeSwitcherEnabled(value: unknown): boolean {
  return value !== false;
}
