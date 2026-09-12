export interface TextDocumentSnapshot {
  path: string;
  content: string;
  baseline: string;
  status: 'saved' | 'saving' | 'error';
  error: string;
}
export interface TextDocumentAdapter {
  write(path: string, content: string, expected: string): Promise<void>;
  draft(snapshot: TextDocumentSnapshot): void;
}

/** One shared session per file. Changes during a write are drained in order. */
export class TextDocumentSession {
  private snapshot: TextDocumentSnapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private paused = false;
  private adapter: TextDocumentAdapter;
  constructor(path: string, baseline: string, adapter: TextDocumentAdapter, draft?: string) {
    this.adapter = adapter;
    this.snapshot = { path, baseline, content: draft ?? baseline, status: draft !== undefined && draft !== baseline ? 'saving' : 'saved', error: '' };
  }
  setWriter(write: TextDocumentAdapter['write']) { this.adapter = { ...this.adapter, write }; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(next: Partial<TextDocumentSnapshot>) { this.snapshot = { ...this.snapshot, ...next }; this.listeners.forEach((listener) => listener()); }
  update(content: string) {
    if (content === this.snapshot.content) return;
    this.emit({ content, status: content === this.snapshot.baseline ? 'saved' : 'saving', error: '' });
    try { this.adapter.draft(this.snapshot); } catch { this.emit({ error: '本地草稿缓存不可用，请保持窗口打开直到保存成功。' }); }
  }
  dirty() { return this.snapshot.content !== this.snapshot.baseline; }
  pending() { return this.dirty() || this.running !== null; }
  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.paused || !this.dirty()) return;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    try {
      while (this.dirty()) {
        const { path, content, baseline } = this.snapshot;
        this.emit({ status: 'saving', error: '' });
        await this.adapter.write(path, content, baseline);
        this.emit({ baseline: content, status: this.snapshot.content === content ? 'saved' : 'saving' });
        try { this.adapter.draft(this.snapshot); } catch { /* disk save succeeded; retain any older recovery draft */ }
      }
    } catch (error) {
      this.emit({ status: 'error', error: String(error) });
      throw error;
    }
  }
  async pause() { this.paused = true; try { if (this.running) await this.running; else await this.drain(); } catch (error) { this.paused = false; throw error; } }
  resume(path = this.snapshot.path) { this.emit({ path }); this.paused = false; }
  async settle() { try { await this.running; } catch { /* caller explicitly chose disk reload */ } }
  reload(content: string) { this.emit({ content, baseline: content, status: 'saved', error: '' }); this.adapter.draft(this.snapshot); }
  fail(message: string) { this.emit({ status: 'error', error: message }); }
}
