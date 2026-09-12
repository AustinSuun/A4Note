import { type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { zh } from '../../../ui/zh';
import { outputScaleForViewport } from './pdfGeometry';
import { PdfTextLayer } from './PdfTextLayer';
import type { CommentPopover, PageMeta, ReaderToolSettings } from './types';

export type PdfPageViewProps = {
  pageMeta: PageMeta;
  zoom: number;
  displayZoom: number;
  selectableText: boolean;
  annotationLayer: ReactNode;
  commentPopover: CommentPopover | null;
  eraserPreview: { x: number; y: number; size: number; shape: ReaderToolSettings['eraserShape'] } | null;
  pageHandlers: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onClick: (event: MouseEvent<HTMLDivElement>) => void;
  };
  flashKind: 'page-jump' | 'annotation' | null;
  priorityDistance: number;
  onCommentPopoverChange: (value: CommentPopover | null) => void;
  onSaveComment: () => void | Promise<void>;
};

export function PdfPageView({
  pageMeta,
  zoom,
  displayZoom,
  selectableText,
  annotationLayer,
  commentPopover,
  eraserPreview,
  pageHandlers,
  flashKind,
  priorityDistance,
  onCommentPopoverChange,
  onSaveComment,
}: PdfPageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSequenceRef = useRef(0);
  const priorityDistanceRef = useRef(priorityDistance);
  const [shouldRender, setShouldRender] = useState(false);
  const [hasBitmap, setHasBitmap] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    priorityDistanceRef.current = priorityDistance;
  }, [priorityDistance]);

  useEffect(() => {
    const root = rootRef.current?.closest('.pdf-document');
    const target = rootRef.current;
    if (!root || !target) {
      setShouldRender(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShouldRender(entry.isIntersecting);
      },
      { root, rootMargin: '760px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current?.closest('.pdf-document');
    const target = rootRef.current;
    if (!root || !target || typeof ResizeObserver === 'undefined') return undefined;
    const refreshVisibility = () => {
      // Workbench sidebar resizing changes the scroll container's geometry on
      // every frame. The bitmap itself does not need to be reclassified while
      // dragging; defer one measurement until the divider is released.
      if (document.body.classList.contains('is-horizontal-resizing')) return;
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visible = root.clientWidth > 0
        && root.clientHeight > 0
        && targetRect.bottom > rootRect.top
        && targetRect.top < rootRect.bottom;
      setShouldRender(visible);
    };
    const observer = new ResizeObserver(refreshVisibility);
    observer.observe(root);
    observer.observe(target);
    refreshVisibility();
    const refreshAfterWorkbenchResize = () => refreshVisibility();
    window.addEventListener('workbench-resize-end', refreshAfterWorkbenchResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('workbench-resize-end', refreshAfterWorkbenchResize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let delayTimer: number | null = null;
    let releaseDelay: (() => void) | null = null;
    if (!shouldRender) setIsUpdating(false);
    const renderSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderSequence;
    async function renderPage() {
      if (!canvasRef.current || !shouldRender) return;
      const renderPriorityDistance = priorityDistanceRef.current;
      const renderDelay = renderPriorityDistance <= 1 ? 16 : renderPriorityDistance === 2 ? 48 : 96;
      if (renderDelay) {
        await new Promise<void>((resolve) => {
          releaseDelay = resolve;
          delayTimer = window.setTimeout(resolve, renderDelay);
        });
        if (cancelled) return;
      }
      if (cancelled || !canvasRef.current) return;
      const viewport = pageMeta.pdfPage.getViewport({ scale: zoom });
      setIsUpdating(true);
      setRenderError('');
      const outputScale = outputScaleForViewport(viewport.width, viewport.height);
      const pixelWidth = Math.floor(viewport.width * outputScale);
      const pixelHeight = Math.floor(viewport.height * outputScale);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = pixelWidth;
      renderCanvas.height = pixelHeight;
      const renderContext = renderCanvas.getContext('2d', { alpha: false });
      if (!renderContext) throw new Error('无法创建PDF绘图上下文');
      renderContext.imageSmoothingEnabled = true;
      renderContext.imageSmoothingQuality = 'high';
      renderTask = pageMeta.pdfPage.render({
        canvas: renderCanvas,
        canvasContext: renderContext,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      try { await renderTask.promise; }
      catch (error) {
        if ((error as { name?: string })?.name === 'RenderingCancelledException') return;
        throw error;
      }
      if (!cancelled && canvasRef.current && renderSequenceRef.current === renderSequence) {
        const visibleCanvas = canvasRef.current;
        if (visibleCanvas.width !== pixelWidth) visibleCanvas.width = pixelWidth;
        if (visibleCanvas.height !== pixelHeight) visibleCanvas.height = pixelHeight;
        const visibleContext = visibleCanvas.getContext('2d', { alpha: false });
        if (visibleContext) {
          visibleContext.imageSmoothingEnabled = true;
          visibleContext.imageSmoothingQuality = 'high';
          visibleContext.clearRect(0, 0, pixelWidth, pixelHeight);
          visibleContext.drawImage(renderCanvas, 0, 0);
        }
        setHasBitmap(true);
        setIsUpdating(false);
      }
    }
    void renderPage().catch((error) => {
      if (cancelled || renderSequenceRef.current !== renderSequence) return;
      setIsUpdating(false);
      setRenderError(`本页渲染失败：${String(error)}`);
    });
    return () => {
      cancelled = true;
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      releaseDelay?.();
      renderTask?.cancel();
    };
  }, [pageMeta, zoom, shouldRender, retryRevision]);

  useEffect(() => {
    const farFromViewport = priorityDistance > 7;
    if (shouldRender || !hasBitmap || !farFromViewport || flashKind || commentPopover) return;
    const timer = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
      setHasBitmap(false);
      setIsUpdating(false);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [shouldRender, hasBitmap, priorityDistance, flashKind, commentPopover]);

  return (
    <div className={`pdf-page ${isUpdating ? 'updating' : ''} ${!hasBitmap ? 'released' : ''} ${flashKind ? `flash-${flashKind}` : ''}`} data-reader-layer="pdf-page" data-page={pageMeta.pageNumber} ref={rootRef} {...pageHandlers}>
      {renderError && <div className="pdf-render-error" role="alert" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <span>{renderError}</span><button type="button" onClick={() => setRetryRevision((current) => current + 1)}>重新渲染本页</button>
      </div>}
      <div className="pdf-render-layer" style={{ width: pageMeta.baseWidth * displayZoom, height: pageMeta.baseHeight * displayZoom }}>
        <canvas ref={canvasRef} className="pdf-canvas-page ready" />
        <PdfTextLayer textItems={pageMeta.textItems} zoom={displayZoom} selectable={selectableText} />
        {annotationLayer}
        {eraserPreview && (
          <div
            className={`eraser-cursor-preview ${eraserPreview.shape}`}
            style={{ left: eraserPreview.x, top: eraserPreview.y, width: eraserPreview.size, height: eraserPreview.size }}
            aria-hidden="true"
          />
        )}
        {commentPopover && (
          <div
            className="comment-popover"
            style={{ left: commentPopover.leftPx, top: commentPopover.topPx }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky-format-row">
              <button type="button" className={commentPopover.bold ? 'active' : ''} onClick={() => onCommentPopoverChange({ ...commentPopover, bold: !commentPopover.bold })}>
                B
              </button>
              <button type="button" className={commentPopover.italic ? 'active' : ''} onClick={() => onCommentPopoverChange({ ...commentPopover, italic: !commentPopover.italic })}>
                I
              </button>
              <select value={commentPopover.fontSize} onChange={(event) => onCommentPopoverChange({ ...commentPopover, fontSize: Number(event.target.value) })}>
                {[12, 13, 14, 16, 18].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <input type="color" value={commentPopover.textColor} onChange={(event) => onCommentPopoverChange({ ...commentPopover, textColor: event.target.value })} />
            </div>
            <textarea value={commentPopover.text} onChange={(event) => onCommentPopoverChange({ ...commentPopover, text: event.target.value })} placeholder={zh.reader.commentPlaceholder} autoFocus />
            <div>
              <button type="button" className="subtle-button rounded-button" onClick={() => onCommentPopoverChange(null)}>
                {zh.reader.cancelComment}
              </button>
              <button type="button" className="primary rounded-button" onClick={() => void onSaveComment()}>
                {zh.reader.saveComment}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
