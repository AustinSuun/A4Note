import { useEffect, useLayoutEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { NoteWorkspaceEmpty } from './NoteWorkspaceEmpty';
import type { WorkbenchView } from '../../workbench/useWorkbench';
import type { ProjectFolderInfo } from '../../platform/projects';
import { NoteLibraryDialog } from './NoteLibraryDialog';
import { NoteWorkspacePicker } from './NoteWorkspacePicker';
import { noteFolderKey, noteFolders, noteFolderWorkspace, readNoteFolderPreferences } from './noteFolderModel';
import './note-folder-workspaces.css';
const preferenceKey = 'a4note.notes.folderWorkspaces.v2';
/** Shared folder navigation; the topbar picker is exclusive to the Markdown scene. */
export function useNoteFolderWorkspaces({ workbench, activeScene, onEnterWorkspace, onSelectWorkspace }: {
  workbench: WorkbenchView; activeScene: string | null; onEnterWorkspace: (workspaceId: string) => void; onSelectWorkspace: (workspaceId: string) => void;
}) {
  const [preferences, setPreferences] = useState<Record<string, string>>(() => {
    try { return readNoteFolderPreferences(localStorage.getItem(preferenceKey)); } catch { return {}; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'choice' | 'create'>('choice');
  const pending = dialogOpen;
  const error = '';
  useLayoutEffect(() => { setDialogOpen(false); }, [activeScene, workbench.workspace?.id]);
  const folders = noteFolders(workbench.projects);
  const activeKey = workbench.activeProject?.kind === 'folder' ? noteFolderKey(workbench.activeProject.rootPath) : '';
  const current = folders.find(folder => folder.key === activeKey);
  const enabled = true;
  // Remember the active backing workspace within the new storage namespace.
  // Legacy preferences are neither read nor migrated.
  useEffect(() => {
    if (!enabled || !current || !workbench.workspace || preferences[current.key]) return;
    const next = { ...preferences, [current.key]: workbench.workspace.id };
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* In-memory use remains available. */ }
  }, [enabled, current?.key, workbench.workspace?.id, preferences]);
  const activate = (key: string, enter = false) => {
    const state = workbench.store.getState();
    const folder = noteFolders(state.projects).find(item => item.key === key);
    if (!folder) return;
    let workspace = noteFolderWorkspace(state, folder, preferences[key]);
    if (!workspace) {
      workbench.store.createWorkspace({ projectId: folder.projectIds[0], name: folder.name });
      workspace = noteFolderWorkspace(workbench.store.getState(), folder);
    }
    if (!workspace) return;
    const next = { ...preferences, [key]: workspace.id };
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* Do not alter legacy storage. */ }
    workbench.store.activateWorkspace(workspace.id);
    if (enter) onEnterWorkspace(workspace.id);
    else onSelectWorkspace(workspace.id);
  };
  const openFolder = () => { if (enabled) { setDialogMode('choice'); setDialogOpen(true); } };
  const newLibrary = () => { setDialogMode('create'); setDialogOpen(true); };
  const acceptFolder = (info: ProjectFolderInfo) => {
    const key = noteFolderKey(info.path);
    if (!noteFolders(workbench.store.getState().projects).some(folder => folder.key === key)) {
      workbench.store.createProject({ rootPath: info.path, name: info.name, kind: 'folder', workspaceName: info.name });
    }
    activate(key);
    setDialogOpen(false);
  };
  const openButton = <button type="button" disabled={pending} onClick={() => void openFolder()}><FolderOpen size={16} aria-hidden="true" />{pending ? '正在打开…' : '打开文件夹'}</button>;
  const navigation = enabled ? <section className="note-folder-workspaces" aria-label="笔记工作区">
    <header><strong>笔记工作区</strong>{openButton}</header>
    <p className="note-folder-scope-hint"><span>独立笔记</span>非文献库目录</p>
    {error && <p role="alert" className="note-folder-error">{error}</p>}
    {folders.length ? <ul>{folders.map(folder => <li key={folder.key}><button type="button" disabled={pending} className={folder.key === activeKey ? 'active' : ''} aria-current={folder.key === activeKey ? 'page' : undefined} title={folder.path} onClick={() => activate(folder.key)} onDoubleClick={() => activate(folder.key, true)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); activate(folder.key, true); } }}><FolderOpen size={16} aria-hidden="true" /><span>{folder.name}</span></button></li>)}</ul>
      : <NoteWorkspaceEmpty pending={pending} onOpen={openFolder} onCreate={newLibrary} />}
  </section> : undefined;
  const breadcrumb = <>
    {activeScene === 'markdown' && <div className="note-folder-breadcrumb">
      <NoteWorkspacePicker key={workbench.workspace?.id ?? 'empty'} folders={folders} currentKey={current?.key} disabled={pending} onSelect={activate} onOpenFolder={openFolder} />
    </div>}
    {dialogOpen && <NoteLibraryDialog key={workbench.workspace?.id ?? 'empty'} initialMode={dialogMode} onSelect={acceptFolder} onClose={() => setDialogOpen(false)} />}
  </>;
  // A non-null slot suppresses the legacy topbar fallback; the sidebar dialog remains available in every scene.
  return { navigation, breadcrumb, openFolder, pending, error };
}
