import type { PaperDocument } from './types';
export type SummaryColumn = { id: string; name: string; kind: 'text' | 'mixed' | 'image' | 'note'; width: number; hidden?: boolean; source?: 'venue' };
export const defaultSummaryColumns: SummaryColumn[] = [
  { id: 'online', name: 'online 时间', kind: 'text', width: 120, hidden: true },
  { id: 'venue', name: '期刊/会议', kind: 'text', source: 'venue', width: 150, hidden: true },
  { id: 'abstract', name: '主要功能', kind: 'text', width: 210 },
  { id: 'code', name: '代码', kind: 'text', width: 130 },
  { id: 'dataset', name: '数据集', kind: 'text', width: 160 },
  { id: 'figure', name: '结构', kind: 'mixed', width: 220 },
  { id: 'evaluation', name: '评估与指标', kind: 'text', width: 195 },
  { id: 'finding', name: '备注', kind: 'text', width: 150 },
  { id: 'note', name: '关联笔记', kind: 'note', width: 220, hidden: true },
];
export interface SummaryField { id: string; start: number; end: number; value: string }
/** Parse only our explicit field nodes. All other Markdown/metadata stays byte-for-byte intact.
 * Fenced code is opaque; ambiguous/nested/duplicate nodes fail closed, never rewritten. */
export function summaryFields(markdown: string): Map<string, SummaryField> {
  const fields = new Map<string, SummaryField>();
  let offset = 0, fence = '', fenceLength = 0;
  let current: { id: string; start: number; heading: boolean } | undefined;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const plain = line.replace(/\r?\n$/, '');
    const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(plain);
    if (code) {
      if (current) current.heading = false;
      if (!fence) { fence = code[1][0]; fenceLength = code[1].length; }
      else if (code[1][0] === fence && code[1].length >= fenceLength && !code[2].trim()) fence = '';
      offset += line.length; continue;
    }
    if (!fence) {
      const marker = /^<!-- (\/?)a4-summary:([a-z][a-z0-9_-]{0,63}) -->$/.exec(plain);
      if (marker) {
        const [, close, id] = marker;
        if (!close) {
          if (current || fields.has(id)) throw new Error('总结字段标记重复或嵌套，请在完整 Markdown 中修复后再编辑单元格。');
          current = { id, start: offset + line.length, heading: true };
        } else {
          if (!current || current.id !== id) throw new Error('总结字段结束标记不匹配，请先修复 Markdown。');
          fields.set(id, { id, start: current.start, end: offset, value: markdown.slice(current.start, offset).replace(/\r?\n$/, '') });
          current = undefined;
        }
      } else if (current?.heading) {
        if (/^## /.test(plain)) current.start = offset + line.length;
        current.heading = false;
      }
    }
    offset += line.length;
  }
  if (current) throw new Error('总结字段缺少结束标记，请先修复 Markdown。');
  return fields;
}
export function updateSummaryField(markdown: string, column: Pick<SummaryColumn, 'id' | 'name'>, value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(column.id)) throw new Error('字段标识无效');
  const fields = summaryFields(markdown), field = fields.get(column.id);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const next = field
    ? markdown.slice(0, field.start) + value + eol + markdown.slice(field.end)
    : markdown + (markdown.endsWith('\n') ? eol : eol + eol) + `<!-- a4-summary:${column.id} -->${eol}## ${column.name.replace(/[\r\n]/g, ' ')}${eol}${value}${eol}<!-- /a4-summary:${column.id} -->${eol}`;
  const checked = summaryFields(next);
  if (!checked.has(column.id)) throw new Error('字段位于未闭合的代码块中，请先在完整 Markdown 中修复。');
  return next;
}
export function summaryExcerpt(value: string, zoom: number): string {
  const max = zoom <= 45 ? 80 : zoom <= 65 ? 160 : 500;
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, '〔图片〕').replace(/\s+/g, ' ').slice(0, max);
}
export function parseSummaryLayout(text: string): { columns: SummaryColumn[]; raw: Record<string, unknown> } {
  if (!text) return { columns: defaultSummaryColumns.map(c => ({ ...c })), raw: { version: 2 } };
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.columns) || raw.columns.length > 24) throw new Error('列设置版本或内容不支持，已停止覆盖。');
  const ids = new Set<string>();
  const columns = raw.columns.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('列设置损坏');
    const c = item as SummaryColumn;
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(c.id) || ids.has(c.id) || typeof c.name !== 'string' || c.name.length > 80 || !['text', 'mixed', 'image', 'note'].includes(c.kind) || !Number.isFinite(c.width) || c.width < 80 || c.width > 800 || (c.source !== undefined && (c.id !== 'venue' || c.source !== 'venue'))) throw new Error('列设置无效，已停止覆盖。');
    ids.add(c.id); return { ...c };
  });
  // v1 used two standalone metadata columns. Migrate presentation only; keep IDs/data.
  return { raw: { ...raw, version: 2 }, columns: raw.version === 1 ? columns.map(c => c.id === 'online' || c.id === 'venue' ? { ...c, hidden: true } : c) : columns };

}
export function summaryRowHeight(zoom: number): number { return zoom <= 65 ? (zoom <= 45 ? 44 : 68) : zoom < 120 ? 128 : 250; }

/** Display source metadata even when the paper has no summary file. Never infer online dates. */
export function summaryPaperMetadata(paper: Pick<PaperDocument, 'title' | 'year' | 'venue'>) {
  return {
    title: paper.title.trim() || '未命名文献',
    year: typeof paper.year === 'number' && Number.isInteger(paper.year) && paper.year > 0 ? String(paper.year) : '',
    venue: paper.venue.trim(),
  };
}

export type SummarySizing = { mode: 'manual' | 'window'; titleWidth: number };
export function summarySizing(raw: Record<string, unknown>): SummarySizing {
  const value = raw.sizing as Partial<SummarySizing> | undefined;
  return { mode: value?.mode === 'window' ? 'window' : 'manual', titleWidth: typeof value?.titleWidth === 'number' && Number.isFinite(value.titleWidth) ? Math.max(180, Math.min(800, value.titleWidth)) : 280 };
}
/** Weighted window fit with readable minima and a bounded maximum. Too narrow
 * means horizontal scrolling, not unreadable columns; never mutates saved widths. */
export function fitSummaryWidths(available: number, desired: readonly number[]): number[] {
  const widths = desired.map((_, i) => i === 0 ? 180 : 80);
  let remaining = Math.max(0, Math.floor(available) - widths.reduce((a, b) => a + b, 0));
  while (remaining > 0) {
    const indices = widths.map((_, i) => i).filter(i => widths[i] < 800);
    if (!indices.length) break;
    const weight = indices.reduce((sum, i) => sum + Math.max(1, desired[i]), 0);
    const budget = remaining;
    for (const i of indices) {
      const add = Math.min(800 - widths[i], remaining, Math.max(1, Math.floor(budget * Math.max(1, desired[i]) / weight)));
      widths[i] += add; remaining -= add;
    }
  }
  return widths;
}
