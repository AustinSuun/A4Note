import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { useLayoutEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { PdfFindBar } from './PdfFindBar';
import { useReaderSaveQueue } from '../useReaderSaveQueue';
import { pdfLoadErrorMessage } from './pdfLoadError';
import { capturePdfCenterAnchor, restorePdfPageAnchor } from './pdfZoomAnchor';
import { usePdfPan } from './usePdfPan';
import { usePdfShapeDraft } from './usePdfShapeDraft';
import { pdfCoordinateLayer, pdfPointerCoordinates } from './pdfCoordinates';
import { eraseInkPosition } from './pdfInk';
import type { Annotation, AnnotationColor, AnnotationDraft, AnnotationType, PositionJson, ReaderTool } from '../../../core/types';
import { isTauriRuntime, loadPaperFileBytes } from '../../../platform/nativeApi';
import { readFileBytes } from '../../../platform/projects';
import { zh } from '../../../ui/zh';
import { annotationLabel, buildAnnotationDraft } from './pdfAnnotationHelpers';
import type { PdfDocumentSource } from './pdfSource';
import { AnnotationOverlay } from './AnnotationOverlay';
import { createOptimisticAnnotationPosition, discardOptimisticAnnotationPosition, reconcileOptimisticAnnotationPosition } from './annotationPositionOptimism';
import type { OptimisticAnnotationPosition } from './annotationPositionOptimism';
import {
  clamp,
  clonePositionJson,
  extractTextItemBoxes,
  normalizeBox,
  normalizeClientRect,
  numberValue,
} from './pdfGeometry';
import { arrowPositionFromDrag, createDragDraft, currentVisiblePage, pointFromEvent, resizePositionFromDrag, scrollAnchorFromContainer, scrollPageIntoViewIfNeeded, scrollTopFromAnchor, stickyPositionFromDrag, updateDragDraftPoint } from './pdfInteraction';
import { TEXT_EDGE_MARGIN_PERCENT, TEXT_FONT_UNIT_PAGE, clampTextBoxToPage, percentBoxOf, placeNewTextBox, roundPercent, textAnnotationLayout } from './pdfTextAnnotation';
import { PdfPageView } from './PdfPageView';
import { SelectionPopup } from './SelectionPopup';
import { SELECTION_PREVIEW_COLOR } from './pdfHighlightAppearance';
import { boundingBox, clipRangeToNode, dominantTextOrientation, mergeRectsIntoLineSegments, quoteFromTextItemSelections, textItemSelectionsFromRange, textRunExtentMeasurer, textSelectionFromDrag, textSelectionPageElements, textSelectionRectsFromLayer, withSegmentOrientation } from './pdfSelection';
import type {
  AnnotationMarkModel,
  AnnotationResize,
  AnnotationResizeHandle,
  CommentPopover,
  InlineTextEditorState,
  TextAnnotationStylePatch,
  DraftAnnotationPreview,
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const saves = useReaderSaveQueue(source.key);
  const sourceKeyRef = useRef(source.key); sourceKeyRef.current = source.key;
  const commentSavingRef = useRef(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentSaveError, setCommentSaveError] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentContentRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [draftAnnotations, setDraftAnnotations] = useState<DraftAnnotationPreview[]>([]);
  const [selectionPreview, setSelectionPreview] = useState<DraftAnnotationPreview[]>([]);
  const { draft: dragDraft, setDraft: setDragDraft, takeDraft: takeDragDraft } = usePdfShapeDraft(source.key, activeTool);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const inkPointerIdRef = useRef<number | null>(null);
  const inkPointerTargetRef = useRef<HTMLDivElement | null>(null);
  const [commentPopover, setCommentPopover] = useState<CommentPopover | null>(null);
  // Text annotations edit in place (task 540986ab); the settings popover is only used by sticky comments now.
  const [inlineText, setInlineText] = useState<InlineTextEditorState | null>(null);
  const inlineTextRef = useRef<InlineTextEditorState | null>(null); inlineTextRef.current = inlineText;
  const inlineEditorRef = useRef<HTMLDivElement | null>(null);
  const [stickyDrag, setStickyDrag] = useState<StickyDrag | null>(null);
  const [annotationResize, setAnnotationResize] = useState<AnnotationResize | null>(null);
  const [stickyDragPreview, setStickyDragPreview] = useState<StickyDragPreview | null>(null);
  const [optimisticAnnotationPositions, setOptimisticAnnotationPositions] = useState<Map<string, OptimisticAnnotationPosition>>(() => new Map());
  const optimisticAnnotationRevisionRef = useRef(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  // The page layout follows the committed zoom directly. During a wheel
  // gesture the existing layout is painted through a temporary transform;
  // this keeps PDF.js from starting a render for every wheel tick.
  const displayZoom = zoom;
  const [eraserCursor, setEraserCursor] = useState<{ page: number; xPercent: number; yPercent: number } | null>(null);
  // Pointer moves can arrive faster than native persistence and React can render the updated
  // annotation. Keep cumulative geometry so each sample clips the previous sample's result.
  const eraserPositionsRef = useRef(new Map<string, PositionJson | null>());
  const eraserPointerIdRef = useRef<number | null>(null);
  const eraserPointerTargetRef = useRef<HTMLDivElement | null>(null);
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
  const [textLayerHint, setTextLayerHint] = useState<string | null>(null);
  const textLayerHintTimerRef = useRef<number | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<{ visible: boolean; x: number; y: number; pageNumber: number; pageElement: HTMLElement | null }>({ visible: false, x: 0, y: 0, pageNumber: 0, pageElement: null });
  const pan = usePdfPan(containerRef, activeTool === 'hand', source.key, () => {
    if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    zoomFrameRef.current = null;
    zoomTimerRef.current = null;
    const anchor = zoomGestureAnchorRef.current;
    documentContentRef.current?.style.removeProperty('transform');
    documentContentRef.current?.style.removeProperty('transform-origin');
    if (anchor && containerRef.current) restorePdfPageAnchor(containerRef.current, anchor);
    zoomGestureAnchorRef.current = null;
    pendingZoomRef.current = zoom;
  });
  const activeFileId = source.fileId;
  const activeResourceId = source.resourceId;
  const currentFileAnnotations = useMemo(
    () => annotations.filter((annotation) => activeResourceId ? annotation.resourceId === activeResourceId : !activeFileId || annotation.fileId === activeFileId),
    [activeFileId, activeResourceId, annotations],
  );
  const displayedAnnotations = useMemo(
    () => currentFileAnnotations.map((annotation) => {
      const optimistic = optimisticAnnotationPositions.get(annotation.id);
      const previewPosition = stickyDragPreview?.annotationId === annotation.id
        ? stickyDragPreview.positionJson
        : optimistic?.positionJson;
      return previewPosition ? { ...annotation, positionJson: previewPosition } : annotation;
    }),
    [currentFileAnnotations, optimisticAnnotationPositions, stickyDragPreview],
  );

  useEffect(() => {
    setOptimisticAnnotationPositions((current) => {
      if (!current.size) return current;
      const committedById = new Map(currentFileAnnotations.map((annotation) => [annotation.id, annotation.positionJson]));
      let changed = false;
      const next = new Map(current);
      for (const [annotationId, optimistic] of current) {
        const committed = committedById.get(annotationId);
        if (!committed || !reconcileOptimisticAnnotationPosition(optimistic, committed)) {
          next.delete(annotationId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [currentFileAnnotations]);
  const textSelectionToolsActive = activeTool === 'highlight' || activeTool === 'underline';
  const shapeToolsActive = activeTool === 'area' || activeTool === 'rect' || activeTool === 'arrow';
  const selectableText = activeTool === 'cursor' || textSelectionToolsActive;
  /** Scanned pages carry no text items, so a text tool can never build a selection there. */
  const pageHasSelectableText = (pageNumber: number) => (pages.find((candidate) => candidate.pageNumber === pageNumber)?.textItems.length ?? 0) > 0;
  const showTextLayerHint = () => {
    setTextLayerHint(zh.reader.textLayerUnavailable);
    if (textLayerHintTimerRef.current !== null) window.clearTimeout(textLayerHintTimerRef.current);
    textLayerHintTimerRef.current = window.setTimeout(() => {
      textLayerHintTimerRef.current = null;
      setTextLayerHint(null);
    }, 5200);
  };

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
      let stage: 'read' | 'parse' = 'read';
      try {
        setPdfDocument(null);
        setPages([]);
        setStatus('loading');
        setMessage(zh.reader.pdfLoading);
        const bytes = request.source === 'paperFile'
          ? await loadPaperFileBytes({ paperId: request.paperId, kind: request.kind, fileId: request.fileId })
          : await readFileBytes(request.path);
        if (cancelled) return;
        stage = 'parse';
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
        setMessage(pdfLoadErrorMessage(error, stage));
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
          setMessage(pdfLoadErrorMessage(error, 'pages'));
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
    eraserPositionsRef.current.clear();
    const eraserPointerId = eraserPointerIdRef.current;
    const eraserPointerTarget = eraserPointerTargetRef.current;
    if (eraserPointerId !== null && eraserPointerTarget?.hasPointerCapture(eraserPointerId)) {
      eraserPointerTarget.releasePointerCapture(eraserPointerId);
    }
    eraserPointerIdRef.current = null;
    eraserPointerTargetRef.current = null;
    setEraserCursor(null);
    setCommentPopover(null);
    setInlineText(null);
    inlineEditorRef.current = null;
    commentSavingRef.current = false; setCommentSaving(false); setCommentSaveError('');
    setStickyDrag(null);
    setAnnotationResize(null);
    setStickyDragPreview(null);
    setOptimisticAnnotationPositions(new Map());
    optimisticAnnotationRevisionRef.current = 0;
  }, [source.key]);

  useLayoutEffect(() => {
    // A toolbar/shortcut zoom can supersede an unfinished wheel preview.
    // Never let its queued frame or delayed commit reapply the old gesture.
    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
    if (zoomTimerRef.current !== null) {
      window.clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = null;
    }
    pendingZoomRef.current = zoom;
    zoomGestureAnchorRef.current = null;
    documentContentRef.current?.style.removeProperty('transform');
    documentContentRef.current?.style.removeProperty('transform-origin');
  }, [zoom]);

  useEffect(() => {
    if (activeTool !== 'eraser') {
      setEraserCursor(null);
      eraserPositionsRef.current.clear();
      const pointerId = eraserPointerIdRef.current;
      const pointerTarget = eraserPointerTargetRef.current;
      eraserPointerIdRef.current = null;
      eraserPointerTargetRef.current = null;
      if (pointerId !== null && pointerTarget?.hasPointerCapture(pointerId)) {
        pointerTarget.releasePointerCapture(pointerId);
      }
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
    if (activeTool !== 'eraser') return;
    const hideOutsideWindow = () => setEraserCursor(null);
    window.addEventListener('blur', hideOutsideWindow);
    document.documentElement.addEventListener('mouseleave', hideOutsideWindow);
    return () => {
      window.removeEventListener('blur', hideOutsideWindow);
      document.documentElement.removeEventListener('mouseleave', hideOutsideWindow);
    };
  }, [activeTool]);

  useEffect(() => {
    if (!textSelectionToolsActive) return;
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const anchor = selection.anchorNode?.parentElement?.closest('.pdf-page[data-page]');
      const pageElement = anchor as HTMLElement | null;
      if (!pageElement || !containerRef.current?.contains(pageElement) || !pageElement.getBoundingClientRect().width) return;
      const pageNumber = Number(pageElement.dataset.page);
      if (!Number.isFinite(pageNumber)) return;
      void finishTextSelection(pageNumber, pageElement);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [textSelectionToolsActive, source.key, activeTool, pages, activeAnnotationColor]);

  useEffect(() => () => {
    if (textLayerHintTimerRef.current !== null) window.clearTimeout(textLayerHintTimerRef.current);
  }, []);

  // Say why up front when the page in view has no text layer, instead of letting a
  // highlight/underline drag end silently (audit F6).
  useEffect(() => {
    if (!textSelectionToolsActive || !pages.length) return;
    const page = pages.find((candidate) => candidate.pageNumber === visiblePage);
    if (!page || page.textItems.length > 0) return;
    showTextLayerHint();
  }, [textSelectionToolsActive, activeTool, visiblePage, pages]);

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
      if (!pageElement || !containerRef.current?.contains(pageElement) || !pageElement.getBoundingClientRect().width) { setSelectionPopup((s) => ({ ...s, visible: false })); return; }
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

  const selectionPreviewByPage = useMemo(() => {
    return selectionPreview.reduce<Record<number, DraftAnnotationPreview[]>>((grouped, annotation) => {
      if (!grouped[annotation.page]) grouped[annotation.page] = [];
      grouped[annotation.page].push(annotation);
      return grouped;
    }, {});
  }, [selectionPreview]);

  // The browser's own selection band is transparent (reader.css): while the user drags, the live
  // selection is painted through the highlight layer with the very same range → segments → band
  // pipeline finishTextSelection uses, so the band never jumps when the highlight is created.
  // Only painting changes: the real Range, its hit boxes, keyboard selection and copy stay native.
  useEffect(() => {
    if (!selectableText) {
      setSelectionPreview((current) => (current.length ? [] : current));
      return;
    }
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const root = containerRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionPreview((current) => (current.length ? [] : current));
        return;
      }
      const range = selection.getRangeAt(0);
      // The highlight tool previews in its own colour; other tools show a neutral band.
      const color = activeTool === 'highlight' ? activeAnnotationColor : (SELECTION_PREVIEW_COLOR as AnnotationColor);
      const previews = textSelectionPageElements(root, range).flatMap((pageElement, index) => {
        const draft = textSelectionDraft(pageElement, range, 'highlight');
        return draft ? [{ ...draft, color, id: `selection-preview-${index}` }] : [];
      });
      setSelectionPreview(previews);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    document.addEventListener('selectionchange', schedule);
    schedule();
    return () => {
      document.removeEventListener('selectionchange', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [selectableText, activeTool, activeAnnotationColor, pages, zoom]);

  const handleWheel = (event: globalThis.WheelEvent) => {
    // Preserve native tilt-wheel / trackpad deltaX. Map Shift + a vertical
    // wheel only when the device did not already supply horizontal movement.
    if (!event.ctrlKey && event.shiftKey && Math.abs(event.deltaX) < 0.01 && event.deltaY !== 0) {
      const scroller = containerRef.current;
      if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1;
        scroller.scrollLeft += event.deltaY * unit;
      }
      return;
    }
    if (!event.ctrlKey) return;
    // A purely horizontal wheel event must not be mistaken for zoom-in.
    if (event.deltaY === 0) return;
    event.preventDefault();
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const content = documentContentRef.current;
    if (!container || !rect || !content) return;
    if (!zoomGestureAnchorRef.current) {
      // Freeze the reading viewport center for the complete wheel gesture.
      // Pointer movement must not change the preview or committed zoom anchor.
      zoomGestureAnchorRef.current = capturePdfCenterAnchor(container);
    }
    // Normalize line/page wheels; tiny high-resolution deltas must not each
    // become a full ten-percentage-point jump. Cap unusually large packets.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
    const pixels = clamp(event.deltaY * unit, -100, 100);
    pendingZoomRef.current = clamp(pendingZoomRef.current * Math.exp(-pixels * 0.001), 0.2, 5);
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

  // React delegates wheel events passively in Chromium. A native non-passive
  // listener is required to prevent browser zoom/scroll competing with ours.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  });

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


  const beginInkStroke = (pageNumber: number, event: PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready' || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    inkPointerIdRef.current = event.pointerId;
    inkPointerTargetRef.current = event.currentTarget;
    const point = pointFromEvent(event);
    if (!point) return;
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
    if (!point) return;
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
    if (!point) return;
    setDragDraft(createDragDraft(pageNumber, point));
  };

  const updateAnnotationDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (!dragDraft || dragDraft.page !== pageNumber) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setDragDraft((current) => (current ? updateDragDraftPoint(current, point) : current));
  };

  const beginStickyDrag = (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    const annotation = displayedAnnotations.find((item) => item.id === annotationId);
    if (!annotation || (annotation.type !== 'comment' && annotation.type !== 'text' && annotation.type !== 'rect')) return;
    event.preventDefault();
    event.stopPropagation();
    const pageLayer = event.currentTarget.closest<HTMLElement>('.pdf-render-layer');
    if (!pageLayer) return;
    const point = pointFromEvent(event, pageLayer);
    if (!point) return;
    setFocusedAnnotationId(annotationId);
    setAnnotationResize(null);
    // Auto-sized text boxes are laid out by the browser; take their real size so drag limits and the saved
    // width/height match what is on screen instead of a stale stored value.
    const measured = annotation.type === 'text' ? measuredPercentBox(event.currentTarget, pageLayer) : null;
    const basePosition = measured
      ? { ...annotation.positionJson, width: roundPercent(measured.width), height: roundPercent(measured.height) }
      : annotation.positionJson;
    setStickyDrag({
      annotationId,
      page: pageNumber,
      offsetX: point.x - numberValue(basePosition.x, point.x),
      offsetY: point.y - numberValue(basePosition.y, point.y),
      positionJson: basePosition,
    });
    setStickyDragPreview({
      annotationId,
      page: pageNumber,
      positionJson: basePosition,
    });
  };

  const beginAnnotationResize = (
    annotationId: string,
    pageNumber: number,
    handle: AnnotationResizeHandle,
    event: MouseEvent<HTMLElement>,
  ) => {
    const annotation = displayedAnnotations.find((item) => item.id === annotationId);
    if (!annotation || (annotation.type !== 'rect' && annotation.type !== 'text')) return;
    event.preventDefault();
    event.stopPropagation();
    setFocusedAnnotationId(annotationId);
    setStickyDrag(null);
    const pageLayer = event.currentTarget.closest<HTMLElement>('.pdf-render-layer');
    const measured = annotation.type === 'text' && pageLayer ? measuredPercentBox(event.currentTarget, pageLayer) : null;
    // A manual resize turns an auto-sized text box into a fixed-width box; the height stays a minimum so text never clips.
    const basePosition = annotation.type === 'text'
      ? {
          ...annotation.positionJson,
          autoWidth: false,
          ...(measured ? { width: roundPercent(measured.width), height: roundPercent(measured.height) } : {}),
        }
      : annotation.positionJson;
    const textLayout = annotation.type === 'text' ? textAnnotationLayout(annotation.positionJson) : null;
    const minTextWidth = textLayout && pageLayer && pageLayer.getBoundingClientRect().width > 0
      ? Math.max(((textLayout.fontSize * (textLayout.fontUnit === 'page' ? displayZoom : 1) * 2) / pageLayer.getBoundingClientRect().width) * 100, 1)
      : 8;
    setAnnotationResize({
      annotationId,
      page: pageNumber,
      handle,
      origin: {
        x: numberValue(basePosition.x, 0),
        y: numberValue(basePosition.y, 0),
        width: numberValue(basePosition.width, annotation.type === 'text' ? 22 : 8),
        height: numberValue(basePosition.height, annotation.type === 'text' ? 7 : 5),
      },
      minWidth: annotation.type === 'text' ? minTextWidth : 2,
      minHeight: annotation.type === 'text' ? 0.5 : 2,
      positionJson: basePosition,
    });
    setStickyDragPreview({
      annotationId,
      page: pageNumber,
      positionJson: basePosition,
    });
  };

  const updateStickyDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (annotationResize?.page === pageNumber) {
      const annotation = displayedAnnotations.find((item) => item.id === annotationResize.annotationId);
      if (!annotation) return;
      const point = pointFromEvent(event);
      if (!point) return;
      setStickyDragPreview({
        annotationId: annotationResize.annotationId,
        page: pageNumber,
        positionJson: resizePositionFromDrag(annotationResize.positionJson ?? annotation.positionJson, annotationResize, point),
      });
      return;
    }
    if (!stickyDrag || stickyDrag.page !== pageNumber) return;
    const annotation = displayedAnnotations.find((item) => item.id === stickyDrag.annotationId);
    if (!annotation) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const nextPosition = stickyPositionFromDrag(stickyDrag.positionJson ?? annotation.positionJson, stickyDrag, point);
    setStickyDragPreview({
      annotationId: stickyDrag.annotationId,
      page: pageNumber,
      positionJson: nextPosition,
    });
  };

  const finishStickyDrag = () => {
    const preview = stickyDragPreview;
    const base = annotationResize?.positionJson ?? stickyDrag?.positionJson ?? null;
    setStickyDrag(null);
    setAnnotationResize(null);
    if (!preview) {
      setStickyDragPreview(null);
      return;
    }
    // A plain click on a box or a handle is not a move: persisting it would only add history noise and,
    // for auto-sized text boxes, silently freeze their width.
    const moved = !base || (['x', 'y', 'width', 'height'] as const).some(
      (key) => Math.abs(numberValue(preview.positionJson[key], 0) - numberValue(base[key], 0)) > 0.02,
    );
    if (!moved) {
      setStickyDragPreview(null);
      return;
    }
    const optimistic = createOptimisticAnnotationPosition(
      ++optimisticAnnotationRevisionRef.current,
      clonePositionJson(preview.positionJson),
    );
    setOptimisticAnnotationPositions((current) => new Map(current).set(preview.annotationId, optimistic));
    // These state updates are batched: the durable optimistic entry replaces the pointer preview atomically.
    setStickyDragPreview(null);
    const discard = () => setOptimisticAnnotationPositions((current) => {
      const existing = current.get(preview.annotationId);
      if (discardOptimisticAnnotationPosition(existing, optimistic.revision) === existing) return current;
      const next = new Map(current);
      next.delete(preview.annotationId);
      return next;
    });
    void saves.run(
      '移动标注',
      async () => onUpdateAnnotationPosition(preview.annotationId, optimistic.positionJson),
      discard,
      preview.annotationId,
    );
  };

  const finishTextSelection = async (pageNumber: number, container: HTMLElement, overrideTool?: ReaderTool) => {
    if (!containerRef.current?.contains(container) || Number(container.dataset.page) !== pageNumber || !container.getBoundingClientRect().width) return;
    const rawTool = overrideTool ?? activeTool;
    const tool = (rawTool === 'cursor' || rawTool === 'hand' || rawTool === 'eraser' ? 'highlight' : rawTool) as AnnotationType;
    if (!overrideTool && !textSelectionToolsActive) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    // A drag that crosses a page boundary selects runs on several pages (two pages fit on screen at
    // small zoom). Split the range per page and create one annotation per page instead of dropping
    // the whole selection because no single text layer contains it.
    const pageElements = textSelectionPageElements(containerRef.current, range);
    const drafts = pageElements.flatMap((pageElement) => {
      const draft = textSelectionDraft(pageElement, range, tool);
      return draft ? [draft] : [];
    });
    if (!drafts.length) return;
    selection.removeAllRanges();
    setSelectionPreview([]);
    for (const draft of drafts) await saveAnnotationDraft(draft);
  };

  const textSelectionDraft = (pageElement: HTMLElement, range: Range, tool: AnnotationType) => {
    const pageNumber = Number(pageElement.dataset.page);
    const layer = pdfCoordinateLayer(pageElement);
    const textLayer = layer.querySelector('.pdf-text-layer');
    if (!textLayer || !Number.isFinite(pageNumber) || !pageElement.getBoundingClientRect().width) return null;
    const pageRange = clipRangeToNode(range, textLayer);
    const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
    const textItemSelections = textItemSelectionsFromRange(pageRange, pageElement);
    // The quote comes from the text layer runs, never from overlay text the drag happened to cross.
    const selectionText = page && textItemSelections.length
      ? quoteFromTextItemSelections(page.textItems, textItemSelections)
      : pageRange.toString().replace(/\s+/g, ' ').trim();
    if (!selectionText) return null;
    // Along each run the band follows the live glyphs of the run-fitted text layer (the same
    // boxes the caret and hit testing use, so the start and end sit exactly under the pointer at
    // every zoom, scroll offset and sidebar width); across the run it takes the pdf.js run box,
    // which trims whitespace at both ends and keeps one height per font size so multi-line
    // highlights/underlines stay even instead of following ragged substitute-font line boxes.
    const preciseRects = page ? textSelectionRectsFromLayer(page.textItems, textItemSelections, layer.getBoundingClientRect(), textRunExtentMeasurer(textLayer)) : [];
    // Only fall back to the browser's own selection rects when the run boxes yield nothing at all,
    // never when they report invalid/out-of-page geometry that the filter rejects.
    const clientRects = Array.from(pageRange.getClientRects());
    const liveRects = clientRects
      .map((rect) => normalizeClientRect(rect, pageElement))
      .filter((rect): rect is RectBox => rect !== null && rect.width > 0.12 && rect.height > 0.08);
    const textOrientation = page ? dominantTextOrientation(page.textItems, textItemSelections) : 0;
    const rects = preciseRects.length ? preciseRects : liveRects;
    if (!rects.length) return null;
    // Merge along the run direction and keep it on each segment so highlight/underline marks
    // trim and underline along the glyph axis.
    const segments = withSegmentOrientation(mergeRectsIntoLineSegments(rects, textOrientation), textOrientation);
    const bounds = boundingBox(segments);
    if (!bounds.width || !bounds.height) return null;
    return {
      ...buildAnnotationDraft(tool, { ...bounds, segments }, activeAnnotationColor),
      quote: selectionText,
      page: pageNumber,
    };
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
    await saveAnnotationDraft(draft);
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
    const dragDraft = takeDragDraft();
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
    await saveAnnotationDraft(draft);
  };

  function eraseInkAtPointer(pageNumber: number, event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) {
    if (activeTool !== 'eraser') return;
    // pointFromEvent clamps into 0..100, which would keep erasing along the page edge once the
    // cursor leaves the page. The eraser needs the raw position so it can simply stop instead.
    event.preventDefault();
    event.stopPropagation();
    const pointer = pdfPointerCoordinates(event.currentTarget, event.clientX, event.clientY);
    // A hidden off-page preview must never leave a still-active eraser footprint at the page edge.
    if (!pointer?.inside) return;
    const { layoutWidth, layoutHeight } = pointer;
    const point = { x: pointer.xPercent, y: pointer.yPercent };
    const radiusX = Math.max((toolSettings.eraserSize / layoutWidth) * 50, 0.05);
    const radiusY = Math.max((toolSettings.eraserSize / layoutHeight) * 50, 0.05);

    for (const annotation of currentFileAnnotations) {
      if (annotation.page !== pageNumber || annotation.type !== 'ink') continue;
      const cached = eraserPositionsRef.current.get(annotation.id);
      if (cached === null) continue;
      const previousPosition = cached ?? annotation.positionJson;
      const nextPosition = eraseInkPosition(previousPosition, point, radiusX, radiusY, toolSettings.eraserShape);
      if (nextPosition === previousPosition) continue;
      eraserPositionsRef.current.set(annotation.id, nextPosition);
      if (nextPosition) {
        void saves.run('擦除笔迹', async () => onUpdateAnnotationPosition(annotation.id, nextPosition), undefined, annotation.id).then((saved) => {
          if (saved && eraserPositionsRef.current.get(annotation.id) === nextPosition) eraserPositionsRef.current.delete(annotation.id);
        });
      } else {
        void saves.run('删除笔迹', async () => onDeleteAnnotation(annotation.id), undefined, annotation.id).then((saved) => {
          if (saved && eraserPositionsRef.current.get(annotation.id) === null) eraserPositionsRef.current.delete(annotation.id);
        });
      }
    }
  }

  function updateEraserCursor(pageNumber: number, event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) {
    if (activeTool !== 'eraser') {
      setEraserCursor(null);
      return;
    }
    const pointer = pdfPointerCoordinates(event.currentTarget, event.clientX, event.clientY);
    // Never retain an old in-page ring while the real pointer is over an adjacent panel/window.
    if (!pointer?.inside) {
      setEraserCursor(null);
      return;
    }
    setEraserCursor({
      page: pageNumber,
      xPercent: pointer.xPercent,
      yPercent: pointer.yPercent,
    });
  }

  function finishEraserPointer(event: PointerEvent<HTMLDivElement>) {
    if (eraserPointerIdRef.current !== event.pointerId) return;
    const target = eraserPointerTargetRef.current;
    eraserPointerIdRef.current = null;
    eraserPointerTargetRef.current = null;
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') setEraserCursor(null);
  }

  const createTextAnnotationAtPointer = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (status !== 'ready' || (activeTool !== 'comment' && activeTool !== 'text')) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const rect = pdfCoordinateLayer(event.currentTarget).getBoundingClientRect();
    if (activeTool === 'text') {
      // No settings popover: open a compact one-line box right where the user clicked and type into it.
      const placed = placeNewTextBox({
        x: point.x,
        y: point.y,
        pageWidthPx: rect.width,
        pageHeightPx: rect.height,
        fontPx: toolSettings.textFontSize * displayZoom,
      });
      setCommentPopover(null);
      setFocusedAnnotationId(null);
      onFocusAnnotation?.(null);
      setInlineText({
        page: pageNumber,
        text: '',
        color: activeAnnotationColor,
        positionJson: {
          x: roundPercent(placed.x),
          y: roundPercent(placed.y),
          width: 0,
          height: 0,
          maxWidth: roundPercent(placed.maxWidth),
          autoWidth: true,
          fontSize: toolSettings.textFontSize,
          fontUnit: TEXT_FONT_UNIT_PAGE,
          bold: toolSettings.textBold,
          italic: toolSettings.textItalic,
          textColor: toolSettings.textColor,
          borderColor: toolSettings.textBorderColor,
          backgroundColor: toolSettings.textBackgroundColor,
        },
      });
      onCompleteOneShotTool?.();
      return;
    }
    // Sticky comments keep the small note popover; only text annotations moved to in-place editing.
    setCommentPopover({
      annotationType: 'comment',
      page: pageNumber,
      x: point.x,
      y: point.y,
      leftPx: event.clientX - rect.left,
      topPx: event.clientY - rect.top,
      text: '',
      fontSize: 13,
      bold: false,
      italic: false,
      textColor: '#202822',
      borderColor: '#ffffff',
      backgroundColor: '#fff4b8',
    });
  };

  const editStickyAnnotation = (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => {
    if (!annotation.id || (annotation.type !== 'comment' && annotation.type !== 'text')) return;
    event.preventDefault();
    event.stopPropagation();
    if (annotation.type === 'text') {
      // Edit in place: the box keeps its position, font and width; only the content becomes editable.
      setFocusedAnnotationId(annotation.id);
      onFocusAnnotation?.(annotation.id);
      setCommentPopover(null);
      setInlineText({
        annotationId: annotation.id,
        page: annotation.page,
        text: annotation.comment || '',
        positionJson: annotation.positionJson,
        color: annotation.color as AnnotationColor,
      });
      return;
    }
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
      backgroundColor: String(annotation.positionJson.backgroundColor ?? '#fff4b8'),
      positionJson: clonePositionJson(annotation.positionJson),
    });
  };

  /**
   * Finish an inline text session. New boxes are persisted once with their measured size; edits write the
   * text and the measured size only when something changed; an emptied box is removed instead of leaving
   * an invisible annotation. Failures reopen the editor with the typed text so nothing is lost.
   */
  const commitInlineText = (text: string, element: HTMLDivElement) => {
    const session = inlineTextRef.current;
    if (!session) return;
    inlineTextRef.current = null;
    inlineEditorRef.current = null;
    setInlineText(null);
    const layer = element.closest<HTMLElement>('.pdf-render-layer');
    const mark = element.closest<HTMLElement>('.annotation-mark') ?? element;
    const measured = layer ? percentBoxOf(mark, layer) : null;
    const key = source.key;
    const reopen = () => { if (sourceKeyRef.current === key) setInlineText({ ...session, text }); };
    if (!session.annotationId) {
      if (!text.trim()) return;
      const box = clampTextBoxToPage({
        x: numberValue(session.positionJson.x, 0),
        y: numberValue(session.positionJson.y, 0),
        width: measured?.width ?? 20,
        height: measured?.height ?? 4,
      });
      const positionJson: PositionJson = {
        ...session.positionJson,
        x: roundPercent(box.x),
        y: roundPercent(box.y),
        width: roundPercent(box.width),
        height: roundPercent(box.height),
      };
      void saves.run('保存文字标注', async () => {
        const id = await onCreateAnnotation({
          ...buildAnnotationDraft('text', positionJson, session.color),
          page: session.page,
          comment: text,
        });
        if (sourceKeyRef.current === key && typeof id === 'string') {
          setFocusedAnnotationId(id);
          onFocusAnnotation?.(id);
        }
      }, reopen);
      return;
    }
    const annotation = currentFileAnnotations.find((item) => item.id === session.annotationId);
    if (!annotation) return;
    if (!text.trim()) {
      void saves.run('删除标注', async () => onDeleteAnnotation(annotation.id), reopen, annotation.id);
      return;
    }
    const nextPosition: PositionJson = { ...annotation.positionJson };
    let positionChanged = false;
    if (measured) {
      const layout = textAnnotationLayout(annotation.positionJson);
      const storedHeight = numberValue(annotation.positionJson.height, 0);
      // Auto boxes follow their content in both directions; fixed boxes keep the user's width and only
      // record a taller height when the text needs it, so a sub-pixel re-measure never rewrites them.
      const box = clampTextBoxToPage({
        x: numberValue(nextPosition.x, 0),
        y: numberValue(nextPosition.y, 0),
        width: layout.autoWidth ? measured.width : numberValue(annotation.positionJson.width, measured.width),
        height: layout.autoWidth ? measured.height : Math.max(measured.height, storedHeight),
      });
      const assign = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
        if (Math.abs(numberValue(annotation.positionJson[key], Number.NaN) - value) > 0.02) {
          nextPosition[key] = roundPercent(value);
          positionChanged = true;
        }
      };
      assign('x', box.x);
      assign('y', box.y);
      if (layout.autoWidth) assign('width', box.width);
      assign('height', box.height);
    }
    const textChanged = text !== (annotation.comment || '');
    if (!textChanged && !positionChanged) return;
    void saves.run('保存文字标注', async () => {
      if (positionChanged) await onUpdateAnnotationPosition(annotation.id, nextPosition);
      if (textChanged) await onUpdateAnnotationComment(annotation.id, text);
    }, reopen, annotation.id);
  };

  /** While a new box grows past the bottom margin, move it up instead of letting it hang off the page. */
  const keepInlineTextOnPage = (element: HTMLDivElement) => {
    const session = inlineTextRef.current;
    if (!session || session.annotationId) return;
    const layer = element.closest<HTMLElement>('.pdf-render-layer');
    const mark = element.closest<HTMLElement>('.annotation-mark');
    if (!layer || !mark) return;
    const box = percentBoxOf(mark, layer);
    if (!box) return;
    const limit = 100 - TEXT_EDGE_MARGIN_PERCENT;
    if (box.y + box.height <= limit + 0.05) return;
    const nextY = roundPercent(Math.max(0, limit - box.height));
    if (Math.abs(nextY - numberValue(session.positionJson.y, 0)) < 0.01) return;
    const next = { ...session, positionJson: { ...session.positionJson, y: nextY } };
    inlineTextRef.current = next;
    setInlineText(next);
  };

  const updateTextStyle = (annotationId: string, patch: TextAnnotationStylePatch) => {
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (!annotation || annotation.type !== 'text') return;
    const nextPosition: PositionJson = { ...annotation.positionJson, ...patch };
    void saves.run('修改文字样式', async () => onUpdateAnnotationPosition(annotationId, nextPosition), undefined, annotationId);
  };

  const saveComment = async () => {
    if (!commentPopover || commentSavingRef.current) return;
    const snapshot = commentPopover;
    const key = source.key;
    commentSavingRef.current = true; setCommentSaving(true); setCommentSaveError('');
    const position = {
      ...(snapshot.positionJson ?? {}), x: snapshot.x, y: snapshot.y,
      fontSize: snapshot.fontSize, bold: snapshot.bold, italic: snapshot.italic,
      textColor: snapshot.textColor, borderColor: snapshot.borderColor, backgroundColor: snapshot.backgroundColor,
    };
    try {
      if (snapshot.annotationId) {
        await onUpdateAnnotationPosition(snapshot.annotationId, position);
        await onUpdateAnnotationComment(snapshot.annotationId, snapshot.text.trim() || zh.reader.commentAnnotation);
      } else {
        // createAnnotation already persists comment: do not issue a second write after creation.
        await onCreateAnnotation({
          ...buildAnnotationDraft(snapshot.annotationType ?? 'comment', {
            ...position, width: snapshot.annotationType === 'text' ? 22 : 18,
            height: snapshot.annotationType === 'text' ? 7 : 8,
          }, activeAnnotationColor),
          page: snapshot.page,
          comment: snapshot.text.trim() || (snapshot.annotationType === 'text' ? zh.reader.textLabel : zh.reader.commentAnnotation),
        });
      }
      if (sourceKeyRef.current === key) setCommentPopover(current => current === snapshot ? null : current);
    } catch (error) {
      if (sourceKeyRef.current === key) setCommentSaveError(`保存失败，内容已保留，请重试：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (sourceKeyRef.current === key) { commentSavingRef.current = false; setCommentSaving(false); }
    }
  };

  const saveAnnotationDraft = async (draft: AnnotationDraft & { page: number }) => {
    const draftId = pushDraftPreview(draft);
    const key = source.key;
    await saves.run('保存标注', async () => {
      await onCreateAnnotation(draft);
      if (sourceKeyRef.current === key) removeDraftPreview(draftId);
    }, () => removeDraftPreview(draftId));
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
      else if (activeTool === 'eraser' && event.button === 0) {
        event.preventDefault();
        eraserPointerIdRef.current = event.pointerId;
        eraserPointerTargetRef.current = event.currentTarget;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateEraserCursor(pageNumber, event);
        eraseInkAtPointer(pageNumber, event);
      }
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') updateInkStroke(pageNumber, event);
      else if (activeTool === 'eraser') {
        updateEraserCursor(pageNumber, event);
        if (eraserPointerIdRef.current === event.pointerId && (event.buttons & 1) === 1) eraseInkAtPointer(pageNumber, event);
      }
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
      else if (activeTool === 'eraser') finishEraserPointer(event);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
      else if (activeTool === 'eraser') finishEraserPointer(event);
    },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (activeTool === 'ink') finishInkPointer(event);
      else if (activeTool === 'eraser') finishEraserPointer(event);
    },
    onPointerLeave: () => {
      if (activeTool === 'eraser' && eraserPointerIdRef.current === null) setEraserCursor(null);
    },
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'ink' || activeTool === 'eraser') return;
      if (stickyDrag) return;
      if (textSelectionToolsActive && !pageHasSelectableText(pageNumber)) {
        showTextLayerHint();
        return;
      }
      if (activeTool === 'comment') return;
      beginAnnotationDrag(pageNumber, event);
    },
    onMouseMove: (event: MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'ink' || activeTool === 'eraser') return;
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
      if ((activeTool === 'comment' || activeTool === 'text') && !commentSavingRef.current) {
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
    <div className="pdf-reader-surface" data-reader-layer="pdf-surface" ref={surfaceRef}>
      <PdfFindBar surface={surfaceRef} pages={pages} documentKey={source.key} />
      {saves.feedback}
      {textLayerHint && (
        <div className="pdf-text-layer-hint" role="status" aria-live="polite" data-reader-layer="hint">
          {textLayerHint}
        </div>
      )}
      <div className="reader-toolbar-progress" data-reader-layer="progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${Math.max(0.04, scrollProgress)})` }} />
      </div>
      <div
        className={`pdf-document ${activeTool}-mode ${activeTool === 'cursor' || activeTool === 'hand' ? '' : 'annotation-mode'} ${pan.isPanning ? 'panning' : ''} ${pan.spaceHeld ? 'pan-ready' : ''}`.trim()}
        data-reader-layer="pdf-document"
        role="region"
        aria-label="PDF 阅读区域，手形工具或空格加左键拖动，Shift 加滚轮左右移动"
        tabIndex={0}
        style={toolCursorStyle}
        ref={containerRef}
        onScroll={updateScrollProgress}
        {...pan.handlers}
      >
        <div className="pdf-document-content" data-reader-layer="pdf-content" ref={documentContentRef}>
          {pages.map((page) => (
            <PdfPageView
              key={page.pageNumber}
              pageMeta={page}
              zoom={zoom}
              displayZoom={displayZoom}
              selectableText={selectableText}
              textToolsUnavailable={textSelectionToolsActive && page.textItems.length === 0}
              commentPopover={commentPopover?.page === page.pageNumber ? commentPopover : null}
              eraserPreview={activeTool === 'eraser' && eraserCursor?.page === page.pageNumber
                ? { xPercent: eraserCursor.xPercent, yPercent: eraserCursor.yPercent, size: toolSettings.eraserSize, shape: toolSettings.eraserShape }
                : null}
              pageHandlers={pageHandlers(page.pageNumber)}
              flashKind={flash?.page === page.pageNumber ? flash.kind : null}
              priorityDistance={Math.abs(page.pageNumber - visiblePage)}
               commentSaving={commentSaving}
               commentSaveError={commentSaveError}
               onCommentPopoverChange={value => { if (!commentSavingRef.current) { setCommentPopover(value); setCommentSaveError(''); } }}
              onSaveComment={saveComment}
              annotationLayer={
                <AnnotationOverlay
                  annotations={annotationsByPage[page.pageNumber] ?? []}
                  drafts={draftAnnotationsByPage[page.pageNumber] ?? []}
                  selectionPreview={selectionPreviewByPage[page.pageNumber] ?? []}
                  dragDraft={dragDraft?.page === page.pageNumber ? dragDraft : null}
                  inkDraft={inkDraft?.page === page.pageNumber ? inkDraft : null}
                  activeTool={annotationsEnabled ? activeTool : 'hand'}
                  activeAnnotationColor={activeAnnotationColor}
                  toolSettings={toolSettings}
                  onSelectAnnotation={selectAnnotation}
                  onBeginStickyDrag={beginStickyDrag}
                  onBeginAnnotationResize={beginAnnotationResize}
                  onEditStickyAnnotation={editStickyAnnotation}
                  onUpdateAnnotationColor={(id, color) => { void saves.run('修改标注颜色', async () => onUpdateAnnotationColor(id, color), undefined, id); }}
                  onDeleteAnnotation={id => { void saves.run('删除标注', async () => onDeleteAnnotation(id), undefined, id); }}
                  onAppendAnnotationToNote={onAppendAnnotationToNote}
                  onUpdateTextStyle={updateTextStyle}
                  inlineTextEditor={inlineText?.page === page.pageNumber ? inlineText : null}
                  onCommitInlineText={commitInlineText}
                  onInlineEditorReady={(element) => { inlineEditorRef.current = element; }}
                  onInlineEditorLayout={keepInlineTextOnPage}
                  focusedAnnotationId={focusedAnnotationId}
                />
              }
            />
          ))}
          {annotationsEnabled && selectionPopup.visible && (
            <SelectionPopup
              visible={selectionPopup.visible}
              x={selectionPopup.x - (containerRef.current?.getBoundingClientRect().left ?? 0) + (containerRef.current?.scrollLeft ?? 0)}
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

function measuredPercentBox(target: HTMLElement, layer: HTMLElement) {
  const mark = target.closest<HTMLElement>('.annotation-mark');
  return mark ? percentBoxOf(mark, layer) : null;
}

function inkPositionFromPoints(points: InkDraft['points']): PositionJson {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.max(0, Math.min(100, Math.min(...xs)));
  const y = Math.max(0, Math.min(100, Math.min(...ys)));
  const maxX = Math.max(0, Math.min(100, Math.max(...xs)));
  const maxY = Math.max(0, Math.min(100, Math.max(...ys)));
  const width = Math.max(maxX - x, 0.1);
  const height = Math.max(maxY - y, 0.1);
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
