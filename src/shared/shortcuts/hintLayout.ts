/** Viewport CSS-pixel layout; no knowledge of PDF zoom, DPR or shortcut dispatch. */
export type HintRect = { left: number; top: number; right: number; bottom: number };
export type HintMeasurement = { id: string; width: number; height: number; anchor?: HintRect };
export type HintPosition = { left: number; top: number; placement: 'adjacent' | 'floating' };

export function hintRectsOverlap(a: HintRect, b: HintRect, gap = 0) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

export function layoutShortcutHints(items: HintMeasurement[], bounds: HintRect, controls: HintRect[]) {
  const result: Record<string, HintPosition> = {};
  const occupied = [...controls];
  const place = (item: HintMeasurement, left: number, top: number, placement: HintPosition['placement']) => {
    const box = { left, top, right: left + item.width, bottom: top + item.height };
    if (box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom) return false;
    if (occupied.some(other => hintRectsOverlap(box, other, 4))) return false;
    occupied.push(box); result[item.id] = { left, top, placement }; return true;
  };
  // Controls get first choice across the ENTIRE viewport. In particular, do not
  // reserve a right-hand panel that steals the PDF zoom controls' anchors.
  for (const item of items) {
    const anchor = item.anchor;
    if (!anchor) continue;
    const centered = Math.max(bounds.left, Math.min(bounds.right - item.width, (anchor.left + anchor.right - item.width) / 2));
    const top = Math.max(bounds.top, Math.min(bounds.bottom - item.height, (anchor.top + anchor.bottom - item.height) / 2));
    if (place(item, centered, anchor.top - 8 - item.height, 'adjacent')
      || place(item, centered, anchor.bottom + 8, 'adjacent')
      || place(item, anchor.right + 8, top, 'adjacent')
      || place(item, anchor.left - item.width - 8, top, 'adjacent')) continue;
    for (let row = 1; row < 5; row += 1) {
      const distance = 8 + row * (item.height + 8);
      // Subtract from TOP, not bottom: the old bottom-30 formula covered icons.
      if (place(item, centered, anchor.top - distance - item.height, 'adjacent')
        || place(item, centered, anchor.bottom + distance, 'adjacent')) break;
    }
  }
  // Unanchored commands are individual transparent text hints in free space,
  // not rows inside a panel. Wrap into another column rather than clipping.
  const floating = items.filter(item => !result[item.id]);
  const column = Math.max(96, ...floating.map(item => item.width + 20));
  for (const item of floating) {
    for (let right = bounds.right; right - item.width >= bounds.left && !result[item.id]; right -= column) {
      for (let top = Math.min(88, bounds.top + 56); top + item.height <= bounds.bottom; top += item.height + 12) {
        if (place(item, right - item.width, top, 'floating')) break;
      }
    }
    // Tiny windows may have little room beneath the titlebar; try all free rows.
    if (!result[item.id]) for (let top = bounds.top; top + item.height <= bounds.bottom && !result[item.id]; top += item.height + 6) {
      for (let left = bounds.left; left + item.width <= bounds.right; left += 12) {
        if (place(item, left, top, 'floating')) break;
      }
    }
  }
  return result;
}
