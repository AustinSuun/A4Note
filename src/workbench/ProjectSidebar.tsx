import { Check, FolderPlus, ListFilter, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentSession, Project, Workspace } from '../core/workspace';
import type { WorkbenchLabels } from './workbenchLabels';

export interface SidebarSceneItem {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  scope?: 'research' | 'workspace' | 'custom';
  source?: string;
}

export interface SidebarOpenItem {
  id: string;
  sceneId: string;
  title: string;
  hint?: string;
  icon?: ReactNode;
}

export interface ProjectSidebarProps {
  labels: WorkbenchLabels;
  projects: Project[];
  workspaces: Workspace[];
  sessions: AgentSession[];
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  scenes: SidebarSceneItem[];
  selectedSceneIds: string[];
  activeSceneId: string | null;
  activeOpenItemId: string | null;
  openItems: SidebarOpenItem[];
  addProjectPending?: boolean;
  settingsActive?: boolean;
  commandIcon?: ReactNode;
  settingsIcon?: ReactNode;
  onOpenScene: (sceneId: string) => void;
  onToggleScene: (sceneId: string) => void;
  onSelectAllScenes: () => void;
  onSelectOpenItem: (itemId: string) => void;
  onCloseOpenItem: (itemId: string) => void;
  onAddProject: () => void;
  onActivateWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (projectId: string) => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void;
  onRemoveProject: (projectId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  /** A scene-owned contextual sidebar panel, when the active scene contributes one. */
  contextualSidebar?: ReactNode;
  contextualSidebarLabel?: string;
  /** When true, the scene-owned sidebar occupies the whole navigation column. */
  sidebarWorkspaceOpen?: boolean;
}

/**
 * The sidebar is the workbench navigator. Scene selection normally changes
 * which entries are shown; a scene may instead promote its own contribution
 * into a full workspace view without closing an open document or conversation.
 */
export function ProjectSidebar({
  labels,
  projects,
  workspaces,
  sessions,
  activeProjectId,
  activeWorkspaceId,
  scenes,
  selectedSceneIds,
  activeSceneId,
  activeOpenItemId,
  openItems,
  addProjectPending = false,
  settingsActive = false,
  commandIcon,
  settingsIcon,
  onOpenScene,
  onToggleScene,
  onSelectAllScenes,
  onSelectOpenItem,
  onCloseOpenItem,
  onAddProject,
  onActivateWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onRemoveProject,
  onRemoveWorkspace,
  onOpenCommandPalette,
  onOpenSettings,
  contextualSidebar,
  contextualSidebarLabel,
  sidebarWorkspaceOpen = false,
}: ProjectSidebarProps) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const scenePickerRef = useRef<HTMLDivElement>(null);
  const selectedSceneSet = new Set(selectedSceneIds);
  const visibleScenes = scenes.filter((scene) => selectedSceneSet.has(scene.id));
  const allScenesSelected = scenes.length > 0 && visibleScenes.length === scenes.length;
  const pickerLabel = allScenesSelected ? labels.allScenes : labels.selectedScenes(visibleScenes.length);
  const sceneGroups = [
    { id: 'research', label: '科研阅读', items: scenes.filter((scene) => scene.scope === 'research') },
    { id: 'workspace', label: '工作区', items: scenes.filter((scene) => scene.scope === 'workspace') },
    { id: 'custom', label: '插件场景', items: scenes.filter((scene) => scene.scope !== 'research' && scene.scope !== 'workspace') },
  ].filter((group) => group.items.length > 0);
  const workspaceSidebarVisible = sidebarWorkspaceOpen;

  useEffect(() => {
    if (!scenePickerOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!scenePickerRef.current?.contains(event.target as Node)) setScenePickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [scenePickerOpen]);

  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  };

  const startRename = (workspace: Workspace) => {
    setRenamingWorkspaceId(workspace.id);
    setRenameDraft(workspace.name);
  };

  const commitRename = () => {
    if (renamingWorkspaceId) onRenameWorkspace(renamingWorkspaceId, renameDraft);
    setRenamingWorkspaceId(null);
    setRenameDraft('');
  };

