import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ariaKeyShortcut, formatBinding, type ShortcutCommand } from '../../core/shortcuts';
import { attachShortcutDispatcher } from './dispatcher';
import { ShortcutStore } from './store';
import { ShortcutHints } from './ShortcutHints';
import './shortcuts.css';

const Context = createContext<ShortcutStore | null>(null);
const standalone = new ShortcutStore();
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    try { return new ShortcutStore(window.localStorage); } catch { return new ShortcutStore(); }
  });
  useEffect(() => attachShortcutDispatcher(store), [store]);
  return <Context.Provider value={store}>{children}<ShortcutHints store={store} /></Context.Provider>;
}
export function useShortcuts() {
  const store = useContext(Context) ?? standalone;
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return store;
}
export function useShortcutContext(activeSceneId: string, modalOpen: boolean) {
  const store = useContext(Context) ?? standalone;
  useLayoutEffect(() => { store.setContext(activeSceneId, modalOpen); }, [store, activeSceneId, modalOpen]);
}
/** Callback refs are live; registration is stable across ordinary React renders.
 * Multiple kept-alive Reader tabs register independently and expose only their visible root. */
export function useShortcutCommands(commands: ShortcutCommand[]) {
  const store = useContext(Context) ?? standalone;
  const owner = useId(), latest = useRef(commands); latest.current = commands;
  const signature = JSON.stringify(commands.map(({ isVisible: _v, isEnabled: _e, execute: _r, ...metadata }) => metadata));
  useLayoutEffect(() => {
    const entries = latest.current.map((command) => ({ ...command,
      isVisible: (ctx: Parameters<NonNullable<ShortcutCommand['isVisible']>>[0]) => latest.current.find((c) => c.id === command.id)?.isVisible?.(ctx) ?? true,
      isEnabled: (ctx: Parameters<NonNullable<ShortcutCommand['isEnabled']>>[0]) => latest.current.find((c) => c.id === command.id)?.isEnabled?.(ctx) ?? true,
      execute: () => latest.current.find((c) => c.id === command.id)?.execute?.() ?? undefined,
    }));
    return store.register(owner, entries);
  }, [store, owner, signature]);
}
export function useShortcutProps() {
  const store = useShortcuts();
  return (id: string, title: string) => {
    const bindings = store.bindings(id);
    const text = bindings.map(formatBinding).join(' / ');
    const aria = bindings.map(ariaKeyShortcut).filter(Boolean).join(' ');
    return { 'data-shortcut-id': id, title: text ? `${title} · ${text}` : title, 'aria-keyshortcuts': aria || undefined };
  };
}
