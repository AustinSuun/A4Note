import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationColor, AnnotationDraft, PositionJson } from '../../core/types';
import { isTauriRuntime, createNativeResourceAnnotation, deleteNativeResourceAnnotation, listNativeResourceAnnotations, updateNativeResourceAnnotationColor, updateNativeResourceAnnotationComment, updateNativeResourceAnnotationPosition } from '../../platform/nativeApi';
import { openPathExternal, openPathInVSCode, revealPath } from '../../platform/projects';
import { zh } from '../../ui/zh';
import { resourcePdfSource } from './pdf/pdfSource';
import { defaultReaderToolSettings, type PdfZoomAnchor } from './pdf/types';
import { FitWidthIcon, ZoomInIcon, ZoomOutIcon } from './ReaderIcons';

const PdfReader = lazy(() => import('./pdf/PdfReader'));

export interface PdfResourceTabProps {
  path: string;
  name: string;
  resourceId?: string;
  initialZoom?: number;
  initialPage?: number;
  onStateChange?: (state: { zoom?: number; page?: number }) => void;
}

/**
 * A PDF opened from the file tree (PDF-0).
 *
 * Resource annotations use their own persistence table and never enter the
 * literature annotation table, so a generic PDF can be annotated safely.
 */
export function PdfResourceTab({ path, name, resourceId, initialZoom = 1, initialPage = 1, onStateChange }: PdfResourceTabProps) {
  const [zoom, setZoom] = useState(initialZoom);
  const [readerState, setReaderState] = useState({ currentPage: initialPage, totalPages: 1 });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const rootRef = useRef<HTMLElement | null>(null);
  const zoomAnchorRef = useRef<(PdfZoomAnchor & { zoom: number; left: number; top: number }) | null>(null);
  const source = resourcePdfSource(path, name, resourceId);

  useEffect(() => {
    if (!resourceId || !isTauriRuntime()) return;
    let disposed = false;
    void listNativeResourceAnnotations(resourceId).then((rows) => {
      if (disposed) return;
      setAnnotations(rows.map((row) => ({
        id: row.id,
        paperId: '',
        fileId: '',
        resourceId: row.resource_id,
        page: row.page,
        type: row.annotation_type,
        quote: row.quote,
        comment: row.comment,
        color: row.color,
        positionJson: JSON.parse(row.position_json) as PositionJson,
        createdAt: new Date(row.created_at).toISOString(),
      })));
    }).catch(() => {
      if (!disposed) setAnnotations([]);
    });
    return () => { disposed = true; };
  }, [resourceId]);

  const createAnnotation = async (draft: AnnotationDraft & { page: number }) => {
    if (!resourceId) return undefined;
    const id = isTauriRuntime()
      ? await createNativeResourceAnnotation({ resourceId, page: draft.page, type: draft.type, quote: draft.quote, comment: draft.comment, color: draft.color, positionJson: draft.positionJson })
      : `resource-anno-${Date.now()}`;
    setAnnotations((current) => [...current, { id, paperId: '', fileId: '', resourceId, ...draft, createdAt: new Date().toISOString() }]);
    return id;
  };

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const scroller = rootRef.current?.querySelector<HTMLElement>('.pdf-document');
    if (!scroller) return;
    const content = scroller.querySelector<HTMLElement>('.pdf-document-content');
    content?.style.removeProperty('transform');
    content?.style.removeProperty('transform-origin');
    const scale = zoom / anchor.zoom;
    const maxLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const maxTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const scrollerRect = scroller.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const contentOriginX = contentRect
      ? contentRect.left - scrollerRect.left + scroller.scrollLeft
      : anchor.contentOriginX;
    const contentOriginY = contentRect
      ? contentRect.top - scrollerRect.top + scroller.scrollTop
      : anchor.contentOriginY;
    const nextLeft = contentOriginX + anchor.contentX * scale - anchor.left;
    const nextTop = contentOriginY + anchor.contentY * scale - anchor.top;
    scroller.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    scroller.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
  }, [zoom]);

  const changeZoom = (next: number, anchorPoint?: PdfZoomAnchor) => {
    const scroller = rootRef.current?.querySelector<HTMLElement>('.pdf-document');
    if (scroller && next !== zoom) {
      const rect = scroller.getBoundingClientRect();
      const left = anchorPoint ? anchorPoint.x - rect.left : rect.width / 2;
      const top = anchorPoint ? anchorPoint.y - rect.top : rect.height / 2;
      const content = scroller.querySelector<HTMLElement>('.pdf-document-content');
      const contentRect = content?.getBoundingClientRect();
      const contentOriginX = anchorPoint?.contentOriginX
        ?? (contentRect ? contentRect.left - rect.left + scroller.scrollLeft : 0);
      const contentOriginY = anchorPoint?.contentOriginY
        ?? (contentRect ? contentRect.top - rect.top + scroller.scrollTop : 0);
      const contentX = anchorPoint?.contentX
        ?? (contentRect ? scroller.scrollLeft + left - contentOriginX : scroller.scrollLeft + left);
      const contentY = anchorPoint?.contentY
        ?? (contentRect ? scroller.scrollTop + top - contentOriginY : scroller.scrollTop + top);
      zoomAnchorRef.current = {
        x: anchorPoint?.x ?? rect.left + left,
        y: anchorPoint?.y ?? rect.top + top,
        contentX,
        contentY,
        contentOriginX,
        contentOriginY,
        zoom,
        left,
        top,
      };
    }
    setZoom(next);
    onStateChange?.({ zoom: next });
  };
  const changeReaderState = (next: { currentPage: number; totalPages: number }) => {
    setReaderState(next);
    if (next.currentPage !== readerState.currentPage) onStateChange?.({ page: next.currentPage });
  };

  const updateAnnotationComment = async (annotationId: string, comment: string) => {
    setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, comment } : annotation));
    if (isTauriRuntime()) await updateNativeResourceAnnotationComment({ annotationId, comment });
  };
  const updateAnnotationColor = async (annotationId: string, color: AnnotationColor) => {
    setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, color } : annotation));
    if (isTauriRuntime()) await updateNativeResourceAnnotationColor({ annotationId, color });
  };
  const updateAnnotationPosition = async (annotationId: string, positionJson: PositionJson) => {
    setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, positionJson } : annotation));
    if (isTauriRuntime()) await updateNativeResourceAnnotationPosition({ annotationId, positionJson });
  };
  const deleteAnnotation = async (annotationId: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    if (isTauriRuntime()) await deleteNativeResourceAnnotation(annotationId);
  };

  return (
    <section className="pdf-resource-tab" ref={rootRef}>
      <header className="pdf-resource-header">
        <div className="pdf-resource-identity">
          <h2>{name}</h2>
          <p className="pdf-resource-path" title={path}>
            {path}
          </p>
        </div>
        <div className="pdf-resource-tools">
          <span className="pdf-resource-pages">
            {zh.reader.pageStatus(readerState.currentPage, readerState.totalPages)}
          </span>
          <div className="zoom-controls" aria-label={zh.reader.zoomControls}>
            <button type="button" onClick={() => changeZoom(Math.max(0.7, Number((zoom - 0.1).toFixed(2))))} title={zh.reader.zoomOut}>
              <ZoomOutIcon />
            </button>
            <button type="button" className="zoom-pct-btn" onClick={() => changeZoom(1)} title={zh.reader.zoomReset}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => changeZoom(1.35)} title={zh.reader.fitWidth}>
              <FitWidthIcon />
            </button>
            <button type="button" onClick={() => changeZoom(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))} title={zh.reader.zoomIn}>
              <ZoomInIcon />
            </button>
          </div>
          <div className="pdf-resource-actions">
            <button type="button" className="workbench-action" onClick={() => void revealPath(path)}>
              {zh.workbench.fileReveal}
            </button>
            <button type="button" className="workbench-action" onClick={() => void openPathExternal(path)}>
              {zh.workbench.fileOpenExternal}
            </button>
            <button type="button" className="workbench-action" onClick={() => void openPathInVSCode(path)}>
              {zh.workbench.fileOpenInVSCode}
            </button>
          </div>
        </div>
      </header>
      <div className="pdf-resource-body">
        <Suspense
          fallback={
            <div className="pdf-reader-status loading" role="status" aria-live="polite">
              <span className="pdf-loading-indicator" aria-hidden="true" />
              <div className="pdf-reader-status-copy">
                <strong>{zh.reader.pdfLoading}</strong>
              </div>
            </div>
          }
        >
          <PdfReader
            source={source}
            annotations={annotations}
            activeTool="cursor"
            activeAnnotationColor="yellow"
            toolSettings={defaultReaderToolSettings}
            zoom={zoom}
            requestedPage={initialPage}
            onZoomChange={changeZoom}
            onReaderStateChange={changeReaderState}
            onCreateAnnotation={createAnnotation}
            onUpdateAnnotationComment={updateAnnotationComment}
            onUpdateAnnotationPosition={updateAnnotationPosition}
            onUpdateAnnotationColor={updateAnnotationColor}
            onDeleteAnnotation={deleteAnnotation}
            onAppendAnnotationToNote={noop}
          />
        </Suspense>
      </div>
    </section>
  );
}

function noop() {}
