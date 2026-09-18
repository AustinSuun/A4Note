import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../platform/nativeApi';
import { bindWindowTitlebarGestures } from './windowTitlebarGestures';

export interface WindowTitleBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  topBar: ReactNode;
  /** Optional scene-owned action shown beside the A4 Note brand. */
  leadingAction?: ReactNode;
  /** App-owned badge beside the brand; the shell has no update-service dependency. */
  brandAccessory?: ReactNode;
}

type WindowCommand = 'minimize' | 'toggle_maximize' | 'close' | 'start_dragging';

/** Frameless-window controls backed by native commands, not webview permissions. */
export function WindowTitleBar({ sidebarCollapsed, onToggleSidebar, topBar, leadingAction, brandAccessory }: WindowTitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const titlebarRef = useRef<HTMLElement>(null);

  const runWindowCommand = useCallback(async (command: WindowCommand) => {
    if (!isTauriRuntime()) return;
    try {
      const isMaximized = await invoke<boolean>('perform_window_command', { command });
      if (command === 'toggle_maximize') setMaximized(isMaximized);
    } catch {
      // A close command can finish before the webview receives its response.
    }
  }, []);

  useEffect(() => {
    const titlebar = titlebarRef.current;
    if (!titlebar || !isTauriRuntime()) return;
    return bindWindowTitlebarGestures(titlebar, command => { void runWindowCommand(command); });
  }, [runWindowCommand]);

  const stopWindowDrag = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <header
      className={sidebarCollapsed ? 'window-titlebar sidebar-collapsed' : 'window-titlebar'}
      ref={titlebarRef}
    >
      <div className="window-titlebar-leading">
        <button
          type="button"
          className="window-titlebar-sidebar-toggle"
          aria-label={sidebarCollapsed ? '\u5c55\u5f00\u4fa7\u680f' : '\u6536\u8d77\u4fa7\u680f'}
          title={sidebarCollapsed ? '\u5c55\u5f00\u4fa7\u680f' : '\u6536\u8d77\u4fa7\u680f'}
          onMouseDown={stopWindowDrag}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} /> : <PanelLeftClose size={18} strokeWidth={1.8} />}
        </button>
        <span className="window-titlebar-name" aria-label="A4 Note">
          <span className="window-titlebar-name-accent">A4</span>
          <span className="window-titlebar-name-note">Note</span>
        </span>
        {brandAccessory}
        <div className="window-titlebar-drag-zone left" aria-hidden="true" />
        {!sidebarCollapsed && leadingAction && <div className="window-titlebar-leading-action">{leadingAction}</div>}
      </div>
      <div className="window-titlebar-projectbar">{topBar}</div>
      <div className="window-titlebar-drag-zone right" aria-hidden="true" />
      <div className="window-titlebar-controls">
        <button type="button" className="window-titlebar-control" aria-label="\u6700\u5c0f\u5316" title="\u6700\u5c0f\u5316" onMouseDown={stopWindowDrag} onClick={() => void runWindowCommand('minimize')}>
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="window-titlebar-control"
          aria-label={maximized ? '\u8fd8\u539f' : '\u6700\u5927\u5316'}
          title={maximized ? '\u8fd8\u539f' : '\u6700\u5927\u5316'}
          onMouseDown={stopWindowDrag}
          onClick={() => void runWindowCommand('toggle_maximize')}
        >
          {maximized ? <Copy size={13} strokeWidth={1.8} /> : <Square size={13} strokeWidth={1.8} />}
        </button>
        <button type="button" className="window-titlebar-control close" aria-label="\u5173\u95ed" title="\u5173\u95ed" onMouseDown={stopWindowDrag} onClick={() => void runWindowCommand('close')}>
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
