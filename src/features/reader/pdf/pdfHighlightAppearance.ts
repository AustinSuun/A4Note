import type { PositionJson } from '../../../core/types';
import { annotationSegments, highlightPositionStyle } from './pdfAnnotationHelpers';

export const HIGHLIGHT_APPEARANCE_KEY = 'aster.reader.highlightAppearance.v1';
export const DEFAULT_HIGHLIGHT_OPACITY = 22;
export type HighlightAppearance = { opacity: number; blend: 'multiply' | 'normal' };
export function normalizeHighlightAppearance(value: unknown): HighlightAppearance {
  const data = value && typeof value === 'object' ? value as Partial<HighlightAppearance> : {};
  return {
    opacity: typeof data.opacity === 'number' && Number.isFinite(data.opacity)
      ? Math.min(35, Math.max(10, Math.round(data.opacity))) : DEFAULT_HIGHLIGHT_OPACITY,
    blend: data.blend === 'normal' ? 'normal' : 'multiply',
  };
}
export function parseHighlightAppearance(raw: string | null): HighlightAppearance {
  try { return normalizeHighlightAppearance(raw ? JSON.parse(raw) : null); }
  catch { return normalizeHighlightAppearance(null); }
}
export function highlightFill(color: string): string {
  const presets: Record<string, string> = { yellow: '#ffe579', green: '#b9e7c5', blue: '#b9cef7', purple: '#cbb7ef' };
  return presets[color] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : presets.yellow);
}
export function highlightRects(position: PositionJson) {
  return annotationSegments(position).flatMap(segment => {
    if (!segment || typeof segment !== 'object') return [];
    const style = highlightPositionStyle(segment);
    const rect = { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
    return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? [rect] : [];
  });
}
