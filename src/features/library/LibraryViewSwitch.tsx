import { createPortal } from 'react-dom';
import { List, Table2, NotebookPen, type LucideIcon } from 'lucide-react';
import { useDocumentToolbar, useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import './library-view-switch.css';

type LibraryView = 'list' | 'overview' | 'notes';
const views: { value: LibraryView; label: string; icon: LucideIcon }[] = [
  { value: 'list', label: '列表', icon: List },
  { value: 'overview', label: '综览', icon: Table2 },
  { value: 'notes', label: '笔记', icon: NotebookPen },
];

/** The scene owns selection; only its active tab contributes titlebar controls. */
export function LibraryViewSwitch({ view, onChange }: { view: LibraryView; onChange: (view: LibraryView) => void }) {
  const toolbar = useDocumentToolbar();
  const active = useDocumentToolbarActive();
  if (!active) return null;
  const controls = <div className="library-titlebar-switch markdown-resource-mode-switch" data-view={view}
    role="group" aria-label="文献显示方式" onDoubleClick={event => event.stopPropagation()}>
    {views.map(item => <button key={item.value} type="button" className={view === item.value ? 'active' : ''}
      aria-pressed={view === item.value} onClick={() => onChange(item.value)}><item.icon size={14} aria-hidden="true" /><span>{item.label}</span></button>)}
  </div>;
  return toolbar?.enabled && toolbar.controlsHost ? createPortal(controls, toolbar.controlsHost) : controls;
}
