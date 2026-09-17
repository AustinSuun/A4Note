import { invoke } from '@tauri-apps/api/core';
import { TextDocumentSession, type TextDocumentSnapshot } from '../../core/textDocumentSession';
import type { NoteDocumentSession } from '../../core/noteDocumentSession';
import { acquireLibraryNoteSession, existingLibraryNoteSession } from './noteDocuments';
import type { SummaryFile } from './summaries';
export type SummaryNoteSaved = { paperId: string; noteId: string; title: string; content: string };
const listeners = new Set<(note: SummaryNoteSaved) => void>();
export function onSummaryNoteSaved(listener: (note: SummaryNoteSaved) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishSummaryNote(file: SummaryFile, paperId: string) {
  if (!file.noteId) return;
  const note = { paperId, noteId: file.noteId, title: file.title ?? '总结笔记', content: file.content };
  for (const listener of listeners) { try { listener(note); } catch (e) { console.warn('总结已保存，视图缓存更新失败', e); } }
}
const adapters = new Map<string, SummaryNoteSession>();
/** A view over the SAME note session, not another save queue or recovery draft. */
class SummaryNoteSession extends TextDocumentSession {
  private view: TextDocumentSnapshot;
  constructor(private readonly note: NoteDocumentSession, path: string) {
    super(path, note.getSnapshot().content, { write: async () => {}, draft: () => {} });
    this.view = this.snapshotView(path);
    note.subscribe(() => { this.view = this.snapshotView(path); });
  }
  private snapshotView(path: string): TextDocumentSnapshot {
    const s = this.note.getSnapshot();
    return { path, content: s.content, baseline: s.baselineContent, status: s.status === 'dirty' ? 'saving' : s.status, error: s.error };
  }
  override getSnapshot = () => this.view;
  override subscribe = (listener: () => void) => this.note.subscribe(listener);
  override update(content: string) { this.note.update(this.note.getSnapshot().title, content); }
  override dirty() { return this.note.dirty(); }
  override pending() { return this.note.pending(); }
  override flush() { return this.note.flush(); }
  override settle() { return this.note.settle(); }
  override reload(content: string) { this.note.reloadContent(content); }
  override fail(message: string) { this.note.fail(message); }
}
export function summaryNoteSession(paperId: string, file: SummaryFile): TextDocumentSession {
  if (!file.noteId) throw new Error('缺少总结笔记ID');
  const note = existingLibraryNoteSession(paperId, file.noteId) ?? acquireLibraryNoteSession(paperId, { id: file.noteId, title: file.title ?? '总结笔记', content: file.content }, async input => {
    const result = await invoke<{ id: string }>('upsert_note', { request: { paper_id: paperId, note_id: input.noteId, title: input.title, content: input.content, expected: input.expected } });
    publishSummaryNote({ ...file, noteId: result.id, title: input.title, content: input.content }, paperId);
    return result.id;
  }, '总结笔记');
  let adapter = adapters.get(file.path);
  if (!adapter) { adapter = new SummaryNoteSession(note, file.path); adapters.set(file.path, adapter); }
  return adapter;
}
