import { useShortcutProps, useShortcuts } from '../../shared/shortcuts';
import { formatBinding } from '../../core/shortcuts';
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useReaderDrawerGesture } from './useReaderDrawerGesture';
import { BookOpenText, Check, ChevronLeft, ChevronRight, Feather, Layers, NotebookPen, Plus, ScanEye } from 'lucide-react';
import { NOTE_WORKBENCH_COMMANDS, type NoteWorkbenchCommand, type NoteWorkbenchMode } from './noteWorkbench';

/* Reader-side labels stay local: the workbench is a reader surface, and keeping them
   here avoids touching the shared zh table for an experimental feature name. */
const MODE_LABELS: Record<NoteWorkbenchMode, string> = {
  reading: 'PDF 专注',
  split: '边读边记',
  floating: '悬浮速记',
  writing: '专注写作',
};
const MODE_HINTS: Record<NoteWorkbenchMode, string> = {
  reading: '收起笔记，PDF 占满内容区',
  split: 'PDF 与笔记并排，可拖动调整宽度',
  floating: '可拖动、可调整大小的速记卡',
  writing: '笔记占满内容区，随时返回论文',
};
const MODE_ORDER: NoteWorkbenchMode[] = ['split', 'floating', 'writing', 'reading'];
const MODE_ICONS = { split: Layers, floating: ScanEye, writing: Feather, reading: BookOpenText } as const;
/* Keyboard hints mirror the shared registry defaults so the menu, the button and the
   resolver never disagree about a binding. */
const MODE_COMMAND: Record<NoteWorkbenchMode, NoteWorkbenchCommand> = {
  split: NOTE_WORKBENCH_COMMANDS.split,
  floating: NOTE_WORKBENCH_COMMANDS.floating,
  writing: NOTE_WORKBENCH_COMMANDS.focus,
  reading: NOTE_WORKBENCH_COMMANDS.pdfFocus,
};


/** The entry lives on the content boundary, never in the titlebar. New-note uses this menu; history uses the unified
 * note-header picker. Both remain reachable in at most two clicks. */
