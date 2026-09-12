import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  HardDrive,
  RefreshCw,
  Save,
  Search,
  PanelLeftClose,
  Settings,
  Smartphone,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fixtureNotes } from './data/fixtures';
import type { Note, NoteSummary, PaperSummary } from './models/note';
import { createLocalNotesRepository, type NotesRepository } from './storage/notesRepository';

type Screen = 'notes' | 'settings';
type NoteRoute = { kind: 'list' } | { kind: 'detail'; noteId: string };

const localStorageAdapter = {
  getItem: async (key: string) => window.localStorage.getItem(key),
  setItem: async (key: string, value: string) => window.localStorage.setItem(key, value),
};

const repository: NotesRepository = createLocalNotesRepository(localStorageAdapter, fixtureNotes);

export default function App() {
  const [screen, setScreen] = useState<Screen>('notes');
  const [route, setRoute] = useState<NoteRoute>({ kind: 'list' });
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const paperById = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);

  useEffect(() => {
    void refreshNotes();
  }, [query]);

  async function refreshNotes() {
    setLoading(true);
    try {
      const [nextNotes, nextPapers] = await Promise.all([
        repository.listNotes(query),
        repository.listPapers(),
      ]);
      setNotes(nextNotes);
      setPapers(nextPapers);
      setLastLoadedAt(new Date());
    } finally {
      setLoading(false);
    }
  }

  async function openNote(noteId: string) {
    const note = await repository.getNote(noteId);
    if (note) {
      setSelected(note);
      setRoute({ kind: 'detail', noteId });
    }
  }

  async function saveNote(note: Note) {
    const saved = await repository.saveNote(note);
    setSelected(saved);
    await refreshNotes();
  }

  function goToList() {
    setSelected(null);
    setRoute({ kind: 'list' });
  }

  function changeScreen(next: Screen) {
    setScreen(next);
    if (next === 'notes') goToList();
  }

  return (
    <div className="app-frame">
      <aside className="desktop-rail" aria-label="主导航">
        <div className="brand-lockup">
          <BrandIdentity />
        </div>
        <nav className="rail-nav">
          <NavItem icon={<FileText size={17} />} label="笔记" active={screen === 'notes'} onClick={() => changeScreen('notes')} />
        </nav>
        <div className="rail-footer">
          <NavItem icon={<Settings size={17} />} label="设置" active={screen === 'settings'} onClick={() => changeScreen('settings')} />
        </div>
      </aside>

      <main className="main-column">
        <header className="mobile-header">
          <BrandIdentity compact />
        </header>
        {screen === 'notes' && route.kind === 'list' ? (
          <NotesListScreen
            notes={notes}
            paperById={paperById}
            query={query}
            loading={loading}
            lastLoadedAt={lastLoadedAt}
            onQueryChange={setQuery}
            onRefresh={() => void refreshNotes()}
            onOpenNote={(noteId) => void openNote(noteId)}
          />
        ) : screen === 'notes' && route.kind === 'detail' && selected ? (
          <NoteDetailScreen
            note={selected}
            paper={selected.paperId ? paperById.get(selected.paperId) : undefined}
            onBack={goToList}
            onSave={saveNote}
          />
        ) : (
          <SettingsScreen lastLoadedAt={lastLoadedAt} />
        )}
        <BottomNav active={screen} onChange={changeScreen} />
      </main>
    </div>
  );
}

function NotesListScreen({
  notes,
  paperById,
  query,
  loading,
  lastLoadedAt,
  onQueryChange,
  onRefresh,
  onOpenNote,
}: {
  notes: NoteSummary[];
  paperById: Map<string, PaperSummary>;
  query: string;
  loading: boolean;
  lastLoadedAt: Date | null;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <div className="content-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{formatToday()}</span>
          <h1>我的笔记</h1>
        </div>
      </div>

      <div className="summary-strip" aria-label="笔记摘要">
        <div className="summary-item"><strong>{notes.length}</strong><span>篇笔记</span></div>
        <div className="summary-divider" />
        <div className="summary-item"><strong>{notes.filter((note) => note.syncState === 'pending').length}</strong><span>待同步</span></div>
        <div className="summary-divider summary-sync-divider" />
        <div className="summary-item summary-sync"><HardDrive size={15} /><span>{lastLoadedAt ? `本地读取于 ${formatTime(lastLoadedAt)}` : '等待读取'}</span></div>
      </div>

      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索笔记标题或内容" />
        {query ? <button type="button" className="clear-search" onClick={() => onQueryChange('')} aria-label="清除搜索">×</button> : null}
      </label>

      <div className="section-heading">
        <h2>最近更新</h2>
        <button className="text-button" type="button" onClick={onRefresh}><RefreshCw size={14} />刷新</button>
      </div>

      <div className="note-list" aria-live="polite">
        {loading ? <div className="loading-state"><RefreshCw size={17} className="spin" />正在加载笔记</div> : null}
        {!loading && notes.length === 0 ? <div className="empty-state"><FileText size={21} /><strong>还没有匹配的笔记</strong><span>在桌面端保存一篇笔记后，它会出现在这里。</span></div> : null}
        {!loading && notes.map((note) => {
          const paper = note.paperId ? paperById.get(note.paperId) : undefined;
          return <NoteRow key={note.id} note={note} paper={paper} onOpen={() => onOpenNote(note.id)} />;
        })}
      </div>
    </div>
  );
}

