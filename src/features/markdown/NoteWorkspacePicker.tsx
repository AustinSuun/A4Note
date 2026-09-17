import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import './note-workspace-picker.css';

type FolderChoice = { key: string; name: string; path: string };
export function NoteWorkspacePicker({ folders, currentKey, disabled, onSelect, onOpenFolder }: {
  folders: FolderChoice[]; currentKey?: string; disabled?: boolean;
  onSelect: (key: string) => void; onOpenFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 280, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = folders.find(folder => folder.key === currentKey);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(240, rect.width), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const down = below >= Math.min(240, above);
      const maxHeight = Math.max(40, Math.min(320, down ? below : above));
      setPosition({ width, maxHeight, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: down ? rect.bottom + 6 : Math.max(8, rect.top - maxHeight - 6) });
    };
    place();
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected ?? items?.[0])?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: 'nearest' });
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="note-workspace-trigger" disabled={disabled} aria-label="切换笔记工作区" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      title={current?.path ?? '选择笔记工作区'} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <FolderOpen size={16} aria-hidden="true" /><span className="note-folder-breadcrumb-name">{current?.name ?? '笔记工作区'}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label="笔记工作区" className="note-workspace-menu" style={position}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next = -1;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = items.length - 1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}>
      <div className="note-workspace-menu-label" aria-hidden="true">切换工作区</div>
      {folders.map(folder => <button key={folder.key} type="button" role="menuitemradio" aria-checked={folder.key === currentKey} title={folder.path}
        onClick={() => { close(true); onSelect(folder.key); }}>
        <FolderOpen size={16} aria-hidden="true" /><span>{folder.name}</span>{folder.key === currentKey && <Check size={15} aria-hidden="true" />}
      </button>)}
      <button type="button" role="menuitem" className="note-workspace-open-folder" onClick={() => { close(true); onOpenFolder(); }}><FolderOpen size={16} aria-hidden="true" /><span>打开文件夹…</span></button>
    </div>, document.body)}
  </>;
}
