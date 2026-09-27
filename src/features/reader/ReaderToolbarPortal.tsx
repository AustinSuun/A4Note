import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useDocumentToolbar, useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import { useReaderNoteActive } from './ReaderNoteActivity';
import './reader-titlebar.css';
import { ReaderResponsiveToolbar } from './ReaderResponsiveToolbar';

/** Only the active, visible reader may contribute controls to the shell title bar. */
export function ReaderToolbarPortal({ children, compactLabel = '阅读工具', onReturnToLibrary }: { children: ReactNode; compactLabel?: string; onReturnToLibrary?: () => void }) {
  const toolbar = useDocumentToolbar();
  const active = useDocumentToolbarActive();
  const visible = useReaderNoteActive();
  if (!active || !visible) return null;
  if (!toolbar?.enabled || !toolbar.controlsHost) return <>{children}</>;
  return createPortal(<div className="reader-titlebar-tools" onDoubleClick={event => event.stopPropagation()}><ReaderResponsiveToolbar label={compactLabel} onReturnToLibrary={onReturnToLibrary}>{children}</ReaderResponsiveToolbar></div>, toolbar.controlsHost);
}
