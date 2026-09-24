/* Fixture for scripts/verify-library-context-menu-browser.mjs (task bab38e7e): the real
 * PaperContextMenu on a body-level portal with scripted anchors and callbacks. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/library.css';
import { PaperContextMenu, type PaperMenuAnchor } from '/src/features/library/PaperContextMenu';
import type { LibraryFolder, PaperDocument } from '/src/core/types';

const LONG_TITLE = 'Mean Flows for One-step Generative Modeling with an Intentionally Very Long Title That Would Have Been Truncated in the Old Header Row';
const paper: PaperDocument = {
  paperId: 'paper-menu-1', title: LONG_TITLE, authors: 'Zhengyang Geng', year: 2025, venue: 'arXiv', doi: '', folderId: 'library',
  sourceFileId: 'file-1', sourcePdf: 'D:/papers/mean-flows.pdf', translatedFileIds: [], translatedPdfs: [], tags: ['flow'], notes: [], annotations: [], aiThreads: [], metadataSource: 'manual',
};
const folders: LibraryFolder[] = [
  { folderId: 'library', name: '默认资料库', parentId: null },
  { folderId: 'f-gen', name: '生成模型', parentId: null },
  { folderId: 'f-gen-flow', name: 'Flow', parentId: 'f-gen' },
];
const calls: string[] = [];
(window as unknown as Record<string, unknown>).__menuCalls = calls;

function Host() {
  const [anchor, setAnchor] = useState<PaperMenuAnchor | null>(null);
  const [noPdf, setNoPdf] = useState(false);
  const open = (x: number, y: number, trigger: HTMLElement) => setAnchor({ paperId: paper.paperId, x, y, trigger });
  (window as unknown as Record<string, unknown>).__menuHost = {
    openAt: (x: number, y: number) => open(x, y, document.getElementById('menu-trigger') as HTMLElement),
    close: () => setAnchor(null),
    setNoPdf,
    isOpen: () => anchor !== null,
  };
  return (
    <div style={{ padding: 24, minHeight: '100vh', boxSizing: 'border-box' }}>
      <button id="menu-trigger" type="button" onContextMenu={(event) => { event.preventDefault(); open(event.clientX, event.clientY, event.currentTarget); }}
        onClick={(event) => open(event.clientX, event.clientY, event.currentTarget)}>
        {LONG_TITLE}
      </button>
      <p id="menu-state">{anchor ? 'open' : 'closed'}</p>
      {anchor ? (
        <PaperContextMenu
          anchor={anchor}
          paper={noPdf ? { ...paper, sourcePdf: '' } : paper}
          folders={folders}
          onClose={() => setAnchor(null)}
          onRead={() => calls.push('read')}
          onDetails={() => calls.push('details')}
          onRelations={() => calls.push('relations')}
          onEdit={() => calls.push('edit')}
          onTags={() => calls.push('tags')}
          onRevealSourcePdf={() => calls.push('reveal')}
          onTranslation={() => calls.push('translation')}
          onCopy={() => calls.push('copy')}
          onDelete={() => calls.push('delete')}
          onMove={(folderId) => { calls.push('move:' + folderId); }}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
