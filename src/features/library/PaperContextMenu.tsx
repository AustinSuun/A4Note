import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, Network, Folder, FolderOpen, Pencil, Tags, Languages, Copy, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { LibraryFolder, PaperDocument } from '../../core/types';
import { pointPlacement, toCssPixels, viewportScale } from './portalPlacement';

export type PaperMenuAnchor = { paperId: string; x: number; y: number; trigger: HTMLElement };
type Props = {
  anchor: PaperMenuAnchor;
  paper: PaperDocument;
  folders: LibraryFolder[];
  onClose: () => void;
  onRead: () => void;
  onDetails: () => void;
  onRelations: () => void;
  onEdit: () => void;
  onTags: () => void;
  onRevealSourcePdf: () => void;
  onTranslation: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onMove: (folderId: string) => void | Promise<void>;
};

/** Body-level portal: neither the table scrollport nor scene overflow can clip this menu. */
export function PaperContextMenu({ anchor, paper, folders, onClose, onRead, onDetails, onRelations, onEdit, onTags, onRevealSourcePdf, onTranslation, onCopy, onDelete, onMove }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [folderMode, setFolderMode] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => { setFolderMode(false); }, [anchor]);
  const close = (restoreFocus = false) => {
    if (restoreFocus && anchor.trigger.isConnected) anchor.trigger.focus({ preventScroll: true });
    onClose();
  };
  const run = (action: () => void) => { close(true); action(); };

  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const place = () => {
      // Pointer coordinates and rects are viewport px; fixed offsets are zoomed CSS px.
      const { left, top } = toCssPixels(pointPlacement(anchor, menu.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }), viewportScale(menu));
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [anchor, folderMode]);

  useLayoutEffect(() => {
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [onClose]);

  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const folderPath = (folder: LibraryFolder) => {
    const names = [folder.name];
    const seen = new Set([folder.folderId]);
    let parent = folder.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      names.unshift(ancestor.name);
      parent = ancestor.parentId;
    }
    return names.join(' / ');
  };
  const destinations = [byId.get('library') ?? { folderId: 'library', name: '默认资料库', parentId: null }, ...folders.filter((folder) => folder.folderId !== 'library')];

  return createPortal(
    <div ref={root} className="library-paper-context-menu" role="menu" aria-label={`论文操作：${paper.title}`}
      style={position} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          if (folderMode && event.key === 'Escape') setFolderMode(false); else close(true);
          return;
        }
        if (event.key === 'ArrowLeft' && folderMode) { event.preventDefault(); setFolderMode(false); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {folderMode ? <>
        <button type="button" role="menuitem" onClick={() => setFolderMode(false)}><ChevronLeft />返回论文操作</button>
        <div role="separator" className="library-context-separator" />
        {destinations.map((folder) => <button type="button" role="menuitem" key={folder.folderId}
          title={folderPath(folder)} disabled={(paper.folderId || 'library') === folder.folderId}
          onClick={() => run(() => { void onMove(folder.folderId); })}>
          <Folder /><span className="library-context-folder-label">{folderPath(folder)}</span>
          {(paper.folderId || 'library') === folder.folderId && <small>当前</small>}
        </button>)}
      </> : <>
        <button type="button" role="menuitem" onClick={() => run(onRead)}><BookOpen />阅读</button>
        <button type="button" role="menuitem" onClick={() => run(onDetails)}><FileText />详情</button>
        <button type="button" role="menuitem" onClick={() => run(onRelations)}><Network />关系</button>
        <div role="separator" className="library-context-separator" />
        <button type="button" role="menuitem" onClick={() => setFolderMode(true)}><Folder />设置文件类<ChevronRight className="library-context-chevron" /></button>
        <button type="button" role="menuitem" onClick={() => run(onEdit)}><Pencil />编辑论文信息</button>
        <button type="button" role="menuitem" onClick={() => run(onTags)}><Tags />编辑标签</button>
        <button type="button" role="menuitem" onClick={() => run(onRevealSourcePdf)} disabled={!paper.sourcePdf}><FolderOpen />打开 PDF 所在文件夹</button>
        <button type="button" role="menuitem" onClick={() => run(onTranslation)}><Languages />导入译文 PDF</button>
        <button type="button" role="menuitem" onClick={() => run(onCopy)}><Copy />复制 BibTeX</button>
        <div role="separator" className="library-context-separator" />
        <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}><Trash2 />删除论文</button>
      </>}
    </div>, document.body,
  );
}
