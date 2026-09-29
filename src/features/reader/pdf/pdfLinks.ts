/**
 * PDF link annotations for the reader (card e4c2fa22).
 *
 * pdf.js exposes `/Link` annotations through `page.getAnnotations({ intent: 'display' })`; the reader
 * does not use its AnnotationLayer or a linkService. Every geometry value leaving this module is a
 * percentage of the page's default viewport (`getViewport({ scale: 1 })`) — the same box the bitmap,
 * the text layer and the annotation overlay share (pdfCoordinates.ts). Zoom, /Rotate and the crop box
 * offset are already folded into the viewport transform, so callers must never multiply by zoom or DPR.
 */
import type { PageMeta, TextItemBox } from './types';

export type PdfLinkRect = { leftPercent: number; topPercent: number; widthPercent: number; heightPercent: number };

/** `precise` is false when the destination only names a page (Fit / FitB / XYZ without coordinates). */
export type PdfLinkTarget = { pageNumber: number; xPercent: number; yPercent: number; zoom: number | null; precise: boolean };

export type PdfLinkAction =
  | { kind: 'external'; url: string }
  | { kind: 'internal'; dest: unknown }
  | { kind: 'named'; action: string }
  | { kind: 'unsupported'; reason: string };

export type PdfPageLink = {
  id: string;
  rect: PdfLinkRect;
  action: PdfLinkAction;
  /** Resolved while the page's links load (internal / named actions); null when the destination is broken. */
  target: PdfLinkTarget | null;
  /** Hover text: the target page (plus the citation number when the covered text is one) or the full URL. */
  label: string;
};

export type ExplicitDestination = { pageRef: unknown; fit: string; left: number | null; top: number | null; zoom: number | null };

/** Structural subset of pdf.js `PageViewport`, so the verify scripts can pass hand-built viewports. */
export type PdfViewportLike = {
  width: number;
  height: number;
  viewBox: number[];
  convertToViewportPoint(x: number, y: number): number[];
};

export type PdfLinkAnnotationLike = { id?: string; subtype?: string; rect?: number[]; url?: string; unsafeUrl?: string; dest?: unknown; action?: string };

/** Structural subset of pdf.js `PDFDocumentProxy` used for destination resolution. */
export type PdfDocumentLike = {
  numPages: number;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  getPage(pageNumber: number): Promise<{ getViewport(params: { scale: number }): PdfViewportLike }>;
};

/** Pixels between the viewport top and a precise link target after a jump; leaves the line readable. */
export const PDF_LINK_TARGET_TOP_MARGIN = 24;
/** Height of the one-shot target flash band as a share of the page height (≈ 2 text lines at 11 pt on A4). */
export const PDF_LINK_FLASH_HEIGHT_PERCENT = 3.2;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Which kind of link a pdf.js Link annotation is. URI/GoToR come first: a remote link may also carry a
 * `dest` for the other file, which must never be read as a page of this document. */
export function classifyLinkAnnotation(annotation: PdfLinkAnnotationLike): PdfLinkAction {
  const url = typeof annotation.url === 'string' && annotation.url.trim() ? annotation.url : typeof annotation.unsafeUrl === 'string' && annotation.unsafeUrl.trim() ? annotation.unsafeUrl : '';
  if (url) return { kind: 'external', url };
  if (annotation.dest !== undefined && annotation.dest !== null && annotation.dest !== '') return { kind: 'internal', dest: annotation.dest };
  if (typeof annotation.action === 'string' && annotation.action) return { kind: 'named', action: annotation.action };
  return { kind: 'unsupported', reason: 'no-destination' };
}

/** `[pageRef, /Fit…, args]` → normalised fields. Unknown fit names still yield a page-level destination. */
export function parseExplicitDestination(dest: unknown): ExplicitDestination | null {
  if (!Array.isArray(dest) || dest.length === 0) return null;
  const [pageRef, fitRaw, ...args] = dest as unknown[];
  if (pageRef === null || pageRef === undefined) return null;
  const fit = typeof fitRaw === 'string'
    ? fitRaw
    : fitRaw && typeof fitRaw === 'object' && typeof (fitRaw as { name?: unknown }).name === 'string' ? (fitRaw as { name: string }).name : 'Fit';
  switch (fit) {
    case 'XYZ': return { pageRef, fit, left: finite(args[0]), top: finite(args[1]), zoom: finite(args[2]) };
    case 'FitH':
    case 'FitBH': return { pageRef, fit, left: null, top: finite(args[0]), zoom: null };
    case 'FitV':
    case 'FitBV': return { pageRef, fit, left: finite(args[0]), top: null, zoom: null };
    case 'FitR': return { pageRef, fit, left: finite(args[0]), top: finite(args[3]), zoom: null };
    default: return { pageRef, fit, left: null, top: null, zoom: null };
  }
}

