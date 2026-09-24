/* Note workbench: one paper note session, four presentation modes.
   Pure, DOM-free logic so the mode machine and per-paper preferences can be tested
   directly; the reader scene only consumes it. */
export type NoteWorkbenchMode = 'reading' | 'split' | 'floating' | 'writing';

export const NOTE_WORKBENCH_MODES: NoteWorkbenchMode[] = ['reading', 'split', 'floating', 'writing'];

/* Shared registry command ids. The scoped shortcut resolver registers these; the
   reader must not add a second, parallel key listener next to useReaderWritingShortcuts. */
export const NOTE_WORKBENCH_COMMANDS = {
  toggle: 'reader.notes.toggle',
  quickCapture: 'reader.notes.quickCapture',
  split: 'reader.notes.mode.split',
  focus: 'reader.notes.mode.focus',
  floating: 'reader.notes.mode.floating',
  pdfFocus: 'reader.pdf.focus',
} as const;

export type NoteWorkbenchCommand = (typeof NOTE_WORKBENCH_COMMANDS)[keyof typeof NOTE_WORKBENCH_COMMANDS];

export const NOTE_WORKBENCH_COMMAND_LIST: { id: NoteWorkbenchCommand; title: string; default: string }[] = [
  { id: NOTE_WORKBENCH_COMMANDS.toggle, title: '笔记工作台：打开/收起', default: 'Control+Alt+N' },
  { id: NOTE_WORKBENCH_COMMANDS.quickCapture, title: '笔记工作台：悬浮速记', default: 'Control+Alt+Q' },
  { id: NOTE_WORKBENCH_COMMANDS.split, title: '笔记工作台：边读边记', default: 'Control+Alt+2' },
  { id: NOTE_WORKBENCH_COMMANDS.focus, title: '笔记工作台：专注写作', default: 'Control+Alt+3' },
  { id: NOTE_WORKBENCH_COMMANDS.floating, title: '笔记工作台：悬浮速记卡', default: 'Control+Alt+4' },
  { id: NOTE_WORKBENCH_COMMANDS.pdfFocus, title: 'PDF 专注（收起笔记）', default: 'Control+Alt+P' },
];

/** Command -> presentation mode. `null` means the command does not pick a mode. */
export function modeForNoteWorkbenchCommand(command: string): NoteWorkbenchMode | null {
  if (command === NOTE_WORKBENCH_COMMANDS.split) return 'split';
  if (command === NOTE_WORKBENCH_COMMANDS.focus) return 'writing';
  if (command === NOTE_WORKBENCH_COMMANDS.floating || command === NOTE_WORKBENCH_COMMANDS.quickCapture) return 'floating';
  if (command === NOTE_WORKBENCH_COMMANDS.pdfFocus) return 'reading';
  return null;
}

export const SPLIT_RATIO_DEFAULT = 0.37;
export const SPLIT_RATIO_MIN = 0.26;
export const SPLIT_RATIO_MAX = 0.62;
export const PDF_MIN_WIDTH = 520;
export const NOTE_MIN_WIDTH = 300;
/** >= this container width the workbench keeps the user's wide-screen preference. */
export const NOTE_WORKBENCH_WIDE_BREAKPOINT = 1200;
/** below this width split/writing temporarily fall back to the floating card. */
export const NOTE_WORKBENCH_NARROW_BREAKPOINT = 980;

/** Floating card geometry is stored as ratios of the workspace container, so the
    same preference survives window resizes and 100-200% zoom. */
export type FloatingCardRect = { x: number; y: number; width: number; height: number };

export const FLOATING_RECT_DEFAULT: FloatingCardRect = { x: 0.5, y: 0.14, width: 0.42, height: 0.62 };

export type NoteWorkbenchPrefs = {
  mode: NoteWorkbenchMode;
  /** mode to return to when leaving a wide mode (Escape / 收起). */
  previousMode: NoteWorkbenchMode;
  /** Last explicitly selected open mode; temporary responsive fallback never overwrites it. */
  lastOpenMode: Exclude<NoteWorkbenchMode, 'reading'>;
  /** note that was being edited in this paper, restored on the next visit. */
  activeNoteId: string | null;
  /** last split/writing choice, restored when the window is wide again. */
  wideMode: 'split' | 'writing';
  splitRatio: number;
  floating: FloatingCardRect;
};

export function isNoteWorkbenchMode(value: unknown): value is NoteWorkbenchMode {
  return typeof value === 'string' && (NOTE_WORKBENCH_MODES as string[]).includes(value);
}

export function clampSplitRatio(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, numeric));
}

export function clampFloatingRect(value: unknown): FloatingCardRect {
  const source = (value ?? {}) as Partial<FloatingCardRect>;
  const pick = (candidate: unknown, fallback: number, min: number, max: number) => {
    const numeric = typeof candidate === 'number' ? candidate : Number(candidate);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  };
  const width = pick(source.width, FLOATING_RECT_DEFAULT.width, 0.22, 0.96);
  const height = pick(source.height, FLOATING_RECT_DEFAULT.height, 0.22, 0.96);
  /* x/y are clamped against the stored size so the card can never leave the
     workspace, however the window or zoom changes afterwards. */
  return {
    x: pick(source.x, FLOATING_RECT_DEFAULT.x, 0, Math.max(0, 1 - width)),
    y: pick(source.y, FLOATING_RECT_DEFAULT.y, 0, Math.max(0, 1 - height)),
    width,
    height,
  };
}

export function defaultNoteWorkbenchPrefs(): NoteWorkbenchPrefs {
  return { mode: 'reading', previousMode: 'reading', lastOpenMode: 'split', activeNoteId: null, wideMode: 'split', splitRatio: SPLIT_RATIO_DEFAULT, floating: { ...FLOATING_RECT_DEFAULT } };
}

