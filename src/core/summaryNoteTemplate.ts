import { parseSummaryLayout } from './librarySummary';

/** New notes have no implicit fields. Catalog changes never rewrite note bodies. */
export function summaryNoteTemplate(layoutText: string): string {
  parseSummaryLayout(layoutText); // Keep corrupt settings fail-closed; do not repair silently.
  return '';
}
