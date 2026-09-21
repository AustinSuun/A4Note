import { textItemsSeparated } from './pdfSelection';
import type { PageMeta } from './types';
export type PdfSearchMatch = { page: number; indices: number[] };
/** Literal, case-insensitive text search. Never interprets the query as a regular expression. */
export function findPdfMatches(pages: Pick<PageMeta, 'pageNumber' | 'textItems'>[], query: string, limit = 2000) {
  const trimmed = query.trim();
  const matches: PdfSearchMatch[] = [];
  if (!trimmed) return { matches, truncated: false };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = trimmed.split(/\s+/).map(escape).join('\\s+');
  const re = new RegExp(pattern, 'giu');
  for (const page of pages) {
    let text = '';
    const spans: { start: number; end: number; index: number }[] = [];
    page.textItems.forEach((item, index) => {
      const prior = page.textItems[index - 1];
      if (prior && textItemsSeparated(item, prior)) text += ' ';
      const start = text.length; text += item.text;
      spans.push({ start, end: text.length, index });
    });
    re.lastIndex = 0;
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({ page: page.pageNumber, indices: spans.filter(s => s.end > match!.index && s.start < match!.index + match![0].length).map(s => s.index) });
    }
  }
  return { matches, truncated: false };
}
