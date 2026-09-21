import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PositionJson } from '../../../core/types';
import { pdfCoordinateLayer } from './pdfCoordinates';
import type { DragDraft, RectBox, TextItemBox } from './types';

const PDF_RENDER_BUFFER_SCALE = 2.15;

export async function extractTextItemBoxes(page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<TextItemBox[]> {
  const textContent = await page.getTextContent();
  return textContent.items
    .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item && Boolean(item.str?.trim()) && 'transform' in item)
    .map((item) => {
      const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = transformed[4];
      const y = transformed[5];
      const width = Math.max(item.width * viewport.scale, 1);
      const height = Math.max(Math.abs(transformed[3]), item.height * viewport.scale, 6);
      return {
        text: item.str,
        x: clamp((x / viewport.width) * 100, 0, 100),
        y: clamp(((y - height) / viewport.height) * 100, 0, 100),
        width: clamp((width / viewport.width) * 100, 0, 100),
        height: clamp((height / viewport.height) * 100, 0, 100),
        fontSize: height,
      };
    })
    .filter((item) => item.width > 0.15 && item.height > 0.15);
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
