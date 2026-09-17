import { useState } from 'react';
import type { Note } from '../../core/types';
import { PaperNoteList } from '../PaperNoteList';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

export interface ReaderSidebarOpenItem {
  id: string;
  title: string;
  hint?: string;
  active?: boolean;
  paperId?: string;
  notes?: Note[];
}

export interface ReaderSceneSidebarProps {
  openItems?: ReaderSidebarOpenItem[];
  onSelectItem?: (itemId: string) => void;
  onCloseItem?: (itemId: string) => void;
  onOpenNote?: (paperId: string, noteId: string) => void;
  onCreateNote?: (paperId: string) => void;
}

/** Open-document navigator owned by the reader scene plugin. */
export function ReaderSceneSidebar({ openItems = [], onSelectItem, onCloseItem, onOpenNote, onCreateNote }: ReaderSceneSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return (
    <div className="scene-context-sidebar reader-scene-sidebar">
      <div className="scene-context-sidebar-heading">正在阅读</div>
      {openItems.length === 0 ? (
        <p className="workbench-sidebar-hint">暂无打开文档</p>
      ) : (
        <ul className="scene-context-list">
          {openItems.map((item) => (
            <li key={item.id} className={item.active ? 'active' : undefined}>
              <div className="reader-paper-row">
              {item.paperId && <button type="button" className="reader-paper-expand" aria-label={`展开或收起笔记：${item.title}`} aria-expanded={expanded.has(item.id)} onClick={() => setExpanded(previous => {
                const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
              })}>{expanded.has(item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
              <button type="button" className="scene-context-item" onClick={() => onSelectItem?.(item.id)} title={item.hint ?? item.title}>
                <span><span className="scene-context-item-title">{item.title}</span>{item.paperId && <small className="reader-paper-note-count">{item.notes?.length ?? 0} 篇笔记</small>}</span>
              </button>
              {onCloseItem && <button type="button" className="scene-context-item-close" title="关闭" aria-label={`关闭 ${item.title}`} onClick={() => onCloseItem(item.id)}><X size={13} aria-hidden="true" /></button>}
              </div>
              {item.paperId && expanded.has(item.id) && <PaperNoteList compact paperId={item.paperId} notes={item.notes ?? []} onOpen={onOpenNote} onCreate={onCreateNote} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
