import { BookMarked } from 'lucide-react';
import './overview-note-badge.css';

/** Only render for the explicitly bound note ID, never inferred from its title. */
export function OverviewNoteBadge() {
  return <span className="overview-note-badge" title="本篇文献的总览笔记：可写目录、一览或总结；指定字段关联总览表。">
    <BookMarked size={12} aria-hidden="true" />总览笔记
  </span>;
}
