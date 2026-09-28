import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Link2, LoaderCircle, Plus, Unlink, X } from 'lucide-react';
import type { PaperDocument } from '../../core/types';
import { boardDisplayName } from '../../core/board';
import {
  BoardEditor, createBoardInWorkspace, findBoardsLinkedToPaper, linkExistingBoardToPaper, unlinkBoardFromPaperFile, useBoardWorkspaceRoot, type BoardFileSummary,
} from '../board';

const storageKey = (paperId: string) => `a4note.reader.board:${paperId}`;
export function rememberReaderBoard(paperId: string, path: string | null) {
  if (path) localStorage.setItem(storageKey(paperId), path); else localStorage.removeItem(storageKey(paperId));
}
export function preferredReaderBoard(paperId: string) {
  return localStorage.getItem(storageKey(paperId));
}
export const boardFileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

interface BoardListState {
  loading: boolean;
  linked: BoardFileSummary[];
  all: BoardFileSummary[];
  truncated: boolean;
  error: string;
}

/**
 * "白板" section of the reader's document switcher. The board file itself
 * records the paper link, so this list is a scan of the notes workspace rather
 * than a second copy of the relation.
 */
export function ReaderBoardSection({ paper, open, activePath, onSelect, disabled = false }: {
  paper: PaperDocument;
  open: boolean;
  activePath: string | null;
  onSelect: (path: string | null) => void;
  disabled?: boolean;
}) {
  const root = useBoardWorkspaceRoot();
  const [state, setState] = useState<BoardListState>({ loading: false, linked: [], all: [], truncated: false, error: '' });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!root) { setState({ loading: false, linked: [], all: [], truncated: false, error: '' }); return; }
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await findBoardsLinkedToPaper(root, paper.paperId);
      setState({ loading: false, linked: result.linked, all: result.all, truncated: result.truncated, error: '' });
    } catch (cause) {
      setState({ loading: false, linked: [], all: [], truncated: false, error: String(cause) });
    }
  }, [root, paper.paperId]);
  useEffect(() => { if (open) { setPicking(false); setError(''); void refresh(); } }, [open, refresh]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const createAndLink = () => run(async () => {
    if (!root) return;
    const created = await createBoardInWorkspace(root, {
      stem: paper.title || '未命名文献',
      links: [{ kind: 'paper', paperId: paper.paperId, title: paper.title, linkedAt: new Date().toISOString() }],
    });
    onSelect(created.path);
    await refresh();
  });
  const linkExisting = (summary: BoardFileSummary) => run(async () => {
    await linkExistingBoardToPaper(summary.path, { paperId: paper.paperId, title: paper.title });
    setPicking(false);
    onSelect(summary.path);
    await refresh();
  });
  const unlink = (summary: BoardFileSummary) => run(async () => {
    await unlinkBoardFromPaperFile(summary.path, paper.paperId);
    if (activePath === summary.path) onSelect(null);
    await refresh();
  });

  const linkedPaths = new Set(state.linked.map((summary) => summary.path));
  const candidates = state.all.filter((summary) => summary.document && !linkedPaths.has(summary.path));
  return (
    <div className="note-history-boards" data-reader-boards="true">
      <div className="note-history-heading"><strong>白板</strong><span>{state.loading ? '扫描中…' : `${state.linked.length} 个已关联`}</span></div>
      {!root ? (
        <div className="note-history-empty">先在「笔记」场景打开笔记文件夹，白板会作为独立文件保存在那里。</div>
      ) : (
        <>
          {state.linked.length ? (
            <div className="note-history-board-list">
              {state.linked.map((summary) => (
                <div key={summary.path} className={`note-history-board${activePath === summary.path ? ' active' : ''}`}>
                  <button type="button" className="note-history-board-open" onClick={() => onSelect(summary.path)} disabled={disabled || busy} title={summary.path} aria-current={activePath === summary.path ? 'true' : undefined}>
                    <LayoutDashboard size={14} aria-hidden="true" />
                    <span className="note-history-board-name">{boardDisplayName(summary.name)}</span>
                    <span className="note-history-board-meta">{summary.document?.elements.length ?? 0} 个元素</span>
                  </button>
                  <button type="button" className="note-history-board-unlink" onClick={() => void unlink(summary)} disabled={disabled || busy} title="取消关联（不删除文件）" aria-label={`取消关联 ${boardDisplayName(summary.name)}`}><Unlink size={13} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
          ) : !state.loading && <div className="note-history-empty">这篇文献还没有关联白板</div>}
          {state.truncated && <div className="note-history-empty">笔记文件夹过大，白板扫描已截断；未列出的白板可从笔记场景打开。</div>}
          <div className="note-history-actions note-history-board-actions">
            <button type="button" onClick={() => void createAndLink()} disabled={disabled || busy}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}<span>新建白板并关联</span></button>
            <button type="button" onClick={() => setPicking((current) => !current)} disabled={disabled || busy || state.loading} aria-expanded={picking}><Link2 aria-hidden="true" /><span>关联已有白板…</span></button>
          </div>
          {picking && (
            <div className="note-history-board-list picker" role="group" aria-label="可关联的白板">
              {candidates.length ? candidates.map((summary) => (
                <button key={summary.path} type="button" className="note-history-board-open" onClick={() => void linkExisting(summary)} disabled={disabled || busy} title={summary.path}>
                  <LayoutDashboard size={14} aria-hidden="true" />
                  <span className="note-history-board-name">{boardDisplayName(summary.name)}</span>
                  <span className="note-history-board-meta">{summary.document?.links.length ? `已关联 ${summary.document.links.length} 篇` : '未关联'}</span>
                </button>
              )) : <div className="note-history-empty">笔记文件夹里没有其他可关联的白板</div>}
            </div>
          )}
        </>
      )}
      {(error || state.error) && <div className="note-history-board-error" role="alert">{error || state.error}</div>}
    </div>
  );
}

/** Board surface inside the reader note panel: the same file the notes scene opens. */
export function ReaderBoardSurface({ paper, path, onBack }: { paper: PaperDocument; path: string; onBack: () => void }) {
  const name = boardFileName(path);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="reader-board-surface" data-reader-board-path={path}>
      <BoardEditor
        key={attempt}
        onRetry={() => setAttempt(value => value + 1)}
        path={path}
        name={name}
        embedded
        referenceText={`[[${name}]]`}
        headerExtra={<button type="button" className="board-text-button reader-board-back" onClick={onBack} title={`回到 ${paper.title || '文献'} 的笔记`}><X size={14} aria-hidden="true" /><span>返回笔记</span></button>}
      />
    </div>
  );
}
