import { useEffect, useState } from 'react';
import type { AnnotationColor, PaperDocument, ReaderLayout, ReaderSidePanelTab, ReaderTool } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { AnnotationToolIcon, FitWidthIcon, ZoomInIcon, ZoomOutIcon } from './ReaderIcons';
import { annotationPresetColors, annotationTools, layoutPresets } from './readerConstants';
import type { ReaderContentMode, ReaderSidePanelDefinition } from './types';

export function ReaderToolbar({
  paper,
  layout,
  contentMode,
  fileMode,
  currentTranslatedFileId,
  activeAnnotationTool,
  activeAnnotationColor,
  customAnnotationColor,
  zoom,
  readerPageState,
  sidePanelOpen,
  sidePanelTab,
  sidePanels,
  onLayoutChange,
  onContentModeChange,
  onFileModeChange,
  onTranslatedFileIdChange,
  onSelectAnnotationTool,
  onSelectAnnotationColor,
  onCustomAnnotationColorChange,
  onZoomChange,
  onFitWidth,
  onSidePanelTabChange,
  onJumpToPage,
}: {
  paper: PaperDocument;
  layout: ReaderLayout;
  contentMode: ReaderContentMode;
  fileMode: PaperFileKind;
  currentTranslatedFileId: string;
  activeAnnotationTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  customAnnotationColor: string;
  zoom: number;
  readerPageState: { currentPage: number; totalPages: number };
  sidePanelOpen: boolean;
  sidePanelTab: ReaderSidePanelTab;
  sidePanels: ReaderSidePanelDefinition[];
  onLayoutChange: (layout: ReaderLayout) => void;
  onContentModeChange: (mode: ReaderContentMode) => void;
  onFileModeChange: (mode: PaperFileKind) => void;
  onTranslatedFileIdChange: (fileId: string) => void;
  onSelectAnnotationTool: (type: ReaderTool) => void;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  onCustomAnnotationColorChange: (color: string) => void;
  onZoomChange: (zoom: number, anchor?: { x: number; y: number }) => void;
  onFitWidth: () => void;
  onSidePanelTabChange: (tab: ReaderSidePanelTab) => void;
  onJumpToPage: (page: number) => void;
}) {
  const canShowPdf = Boolean(paper.sourcePdf || paper.translatedPdfs.length);
  const canShowMarkdown = Boolean(paper.notes.length);
  const hasTranslatedPdf = Boolean(paper.translatedPdfs.length);
  const [pageInput, setPageInput] = useState(String(readerPageState.currentPage));

  useEffect(() => {
    setPageInput(String(readerPageState.currentPage));
  }, [readerPageState.currentPage, paper.paperId]);

  return (
    <header className="reader-toolbar">
      <div className="reader-title-block">
        <h1>{zh.reader.title}</h1>
      </div>
      <div className="reader-header-tools">
        <div className="reader-header-row">
          <div className="segmented compact">
            <button className={contentMode === 'pdf' ? 'active' : ''} type="button" onClick={() => onContentModeChange('pdf')} disabled={!canShowPdf}>
              {zh.reader.pdfMode}
            </button>
            <button className={contentMode === 'markdown' ? 'active' : ''} type="button" onClick={() => onContentModeChange('markdown')} disabled={!canShowMarkdown}>
              {zh.reader.markdownMode}
            </button>
          </div>
          {contentMode === 'pdf' && (
            <div className="segmented compact">
              <button className={fileMode === 'source' ? 'active' : ''} type="button" onClick={() => onFileModeChange('source')} disabled={!paper.sourcePdf}>
                {zh.reader.sourcePdf}
              </button>
              <button className={fileMode === 'translated' ? 'active' : ''} type="button" onClick={() => onFileModeChange('translated')} disabled={!hasTranslatedPdf}>
                {zh.reader.translatedPdf}
              </button>
            </div>
          )}
          {contentMode === 'pdf' && fileMode === 'translated' && paper.translatedFileIds.length > 1 && (
            <select
              className="translated-file-select"
              value={currentTranslatedFileId}
              onChange={(event) => {
                onTranslatedFileIdChange(event.target.value);
                onFileModeChange('translated');
              }}
              title={zh.reader.translatedFileSelect}
            >
              {paper.translatedFileIds.map((fileId, index) => (
                <option key={fileId} value={fileId}>
                  {zh.reader.translatedFileOption(index + 1)}
                </option>
              ))}
            </select>
          )}
          {contentMode === 'pdf' && (
            <div className="annotation-tools compact-toolbar">
              {annotationTools.map((tool) => (
                <button key={tool.id} className={activeAnnotationTool === tool.id ? 'active' : ''} type="button" onClick={() => onSelectAnnotationTool(tool.id)} title={tool.label}>
                  <AnnotationToolIcon id={tool.id} />
                </button>
              ))}
              <div className="annotation-color-switch" title={zh.reader.highlight}>
                {annotationPresetColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={activeAnnotationColor === color ? `active ${color}` : color}
                    onClick={() => onSelectAnnotationColor(color)}
                    aria-label={color}
                  />
                ))}
                <label className="annotation-color-custom" title={zh.reader.highlight}>
                  <input
                    type="color"
                    value={activeAnnotationColor.startsWith('#') ? activeAnnotationColor : customAnnotationColor}
                    onChange={(event) => {
                      const value = event.target.value;
                      onCustomAnnotationColorChange(value);
                      onSelectAnnotationColor(value as AnnotationColor);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          <div className="segmented compact">
            {layoutPresets.map((preset) => (
              <button key={preset.id} className={layout === preset.id ? 'active' : ''} type="button" onClick={() => onLayoutChange(preset.id)}>
                {preset.label}
              </button>
            ))}
          </div>
          {contentMode === 'pdf' && (
            <div className="segmented compact zoom-controls">
              <button type="button" onClick={() => onZoomChange(Math.max(0.7, Number((zoom - 0.1).toFixed(2))))} title={zh.reader.zoomOut}>
                <ZoomOutIcon />
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button type="button" className="page-jump-button" onClick={() => onZoomChange(1)} title={zh.reader.fitWidth}>
                100%
              </button>
              <div className="page-jump-shell" title={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}>
                <input
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const nextPage = Math.max(1, Math.min(readerPageState.totalPages, Number(pageInput) || readerPageState.currentPage));
                    setPageInput(String(nextPage));
                    onJumpToPage(nextPage);
                  }}
                />
                <span>/ {readerPageState.totalPages}</span>
              </div>
              <button type="button" onClick={onFitWidth} title={zh.reader.fitWidth}>
                <FitWidthIcon />
              </button>
              <button type="button" onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))} title={zh.reader.zoomIn}>
                <ZoomInIcon />
              </button>
            </div>
          )}
          <div className="segmented compact panel-controls">
            {sidePanels.map((panel) => {
              const PanelIcon = panel.icon;
              return (
                <button key={panel.id} className={sidePanelOpen && sidePanelTab === panel.id ? 'active' : ''} type="button" onClick={() => onSidePanelTabChange(panel.id)} title={panel.label}>
                  <PanelIcon />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
