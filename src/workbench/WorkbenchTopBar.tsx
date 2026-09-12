import { ChevronDown, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Project, Workspace } from '../core/workspace';
import type { WorkbenchLabels } from './workbenchLabels';

export interface TopBarProviderOption {
  id: string;
  label: string;
  available: boolean;
  hint?: string;
}

export interface WorkbenchTopBarProps {
  labels: WorkbenchLabels;
  project: Project | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  fileTreeVisible: boolean;
  /** Whether the active scene contributes a contextual sidebar to toggle. */
  canToggleFileTree?: boolean;
  canBrowseFolder: boolean;
  providers: TopBarProviderOption[];
  providersLoading?: boolean;
  onToggleFileTree: () => void;
  onOpenInVSCode: () => void;
  onRevealFolder: () => void;
  onCreateAgentSession: (providerId: string) => void;
  onActivateWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (projectId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  status?: ReactNode;
}

/** Breadcrumb on the left, the four project-level actions on the right. */
export function WorkbenchTopBar({
  labels,
  project,
  workspace,
  workspaces,
  fileTreeVisible,
  canToggleFileTree = false,
  canBrowseFolder,
  providers,
  providersLoading = false,
  onToggleFileTree,
  onOpenInVSCode,
  onRevealFolder,
  onCreateAgentSession,
  onActivateWorkspace,
  onCreateWorkspace,
  onRemoveWorkspace,
  status,
}: WorkbenchTopBarProps) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const workspacePickerRef = useRef<HTMLDivElement>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const projectWorkspaces = project ? workspaces.filter((candidate) => candidate.projectId === project.id) : [];

  useEffect(() => {
    if (!workspaceMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!workspacePickerRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (!openMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!openMenuRef.current?.contains(event.target as Node)) setOpenMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [openMenuOpen]);

  return (
    <header className="workbench-topbar">
      <div className="workbench-breadcrumb">
        <span className="workbench-breadcrumb-project" title={project?.rootPath}>
          {project?.name ?? labels.brand}
        </span>
        <span className="workbench-breadcrumb-separator" aria-hidden="true">/</span>
        <div className="workbench-workspace-picker" ref={workspacePickerRef}>
          <button
            type="button"
            className="workbench-workspace-trigger"
            aria-haspopup="menu"
            aria-expanded={workspaceMenuOpen}
            title={workspace?.name ?? labels.workspaceLabel}
            onClick={() => setWorkspaceMenuOpen((current) => !current)}
          >
            <span className="workbench-breadcrumb-workspace">{workspace?.name ?? labels.workspaceLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {workspaceMenuOpen && (
            <div className="workbench-workspace-menu" role="menu" aria-label={labels.workspaceLabel}>
              {projectWorkspaces.map((candidate) => (
                <div key={candidate.id} className={candidate.id === workspace?.id ? 'workbench-workspace-option active' : 'workbench-workspace-option'}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={candidate.id === workspace?.id}
                    onClick={() => {
                      onActivateWorkspace(candidate.id);
                      setWorkspaceMenuOpen(false);
                    }}
                  >
                    <span>{candidate.name}</span>
                    {candidate.id === workspace?.id && <span className="workbench-workspace-current">当前</span>}
                  </button>
                  {projectWorkspaces.length > 1 && (
                    <button
                      type="button"
                      className="workbench-workspace-remove"
                      title={labels.removeWorkspace}
                      aria-label={`${labels.removeWorkspace} ${candidate.name}`}
                      onClick={() => {
                        onRemoveWorkspace(candidate.id);
                        setWorkspaceMenuOpen(false);
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              {project && (
                <button
                  type="button"
                  className="workbench-workspace-create"
                  role="menuitem"
                  onClick={() => {
                    onCreateWorkspace(project.id);
                    setWorkspaceMenuOpen(false);
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{labels.newWorkspace}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {status && <div className="workbench-topbar-status">{status}</div>}
      <div className="workbench-topbar-actions">
        <button
          type="button"
          className={fileTreeVisible ? 'workbench-action active' : 'workbench-action'}
          disabled={!canToggleFileTree}
          aria-pressed={fileTreeVisible}
          onClick={onToggleFileTree}
        >
          {labels.toggleFileTree}
        </button>
        <div className="workbench-open-menu" ref={openMenuRef}>
          <button type="button" className="workbench-action workbench-open-trigger" disabled={!canBrowseFolder} aria-haspopup="menu" aria-expanded={openMenuOpen} onClick={() => setOpenMenuOpen((current) => !current)}>
            <FolderOpen size={15} aria-hidden="true" />
            <span>打开</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {openMenuOpen && (
            <div className="workbench-open-menu-panel" role="menu" aria-label="打开方式">
              <button type="button" role="menuitem" onClick={() => { onRevealFolder(); setOpenMenuOpen(false); }}><FolderOpen size={16} aria-hidden="true" /><span>在文件管理器中显示</span></button>
              <button type="button" role="menuitem" onClick={() => { onOpenInVSCode(); setOpenMenuOpen(false); }}><span className="workbench-vscode-mark" aria-hidden="true">&lt;/&gt;</span><span>在 VS Code 中打开</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
