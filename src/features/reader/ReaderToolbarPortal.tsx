import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useDocumentToolbar, useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import { useReaderNoteActive } from './ReaderNoteActivity';
import './reader-titlebar.css';

/** Only the active, visible reader may contribute controls to the shell title bar. */
export function ReaderToolbarPortal({ children }: { children: ReactNode }) {
  const toolbar = useDocumentToolbar();
  const active = useDocumentToolbarActive();
  const visible = useReaderNoteActive();
  if (!active || !visible) return null;
  if (!toolbar?.enabled || !toolbar.controlsHost) return <>{children}</>;
  return createPortal(<div className="reader-titlebar-tools" onDoubleClick={event => event.stopPropagation()}>{children}</div>, toolbar.controlsHost);
}
