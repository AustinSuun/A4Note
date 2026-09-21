import type { PositionJson } from '../../../core/types';
import { annotationSegments, highlightPositionStyle } from './pdfAnnotationHelpers';

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
  return annotationSegments(position).flatMap(segment => {
    if (!segment || typeof segment !== 'object') return [];
    const style = highlightPositionStyle(segment);
    const rect = { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
    return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? [rect] : [];
  });
}
