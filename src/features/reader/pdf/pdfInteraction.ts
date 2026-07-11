import type { MouseEvent } from 'react';
import type { PositionJson } from '../../../core/types';
import type { DragDraft, StickyDrag } from './types';

const PAGE_VISIBLE_MARGIN = 0.3;
const PAGE_VISIBLE_THRESHOLD = 0.08;

export function pointFromEvent(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

export function createDragDraft(page: number, point: { x: number; y: number }): DragDraft {
  return {
    page,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y,
  };
}

export function updateDragDraftPoint(draft: DragDraft, point: { x: number; y: number }): DragDraft {
  return { ...draft, currentX: point.x, currentY: point.y };
}

export function arrowPositionFromDrag(draft: DragDraft): PositionJson {
  const x = Math.min(draft.startX, draft.currentX);
  const y = Math.min(draft.startY, draft.currentY);
  const width = Math.max(Math.abs(draft.currentX - draft.startX), 0.1);
  const height = Math.max(Math.abs(draft.currentY - draft.startY), 0.1);
  return {
    x,
    y,
    width,
    height,
    startX: draft.startX,
    startY: draft.startY,
    endX: draft.currentX,
    endY: draft.currentY,
  };
}

export function stickyPositionFromDrag(positionJson: PositionJson, stickyDrag: StickyDrag, point: { x: number; y: number }): PositionJson {
  return {
    ...positionJson,
    x: clamp(point.x - stickyDrag.offsetX, 0, 96),
    y: clamp(point.y - stickyDrag.offsetY, 0, 96),
    width: Math.max(numberValue(positionJson.width, 20), 12),
    height: Math.max(numberValue(positionJson.height, 9), 7),
  };
}

export function currentVisiblePage(container: HTMLElement) {
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page[data-page]'));
  const rect = container.getBoundingClientRect();
  const found = pages.find((page) => {
    const pageRect = page.getBoundingClientRect();
    return pageRect.bottom > rect.top + rect.height * PAGE_VISIBLE_MARGIN && pageRect.top < rect.top + rect.height * (1 - PAGE_VISIBLE_THRESHOLD);
  });
  return found ? Number(found.dataset.page) : 1;
}

export function scrollPageIntoViewIfNeeded(pageElement: HTMLElement) {
  const container = pageElement.closest<HTMLElement>('.pdf-document');
  if (container && isPageSufficientlyVisible(container, pageElement)) return;
  pageElement.scrollIntoView({ block: 'center', behavior: 'auto' });
}

export function isPageSufficientlyVisible(container: HTMLElement, pageElement: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();
  const visibleTop = Math.max(containerRect.top, pageRect.top);
  const visibleBottom = Math.min(containerRect.bottom, pageRect.bottom);
  const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
  const targetHeight = Math.max(Math.min(containerRect.height, pageRect.height), 1);
  return visibleHeight / targetHeight >= 0.55;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
