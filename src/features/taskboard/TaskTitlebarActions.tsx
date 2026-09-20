import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDocumentToolbar, useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import './task-titlebar-actions.css';

/** Use the existing shell host, never cover native window buttons or install a new drag handler. */
export function TaskTitlebarActions({ children }: { children: ReactNode }) {
  const toolbar = useDocumentToolbar();
  const active = useDocumentToolbarActive();
  if (!active) return null;
  // The container spans the whole titlebar strip; keeping no-drag on it would turn the
  // blank area between the stage switcher and the primary button into a dead zone for
  // window dragging. Only the real controls opt out of the drag region.
  const content = <div className="tb-titlebar-actions">{children}</div>;
  return toolbar?.enabled && toolbar.controlsHost ? createPortal(content, toolbar.controlsHost) : content;
}
