import { useEffect, useRef, useState } from 'react';
import { useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import { useReaderNoteActive } from './ReaderNoteActivity';
import { zh } from '../../ui/zh';
import './reader-annotation-dock.css';

/** Viewport overlay: page scrolling and PDF zoom never move or scale this control. */
export function ReaderPageControl({ paperId, readerPageState, onJumpToPage }: {
  paperId: string;
  readerPageState: { currentPage: number; totalPages: number };
  onJumpToPage: (page: number) => void;
}) {
  const active = useDocumentToolbarActive();
  const visible = useReaderNoteActive();
  const [pageInput, setPageInput] = useState(String(readerPageState.currentPage));
  const editing = useRef(false);
  const previousPaper = useRef(paperId);
  useEffect(() => {
    if (previousPaper.current !== paperId) { editing.current = false; previousPaper.current = paperId; }
    if (!editing.current) setPageInput(String(readerPageState.currentPage));
  }, [readerPageState.currentPage, paperId]);
  const handlePageSubmit = () => {
    editing.current = false;
    if (readerPageState.totalPages < 1) return;
    const nextPage = Math.max(1, Math.min(readerPageState.totalPages, Number(pageInput) || readerPageState.currentPage));
    setPageInput(String(nextPage));
    onJumpToPage(nextPage);
  };
  if (!active || !visible) return null;
  return (
          <div className="page-jump-shell reader-page-overlay"
            onPointerDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()} title={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}>
            <input
              inputMode="numeric"
              disabled={readerPageState.totalPages < 1}
              value={pageInput}
              style={{ width: `${Math.max(1, pageInput.length)}ch` }}
              onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              onFocus={() => { editing.current = true; }}
              onBlur={() => { if (editing.current) handlePageSubmit(); }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); handlePageSubmit(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing.current = false; setPageInput(String(readerPageState.currentPage)); event.currentTarget.blur(); }
              }}
              aria-label={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}
            />
            <span>/ {readerPageState.totalPages}</span>
          </div>
  );
}
