import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationColor, AnnotationDraft, PaperDocument, PositionJson, ReaderTool } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { MarkdownEmptyState, MarkdownNotePanel } from './ReaderMarkdown';
import { paperPdfSource } from './pdf/pdfSource';
import { scrollTopFromAnchor } from './pdf/pdfInteraction';
import type { NoteDraftPatch, NoteSaveInput, PdfScrollAnchor, PdfZoomAnchor, ReaderContentMode, ReaderFileMode, ReaderToolSettings } from './types';

const PdfReader = lazy(() => import('./pdf/PdfReader'));

function PdfLoadingState() {
  return (
    <div className="pdf-reader-status loading" role="status" aria-live="polite">
      <span className="pdf-loading-indicator" aria-hidden="true" />
      <div className="pdf-reader-status-copy">
        <strong>{zh.reader.pdfLoading}</strong>
      </div>
    </div>
  );
}

type MountedPdfReader = {
  key: string;
  paperId: string;
  fileKind: PaperFileKind;
  fileId: string;
};

export function ReaderDocumentPane({
  paper,
  contentMode,
  fileMode,
  currentTranslatedFileId,
  activeParallelFileKind,
  parallelSyncLocked,
  activeAnnotationTool,
  zoom,
  activeAnnotationColor,
  toolSettings,
  requestedPage,
  focusedAnnotationId,
  onZoomChange,
  onCreateAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onReaderStateChange,
  onFocusAnnotation,
  onCreateNote,
  noteDraftPatch,
  onNoteDraftPatchConsumed,
  onNoteSave,
  onActiveParallelFileKindChange,
  onNavigateAnnotation,
  onCompleteOneShotTool,
}: {
  paper: PaperDocument;
  contentMode: ReaderContentMode;
  fileMode: ReaderFileMode;
  currentTranslatedFileId: string;
  activeParallelFileKind: PaperFileKind;
  parallelSyncLocked: boolean;
  activeAnnotationTool: ReaderTool;
  zoom: number;
  activeAnnotationColor: AnnotationColor;
  toolSettings: ReaderToolSettings;
  requestedPage: number | null;
  focusedAnnotationId: string | null;
  onZoomChange: (zoom: number, anchor?: PdfZoomAnchor) => void;
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }, fileKind?: PaperFileKind) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onReaderStateChange: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation: (annotationId: string | null) => void;
  onCreateNote: () => void | Promise<string | void>;
  noteDraftPatch: NoteDraftPatch | null;
  onNoteDraftPatchConsumed: () => void;
  onNoteSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onActiveParallelFileKindChange: (kind: PaperFileKind) => void;
  onNavigateAnnotation: (annotationId: string) => void;
  onCompleteOneShotTool: () => void;
}) {
  const canShowMarkdown = Boolean(paper.notes.length);
  const [mountedPdfReaders, setMountedPdfReaders] = useState<MountedPdfReader[]>([]);
  const canvasRootRef = useRef<HTMLElement | null>(null);
  const parallelScrollFrameRef = useRef<number | null>(null);
  const parallelScrollRequestRef = useRef<{ source: PaperFileKind; anchor: PdfScrollAnchor } | null>(null);
  const applyingParallelScrollRef = useRef(false);

  const activePdfReaders = useMemo<MountedPdfReader[]>(() => {
    if (contentMode !== 'pdf') return [];
    const readers: MountedPdfReader[] = [];
    if ((fileMode === 'source' || fileMode === 'parallel') && paper.sourcePdf) {
      readers.push({
        key: `${paper.paperId}:source:${paper.sourceFileId}`,
        paperId: paper.paperId,
        fileKind: 'source',
        fileId: paper.sourceFileId,
      });
    }
    if ((fileMode === 'translated' || fileMode === 'parallel') && currentTranslatedFileId) {
      readers.push({
        key: `${paper.paperId}:translated:${currentTranslatedFileId}`,
        paperId: paper.paperId,
        fileKind: 'translated',
        fileId: currentTranslatedFileId,
      });
    }
    return readers;
  }, [contentMode, currentTranslatedFileId, fileMode, paper.paperId, paper.sourceFileId, paper.sourcePdf]);

  useEffect(() => {
    setMountedPdfReaders((current) => {
      const next = current.filter((reader) => reader.paperId === paper.paperId);
      for (const reader of activePdfReaders) {
        if (!next.some((item) => item.key === reader.key)) next.push(reader);
      }
      return next.length === current.length && next.every((item, index) => item.key === current[index]?.key) ? current : next;
    });
  }, [activePdfReaders, paper.paperId]);

  const updateParallelScroll = (kind: PaperFileKind, anchor: PdfScrollAnchor) => {
    if (!parallelSyncLocked || applyingParallelScrollRef.current) return;
    parallelScrollRequestRef.current = { source: kind, anchor };
    if (parallelScrollFrameRef.current !== null) return;
    parallelScrollFrameRef.current = window.requestAnimationFrame(() => {
      parallelScrollFrameRef.current = null;
      const request = parallelScrollRequestRef.current;
      if (!request || !canvasRootRef.current) return;
      const targetKind = request.source === 'source' ? 'translated' : 'source';
      const target = canvasRootRef.current.querySelector<HTMLElement>(`.pdf-keepalive-pane.${targetKind}.visible .pdf-document`);
      if (!target) return;
      const nextTop = scrollTopFromAnchor(target, request.anchor);
      if (Math.abs(target.scrollTop - nextTop) > 1) {
        applyingParallelScrollRef.current = true;
        target.scrollTop = nextTop;
        window.requestAnimationFrame(() => {
          applyingParallelScrollRef.current = false;
        });
      }
    });
  };

  useEffect(() => () => {
    if (parallelScrollFrameRef.current !== null) window.cancelAnimationFrame(parallelScrollFrameRef.current);
  }, []);

  const isPdfReaderVisible = (reader: MountedPdfReader) => activePdfReaders.some((item) => item.key === reader.key);
  const isPdfReaderActive = (reader: MountedPdfReader) => {
    if (!isPdfReaderVisible(reader)) return false;
    return fileMode === 'parallel' ? activeParallelFileKind === reader.fileKind : true;
  };

  const renderPdfReader = (fileKind: PaperFileKind, fileId: string, active: boolean) => (
    <PdfReader
      source={paperPdfSource(paper, fileKind, fileId)}
      annotations={paper.annotations}
      activeTool={activeAnnotationTool}
      zoom={zoom}
      activeAnnotationColor={activeAnnotationColor}
      toolSettings={toolSettings}
      onCompleteOneShotTool={onCompleteOneShotTool}
      onZoomChange={onZoomChange}
      requestedPage={requestedPage}
      onCreateAnnotation={(annotation) => onCreateAnnotation(annotation, fileKind)}
      onUpdateAnnotationComment={onUpdateAnnotationComment}
      onUpdateAnnotationPosition={onUpdateAnnotationPosition}
      onUpdateAnnotationColor={onUpdateAnnotationColor}
      onDeleteAnnotation={onDeleteAnnotation}
      onAppendAnnotationToNote={onAppendAnnotationToNote}
      onReaderStateChange={active ? onReaderStateChange : undefined}
      onFocusAnnotation={onFocusAnnotation}
      focusedAnnotationId={focusedAnnotationId}
      syncScrollEnabled={parallelSyncLocked}
      syncScrollAnchor={null}
      onScrollSync={(anchor) => updateParallelScroll(fileKind, anchor)}
    />
  );

  return (
    <article className="pdf-canvas" data-reader-layer="document-pane" ref={canvasRootRef}>
      {contentMode === 'pdf' ? (
        <Suspense fallback={<PdfLoadingState />}>
          <div className={`pdf-keepalive-stage ${fileMode === 'parallel' ? 'parallel' : 'single'}`.trim()}>
            {mountedPdfReaders.map((reader) => {
              const visible = isPdfReaderVisible(reader);
              const active = isPdfReaderActive(reader);
              return (
                <section
                  key={reader.key}
                  className={`pdf-keepalive-pane ${reader.fileKind} ${visible ? 'visible' : 'hidden'} ${active ? 'active' : ''}`.trim()}
                  onMouseDownCapture={() => onActiveParallelFileKindChange(reader.fileKind)}
                  onFocusCapture={() => onActiveParallelFileKindChange(reader.fileKind)}
                  aria-hidden={!visible}
                >
                  {fileMode === 'parallel' && visible && (
                    <div className="pdf-parallel-header">{reader.fileKind === 'source' ? zh.reader.sourcePdf : zh.reader.translatedPdf}</div>
                  )}
                  {renderPdfReader(reader.fileKind, reader.fileId, active)}
                </section>
              );
            })}
            {!mountedPdfReaders.length && <PdfLoadingState />}
          </div>
        </Suspense>
      ) : canShowMarkdown ? (
        <div className="markdown-document-pane">
          <MarkdownNotePanel
            paper={paper}
            draftPatch={noteDraftPatch}
            onDraftPatchConsumed={onNoteDraftPatchConsumed}
            onSave={onNoteSave}
            onCreateNote={onCreateNote}
            onNavigateAnnotation={onNavigateAnnotation}
          />
        </div>
      ) : (
        <MarkdownEmptyState onCreateNote={onCreateNote} />
      )}
    </article>
  );
}
