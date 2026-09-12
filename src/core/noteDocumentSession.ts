/** One fixed paper/note identity. Autosave, blur, close and Ctrl+S share one drain. */
export interface NoteWrite { noteId: string; title: string; content: string; expected?: { title: string; content: string } }
export interface NoteSnapshot {
  paperId: string; noteId: string; title: string; content: string;
  baselineTitle: string; baselineContent: string;
  status: 'saved' | 'dirty' | 'saving' | 'error'; error: string;
}
export type NoteWriter = (note: NoteWrite) => void | Promise<string | void>;
export class NoteDocumentSession {
  private snapshot: NoteSnapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private write: NoteWriter;
  private draft: (snapshot: NoteSnapshot) => void;
  constructor(paperId: string, noteId: string, title: string, content: string,
    write: NoteWriter, draft: (snapshot: NoteSnapshot) => void) {
    this.write = write; this.draft = draft;
    this.snapshot = { paperId, noteId, title, content, baselineTitle: title, baselineContent: content, status: 'saved', error: '' };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setWriter(write: NoteWriter) { this.write = write; }
  private emit(next: Partial<NoteSnapshot>) { this.snapshot = { ...this.snapshot, ...next }; this.listeners.forEach((listener) => listener()); }
  dirty() { return this.snapshot.title !== this.snapshot.baselineTitle || this.snapshot.content !== this.snapshot.baselineContent; }
  update(title: string, content: string) {
    if (title === this.snapshot.title && content === this.snapshot.content) return;
    this.emit({ title, content, status: title === this.snapshot.baselineTitle && content === this.snapshot.baselineContent ? 'saved' : 'dirty', error: '' });
    try { this.draft(this.snapshot); } catch { this.emit({ error: '本地草稿缓存不可用，请保持窗口打开直到保存成功。' }); }
  }
  recover(draft: Pick<NoteSnapshot, 'title' | 'content' | 'baselineTitle' | 'baselineContent'>) {
    if (draft.title === this.snapshot.title && draft.content === this.snapshot.content) return;
    this.emit({ ...draft, status: 'error', error: '已恢复未保存的草稿。请检查后重试保存；若原笔记已修改，系统会拒绝覆盖。' });
  }
  reloadClean(title: string, content: string) {
    if (!this.dirty() && !this.running) this.emit({ title, content, baselineTitle: title, baselineContent: content, status: 'saved', error: '' });
  }
  async discard() {
    const before = this.snapshot;
    try { await this.running; } catch { /* User explicitly chose to discard the failed draft. */ }
    if (this.snapshot.title !== before.title || this.snapshot.content !== before.content) throw new Error('等待期间产生了新编辑，未放弃草稿，请检查后重试。');
    this.emit({ title: this.snapshot.baselineTitle, content: this.snapshot.baselineContent, status: 'saved', error: '' });
    try { this.draft(this.snapshot); } catch { this.emit({ error: '草稿缓存清理失败，重启后可能仍会提示恢复，请保留导出的副本。' }); }
  }
  pending() { return this.dirty() || this.running !== null; }
  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.dirty()) return;
    // Schedule drain after assigning running, including writers that resolve synchronously.
    this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    try {
      while (this.dirty()) {
        const { noteId, title, content, baselineTitle, baselineContent } = this.snapshot;
        this.emit({ status: 'saving', error: '' });
        const savedId = await this.write({ noteId, title, content, expected: { title: baselineTitle, content: baselineContent } });
        if (savedId && savedId !== noteId) throw new Error('保存返回了不同的笔记ID，草稿已保留，请重试或导出。');
        this.emit({ baselineTitle: title, baselineContent: content, status: this.snapshot.title === title && this.snapshot.content === content ? 'saved' : 'dirty' });
        try { this.draft(this.snapshot); } catch { /* DB write succeeded; keep any older recovery draft. */ }
      }
    } catch (error) { this.emit({ status: 'error', error: String(error) }); throw error; }
  }
}
