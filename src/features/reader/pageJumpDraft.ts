/** A page draft belongs to one document and one page-count revision, not to scrolling. */
export type PageJumpDraft = { document: string; total: number; initial: number; value: string };
export function pageDraftMatches(draft: PageJumpDraft | null, document: string, total: number): draft is PageJumpDraft {
  return draft !== null && draft.document === document && draft.total === total;
}
export function pageJumpTarget(draft: PageJumpDraft | null, document: string, total: number, current: number): number | null {
  if (!pageDraftMatches(draft, document, total) || total < 1 || !/^\d+$/.test(draft.value)) return null;
  const target = Number(draft.value);
  if (!Number.isSafeInteger(target) || target < 1 || target > total || target === current || target === draft.initial) return null;
  return target;
}
