import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfOutlinePanel } from './pdf/PdfOutlinePanel';

/** 左侧面板包装器（目前只有 Outline，后续可扩展为多 tab） */
export function ReaderLeftPanel({
  pdfDocument,
  onJumpToPage,
}: {
  pdfDocument: PDFDocumentProxy | null;
  onJumpToPage: (page: number) => void;
}) {
  return (
    <aside className="reader-left-panel">
      <div className="reader-left-panel-header">
        <span className="panel-title">目录</span>
      </div>
      <div className="reader-left-panel-content">
        <PdfOutlinePanel pdfDocument={pdfDocument} onJumpToPage={onJumpToPage} />
      </div>
    </aside>
  );
}
