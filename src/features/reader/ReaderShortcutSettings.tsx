import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutEditor } from '../../shared/shortcuts';

export function ReaderShortcutSettings() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      if (e.key === 'Tab') {
        const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])];
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); else trigger.current?.focus(); };
  }, [open]);
  return <><button type="button" className="annotation-tool-btn" aria-label="阅读器快捷键设置" ref={trigger} onClick={() => setOpen(true)} title="阅读器快捷键设置" aria-haspopup="dialog"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/></svg></button>
    {open && createPortal(<div className="shortcut-reader-settings" onPointerDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reader-shortcut-heading" aria-describedby="reader-shortcut-summary" tabIndex={-1}>
        <header className="shortcut-reader-header"><div><span className="shortcut-reader-eyebrow">阅读器设置</span><h2 id="reader-shortcut-heading">快捷键</h2><p id="reader-shortcut-summary">查看、重新绑定或恢复阅读器命令</p></div><button className="shortcut-reader-done" type="button" onClick={() => setOpen(false)}>完成</button></header>
        <ShortcutEditor sceneId="reader" />
      </section>
    </div>, document.body)}
  </>;
}
