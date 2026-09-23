import { summaryFieldBlocks, updateSummaryField, type SummaryColumn } from './librarySummary';

/** Map CodeMirror's LF document back to raw offsets; untouched mixed EOLs stay intact. */
export function summaryEditorPatch(raw: string, edited: string): string {
  const normalized = raw.replace(/\r\n?|\n/g, '\n');
  const next = edited.replace(/\r\n?|\n/g, '\n');
  if (normalized === next) return raw;
  let from = 0, end = normalized.length, nextEnd = next.length;
  while (from < end && from < nextEnd && normalized[from] === next[from]) from++;
  while (end > from && nextEnd > from && normalized[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  const offsets = [0];
  for (let i = 0; i < raw.length;) { if (raw[i++] === '\r' && raw[i] === '\n') i++; offsets.push(i); }
  const eol = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n';
  return raw.slice(0, offsets[from]) + next.slice(from, nextEnd).replace(/\n/g, eol) + raw.slice(offsets[end]);
}

/** An ordinary field edit cannot insert a new marker or alter another field. */
export function replaceSummaryFieldText(source: string, current: string, column: Pick<SummaryColumn, 'id' | 'name' | 'source'>, value: string, create = false): string {
  if (source !== current) throw new Error('笔记已变化，请保留草稿并重新打开此区域。');
  if (column.source) throw new Error('论文信息不能写入总结字段。');
  const before = summaryFieldBlocks(source), field = before.get(column.id);
  if (!field && !create) throw new Error('请先明确添加字段到本篇。');
  if (field?.value === value) return current;
  const next = updateSummaryField(source, column, value), after = summaryFieldBlocks(next);
  if (after.size !== before.size + (field ? 0 : 1) || after.get(column.id)?.value !== value) throw new Error('编辑会改变字段映射，未应用；请使用高级源码核对。');
  for (const [id, original] of before) {
    if (id === column.id) continue;
    const saved = after.get(id);
    if (!saved || source.slice(original.blockStart, original.blockEnd) !== next.slice(saved.blockStart, saved.blockEnd)) throw new Error('编辑会改变其他字段，未应用。');
  }
  return next;
}
