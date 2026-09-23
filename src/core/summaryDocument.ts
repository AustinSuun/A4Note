import { summaryFieldBlocks, updateSummaryField, type SummaryColumn } from './librarySummary';

export type SummarySegment =
  | { kind: 'free'; key: string; start: number; end: number; value: string }
  | { kind: 'field'; key: string; id: string; start: number; end: number; bodyStart: number; bodyEnd: number; value: string };
export type SummaryDocument = { source: string; segments: SummarySegment[] };
export type SummaryAssignment = { scope: string; baseline: string; next: string; fieldId: string; selected: string; previousValue: string; createsField: boolean };

/** The original string is authoritative; no reconstruction from the field Map. */
export function summaryDocument(source: string): SummaryDocument {
  const segments: SummarySegment[] = [];
  let cursor = 0;
  for (const field of summaryFieldBlocks(source).values()) {
    if (field.blockStart > cursor) segments.push({ kind: 'free', key: `free:${cursor}`, start: cursor, end: field.blockStart, value: source.slice(cursor, field.blockStart) });
    segments.push({ kind: 'field', key: `field:${field.id}`, id: field.id, start: field.blockStart, end: field.blockEnd, bodyStart: field.start, bodyEnd: field.end, value: field.value });
    cursor = field.blockEnd;
  }
  if (cursor < source.length || !segments.length) segments.push({ kind: 'free', key: `free:${cursor}`, start: cursor, end: source.length, value: source.slice(cursor) });
  return { source, segments };
}
function unchanged(expected: string, current: string): void {
  if (expected !== current) throw new Error('笔记已发生变化，请保留原文并重新选择；未应用归类或编辑。');
}
function sameFields(before: string, after: string): void {
  const a = summaryFieldBlocks(before), b = summaryFieldBlocks(after);
  if (a.size !== b.size || [...a].some(([id, field]) => {
    const next = b.get(id);
    return !next || before.slice(field.blockStart, field.blockEnd) !== after.slice(next.blockStart, next.blockEnd);
  })) throw new Error('自由笔记编辑不能改变字段映射，请使用添加字段或高级源码。');
}
/** Free text may surround any field. Never move it to a synthetic footer. */
export function replaceSummaryFreeText(document: SummaryDocument, current: string, key: string, value: string): string {
  unchanged(document.source, current);
  const segment = document.segments.find(item => item.key === key);
  if (!segment || segment.kind !== 'free') throw new Error('自由笔记区域已变化，请重新打开。');
  if (segment.value === value) return current;
  const next = current.slice(0, segment.start) + value + current.slice(segment.end);
  sameFields(current, next);
  return next;
}
function boundary(source: string, position: number): boolean {
  if (!Number.isInteger(position) || position < 0 || position > source.length) return false;
  const before = source.charCodeAt(position - 1), after = source.charCodeAt(position);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) && !(source[position - 1] === '\r' && source[position] === '\n');
}
/** Preview only: callers must explicitly confirm, CAS-save, then publish the result.
 * No optimistic removal of the original free text is performed here. */
export function planSummaryAssignment(document: SummaryDocument, selection: { from: number; to: number; text: string }, column: Pick<SummaryColumn, 'id' | 'name' | 'source'>, options: { scope: string; mode: 'append' | 'fill-empty'; createIfMissing: boolean }): SummaryAssignment {
  if (!options.scope) throw new Error('缺少论文/笔记身份，未创建归类操作。');
  const source = document.source, { from, to, text } = selection;
  if (!boundary(source, from) || !boundary(source, to) || from >= to || !text.trim() || source.slice(from, to) !== text) throw new Error('所选原文已变化或范围无效，请重新选择。');
  if (!document.segments.some(item => item.kind === 'free' && from >= item.start && to <= item.end)) throw new Error('只能归类同一个自由笔记区域内明确选中的内容。');
  if (column.source) throw new Error('论文元数据列不是可写总览字段。');
  const field = summaryFieldBlocks(source).get(column.id);
  if (!field && !options.createIfMissing) throw new Error('本篇尚未添加该字段，请明确确认添加后再归类。');
  if (field?.value.trim() && options.mode !== 'append') throw new Error('目标字段已有内容，请明确选择追加或取消，不会覆盖。');
  const previousValue = field?.value ?? '', eol = source.includes('\r\n') ? '\r\n' : '\n';
  const removed = source.slice(0, from) + source.slice(to);
  // Removing a code fence or newline must not reclassify unrelated text/fields.
  sameFields(source, removed);
  const nextValue = previousValue + (previousValue ? eol + eol : '') + text;
  const next = updateSummaryField(removed, column, nextValue);
  const beforeFields = summaryFieldBlocks(source), afterFields = summaryFieldBlocks(next);
  if (afterFields.size !== beforeFields.size + (field ? 0 : 1) || afterFields.get(column.id)?.value !== nextValue) throw new Error('归类内容改变了字段映射，请保留原文并改用高级源码核对。');
  for (const [id, original] of beforeFields) {
    if (id === column.id) continue;
    const after = afterFields.get(id);
    if (!after || source.slice(original.blockStart, original.blockEnd) !== next.slice(after.blockStart, after.blockEnd)) throw new Error('归类会改变其它字段，已停止。');
  }
  return { scope: options.scope, baseline: source, next, fieldId: column.id, selected: text, previousValue, createsField: !field };
}
export function confirmedSummaryAssignment(plan: SummaryAssignment, current: string, scope: string): string {
  if (plan.scope !== scope) throw new Error('论文或笔记已切换，请回到原笔记重新选择；未应用归类。');
  unchanged(plan.baseline, current);
  return plan.next;
}
