import type { SummaryColumn } from './librarySummary';
import type { SummarySegment } from './summaryDocument';
import { reorderSummaryField } from './summaryFieldCatalog';

/**
 * Display order for one summary note. Field blocks follow the global field catalog; the free text that
 * was written under a field block stays attached to that block, and free text before the first block
 * stays first. This is a pure view over the parsed document: byte positions, keys and values are the
 * segments' own, so nothing here ever rewrites a note. Fields missing from the catalog keep their
 * document order after the registered ones.
 */
export function orderSummarySegments(segments: readonly SummarySegment[], columns: readonly SummaryColumn[]): SummarySegment[] {
  const rank = new Map(columns.map((column, index) => [column.id, index] as const));
  const leading: SummarySegment[] = [];
  const groups: { field: Extract<SummarySegment, { kind: 'field' }>; order: number; trail: SummarySegment[] }[] = [];
  for (const segment of segments) {
    if (segment.kind === 'field') groups.push({ field: segment, order: groups.length, trail: [] });
    else if (groups.length) groups[groups.length - 1].trail.push(segment);
    else leading.push(segment);
  }
  groups.sort((a, b) => {
    const ra = rank.get(a.field.id), rb = rank.get(b.field.id);
    if (ra === undefined && rb === undefined) return a.order - b.order;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb || a.order - b.order;
  });
  return [...leading, ...groups.flatMap(group => [group.field, ...group.trail])];
}

/** Ids of the catalog fields present in a note, in display order (what a sort handle can move between). */
export function visibleSummaryFieldIds(segments: readonly SummarySegment[], columns: readonly SummaryColumn[]): string[] {
  const known = new Set(columns.map(column => column.id));
  return orderSummarySegments(segments, columns).flatMap(segment => segment.kind === 'field' && known.has(segment.id) ? [segment.id] : []);
}

/**
 * Move `id` directly before/after `target` in the global catalog. Only the catalog order changes:
 * ids, names, visibility, widths and every note body stay untouched. Returns the same array when the
 * move is a no-op so callers can skip the save.
 */
export function moveSummaryFieldBeside(columns: readonly SummaryColumn[], id: string, target: string, side: 'before' | 'after'): SummaryColumn[] {
  if (id === target) return [...columns];
  const from = columns.findIndex(column => column.id === id), to = columns.findIndex(column => column.id === target);
  if (from < 0 || to < 0) throw new Error('字段已不在目录中，请刷新后重试。');
  const without = columns.filter(column => column.id !== id);
  const anchor = without.findIndex(column => column.id === target);
  const position = side === 'before' ? anchor : anchor + 1;
  return reorderSummaryField(columns, id, position);
}

export function sameSummaryFieldOrder(a: readonly SummaryColumn[], b: readonly SummaryColumn[]): boolean {
  return a.length === b.length && a.every((column, index) => column.id === b[index].id);
}
