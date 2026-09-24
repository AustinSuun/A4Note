import { useEffect, useRef, useState } from 'react';

/** In-app confirmation works identically in browsers and the native webview. */
export function ConfirmActionButton({ label, prompt, disabled, onConfirm, onError }: {
  label: string; prompt: string; disabled?: boolean;
  onConfirm: () => void | Promise<void>; onError: (error: unknown) => void;
}) {
  const [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (armed) confirm.current?.focus(); }, [armed]);
  const cancel = () => { setArmed(false); requestAnimationFrame(() => trigger.current?.focus()); };
  if (!armed) return <button ref={trigger} type="button" disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return <span role="group" aria-label={`确认${label}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancel(); }
  }}>
    <span>{prompt}</span>
    <button ref={confirm} type="button" disabled={disabled || busy} onClick={async () => {
      setBusy(true);
      try { await onConfirm(); setArmed(false); }
      catch (error) { onError(error); }
      finally { setBusy(false); }
    }}>{busy ? '正在处理…' : `确认${label}`}</button>
    <button type="button" disabled={busy} onClick={cancel}>保留草稿</button>
  </span>;
}
