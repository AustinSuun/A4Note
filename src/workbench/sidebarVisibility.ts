/**
 * Single source of truth for whether the workbench sidebar is on screen.
 *
 * Two inputs used to disagree: the persisted user preference
 * (`aster.sidebarCollapsed`) and a CSS-only `@media (max-width: 1040px)` rule
 * that hid the sidebar without React knowing. The title bar then kept saying
 * "收起侧栏" for an invisible sidebar and its toggle flipped a value that had
 * no visual effect. The narrow breakpoint now lives only here; the shell
 * observes it with `matchMedia` and every consumer (title bar icon/label,
 * back-to-scenes action, grid columns, resizer) renders from the derived
 * presentation below. Do not reintroduce a stylesheet media query that hides
 * the sidebar on its own — `scripts/verify-sidebar-visibility.mjs` guards it.
 *
 * This module is pure (no React, DOM or storage) so it can be unit-tested with
 * `node --experimental-strip-types`.
 */

/** Widest viewport (CSS px, as seen by media queries) that counts as narrow. */
export const WORKBENCH_SIDEBAR_NARROW_MAX_WIDTH = 1040;
/** Media query string shared by the shell hook and the regression scripts. */
export const WORKBENCH_SIDEBAR_NARROW_QUERY = `(max-width: ${WORKBENCH_SIDEBAR_NARROW_MAX_WIDTH}px)`;
/** Content kept visible to the right of the overlay drawer (see workbench.css). */
export const WORKBENCH_SIDEBAR_OVERLAY_GUTTER = 64;

export type SidebarMode = 'docked' | 'overlay' | 'hidden';

export interface SidebarVisibilityState {
  /** Persisted user choice. Viewport changes never rewrite it. */
  userCollapsed: boolean;
  /** The viewport matches {@link WORKBENCH_SIDEBAR_NARROW_QUERY}. */
  narrow: boolean;
  /** Transient drawer opened while narrow; always false on wide viewports. */
  overlayOpen: boolean;
}

export interface SidebarPresentation {
  /** docked: grid column; overlay: drawer above content; hidden: off screen. */
  mode: SidebarMode;
  /** What the title bar button, aria-expanded and back-to-scenes follow. */
  visible: boolean;
  narrow: boolean;
}

export function resolveSidebarPresentation(state: SidebarVisibilityState): SidebarPresentation {
  if (state.narrow) {
    return { mode: state.overlayOpen ? 'overlay' : 'hidden', visible: state.overlayOpen, narrow: true };
  }
  return { mode: state.userCollapsed ? 'hidden' : 'docked', visible: !state.userCollapsed, narrow: false };
}

/**
 * The title bar toggle. On narrow viewports it opens/closes the overlay and
 * leaves the persisted preference alone (auto-hidden ≠ user-collapsed); on wide
 * viewports it flips the persisted preference.
 */
export function toggleSidebarVisibility(state: SidebarVisibilityState): SidebarVisibilityState {
  if (state.narrow) return { ...state, overlayOpen: !state.overlayOpen };
  return { ...state, userCollapsed: !state.userCollapsed, overlayOpen: false };
}

/** Viewport crossed the breakpoint: drop any overlay, keep the user's choice. */
export function applySidebarViewport(state: SidebarVisibilityState, narrow: boolean): SidebarVisibilityState {
  if (state.narrow === narrow) return state;
  return { ...state, narrow, overlayOpen: false };
}

/** Esc / click on the content scrim. */
export function dismissSidebarOverlay(state: SidebarVisibilityState): SidebarVisibilityState {
  return state.overlayOpen ? { ...state, overlayOpen: false } : state;
}

/**
 * Make the sidebar visible without toggling it off when it already is
 * (used by the compact back-to-scenes action while the sidebar is hidden).
 */
export function revealSidebar(state: SidebarVisibilityState): SidebarVisibilityState {
  if (state.narrow) return state.overlayOpen ? state : { ...state, overlayOpen: true };
  return state.userCollapsed ? { ...state, userCollapsed: false } : state;
}

export const SIDEBAR_TOGGLE_LABELS = { collapse: '\u6536\u8d77\u4fa7\u680f', expand: '\u5c55\u5f00\u4fa7\u680f' } as const;

/** Label/tooltip for the toggle: it always describes what a click will do. */
export function sidebarToggleLabel(visible: boolean): string {
  return visible ? SIDEBAR_TOGGLE_LABELS.collapse : SIDEBAR_TOGGLE_LABELS.expand;
}
