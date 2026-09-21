import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, X } from 'lucide-react';
import { updateActions, useUpdateModel } from './updateModel';
import { UpdateConsent, UpdateNotes, UpdateProgress } from './updateViews';

/* Titlebar shape of the shared update flow: same model, notes and actions as the
   Settings page, only the presentation (an anchored dialog) differs. */
export function BrandUpdateMenu({ anchor, onClose }: { anchor: HTMLButtonElement | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const model = useUpdateModel();
  const [confirmed, setConfirmed] = useState(false);
  const [linkError, setLinkError] = useState('');
  const busy = model.busy;
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
    <div className="brand-update-version"><span>{model.current || '当前版本'}</span><span aria-hidden="true">→</span><strong>{model.version}</strong></div>
    <UpdateNotes notes={model.notes} className="brand-update-notes" limitLines={6} />
    {model.canDownload ? <button type="button" className="brand-update-primary" disabled={busy} onClick={() => void updateActions.download()}><Download size={15} aria-hidden="true" />下载更新</button> : null}
    {model.phase === 'downloading' ? <UpdateProgress model={model} compact /> : null}
    {model.downloaded ? <>
      <p role="status" className="brand-update-install-hint">已下载并通过签名校验。安装会退出软件。</p>
      <p className="brand-update-install-hint">{model.manualInstallHint}</p>
      {model.backupPath ? <p className="brand-update-install-hint settings-path-ellipsis" title={model.backupPath}>本次资料库备份：{model.backupPath}</p> : null}
      <UpdateConsent checked={confirmed} disabled={busy} onChange={setConfirmed} />
      <button type="button" className="brand-update-primary" disabled={!confirmed || busy} onClick={() => { setConfirmed(false); void updateActions.install(); }}>{model.installLabel}</button>
    </> : null}
    <button type="button" className="brand-update-release" onClick={() => { setLinkError(''); void updateActions.openReleases().catch(error => setLinkError(String(error))); }}><ExternalLink size={14} aria-hidden="true" />GitHub 发布说明</button>
    {(model.error || linkError) ? <p role="alert" className="brand-update-error">{model.error || linkError}</p> : null}
    <small>仅提示，不会自动下载或安装。</small>
  </dialog>, document.body);
}
