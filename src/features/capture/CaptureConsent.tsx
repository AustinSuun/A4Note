import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FolderTree, Globe2, LockKeyhole, X } from 'lucide-react';
import { Button } from '../../shared/ui';
import { captureSupported, getCaptureConsent, respondCaptureConsent, subscribeCaptureConsent } from '../../platform/capture';
import './capture-consent.css';

/** Mounted once beside the app, independent of the active scene or settings page. */
export function CaptureConsent() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const activeRequest = useRef<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const epoch = useRef(0);
  const alive = useRef(false);
  useEffect(() => {
    if (!captureSupported()) return;
    alive.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      if (disposed || saving.current) return;
      const version = ++epoch.current;
      try {
        const result = await getCaptureConsent();
        if (!disposed && version === epoch.current && !saving.current) {
          if (activeRequest.current !== result.requestId) setError('');
          activeRequest.current = result.requestId;
          setRequestId(result.requestId);
        }
      } catch { /* Startup or IPC unavailable: never infer approval. */ }
    };
    refreshRef.current = () => { void refresh(); };
    void subscribeCaptureConsent(refreshRef.current).then(stop => {
      if (disposed) stop(); else { unlisten = stop; void refresh(); }
    }).catch(() => { void refresh(); });
    // Recover from a missed event or a webview reload; no browser request is created.
    const timer = setInterval(() => { void refresh(); }, 10000);
    void refresh();
    return () => { disposed = true; alive.current = false; ++epoch.current; clearInterval(timer); unlisten?.(); };
  }, []);
  const respond = async (allowed: boolean) => {
    if (!requestId || saving.current) return;
    saving.current = true; ++epoch.current; setBusy(true); setError('');
    try {
      await respondCaptureConsent(requestId, allowed);
      if (alive.current) setRequestId(null);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      saving.current = false;
      if (alive.current) { setBusy(false); refreshRef.current(); }
    }
  };
  return requestId ? <ConsentDialog key={requestId} busy={busy} error={error} onDecision={allowed => { void respond(allowed); }} /> : null;
}

function ConsentDialog({ busy, error, onDecision }: { busy: boolean; error: string; onDecision: (allowed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-consent-deny]')?.focus();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="capture-consent" aria-labelledby="capture-consent-title" aria-describedby="capture-consent-description" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!busy) onDecision(false); }}>
    <header className="capture-consent__header">
      <span className="capture-consent__brand"><Globe2 size={19} aria-hidden="true" /> A4 Note · 浏览器连接</span>
      <Button variant="subtle" className="capture-consent__close" disabled={busy} aria-label="暂不允许并关闭" onClick={() => onDecision(false)}><X size={18} aria-hidden="true" /></Button>
    </header>
    <div className="capture-consent__body">
      <h2 id="capture-consent-title">连接浏览器扩展</h2>
      <p id="capture-consent-description">允许 A4 Note 论文采集扩展连接本机软件？</p>
      <ul className="capture-consent__permissions">
        <li><FileDown size={20} aria-hidden="true" /><div><strong>采集论文与 PDF</strong><span>提交论文信息和文件，加入你选择的文献分类。</span></div></li>
        <li><FolderTree size={20} aria-hidden="true" /><div><strong>查看分类与采集进度</strong><span>读取文献库分类和任务状态，确认下载与入库结果。</span></div></li>
      </ul>
      <p className="capture-consent__privacy"><LockKeyhole size={15} aria-hidden="true" /><span>授权仅保存在本机，重启后无需重复确认。<br />可在设置中随时撤销；外部元数据补全也可单独关闭。</span></p>
      {error && <p className="capture-consent__error" role="alert">{error}</p>}
    </div>
    <footer className="capture-consent__footer">
      <span>关闭或超时均不会授权</span>
      <div><Button data-consent-deny disabled={busy} onClick={() => onDecision(false)}>暂不允许</Button><Button variant="primary" disabled={busy} onClick={() => onDecision(true)}>{busy ? '正在处理…' : '允许并记住'}</Button></div>
    </footer>
  </dialog>, document.body);
}
