import type { TextDocumentSession } from '../../core/textDocumentSession';
import { parseSummaryLayout, type SummaryColumn } from '../../core/librarySummary';
import { validateSummaryFieldCatalog } from '../../core/summaryFieldCatalog';

/** Shared catalog CAS path. Never provisions or edits any paper/note. */
export async function saveSummaryFieldCatalog(session: TextDocumentSession, next: SummaryColumn[], baseline: SummaryColumn[]): Promise<void> {
  validateSummaryFieldCatalog(next);
  const current = parseSummaryLayout(session.getSnapshot().content);
  const actual = JSON.stringify(current.columns);
  if (actual !== JSON.stringify(baseline) && actual !== JSON.stringify(next)) throw new Error('列设置已变化，请关闭并重新打开字段目录；未覆盖其他修改。');
  const text = JSON.stringify({ ...current.raw, version: 2, columns: next }, null, 2) + '\n';
  parseSummaryLayout(text);
  session.update(text);
  await session.flush();
  if (session.dirty() || JSON.stringify(parseSummaryLayout(session.getSnapshot().content).columns) !== JSON.stringify(next)) throw new Error('保存期间列设置发生变化，请重试或重新打开目录确认。');
}
