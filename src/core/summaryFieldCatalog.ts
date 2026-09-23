import type { SummaryColumn } from './librarySummary';

export const summaryFieldLimit = 24;
export const summaryFieldNameLimit = 80;
const fieldId = /^[a-z][a-z0-9_-]{0,63}$/;
const nameKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en-US');

/** Display labels are never identities. These pure operations do not edit any note. */
export function summaryFieldName(value: string): string {
  if (typeof value !== 'string') throw new Error('字段名称必须是文字。');
  const name = value.trim();
  if (!name) throw new Error('字段名称不能为空。');
  if (name.length > summaryFieldNameLimit) throw new Error(`字段名称不能超过${summaryFieldNameLimit}个字符。`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('字段名称不能包含换行或控制字符。');
  return name;
}
export function validateSummaryFieldCatalog(columns: readonly SummaryColumn[]): void {
  if (columns.length > summaryFieldLimit) throw new Error(`最多支持${summaryFieldLimit}个总览字段。`);
  const ids = new Set<string>(), names = new Set<string>();
  for (const column of columns) {
    if (!fieldId.test(column.id) || ids.has(column.id)) throw new Error('字段标识无效或重复，未修改列设置。');
    const name = nameKey(summaryFieldName(column.name));
    if (names.has(name)) throw new Error('已有同名字段，请使用不同名称。');
    ids.add(column.id); names.add(name);
  }
}
export function addSummaryField(columns: readonly SummaryColumn[], id: string, name: string): SummaryColumn[] {
  const next = [...columns, { id, name: summaryFieldName(name), kind: 'mixed' as const, width: 220 }];
  validateSummaryFieldCatalog(next);
  return next;
}
export function renameSummaryField(columns: readonly SummaryColumn[], id: string, name: string): SummaryColumn[] {
  if (!columns.some(column => column.id === id)) throw new Error('字段已不存在，请刷新后重试。');
  const displayName = summaryFieldName(name);
  const next = columns.map(column => column.id === id ? { ...column, name: displayName } : column);
  validateSummaryFieldCatalog(next);
  return next;
}
export function reorderSummaryField(columns: readonly SummaryColumn[], id: string, position: number): SummaryColumn[] {
  const current = columns.findIndex(column => column.id === id);
  if (current < 0 || !Number.isInteger(position) || position < 0 || position >= columns.length) throw new Error('字段排序位置无效。');
  const next = [...columns], [column] = next.splice(current, 1);
  next.splice(position, 0, column);
  return next;
}
