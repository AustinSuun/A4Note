/* Fixture for scripts/verify-sidebar-visibility-browser.mjs (task 6f9e0947): the real
 * WorkbenchShell + WindowTitleBar with App.tsx's persisted sidebar preference wiring,
 * a workspace-mode sidebar (file tree + back-to-scenes) and recorded interactions.
 * Only uses props that existed before the fix so the same fixture runs on old code. */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft } from 'lucide-react';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
import { WorkbenchShell } from '/src/workbench/WorkbenchShell';

const calls: unknown[] = [];
(window as unknown as Record<string, unknown>).__shellCalls = calls;

function loadCollapsed() {
  try { return localStorage.getItem('aster.sidebarCollapsed') === 'true'; } catch { return false; }
}

function Host() {
  // Mirrors App.tsx: persisted preference + plain toggle.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  useEffect(() => { localStorage.setItem('aster.sidebarCollapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  (window as unknown as Record<string, unknown>).__shellHost = { workspaceOpen };

  const sidebar = (
    <aside className={workspaceOpen ? 'workbench-sidebar scene-workspace-view' : 'workbench-sidebar'} data-testid="sidebar">
      {workspaceOpen ? (
        <nav className="fixture-tree" aria-label="文件树" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {['实验/LNN点云识别.md', '实验/白板草图.board', '读书笔记/Mean Flows.md'].map((name) => (
            <button key={name} type="button" className="fixture-tree-item" style={{ textAlign: 'left', padding: '6px 8px' }} onClick={() => calls.push(['open', name])}>{name}</button>
          ))}
        </nav>
      ) : (
        <nav className="fixture-scenes" aria-label="场景" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {['研究总览', '文献', '阅读', '笔记'].map((name) => (
            <button key={name} type="button" className="fixture-scene-item" style={{ textAlign: 'left', padding: '6px 8px' }} onClick={() => { calls.push(['scene', name]); setWorkspaceOpen(true); }}>{name}</button>
          ))}
        </nav>
      )}
    </aside>
  );

  return (
    <WorkbenchShell
      sidebar={sidebar}
      topBar={<div className="fixture-topbar" style={{ padding: '0 12px' }}>白板 · 实验/白板草图.board</div>}
      content={<div className="fixture-content" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#667' }}>空白白板</div>}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => { calls.push(['toggle']); setSidebarCollapsed((current) => !current); }}
      leadingAction={workspaceOpen ? (
        <button type="button" className="window-titlebar-leading-action-button" title="返回场景" aria-label="返回场景" onClick={() => { calls.push(['back']); setWorkspaceOpen(false); }}>
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          <span>返回场景</span>
        </button>
      ) : null}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={setSidebarWidth}
    />
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
