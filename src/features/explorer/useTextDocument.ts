import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireTextDocument, reloadTextDocument } from '../../platform/projects';
import type { TextDocumentSession, TextDocumentSnapshot } from '../../core/textDocumentSession';

export function useTextDocument(path: string) {
  const sessionRef = useRef<TextDocumentSession | null>(null);
  const documentIdRef = useRef(0);
  const [state, setState] = useState<{ path: string; snapshot?: TextDocumentSnapshot; error?: string }>({ path });
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let owned: TextDocumentSession | undefined;
    const attach = (session: TextDocumentSession) => {
      if (disposed) return;
      owned = session;
      if (sessionRef.current !== session) documentIdRef.current += 1;
      sessionRef.current = session;
      const update = () => setState({ path, snapshot: session.getSnapshot() });
      unsubscribe = session.subscribe(update); update();
    };
    const retained = sessionRef.current;
    // Only reuse a session whose path was already migrated by the file API.
    // A genuinely different file still goes through acquire and disk checks.
    if (retained?.getSnapshot().path === path) {
      attach(retained);
    } else {
      sessionRef.current = null;
      setState({ path });
      void acquireTextDocument(path).then(attach)
        .catch((error) => { if (!disposed) setState({ path, error: String(error) }); });
    }
    return () => { disposed = true; unsubscribe?.(); if (owned?.getSnapshot().status !== 'error') void owned?.flush().catch(() => { /* persisted draft survives tab close */ }); };
  }, [path]);
  // Render the migrated session immediately, before the path effect runs, so
  // rename never inserts a loading frame or unmounts the editor subtree.
  const retainedSnapshot = sessionRef.current?.getSnapshot();
  const snapshot = state.path === path ? state.snapshot
    : retainedSnapshot?.path === path ? retainedSnapshot : undefined;
  const error = state.path === path ? state.error ?? '' : '';
  useEffect(() => {
    if (!snapshot || snapshot.status !== 'saving') return;
    const timer = window.setTimeout(() => { void sessionRef.current?.flush().catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  const setContent = useCallback((next: string | ((current: string) => string)) => {
    const session = sessionRef.current;
    if (session) session.update(typeof next === 'function' ? next(session.getSnapshot().content) : next);
  }, []);
  const save = useCallback(() => { void sessionRef.current?.flush().catch(() => {}); }, []);
  const reload = useCallback(async () => {
    if (!sessionRef.current) return;
    try { await reloadTextDocument(sessionRef.current); } catch (error) { sessionRef.current.fail(String(error)); }
  }, []);
  return { documentId: documentIdRef.current, content: snapshot?.content ?? '', setContent, loading: !snapshot && !error, error, saveState: snapshot?.status ?? 'saved', saveError: snapshot?.error ?? '', save, reload };
}
