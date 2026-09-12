/**
 * What a PDF the reader is showing actually is (PDF-0).
 *
 * `PdfReader` used to take a `PaperDocument` and derive the file path, the
 * annotation file id and the effect key from it, which tied the viewer to the
 * literature module. A descriptor breaks that: the library builds one from a
 * Paper, the workbench builds one from a `Resource`, and the reader only knows
 * how to ask for bytes.
 *
 * Pure by design — types only, no React and no Tauri — so the verify harness can
 * load it directly.
 */
import type { PaperDocument } from '../../../core/types';
import type { PaperFileKind } from '../../../platform/nativeApi';

/** Where the bytes come from. `null` means "nothing to load yet", not an error. */
export type PdfBytesRequest =
  | { source: 'paperFile'; paperId: string; kind: PaperFileKind; fileId: string }
  | { source: 'localPath'; path: string };

export interface PdfDocumentSource {
  /** Identity of the loaded document; every load effect keys off this alone. */
  key: string;
  /** Shown while loading. */
  title: string;
  /**
   * The id annotations are filed under. Empty means annotations are not scoped
   * to a file yet — the resource path is like that until PDF-1.
   */
  fileId: string;
  resourceId?: string;
  request: PdfBytesRequest | null;
}

export function pdfSourceKey(request: PdfBytesRequest | null): string {
  if (!request) return 'none';
  return request.source === 'paperFile'
    ? `paper:${request.paperId}:${request.kind}:${request.fileId}`
    : `path:${request.path}`;
}

/**
 * The library reader's source. A Paper may have no PDF for the requested kind,
 * in which case the request is `null` and the reader shows its placeholder — the
 * same behaviour the old `hasPdf` check produced.
 */
export function paperPdfSource(paper: PaperDocument, kind: PaperFileKind, fileId: string): PdfDocumentSource {
  const hasPdf = kind === 'source' ? Boolean(paper.sourcePdf) : Boolean(paper.translatedPdfs.length);
  const activeFileId = fileId || (kind === 'source' ? paper.sourceFileId : paper.translatedFileIds[0] ?? '');
  const request: PdfBytesRequest | null = hasPdf
    ? { source: 'paperFile', paperId: paper.paperId, kind, fileId: activeFileId }
    : null;
  return {
    key: `${paper.paperId}:${pdfSourceKey(request)}`,
    title: paper.title,
    fileId: activeFileId,
    request,
  };
}

/**
 * A PDF opened from the file tree. It has no annotation file id: annotations on
 * resources are PDF-1, and inventing an id here would file them where nothing
 * reads them back.
 */
export function resourcePdfSource(path: string, title: string, resourceId?: string): PdfDocumentSource {
  const request: PdfBytesRequest | null = path ? { source: 'localPath', path } : null;
  return { key: pdfSourceKey(request), title, fileId: '', resourceId, request };
}
