/* Fixture for scripts/verify-library-folder-drag-browser.mjs (task 0d0dbaed): the real
 * LibrarySceneSidebar with the acceptance tree (默认资料库 → CVPR → 核心参考/MeanFlow,
 * plus a top-level folder) and a host that persists folder drags exactly like App.tsx
 * does locally, so `window.__restart()` simulates a relaunch from stored rows. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
import '/src/ui/styles/library.css';
import { LibrarySceneSidebar } from '/src/features/library/LibrarySceneSidebar';
import { applyLibraryFolderMove } from '/src/features/library/folderOrdering';
import type { LibraryFolder, PaperDocument } from '/src/core/types';

const calls: unknown[] = [];
(window as unknown as Record<string, unknown>).__sidebarCalls = calls;

const initialFolders: LibraryFolder[] = [
  { folderId: 'library', name: '默认资料库', parentId: null, sortOrder: 0 },
  { folderId: 'gen', name: '生成模型', parentId: null, sortOrder: 1 },
  { folderId: 'cvpr', name: 'CVPR', parentId: 'library', sortOrder: 1 },
  { folderId: 'core', name: '核心参考', parentId: 'cvpr', sortOrder: 1 },
  { folderId: 'mf', name: 'MeanFlow', parentId: 'cvpr', sortOrder: 2 },
];

const paper = (id: string, title: string, folderId: string): PaperDocument => ({
  paperId: id, title, authors: 'arena', year: 2026, venue: '', doi: '', folderId, sourceFileId: 'f-' + id, sourcePdf: 'D:/x/' + id + '.pdf',
  translatedFileIds: [], translatedPdfs: [], tags: ['入门'], notes: [], annotations: [], aiThreads: [], metadataSource: 'manual',
});

function Host() {
  const [folders, setFolders] = useState<LibraryFolder[]>(initialFolders);
  const [activeFolderId, setActiveFolderId] = useState('all');
  const papers = [paper('p1', 'A4 Note 使用指南', 'library'), paper('p2', 'Mean Flows 论文', 'mf')];
  const host = (window as unknown as Record<string, unknown>).__sidebarHost as Record<string, unknown>;
  host.persisted = folders;
  host.restart = () => setFolders(folders.map((folder) => ({ ...folder })));
  return (
    <div style={{ width: 340, height: '100vh', boxSizing: 'border-box', padding: 8 }} className="workbench-sidebar-view">
      <LibrarySceneSidebar
        folders={folders}
        papers={papers}
        activeFolderId={activeFolderId}
        activeTag="all"
        tags={['入门']}
        onSelectFolder={(id) => { calls.push(['select', id]); setActiveFolderId(id); }}
        onSelectTag={(tag) => calls.push(['tag', tag])}
        onSelectPaper={(id) => calls.push(['paper', id])}
        onMovePapersToFolder={(ids, folderId) => { calls.push(['movePapers', ids, folderId]); }}
        onMoveFolder={(folderId, parentId, index) => {
          calls.push(['moveFolder', folderId, parentId, index]);
          setFolders((current) => applyLibraryFolderMove(current, folderId, parentId, index));
        }}
        onCreateFolder={async (name, parentId) => {
          calls.push(['create', name, parentId]);
          setFolders((current) => [...current, { folderId: 'f-' + current.length, name, parentId, sortOrder: current.filter((folder) => folder.parentId === parentId).length + 1 }]);
        }}
        onRenameFolder={(id, name) => { calls.push(['rename', id, name]); setFolders((current) => current.map((folder) => folder.folderId === id ? { ...folder, name } : folder)); }}
        onDeleteFolder={(id) => { calls.push(['delete', id]); setFolders((current) => current.filter((folder) => folder.folderId !== id)); }}
      />
    </div>
  );
}

(window as unknown as Record<string, unknown>).__sidebarHost = (window as unknown as Record<string, unknown>).__sidebarHost ?? {};
createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
