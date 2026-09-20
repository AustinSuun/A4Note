import { useEffect, useRef, useState } from 'react';
import { selectProjectFolder } from '../../platform/projectTaskLauncher';
import { createTaskProjectFolder } from '../../platform/projectTaskCreation';

export function TaskCreateProjectDialog({ onClose, onCreated }: {
  onClose: () => void; onCreated: (path: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="tb-create-project-dialog tb-modal" aria-labelledby="tb-create-project-title"
    onCancel={e => { e.preventDefault(); if (!lock.current) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const path = await createTaskProjectFolder(parent, name);
      onCreated(path);
    }); }}>
      <h2 id="tb-create-project-title">新建项目</h2>
      <p>在选定位置创建一个新文件夹，再连接该项目独立的任务看板。不会覆盖已有目录。</p>
      <label>项目名称<input autoFocus required value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <label>保存位置<input readOnly value={parent} placeholder="尚未选择文件夹" /></label>
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        const chosen = await selectProjectFolder('选择新项目的保存位置');
        if (chosen) setParent(chosen);
      })}>选择保存位置</button>
      <p className="tb-project-location">{parent && name.trim() ? `${parent.replace(/[\\/]$/, '')}/${name.trim()}` : '创建后可添加任务；文件不会自动转换为任务。'}</p>
      {error && <p role="alert" className="tb-error">{error}</p>}
      <div className="tb-modal-actions">
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" className="tb-primary" disabled={busy || !parent || !name.trim()}>{busy ? '处理中…' : '创建并打开看板'}</button>
      </div>
    </form>
  </dialog>;
}
