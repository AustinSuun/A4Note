import type { RectBox, TextItemBox, TextOrientation } from './types';

export type TextItemSelection = {
  itemIndex: number;
  startOffset: number;
  endOffset: number;
};

type ReadingAxes = {
  /** Coordinate that stays constant along one line (y for horizontal runs, x for rotated ones). */
  line: (box: RectBox) => number;
  lineExtent: (box: RectBox) => number;
  /** Reading order across lines, then along the run. */
  compareReading: (a: RectBox, b: RectBox) => number;
  compareRun: (a: RectBox, b: RectBox) => number;
};

/** Reading order per quantized run direction: pages with /Rotate read column by column. */
const READING_AXES: Record<TextOrientation, ReadingAxes> = {
  0: { line: (box) => box.y, lineExtent: (box) => box.height, compareReading: (a, b) => a.y - b.y || a.x - b.x, compareRun: (a, b) => a.x - b.x },
  90: { line: (box) => box.x, lineExtent: (box) => box.width, compareReading: (a, b) => b.x - a.x || a.y - b.y, compareRun: (a, b) => a.y - b.y },
  180: { line: (box) => box.y, lineExtent: (box) => box.height, compareReading: (a, b) => b.y - a.y || b.x - a.x, compareRun: (a, b) => b.x - a.x },
  270: { line: (box) => box.x, lineExtent: (box) => box.width, compareReading: (a, b) => a.x - b.x || b.y - a.y, compareRun: (a, b) => b.y - a.y },
};

export function textItemOrientation(item: { orientation?: unknown } | undefined): TextOrientation {
  const value = item?.orientation;
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

export function isVerticalTextOrientation(orientation: TextOrientation) {
  return orientation === 90 || orientation === 270;
}

/** Most common run direction among the selected items; horizontal wins ties. */
export function dominantTextOrientation(textItems: TextItemBox[], selections: TextItemSelection[]): TextOrientation {
  const counts = new Map<TextOrientation, number>();
  for (const selection of selections) {
    const orientation = textItemOrientation(textItems[selection.itemIndex]);
    counts.set(orientation, (counts.get(orientation) ?? 0) + 1);
  }
  let dominant: TextOrientation = 0;
  let dominantCount = counts.get(0) ?? 0;
  for (const [orientation, count] of counts) {
    if (count > dominantCount) {
      dominant = orientation;
      dominantCount = count;
    }
  }
  return dominant;
}

/** Persist the run direction on rotated segments so marks trim and underline along the glyph axis. */
export function withSegmentOrientation<T extends RectBox>(segments: T[], orientation: TextOrientation): Array<T | (T & { orientation: TextOrientation })> {
  return orientation ? segments.map((segment) => ({ ...segment, orientation })) : segments;
}

/** Whether two consecutive runs sit on different lines or leave a gap (search joins them with a space). */
export function textItemsSeparated(item: TextItemBox, prior: TextItemBox) {
  const orientation = textItemOrientation(item);
  if (orientation !== textItemOrientation(prior)) return true;
  const axes = READING_AXES[orientation];
  if (Math.abs(axes.line(item) - axes.line(prior)) > Math.min(axes.lineExtent(item), axes.lineExtent(prior)) / 2) return true;
  if (orientation === 0) return item.x > prior.x + prior.width + 0.25;
  if (orientation === 90) return item.y > prior.y + prior.height + 0.25;
  if (orientation === 180) return item.x + item.width < prior.x - 0.25;
  return item.y + item.height < prior.y - 0.25;
}

export function textItemSelectionsFromRange(range: Range, container: HTMLElement): TextItemSelection[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.pdf-text-layer span[data-text-index]')).flatMap((span) => {
    if (!rangeIntersectsNode(range, span)) return [];
    const itemIndex = Number(span.dataset.textIndex);
    const textLength = span.textContent?.length ?? 0;
    if (!Number.isInteger(itemIndex) || textLength <= 0) return [];
    const startOffset = span.contains(range.startContainer)
      ? boundaryTextOffset(span, range.startContainer, range.startOffset, textLength)
      : 0;
    const endOffset = span.contains(range.endContainer)
      ? boundaryTextOffset(span, range.endContainer, range.endOffset, textLength)
      : textLength;
    return endOffset > startOffset ? [{ itemIndex, startOffset, endOffset }] : [];
  });
}

