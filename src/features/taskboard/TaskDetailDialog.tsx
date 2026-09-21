import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import './taskboard-dialog.css';

/** Native modal top layer supplies focus containment and makes the board inert. */
export function TaskDetailDialog({title, taskTitle, taskId, children, footer, busy, onClose, error, onDismissError, subtitle, navigation}: {
  title: string; taskTitle?: string; taskId?: string; subtitle?: string; navigation?: ReactNode; children: ReactNode; footer?: ReactNode; busy: boolean; onClose: () => void; error?: string; onDismissError?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const heading = useId();
  const [maximized, setMaximized] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyTaskId = async () => {
    if (!taskId) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(taskId);
      } else if (typeof document !== 'undefined') {
        const input = document.createElement('textarea');
        input.value = taskId;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.appendChild(input); input.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
        input.remove();
      } else throw new Error('copy unavailable');
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
  };
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus({preventScroll: true}); };
  }, []);
  return <dialog ref={dialog} className={'tb-detail-dialog' + (maximized ? ' is-maximized' : '')}
    aria-labelledby={heading} onCancel={e => {e.preventDefault(); if (!busy) close.current();}}>
    <header className="tb-dialog-header">
      <div className="tb-dialog-title-group">
        <h2 id={heading}>
          <span>{title}</span>
          {taskId && <span className="tb-dialog-short-id"> · #{taskId.slice(0, 8)}</span>}
          {taskId && taskTitle && <span className="tb-dialog-task-title"> · {taskTitle}</span>}
        </h2>
        {taskId && <div className="tb-dialog-identity">
          <button type="button" className="tb-dialog-copy-id" onClick={() => void copyTaskId()} aria-label="复制完整任务ID">复制任务ID</button>
          <span role="status" aria-live="polite">{copyState === 'success' ? '已复制完整任务ID' : copyState === 'error' ? '复制失败，请手动选择任务ID' : taskId}</span>
        </div>}
      </div>
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
