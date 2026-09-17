import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, FolderOpen, FolderPlus, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { createDirectory, describeProjectFolder, selectProjectFolder, type ProjectFolderInfo } from '../../platform/projects';
import './note-library-dialog.css';

/** Native modal keeps keyboard focus inside the flow, including the OS folder picker. */
export function NoteLibraryDialog({ onSelect, onClose, initialMode = 'choice' }: {
  onSelect: (folder: ProjectFolderInfo) => void; onClose: () => void; initialMode?: 'choice' | 'create';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const locked = useRef(false);
  const titleId = useId();
  const [mode, setMode] = useState<'choice' | 'create'>(initialMode);
  const [parent, setParent] = useState('');
  const [name, setName] = useState('我的笔记库');
  const [createdPath, setCreatedPath] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    alive.current = true;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      alive.current = false;
      dialog?.close();
      if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus({ preventScroll: true });
    };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setPending(true); setError('');
    try { await operation(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { locked.current = false; if (alive.current) setPending(false); }
  };
  const finish = async (path: string) => {
    const info = await describeProjectFolder(path);
    if (!alive.current) return;
    if (!info.exists || !info.is_directory) throw new Error('文件夹不存在或无法访问，请重新选择。');
    onSelect(info);
  };
  const existing = () => run(async () => {
    const path = await selectProjectFolder();
    if (path && alive.current) await finish(path);
  });
  const chooseParent = () => run(async () => {
    const path = await selectProjectFolder();
    if (!path || !alive.current) return;
    const info = await describeProjectFolder(path);
    if (!alive.current) return;
    if (!info.exists || !info.is_directory) throw new Error('保存位置不是可用的文件夹。');
    setParent(info.path);
  });
  const create = () => run(async () => {
    if (createdPath) { await finish(createdPath); return; }
    const trimmed = name.trim();
    if (!parent) throw new Error('请先选择笔记库的保存位置。');
    if (!trimmed || trimmed.startsWith('.') || trimmed.endsWith('.') || new TextEncoder().encode(trimmed).length > 120
      || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(trimmed)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) {
      throw new Error('请输入有效的文件夹名称，不含路径分隔符、系统保留名称或首尾句点。');
    }
    const path = `${parent.replace(/[\\/]+$/, '')}/${trimmed}`;
    // The existing backend uses create_dir, not create_dir_all: same-name entries fail, never overwrite.
    if (!alive.current) return;
    await createDirectory(parent, trimmed);
    if (!alive.current) return;
    setCreatedPath(path);
    await finish(path);
  });
  return createPortal(<dialog ref={ref} className="note-library-dialog" aria-labelledby={titleId} aria-modal="true"
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!locked.current) onClose(); }}>
    <header><div className="note-library-heading"><span className="note-library-heading-icon"><BookOpen size={20} aria-hidden="true" /></span><div><h2 id={titleId}>{mode === 'choice' ? '打开笔记库' : '新建笔记库'}</h2><p>{mode === 'choice' ? '从已有笔记继续，或开始新的记录' : '给笔记一个专属空间'}</p></div></div>
      <button type="button" className="note-library-close" disabled={pending} onClick={onClose} aria-label="关闭" title="关闭"><X size={18} aria-hidden="true" /></button></header>
    {mode === 'choice' ? <div className="note-library-options">
      <button type="button" disabled={pending} onClick={() => void existing()} autoFocus>
        <span className="note-library-option-icon"><FolderOpen size={24} aria-hidden="true" /></span>
        <span className="note-library-option-copy"><strong>打开已有笔记</strong><span className="note-library-option-description">选择存放 Markdown 笔记的文件夹</span></span>
        <ArrowRight className="note-library-option-arrow" size={18} aria-hidden="true" />
      </button>
      <button type="button" disabled={pending} onClick={() => { setError(''); setMode('create'); }}>
        <span className="note-library-option-icon"><FolderPlus size={24} aria-hidden="true" /></span>
        <span className="note-library-option-copy"><strong>新建笔记库</strong><span className="note-library-option-description">选个位置，创建专属笔记文件夹</span></span>
        <ArrowRight className="note-library-option-arrow" size={18} aria-hidden="true" />
      </button>
    </div> : <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <label>笔记库名称<input autoFocus value={name} disabled={pending || !!createdPath} onChange={event => setName(event.target.value)} placeholder="例如：学习笔记" /></label>
      <label>保存位置<div className="note-library-location"><span title={parent}>{parent || '尚未选择保存位置'}</span>
        <button type="button" disabled={pending || !!createdPath} onClick={() => void chooseParent()}>选择位置…</button></div></label>
      <p>将在所选位置内创建一个新文件夹，不覆盖任何同名文件或文件夹。</p>
      {createdPath && <p>文件夹已创建：{createdPath}。如果打开失败，可重试打开，或稍后从“已有笔记”选择它。</p>}
      <footer><button type="button" disabled={pending} onClick={() => { setMode('choice'); setError(''); setCreatedPath(''); }}>返回</button>
        <button type="submit" className="note-library-primary" disabled={pending || (!createdPath && (!parent || !name.trim()))}>{createdPath ? '重试打开笔记库' : '创建笔记库'}</button></footer>
    </form>}
    {mode === 'choice' && <p className="note-library-safety"><ShieldCheck size={14} aria-hidden="true" /><span>已有笔记直接使用，不复制、不迁移</span></p>}
    {pending && <p className="note-library-progress" role="status"><LoaderCircle size={15} aria-hidden="true" />正在处理，请稍候…</p>}
    {error && <p className="note-library-error" role="alert">{error}</p>}
  </dialog>, document.body);
}
