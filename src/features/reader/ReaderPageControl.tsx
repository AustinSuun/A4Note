import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useDocumentToolbarActive } from '../../workbench/DocumentToolbar';
import { useReaderNoteActive } from './ReaderNoteActivity';
import { pageDraftMatches, pageJumpTarget, type PageJumpDraft } from './pageJumpDraft';
import { zh } from '../../ui/zh';
import './reader-annotation-dock.css';

/** Viewport overlay: scrolling/zoom never move it; editing is a document-scoped transaction. */
export function ReaderPageControl({ paperId, documentKey = paperId, readerPageState, onJumpToPage }: {
  paperId: string;
  documentKey?: string;
  readerPageState: { currentPage: number; totalPages: number };
  onJumpToPage: (page: number) => void;
}) {
  const active = useDocumentToolbarActive();
  const visible = useReaderNoteActive();
  const { currentPage, totalPages } = readerPageState;
  const document = JSON.stringify([paperId, documentKey]);
  const [draft, setDraft] = useState<PageJumpDraft | null>(null);
  const transaction = useRef<PageJumpDraft | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pointerDown = useRef(false);
  const pendingBlur = useRef<(() => void) | null>(null);
  const helpId = useId();
  const latest = useRef({ document, totalPages, currentPage, onJumpToPage });
  useLayoutEffect(() => { latest.current = { document, totalPages, currentPage, onJumpToPage }; });
  useLayoutEffect(() => {
    transaction.current = null;
    pendingBlur.current = null;
    setDraft(null);
    // Also invalidate delayed blur work on document replacement, hiding, or unmount.
    return () => { transaction.current = null; };
  }, [document, totalPages, active, visible]);
  useLayoutEffect(() => {
    const owner = input.current?.ownerDocument;
    if (!active || !visible || !owner) return;
    const down = (event: PointerEvent) => { if (event.isPrimary) pointerDown.current = true; };
    const up = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      pointerDown.current = false;
      const pending = pendingBlur.current;
      pendingBlur.current = null;
      if (pending) requestAnimationFrame(pending);
    };
    const cancel = () => { pointerDown.current = false; pendingBlur.current = null; };
    // Capture precedes the outside target's default focus transfer, even if it stops bubbling.
    owner.addEventListener('pointerdown', down, true);
    owner.addEventListener('pointerup', up, true);
    owner.addEventListener('pointercancel', up, true);
    owner.defaultView?.addEventListener('blur', cancel);
    return () => {
      owner.removeEventListener('pointerdown', down, true);
      owner.removeEventListener('pointerup', up, true);
      owner.removeEventListener('pointercancel', up, true);
      owner.defaultView?.removeEventListener('blur', cancel);
      cancel();
    };
  }, [active, visible]);
  const begin = () => {
    if (totalPages < 1) return;
    if (!pageDraftMatches(transaction.current, document, totalPages)) {
      transaction.current = { document, total: totalPages, initial: currentPage, value: String(currentPage) };
      setDraft(transaction.current);
    }
  };
  const finish = (commit: boolean) => {
    const value = transaction.current;
    transaction.current = null; // Consume once before callbacks or an ensuing blur can re-enter.
    setDraft(null);
    const now = latest.current;
    const target = commit ? pageJumpTarget(value, now.document, now.totalPages, now.currentPage) : null;
    if (target !== null) now.onJumpToPage(target);
  };
  const focusInput = () => {
    if (totalPages < 1) return;
    input.current?.focus({ preventScroll: true });
    begin();
    input.current?.select();
  };
  if (!active || !visible) return null;
  const value = pageDraftMatches(draft, document, totalPages) ? draft.value : String(currentPage);
  return (
    <label className="page-jump-shell reader-page-overlay" aria-disabled={totalPages < 1}
      title={`${zh.reader.pageStatus(currentPage, totalPages)}；Enter 或离开控件确认，Esc 取消`}
      onPointerDown={event => {
        event.stopPropagation();
        if (event.button !== 0 || totalPages < 1) return;
        // Internal label/gap clicks must not first blur the input and commit a partial number.
        if (event.target !== input.current || input.current !== input.current?.ownerDocument.activeElement) {
          event.preventDefault(); focusInput();
        }
      }}
      onClick={event => {
        if (event.target !== input.current) { event.preventDefault(); focusInput(); }
      }}
      onDoubleClick={event => event.stopPropagation()}
      onBlur={event => {
        const shell = event.currentTarget;
        if (event.relatedTarget instanceof Node && shell.contains(event.relatedTarget)) return;
        const pending = transaction.current;
        // Let the outside click and its document/mode change commit before deciding to submit.
        // Window deactivation and brief refocusing are not a completed outside edit.
        const settle = () => {
          if (transaction.current === pending && shell.isConnected && shell.ownerDocument.hasFocus()
            && !shell.contains(shell.ownerDocument.activeElement)) finish(true);
        };
        // A held mouse/pen/touch press has not clicked the new document yet.
        if (pointerDown.current) pendingBlur.current = settle;
        else requestAnimationFrame(settle);
      }}>
      <input ref={input} type="text" inputMode="numeric" maxLength={8} autoComplete="off"
        disabled={totalPages < 1} value={value}
        style={{ width: `${Math.max(2, value.length)}ch` }}
        onFocus={event => { begin(); event.currentTarget.select(); }}
        onChange={event => {
          begin();
          if (transaction.current) { transaction.current = { ...transaction.current, value: event.target.value }; setDraft(transaction.current); }
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            finish(event.key === 'Enter'); event.currentTarget.blur();
          }
        }}
        aria-label="修改当前页码" aria-describedby={helpId} />
      <span aria-hidden="true">/ {totalPages}</span>
      <span id={helpId} className="reader-page-help">共 {totalPages} 页。Enter 或离开整个页码控件确认，Escape 取消。</span>
    </label>
  );
}
