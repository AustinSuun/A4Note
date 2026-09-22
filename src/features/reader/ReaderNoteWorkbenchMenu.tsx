import { useShortcutProps, useShortcuts } from '../../shared/shortcuts';
import { formatBinding } from '../../core/shortcuts';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpenText, ChevronDown, Feather, History, Layers, Plus, ScanEye } from 'lucide-react';
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


/** The single reader entry point: one button that resumes the last mode plus a menu
    for the four modes, new note and history. Replaces the old vertical ear and the
    old "full width / split" toggle inside the notes panel. */
export function ReaderNoteWorkbenchMenu({
  mode,
  onToggle,
  onSelectMode,
  onNewNote,
  onOpenHistory,
  temporary = false,
}: {
  mode: NoteWorkbenchMode;
  onToggle: () => void;
  onSelectMode: (mode: NoteWorkbenchMode) => void;
  onNewNote?: () => void | Promise<unknown>;
  onOpenHistory?: () => void;
  temporary?: boolean;
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
  const closed = mode === 'reading';

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
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  const select = (next: NoteWorkbenchMode) => {
    onSelectMode(next);
    close();
  };

  return (
    <div className="reader-note-workbench-entry" ref={rootRef} data-note-mode={mode} data-note-temporary={temporary ? 'true' : 'false'}>
      <button
        type="button"
        ref={buttonRef}
        className={`reader-note-workbench-button${closed ? '' : ' active'}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        {...shortcutProps(NOTE_WORKBENCH_COMMANDS.toggle, `笔记工作台：${MODE_LABELS[mode]}`)}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(event.currentTarget, 0); }
          if (event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.currentTarget, MODE_ORDER.length - 1); }
        }}
      >
        <BookOpenText size={15} aria-hidden="true" />
        <span className="reader-note-workbench-label">笔记工作台</span>
        <span className="reader-note-workbench-mode">{MODE_LABELS[mode]}</span>
      </button>
      <button
        type="button"
        className="reader-note-workbench-more"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label="笔记工作台菜单"
        onClick={(event) => (open ? close() : openMenu(event.currentTarget, 0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(event.currentTarget, 0); }
          if (event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.currentTarget, MODE_ORDER.length - 1); }
          if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
        }}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="reader-note-workbench-menu"
          role="menu"
          id={menuId}
          aria-label="笔记工作台"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex((current) => (current + delta + MODE_ORDER.length) % MODE_ORDER.length);
              return;
            }
            if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); return; }
            if (event.key === 'End') { event.preventDefault(); setActiveIndex(MODE_ORDER.length - 1); }
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
                ref={(node) => { itemRefs.current[index] = node; }}
                className={`reader-note-workbench-item${candidate === mode ? ' current' : ''}`}
                {...shortcutProps(MODE_COMMAND[candidate], MODE_HINTS[candidate])}
                onClick={() => select(candidate)}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="reader-note-workbench-item-label">{MODE_LABELS[candidate]}</span>
                <kbd className="reader-note-workbench-item-key">{shortcuts.bindings(MODE_COMMAND[candidate]).map(formatBinding).join(' / ')}</kbd>
                <span className="reader-note-workbench-item-hint">{MODE_HINTS[candidate]}</span>
              </button>
            );
          })}
          <div className="reader-note-workbench-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            ref={(node) => { itemRefs.current[MODE_ORDER.length] = node; }}
            className="reader-note-workbench-item"
            onClick={() => { close(false); void onNewNote?.(); }}
          >
            <Plus size={14} aria-hidden="true" />
            <span className="reader-note-workbench-item-label">新建论文笔记</span>
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(node) => { itemRefs.current[MODE_ORDER.length + 1] = node; }}
            className="reader-note-workbench-item"
            onClick={() => { close(false); onOpenHistory?.(); }}
          >
            <History size={14} aria-hidden="true" />
            <span className="reader-note-workbench-item-label">笔记历史</span>
          </button>
        </div>
      )}
    </div>
  );
}

export const NOTE_WORKBENCH_MENU_COMMANDS = NOTE_WORKBENCH_COMMANDS;