/** Pages whose text layer the selection touches, in document order: a drag can cross a page boundary. */
export function textSelectionPageElements(root: ParentNode, range: Range): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.pdf-page[data-page]')).filter((pageElement) => {
    const textLayer = pageElement.querySelector('.pdf-text-layer');
    return !!textLayer && Number.isFinite(Number(pageElement.dataset.page)) && range.intersectsNode(textLayer);
  });
}

/** The part of a selection that lies inside `node`; boundaries outside it are clamped to the node's edges. */
export function clipRangeToNode(range: Range, node: Node): Range {
  const clipped = range.cloneRange();
  if (!node.contains(range.startContainer)) clipped.setStart(node, 0);
  if (!node.contains(range.endContainer)) clipped.setEnd(node, node.childNodes.length);
  return clipped;
}

/** Quote assembled from the text layer runs alone, so overlay text (text boxes, comments) under the drag never leaks in. */
export function quoteFromTextItemSelections(textItems: TextItemBox[], selections: TextItemSelection[]) {
  let quote = '';
  let prior: TextItemBox | undefined;
  for (const selection of selections) {
    const item = textItems[selection.itemIndex];
    if (!item?.text.length) continue;
    const text = item.text.slice(clampOffset(selection.startOffset, item.text.length), clampOffset(selection.endOffset, item.text.length));
    if (!text.trim()) continue;
    if (prior && textItemsSeparated(item, prior)) quote += ' ';
    quote += text;
    prior = item;
  }
  return quote.replace(/\s+/g, ' ').trim();
}

/** Character span of a selection inside one run with the whitespace at both ends dropped, so
 * bands and rules never start or end on a blank. `null` when nothing visible remains. */
export function visibleTextItemSelection(item: TextItemBox, selection: TextItemSelection) {
  if (!item.text.length) return null;
  const start = clampOffset(selection.startOffset, item.text.length);
  const end = clampOffset(selection.endOffset, item.text.length);
  const selectedText = item.text.slice(start, end);
  const leadingWhitespace = selectedText.length - selectedText.trimStart().length;
  const trailingWhitespace = selectedText.length - selectedText.trimEnd().length;
  const visibleStart = Math.min(start + leadingWhitespace, end);
  const visibleEnd = Math.max(visibleStart, end - trailingWhitespace);
  return visibleEnd > visibleStart ? { start: visibleStart, end: visibleEnd } : null;
}

export function textSelectionRectsFromOffsets(textItems: TextItemBox[], selections: TextItemSelection[]): RectBox[] {
  return selections.flatMap((selection) => {
    const item = textItems[selection.itemIndex];
    if (!item?.text.length) return [];
    const visible = visibleTextItemSelection(item, selection);
    if (!visible) return [];
    return [sliceTextItemBox(item, visible.start / item.text.length, visible.end / item.text.length)];
  });
}

/** Measures the extent of a character span of one text-layer run along its reading direction,
 * in the same client pixels `layerRect` uses. Returns `null` when the run cannot be measured. */
export type TextRunExtentMeasurer = (itemIndex: number, start: number, end: number) => { left: number; top: number; width: number; height: number } | null;

/** Selection rects that follow the pointer along each run: the extent along the reading
 * direction comes from the live glyphs of the (run-fitted) text layer, the extent across it
 * from the pdf.js run box, so partial runs start and end exactly under the caret while bands
 * keep one even height per font size. Runs the browser cannot measure fall back to the
 * proportional slice. Requires a text layer whose runs are fitted onto the PDF boxes
 * (pdfTextLayerFit); otherwise the glyph extents drift away from the bitmap. */
