import type { RectBox, TextItemBox } from './types';

export function mergeRectsIntoLineSegments(rects: RectBox[]) {
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

export function textSelectionFromDrag(textItems: TextItemBox[], box: RectBox) {
  const lineGroups = groupTextItemsIntoLines(textItems);
  const selectedGroups = lineGroups
    .map((items) => ({ items, segment: boundingBox(items) }))
    .filter(({ segment }) => lineSelectionScore(segment, box) >= 0.18)
    .sort((a, b) => a.segment.y - b.segment.y || a.segment.x - b.segment.x);
  if (!selectedGroups.length) return null;
  const selected = selectedGroups.flatMap((group) => group.items).sort((a, b) => a.y - b.y || a.x - b.x);
  const segments = selectedGroups.map((group) => group.segment);
  const bounds = boundingBox(segments);
  return {
    quote: selected.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    position: { ...bounds, segments },
  };
}

export function groupTextItemsIntoLines(items: TextItemBox[]) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItemBox[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) < Math.max(candidate[0].height, item.height) * 0.65);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

export function lineSelectionScore(line: RectBox, dragBox: RectBox) {
  const intersection = intersectionBox(line, dragBox);
  if (!intersection) return 0;
  const verticalCoverage = intersection.height / Math.max(line.height, 0.1);
  const horizontalCoverage = intersection.width / Math.max(line.width, 0.1);
  return verticalCoverage * Math.min(horizontalCoverage * 2.5, 1);
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
