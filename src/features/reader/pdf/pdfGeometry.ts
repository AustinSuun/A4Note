import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PositionJson } from '../../../core/types';
import { pdfCoordinateLayer } from './pdfCoordinates';
import type { DragDraft, RectBox, TextItemBox, TextOrientation } from './types';

const PDF_RENDER_BUFFER_SCALE = 2.15;

export async function extractTextItemBoxes(page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<TextItemBox[]> {
  const textContent = await page.getTextContent();
  return textContent.items
    .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item && Boolean(item.str?.trim()) && 'transform' in item)
    .map((item) => {
      const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const orientation = textOrientationFromTransform(transformed);
      const runLength = Math.max(item.width * viewport.scale, 1);
      if (orientation === 0) {
        const x = transformed[4];
        const y = transformed[5];
        const height = Math.max(Math.abs(transformed[3]), item.height * viewport.scale, 6);
        // `y` is the PDF text baseline. Keep the selectable/run box as ascent→baseline so hit
        // testing, offsets and old annotation data stay stable; highlight/underline helpers add
        // descender coverage on the baseline side instead of pretending this box contains it.
        return textItemBox(item.str, x, y - height, runLength, height, height, viewport, orientation);
      }
      // `getViewport` already folds the page's /Rotate into `transform`, so a rotated run's
      // direction and ascent vectors are no longer axis aligned. Walk the run's four corners and
      // keep their axis-aligned bounds so the span covers the painted glyphs and stays on the page.
      const glyphHeight = Math.max(Math.hypot(transformed[2], transformed[3]), item.height * viewport.scale, 6);
      const bounds = rotatedRunBounds(transformed, runLength, glyphHeight);
      return textItemBox(item.str, bounds.left, bounds.top, bounds.width, bounds.height, glyphHeight, viewport, orientation);
    })
    .filter((item) => item.width > 0.15 && item.height > 0.15);
}

/** Reading direction of a text run in viewport space, quantized to clockwise quarter turns. */
export function textOrientationFromTransform(transform: ArrayLike<number>): TextOrientation {
  const angle = (Math.atan2(transform[1], transform[0]) * 180) / Math.PI;
  const quarter = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return quarter === 90 || quarter === 180 || quarter === 270 ? quarter : 0;
}

function rotatedRunBounds(transform: ArrayLike<number>, runLength: number, glyphHeight: number) {
  const runNorm = Math.hypot(transform[0], transform[1]);
  const ascentNorm = Math.hypot(transform[2], transform[3]);
  const run: [number, number] = runNorm > 0 ? [transform[0] / runNorm, transform[1] / runNorm] : [1, 0];
  const ascent: [number, number] = ascentNorm > 0 ? [transform[2] / ascentNorm, transform[3] / ascentNorm] : [0, -1];
  const xs = [0, run[0] * runLength, ascent[0] * glyphHeight, run[0] * runLength + ascent[0] * glyphHeight].map((dx) => transform[4] + dx);
  const ys = [0, run[1] * runLength, ascent[1] * glyphHeight, run[1] * runLength + ascent[1] * glyphHeight].map((dy) => transform[5] + dy);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function textItemBox(text: string, left: number, top: number, width: number, height: number, fontSize: number, viewport: pdfjsLib.PageViewport, orientation: TextOrientation): TextItemBox {
  const box: TextItemBox = {
    text,
    x: clamp((left / viewport.width) * 100, 0, 100),
    y: clamp((top / viewport.height) * 100, 0, 100),
    width: clamp((width / viewport.width) * 100, 0, 100),
    height: clamp((height / viewport.height) * 100, 0, 100),
    fontSize,
  };
  return orientation ? { ...box, orientation } : box;
}

export function normalizeClientRect(rect: DOMRect | ClientRect, container: HTMLElement): RectBox | null {
  const containerRect = pdfCoordinateLayer(container).getBoundingClientRect();
  if (!(containerRect.width > 0 && containerRect.height > 0) || ![rect.left, rect.top, rect.width, rect.height, containerRect.left, containerRect.top, containerRect.width, containerRect.height].every(Number.isFinite)) return null;
  // Allow a small epsilon for outer clipping: selection rects that slightly
  // overflow the page (e.g. descenders) should still be considered, but
  // completely disjoint rects from other pages are rejected.
  const epsilon = 0.5;
  const left = Math.max(rect.left, containerRect.left - epsilon);
  const top = Math.max(rect.top, containerRect.top - epsilon);
  const right = Math.min(rect.left + rect.width, containerRect.left + containerRect.width + epsilon);
  const bottom = Math.min(rect.top + rect.height, containerRect.top + containerRect.height + epsilon);
  if (right <= left + epsilon || bottom <= top + epsilon) return null;
  return {
    x: clamp(((left - containerRect.left) / containerRect.width) * 100, 0, 100),
    y: clamp(((top - containerRect.top) / containerRect.height) * 100, 0, 100),
    width: clamp(((right - left) / containerRect.width) * 100, 0, 100),
    height: clamp(((bottom - top) / containerRect.height) * 100, 0, 100),
  };
}

export function normalizeBox(drag: DragDraft) {
  const left = Math.min(drag.startX, drag.currentX);
  const top = Math.min(drag.startY, drag.currentY);
  const width = Math.abs(drag.currentX - drag.startX);
  const height = Math.abs(drag.currentY - drag.startY);
  return {
    x: clamp(left, 0, 99),
    y: clamp(top, 0, 99),
    width: clamp(width, 0, 100),
    height: clamp(height, 0, 100),
  };
}

export function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clonePositionJson(positionJson: PositionJson): PositionJson {
  return JSON.parse(JSON.stringify(positionJson)) as PositionJson;
}

export function outputScaleForViewport(width: number, height: number) {
  const deviceScale = Math.max(window.devicePixelRatio || 1, 1.5);
  const preferredScale = Math.min(deviceScale, PDF_RENDER_BUFFER_SCALE);
  const maxPixels = 14_000_000;
  const preferredPixels = width * height * preferredScale * preferredScale;
  if (preferredPixels <= maxPixels) return preferredScale;
  return Math.max(1.25, Math.sqrt(maxPixels / Math.max(width * height, 1)));
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