export function textSelectionRectsFromLayer(
  textItems: TextItemBox[],
  selections: TextItemSelection[],
  layerRect: { left: number; top: number; width: number; height: number },
  measure: TextRunExtentMeasurer,
): RectBox[] {
  if (!(layerRect.width > 0 && layerRect.height > 0)) return textSelectionRectsFromOffsets(textItems, selections);
  return selections.flatMap((selection) => {
    const item = textItems[selection.itemIndex];
    if (!item?.text.length) return [];
    const visible = visibleTextItemSelection(item, selection);
    if (!visible) return [];
    const fallback = sliceTextItemBox(item, visible.start / item.text.length, visible.end / item.text.length);
    const glyphs = measure(selection.itemIndex, visible.start, visible.end);
    if (!glyphs || !(glyphs.width > 0) || !(glyphs.height > 0)) return [fallback];
    if (isVerticalTextOrientation(textItemOrientation(item))) {
      const top = ((glyphs.top - layerRect.top) / layerRect.height) * 100;
      const height = (glyphs.height / layerRect.height) * 100;
      const y = Math.max(item.y, Math.min(top, item.y + item.height));
      const bottom = Math.max(y, Math.min(top + height, item.y + item.height));
      return [{ x: item.x, y, width: item.width, height: bottom - y }];
    }
    const left = ((glyphs.left - layerRect.left) / layerRect.width) * 100;
    const width = (glyphs.width / layerRect.width) * 100;
    // Clamp to the run box: a fitted run never exceeds it, but a still-loading font could.
    const x = Math.max(item.x, Math.min(left, item.x + item.width));
    const right = Math.max(x, Math.min(left + width, item.x + item.width));
    return [{ x, y: item.y, width: right - x, height: item.height }];
  });
}

/** Measurer over a real text layer: the run span with `data-text-index` and its single text node. */
export function textRunExtentMeasurer(textLayer: ParentNode & { ownerDocument: Document | null }): TextRunExtentMeasurer {
  const document = textLayer.ownerDocument;
  if (!document) return () => null;
  const range = document.createRange();
  return (itemIndex, start, end) => {
    const span = textLayer.querySelector<HTMLElement>(`span[data-text-index="${itemIndex}"]`);
    const text = span?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return null;
    const length = text.textContent?.length ?? 0;
    try {
      range.setStart(text, clampOffset(start, length));
      range.setEnd(text, clampOffset(end, length));
    } catch {
      return null;
    }
    const rect = range.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };
}

/** Slice a run box along its reading direction: x for horizontal runs, y for rotated ones. */
export function sliceTextItemBox(item: TextItemBox, startRatio: number, endRatio: number): RectBox {
  const orientation = textItemOrientation(item);
  const span = endRatio - startRatio;
  if (orientation === 90) return { x: item.x, y: item.y + item.height * startRatio, width: item.width, height: item.height * span };
  if (orientation === 270) return { x: item.x, y: item.y + item.height * (1 - endRatio), width: item.width, height: item.height * span };
  if (orientation === 180) return { x: item.x + item.width * (1 - endRatio), y: item.y, width: item.width * span, height: item.height };
  return { x: item.x + item.width * startRatio, y: item.y, width: item.width * span, height: item.height };
}

