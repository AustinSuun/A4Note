import { type MouseEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { useLayoutEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { Annotation, AnnotationColor, AnnotationDraft, AnnotationType, PositionJson, ReaderTool } from '../../../core/types';
import { isTauriRuntime, loadPaperFileBytes } from '../../../platform/nativeApi';
import { readFileBytes } from '../../../platform/projects';
import { zh } from '../../../ui/zh';
import { annotationLabel, buildAnnotationDraft } from './pdfAnnotationHelpers';
import type { PdfDocumentSource } from './pdfSource';
import { AnnotationOverlay } from './AnnotationOverlay';
import {
  clamp,
  clonePositionJson,
  extractTextItemBoxes,
  normalizeBox,
  normalizeClientRect,
  numberValue,
} from './pdfGeometry';
import { arrowPositionFromDrag, createDragDraft, currentVisiblePage, pointFromEvent, resizePositionFromDrag, scrollAnchorFromContainer, scrollPageIntoViewIfNeeded, scrollTopFromAnchor, stickyPositionFromDrag, updateDragDraftPoint } from './pdfInteraction';
import { PdfPageView } from './PdfPageView';
import { SelectionPopup } from './SelectionPopup';
import { boundingBox, mergeRectsIntoLineSegments, textItemSelectionsFromRange, textSelectionFromDrag, textSelectionRectsFromOffsets } from './pdfSelection';
import type {
  AnnotationMarkModel,
  AnnotationResize,
  AnnotationResizeHandle,
  CommentPopover,
  DraftAnnotationPreview,
  DragDraft,
  InkDraft,
  PageMeta,
  PdfScrollAnchor,
  PdfZoomAnchor,
  PdfStatus,
  ReaderFlash,
  ReaderToolSettings,
  RectBox,
  StickyDrag,
  StickyDragPreview,
} from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function PdfReader({
  source,
  annotations,
  annotationsEnabled = true,
  activeTool,
  activeAnnotationColor,
  toolSettings,
  onCompleteOneShotTool,
  zoom,
  onZoomChange,
  requestedPage,
  onCreateAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onReaderStateChange,
  onFocusAnnotation,
  focusedAnnotationId: requestedFocusAnnotationId,
  syncScrollEnabled,
  syncScrollAnchor,
  onScrollSync,
}: {
  source: PdfDocumentSource;
  annotations: Annotation[];
  /**
   * False makes the viewer read-only: the selection popup that creates
   * highlights disappears. Resource PDF tabs enable this only when they have a
   * stable resource annotation store.
   */
  annotationsEnabled?: boolean;
  activeTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  toolSettings: ReaderToolSettings;
  onCompleteOneShotTool?: () => void;
  zoom: number;
  onZoomChange: (zoom: number, anchor?: PdfZoomAnchor) => void;
  requestedPage?: number | null;
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onReaderStateChange?: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation?: (annotationId: string | null) => void;
  focusedAnnotationId?: string | null;
  syncScrollEnabled?: boolean;
  syncScrollAnchor?: PdfScrollAnchor | null;
  onScrollSync?: (anchor: PdfScrollAnchor) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentContentRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [draftAnnotations, setDraftAnnotations] = useState<DraftAnnotationPreview[]>([]);
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const inkPointerIdRef = useRef<number | null>(null);
  const inkPointerTargetRef = useRef<HTMLDivElement | null>(null);
  const [commentPopover, setCommentPopover] = useState<CommentPopover | null>(null);
  const [stickyDrag, setStickyDrag] = useState<StickyDrag | null>(null);
  const [annotationResize, setAnnotationResize] = useState<AnnotationResize | null>(null);
  const [stickyDragPreview, setStickyDragPreview] = useState<StickyDragPreview | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  // The page layout follows the committed zoom directly. During a wheel
  // gesture the existing layout is painted through a temporary transform;
  // this keeps PDF.js from starting a render for every wheel tick.
  const displayZoom = zoom;
  const [eraserCursor, setEraserCursor] = useState<{ page: number; x: number; y: number } | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const zoomFrameRef = useRef<number | null>(null);
  const zoomTimerRef = useRef<number | null>(null);
  const zoomGestureAnchorRef = useRef<PdfZoomAnchor | null>(null);
  const scrollUpdateFrameRef = useRef<number | null>(null);
  const scrollProgressRef = useRef(0);
  const visiblePageRef = useRef(1);
  const pendingZoomRef = useRef(zoom);
  const localFocusRequestRef = useRef<string | null>(null);
  const lastExternalFocusRef = useRef<string | null>(null);
  const applyingSyncScrollRef = useRef(false);
  const [status, setStatus] = useState<PdfStatus>('placeholder');
  const [message, setMessage] = useState(zh.reader.pdfPlaceholder);
  const [flash, setFlash] = useState<ReaderFlash | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<{ visible: boolean; x: number; y: number; pageNumber: number; pageElement: HTMLElement | null }>({ visible: false, x: 0, y: 0, pageNumber: 0, pageElement: null });
  const activeFileId = source.fileId;
  const activeResourceId = source.resourceId;
  const currentFileAnnotations = useMemo(
    () => annotations.filter((annotation) => activeResourceId ? annotation.resourceId === activeResourceId : !activeFileId || annotation.fileId === activeFileId),
    [activeFileId, activeResourceId, annotations],
  );
  const displayedAnnotations = useMemo(
    () =>
      stickyDragPreview
        ? currentFileAnnotations.map((annotation) =>
            annotation.id === stickyDragPreview.annotationId ? { ...annotation, positionJson: stickyDragPreview.positionJson } : annotation,
          )
        : currentFileAnnotations,
    [currentFileAnnotations, stickyDragPreview],
  );
  const textSelectionToolsActive = activeTool === 'highlight' || activeTool === 'underline';
  const shapeToolsActive = activeTool === 'area' || activeTool === 'rect' || activeTool === 'arrow';
  const selectableText = activeTool === 'cursor' || textSelectionToolsActive;

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    const disposeLoadingTask = () => {
      const task = loadingTask; loadingTask = null;
      if (task) void task.destroy().catch(() => { /* cancellation already reported by load */ });
    };
    async function loadPdf() {
      const request = source.request;
      if (!request || !isTauriRuntime()) {
        setPdfDocument(null);
        setPages([]);
        setStatus('placeholder');
        setMessage(zh.reader.pdfPlaceholder);
        return;
      }
      try {
        setPdfDocument(null);
        setPages([]);
        setStatus('loading');
        setMessage(zh.reader.pdfLoading);
        const bytes = request.source === 'paperFile'
          ? await loadPaperFileBytes({ paperId: request.paperId, kind: request.kind, fileId: request.fileId })
          : await readFileBytes(request.path);
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPdfDocument(pdf);
      } catch (error) {
        if (cancelled) return;
        disposeLoadingTask();
        console.error('Failed to load PDF', error);
        setPdfDocument(null);
        setPages([]);
        setStatus('error');
        setMessage(zh.reader.pdfError);
      }
    }
    void loadPdf();
    return () => {
      cancelled = true;
      disposeLoadingTask();
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
      if (zoomTimerRef.current !== null) {
        window.clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = null;
      }
    };
  }, [source.key]);

  useEffect(() => {
    let cancelled = false;
    async function collectPageMeta() {
      if (!pdfDocument) return;
      try {
        const metas: PageMeta[] = [];
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1 });
          metas.push({
            pageNumber,
            baseWidth: viewport.width,
            baseHeight: viewport.height,
            pdfPage: page,
            textItems: await extractTextItemBoxes(page, viewport),
          });
        }
        if (!cancelled) {
          setPages(metas);
          setStatus('ready');
          setMessage('');
          requestAnimationFrame(updateScrollProgress);
        }
      } catch (error) {
        console.error('Failed to prepare PDF pages', error);
        if (!cancelled) {
          setPages([]);
          setStatus('error');
          setMessage(zh.reader.pdfError);
        }
      }
    }
    void collectPageMeta();
    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  useEffect(() => {
    setDraftAnnotations([]);
    setDragDraft(null);
    const pointerId = inkPointerIdRef.current;
    const pointerTarget = inkPointerTargetRef.current;
    if (pointerId !== null && pointerTarget?.hasPointerCapture(pointerId)) {
      pointerTarget.releasePointerCapture(pointerId);
    }
    inkPointerIdRef.current = null;
    inkPointerTargetRef.current = null;
    inkDraftRef.current = null;
    setInkDraft(null);
    setCommentPopover(null);
    setStickyDrag(null);
    setAnnotationResize(null);
    setStickyDragPreview(null);
  }, [source.key]);

  useLayoutEffect(() => {
    pendingZoomRef.current = zoom;
    zoomGestureAnchorRef.current = null;
    documentContentRef.current?.style.removeProperty('transform');
    documentContentRef.current?.style.removeProperty('transform-origin');
  }, [zoom]);

  useEffect(() => {
    if (activeTool !== 'eraser') {
      setEraserCursor(null);
    }
    if (activeTool !== 'ink') {
      const pointerId = inkPointerIdRef.current;
      const pointerTarget = inkPointerTargetRef.current;
      inkPointerIdRef.current = null;
      inkPointerTargetRef.current = null;
      inkDraftRef.current = null;
      setInkDraft(null);
      if (pointerId !== null && pointerTarget?.hasPointerCapture(pointerId)) {
        pointerTarget.releasePointerCapture(pointerId);
      }
    }
  }, [activeTool]);

  useEffect(() => {
    if (!textSelectionToolsActive) return;
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const anchor = selection.anchorNode?.parentElement?.closest('.pdf-page[data-page]');
      const pageElement = anchor as HTMLElement | null;
      if (!pageElement) return;
      const pageNumber = Number(pageElement.dataset.page);
      if (!Number.isFinite(pageNumber)) return;
      void finishTextSelection(pageNumber, pageElement);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [textSelectionToolsActive, source.key, activeTool, pages.length]);

  // cursor 模式下文本选中后显示 SelectionPopup
  useEffect(() => {
    if (activeTool !== 'cursor' || !annotationsEnabled) { setSelectionPopup((s) => s.visible ? { ...s, visible: false } : s); return; }
    const handleMouseUp = (event: globalThis.MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionPopup((s) => ({ ...s, visible: false }));
        return;
      }
      const anchor = selection.anchorNode?.parentElement?.closest('.pdf-page[data-page]');
      const pageElement = anchor as HTMLElement | null;
      if (!pageElement) { setSelectionPopup((s) => ({ ...s, visible: false })); return; }
      const pageNumber = Number(pageElement.dataset.page);
      if (!Number.isFinite(pageNumber)) return;
      setSelectionPopup({ visible: true, x: event.clientX, y: event.clientY, pageNumber, pageElement });
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [activeTool, annotationsEnabled, source.key, pages.length]);

  useEffect(() => {
    if (!requestedFocusAnnotationId) {
      lastExternalFocusRef.current = null;
      setFocusedAnnotationId(null);
      return;
    }
    if (localFocusRequestRef.current === requestedFocusAnnotationId) {
      localFocusRequestRef.current = null;
      lastExternalFocusRef.current = requestedFocusAnnotationId;
      setFocusedAnnotationId(requestedFocusAnnotationId);
      return;
    }
    const shouldScroll = lastExternalFocusRef.current !== requestedFocusAnnotationId;
    const applied = focusAnnotation(requestedFocusAnnotationId, { scroll: shouldScroll });
    if (applied) lastExternalFocusRef.current = requestedFocusAnnotationId;
  }, [requestedFocusAnnotationId, currentFileAnnotations, pages.length]);

  useEffect(() => {
    if (!requestedPage) return;
    const pageElement = containerRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${requestedPage}"]`);
    pageElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setFlash({ page: requestedPage, kind: 'page-jump' });
    const timer = window.setTimeout(() => {
      setFlash((current) => (current?.page === requestedPage ? null : current));
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [requestedPage, pages.length]);

  useEffect(() => {
    if (!syncScrollEnabled || !syncScrollAnchor) return;
    const container = containerRef.current;
    if (!container) return;
    const nextTop = scrollTopFromAnchor(container, syncScrollAnchor);
    if (Math.abs(container.scrollTop - nextTop) < 1) return;
    applyingSyncScrollRef.current = true;
    container.scrollTop = nextTop;
    requestAnimationFrame(() => {
      updateScrollProgress();
      applyingSyncScrollRef.current = false;
    });
  }, [syncScrollAnchor?.page, syncScrollAnchor?.pageProgress, syncScrollEnabled, pages.length]);

  useEffect(() => {
    onReaderStateChange?.({
      currentPage: visiblePage,
      totalPages: pages.length || 1,
    });
  }, [onReaderStateChange, pages.length, visiblePage]);

  const annotationsByPage = useMemo(() => {
    return displayedAnnotations.reduce<Record<number, Annotation[]>>((grouped, annotation) => {
      if (!grouped[annotation.page]) grouped[annotation.page] = [];
      grouped[annotation.page].push(annotation);
      return grouped;
    }, {});
  }, [displayedAnnotations]);

  const draftAnnotationsByPage = useMemo(() => {
    return draftAnnotations.reduce<Record<number, DraftAnnotationPreview[]>>((grouped, annotation) => {
      if (!grouped[annotation.page]) grouped[annotation.page] = [];
      grouped[annotation.page].push(annotation);
      return grouped;
    }, {});
  }, [draftAnnotations]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const content = documentContentRef.current;
    if (!container || !rect || !content) return;
    if (!zoomGestureAnchorRef.current) {
      const contentRect = content.getBoundingClientRect();
      // Keep the pointer over the same document point while the compositor
      // preview scales. These coordinates remain valid even while `transform`
      // changes the content's client rect.
      zoomGestureAnchorRef.current = {
        x: event.clientX,
        y: event.clientY,
        contentX: clamp(event.clientX - contentRect.left, 0, Math.max(contentRect.width, 1)),
        contentY: clamp(event.clientY - contentRect.top, 0, Math.max(contentRect.height, 1)),
        contentOriginX: contentRect.left - rect.left + container.scrollLeft,
        contentOriginY: contentRect.top - rect.top + container.scrollTop,
      };
    }
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    pendingZoomRef.current = clamp(Number((pendingZoomRef.current + delta).toFixed(2)), 0.7, 2.2);
    // Keep the wheel gesture on the compositor. PDF.js only renders once the
    // user pauses, instead of starting a canvas render for every wheel event.
    // The old path called setDisplayZoom(pendingZoomRef.current) here, which
    // forced every PDF page to re-render on each wheel tick.
    if (zoomFrameRef.current === null) {
      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        const currentContent = documentContentRef.current;
        const anchorPoint = zoomGestureAnchorRef.current;
        if (currentContent && anchorPoint) {
          currentContent.style.transformOrigin = `${anchorPoint.contentX}px ${anchorPoint.contentY}px`;
          currentContent.style.setProperty('transform', `scale(${pendingZoomRef.current / zoom})`);
        }
      });
    }
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => {
      zoomTimerRef.current = null;
      const nextZoom = pendingZoomRef.current;
      const anchorPoint = zoomGestureAnchorRef.current;
      if (nextZoom === zoom || !anchorPoint) {
        documentContentRef.current?.style.removeProperty('transform');
        documentContentRef.current?.style.removeProperty('transform-origin');
        zoomGestureAnchorRef.current = null;
        return;
      }
      // Keep the preview in place until the committed zoom reaches React. The
      // layout effect above then removes it before paint, so users never see
      // an intermediate frame at the old scroll position.
      onZoomChange(nextZoom, anchorPoint);
    }, 160);
  };

  const updateScrollProgress = () => {
    const container = containerRef.current;
    if (!container) return;
    const available = container.scrollHeight - container.clientHeight;
    const nextProgress = available > 0 ? clamp(container.scrollTop / available, 0, 1) : 0;
    if (syncScrollEnabled && !applyingSyncScrollRef.current) {
      onScrollSync?.(scrollAnchorFromContainer(container));
    }
    if (scrollUpdateFrameRef.current !== null) return;
    scrollUpdateFrameRef.current = window.requestAnimationFrame(() => {
      scrollUpdateFrameRef.current = null;
      const latestContainer = containerRef.current;
      if (!latestContainer) return;
      const latestAvailable = latestContainer.scrollHeight - latestContainer.clientHeight;
      const latestProgress = latestAvailable > 0 ? clamp(latestContainer.scrollTop / latestAvailable, 0, 1) : 0;
      if (Math.abs(latestProgress - scrollProgressRef.current) > 0.002) {
        scrollProgressRef.current = latestProgress;
        setScrollProgress(latestProgress);
      }
      const currentPage = currentVisiblePage(latestContainer);
      if (currentPage === visiblePageRef.current) return;
      visiblePageRef.current = currentPage;
      setVisiblePage(currentPage);
      onReaderStateChange?.({ currentPage, totalPages: pages.length || 1 });
    });
  };

  const focusAnnotation = (annotationId: string, options: { scroll?: boolean } = {}) => {
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (!annotation) return false;
    const pageElement = containerRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${annotation.page}"]`);
    if (pageElement && options.scroll !== false) {
      scrollPageIntoViewIfNeeded(pageElement);
    }
    setFocusedAnnotationId(annotationId);
    setFlash({ page: annotation.page, kind: 'annotation' });
    window.setTimeout(() => setFlash((current) => (current?.page === annotation.page ? null : current)), 1200);
    return true;
  };

  const selectAnnotation = (annotationId: string) => {
    localFocusRequestRef.current = annotationId;
    setFocusedAnnotationId(annotationId);
    onFocusAnnotation?.(annotationId);
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (annotation) {
      setFlash({ page: annotation.page, kind: 'annotation' });
      window.setTimeout(() => setFlash((current) => (current?.page === annotation.page ? null : current)), 1200);
    }
  };

  const beginPan = (event: MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'cursor' || !containerRef.current) return;
    const shouldPan = event.button === 1 || (event.button === 0 && event.nativeEvent instanceof window.MouseEvent && event.nativeEvent.getModifierState('Space'));
    if (!shouldPan) return;
    event.preventDefault();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
    setIsPanning(true);
  };

  const updatePan = (event: MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !containerRef.current) return;
    event.preventDefault();
    const panStart = panStartRef.current;
    containerRef.current.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.x);
    containerRef.current.scrollTop = panStart.scrollTop - (event.clientY - panStart.y);
  };

  const endPan = () => {
    setIsPanning(false);
  };

  const beginInkStroke = (pageNumber: number, event: PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready' || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    inkPointerIdRef.current = event.pointerId;
    inkPointerTargetRef.current = event.currentTarget;
    const point = pointFromEvent(event);
    const nextDraft = { page: pageNumber, points: [point] };
    inkDraftRef.current = nextDraft;
    setInkDraft(nextDraft);
  };

  const updateInkStroke = (pageNumber: number, event: PointerEvent<HTMLDivElement>) => {
    if (inkPointerIdRef.current !== event.pointerId || !inkDraftRef.current || inkDraftRef.current.page !== pageNumber) return;
    if ((event.buttons & 1) === 0) {
      finishInkPointer(event);
      return;
    }
    const point = pointFromEvent(event);
    const currentDraft = inkDraftRef.current;
    const previous = currentDraft.points[currentDraft.points.length - 1];
    if (previous && Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) < 0.16) return;
    const nextDraft = { ...currentDraft, points: [...currentDraft.points, point] };
    inkDraftRef.current = nextDraft;
    setInkDraft(nextDraft);
  };

  const beginAnnotationDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (status !== 'ready') return;
    if (!shapeToolsActive) return;
    const point = pointFromEvent(event);
    setDragDraft(createDragDraft(pageNumber, point));
  };

  const updateAnnotationDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (!dragDraft || dragDraft.page !== pageNumber) return;
    const point = pointFromEvent(event);
    setDragDraft((current) => (current ? updateDragDraftPoint(current, point) : current));
  };

  const beginStickyDrag = (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (!annotation || (annotation.type !== 'comment' && annotation.type !== 'text' && annotation.type !== 'rect')) return;
    event.preventDefault();
    event.stopPropagation();
    const pageLayer = event.currentTarget.closest<HTMLElement>('.pdf-render-layer');
    if (!pageLayer) return;
    const point = pointFromEvent(event, pageLayer);
    setFocusedAnnotationId(annotationId);
    setAnnotationResize(null);
    setStickyDrag({
      annotationId,
      page: pageNumber,
      offsetX: point.x - numberValue(annotation.positionJson.x, point.x),
      offsetY: point.y - numberValue(annotation.positionJson.y, point.y),
    });
    setStickyDragPreview({
      annotationId,
      page: pageNumber,
      positionJson: annotation.positionJson,
    });
  };

  const beginAnnotationResize = (
    annotationId: string,
    pageNumber: number,
    handle: AnnotationResizeHandle,
    event: MouseEvent<HTMLElement>,
  ) => {
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (!annotation || (annotation.type !== 'rect' && annotation.type !== 'text')) return;
    event.preventDefault();
    event.stopPropagation();
    setFocusedAnnotationId(annotationId);
    setStickyDrag(null);
    setAnnotationResize({
      annotationId,
      page: pageNumber,
      handle,
      origin: {
        x: numberValue(annotation.positionJson.x, 0),
        y: numberValue(annotation.positionJson.y, 0),
        width: numberValue(annotation.positionJson.width, annotation.type === 'text' ? 22 : 8),
        height: numberValue(annotation.positionJson.height, annotation.type === 'text' ? 7 : 5),
      },
      minWidth: annotation.type === 'text' ? 8 : 2,
      minHeight: annotation.type === 'text' ? 3.5 : 2,
    });
    setStickyDragPreview({
      annotationId,
      page: pageNumber,
      positionJson: annotation.positionJson,
    });
  };

  const updateStickyDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (annotationResize?.page === pageNumber) {
      const annotation = currentFileAnnotations.find((item) => item.id === annotationResize.annotationId);
      if (!annotation) return;
      const point = pointFromEvent(event);
      setStickyDragPreview({
        annotationId: annotationResize.annotationId,
        page: pageNumber,
        positionJson: resizePositionFromDrag(annotation.positionJson, annotationResize, point),
      });
      return;
    }
    if (!stickyDrag || stickyDrag.page !== pageNumber) return;
    const annotation = currentFileAnnotations.find((item) => item.id === stickyDrag.annotationId);
    if (!annotation) return;
    const point = pointFromEvent(event);
    const nextPosition = stickyPositionFromDrag(annotation.positionJson, stickyDrag, point);
    setStickyDragPreview({
      annotationId: stickyDrag.annotationId,
      page: pageNumber,
      positionJson: nextPosition,
    });
  };

  const finishStickyDrag = () => {
    const preview = stickyDragPreview;
    setStickyDrag(null);
    setAnnotationResize(null);
    setStickyDragPreview(null);
    if (preview) {
      void onUpdateAnnotationPosition(preview.annotationId, preview.positionJson);
    }
  };

  const finishTextSelection = async (pageNumber: number, container: HTMLElement, overrideTool?: ReaderTool) => {
    const rawTool = overrideTool ?? activeTool;
    const tool = (rawTool === 'cursor' || rawTool === 'eraser' ? 'highlight' : rawTool) as AnnotationType;
    if (!overrideTool && !textSelectionToolsActive) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const selectionText = selection.toString().replace(/\s+/g, ' ').trim();
    if (!selectionText) return;
    const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
    const textItemSelections = textItemSelectionsFromRange(range, container);
    const preciseRects = page ? textSelectionRectsFromOffsets(page.textItems, textItemSelections) : [];
    const rects = preciseRects.length
      ? preciseRects
      : Array.from(range.getClientRects())
          .map((rect) => normalizeClientRect(rect, container))
          .filter((rect): rect is RectBox => rect !== null && rect.width > 0.12 && rect.height > 0.08);
    if (!rects.length) return;
    const segments = mergeRectsIntoLineSegments(rects);
    const bounds = boundingBox(segments);
    if (!bounds.width || !bounds.height) return;
    const draft = {
      ...buildAnnotationDraft(tool, { ...bounds, segments }, activeAnnotationColor),
      quote: selectionText,
      page: pageNumber,
    };
    selection.removeAllRanges();
    const draftId = pushDraftPreview(draft);
    try {
      const id = await onCreateAnnotation(draft);
      removeDraftPreview(draftId);
      if (id) selectAnnotation(id);
    } catch (error) {
      console.error('Text selection annotation create failed', error);
      removeDraftPreview(draftId);
    }
  };

  const finishInkAnnotation = async () => {
    const currentDraft = inkDraftRef.current;
    if (!currentDraft) return;
    inkDraftRef.current = null;
    setInkDraft(null);
    if (currentDraft.points.length < 2) return;
    const position = {
      ...inkPositionFromPoints(currentDraft.points),
      strokeWidth: toolSettings.inkStrokeWidth,
    } as PositionJson;
    if (numberValue(position.width, 0) < 0.2 && numberValue(position.height, 0) < 0.2) return;
    const draft = {
      ...buildAnnotationDraft('ink', position, activeAnnotationColor),
      quote: annotationLabel('ink'),
      page: currentDraft.page,
    };
    const draftId = pushDraftPreview(draft);
    try {
      await onCreateAnnotation(draft);
      removeDraftPreview(draftId);
    } catch (error) {
      console.error('Ink annotation create failed', error);
      removeDraftPreview(draftId);
    }
  };

  const finishInkPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (inkPointerIdRef.current !== event.pointerId) return;
    const pointerTarget = inkPointerTargetRef.current;
    inkPointerIdRef.current = null;
    inkPointerTargetRef.current = null;
    void finishInkAnnotation();
    if (pointerTarget?.hasPointerCapture(event.pointerId)) {
      pointerTarget.releasePointerCapture(event.pointerId);
    }
  };

  const finishShapeAnnotation = async () => {
    if (!dragDraft || !shapeToolsActive) return;
    const annotationType = activeTool as AnnotationType;
    const position = (annotationType === 'arrow'
        ? {
            ...arrowPositionFromDrag(dragDraft),
            arrowStyle: toolSettings.arrowStyle,
            arrowEnding: toolSettings.arrowEnding,
            strokeWidth: toolSettings.arrowStrokeWidth,
          }
      : activeTool === 'rect'
        ? {
            ...normalizeBox(dragDraft),
            shapeKind: toolSettings.shapeKind,
            fillEnabled: toolSettings.shapeFillEnabled,
            strokeWidth: toolSettings.shapeStrokeWidth,
          }
        : normalizeBox(dragDraft)) as PositionJson;
    setDragDraft(null);
    const arrowLength = annotationType === 'arrow'
      ? Math.hypot(
          numberValue(position.endX, 0) - numberValue(position.startX, 0),
          numberValue(position.endY, 0) - numberValue(position.startY, 0),
        )
      : 0;
    if (annotationType === 'arrow' ? arrowLength < 1.4 : numberValue(position.width, 0) < 1.4 || numberValue(position.height, 0) < 0.8) return;
    if (annotationType === 'arrow' || annotationType === 'rect') onCompleteOneShotTool?.();
    const page = pages.find((candidate) => candidate.pageNumber === dragDraft.page);
    const textSelection = page && (annotationType === 'highlight' || annotationType === 'underline') ? textSelectionFromDrag(page.textItems, position as RectBox) : null;
    const draft = {
      ...buildAnnotationDraft(annotationType, textSelection?.position ?? position, activeAnnotationColor),
      quote: textSelection?.quote || annotationLabel(annotationType),
      page: dragDraft.page,
    };
    const draftId = pushDraftPreview(draft);
    try {
      const id = await onCreateAnnotation(draft);
      removeDraftPreview(draftId);
      if (id) selectAnnotation(id);
    } catch (error) {
      console.error('Annotation create failed', error);
      removeDraftPreview(draftId);
    }
  };

  function eraseInkAtPointer(pageNumber: number, event: MouseEvent<HTMLDivElement>) {
    if (activeTool !== 'eraser') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = pointFromEvent(event);
    if (rect.width <= 0 || rect.height <= 0) return;
    const radiusX = Math.max((toolSettings.eraserSize / rect.width) * 50, 0.05);
    const radiusY = Math.max((toolSettings.eraserSize / rect.height) * 50, 0.05);

    for (const annotation of currentFileAnnotations) {
      if (annotation.page !== pageNumber || annotation.type !== 'ink') continue;
      const nextPosition = eraseInkPosition(annotation.positionJson, point, radiusX, radiusY, toolSettings.eraserShape);
      if (nextPosition === annotation.positionJson) continue;
      if (nextPosition) {
        void onUpdateAnnotationPosition(annotation.id, nextPosition);
      } else {
        void onDeleteAnnotation(annotation.id);
      }
    }
  }

  function updateEraserCursor(pageNumber: number, event: MouseEvent<HTMLDivElement>) {
    if (activeTool !== 'eraser') {
      setEraserCursor(null);
      return;
    }
    const layer = event.currentTarget.querySelector<HTMLElement>('.pdf-render-layer') ?? event.currentTarget;
    const rect = layer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setEraserCursor(null);
      return;
    }
    setEraserCursor({
      page: pageNumber,
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    });
  }

  const createTextAnnotationAtPointer = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (status !== 'ready' || (activeTool !== 'comment' && activeTool !== 'text')) return;
    const point = pointFromEvent(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const annotationType = activeTool === 'text' ? 'text' : 'comment';
    setCommentPopover({
      annotationType,
      page: pageNumber,
      x: point.x,
      y: point.y,
      leftPx: event.clientX - rect.left,
      topPx: event.clientY - rect.top,
      text: annotationType === 'text' ? zh.reader.textLabel : '',
      fontSize: annotationType === 'text' ? toolSettings.textFontSize : 13,
      bold: annotationType === 'text' ? toolSettings.textBold : false,
      italic: annotationType === 'text' ? toolSettings.textItalic : false,
      textColor: annotationType === 'text' ? toolSettings.textColor : '#202822',
      borderColor: annotationType === 'text' ? toolSettings.textBorderColor : '#ffffff',
      backgroundColor: annotationType === 'text' ? toolSettings.textBackgroundColor : '#fff4b8',
    });
    if (annotationType === 'text') onCompleteOneShotTool?.();
  };

  const editStickyAnnotation = (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => {
    if (!annotation.id || (annotation.type !== 'comment' && annotation.type !== 'text')) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget.closest<HTMLElement>('.pdf-render-layer');
    const rect = layer?.getBoundingClientRect();
    setFocusedAnnotationId(annotation.id);
    onFocusAnnotation?.(annotation.id);
    setCommentPopover({
      annotationType: annotation.type,
      annotationId: annotation.id,
      page: annotation.page,
      x: numberValue(annotation.positionJson.x, 0),
      y: numberValue(annotation.positionJson.y, 0),
      leftPx: rect ? event.clientX - rect.left : 0,
      topPx: rect ? event.clientY - rect.top : 0,
      text: annotation.comment || annotation.quote || '',
      fontSize: numberValue(annotation.positionJson.fontSize, 13),
      bold: Boolean(annotation.positionJson.bold),
      italic: Boolean(annotation.positionJson.italic),
      textColor: String(annotation.positionJson.textColor ?? '#202822'),
      borderColor: String(annotation.positionJson.borderColor ?? '#ffffff'),
      backgroundColor: String(annotation.positionJson.backgroundColor ?? (annotation.type === 'text' ? 'transparent' : '#fff4b8')),
      positionJson: clonePositionJson(annotation.positionJson),
    });
  };

  const saveComment = async () => {
    if (!commentPopover) return;
    if (commentPopover.annotationId) {
      const annotationId = commentPopover.annotationId;
      const nextPosition = {
        ...(commentPopover.positionJson ?? {}),
        x: commentPopover.x,
        y: commentPopover.y,
        fontSize: commentPopover.fontSize,
        bold: commentPopover.bold,
        italic: commentPopover.italic,
        textColor: commentPopover.textColor,
        borderColor: commentPopover.borderColor,
        backgroundColor: commentPopover.backgroundColor,
      };
      const nextComment = commentPopover.text.trim() || zh.reader.commentAnnotation;
      setCommentPopover(null);
      try {
        await onUpdateAnnotationPosition(annotationId, nextPosition);
        await onUpdateAnnotationComment(annotationId, nextComment);
        selectAnnotation(annotationId);
      } catch (error) {
        console.error('Comment annotation update failed', error);
      }
      return;
    }
    const draft = {
      ...buildAnnotationDraft(commentPopover.annotationType ?? 'comment', {
        x: commentPopover.x,
        y: commentPopover.y,
        width: commentPopover.annotationType === 'text' ? 22 : 18,
        height: commentPopover.annotationType === 'text' ? 7 : 8,
        fontSize: commentPopover.fontSize,
        bold: commentPopover.bold,
        italic: commentPopover.italic,
        textColor: commentPopover.textColor,
        borderColor: commentPopover.borderColor,
        backgroundColor: commentPopover.backgroundColor,
      }, activeAnnotationColor),
      page: commentPopover.page,
      comment: commentPopover.text.trim() || (commentPopover.annotationType === 'text' ? zh.reader.textLabel : zh.reader.commentAnnotation),
    };
    setCommentPopover(null);
    const draftId = pushDraftPreview(draft);
    try {
      const id = await onCreateAnnotation(draft);
      if (id && draft.comment) {
        await onUpdateAnnotationComment(id, draft.comment);
        selectAnnotation(id);
      }
      removeDraftPreview(draftId);
    } catch (error) {
      console.error('Comment annotation create failed', error);
      removeDraftPreview(draftId);
    }
  };

  const pushDraftPreview = (draft: AnnotationDraft & { page: number }) => {
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDraftAnnotations((current) => [...current, { ...draft, id }]);
    return id;
  };

  const removeDraftPreview = (draftId: string) => {
    setDraftAnnotations((current) => current.filter((draft) => draft.id !== draftId));
  };

  const pageHandlers = (pageNumber: number) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') beginInkStroke(pageNumber, event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') updateInkStroke(pageNumber, event);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
    },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
    },
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') return;
      if (stickyDrag) return;
      if (activeTool === 'eraser') {
        updateEraserCursor(pageNumber, event);
        eraseInkAtPointer(pageNumber, event);
        return;
      }
      if (activeTool === 'comment') return;
      beginAnnotationDrag(pageNumber, event);
    },
    onMouseMove: (event: MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') return;
      if (activeTool === 'eraser') {
        updateEraserCursor(pageNumber, event);
        if (event.buttons === 1) {
          eraseInkAtPointer(pageNumber, event);
        }
        return;
      }
      updateStickyDrag(pageNumber, event);
      updateAnnotationDrag(pageNumber, event);
    },
    onMouseUp: () => {
      if (activeTool === 'ink') return;
      finishStickyDrag();
      void finishInkAnnotation();
      void finishShapeAnnotation();
    },
    onMouseLeave: () => {
      if (activeTool === 'ink') return;
      setEraserCursor(null);
      finishStickyDrag();
      void finishInkAnnotation();
      void finishShapeAnnotation();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') return;
      if (textSelectionToolsActive) return;
      if (activeTool === 'comment' || activeTool === 'text') {
        createTextAnnotationAtPointer(pageNumber, event);
        return;
      }
      if (activeTool === 'eraser') return;
      setFocusedAnnotationId(null);
      onFocusAnnotation?.(null);
    },
  });

  if (status !== 'ready') {
    return (
      <div className={`pdf-reader-status ${status}`} role={status === 'loading' ? 'status' : 'alert'} aria-live="polite">
        {status === 'loading' && <span className="pdf-loading-indicator" aria-hidden="true" />}
        <div className="pdf-reader-status-copy">
          <strong>{message}</strong>
          {status === 'loading' && source.title && <span>{source.title}</span>}
        </div>
      </div>
    );
  }

  const toolCursorStyle = activeTool === 'ink' || activeTool === 'text' || activeTool === 'rect'
    ? ({ '--reader-tool-cursor': readerToolCursor(activeTool, activeAnnotationColor, toolSettings.shapeKind) } as CSSProperties)
    : undefined;

  return (
    <div className="pdf-reader-surface" data-reader-layer="pdf-surface">
      <div className="reader-toolbar-progress" data-reader-layer="progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${Math.max(0.04, scrollProgress)})` }} />
      </div>
      <div
        className={`pdf-document ${activeTool}-mode ${activeTool === 'cursor' ? '' : 'annotation-mode'} ${isPanning ? 'panning' : ''}`.trim()}
        data-reader-layer="pdf-document"
        style={toolCursorStyle}
        ref={containerRef}
        onWheel={handleWheel}
        onScroll={updateScrollProgress}
        onMouseDown={beginPan}
        onMouseMove={updatePan}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        <div className="pdf-document-content" data-reader-layer="pdf-content" ref={documentContentRef}>
          {pages.map((page) => (
            <PdfPageView
              key={page.pageNumber}
              pageMeta={page}
              zoom={zoom}
              displayZoom={displayZoom}
              selectableText={selectableText}
              commentPopover={commentPopover?.page === page.pageNumber ? commentPopover : null}
              eraserPreview={activeTool === 'eraser' && eraserCursor?.page === page.pageNumber
                ? { x: eraserCursor.x, y: eraserCursor.y, size: toolSettings.eraserSize, shape: toolSettings.eraserShape }
                : null}
              pageHandlers={pageHandlers(page.pageNumber)}
              flashKind={flash?.page === page.pageNumber ? flash.kind : null}
              priorityDistance={Math.abs(page.pageNumber - visiblePage)}
              onCommentPopoverChange={setCommentPopover}
              onSaveComment={saveComment}
              annotationLayer={
                <AnnotationOverlay
                  annotations={annotationsByPage[page.pageNumber] ?? []}
                  drafts={draftAnnotationsByPage[page.pageNumber] ?? []}
                  dragDraft={dragDraft?.page === page.pageNumber ? dragDraft : null}
                  inkDraft={inkDraft?.page === page.pageNumber ? inkDraft : null}
                  activeTool={activeTool}
                  activeAnnotationColor={activeAnnotationColor}
                  toolSettings={toolSettings}
                  onSelectAnnotation={selectAnnotation}
                  onBeginStickyDrag={beginStickyDrag}
                  onBeginAnnotationResize={beginAnnotationResize}
                  onEditStickyAnnotation={editStickyAnnotation}
                  onUpdateAnnotationColor={onUpdateAnnotationColor}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onAppendAnnotationToNote={onAppendAnnotationToNote}
                  focusedAnnotationId={focusedAnnotationId}
                />
              }
            />
          ))}
          {annotationsEnabled && selectionPopup.visible && (
            <SelectionPopup
              visible={selectionPopup.visible}
              x={selectionPopup.x - (containerRef.current?.getBoundingClientRect().left ?? 0)}
              y={selectionPopup.y - (containerRef.current?.getBoundingClientRect().top ?? 0) + (containerRef.current?.scrollTop ?? 0)}
              onHighlight={() => {
                if (selectionPopup.pageElement) void finishTextSelection(selectionPopup.pageNumber, selectionPopup.pageElement, 'highlight');
                setSelectionPopup((s) => ({ ...s, visible: false }));
              }}
              onUnderline={() => {
                if (selectionPopup.pageElement) void finishTextSelection(selectionPopup.pageNumber, selectionPopup.pageElement, 'underline');
                setSelectionPopup((s) => ({ ...s, visible: false }));
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function inkPositionFromPoints(points: InkDraft['points']): PositionJson {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(Math.max(...xs) - x, 0.1);
  const height = Math.max(Math.max(...ys) - y, 0.1);
  return { x, y, width, height, points };
}

function readerToolCursor(tool: 'ink' | 'text' | 'rect', color: AnnotationColor, shapeKind: ReaderToolSettings['shapeKind'] = 'rect') {
  const swatch = cursorColor(color);
  const svg = tool === 'ink'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M4 22l2-6L18 4l4 4-12 12z" fill="white" stroke="#355c4a" stroke-width="1.5" stroke-linejoin="round"/><path d="M16.5 5.5l4 4" fill="none" stroke="#355c4a" stroke-width="1.5"/><circle cx="22" cy="22" r="4" fill="${swatch}" stroke="white" stroke-width="1.5"/></svg>`
    : tool === 'text'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M7 5h14M14 5v18M9 23h10" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M7 5h14M14 5v18M9 23h10" fill="none" stroke="#355c4a" stroke-width="1.7" stroke-linecap="round"/><circle cx="23" cy="22" r="3.5" fill="${swatch}" stroke="white" stroke-width="1.4"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2 5h6M5 2v6" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/><path d="M2 5h6M5 2v6" fill="none" stroke="#355c4a" stroke-width="1.4" stroke-linecap="round"/><${shapeKind === 'ellipse' ? 'ellipse cx="17" cy="17" rx="8" ry="6"' : 'rect x="9" y="10" width="16" height="14" rx="1"'} fill="white" fill-opacity=".75" stroke="${swatch}" stroke-width="2"/></svg>`;
  const hotspot = tool === 'ink' ? '4 22' : tool === 'text' ? '14 14' : '5 5';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot}, crosshair`;
}

function cursorColor(color: AnnotationColor) {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color === 'green') return '#56cc9d';
  if (color === 'blue') return '#5c8edb';
  if (color === 'purple') return '#9770db';
  return '#f2c94c';
}

function eraseInkPosition(
  positionJson: PositionJson,
  pointer: { x: number; y: number },
  radiusX: number,
  radiusY: number,
  eraserShape: ReaderToolSettings['eraserShape'],
): PositionJson | null {
  const rawPoints = positionJson.points;
  if (!Array.isArray(rawPoints)) return positionJson;
  let changed = false;
  const nextPoints = rawPoints.map((rawPoint) => {
    const point = inkPointFromJson(rawPoint);
    if (!point) return rawPoint;
    if (!pointInsideEraser(point, pointer, radiusX, radiusY, eraserShape)) return rawPoint;
    changed = true;
    return null;
  });
  if (!changed) return positionJson;

  const remainingPoints = nextPoints
    .map((rawPoint) => inkPointFromJson(rawPoint))
    .filter((point): point is { x: number; y: number } => Boolean(point));
  if (remainingPoints.length < 2) return null;

  const xs = remainingPoints.map((point) => point.x);
  const ys = remainingPoints.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    ...positionJson,
    x,
    y,
    width: Math.max(Math.max(...xs) - x, 0.1),
    height: Math.max(Math.max(...ys) - y, 0.1),
    points: nextPoints,
  };
}

function inkPointFromJson(point: unknown) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  const value = point as Record<string, unknown>;
  const x = numberValue(value.x, Number.NaN);
  const y = numberValue(value.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function pointInsideEraser(
  point: { x: number; y: number },
  pointer: { x: number; y: number },
  radiusX: number,
  radiusY: number,
  eraserShape: ReaderToolSettings['eraserShape'],
) {
  const dx = Math.abs(point.x - pointer.x);
  const dy = Math.abs(point.y - pointer.y);
  if (eraserShape === 'square') return dx <= radiusX && dy <= radiusY;
  const nx = dx / Math.max(radiusX, 0.01);
  const ny = dy / Math.max(radiusY, 0.01);
  return nx * nx + ny * ny <= 1;
}
