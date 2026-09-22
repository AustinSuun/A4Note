import { bindingsForCommand, parseShortcutOverrides, serializeShortcutOverrides, type ShortcutCommand, type ShortcutContext, type ShortcutOverrides } from '../../core/shortcuts';

export const SHORTCUT_STORAGE_KEY = 'a4note.shortcuts.v1';
export const emptyShortcutContext: ShortcutContext = { activeSceneId: '', editable: false, composing: false, altGraph: false, modalOpen: false, recording: false };

/** Owned by a provider (no global app state), with stable subscription snapshots. */
export class ShortcutStore {
  private owners = new Map<string, ShortcutCommand[]>();
  private listeners = new Set<() => void>();
  private revision = 0;
  context = { ...emptyShortcutContext };
  overrides: ShortcutOverrides;
  recording = false;
  hintVisible = false;
  error = '';
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    let raw: string | null = null;
    try { raw = storage?.getItem(SHORTCUT_STORAGE_KEY) ?? null; } catch { /* unavailable storage uses defaults */ }
    this.overrides = parseShortcutOverrides(raw);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  emit() { this.revision += 1; this.listeners.forEach((fn) => fn()); }
  commands() { return [...this.owners.values()].flat(); }
  register(owner: string, commands: ShortcutCommand[]) {
    this.owners.set(owner, commands); this.emit();
    return () => { if (this.owners.get(owner) === commands) { this.owners.delete(owner); this.emit(); } };
  }
  setContext(activeSceneId: string, modalOpen: boolean) {
    if (this.context.activeSceneId === activeSceneId && this.context.modalOpen === modalOpen) return;
    this.context = { ...this.context, activeSceneId, modalOpen }; this.setHint(false); this.emit();
  }
  setHint(value: boolean) { if (this.hintVisible !== value) { this.hintVisible = value; this.emit(); } }
  setRecording(value: boolean) { if (this.recording !== value) { this.recording = value; this.setHint(false); this.emit(); } }
  save(overrides: ShortcutOverrides) {
    try {
      if (!this.storage) throw new Error('storage unavailable');
      this.storage.setItem(SHORTCUT_STORAGE_KEY, serializeShortcutOverrides(overrides));
    }
    catch { this.error = '无法保存快捷键：存储不可用。原配置未改变，请重试。'; this.emit(); return false; }
    this.overrides = overrides; this.error = ''; this.emit(); return true;
  }
  bindings(id: string) {
    const commands = this.commands();
    const command = commands.find((c) => c.id === id && (c.isVisible?.(this.context) ?? true)) ?? commands.find((c) => c.id === id);
    return command ? bindingsForCommand(command, this.overrides) : [];
  }
}