export function mergeRectsIntoLineSegments(rects: RectBox[], orientation: TextOrientation = 0) {
  if (isVerticalTextOrientation(orientation)) return mergeRectsIntoColumnSegments(rects);
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: RectBox[] = [];
  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.y - rect.y) < 1.2 && rect.x <= previous.x + previous.width + 1.2) {
      const left = Math.min(previous.x, rect.x);
      const top = Math.min(previous.y, rect.y);
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      const bottom = Math.max(previous.y + previous.height, rect.y + rect.height);
      merged[merged.length - 1] = { x: left, y: top, width: right - left, height: bottom - top };
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

function mergeRectsIntoColumnSegments(rects: RectBox[]) {
  const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
  const merged: RectBox[] = [];
  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.x - rect.x) < 1.2 && rect.y <= previous.y + previous.height + 1.2) {
      merged[merged.length - 1] = boundingBox([previous, rect]);
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

export function textSelectionFromDrag(textItems: TextItemBox[], box: RectBox) {
  const lineGroups = groupTextItemsIntoLines(textItems);
  const selectedGroups = lineGroups
    .map((items) => ({ items, segment: lineSegment(items) }))
    .filter(({ segment }) => lineSelectionScore(segment, box) >= 0.18)
    .sort((a, b) => compareReadingOrder(a.segment, b.segment));
  if (!selectedGroups.length) return null;
  const selected = selectedGroups.flatMap((group) => group.items).sort(compareReadingOrder);
  const segments = selectedGroups.map((group) => group.segment);
  const bounds = boundingBox(segments);
  return {
    quote: selected.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    position: { ...bounds, segments },
  };
}

export function groupTextItemsIntoLines(items: TextItemBox[]) {
  const lines: TextItemBox[][] = [];
  for (const orientation of [0, 90, 180, 270] as const) {
    const axes = READING_AXES[orientation];
    const sorted = items.filter((item) => textItemOrientation(item) === orientation).sort(axes.compareReading);
    const orientedLines: TextItemBox[][] = [];
    for (const item of sorted) {
      const line = orientedLines.find((candidate) => Math.abs(axes.line(candidate[0]) - axes.line(item)) < Math.max(axes.lineExtent(candidate[0]), axes.lineExtent(item)) * 0.65);
      if (line) line.push(item);
      else orientedLines.push([item]);
    }
    lines.push(...orientedLines.map((line) => line.sort(axes.compareRun)));
  }
  return lines;
}

/** Bounding box of one line; rotated lines remember their run direction for scoring and marks. */
function lineSegment(items: TextItemBox[]): RectBox & { orientation?: TextOrientation } {
  const orientation = textItemOrientation(items[0]);
  return orientation ? { ...boundingBox(items), orientation } : boundingBox(items);
}

function compareReadingOrder(a: RectBox & { orientation?: TextOrientation }, b: RectBox & { orientation?: TextOrientation }) {
  const orientation = textItemOrientation(a);
  return orientation - textItemOrientation(b) || READING_AXES[orientation].compareReading(a, b);
}

export function lineSelectionScore(line: RectBox & { orientation?: TextOrientation }, dragBox: RectBox) {
  const intersection = intersectionBox(line, dragBox);
  if (!intersection) return 0;
  const verticalCoverage = intersection.height / Math.max(line.height, 0.1);
  const horizontalCoverage = intersection.width / Math.max(line.width, 0.1);
  // Coverage across the line decides whether it was meant; coverage along it only needs a foothold.
  const [acrossCoverage, alongCoverage] = isVerticalTextOrientation(textItemOrientation(line)) ? [horizontalCoverage, verticalCoverage] : [verticalCoverage, horizontalCoverage];
  return acrossCoverage * Math.min(alongCoverage * 2.5, 1);
}

export function intersectionBox(a: RectBox, b: RectBox) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boundingBox(items: Array<RectBox>) {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundaryTextOffset(span: HTMLElement, node: Node, offset: number, textLength: number) {
  if (node.nodeType === Node.TEXT_NODE) return clampOffset(offset, textLength);
  if (node === span) return offset <= 0 ? 0 : textLength;
  return offset <= 0 ? 0 : textLength;
}

function rangeIntersectsNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function clampOffset(value: number, textLength: number) {
  return Math.max(0, Math.min(Math.trunc(value), textLength));
}
