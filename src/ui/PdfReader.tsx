import { type MouseEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { AnnotationColor, AnnotationDraft, AnnotationType, PaperDocument, PositionJson, ReaderTool } from '../core/types';
import { isTauriRuntime, loadPaperFileBytes, type PaperFileKind } from '../core/nativeApi';
import { zh } from './zh';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfStatus = 'loading' | 'ready' | 'placeholder' | 'error';

type PageMeta = {
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  pdfPage: pdfjsLib.PDFPageProxy;
  textItems: TextItemBox[];
};

type TextItemBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type RectBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DraftAnnotationPreview = (AnnotationDraft & { page: number }) & { id: string };
type AnnotationMarkModel = { id?: string; page: number; type: AnnotationType; color: string; comment: string; quote: string; positionJson: PositionJson };

type DragDraft = {
  page: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type CommentPopover = {
  annotationId?: string;
  page: number;
  x: number;
  y: number;
  leftPx: number;
  topPx: number;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  positionJson?: PositionJson;
};

type StickyDrag = {
  annotationId: string;
  page: number;
  offsetX: number;
  offsetY: number;
};

type StickyDragPreview = {
  annotationId: string;
  page: number;
  positionJson: PositionJson;
};

type ReaderFlash = {
  page: number;
  kind: 'page-jump' | 'annotation';
};

const PAGE_VISIBLE_MARGIN = 0.3;
const PAGE_VISIBLE_THRESHOLD = 0.08;
const PDF_RENDER_BUFFER_SCALE = 2.15;

export default function PdfReader({
  paper,
  fileKind,
  fileId,
  activeTool,
  activeAnnotationColor,
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
}: {
  paper: PaperDocument;
  fileKind: PaperFileKind;
  fileId: string;
  activeTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  zoom: number;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
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
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [draftAnnotations, setDraftAnnotations] = useState<DraftAnnotationPreview[]>([]);
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null);
  const [commentPopover, setCommentPopover] = useState<CommentPopover | null>(null);
  const [stickyDrag, setStickyDrag] = useState<StickyDrag | null>(null);
  const [stickyDragPreview, setStickyDragPreview] = useState<StickyDragPreview | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(zoom);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const zoomFrameRef = useRef<number | null>(null);
  const zoomTimerRef = useRef<number | null>(null);
  const pendingZoomRef = useRef(zoom);
  const localFocusRequestRef = useRef<string | null>(null);
  const lastExternalFocusRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PdfStatus>('placeholder');
  const [message, setMessage] = useState(zh.reader.pdfPlaceholder);
  const [flash, setFlash] = useState<ReaderFlash | null>(null);
  const activeFileKey = `${fileKind}:${fileId || (fileKind === 'source' ? paper.sourcePdf : paper.translatedPdfs.join('|'))}`;
  const activeFileId = fileId || (fileKind === 'source' ? paper.sourceFileId : paper.translatedFileIds[0] ?? '');
  const currentFileAnnotations = useMemo(
    () => paper.annotations.filter((annotation) => !activeFileId || annotation.fileId === activeFileId),
    [activeFileId, paper.annotations],
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
  const selectableText = activeTool === 'cursor' || textSelectionToolsActive;

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      const hasPdf = fileKind === 'source' ? Boolean(paper.sourcePdf) : Boolean(paper.translatedPdfs.length);
      if (!hasPdf || !isTauriRuntime()) {
        setPdfDocument(null);
        setPages([]);
        setStatus('placeholder');
        setMessage(zh.reader.pdfPlaceholder);
        return;
      }
      try {
        setStatus((current) => (pages.length ? current : 'loading'));
        setMessage(zh.reader.pdfLoading);
        const bytes = await loadPaperFileBytes({ paperId: paper.paperId, kind: fileKind, fileId: activeFileId });
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;
        setPdfDocument(pdf);
        setStatus('ready');
        setMessage('');
      } catch (error) {
        console.error('Failed to load PDF', error);
        if (cancelled) return;
        setPdfDocument(null);
        setPages([]);
        setStatus('error');
        setMessage(zh.reader.pdfError);
      }
    }
    void loadPdf();
    return () => {
      cancelled = true;
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
      if (zoomTimerRef.current !== null) {
        window.clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = null;
      }
    };
  }, [paper.paperId, activeFileKey, fileKind, activeFileId]);

  useEffect(() => {
    let cancelled = false;
    async function collectPageMeta() {
      if (!pdfDocument) return;
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
        requestAnimationFrame(updateScrollProgress);
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
    setCommentPopover(null);
    setStickyDrag(null);
    setStickyDragPreview(null);
  }, [paper.paperId, fileKind]);

  useEffect(() => {
    pendingZoomRef.current = zoom;
    setDisplayZoom(zoom);
  }, [zoom]);

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
  }, [textSelectionToolsActive, paper.paperId, activeTool, pages.length]);

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

  const annotationsByPage = useMemo(() => {
    return displayedAnnotations.reduce<Record<number, typeof paper.annotations>>((grouped, annotation) => {
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
    const anchor = { x: event.clientX, y: event.clientY };
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    pendingZoomRef.current = clamp(Number((pendingZoomRef.current + delta).toFixed(2)), 0.7, 2.2);
    setDisplayZoom(pendingZoomRef.current);
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => {
      zoomTimerRef.current = null;
      onZoomChange(pendingZoomRef.current, anchor);
    }, 160);
  };

  const updateScrollProgress = () => {
    const container = containerRef.current;
    if (!container) return;
    const available = container.scrollHeight - container.clientHeight;
    setScrollProgress(available > 0 ? clamp(container.scrollTop / available, 0, 1) : 0);
    const currentPage = currentVisiblePage(container);
    setVisiblePage(currentPage);
    onReaderStateChange?.({
      currentPage,
      totalPages: pages.length || 1,
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

  const beginAnnotationDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (status !== 'ready' || activeTool === 'cursor' || activeTool === 'comment' || textSelectionToolsActive) return;
    const point = pointFromEvent(event);
    setDragDraft({
      page: pageNumber,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  };

  const updateAnnotationDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (!dragDraft || dragDraft.page !== pageNumber) return;
    const point = pointFromEvent(event);
    setDragDraft((current) => (current ? { ...current, currentX: point.x, currentY: point.y } : current));
  };

  const beginStickyDrag = (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    const annotation = currentFileAnnotations.find((item) => item.id === annotationId);
    if (!annotation || annotation.type !== 'comment') return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    setFocusedAnnotationId(annotationId);
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

  const updateStickyDrag = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (!stickyDrag || stickyDrag.page !== pageNumber) return;
    const annotation = currentFileAnnotations.find((item) => item.id === stickyDrag.annotationId);
    if (!annotation) return;
    const point = pointFromEvent(event);
    const nextPosition = {
      ...annotation.positionJson,
      x: clamp(point.x - stickyDrag.offsetX, 0, 96),
      y: clamp(point.y - stickyDrag.offsetY, 0, 96),
      width: Math.max(numberValue(annotation.positionJson.width, 20), 12),
      height: Math.max(numberValue(annotation.positionJson.height, 9), 7),
    };
    setStickyDragPreview({
      annotationId: stickyDrag.annotationId,
      page: pageNumber,
      positionJson: nextPosition,
    });
  };

  const finishStickyDrag = () => {
    const preview = stickyDragPreview;
    setStickyDrag(null);
    setStickyDragPreview(null);
    if (preview) {
      void onUpdateAnnotationPosition(preview.annotationId, preview.positionJson);
    }
  };

  const finishTextSelection = async (pageNumber: number, container: HTMLElement) => {
    if (!textSelectionToolsActive) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const selectionText = selection.toString().replace(/\s+/g, ' ').trim();
    if (!selectionText) return;
    const rects = Array.from(range.getClientRects())
      .map((rect) => normalizeClientRect(rect, container))
      .filter((rect): rect is RectBox => rect !== null && rect.width > 0.12 && rect.height > 0.08);
    if (!rects.length) return;
    const segments = mergeRectsIntoLineSegments(rects);
    const bounds = boundingBox(segments);
    if (!bounds.width || !bounds.height) return;
    const draft = {
      ...buildAnnotationDraft(activeTool, { ...bounds, segments }, activeAnnotationColor),
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

  const finishAnnotationDrag = async () => {
    if (!dragDraft || activeTool === 'cursor' || activeTool === 'comment') return;
    const position = normalizeBox(dragDraft);
    setDragDraft(null);
    if (position.width < 1.4 || position.height < 0.8) return;
    const page = pages.find((candidate) => candidate.pageNumber === dragDraft.page);
    const textSelection = page && (activeTool === 'highlight' || activeTool === 'underline') ? textSelectionFromDrag(page.textItems, position) : null;
    const draft = {
      ...buildAnnotationDraft(activeTool, textSelection?.position ?? position, activeAnnotationColor),
      quote: textSelection?.quote || annotationLabel(activeTool),
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

  const createCommentAtPointer = (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
    if (status !== 'ready' || activeTool !== 'comment') return;
    const point = pointFromEvent(event);
    const rect = event.currentTarget.getBoundingClientRect();
    setCommentPopover({
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
    });
  };

  const editStickyAnnotation = (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => {
    if (!annotation.id || annotation.type !== 'comment') return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget.closest<HTMLElement>('.pdf-render-layer');
    const rect = layer?.getBoundingClientRect();
    setFocusedAnnotationId(annotation.id);
    onFocusAnnotation?.(annotation.id);
    setCommentPopover({
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
      ...buildAnnotationDraft('comment', {
        x: commentPopover.x,
        y: commentPopover.y,
        width: 18,
        height: 8,
        fontSize: commentPopover.fontSize,
        bold: commentPopover.bold,
        italic: commentPopover.italic,
        textColor: commentPopover.textColor,
      }, activeAnnotationColor),
      page: commentPopover.page,
      comment: commentPopover.text.trim() || zh.reader.commentAnnotation,
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
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
      if (stickyDrag) return;
      if (activeTool === 'comment') return;
      beginAnnotationDrag(pageNumber, event);
    },
    onMouseMove: (event: MouseEvent<HTMLDivElement>) => {
      updateStickyDrag(pageNumber, event);
      updateAnnotationDrag(pageNumber, event);
    },
    onMouseUp: () => {
      finishStickyDrag();
      void finishAnnotationDrag();
    },
    onMouseLeave: () => {
      finishStickyDrag();
      void finishAnnotationDrag();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (textSelectionToolsActive) return;
      if (activeTool === 'comment') {
        createCommentAtPointer(pageNumber, event);
        return;
      }
      setFocusedAnnotationId(null);
      onFocusAnnotation?.(null);
    },
  });

  if (status !== 'ready') {
    return (
      <div className={`pdf-page ${activeTool === 'cursor' ? 'cursor-mode' : ''}`}>
        <div className="pdf-placeholder">
          <div className="pdf-meta">
            <span>{paper.venue || '未知来源'}</span>
            <span>{paper.year || '-'}</span>
          </div>
          <h2>{paper.title}</h2>
          <p>{paper.authors || '未知作者'}</p>
          <div className="pdf-line wide" />
          <div className="pdf-line" />
          <div className="pdf-line short" />
          <div className="pdf-figure">{message}</div>
          {fileKind === 'source' && <mark>{zh.reader.annotationHint}</mark>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pdf-document ${activeTool === 'cursor' ? 'cursor-mode' : 'annotation-mode'} ${isPanning ? 'panning' : ''}`}
      ref={containerRef}
      onWheel={handleWheel}
      onScroll={updateScrollProgress}
      onMouseDown={beginPan}
      onMouseMove={updatePan}
      onMouseUp={endPan}
      onMouseLeave={endPan}
    >
      <div className="pdf-progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${Math.max(0.04, scrollProgress)})` }} />
      </div>
      {pages.map((page) => (
        <PdfPageView
          key={page.pageNumber}
          pageMeta={page}
          zoom={zoom}
          displayZoom={displayZoom}
          fileKind={fileKind}
          activeTool={activeTool}
          selectableText={selectableText}
          annotations={annotationsByPage[page.pageNumber] ?? []}
          drafts={draftAnnotationsByPage[page.pageNumber] ?? []}
          dragDraft={dragDraft?.page === page.pageNumber ? dragDraft : null}
          commentPopover={commentPopover?.page === page.pageNumber ? commentPopover : null}
          pageHandlers={pageHandlers(page.pageNumber)}
          onSelectAnnotation={selectAnnotation}
          onBeginStickyDrag={beginStickyDrag}
          onEditStickyAnnotation={editStickyAnnotation}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          focusedAnnotationId={focusedAnnotationId}
          flashKind={flash?.page === page.pageNumber ? flash.kind : null}
          priorityDistance={Math.abs(page.pageNumber - visiblePage)}
          onCommentPopoverChange={setCommentPopover}
          onSaveComment={saveComment}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
        />
      ))}
    </div>
  );
}

function PdfPageView({
  pageMeta,
  zoom,
  displayZoom,
  fileKind,
  activeTool,
  selectableText,
  annotations,
  drafts,
  dragDraft,
  commentPopover,
  pageHandlers,
  onSelectAnnotation,
  onBeginStickyDrag,
  onEditStickyAnnotation,
  onUpdateAnnotationColor,
  focusedAnnotationId,
  flashKind,
  priorityDistance,
  onCommentPopoverChange,
  onSaveComment,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
}: {
  pageMeta: PageMeta;
  zoom: number;
  displayZoom: number;
  fileKind: PaperFileKind;
  activeTool: ReaderTool;
  selectableText: boolean;
  annotations: PaperDocument['annotations'];
  drafts: DraftAnnotationPreview[];
  dragDraft: DragDraft | null;
  commentPopover: CommentPopover | null;
  pageHandlers: {
    onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onClick: (event: MouseEvent<HTMLDivElement>) => void;
  };
  onSelectAnnotation: (annotationId: string) => void;
  onBeginStickyDrag: (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => void;
  onEditStickyAnnotation: (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => void;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  focusedAnnotationId: string | null;
  flashKind: 'page-jump' | 'annotation' | null;
  priorityDistance: number;
  onCommentPopoverChange: (value: CommentPopover | null) => void;
  onSaveComment: () => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSequenceRef = useRef(0);
  const priorityDistanceRef = useRef(priorityDistance);
  const [shouldRender, setShouldRender] = useState(false);
  const [hasBitmap, setHasBitmap] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

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
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let delayTimer: number | null = null;
    const renderSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderSequence;
    async function renderPage() {
      if (!canvasRef.current || !shouldRender) return;
      const renderPriorityDistance = priorityDistanceRef.current;
      const renderDelay = renderPriorityDistance <= 1 ? 16 : renderPriorityDistance === 2 ? 48 : 96;
      if (renderDelay) {
        await new Promise<void>((resolve) => {
          delayTimer = window.setTimeout(resolve, renderDelay);
        });
        if (cancelled) return;
      }
      if (cancelled || !canvasRef.current) return;
      const viewport = pageMeta.pdfPage.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      setIsUpdating(true);
      const outputScale = outputScaleForViewport(viewport.width, viewport.height);
      const pixelWidth = Math.floor(viewport.width * outputScale);
      const pixelHeight = Math.floor(viewport.height * outputScale);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = pixelWidth;
      renderCanvas.height = pixelHeight;
      const renderContext = renderCanvas.getContext('2d', { alpha: false });
      if (!renderContext) return;
      renderContext.imageSmoothingEnabled = true;
      renderContext.imageSmoothingQuality = 'high';
      renderTask = pageMeta.pdfPage.render({
        canvas: renderCanvas,
        canvasContext: renderContext,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await renderTask.promise.catch((error) => {
        if (error?.name !== 'RenderingCancelledException') {
          throw error;
        }
      });
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
    void renderPage();
    return () => {
      cancelled = true;
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      renderTask?.cancel();
    };
  }, [pageMeta, zoom, shouldRender]);

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
    <div className={`pdf-page ${isUpdating ? 'updating' : ''} ${!hasBitmap ? 'released' : ''} ${flashKind ? `flash-${flashKind}` : ''}`} data-page={pageMeta.pageNumber} ref={rootRef} {...pageHandlers}>
      <div className="pdf-render-layer" style={{ width: pageMeta.baseWidth * displayZoom, height: pageMeta.baseHeight * displayZoom }}>
        <canvas ref={canvasRef} className="pdf-canvas-page ready" />
        <PdfTextLayer textItems={pageMeta.textItems} zoom={displayZoom} selectable={selectableText} />
        <AnnotationOverlay
          annotations={annotations}
          drafts={drafts}
          dragDraft={dragDraft}
          activeTool={activeTool}
          onSelectAnnotation={onSelectAnnotation}
          onBeginStickyDrag={onBeginStickyDrag}
          onEditStickyAnnotation={onEditStickyAnnotation}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          focusedAnnotationId={focusedAnnotationId}
        />
        {commentPopover && (
          <div className="comment-popover" style={{ left: commentPopover.leftPx, top: commentPopover.topPx }}>
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

function PdfTextLayer({ textItems, zoom, selectable }: { textItems: TextItemBox[]; zoom: number; selectable: boolean }) {
  return (
    <div className={selectable ? 'pdf-text-layer selectable' : 'pdf-text-layer'} aria-hidden={!selectable}>
      {textItems.map((item, index) => (
        <span
          key={`${index}-${item.x}-${item.y}`}
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            width: `${item.width}%`,
            height: `${item.height}%`,
            fontSize: `${Math.max(item.fontSize * zoom, 6)}px`,
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

function AnnotationOverlay({
  annotations,
  drafts,
  dragDraft,
  activeTool,
  onSelectAnnotation,
  onBeginStickyDrag,
  onEditStickyAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  focusedAnnotationId,
}: {
  annotations: PaperDocument['annotations'];
  drafts: DraftAnnotationPreview[];
  dragDraft: DragDraft | null;
  activeTool: ReaderTool;
  onSelectAnnotation: (annotationId: string) => void;
  onBeginStickyDrag: (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => void;
  onEditStickyAnnotation: (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => void;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  focusedAnnotationId: string | null;
}) {
  const dragPosition = dragDraft && activeTool !== 'cursor' && activeTool !== 'comment' ? normalizeBox(dragDraft) : null;
  return (
    <div className="annotation-overlay" aria-label="PDF annotation layer">
      {annotations.map((annotation) => (
        <AnnotationMark
          key={annotation.id}
          annotation={annotation}
          onSelectAnnotation={onSelectAnnotation}
          onBeginStickyDrag={onBeginStickyDrag}
          onEditStickyAnnotation={onEditStickyAnnotation}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          focused={focusedAnnotationId === annotation.id}
        />
      ))}
      {drafts.map((annotation) => (
        <AnnotationMark key={annotation.id} annotation={annotation} draft />
      ))}
      {dragPosition && activeTool !== 'cursor' && activeTool !== 'comment' && (
        <div
          className={`annotation-mark ${activeTool} ${annotationColor(activeTool)} draft drag-preview`}
          style={activeTool === 'underline' ? underlinePositionStyle(dragPosition) : activeTool === 'highlight' ? highlightPositionStyle(dragPosition) : positionStyle(dragPosition)}
        />
      )}
    </div>
  );
}

function AnnotationMark({
  annotation,
  draft,
  onSelectAnnotation,
  onBeginStickyDrag,
  onEditStickyAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  focused,
}: {
  annotation: AnnotationMarkModel;
  draft?: boolean;
  onSelectAnnotation?: (annotationId: string) => void;
  onBeginStickyDrag?: (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => void;
  onEditStickyAnnotation?: (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => void;
  onUpdateAnnotationColor?: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation?: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote?: (annotationId: string) => void;
  focused?: boolean;
}) {
  const segments = annotationSegments(annotation.positionJson);
  const annotationId = annotation.id;
  const isSticky = annotation.type === 'comment';
  const customColorStyle = annotation.color.startsWith('#') ? annotationCustomColorStyle(annotation.type, annotation.color) : undefined;
  return (
    <>
      {segments.map((segment, index) => (
        <div
          key={`${annotation.id ?? annotation.quote}-${index}`}
          className={`annotation-mark ${annotation.type} ${annotation.color} ${draft ? 'draft' : ''} ${focused ? 'focused' : ''}`}
          title={annotation.comment || annotation.quote}
          onMouseDown={(event) => {
            if (!annotation.id) return;
            event.preventDefault();
            event.stopPropagation();
            if (isSticky) {
              onBeginStickyDrag?.(annotation.id, annotation.page, event);
            }
          }}
          onMouseUp={(event) => {
            if (!annotation.id) return;
            event.preventDefault();
            if (!isSticky) {
              event.stopPropagation();
            }
          }}
          onClick={(event) => {
            if (!annotation.id) return;
            event.preventDefault();
            event.stopPropagation();
            onSelectAnnotation?.(annotation.id);
          }}
          onDoubleClick={(event) => {
            if (!annotation.id || !isSticky || draft) return;
            event.preventDefault();
            event.stopPropagation();
            onEditStickyAnnotation?.(annotation, event);
          }}
          style={
            annotation.type === 'underline'
              ? { ...underlinePositionStyle(segment), ...customColorStyle }
              : annotation.type === 'highlight'
                ? { ...highlightPositionStyle(segment), ...customColorStyle }
              : { ...positionStyle(segment), ...customColorStyle }
          }
        >
          {isSticky && (
            <div
              className="sticky-note-content"
              style={{
                fontSize: `${numberValue(annotation.positionJson.fontSize, 13)}px`,
                fontWeight: Boolean(annotation.positionJson.bold) ? 700 : 500,
                fontStyle: Boolean(annotation.positionJson.italic) ? 'italic' : 'normal',
                color: String(annotation.positionJson.textColor ?? '#202822'),
              }}
            >
              {annotation.comment || annotation.quote || zh.reader.commentAnnotation}
            </div>
          )}
          {focused && annotationId && index === 0 && !draft && (
            <div className="annotation-inline-actions">
              {isSticky && (
                <button
                  type="button"
                  title={zh.reader.noteEdit}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onEditStickyAnnotation?.(annotation, event);
                  }}
                >
                  <EditIcon />
                </button>
              )}
              <button
                type="button"
                title={zh.reader.appendAnnotationToNote}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAppendAnnotationToNote?.(annotationId);
                }}
              >
                <QuoteIcon />
              </button>
              <button
                type="button"
                title={zh.reader.deleteAnnotation}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectAnnotation?.(annotationId);
                  void onDeleteAnnotation?.(annotationId);
                }}
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                className={`annotation-color-pill ${annotation.color}`}
                title="切换颜色"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!annotationId) return;
                  void onUpdateAnnotationColor?.(annotationId, nextAnnotationColor(annotation.color as AnnotationColor));
                }}
              >
                <ColorSwatchIcon color={annotation.color} />
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

async function extractTextItemBoxes(page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<TextItemBox[]> {
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

function normalizeClientRect(rect: DOMRect | ClientRect, container: HTMLElement): RectBox | null {
  const containerRect = container.getBoundingClientRect();
  if (!containerRect.width || !containerRect.height) return null;
  return {
    x: clamp(((rect.left - containerRect.left) / containerRect.width) * 100, 0, 100),
    y: clamp(((rect.top - containerRect.top) / containerRect.height) * 100, 0, 100),
    width: clamp((rect.width / containerRect.width) * 100, 0, 100),
    height: clamp((rect.height / containerRect.height) * 100, 0, 100),
  };
}

function mergeRectsIntoLineSegments(rects: RectBox[]) {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: RectBox[] = [];
  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.y - rect.y) < 1.2 && rect.x <= previous.x + previous.width + 1.2) {
      const left = Math.min(previous.x, rect.x);
      const top = Math.min(previous.y, rect.y);
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      const bottom = Math.max(previous.y + previous.height, rect.y + rect.height);
      merged[merged.length - 1] = { x: left, y: top, width: right - left, height: bottom - top };
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

function textSelectionFromDrag(textItems: TextItemBox[], box: RectBox) {
  const lineGroups = groupTextItemsIntoLines(textItems);
  const selectedGroups = lineGroups
    .map((items) => ({ items, segment: boundingBox(items) }))
    .filter(({ segment }) => lineSelectionScore(segment, box) >= 0.18)
    .sort((a, b) => a.segment.y - b.segment.y || a.segment.x - b.segment.x);
  if (!selectedGroups.length) return null;
  const selected = selectedGroups.flatMap((group) => group.items).sort((a, b) => a.y - b.y || a.x - b.x);
  const segments = selectedGroups.map((group) => group.segment);
  const bounds = boundingBox(segments);
  return {
    quote: selected.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    position: { ...bounds, segments },
  };
}

function mergeTextItemsIntoLineSegments(items: TextItemBox[]) {
  return groupTextItemsIntoLines(items).map((line) => boundingBox(line));
}

function groupTextItemsIntoLines(items: TextItemBox[]) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItemBox[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) < Math.max(candidate[0].height, item.height) * 0.65);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

function lineSelectionScore(line: RectBox, dragBox: RectBox) {
  const intersection = intersectionBox(line, dragBox);
  if (!intersection) return 0;
  const verticalCoverage = intersection.height / Math.max(line.height, 0.1);
  const horizontalCoverage = intersection.width / Math.max(line.width, 0.1);
  return verticalCoverage * Math.min(horizontalCoverage * 2.5, 1);
}

function intersectionBox(a: RectBox, b: RectBox) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundingBox(items: Array<RectBox>) {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function intersects(a: RectBox, b: RectBox) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function annotationSegments(position: PositionJson) {
  const maybeSegments = position.segments;
  return Array.isArray(maybeSegments) ? (maybeSegments as PositionJson[]) : [position];
}

function pointFromEvent(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function normalizeBox(drag: DragDraft) {
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

function positionStyle(position: PositionJson) {
  return {
    left: `${numberValue(position.x, 18)}%`,
    top: `${numberValue(position.y, 28)}%`,
    width: `${numberValue(position.width, 42)}%`,
    height: `${numberValue(position.height, 5)}%`,
  };
}

function highlightPositionStyle(position: PositionJson) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const height = Math.max(numberValue(position.height, 5), 0.85);
  const inset = Math.min(Math.max(height * 0.34, 0.38), 1.2);
  return {
    left: `${x}%`,
    top: `${y + inset}%`,
    width: `${width}%`,
    height: `${Math.max(height - inset * 1.05, 0.42)}%`,
  };
}

function underlinePositionStyle(position: PositionJson) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const height = Math.max(numberValue(position.height, 5), 0.7);
  const lineHeight = Math.min(Math.max(height * 0.14, 0.32), 0.72);
  const baselineTop = y + height + lineHeight * 0.15;
  return {
    left: `${x}%`,
    top: `${baselineTop}%`,
    width: `${width}%`,
    height: `${lineHeight}%`,
  };
}

function annotationCustomColorStyle(type: AnnotationType, color: string) {
  if (type === 'underline') {
    return { background: color };
  }
  if (type === 'area') {
    return { outlineColor: color, background: `${color}2a` };
  }
  if (type === 'comment') {
    return { background: color };
  }
  return { background: `${color}b8` };
}

function buildAnnotationDraft(type: AnnotationType, position: PositionJson, color: AnnotationColor = annotationColor(type)) {
  const finalPosition =
    type === 'underline'
      ? { ...position, height: Math.max(numberValue(position.height, 0), 0.9) }
      : type === 'comment'
        ? { ...position, width: numberValue(position.width, 18), height: numberValue(position.height, 8) }
        : position;
  return {
    type,
    quote: annotationLabel(type),
    comment: type === 'comment' ? zh.reader.commentAnnotation : '',
    color,
    positionJson: finalPosition,
  };
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clonePositionJson(positionJson: PositionJson): PositionJson {
  return JSON.parse(JSON.stringify(positionJson)) as PositionJson;
}

function outputScaleForViewport(width: number, height: number) {
  const deviceScale = Math.max(window.devicePixelRatio || 1, 1.5);
  const preferredScale = Math.min(deviceScale, PDF_RENDER_BUFFER_SCALE);
  const maxPixels = 14_000_000;
  const preferredPixels = width * height * preferredScale * preferredScale;
  if (preferredPixels <= maxPixels) return preferredScale;
  return Math.max(1.25, Math.sqrt(maxPixels / Math.max(width * height, 1)));
}

function annotationColor(type: AnnotationType): AnnotationColor {
  if (type === 'comment') return 'green';
  if (type === 'underline') return 'blue';
  if (type === 'area') return 'purple';
  return 'yellow';
}

function nextAnnotationColor(color: AnnotationColor): AnnotationColor {
  if (color === 'yellow') return 'green';
  if (color === 'green') return 'blue';
  if (color === 'blue') return 'purple';
  return 'yellow';
}

function annotationLabel(type: AnnotationType) {
  if (type === 'comment') return zh.reader.commentLabel;
  if (type === 'underline') return zh.reader.underlineLabel;
  if (type === 'area') return zh.reader.areaLabel;
  return zh.reader.highlightLabel;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h8M10 7V5h4v2M9 10v7M15 10v7M6 7l1 13h10l1-13" />
    </svg>
  );
}

function ColorSwatchIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.1" fill="currentColor" className={color} />
      <circle cx="12" cy="12" r="8.7" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h5v5H9a4 4 0 0 1-4 4V9a2 2 0 0 1 2-2Zm10 0h5v5h-3a4 4 0 0 1-4 4V9a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4l10-10-4-4L5 15v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function currentVisiblePage(container: HTMLElement) {
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page[data-page]'));
  const rect = container.getBoundingClientRect();
  const found = pages.find((page) => {
    const pageRect = page.getBoundingClientRect();
    return pageRect.bottom > rect.top + rect.height * PAGE_VISIBLE_MARGIN && pageRect.top < rect.top + rect.height * (1 - PAGE_VISIBLE_THRESHOLD);
  });
  return found ? Number(found.dataset.page) : 1;
}

function scrollPageIntoViewIfNeeded(pageElement: HTMLElement) {
  const container = pageElement.closest<HTMLElement>('.pdf-document');
  if (container && isPageSufficientlyVisible(container, pageElement)) return;
  pageElement.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function isPageSufficientlyVisible(container: HTMLElement, pageElement: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();
  const visibleTop = Math.max(containerRect.top, pageRect.top);
  const visibleBottom = Math.min(containerRect.bottom, pageRect.bottom);
  const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
  const targetHeight = Math.max(Math.min(containerRect.height, pageRect.height), 1);
  return visibleHeight / targetHeight >= 0.55;
}


