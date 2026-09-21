import { useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import './task-shell-sidebar.css';

// A scene-owned portal: TaskBoard keeps connection, draft guards and handlers.
// One host per renderer window. No credentials or project data are stored here.
let host: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => host;
const serverSnapshot = () => null;
const publish = (node: HTMLDivElement | null) => { if (host !== node) { host = node; listeners.forEach(listener => listener()); } };
export function TaskShellSidebarHost() {
  const ownNode = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node) publish(node);
    else if (host === ownNode.current) publish(null);
    ownNode.current = node;
  }, []);
  return <div className="tb-shell-sidebar-host" ref={attach} />;
}
export function TaskShellSidebar({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const active = useDocumentToolbarActive();
  return active && target ? createPortal(children, target) : null;
}
