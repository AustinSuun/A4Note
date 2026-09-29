import { useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/base.css';
import '/src/ui/styles/workbench.css';

// Fixture for scripts/verify-scene-edge-switcher-browser.mjs. The switcher is
// loaded through a glob so this page also renders on code without it, and the
// regression fails on behaviour instead of on a missing import.
const modules = import.meta.glob('/src/workbench/SceneEdgeSwitcher.tsx', { eager: true }) as Record<string, { SceneEdgeSwitcher?: ComponentType<any> }>;
const SceneEdgeSwitcher = Object.values(modules)[0]?.SceneEdgeSwitcher;

const icon = <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
const scenes = [
  { id: 'overview', label: '研究总览', hint: '研究总览', icon, scope: 'research' },
  { id: 'library', label: '文献', icon, scope: 'research' },
  { id: 'reader', label: '阅读', icon, scope: 'research' },
  { id: 'markdown', label: '笔记', icon, scope: 'workspace' },
  { id: 'plugin.demo', label: '插件场景演示', icon, scope: 'custom' },
];

declare global { interface Window { __opened: string[]; __contentClicks: number } }
window.__opened = [];
window.__contentClicks = 0;

function Host() {
  const [active, setActive] = useState('overview');
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div className="window-titlebar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 40 }} />
      <div className="workbench-shell" style={{ position: 'fixed', top: 40, left: 0, right: 0, bottom: 0, display: 'flex' }}>
        <aside className="workbench-sidebar" style={{ width: 240, position: 'relative' }}>
          <div className="file-tree-row" draggable data-testid="row" style={{ margin: '20px 0 0 16px', height: 28, lineHeight: '28px' }}>拖动我.md</div>
          <div className="workbench-sidebar-resizer" data-testid="resizer" style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'ew-resize' }} />
        </aside>
        <main style={{ flex: 1, position: 'relative' }}>
          <p data-testid="active">{active}</p>
          <button type="button" data-testid="content-button" style={{ position: 'absolute', left: 520, top: 220 }} onClick={() => { window.__contentClicks += 1; }}>内容区按钮</button>
        </main>
      </div>
      <button type="button" className="reader-note-edge-handle" data-testid="reader-edge" style={{ position: 'fixed', left: 0, top: 640, width: 18, height: 80 }}>笔记</button>
      {SceneEdgeSwitcher && (
        <SceneEdgeSwitcher scenes={scenes} activeSceneId={active} onOpenScene={(id: string) => { window.__opened.push(id); setActive(id); }} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Host />);