/** PDF user-space point → page percentages through the page's own default viewport. */
export function pdfPointToPagePercent(viewport: PdfViewportLike, x: number, y: number) {
  const [vx, vy] = viewport.convertToViewportPoint(x, y);
  return { xPercent: clampPercent((vx / viewport.width) * 100), yPercent: clampPercent((vy / viewport.height) * 100) };
}

/** Missing coordinates fall back to the page's top-left corner in PDF space (so /Rotate still lands right). */
export function destinationToTarget(pageNumber: number, explicit: ExplicitDestination, viewport: PdfViewportLike): PdfLinkTarget {
  const precise = explicit.left !== null || explicit.top !== null;
  if (!precise || !(viewport.width > 0 && viewport.height > 0)) return { pageNumber, xPercent: 0, yPercent: 0, zoom: explicit.zoom, precise: false };
  const [x0, , , y1] = viewport.viewBox;
  const point = pdfPointToPagePercent(viewport, explicit.left ?? x0, explicit.top ?? y1);
  return { pageNumber, xPercent: point.xPercent, yPercent: point.yPercent, zoom: explicit.zoom, precise: true };
}

export function namedActionPage(action: string, currentPage: number, numPages: number): number | null {
  switch (action) {
    case 'NextPage': return Math.min(currentPage + 1, numPages);
    case 'PrevPage': return Math.max(currentPage - 1, 1);
    case 'FirstPage': return 1;
    case 'LastPage': return numPages;
    default: return null;
  }
}

async function resolvePageNumber(doc: PdfDocumentLike, pageRef: unknown): Promise<number | null> {
  if (typeof pageRef === 'number') return Number.isInteger(pageRef) && pageRef >= 0 && pageRef < doc.numPages ? pageRef + 1 : null;
  if (!pageRef || typeof pageRef !== 'object') return null;
  try {
    const index = await doc.getPageIndex(pageRef);
    return Number.isInteger(index) && index >= 0 && index < doc.numPages ? index + 1 : null;
  } catch {
    return null;
  }
}

/** Array or named destination → page + page percentages; null when anything in the chain is broken. */
export async function resolveLinkTarget(doc: PdfDocumentLike, action: PdfLinkAction, currentPage: number): Promise<PdfLinkTarget | null> {
  if (action.kind === 'named') {
    const pageNumber = namedActionPage(action.action, currentPage, doc.numPages);
    return pageNumber ? { pageNumber, xPercent: 0, yPercent: 0, zoom: null, precise: false } : null;
  }
  if (action.kind !== 'internal') return null;
  let dest = action.dest;
  if (typeof dest === 'string') {
    try { dest = await doc.getDestination(dest); } catch { return null; }
  }
  const explicit = parseExplicitDestination(dest);
  if (!explicit) return null;
  const pageNumber = await resolvePageNumber(doc, explicit.pageRef);
  if (!pageNumber) return null;
  if (explicit.left === null && explicit.top === null) return { pageNumber, xPercent: 0, yPercent: 0, zoom: explicit.zoom, precise: false };
  try {
    const page = await doc.getPage(pageNumber);
    return destinationToTarget(pageNumber, explicit, page.getViewport({ scale: 1 }));
  } catch {
    return { pageNumber, xPercent: 0, yPercent: 0, zoom: explicit.zoom, precise: false };
  }
}

/** Annotation /Rect → page percentages; degenerate rectangles (< 0.5 pt) are dropped. pdf.js 6 no longer
 * ships `convertToViewportRectangle`; converting the two corners is what it used to do. */
