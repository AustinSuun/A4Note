import type { PositionJson } from '../../../core/types';
import { annotationSegments, highlightPositionStyle } from './pdfAnnotationHelpers';
import { numberValue } from './pdfGeometry';

export const HIGHLIGHT_APPEARANCE_KEY = 'aster.reader.highlightAppearance.v1';
/** Opacity (percent) of the single highlight paint layer. 22 left the presets nearly
 * indistinguishable over white (min pairwise ΔE ≈ 3.7); 40 with `multiply` keeps black glyphs
 * black while the presets separate by ΔE ≈ 12 (see docs/mcp-reader-selection-band-highlight-arena-2026-09-21.md).
 * Only the fallback changed: a value the user saved explicitly is kept as stored. */
export const DEFAULT_HIGHLIGHT_OPACITY = 40;
export const MIN_HIGHLIGHT_OPACITY = 10;
export const MAX_HIGHLIGHT_OPACITY = 60;
export type HighlightAppearance = { opacity: number; blend: 'multiply' | 'normal' };
export function normalizeHighlightAppearance(value: unknown): HighlightAppearance {
  const data = value && typeof value === 'object' ? value as Partial<HighlightAppearance> : {};
  return {
    opacity: typeof data.opacity === 'number' && Number.isFinite(data.opacity)
      ? Math.min(MAX_HIGHLIGHT_OPACITY, Math.max(MIN_HIGHLIGHT_OPACITY, Math.round(data.opacity))) : DEFAULT_HIGHLIGHT_OPACITY,
    blend: data.blend === 'normal' ? 'normal' : 'multiply',
  };
}
export function parseHighlightAppearance(raw: string | null): HighlightAppearance {
  try { return normalizeHighlightAppearance(raw ? JSON.parse(raw) : null); }
  catch { return normalizeHighlightAppearance(null); }
}
/** Preset fills: more chroma than the earlier pastel set (#ffe579/#b9e7c5/#b9cef7/#cbb7ef) so the
 * four presets stay apart on white, beige and light PDF backgrounds at the default opacity. */
export const HIGHLIGHT_PRESET_FILLS: Record<'yellow' | 'green' | 'blue' | 'purple', string> = { yellow: '#ffd54a', green: '#8fd9a3', blue: '#8fb9f2', purple: '#bf9cf0' };
/** Pseudo colour of the live text-selection band: it is painted through the same layer as the
 * highlights so its geometry and compositing match what a highlight will look like. */
export const SELECTION_PREVIEW_COLOR = 'selection-preview';
export const SELECTION_PREVIEW_FILL = '#8fbfa8';
export function highlightFill(color: string): string {
  if (color === SELECTION_PREVIEW_COLOR) return SELECTION_PREVIEW_FILL;
  const presets: Record<string, string> = HIGHLIGHT_PRESET_FILLS;
  return presets[color] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : HIGHLIGHT_PRESET_FILLS.yellow);
}
/** sRGB result of painting `fill` over `background` with the layer's opacity and blend (what the eye sees). */
export function compositedHighlightColor(fill: string, background: string, opacity: number, blend: HighlightAppearance['blend'] = 'multiply'): string {
  const alpha = Math.min(1, Math.max(0, opacity / 100));
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [fillRgb, backgroundRgb] = [channels(fill), channels(background)];
  const mixed = backgroundRgb.map((back, index) => (blend === 'multiply' ? back * (1 - alpha * (1 - fillRgb[index])) : back * (1 - alpha) + fillRgb[index] * alpha));
  return `#${mixed.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
export function highlightRects(position: PositionJson) {
  // Keep persisted selection runs (and the transparent hit targets) untouched. Only the SVG
  // paint trims the ascender edge; a standalone run keeps its original descender/bottom edge.
  const runs = annotationSegments(position).flatMap(segment => {
    if (!segment || typeof segment !== 'object') return [];
    const style = highlightPositionStyle(segment);
    const rect = { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
    return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0
      ? [{ rect, glyphHeight: Math.max(numberValue(segment.height, 5), 0.2), orientation: segment.orientation ?? 0 }] : [];
  });
  return runs.map((run) => {
    const { rect, glyphHeight, orientation } = run;
    // The 90/180/270-degree glyph axes are not the screen's upper edge; preserve their
    // existing orientation-aware descender placement instead of trimming the wrong side.
    if (orientation !== 0) return rect;
    const topTrim = glyphHeight * 0.1;
    const painted = { ...rect, y: rect.y + topTrim, height: rect.height - topTrim };
    const next = runs.filter(candidate => {
      if (candidate === run || candidate.orientation !== 0) return false;
      const size = Math.min(glyphHeight, candidate.glyphHeight);
      const heightRatio = size / Math.max(glyphHeight, candidate.glyphHeight);
      const verticalStep = candidate.rect.y - rect.y;
      const centerDistance = Math.abs((rect.x + rect.width / 2) - (candidate.rect.x + candidate.rect.width / 2));
      const sameTextFlow = centerDistance <= Math.min(33, Math.max(rect.width, candidate.rect.width) * 1.1);
      return heightRatio >= 0.65 && verticalStep >= size * 0.7 && verticalStep <= Math.max(glyphHeight, candidate.glyphHeight) * 1.5
        && sameTextFlow; // disjoint narrow PDF columns must never be stitched together
    }).sort((a, b) => a.rect.y - b.rect.y)[0];
    if (next) {
      const nextTop = next.rect.y + next.glyphHeight * 0.1;
      const gap = nextTop - (painted.y + painted.height);
      const size = Math.min(glyphHeight, next.glyphHeight);
      // Only the small, normal interline gap may be filled. Do not bridge paragraphs,
      // unusual leading, superscripts or text in another column; never broaden the x range.
      if (gap > 0 && gap <= size * 0.24) {
        painted.height = nextTop + size * 0.045 - painted.y;
      }
    }
    return painted;
  });
}