  const renderWorkspace = (workspace: Workspace) => {
    const sessionCount = sessions.filter((session) => session.workspaceId === workspace.id).length;
    if (renamingWorkspaceId === workspace.id) {
      return (
        <li key={workspace.id} className="workbench-workspace renaming">
          <input
            className="workbench-workspace-input"
            value={renameDraft}
            autoFocus
            aria-label={labels.renameWorkspace}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setRenamingWorkspaceId(null);
              }
            }}
          />
        </li>
      );
    }
    return (
      <li key={workspace.id} className={workspace.id === activeWorkspaceId ? 'workbench-workspace active' : 'workbench-workspace'}>
        <button
          type="button"
          className="workbench-workspace-button"
          onClick={() => onActivateWorkspace(workspace.id)}
          onDoubleClick={() => startRename(workspace)}
          title={labels.renameWorkspace}
        >
          <span className="workbench-workspace-name">{workspace.name}</span>
          {sessionCount > 0 && <span className="workbench-workspace-meta">{labels.sessionCount(sessionCount)}</span>}
        </button>
        <button type="button" className="workbench-icon-button" title={labels.removeWorkspace} aria-label={`${labels.removeWorkspace} ${workspace.name}`} onClick={() => onRemoveWorkspace(workspace.id)}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <nav
      className={workspaceSidebarVisible ? 'workbench-sidebar scene-workspace-view' : contextualSidebar ? 'workbench-sidebar has-contextual-sidebar' : 'workbench-sidebar'}
      aria-label={workspaceSidebarVisible ? (contextualSidebarLabel ?? labels.fileTree) : labels.scenes}
    >
      <div className="workbench-sidebar-views">
        <section
          className="workbench-sidebar-view workbench-sidebar-workspace"
          aria-label={contextualSidebarLabel ?? labels.fileTree}
          aria-hidden={!workspaceSidebarVisible}
        >
          <div className="workbench-sidebar-file-tree">
            {contextualSidebar ?? <p className="workbench-sidebar-hint">{labels.fileTreeNeedsFolder}</p>}
          </div>
        </section>
        <div className="workbench-sidebar-view workbench-sidebar-navigator" aria-hidden={workspaceSidebarVisible}>
      <section className="workbench-sidebar-section workbench-sidebar-scenes">
        <div className="workbench-scene-picker" ref={scenePickerRef}>
          <div className="workbench-scene-picker-control">
            <button
              type="button"
              className="workbench-scene-picker-trigger"
              aria-expanded={scenePickerOpen}
              onClick={() => setScenePickerOpen((current) => !current)}
            >
              <span>{pickerLabel}</span>
            </button>
            <button
              type="button"
              className="workbench-scene-picker-toggle"
              aria-label="Select scenes"
              title="Select scenes"
              aria-expanded={scenePickerOpen}
              onClick={() => setScenePickerOpen((current) => !current)}
            >
              <ListFilter size={16} aria-hidden="true" />
            </button>
          </div>
          {scenePickerOpen && (
            <div className="workbench-scene-picker-menu" role="menu" aria-label={labels.scenes}>
              <button
                type="button"
                className={allScenesSelected ? 'workbench-scene-picker-option selected' : 'workbench-scene-picker-option'}
                role="menuitemcheckbox"
                aria-checked={allScenesSelected}
                onClick={onSelectAllScenes}
              >
                <span className="workbench-scene-picker-check">{allScenesSelected && <Check size={14} />}</span>
                <span>{labels.allScenes}</span>
              </button>
              <div className="workbench-scene-picker-divider" />
              {sceneGroups.map((group) => (
                <div key={group.id} className="workbench-scene-picker-group">
                  <div className="workbench-scene-picker-group-label">{group.label}</div>
                  {group.items.map((scene) => {
                    const selected = selectedSceneSet.has(scene.id);
                    return (
                      <button
                        key={scene.id}
                        type="button"
                        className={selected ? 'workbench-scene-picker-option selected' : 'workbench-scene-picker-option'}
                        role="menuitemcheckbox"
                        aria-checked={selected}
                        onClick={() => onToggleScene(scene.id)}
                      >
                        <span className="workbench-scene-picker-check">{selected && <Check size={14} />}</span>
                        {scene.icon && <span className="workbench-tool-icon" aria-hidden="true">{scene.icon}</span>}
                        <span>{scene.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        <ul className="workbench-tool-list workbench-scene-list">
          {visibleScenes.map((scene) => {
            const sceneOpenItems = openItems.filter((item) => item.sceneId === scene.id);
            const sceneActive = activeSceneId === scene.id && !activeOpenItemId;
            return (
              <li key={scene.id} className="workbench-scene-group">
                <div className="workbench-scene-row">
                  <button
                    type="button"
                    className={sceneActive ? 'workbench-tool active' : 'workbench-tool'}
                    title={scene.hint ?? scene.label}
                    onClick={() => onOpenScene(scene.id)}
                  >
                    <span className="workbench-tool-icon" aria-hidden="true">{scene.icon}</span>
                    <span className="workbench-tool-label">{scene.label}</span>
                  </button>
                </div>
                {sceneOpenItems.length > 0 && (
                  <ul className="workbench-open-item-list">
                    {sceneOpenItems.map((item) => (
                      <li key={item.id} className={item.id === activeOpenItemId ? 'workbench-open-item active' : 'workbench-open-item'}>
                        <button type="button" className="workbench-open-item-button" title={item.hint ?? item.title} onClick={() => onSelectOpenItem(item.id)}>
                          {item.icon && <span className="workbench-tool-icon" aria-hidden="true">{item.icon}</span>}
                          <span className="workbench-tool-label">{item.title}</span>
                        </button>
                        <button
                          type="button"
                          className="workbench-open-item-close"
                          title={labels.closeTab}
                          aria-label={labels.closeTab}
                          onClick={() => onCloseOpenItem(item.id)}
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {contextualSidebar && (
        <section className="workbench-sidebar-section workbench-sidebar-context" aria-label={contextualSidebarLabel ?? '当前场景'}>
          <header className="workbench-sidebar-context-header">
            <strong>{contextualSidebarLabel ?? '当前场景'}</strong>
          </header>
          <div className="workbench-sidebar-file-tree">{contextualSidebar}</div>
        </section>
      )}
      <section className="workbench-sidebar-section workbench-sidebar-projects">
        <header className="workbench-sidebar-heading">
          <span>{labels.projects}</span>
          <button type="button" className="workbench-ghost-button" title={labels.addProject} disabled={addProjectPending} onClick={onAddProject}>
            {labels.addProject}
          </button>
        </header>
        {projects.length === 0 ? (
          <p className="workbench-sidebar-hint">{labels.projectsEmpty}</p>
        ) : (
          <ul className="workbench-project-list">
            {projects.map((project) => {
              const projectWorkspaces = workspaces.filter((workspace) => workspace.projectId === project.id);
              const projectCollapsed = collapsedProjectIds.includes(project.id);
              return (
                <li key={project.id} className={project.id === activeProjectId ? 'workbench-project active' : 'workbench-project'}>
                  <div className="workbench-project-row">
                    <button
                      type="button"
                      className="workbench-project-toggle"
                      title={project.rootPath}
                      aria-expanded={!projectCollapsed}
                      onClick={() => {
                        if (projectWorkspaces[0] && project.id !== activeProjectId) onActivateWorkspace(projectWorkspaces[0].id);
                        toggleProject(project.id);
                      }}
                    >
                      <span className={projectCollapsed ? 'workbench-caret' : 'workbench-caret open'} aria-hidden="true" />
                      <span className="workbench-project-name">{project.name}</span>
                    </button>
                    <div className="workbench-project-actions">
                      <button type="button" className="workbench-icon-button" title={labels.newWorkspace} aria-label={`${labels.newWorkspace} ${project.name}`} onClick={() => onCreateWorkspace(project.id)}>
                        <FolderPlus size={13} aria-hidden="true" />
                      </button>
                      {project.kind === 'folder' && (
                        <button type="button" className="workbench-icon-button" title={labels.removeProject} aria-label={`${labels.removeProject} ${project.name}`} onClick={() => onRemoveProject(project.id)}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {!projectCollapsed && (
                    <ul className="workbench-workspace-list">
                      {projectWorkspaces.map(renderWorkspace)}
                      <li className="workbench-workspace-create-row">
                        <button type="button" className="workbench-workspace-create" onClick={() => onCreateWorkspace(project.id)}>
                          <Plus size={13} aria-hidden="true" />
                          <span>{labels.newWorkspace}</span>
                        </button>
                      </li>
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <footer className="workbench-sidebar-footer">
        <button type="button" className="workbench-tool" onClick={onOpenCommandPalette}>
          <span className="workbench-tool-icon" aria-hidden="true">{commandIcon}</span>
          <span className="workbench-tool-label">{labels.commandPalette}</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <button type="button" className={settingsActive ? 'workbench-tool active' : 'workbench-tool'} onClick={onOpenSettings}>
          <span className="workbench-tool-icon" aria-hidden="true">{settingsIcon}</span>
          <span className="workbench-tool-label">{labels.settings}</span>
        </button>
      </footer>
        </div>
      </div>
    </nav>
  );
}
