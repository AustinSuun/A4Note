import type { ReactNode } from 'react';
import { useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import { useReaderNoteActive } from './ReaderNoteActivity';
import './reader-annotation-dock.css';

/** Stay inside this reader's main viewport, not the window-wide titlebar portal. */
export function ReaderAnnotationDock({ children }: { children: ReactNode }) {
  const active = useDocumentToolbarActive();
  const visible = useReaderNoteActive();
  if (!active || !visible) return null;
  return <div className="reader-annotation-dock" role="group" aria-label="PDF 标注工具"
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {children}
  </div>;
}
