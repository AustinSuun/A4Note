import { parseSummaryLayout, updateSummaryField } from './librarySummary';

/** Shared by explicit creation and automatic provisioning; never copies old text. */
export function summaryNoteTemplate(layoutText: string): string {
  const { columns } = parseSummaryLayout(layoutText);
  let content = '# 总结笔记\n\n此笔记的字段与论文总览同步。请保留 a4-summary 字段标记；可在字段外自由写作。\n';
  for (const column of columns.filter(c => !c.source)) content = updateSummaryField(content, column, '');
  return content;
}
