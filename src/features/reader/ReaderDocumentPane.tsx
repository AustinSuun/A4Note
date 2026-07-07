import { lazy, Suspense } from 'react';
import type { AnnotationColor, AnnotationDraft, PaperDocument, PositionJson, ReaderTool } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { MarkdownEmptyState, MarkdownReadView } from './ReaderMarkdown';
import type { ReaderContentMode } from './types';

const PdfReader = lazy(() => import('./pdf/PdfReader'));

export function ReaderDocumentPane({
  paper,
  contentMode,
  fileMode,
  currentTranslatedFileId,
  activeAnnotationTool,
  zoom,
  activeAnnotationColor,
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
}: {
  paper: PaperDocument;
  contentMode: ReaderContentMode;
  fileMode: PaperFileKind;
  currentTranslatedFileId: string;
  activeAnnotationTool: ReaderTool;
  zoom: number;
  activeAnnotationColor: AnnotationColor;
  requestedPage: number | null;
  focusedAnnotationId: string | null;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
  onCreateAnnotation: (annotation: AnnotationDraft & { page: number }) => void | Promise<string | undefined>;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onReaderStateChange: (state: { currentPage: number; totalPages: number }) => void;
  onFocusAnnotation: (annotationId: string | null) => void;
  onCreateNote: () => void | Promise<void>;
}) {
  const canShowMarkdown = Boolean(paper.notes.length);

  return (
    <article className="pdf-canvas">
      {contentMode === 'pdf' ? (
        <Suspense fallback={<div className="reader-loading">{zh.reader.pdfLoading}</div>}>
          <PdfReader
            paper={paper}
            fileKind={fileMode}
            fileId={fileMode === 'translated' ? currentTranslatedFileId : paper.sourceFileId}
            activeTool={activeAnnotationTool}
            zoom={zoom}
            activeAnnotationColor={activeAnnotationColor}
            onZoomChange={onZoomChange}
            requestedPage={requestedPage}
            onCreateAnnotation={onCreateAnnotation}
            onUpdateAnnotationComment={onUpdateAnnotationComment}
            onUpdateAnnotationPosition={onUpdateAnnotationPosition}
            onUpdateAnnotationColor={onUpdateAnnotationColor}
            onDeleteAnnotation={onDeleteAnnotation}
            onAppendAnnotationToNote={onAppendAnnotationToNote}
            onReaderStateChange={onReaderStateChange}
            onFocusAnnotation={onFocusAnnotation}
            focusedAnnotationId={focusedAnnotationId}
          />
        </Suspense>
      ) : canShowMarkdown ? (
        <MarkdownReadView paper={paper} />
      ) : (
        <MarkdownEmptyState onCreateNote={onCreateNote} />
      )}
    </article>
  );
}
