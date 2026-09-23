import type { FloatingCardRect } from './noteWorkbench';

/* Enter-motion helpers for the note workbench (task 1f484418). The motion itself is CSS
   (reader-writing-layout.css + motion tokens); this module only derives the values the
   scene has to compute from state. Pure and DOM-free so it can be unit tested. */

/** Default origin used when no floating geometry is known: the card grows from its top edge. */
export const NOTE_POP_ORIGIN_DEFAULT = '50% 0%';

/** Transform origin for the floating card's pop, as a CSS `transform-origin` value.
 *  The card is anchored to the side of the workspace it sits on (its centre in container
 *  ratios), so the pop grows out of that side under the drag lane instead of from the
 *  geometric centre; roughly centred cards keep the top-centre origin. */
export function floatingPopOrigin(rect: Pick<FloatingCardRect, 'x' | 'width'>): string {
  const centre = rect.x + rect.width / 2;
  if (!Number.isFinite(centre)) return NOTE_POP_ORIGIN_DEFAULT;
  if (centre < 0.4) return '12% 0%';
  if (centre > 0.6) return '88% 0%';
  return NOTE_POP_ORIGIN_DEFAULT;
}