export function ReaderNoteWorkbenchMenu({ mode, onToggle, onSelectMode, temporary = false,
  docked = false, overlay = false, drawerWidth = 0, resize, onNewNote,
}: {
  mode: NoteWorkbenchMode;
  onNewNote?: () => void;
  onToggle: () => void;
  onSelectMode: (mode: NoteWorkbenchMode) => void;
  temporary?: boolean;
  docked?: boolean;
  overlay?: boolean;
  drawerWidth?: number;
  resize?: { width: number; maximum: number; onChange: (width: number) => void };
}) {
  const shortcutProps = useShortcutProps();
  const shortcuts = useShortcuts();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const hintId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const closed = mode === 'reading';
  const itemCount = MODE_ORDER.length + (onNewNote ? 1 : 0);
  const [edgeTop, setEdgeTop] = useState<number>();
  useLayoutEffect(() => {
    const shell = rootRef.current?.closest<HTMLElement>('.reader-workspace-shell');
    if (!shell) return;
    const dock = shell.querySelector<HTMLElement>('.reader-toolbar-annotations');
    const place = () => {
      const box = shell.getBoundingClientRect(), scale = box.height / Math.max(1, shell.offsetHeight);
      const tool = dock && getComputedStyle(dock).visibility !== 'hidden' ? dock.getBoundingClientRect() : null;
      const bottom = tool && tool.height && tool.top > box.top ? Math.min(box.bottom, tool.top) : box.bottom;
      setEdgeTop((bottom - box.top) / (2 * scale));
    };
    place(); const observer = new ResizeObserver(place); observer.observe(shell); if (dock) observer.observe(dock);
    window.addEventListener('resize', place); return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [mode, docked]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) (openerRef.current ?? buttonRef.current)?.focus({ preventScroll: true });
  }, []);
  const openMenu = (opener: HTMLButtonElement | null, index: number) => {
    openerRef.current = opener;
    setOpen(true);
    setActiveIndex(index);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);
  useLayoutEffect(() => { if (open && menuStyle.visibility !== 'hidden') itemRefs.current[activeIndex]?.focus({ preventScroll: true }); }, [open, activeIndex, menuStyle.visibility]);
  const select = (next: NoteWorkbenchMode) => { onSelectMode(next); close(); };
  const gestures = useReaderDrawerGesture({ resize, onLongPress: () => openMenu(buttonRef.current, 0) });
  const label = `笔记工作台：${MODE_LABELS[mode]} · ${shortcuts.bindings(NOTE_WORKBENCH_COMMANDS.toggle).map(formatBinding).join(' / ') || '未绑定'}${temporary ? '（窄窗临时悬浮）' : overlay ? '（窄窗覆盖面板）' : ''}${mode === 'writing' ? ' · 返回论文' : ''}`;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect(), menu = menuRef.current;
      if (!anchor || !menu) return;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const box = menu.getBoundingClientRect();
      const x = mode === 'writing' || overlay ? anchor.right + 6 : anchor.left - box.width - 6;
      setMenuStyle({ position: 'fixed', left: Math.max(8, Math.min(x, innerWidth - box.width - 8)) / zoom,
        top: Math.max(8, Math.min(anchor.top + anchor.height / 2 - box.height / 2, innerHeight - box.height - 8)) / zoom,
        maxWidth: (innerWidth - 16) / zoom, maxHeight: (innerHeight - 16) / zoom });
    };
    place(); const observer = new ResizeObserver(place); if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, mode, overlay, drawerWidth]);
  return (
    <div className="reader-note-workbench-entry reader-note-edge-entry" ref={rootRef} data-note-mode={mode}
      data-note-temporary={temporary ? 'true' : 'false'} data-note-docked={docked ? 'true' : 'false'}
      /* Docked: follow the note track variable so the bookmark rides the split line while
         the column slides open or closed (ReaderScene animates --reader-side-width). */
      style={{ top: edgeTop, ...(mode === 'writing' || overlay ? { left: 0, right: 'auto' } : { right: docked ? `max(0px, calc(var(--reader-side-width, ${drawerWidth}px) - ${closed ? 16 : 8}px))` : 0 }) }}>
      <button type="button" ref={buttonRef} className={`reader-note-workbench-button reader-note-edge-handle${closed ? '' : ' active'}`}
        {...shortcutProps(NOTE_WORKBENCH_COMMANDS.toggle, label)} title={label} aria-label={label}
        aria-describedby={mode === 'floating' && !open ? hintId : undefined}
        aria-pressed={!closed} aria-expanded={open} aria-haspopup="menu" aria-controls={open ? menuId : undefined}
        onPointerDown={gestures.onPointerDown}
        onClick={event => { if (event.detail === 0 || !gestures.consumeClick()) onToggle(); }}
        onContextMenu={event => { event.preventDefault(); openMenu(event.currentTarget, 0); }}
        onWheel={event => {
          const pdf = rootRef.current?.closest('.reader-workspace-shell')?.querySelector<HTMLElement>('.pdf-document');
          if (pdf && !event.ctrlKey && !event.metaKey) pdf.scrollBy({ left: event.deltaX, top: event.deltaY });
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); openMenu(event.currentTarget, event.key === 'ArrowUp' ? itemCount - 1 : 0);
          }
        }}>
        {closed ? <><NotebookPen size={14} aria-hidden="true" /><span className="reader-note-edge-label">笔记</span></> :
          mode === 'writing' ? <ChevronLeft size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>
      {mode === 'floating' && !open && <span id={hintId} role="tooltip" className="reader-note-edge-hint">短按收起 · 长按切换模式</span>}
      {open && createPortal(
        <div ref={menuRef} style={menuStyle}
          className="reader-note-workbench-menu"
          role="menu"
          id={menuId}
          aria-label="笔记工作台"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex((current) => (current + delta + itemCount) % itemCount);
              return;
            }
            if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); return; }
            if (event.key === 'End') { event.preventDefault(); setActiveIndex(itemCount - 1); }
            if (event.key === 'Tab') close(false);
          }}
        >
          {MODE_ORDER.map((candidate, index) => {
            const Icon = MODE_ICONS[candidate];
            return (
              <button
                key={candidate}
                type="button"
                role="menuitemradio"
                aria-checked={candidate === mode}
                tabIndex={activeIndex === index ? 0 : -1}
                ref={(node) => { itemRefs.current[index] = node; }}
                className={`reader-note-workbench-item${candidate === mode ? ' current' : ''}`}
                {...shortcutProps(MODE_COMMAND[candidate], MODE_HINTS[candidate])}
                onClick={() => select(candidate)}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="reader-note-workbench-item-label">{MODE_LABELS[candidate]}{candidate === mode && <Check size={12} aria-hidden="true" style={{ marginLeft: 6, verticalAlign: 'middle' }} />}</span>
                <kbd className="reader-note-workbench-item-key">{shortcuts.bindings(MODE_COMMAND[candidate]).map(formatBinding).join(' / ')}</kbd>
                <span className="reader-note-workbench-item-hint">{MODE_HINTS[candidate]}</span>
              </button>
            );
          })}
          {onNewNote && <button type="button" role="menuitem" className="reader-note-workbench-item"
            ref={node => { itemRefs.current[MODE_ORDER.length] = node; }} tabIndex={activeIndex === MODE_ORDER.length ? 0 : -1}
            onClick={() => { onNewNote(); close(); }}><Plus size={14} aria-hidden="true" /><span>新建文档</span></button>}
        </div>, document.body
      )}
    </div>
  );
}

export const NOTE_WORKBENCH_MENU_COMMANDS = NOTE_WORKBENCH_COMMANDS;

/** Compact, keyboard-reachable alternatives to the handle's context menu. */
export function ReaderNoteModeSwitch({ mode, onSelectMode }: { mode: NoteWorkbenchMode; onSelectMode: (mode: NoteWorkbenchMode) => void }) {
  return <div className="reader-note-mode-switch" role="group" aria-label="笔记布局">
    {(['split', 'floating', 'writing'] as const).map(value => { const Icon = MODE_ICONS[value];
      return <button key={value} type="button" aria-label={MODE_LABELS[value]} title={MODE_LABELS[value]} aria-pressed={mode === value}
        onClick={() => onSelectMode(value)}><Icon size={14} aria-hidden="true" /></button>;
    })}
  </div>;
}