function NoteRow({ note, paper, onOpen }: { note: NoteSummary; paper?: PaperSummary; onOpen: () => void }) {
  return (
    <button className="note-row" type="button" onClick={onOpen}>
      <span className="note-type-icon"><FileText size={17} /></span>
      <span className="note-row-copy">
        <span className="note-row-title">{note.title || '未命名笔记'}</span>
        <span className="note-row-preview">{note.preview || '暂无内容'}</span>
        <span className="note-row-meta"><span>{paper?.title ?? '独立笔记'}</span><span>{formatDate(note.updatedAt)}</span></span>
      </span>
      <span className="note-row-state"><span className={`sync-state ${note.syncState}`} title={syncStateLabel(note.syncState)} /> <ChevronRight size={17} /></span>
    </button>
  );
}

function NoteDetailScreen({ note, paper, onBack, onSave }: { note: Note; paper?: PaperSummary; onBack: () => void; onSave: (note: Note) => Promise<void> }) {
  const [draft, setDraft] = useState(note);
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(note), [note]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail-shell">
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} />笔记列表</button>
        <div className="detail-actions">
          {saved ? <span className="saved-indicator"><Check size={14} />已保存</span> : null}
          <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={saving}><Save size={15} />{saving ? '保存中' : '保存'}</button>
        </div>
      </header>
      <div className="detail-content">
        <div className="detail-context"><span className="eyebrow">关联论文</span><span>{paper?.title ?? '独立笔记'}</span></div>
        <input className="note-title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="笔记标题" />
        <div className="detail-meta"><span>Markdown</span><span>更新于 {formatDate(draft.updatedAt)}</span><span className={`sync-label ${draft.syncState}`}><span className="sync-state" />{syncStateLabel(draft.syncState)}</span></div>
        <div className="mode-switch" role="tablist" aria-label="笔记视图">
          <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>阅读</button>
          <button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>编辑</button>
        </div>
        {mode === 'edit' ? (
          <textarea className="note-editor" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="写下你的阅读记录..." />
        ) : (
          <article className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content || '*暂无内容*'}</ReactMarkdown></article>
        )}
      </div>
    </div>
  );
}

function SettingsScreen({ lastLoadedAt }: { lastLoadedAt: Date | null }) {
  return (
    <div className="content-shell settings-shell">
      <span className="eyebrow">工作区</span>
      <h1>设置</h1>
      <p className="settings-intro">管理本地笔记和当前设备。</p>
      <div className="settings-list">
        <div className="settings-row"><span className="settings-icon"><HardDrive size={17} /></span><span><strong>数据状态</strong><small>笔记保存在此设备 · {lastLoadedAt ? `本地读取于 ${formatTime(lastLoadedAt)}` : '等待读取'}</small></span><span className="settings-value">本地</span></div>
        <div className="settings-row"><span className="settings-icon"><Smartphone size={17} /></span><span><strong>当前设备</strong><small>移动端 PWA</small></span><span className="settings-value">已就绪</span></div>
        <div className="settings-row"><span className="settings-icon"><FileText size={17} /></span><span><strong>功能范围</strong><small>笔记查看与编辑</small></span><span className="settings-value">v0.1</span></div>
      </div>
      <div className="scope-note"><strong>本地数据</strong><span>笔记会保存在此设备的浏览器中。</span></div>
    </div>
  );
}

function BrandIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-identity ${compact ? 'compact' : ''}`} role="img" aria-label="A4Note">
      <PanelLeftClose size={compact ? 17 : 18} strokeWidth={1.8} aria-hidden="true" />
      <span className="brand-name"><span className="brand-name-accent">A4</span><span className="brand-name-note">Note</span></span>
    </span>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`rail-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function BottomNav({ active, onChange }: { active: Screen; onChange: (screen: Screen) => void }) {
  return <nav className="bottom-nav"><NavItem icon={<FileText size={17} />} label="笔记" active={active === 'notes'} onClick={() => onChange('notes')} /><NavItem icon={<Settings size={17} />} label="设置" active={active === 'settings'} onClick={() => onChange('settings')} /></nav>;
}

function syncStateLabel(state: Note['syncState']) {
  return { synced: '已同步', pending: '待同步', conflict: '有冲突', failed: '同步失败' }[state];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatToday() {
  const parts = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date());
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  return `${month}月${day}日${weekday}`;
}
