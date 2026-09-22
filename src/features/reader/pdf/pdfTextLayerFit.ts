import { isVerticalTextOrientation, textItemOrientation } from './pdfSelection';
import type { TextItemBox } from './types';

/** CSS custom property carrying the per-run fit scale; reader.css applies it as
 * `scaleX` (horizontal runs) or `scaleY` (rotated runs) from the run's start corner. */
export const TEXT_RUN_SCALE_PROPERTY = '--pdf-run-scale';

/** Scales below this distance from 1 are not worth a transform. */
const RUN_SCALE_EPSILON = 0.002;
/** Guards against degenerate measurements (hidden layers, empty runs, font fallbacks gone wrong). */
const MIN_RUN_SCALE = 0.1;
const MAX_RUN_SCALE = 10;

/** Factor that maps the glyph advance the browser produced for a run onto the extent pdf.js
 * measured for the same run in the page bitmap. 1 when either extent is unusable. */
export function textRunScale(pdfExtentPx: number, glyphExtentPx: number) {
  if (!Number.isFinite(pdfExtentPx) || !Number.isFinite(glyphExtentPx) || !(pdfExtentPx > 0) || !(glyphExtentPx > 0)) return 1;
  return Math.min(Math.max(pdfExtentPx / glyphExtentPx, MIN_RUN_SCALE), MAX_RUN_SCALE);
}

type MeasurableSpan = Pick<HTMLElement, 'getBoundingClientRect'> & {
  dataset: { textIndex?: string };
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>;
  firstChild: Node | null;
};

type MeasurableLayer = Pick<HTMLElement, 'getBoundingClientRect'> & {
  querySelectorAll: (selector: string) => ArrayLike<MeasurableSpan>;
  ownerDocument: Pick<Document, 'createRange'> | null;
};

/** Fit every transparent text run of one page to the box pdf.js measured for it.
 *
 * The text layer renders each run in a substitute font whose advances rarely match the PDF font,
 * so the glyph under the pointer sits further along the run than the character it stands for in
 * the page coordinates (the error grows with the offset into the run and with the zoom). Native
 * hit testing, caret placement and `Range.getClientRects` all follow the glyphs, so instead of
 * correcting each consumer the runs themselves are scaled onto the PDF geometry, exactly like
 * pdf.js's own text layer does: measure the natural advance, then apply pdf/measured along the
 * flow axis. Rotated runs flow vertically and take the scale along y.
 *
 * Measures every run first (one layout) and writes the scales afterwards, so pages with a few
 * thousand runs do not thrash layout. Returns the number of runs fitted; 0 when the layer has no
 * box yet (hidden tab, released page) so a later call can try again. */
export function fitTextRunsToPdfBoxes(layer: MeasurableLayer, textItems: readonly TextItemBox[]) {
  const layerRect = layer.getBoundingClientRect();
  if (!(layerRect.width > 0 && layerRect.height > 0)) return 0;
  const document = layer.ownerDocument;
  if (!document) return 0;
  const spans = Array.from(layer.querySelectorAll('span[data-text-index]'));
  // Reset before measuring: a stale scale from the previous zoom would distort the glyph extent.
  for (const span of spans) span.style.removeProperty(TEXT_RUN_SCALE_PROPERTY);
  const range = document.createRange();
  const scales = spans.map((span) => {
    const item = textItems[Number(span.dataset.textIndex)];
    const text = span.firstChild;
    if (!item || !text) return 1;
    range.selectNodeContents(text);
    const glyphs = range.getBoundingClientRect();
    return isVerticalTextOrientation(textItemOrientation(item))
      ? textRunScale((item.height / 100) * layerRect.height, glyphs.height)
      : textRunScale((item.width / 100) * layerRect.width, glyphs.width);
  });
  spans.forEach((span, index) => {
    const scale = scales[index];
    if (Math.abs(scale - 1) > RUN_SCALE_EPSILON) span.style.setProperty(TEXT_RUN_SCALE_PROPERTY, scale.toFixed(4));
  });
  return spans.length;
}
