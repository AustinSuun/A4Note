import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { WindowTitleBar } from './WindowTitleBar';
import { viewportDeltaToLayout } from '../shared/ui/viewportToLayout';
import { dismissSidebarOverlay, resolveSidebarPresentation, revealSidebar, toggleSidebarVisibility, type SidebarVisibilityState } from './sidebarVisibility';
import { useNarrowViewport } from './useNarrowViewport';

/** Minimum width needed to keep the sidebar controls and scene picker usable. */
export const WORKBENCH_SIDEBAR_MIN_WIDTH = 300;
/** Keep enough room for long file names and workspace tools on wide windows. */
export const WORKBENCH_SIDEBAR_MAX_WIDTH = 480;

export interface WorkbenchShellProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  explorer?: ReactNode;
  content: ReactNode;
  /** Rendered over the tab host: settings and other full-surface panels. */
  overlay?: ReactNode;
  dialogs?: ReactNode;
  /** Left-edge quick scene switcher; floats over the sidebar and content, never takes grid space. */
  edgeSwitcher?: ReactNode;
  /**
   * Persisted user preference only. Whether the sidebar is actually on screen
   * also depends on the viewport; see `sidebarVisibility.ts`.
   */
  sidebarCollapsed?: boolean;
  /** Flips the persisted preference. Not called for the narrow-viewport overlay. */
  onToggleSidebar?: () => void;
  leadingAction?: ReactNode;
  brandAccessory?: ReactNode;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

/**
 * Owns the workbench grid and nothing else. `App.tsx` fills the slots so the
 * shell stays free of store and platform calls.
 */
export function WorkbenchShell({ sidebar, topBar, explorer, content, overlay, dialogs, edgeSwitcher, sidebarCollapsed = false, onToggleSidebar, leadingAction, brandAccessory, sidebarWidth = WORKBENCH_SIDEBAR_MIN_WIDTH, onSidebarWidthChange }: WorkbenchShellProps) {
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: sidebarWidth });
  const resizeWidthRef = useRef(sidebarWidth);
  const frameRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowViewport();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const visibilityState: SidebarVisibilityState = { userCollapsed: sidebarCollapsed, narrow, overlayOpen: narrow && overlayOpen };
  const presentation = resolveSidebarPresentation(visibilityState);

  // Crossing the breakpoint drops a transient overlay; the persisted choice stays.
  useEffect(() => {
    setOverlayOpen(false);
  }, [narrow]);

  const commitVisibility = (next: SidebarVisibilityState) => {
    if (next.userCollapsed !== sidebarCollapsed) onToggleSidebar?.();
    setOverlayOpen(next.overlayOpen);
  };
  const focusSidebarToggle = () => {
    frameRef.current?.querySelector<HTMLButtonElement>('.window-titlebar-sidebar-toggle')?.focus();
  };
  const closeOverlay = () => commitVisibility(dismissSidebarOverlay(visibilityState));

  useEffect(() => {
    if (presentation.mode !== 'overlay') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // Esc inside an editor/rename field belongs to that field.
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      setOverlayOpen(false);
      focusSidebarToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentation.mode]);

  const getSidebarWidthFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const latestEvent = samples[samples.length - 1] ?? event.nativeEvent;
    // `sidebarWidth` is a layout px value while `clientX` moves in viewport px; under the root zoom the
    // pointer delta has to be scaled back or the sidebar edge outruns the cursor.
    const delta = viewportDeltaToLayout(latestEvent.clientX - resizeStartRef.current.x, 0).x;
    return Math.max(WORKBENCH_SIDEBAR_MIN_WIDTH, Math.min(WORKBENCH_SIDEBAR_MAX_WIDTH, resizeStartRef.current.width + delta));
  };

  const updateSidebarWidthFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    const nextWidth = getSidebarWidthFromPointer(event);
    resizeWidthRef.current = nextWidth;
    // Keep pointer movement on a compositor-only transform. Updating
    // --sidebar-width here relayouts the grid, title bar, file tree and active
    // document on every pointer event, which is visibly delayed on busy notes.
    const offset = nextWidth - resizeStartRef.current.width;
    resizerRef.current?.style.setProperty('transform', `translate3d(${offset}px, 0, 0)`);
  };

  const stopSidebarResize = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    if (event) {
      resizeWidthRef.current = getSidebarWidthFromPointer(event);
    }
    resizingRef.current = false;
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    frameRef.current?.style.setProperty('--sidebar-width', `${resizeWidthRef.current}px`);
    // Commit the width with transitions disabled, then remove the preview in
    // the same visual frame. The one forced layout happens only on release.
    void frameRef.current?.offsetWidth;
    resizerRef.current?.style.removeProperty('transform');
    onSidebarWidthChange?.(resizeWidthRef.current);
    document.body.classList.remove('is-horizontal-resizing');
    window.dispatchEvent(new Event('workbench-resize-end'));
    setResizingSidebar(false);
  };

  const shellStyle = { '--sidebar-width': `${sidebarWidth}px` } as CSSProperties;

  return (
    <div ref={frameRef} className="app-window" style={shellStyle}>
      <WindowTitleBar
        sidebarCollapsed={!presentation.visible}
        sidebarMode={presentation.mode}
        sidebarNarrow={presentation.narrow}
        onToggleSidebar={() => commitVisibility(toggleSidebarVisibility(visibilityState))}
        onRevealSidebar={() => commitVisibility(revealSidebar(visibilityState))}
        topBar={topBar}
        leadingAction={leadingAction}
        brandAccessory={brandAccessory}
      />
      <div
        className={explorer ? 'workbench-shell with-explorer' : 'workbench-shell'}
        data-sidebar-collapsed={presentation.mode === 'hidden' || undefined}
        data-sidebar-mode={presentation.mode}
      >
        {sidebar}
        {presentation.mode === 'overlay' && (
          <div className="workbench-sidebar-scrim" aria-hidden="true" onClick={closeOverlay} />
        )}
        {presentation.mode === 'docked' && (
          <div
            ref={resizerRef}
            className={resizingSidebar ? 'workbench-sidebar-resizer active' : 'workbench-sidebar-resizer'}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              resizingRef.current = true;
              resizeStartRef.current = { x: event.clientX, width: sidebarWidth };
              resizeWidthRef.current = sidebarWidth;
              resizerRef.current?.style.setProperty('transform', 'translate3d(0, 0, 0)');
              document.body.classList.add('is-horizontal-resizing');
              setResizingSidebar(true);
            }}
            onPointerMove={updateSidebarWidthFromPointer}
            onPointerUp={stopSidebarResize}
            onPointerCancel={stopSidebarResize}
            onLostPointerCapture={() => stopSidebarResize()}
          />
        )}
        <main className="workbench-main">
          <div className="workbench-body">
            {explorer}
            <div className="workbench-surface">
              {content}
              {overlay}
            </div>
          </div>
        </main>
        {dialogs}
      </div>
      {edgeSwitcher}
    </div>
  );
}
