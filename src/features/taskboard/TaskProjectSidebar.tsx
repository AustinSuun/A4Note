import { useState, useMemo, type KeyboardEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ManagedProject } from '../../platform/projectTasksPreference';

export interface TaskProjectSidebarProps {
  projects: ManagedProject[];
  activeProjectId: string | null;
  connectedProjectId: string | null;
  sidebarOpen: boolean;
  isConnecting?: boolean;
  onToggleSidebar: () => void;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onRequestRemoveProject: (project: ManagedProject) => void;
}

export function TaskProjectSidebar({
  projects,
  activeProjectId,
  connectedProjectId,
  sidebarOpen,
  isConnecting,
  onToggleSidebar,
  onSelectProject,
  onAddProject,
  onCreateProject,
  onRenameProject,
  onRequestRemoveProject,
}: TaskProjectSidebarProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Identify duplicate project display names so we can display distinguishing path details
  const duplicateNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const lower = p.name.toLowerCase();
      counts.set(lower, (counts.get(lower) ?? 0) + 1);
    }
    const set = new Set<string>();
    for (const [name, count] of counts.entries()) {
      if (count > 1) set.add(name);
    }
    return set;
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q),
    );
  }, [projects, search]);

  const startEditing = (p: ManagedProject) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const commitEditing = (id: string) => {
    if (editingName.trim()) {
      onRenameProject(id, editingName.trim());
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      commitEditing(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside className="tb-project-sidebar" aria-label="项目列表">
      <div className="tb-sidebar-header">
        <div className="tb-sidebar-title-row">
          <span className="tb-sidebar-title">项目列表</span>
          <button
            type="button"
            className="tb-sidebar-mini-button"
            disabled={isConnecting}
            onClick={onAddProject}
            title="打开已有项目文件夹"
            aria-label="打开已有项目文件夹"
          >
            <FolderOpen size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tb-sidebar-collapse-btn"
            onClick={onToggleSidebar}
            title="收起项目列表"
            aria-label="收起项目列表"
          >
            «
          </button>
        </div>
        {projects.length >= 2 && (
          <div className="tb-sidebar-search-box">
            <input
              type="search"
              className="tb-sidebar-search-input"
              placeholder="搜索项目或路径…"
              aria-label="搜索项目或路径"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="tb-sidebar-project-list" role="list">
        {filteredProjects.length === 0 ? (
          <div className="tb-sidebar-empty">
            {search.trim() ? '无匹配项目' : '暂无项目'}
          </div>
        ) : (
          filteredProjects.map((p) => {
            const isActive = p.id === activeProjectId;
            const isConnected = p.id === connectedProjectId;
            const hasDuplicateName = duplicateNameSet.has(p.name.toLowerCase());
            const isEditing = editingId === p.id;

            return (
              <div
                key={p.id}
                role="listitem"
                tabIndex={isConnecting ? -1 : 0}
                aria-current={isActive ? 'true' : undefined}
                onKeyDown={e => { if (e.target === e.currentTarget && !isConnecting && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectProject(p.id); } }}
                className={`tb-project-item ${isActive ? 'active' : ''} ${
                  isConnected ? 'connected' : ''
                }`}
                onClick={() => { if (!isConnecting) onSelectProject(p.id); }}
              >
                <div className="tb-project-item-main">
                  <div className="tb-project-status-dot-wrap">
                    <span
                      className={`tb-project-dot ${
                        isConnected
                          ? 'online'
                          : isActive && isConnecting
                          ? 'connecting'
                          : 'idle'
                      }`}
                      title={
                        isConnected
                          ? '服务已连接'
                          : isActive && isConnecting
                          ? '正在连接服务'
                          : '未连接'
                      }
                    />
                  </div>

                  <div className="tb-project-info">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="tb-project-rename-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => commitEditing(p.id)}
                        onKeyDown={(e) => handleEditKeyDown(e, p.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="tb-project-name-wrap">
                        <span
                          className="tb-project-name-text"
                          title={`${p.name}\n${p.path}`}
                        >
                          {p.name}
                        </span>
                      </div>
                    )}

                    <div
                      className={`tb-project-path-text ${
                        hasDuplicateName ? 'distinguish' : ''
                      }`}
                      title={p.path}
                    >
                      {p.path}
                    </div>
                  </div>
                </div>

                <div
                  className="tb-project-item-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="tb-project-action-btn"
                    title="重命名项目"
                    aria-label={`重命名项目 ${p.name}`}
                    onClick={() => startEditing(p)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="tb-project-action-btn tb-remove-btn"
                    title="从列表移除"
                    aria-label={`从列表移除 ${p.name}`}
                    onClick={() => onRequestRemoveProject(p)}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="tb-sidebar-footer">
        <button type="button" className="tb-add-project-btn" disabled={isConnecting} onClick={onCreateProject}>＋ 新建项目</button>
      </div>
    </aside>
  );
}
