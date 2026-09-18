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
  // Accept both older semicolon-separated notes and future plain-text lists.
  // Do not split on periods: version numbers and URLs must remain intact.
  const noteText = state.notes?.trim() ?? '';
  const noteLines = noteText.slice(0, 1200).split(/[\r\n；;。]+/)
    .map(line => line.trim().replace(/^(?:[-*•]\s+|\d+[.)、]\s+)/, '').trim())
    .filter(Boolean);
  const isReminder = (line: string) => /^(?:(?:重要|注意|提醒)[：:]|升级前.*备份)/.test(line);
  const noteItems = noteLines.filter(line => !isReminder(line));
  const noteReminders = noteLines.filter(isReminder);
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
    {noteLines.length > 0 && <div className="brand-update-notes" aria-label="更新内容">
      {noteItems.length > 0 && <ul className="brand-update-note-list">
        {noteItems.map((line, index) => <li key={index}>{line}</li>)}
      </ul>}
      {noteReminders.map((line, index) => <p key={index} className="brand-update-note-reminder">{line}</p>)}
      {noteText.length > 1200 && <p className="brand-update-note-more">更多内容请查看 GitHub 发布说明。</p>}
    </div>}
    {!state.downloaded && state.phase !== 'downloading' && <button type="button" className="brand-update-primary" disabled={busy} onClick={() => void downloadUpdate()}><Download size={15} aria-hidden="true" />下载更新</button>}
    {state.phase === 'downloading' && <div className="brand-update-progress" aria-busy="true">
      <div className="brand-update-progress-meta"><span role="status">正在下载并验证…</span><span className="brand-update-progress-size">{(state.received / 1048576).toFixed(1)}{state.total ? ` / ${(state.total / 1048576).toFixed(1)}` : ''} MB</span></div>
      <progress aria-label="更新下载进度" max={state.total || undefined} value={state.total ? Math.min(state.received, state.total) : undefined} />
    </div>}
    {state.downloaded && <>
      <p role="status" className="brand-update-install-hint">已下载并通过签名校验。安装会退出软件。</p>
      <p className="brand-update-install-hint">安装前自动备份资料库数据库和库内附件；不含外部 Markdown 笔记文件夹，请自行备份。备份失败将停止安装。</p>
      {state.backupPath && <p className="brand-update-install-hint" style={{ overflowWrap: 'anywhere' }}>本次资料库备份：{state.backupPath}</p>}
      <label className="brand-update-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>我了解备份范围，同意自动备份资料库后退出安装。</span></label>
      <button type="button" className="brand-update-primary" disabled={!confirmed || busy} onClick={() => { setConfirmed(false); void installUpdate(); }}>{state.phase === 'installing' ? state.installStep === 'backing-up' ? '正在备份资料库…' : state.installStep === 'saving' ? '正在保存…' : '正在启动安装…' : '备份并安装更新'}</button>
    </>}
    <button type="button" className="brand-update-release" onClick={() => { setLinkError(''); void openReleases().catch(error => setLinkError(String(error))); }}><ExternalLink size={14} aria-hidden="true" />GitHub 发布说明</button>
    {(state.error || linkError) && <p role="alert" className="brand-update-error">{state.error || linkError}</p>}
    <small>仅提示，不会自动下载或安装。</small>
  </dialog>, document.body);
}
