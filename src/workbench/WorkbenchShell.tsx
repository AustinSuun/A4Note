import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { WindowTitleBar } from './WindowTitleBar';

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
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  leadingAction?: ReactNode;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

/**
 * Owns the workbench grid and nothing else. `App.tsx` fills the slots so the
 * shell stays free of store and platform calls.
 */
export function WorkbenchShell({ sidebar, topBar, explorer, content, overlay, dialogs, sidebarCollapsed = false, onToggleSidebar, leadingAction, sidebarWidth = WORKBENCH_SIDEBAR_MIN_WIDTH, onSidebarWidthChange }: WorkbenchShellProps) {
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: sidebarWidth });
  const resizeWidthRef = useRef(sidebarWidth);
  const frameRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);

  const getSidebarWidthFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const latestEvent = samples[samples.length - 1] ?? event.nativeEvent;
    return Math.max(WORKBENCH_SIDEBAR_MIN_WIDTH, Math.min(WORKBENCH_SIDEBAR_MAX_WIDTH, resizeStartRef.current.width + latestEvent.clientX - resizeStartRef.current.x));
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
      <WindowTitleBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar ?? (() => undefined)} topBar={topBar} leadingAction={leadingAction} />
      <div className={explorer ? 'workbench-shell with-explorer' : 'workbench-shell'} data-sidebar-collapsed={sidebarCollapsed || undefined}>
        {sidebar}
        {!sidebarCollapsed && (
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
    </div>
  );
}
