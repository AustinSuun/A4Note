import type { PaperDocument } from '../core/types';
import './paper-signals.css';

/** Shared paper-status baseline for list, overview and notes views. */
export function PaperSignals({ paper }: { paper: PaperDocument }) {
  const incomplete = !paper.title.trim() || !paper.authors.trim() || !paper.year || !paper.venue.trim();
  return <span className="paper-status-badges" aria-label="论文状态">
    <span className={`paper-status-badge ${paper.sourcePdf ? 'ready' : 'missing'}`}>{paper.sourcePdf ? 'PDF' : '缺 PDF'}</span>
    {paper.translatedPdfs.length > 0 && <span className="paper-status-badge translated" title={`${paper.translatedPdfs.length} 份译文`}>译 {paper.translatedPdfs.length}</span>}
    {paper.annotations.length > 0 && <span className="paper-status-badge annotated" title={`${paper.annotations.length} 条标注`}>注 {paper.annotations.length}</span>}
    <span className="paper-status-badge notes" title={`${paper.notes.length} 篇笔记`}>笔记 {paper.notes.length}</span>
    {incomplete && <span className="paper-status-badge metadata" title="论文元数据待补全">待补全</span>}
  </span>;
}
