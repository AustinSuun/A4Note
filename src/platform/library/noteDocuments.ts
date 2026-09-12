import { NoteDocumentSession, type NoteSnapshot, type NoteWriter } from '../../core/noteDocumentSession';
import { registerPendingSave } from '../pendingSaves';
const sessions = new Map<string, NoteDocumentSession>();
const emptyIds = new Map<string, string>();
const key = (paper: string, note: string) => `a4note.library-note.draft:${encodeURIComponent(paper)}:${encodeURIComponent(note)}`;
const emptyKey = (paper: string) => `a4note.library-note.empty:${encodeURIComponent(paper)}`;
export function acquireLibraryNoteSession(paperId: string, note: { id: string; title: string; content: string } | undefined, write: NoteWriter, defaultTitle: string) {
  let noteId = note?.id;
  if (!noteId) {
    noteId = emptyIds.get(paperId);
    if (!noteId) {
      try { const cached = localStorage.getItem(emptyKey(paperId)); if (cached?.startsWith('note-')) noteId = cached; } catch { /* in-memory fallback */ }
      noteId ??= `note-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
      emptyIds.set(paperId, noteId);
    }
  }
  const sessionKey = key(paperId, noteId);
  const existing = sessions.get(sessionKey);
  if (existing) {
    existing.setWriter(write);
    if (note) existing.reloadClean(note.title, note.content);
    return existing;
  }
  const persist = (snapshot: NoteSnapshot) => {
    if (snapshot.title === snapshot.baselineTitle && snapshot.content === snapshot.baselineContent) {
      if (emptyIds.get(paperId) === snapshot.noteId) emptyIds.delete(paperId);
      localStorage.removeItem(sessionKey);
      if (localStorage.getItem(emptyKey(paperId)) === noteId) localStorage.removeItem(emptyKey(paperId));
    } else {
      localStorage.setItem(sessionKey, JSON.stringify(snapshot));
      if (!note) localStorage.setItem(emptyKey(paperId), snapshot.noteId);
    }
  };
  const session = new NoteDocumentSession(paperId, noteId, note?.title ?? defaultTitle, note?.content ?? '', write, persist);
  try {
    const draft = JSON.parse(localStorage.getItem(sessionKey) ?? 'null');
    if (draft?.paperId === paperId && draft?.noteId === noteId && ['title', 'content', 'baselineTitle', 'baselineContent'].every((field) => typeof draft[field] === 'string')) session.recover(draft);
  } catch { /* recovery cache is best effort; no automatic overwrite */ }
  sessions.set(sessionKey, session); registerPendingSave(session); return session;
}
