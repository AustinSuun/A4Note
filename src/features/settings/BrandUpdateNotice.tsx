import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { checkForUpdates, subscribeUpdates, updateSnapshot } from '../../platform/updater';
import { isTauriRuntime } from '../../platform/projects';
import { BrandUpdateMenu } from './BrandUpdateMenu';
import './brand-update-notice.css';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let lastAutomaticCheck = 0;
export function BrandUpdateNotice() {
  const state = useSyncExternalStore(subscribeUpdates, updateSnapshot, updateSnapshot);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const automaticCheck = () => {
      const current = updateSnapshot();
      // Never discard an available/downloaded candidate or interrupt a manual check.
      if (current.version || !['idle', 'latest', 'error'].includes(current.phase)) return;
      if (Date.now() - lastAutomaticCheck < CHECK_INTERVAL) return;
      lastAutomaticCheck = Date.now();
      void checkForUpdates();
    };
    const timer = window.setTimeout(automaticCheck, 4000);
    window.addEventListener('focus', automaticCheck);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', automaticCheck); };
  }, []);
  useEffect(() => { if (!state.version) setOpen(false); }, [state.version]);
  if (!state.version) return null;
  const label = state.phase === 'downloading' ? '下载中' : state.phase === 'installing' ? '安装中' : state.downloaded ? '可安装' : '新版本';
  return <>
    <button ref={trigger} type="button" className="brand-update-badge" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label} ${state.version}`} title={`发现新版本 ${state.version}`}
      onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={() => setOpen(true)}>
      <ArrowUpCircle size={12} aria-hidden="true" /><span>{label}</span>
    </button>
    {open && <BrandUpdateMenu key={state.version} state={state} anchor={trigger.current} onClose={() => setOpen(false)} />}
  </>;
}
