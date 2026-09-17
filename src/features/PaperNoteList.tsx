import { FileText, Plus } from 'lucide-react';
import type { Note } from '../core/types';
import './paper-notes.css';

export function PaperNoteList({ paperId, notes, compact = false, onOpen, onCreate }: {
  paperId: string; notes: Note[]; compact?: boolean;
  onOpen?: (paperId: string, noteId: string) => void;
  onCreate?: (paperId: string) => void;
}) {
  return <div className={`paper-note-list ${compact ? 'compact' : ''}`}>
    {notes.length ? notes.map(note => <button type="button" className="paper-note-card" key={note.id}
      disabled={!onOpen} onClick={() => onOpen?.(paperId, note.id)} title={note.title || '未命名笔记'}>
      <FileText size={16} aria-hidden="true" />
      <span className="paper-note-card-body">
        <strong>{note.title || '未命名笔记'}</strong>
        {!compact && <span className="paper-note-excerpt">{note.content.replace(/\s+/g, ' ').trim().slice(0, 140) || '尚未填写内容'}</span>}
        {!compact && <small>Markdown{note.updatedAt && Number.isFinite(Date.parse(note.updatedAt)) ? ` · ${new Date(note.updatedAt).toLocaleDateString()}` : ''}</small>}
      </span>
    </button>) : <p className="paper-notes-empty">暂无笔记</p>}
    {onCreate && <button type="button" className="paper-note-create" onClick={() => onCreate(paperId)}><Plus size={14} aria-hidden="true" />新建笔记</button>}
  </div>;
}
