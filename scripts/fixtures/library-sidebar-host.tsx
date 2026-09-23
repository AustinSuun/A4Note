/* Fixture for scripts/verify-library-sidebar-browser.mjs (task 5e3bdbd4): the real
 * LibrarySceneSidebar with scripted data and recorded folder callbacks. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
import '/src/ui/styles/library.css';
import { LibrarySceneSidebar } from '/src/features/library/LibrarySceneSidebar';
import type { LibraryFolder, PaperDocument } from '/src/core/types';

const calls: unknown[] = [];
(window as unknown as Record<string, unknown>).__sidebarCalls = calls;
const paper = (id: string, title: string, folderId: string): PaperDocument => ({
  paperId: id, title, authors: 'arena', year: 2026, venue: '', doi: '', folderId, sourceFileId: 'f-' + id, sourcePdf: 'D:/x/' + id + '.pdf',
  translatedFileIds: [], translatedPdfs: [], tags: ['入门'], notes: [], annotations: [], aiThreads: [], metadataSource: 'manual',
});

function Host() {
  const [folders, setFolders] = useState<LibraryFolder[]>([
    { folderId: 'library', name: '默认资料库', parentId: null },
    { folderId: 'f-gen', name: '生成模型', parentId: null },
  ]);
  const papers = [paper('p1', 'A4 Note 使用指南', 'library'), paper('p2', 'Mean Flows', 'f-gen')];
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [failNext, setFailNext] = useState(false);
  (window as unknown as Record<string, unknown>).__sidebarHost = { setFailNext };
  return (
    <div style={{ width: 300, height: '100vh', boxSizing: 'border-box', padding: 8 }} className="workbench-sidebar-view">
      <LibrarySceneSidebar
        folders={folders}
        papers={papers}
        activeFolderId={activeFolderId}
        activeTag="all"
        tags={['入门']}
        onSelectFolder={(id) => { calls.push(['select', id]); setActiveFolderId(id); }}
        onSelectTag={(tag) => calls.push(['tag', tag])}
        onSelectPaper={(id) => calls.push(['paper', id])}
        onMovePapersToFolder={(ids, folderId) => { calls.push(['move', ids, folderId]); }}
        onCreateFolder={async (name, parentId) => {
          calls.push(['create', name, parentId]);
          if (failNext) { setFailNext(false); throw new Error('模拟创建失败'); }
          setFolders((current) => [...current, { folderId: 'f-' + Date.now(), name, parentId }]);
        }}
        onRenameFolder={(id, name) => { calls.push(['rename', id, name]); }}
        onDeleteFolder={(id) => { calls.push(['delete', id]); }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