/** Corrupt or partial preferences fall back per field instead of throwing. */
export function normalizeNoteWorkbenchPrefs(raw: unknown): NoteWorkbenchPrefs {
  const fallback = defaultNoteWorkbenchPrefs();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const source = raw as Partial<NoteWorkbenchPrefs>;
  return {
    mode: isNoteWorkbenchMode(source.mode) ? source.mode : fallback.mode,
    previousMode: isNoteWorkbenchMode(source.previousMode) ? source.previousMode : fallback.previousMode,
    // Migrate legacy closed preferences from previousMode before the old wide-only choice.
    lastOpenMode: [source.mode, source.lastOpenMode, source.previousMode, source.wideMode]
      .find((mode): mode is Exclude<NoteWorkbenchMode, 'reading'> => isNoteWorkbenchMode(mode) && mode !== 'reading') ?? fallback.lastOpenMode,
    activeNoteId: typeof source.activeNoteId === 'string' && source.activeNoteId ? source.activeNoteId : null,
    wideMode: source.wideMode === 'writing' || source.wideMode === 'split' ? source.wideMode : fallback.wideMode,
    splitRatio: clampSplitRatio(source.splitRatio),
    floating: clampFloatingRect(source.floating),
  };
}

/** Record a user transition, not the resolved narrow-window presentation. */
export function selectNoteWorkbenchMode(current: NoteWorkbenchPrefs, mode: NoteWorkbenchMode): NoteWorkbenchPrefs {
  return {
    ...current, mode,
    previousMode: current.mode === mode ? current.previousMode : current.mode,
    lastOpenMode: mode === 'reading' ? current.lastOpenMode : mode,
    wideMode: mode === 'split' || mode === 'writing' ? mode : current.wideMode,
  };
}

/** Resolve the presentation mode for the current container width. Narrow windows
    temporarily borrow the floating card; the wide-screen preference is untouched. */
export function resolveNoteWorkbenchMode(
  prefs: NoteWorkbenchPrefs,
  available: number,
): { mode: NoteWorkbenchMode; requested: NoteWorkbenchMode; temporary: boolean } {
  const requested = prefs.mode;
  if (available > 0 && available < NOTE_WORKBENCH_NARROW_BREAKPOINT && (requested === 'split' || requested === 'writing')) {
    return { mode: 'floating', requested, temporary: true };
  }
  return { mode: requested, requested, temporary: false };
}

/** Split width in px for a container: honours the stored ratio and both minimum widths. */
export function splitWidthPx(available: number, ratio: number, minimum = NOTE_MIN_WIDTH): number {
  const safeAvailable = Number.isFinite(available) && available > 0 ? available : NOTE_WORKBENCH_WIDE_BREAKPOINT;
  const byRatio = Math.round(safeAvailable * clampSplitRatio(ratio));
  const byPdf = Math.round(safeAvailable - PDF_MIN_WIDTH);
  const upper = Math.max(minimum, Math.min(Math.round(safeAvailable * SPLIT_RATIO_MAX), byPdf));
  return Math.min(upper, Math.max(minimum, byRatio));
}

export type FloatingCardBox = { left: number; top: number; width: number; height: number };

/** Ratio geometry -> px inside the container, always fully on screen. */
export function floatingCardBox(rect: FloatingCardRect, available: number, availableHeight: number): FloatingCardBox {
  const safe = clampFloatingRect(rect);
  const width = Math.max(240, Math.round(available * safe.width));
  const height = Math.max(200, Math.round(availableHeight * safe.height));
  const maxLeft = Math.max(0, available - width);
  const maxTop = Math.max(0, availableHeight - height);
  return {
    left: Math.min(maxLeft, Math.round(available * safe.x)),
    top: Math.min(maxTop, Math.round(availableHeight * safe.y)),
    width,
    height,
  };
}

/** Remembered note id for a paper, stored next to the geometry so both survive a restart. */
export function preferredNoteIdFor(paperId: string, storage?: WorkbenchStorage | null): string | null {
  return loadNoteWorkbenchPrefs(paperId, storage).activeNoteId;
}

export function rememberPreferredNoteId(paperId: string, noteId: string | null, storage?: WorkbenchStorage | null): void {
  if (!paperId) return;
  const current = loadNoteWorkbenchPrefs(paperId, storage);
  if (current.activeNoteId === noteId) return;
  saveNoteWorkbenchPrefs(paperId, { ...current, activeNoteId: noteId }, storage);
}

export function noteWorkbenchStorageKey(paperId: string): string {
  return `a4note.reader.noteWorkbench.${paperId}`;
}

export type WorkbenchStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function workbenchStorage(storage?: WorkbenchStorage | null): WorkbenchStorage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadNoteWorkbenchPrefs(paperId: string, storage?: WorkbenchStorage | null): NoteWorkbenchPrefs {
  const store = workbenchStorage(storage);
  if (!store || !paperId) return defaultNoteWorkbenchPrefs();
  try {
    const raw = store.getItem(noteWorkbenchStorageKey(paperId));
    if (!raw) return defaultNoteWorkbenchPrefs();
    return normalizeNoteWorkbenchPrefs(JSON.parse(raw));
  } catch {
    return defaultNoteWorkbenchPrefs();
  }
}

export function saveNoteWorkbenchPrefs(paperId: string, prefs: NoteWorkbenchPrefs, storage?: WorkbenchStorage | null): void {
  const store = workbenchStorage(storage);
  if (!store || !paperId) return;
  try {
    store.setItem(noteWorkbenchStorageKey(paperId), JSON.stringify(normalizeNoteWorkbenchPrefs(prefs)));
  } catch {
    /* geometry only: a full or blocked storage must not break reading */
  }
}
