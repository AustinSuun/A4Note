import { ArrowRight, FolderOpen, FolderPlus } from 'lucide-react';
import './note-workspace-empty.css';

export function NoteWorkspaceEmpty({ pending, onOpen, onCreate }: {
  pending: boolean; onOpen: () => void; onCreate: () => void;
}) {
  return <div className="note-workspace-empty">
    <div className="note-workspace-empty-title">尚未打开工作区</div>
    <p className="note-workspace-empty-intro">选择一种方式开始</p>
    <button type="button" className="note-workspace-empty-open" disabled={pending} onClick={onOpen}>
      <FolderOpen size={19} aria-hidden="true" />
      <span><strong>打开文件夹</strong><small>继续使用已有笔记</small></span>
      <ArrowRight size={15} aria-hidden="true" />
    </button>
    <button type="button" className="note-workspace-empty-create" disabled={pending} onClick={onCreate}>
      <FolderPlus size={19} aria-hidden="true" />
      <span><strong>新建笔记库</strong><small>从一个空文件夹开始</small></span>
      <ArrowRight size={15} aria-hidden="true" />
    </button>
    <p className="note-workspace-empty-format"><span>.md</span> Markdown 笔记 · 本地保存</p>
  </div>;
}
