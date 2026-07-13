import type { MouseEvent, PointerEvent } from 'react';
import type { PositionJson } from '../../../core/types';
import type { AnnotationResize, DragDraft, PdfScrollAnchor, StickyDrag } from './types';

const PAGE_VISIBLE_MARGIN = 0.3;
const PAGE_VISIBLE_THRESHOLD = 0.08;

export function pointFromEvent(
  event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>,
  coordinateTarget: Pick<HTMLElement, 'getBoundingClientRect'> = event.currentTarget,
) {
  event.preventDefault();
  event.stopPropagation();
  const rect = coordinateTarget.getBoundingClientRect();
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
  const width = Math.max(numberValue(positionJson.width, 20), 0.1);
  const height = Math.max(numberValue(positionJson.height, 9), 0.1);
  return {
    ...positionJson,
    x: clamp(point.x - stickyDrag.offsetX, 0, Math.max(100 - width, 0)),
    y: clamp(point.y - stickyDrag.offsetY, 0, Math.max(100 - height, 0)),
    width,
    height,
  };
}

export function resizePositionFromDrag(
  positionJson: PositionJson,
  resize: AnnotationResize,
  point: { x: number; y: number },
): PositionJson {
  const horizontal = resize.handle;
  const vertical = resize.handle;
  let left = resize.origin.x;
  let right = resize.origin.x + resize.origin.width;
  let top = resize.origin.y;
  let bottom = resize.origin.y + resize.origin.height;

  if (horizontal.includes('w')) left = clamp(point.x, 0, right - resize.minWidth);
  if (horizontal.includes('e')) right = clamp(point.x, left + resize.minWidth, 100);
  if (vertical.includes('n')) top = clamp(point.y, 0, bottom - resize.minHeight);
  if (vertical.includes('s')) bottom = clamp(point.y, top + resize.minHeight, 100);

  return {
    ...positionJson,
    x: left,
    y: top,
    width: Math.max(right - left, resize.minWidth),
    height: Math.max(bottom - top, resize.minHeight),
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

export function scrollAnchorFromContainer(container: HTMLElement): PdfScrollAnchor {
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page[data-page]'));
  if (!pages.length) return { page: 1, pageProgress: 0 };

  const scrollTop = container.scrollTop;
  let pageIndex = 0;
  for (let index = 1; index < pages.length; index += 1) {
    if (pages[index].offsetTop > scrollTop) break;
    pageIndex = index;
  }

  const page = pages[pageIndex];
  const nextPage = pages[pageIndex + 1];
  const pageSpan = Math.max(nextPage ? nextPage.offsetTop - page.offsetTop : page.offsetHeight, 1);
  return {
    page: Number(page.dataset.page) || pageIndex + 1,
    pageProgress: clamp((scrollTop - page.offsetTop) / pageSpan, 0, 1),
  };
}

export function scrollTopFromAnchor(container: HTMLElement, anchor: PdfScrollAnchor) {
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page[data-page]'));
  if (!pages.length) return 0;

  const pageIndex = clamp(Math.round(anchor.page) - 1, 0, pages.length - 1);
  const page = pages[pageIndex];
  const nextPage = pages[pageIndex + 1];
  const pageSpan = Math.max(nextPage ? nextPage.offsetTop - page.offsetTop : page.offsetHeight, 1);
  const available = Math.max(container.scrollHeight - container.clientHeight, 0);
  return clamp(page.offsetTop + clamp(anchor.pageProgress, 0, 1) * pageSpan, 0, available);
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
