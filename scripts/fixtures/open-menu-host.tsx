/* Fixture for scripts/verify-open-menu-browser.mjs (task bcabb18d): the real
 * WorkbenchTopBar driven by an App.tsx-like active-tab model, with the real
 * platform calls (revealPath / openPathInVSCode / revealPaperFile) hitting a
 * recording Tauri IPC mock.
 *
 * Runs on old code too: the new modules are loaded through import.meta.glob (an
 * empty object when they do not exist) and the pre-fix props (canBrowseFolder /
 * onRevealFolder → project root) are passed alongside the new ones, so the old
 * build renders and fails on behaviour, not on a missing import. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
import { WorkbenchTopBar } from '/src/workbench/WorkbenchTopBar';
import { openPathInVSCode, revealPath } from '/src/platform/projects';

type Json = Record<string, unknown>;
const ipc: { cmd: string; args: unknown }[] = [];
const w = window as unknown as Json;
w.__ipc = ipc;
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args?: unknown) => { ipc.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) }); return null; },
  transformCallback: () => 0,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const targetApi = Object.values(import.meta.glob('/src/workbench/openMenuTarget.ts', { eager: true }))[0] as Any;
const actionsApi = Object.values(import.meta.glob('/src/ui/openMenuActions.ts', { eager: true }))[0] as Any;
w.__openMenuModules = { target: Boolean(targetApi), actions: Boolean(actionsApi) };

const ROOT = 'D:\\Fixture\\研究笔记';
const READER_PAPER_TAB_PREFIX = 'tool:reader:paper:';
interface FixtureTab { id: string; kind: string; key: string; title: string; state?: Json }
const TABS: Record<string, FixtureTab> = {
  overview: { id: 'overview', kind: 'tool', key: 'tool:overview', title: '总览' },
  library: { id: 'library', kind: 'tool', key: 'tool:library', title: '文献库' },
  notes: { id: 'notes', kind: 'tool', key: 'tool:markdown', title: '笔记' },
  md: { id: 'md', kind: 'file', key: 'file:md', title: '读书笔记.md', state: { path: `${ROOT}\\notes\\读书笔记.md` } },
  board: { id: 'board', kind: 'file', key: 'file:board', title: '未命名白板', state: { path: `${ROOT}\\未命名白板.a4board` } },
  html: { id: 'html', kind: 'file', key: 'file:html', title: 'page.html', state: { path: `${ROOT}\\page.html` } },
  image: { id: 'image', kind: 'file', key: 'file:image', title: 'plot.png', state: { path: `${ROOT}\\figs\\plot.png` } },
  pdf: { id: 'pdf', kind: 'file', key: 'file:pdf', title: '1301.3781.pdf', state: { path: `${ROOT}\\papers\\1301.3781.pdf` } },
  deep: { id: 'deep', kind: 'file', key: 'file:deep', title: '深层笔记', state: { path: `${ROOT}\\资料 目录\\第一层 很长的目录名称\\第二层 很长的目录名称\\第三层\\一个相当长的笔记文件名称用于测试.md` } },
  nopath: { id: 'nopath', kind: 'file', key: 'file:nopath', title: '未保存.md', state: {} },
  paper: { id: 'paper', kind: 'tool', key: `${READER_PAPER_TAB_PREFIX}paper-guide`, title: '使用指南' },
};
const PAPERS: Record<string, Json> = {
  'paper-guide': { paperId: 'paper-guide', title: 'A4 Note 使用指南', sourcePdf: 'C:\\Users\\me\\AppData\\Roaming\\aster\\library\\papers\\guide.pdf', sourceFileId: 'file-guide' },
};
const SCENE_OF: Record<string, string> = { md: 'notes', board: 'notes', html: 'notes', image: 'notes', pdf: 'notes', deep: 'notes', nopath: 'notes', paper: 'library' };

function Host() {
  const [activeId, setActiveId] = useState<string | null>('overview');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const open = (id: string) => {
    if (SCENE_OF[id]) setOpenFiles((current) => current.includes(id) ? current : [...current, id]);
    setActiveId(id);
  };
  // Mirrors App.closeWorkspaceTab: closing the active file falls back to the owning scene's tool tab.
  const closeActive = () => {
    if (!activeId || !SCENE_OF[activeId]) return;
    const rest = openFiles.filter((id) => id !== activeId);
    setOpenFiles(rest);
    setActiveId(rest[rest.length - 1] ?? SCENE_OF[activeId]);
  };
  w.__fixture = { activeId, openFiles, sidebarCollapsed };

  const tab = activeId ? TABS[activeId] : null;
  let openTarget: unknown;
  if (targetApi) {
    const paperId = tab?.kind === 'tool' && tab.key.startsWith(READER_PAPER_TAB_PREFIX) ? tab.key.slice(READER_PAPER_TAB_PREFIX.length) : null;
    const resolution = targetApi.resolveOpenMenuTarget(
      targetApi.openMenuSourceFromTab(tab, { paperId, paper: paperId ? PAPERS[paperId] ?? null : null }),
      { projectRoot: ROOT },
    );
    openTarget = resolution.visible ? resolution.target : null;
  }

  const topBarProps: Any = {
    labels: {}, project: null, workspace: null, workspaces: [], fileTreeVisible: !sidebarCollapsed, providers: [],
    onToggleFileTree() {}, onCreateAgentSession() {}, onActivateWorkspace() {}, onCreateWorkspace() {}, onRemoveWorkspace() {},
    workspaceBreadcrumb: <span className="fixture-crumb">{tab?.title ?? '（无标签）'}</span>,
    // Pre-fix App.tsx wiring: the menu acted on the folder project.
    canBrowseFolder: true,
    onRevealFolder: () => void revealPath(ROOT),
    onOpenInVSCode: (path?: unknown) => void openPathInVSCode(typeof path === 'string' ? path : ROOT),
    // Post-fix wiring (same as App.tsx).
    openTarget,
    onRevealOpenTarget: (target: unknown) => void actionsApi?.revealOpenMenuTarget(target),
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: sidebarCollapsed ? '0 1fr' : '240px 1fr', height: '100%' }}>
      <aside data-testid="sidebar" style={{ overflow: 'hidden', borderRight: '1px solid #dde3dd', padding: sidebarCollapsed ? 0 : 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.values(TABS).map((item) => (
          <button key={item.id} type="button" className="fixture-open" data-open={item.id} onClick={() => open(item.id)} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: item.id === activeId ? 700 : 400 }}>{item.title}</button>
        ))}
        <button type="button" className="fixture-close" onClick={closeActive}>关闭当前文件标签</button>
        <button type="button" className="fixture-none" onClick={() => { setOpenFiles([]); setActiveId(null); }}>无标签</button>
        <small>已打开：{openFiles.join(', ') || '—'}</small>
      </aside>
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderBottom: '1px solid #dde3dd' }}>
          <button type="button" className="fixture-sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? '展开侧栏' : '收起侧栏'}</button>
          <div style={{ flex: 1, minWidth: 0 }}><WorkbenchTopBar {...topBarProps} /></div>
        </div>
        <section style={{ padding: 24, color: '#5b675f' }}>当前：{tab ? `${tab.title}（${tab.kind}）` : '无标签'}</section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
