import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { isTauriRuntime } from '../../platform/projects';
import { updateActions, useUpdateModel, type UpdateModel } from './updateModel';
import { BrandUpdateMenu } from './BrandUpdateMenu';
import './brand-update-notice.css';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let lastAutomaticCheck = 0;

/* Pure decision helper so the "never discard a candidate / never interrupt a
   running phase / at most once per interval" rules are testable in isolation. */
export function shouldAutoCheck(model: Pick<UpdateModel, 'version' | 'phase'>, now: number) {
  if (model.version) return false;
  if (!['idle', 'latest', 'error'].includes(model.phase)) return false;
  if (now - lastAutomaticCheck < CHECK_INTERVAL) return false;
  lastAutomaticCheck = now;
  return true;
}

export function BrandUpdateNotice() {
  const model = useUpdateModel();
  const latest = useRef(model);
  latest.current = model;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const automaticCheck = () => { if (shouldAutoCheck(latest.current, Date.now())) void updateActions.check(); };
    const timer = window.setTimeout(automaticCheck, 4000);
    window.addEventListener('focus', automaticCheck);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', automaticCheck); };
  }, []);
  useEffect(() => { if (!model.version) setOpen(false); }, [model.version]);
  if (!model.version) return null;
  const label = model.phase === 'downloading' ? '下载中' : model.phase === 'installing' ? model.installStep === 'backing-up' ? '备份中' : '安装中' : model.downloaded ? '可安装' : '新版本';
  return <>
    <button ref={trigger} type="button" className="brand-update-badge" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label} ${model.version}`} title={`发现新版本 ${model.version}`}
      onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={() => setOpen(true)}>
      <ArrowUpCircle size={12} aria-hidden="true" /><span>{label}</span>
    </button>
    {open && <BrandUpdateMenu key={model.version} anchor={trigger.current} onClose={() => setOpen(false)} />}
  </>;
}
