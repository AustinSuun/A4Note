import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, X } from 'lucide-react';
import { downloadUpdate, installUpdate, openReleases, updateSnapshot } from '../../platform/updater';

export function BrandUpdateMenu({ state, anchor, onClose }: {
  state: ReturnType<typeof updateSnapshot>; anchor: HTMLButtonElement | null; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [linkError, setLinkError] = useState('');
  const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const place = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      const top = Math.max(8, Math.min((rect?.bottom ?? 32) + 8, window.innerHeight - 100));
      dialog.style.width = `${width}px`;
      dialog.style.left = `${Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8))}px`;
      dialog.style.top = `${top}px`;
      dialog.style.maxHeight = `${Math.max(80, window.innerHeight - top - 8)}px`;
    };
    place(); dialog.showModal();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place); dialog.close();
      if (anchor?.isConnected && !document.querySelector('dialog[open]')) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(<dialog ref={ref} className="brand-update-menu" aria-labelledby={titleId}
    onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const r = event.currentTarget.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
    }}>
    <header><strong id={titleId}>发现新版本</strong><button type="button" className="brand-update-close" aria-label="关闭更新菜单" onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
    <div className="brand-update-version"><span>{state.current || '当前版本'}</span><span aria-hidden="true">→</span><strong>{state.version}</strong></div>
    {state.notes && <p className="brand-update-notes">{state.notes.slice(0, 1200)}</p>}
    {!state.downloaded && <button type="button" className="brand-update-primary" disabled={busy} onClick={() => void downloadUpdate()}><Download size={15} aria-hidden="true" />{state.phase === 'downloading' ? '正在下载并验证…' : '下载更新'}</button>}
    {state.phase === 'downloading' && <div role="status" className="brand-update-progress"><progress aria-label="更新下载进度" max={state.total || undefined} value={state.total ? Math.min(state.received, state.total) : undefined} /><span>{(state.received / 1048576).toFixed(1)} MB{state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ''}</span></div>}
    {state.downloaded && <>
      <p role="status">已下载并通过签名校验。安装会退出软件。</p>
      <label className="brand-update-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已备份重要资料，同意保存并退出安装。</label>
      <button type="button" className="brand-update-primary" disabled={!confirmed || busy} onClick={() => { setConfirmed(false); void installUpdate(); }}>{state.phase === 'installing' ? '正在保存并安装…' : '保存并安装更新'}</button>
    </>}
    <button type="button" className="brand-update-release" onClick={() => { setLinkError(''); void openReleases().catch(error => setLinkError(String(error))); }}><ExternalLink size={14} aria-hidden="true" />GitHub 发布说明</button>
    {(state.error || linkError) && <p role="alert" className="brand-update-error">{state.error || linkError}</p>}
    <small>仅提示，不会自动下载或安装。</small>
  </dialog>, document.body);
}
