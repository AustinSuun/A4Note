import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import './taskboard-dialog.css';

/** Native modal top layer supplies focus containment and makes the board inert. */
export function TaskDetailDialog({title, children, footer, busy, onClose, error, onDismissError, subtitle, navigation}: {
  title: string; subtitle?: string; navigation?: ReactNode; children: ReactNode; footer?: ReactNode; busy: boolean; onClose: () => void; error?: string; onDismissError?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const heading = useId();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus({preventScroll: true}); };
  }, []);
  return <dialog ref={dialog} className={'tb-detail-dialog' + (maximized ? ' is-maximized' : '')}
    aria-labelledby={heading} onCancel={e => {e.preventDefault(); if (!busy) close.current();}}>
    <header className="tb-dialog-header">
      <h2 id={heading}>{title}</h2>
      <div className="tb-dialog-controls">
        <button type="button" aria-pressed={maximized} onClick={() => setMaximized(v => !v)}>{maximized ? '还原' : '最大化'}</button>
        <button type="button" aria-label="关闭任务详情" disabled={busy} onClick={onClose}>关闭</button>
      </div>
      {subtitle && <p className="tb-dialog-subtitle">{subtitle}</p>}
      {error && <div className="tb-dialog-error" role="alert">{error}<button onClick={onDismissError} aria-label="关闭详情错误提示">关闭提示</button></div>}
    </header>
    {navigation}
    <div className="tb-dialog-body">{children}</div>
    {footer && <footer className="tb-detail-footer">{footer}</footer>}
  </dialog>;
}
