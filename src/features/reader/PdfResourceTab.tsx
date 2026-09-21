import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationColor, AnnotationDraft, PositionJson } from '../../core/types';
import { isTauriRuntime, createNativeResourceAnnotation, deleteNativeResourceAnnotation, listNativeResourceAnnotations, updateNativeResourceAnnotationColor, updateNativeResourceAnnotationComment, updateNativeResourceAnnotationPosition } from '../../platform/nativeApi';
import { openPathExternal, openPathInVSCode, revealPath } from '../../platform/projects';
import { pdfFitWidth } from './readerNavigation';
import './reader-reliability.css';
import { zh } from '../../ui/zh';
import { resourcePdfSource } from './pdf/pdfSource';
import { capturePdfCenterAnchor, restorePdfPageAnchor } from './pdf/pdfZoomAnchor';
import { defaultReaderToolSettings, type PdfZoomAnchor } from './pdf/types';
import { AnnotationToolIcon, FitWidthIcon, ZoomInIcon, ZoomOutIcon } from './ReaderIcons';

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
  const [handTool, setHandTool] = useState(false);
  const [readerState, setReaderState] = useState({ currentPage: initialPage, totalPages: 1 });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const persistenceQueue = useRef<Promise<unknown>>(Promise.resolve());
  const resourceIdentity = useRef(resourceId); resourceIdentity.current = resourceId;
  const persist = (operation: () => Promise<unknown>, commit: () => void) => {
    if (loadState !== 'ready') return Promise.reject(new Error('请先重试读取标注。'));
    const identity = resourceId;
    const next = persistenceQueue.current.then(async () => {
      await operation();
      if (resourceIdentity.current === identity) commit();
    });
    persistenceQueue.current = next.catch(() => {});
    return next;
  };
  const rootRef = useRef<HTMLElement | null>(null);
  const zoomAnchorRef = useRef<(PdfZoomAnchor & { zoom: number; left: number; top: number }) | null>(null);
  const source = resourcePdfSource(path, name, resourceId);

  useEffect(() => {
    if (!resourceId || !isTauriRuntime()) { setLoadState('ready'); return; }
    let disposed = false;
    setLoadState('loading'); setLoadError('');
    void listNativeResourceAnnotations(resourceId).then((rows) => {
      if (disposed) return;
      setLoadState('ready');
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
        layerId: row.layer_id || `layer-default-${row.resource_id}`,
      })));
    }).catch(error => {
      if (!disposed) { setLoadState('error'); setLoadError(`标注读取失败，不能视为没有标注：${String(error)}`); }
    });
    return () => { disposed = true; };
  }, [resourceId, loadRevision]);

  const createAnnotation = async (draft: AnnotationDraft & { page: number }) => {
    if (!resourceId || loadState !== 'ready') throw new Error('标注尚未成功加载，请先重试读取。');
    const identity = resourceId;
    const id = isTauriRuntime()
      ? await createNativeResourceAnnotation({ resourceId, page: draft.page, type: draft.type, quote: draft.quote, comment: draft.comment, color: draft.color, positionJson: draft.positionJson })
      : `resource-anno-${Date.now()}`;
    // Generic resources write to their default layer until they get a layer picker of their own.
    if (resourceIdentity.current === identity) setAnnotations((current) => [...current, { id, paperId: '', fileId: '', resourceId, ...draft, createdAt: new Date().toISOString(), layerId: `layer-default-${resourceId}` }]);
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
    if (restorePdfPageAnchor(scroller, anchor)) return;
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
      const captured = anchorPoint ?? capturePdfCenterAnchor(scroller);
      if (captured) {
        zoomAnchorRef.current = {
          ...captured,
          zoom: zoom,
          left: scroller.clientLeft + scroller.clientWidth / 2,
          top: scroller.clientTop + scroller.clientHeight / 2,
        };
      }
    }
    setZoom(next);
    onStateChange?.({ zoom: next });
  };
  const changeReaderState = (next: { currentPage: number; totalPages: number }) => {
    setReaderState(next);
    if (next.currentPage !== readerState.currentPage) onStateChange?.({ page: next.currentPage });
  };

  const updateAnnotationComment = (annotationId: string, comment: string) => persist(
    async () => { if (isTauriRuntime()) await updateNativeResourceAnnotationComment({ annotationId, comment }); },
    () => setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, comment } : annotation)),
  );
  const updateAnnotationColor = (annotationId: string, color: AnnotationColor) => persist(
    async () => { if (isTauriRuntime()) await updateNativeResourceAnnotationColor({ annotationId, color }); },
    () => setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, color } : annotation)),
  );
  const updateAnnotationPosition = (annotationId: string, positionJson: PositionJson) => persist(
    async () => { if (isTauriRuntime()) await updateNativeResourceAnnotationPosition({ annotationId, positionJson }); },
    () => setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, positionJson } : annotation)),
  );
  const deleteAnnotation = (annotationId: string) => persist(
    async () => { if (isTauriRuntime()) await deleteNativeResourceAnnotation(annotationId); },
    () => setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId)),
  );
  const fitWidth = () => {
    const scroller = rootRef.current?.querySelector<HTMLElement>('.pdf-document');
    const next = scroller ? pdfFitWidth(scroller, readerState.currentPage) : null;
    if (next !== null) changeZoom(next);
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
            <button type="button" className={handTool ? 'active' : ''} aria-pressed={handTool} aria-label="手形拖动" title="手形拖动：再次点击回到选择；空格＋左键可临时拖动" onClick={() => setHandTool(value => !value)}>
              <AnnotationToolIcon id="hand" />
            </button>
            <button type="button" onClick={() => changeZoom(Math.max(0.2, Number((zoom - 0.1).toFixed(2))))} title={zh.reader.zoomOut}>
              <ZoomOutIcon />
            </button>
            <button type="button" className="zoom-pct-btn" onClick={() => changeZoom(1)} title={zh.reader.zoomReset}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={fitWidth} title={zh.reader.fitWidth}>
              <FitWidthIcon />
            </button>
            <button type="button" onClick={() => changeZoom(Math.min(5, Number((zoom + 0.1).toFixed(2))))} title={zh.reader.zoomIn}>
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
      {loadState === 'error' && <div className="reader-save-feedback" role="alert"><span>{loadError}</span><button type="button" onClick={() => setLoadRevision(v => v + 1)}>重试读取标注</button></div>}
      {loadState === 'loading' && <div className="reader-save-feedback" role="status">正在读取标注…</div>}
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
            annotationsEnabled={Boolean(resourceId) && loadState === 'ready'}
            activeTool={handTool ? 'hand' : 'cursor'}
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
