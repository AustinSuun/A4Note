/** Viewport CSS-pixel layout; no knowledge of PDF zoom, DPR or shortcut dispatch. */
export type HintRect = { left: number; top: number; right: number; bottom: number };
export type HintMeasurement = { id: string; width: number; height: number; floatingWidth?: number; floatingHeight?: number; group?: string; beside?: boolean; anchor?: HintRect };
export type HintPosition = { left: number; top: number; placement: 'adjacent' | 'floating' };

export function hintRectsOverlap(a: HintRect, b: HintRect, gap = 0) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

export function layoutShortcutHints(items: HintMeasurement[], bounds: HintRect, controls: HintRect[]) {
  const result: Record<string, HintPosition> = {};
  const occupied = [...controls];
  const place = (item: HintMeasurement, left: number, top: number, placement: HintPosition['placement']) => {
    const width = placement === 'floating' ? item.floatingWidth ?? item.width : item.width;
    const height = placement === 'floating' ? item.floatingHeight ?? item.height : item.height;
    const box = { left, top, right: left + width, bottom: top + height };
    if (box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom) return false;
    if (occupied.some(other => hintRectsOverlap(box, other, 4))) return false;
    occupied.push(box); result[item.id] = { left, top, placement }; return true;
  };
  // Controls get first choice across the ENTIRE viewport. Place wide bottom-
  // dock chords before neighboring single keys: otherwise a tiny key can claim
  // the only row where the long chord fits next to its own control.
  const wideDock = (item: HintMeasurement) => item.anchor
    && item.anchor.top > bounds.top + (bounds.bottom - bounds.top) * .6
    && item.width > (item.anchor.right - item.anchor.left) * 2;
  for (const item of [...items].sort((a, b) => Number(Boolean(wideDock(b))) - Number(Boolean(wideDock(a))))) {
    const anchor = item.anchor;
    if (!anchor) continue;
    let centered = Math.max(bounds.left, Math.min(bounds.right - item.width, (anchor.left + anchor.right - item.width) / 2));
    const top = Math.max(bounds.top, Math.min(bounds.bottom - item.height, (anchor.top + anchor.bottom - item.height) / 2));
    if (item.beside && (place(item, anchor.right + 6, top, 'adjacent') || place(item, anchor.left - item.width - 6, top, 'adjacent'))) continue;
    const bottomDock = anchor.top > bounds.top + (bounds.bottom - bounds.top) * .6;
    const nearTop = anchor.top < bounds.top + 64;
    // A wide chord belongs to its trailing action key, not to the midpoint of
    // its modifiers. Extend it leftwards so the next dock buttons retain room
    // for their own keys, especially in the single row below an open popup.
    if (bottomDock && item.width > (anchor.right - anchor.left) * 2) {
      centered = Math.max(bounds.left, Math.min(bounds.right - item.width, anchor.right - item.width - 4));
    }
    for (let row = 0; row < 5 && !result[item.id]; row += 1) {
      const distance = 7 + row * (item.height + 6);
      const above = anchor.top - distance - item.height, below = anchor.bottom + distance;
      // Keep a bottom dock's keys in coherent rows ABOVE it, rather than a
      // zigzag across both sides. Top-bar controls use rows below the bar.
      if (bottomDock) place(item, centered, above, 'adjacent');
      else if (nearTop) place(item, centered, below, 'adjacent');
      else if (!place(item, centered, above, 'adjacent')) place(item, centered, below, 'adjacent');
    }
    if (!result[item.id]) place(item, anchor.right + 7, top, 'adjacent') || place(item, anchor.left - item.width - 7, top, 'adjacent');
    if (!result[item.id]) place(item, centered, bottomDock ? anchor.bottom + 7 : anchor.top - item.height - 7, 'adjacent');
  }
  // Free-floating key + action rows share an aligned left edge and move
  // monotonically down each column. Group spacing, not a card or headings,
  // separates related commands. Never backfill earlier gaps with later groups.
  const floating = items.filter(item => !result[item.id]);
  const columnWidth = Math.max(1, ...floating.map(item => item.floatingWidth ?? item.width));
  const start = Math.min(bounds.top + 64, bounds.bottom - 24);
  let right = bounds.right, cursor = start;
  const groups: HintMeasurement[][] = [];
  for (const item of floating) {
    const last = groups.at(-1);
    if (item.group && last?.[0].group === item.group) last.push(item);
    else groups.push([item]);
  }
  for (const [index, group] of groups.entries()) {
    if (index > 0) cursor += 10;
    let placed = false;
    for (; right - columnWidth >= bounds.left; right -= columnWidth + 20, cursor = start) {
      const occupiedBefore = occupied.length, cursorBefore = cursor;
      for (const item of group) {
        const height = item.floatingHeight ?? item.height;
        for (; cursor + height <= bounds.bottom; cursor += 6) {
          if (place(item, right - columnWidth, cursor, 'floating')) { cursor += height + 8; break; }
        }
        if (!result[item.id]) break;
      }
      if (group.every(item => result[item.id])) { placed = true; break; }
      // Keep a related group (e.g. zoom in/out/reset) together when wrapping.
      // Trial reservations are rolled back, including their collision boxes.
      occupied.length = occupiedBefore; cursor = cursorBefore;
      group.forEach(item => { delete result[item.id]; });
    }
    if (placed) continue;
    // Extremely cramped/custom registries may not fit a complete group in any
    // remaining column. Split only as a last resort, never into the titlebar.
    for (const item of group) {
      const width = item.floatingWidth ?? item.width, height = item.floatingHeight ?? item.height;
      for (let top = start; top + height <= bounds.bottom && !result[item.id]; top += height + 6) {
        for (let left = bounds.right - width; left >= bounds.left; left -= 12) {
          if (place(item, left, top, 'floating')) break;
        }
      }
    }
  }
  return result;
}
