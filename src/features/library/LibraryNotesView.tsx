import { PaperSignals } from '../PaperSignals';
import { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import type { PaperDocument } from '../../core/types';
import { PaperNoteList } from '../PaperNoteList';

export function LibraryNotesView({ papers, onOpenPaper, onOpenNote, onCreateNote }: {
  papers: PaperDocument[];
  onOpenPaper: (paperId: string) => void;
  onOpenNote?: (paperId: string, noteId: string) => void;
  onCreateNote?: (paperId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const count = papers.reduce((total, paper) => total + paper.notes.length, 0);
  return <div className="library-notes-view">
    <div className="library-notes-summary">{papers.length} 篇论文 · {count} 篇笔记</div>
    {papers.length ? papers.map(paper => {
      const open = !collapsed.has(paper.paperId);
      return <article className="library-paper-notes" key={paper.paperId}>
        <header>
          <button type="button" className="library-paper-notes-toggle" aria-expanded={open} onClick={() => setCollapsed(previous => {
            const next = new Set(previous); if (open) next.add(paper.paperId); else next.delete(paper.paperId); return next;
          })}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="paper-title-with-signals"><strong title={paper.title}>{paper.title}</strong><PaperSignals paper={paper} /></span>
          </button>
          <button type="button" className="paper-note-read" onClick={() => onOpenPaper(paper.paperId)}><BookOpen size={15} />阅读</button>
        </header>
        {open && <PaperNoteList paperId={paper.paperId} notes={paper.notes} onOpen={onOpenNote} onCreate={onCreateNote} />}
      </article>;
    }) : <p className="paper-notes-empty">当前筛选范围没有论文。</p>}
  </div>;
}