export function linkRectToPercent(viewport: PdfViewportLike, rect: number[] | undefined): PdfLinkRect | null {
  if (!Array.isArray(rect) || rect.length < 4 || !rect.slice(0, 4).every((value) => Number.isFinite(value))) return null;
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  const [ax, ay] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [bx, by] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const left = Math.max(0, Math.min(ax, bx));
  const top = Math.max(0, Math.min(ay, by));
  const right = Math.min(viewport.width, Math.max(ax, bx));
  const bottom = Math.min(viewport.height, Math.max(ay, by));
  if (right - left < 0.5 || bottom - top < 0.5) return null;
  return {
    leftPercent: (left / viewport.width) * 100,
    topPercent: (top / viewport.height) * 100,
    widthPercent: ((right - left) / viewport.width) * 100,
    heightPercent: ((bottom - top) / viewport.height) * 100,
  };
}

/** Text runs whose centre lies inside the link box, in reading order — what the reader sees under the link. */
export function textCoveredByLink(textItems: readonly TextItemBox[], rect: PdfLinkRect): string {
  const margin = 0.2;
  return textItems
    .filter((item) => {
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      return cx >= rect.leftPercent - margin && cx <= rect.leftPercent + rect.widthPercent + margin
        && cy >= rect.topPercent - margin && cy <= rect.topPercent + rect.heightPercent + margin;
    })
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "[12]", "12" or "12, 13" under a link → "参考文献 [12]" style label; anything else → null. */
export function citationLabelFromText(text: string): string | null {
  const compact = text.replace(/\s+/g, '');
  const match = /^\[?(\d{1,4}(?:[,，–-]\d{1,4})*)\]?$/.exec(compact);
  return match ? `参考文献 [${match[1]}]` : null;
}

export function describeLinkTarget(action: PdfLinkAction, target: PdfLinkTarget | null, citation: string | null): string {
  if (action.kind === 'external') return action.url;
  if (action.kind === 'unsupported') return '不支持的链接动作';
  if (!target) return '链接目标无法解析';
  const page = `跳转到第 ${target.pageNumber} 页`;
  return citation ? `${citation} · ${page}` : page;
}

/** All Link annotations of one page as percent boxes, with their targets resolved in parallel. */
export async function loadPageLinks(
  doc: PdfDocumentLike,
  page: PageMeta,
  getAnnotations: () => Promise<unknown[]> = () => page.pdfPage.getAnnotations({ intent: 'display' }),
): Promise<PdfPageLink[]> {
  const annotations = (await getAnnotations()) as PdfLinkAnnotationLike[];
  const viewport = page.pdfPage.getViewport({ scale: 1 }) as unknown as PdfViewportLike;
  const links = annotations
    .filter((annotation) => annotation && annotation.subtype === 'Link')
    .map((annotation, index) => ({ annotation, index, rect: linkRectToPercent(viewport, annotation.rect) }))
    .filter((entry): entry is typeof entry & { rect: PdfLinkRect } => entry.rect !== null);
  return Promise.all(links.map(async ({ annotation, index, rect }) => {
    const action = classifyLinkAnnotation(annotation);
    const target = action.kind === 'internal' || action.kind === 'named' ? await resolveLinkTarget(doc, action, page.pageNumber) : null;
    const citation = action.kind === 'external' ? null : citationLabelFromText(textCoveredByLink(page.textItems, rect));
    return { id: annotation.id || `link-${page.pageNumber}-${index}`, rect, action, target, label: describeLinkTarget(action, target, citation) };
  }));
}

/** Layout-pixel distance from `ancestor`'s top edge to `node`'s top edge, through the offsetParent chain.
 * `offsetTop` alone stops at the nearest positioned box (the transformed `.pdf-document-content`) and would
 * miss the scroller padding; client rects would be in root-zoomed pixels instead of scroll pixels. */
export function offsetTopWithin(node: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

/** Scroll offset that puts a link target in the upper part of the viewport (page top for page-level targets,
 * `PDF_LINK_TARGET_TOP_MARGIN` above a precise target), clamped to the scroll range like the outline jump. */
export function linkTargetScrollTop(input: {
  pageOffsetTop: number;
  pageHeight: number;
  yPercent: number | null;
  viewportHeight: number;
  scrollHeight: number;
  margin?: number;
}): number {
  const margin = input.margin ?? PDF_LINK_TARGET_TOP_MARGIN;
  const available = Math.max(0, input.scrollHeight - input.viewportHeight);
  const raw = input.yPercent === null
    ? input.pageOffsetTop
    : input.pageOffsetTop + (Math.min(100, Math.max(0, input.yPercent)) / 100) * input.pageHeight - margin;
  return Math.min(available, Math.max(0, Math.round(raw)));
}
