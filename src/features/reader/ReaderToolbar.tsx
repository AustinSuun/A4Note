import { useShortcutProps } from '../../shared/shortcuts';
import { ReaderShortcutSettings } from './ReaderShortcutSettings';
import { useEffect, useRef, useState } from 'react';
import { HighlightAppearanceControl } from './HighlightAppearanceControl';
import { ReaderToolbarPortal } from './ReaderToolbarPortal';
import { ReaderAnnotationDock } from './ReaderAnnotationDock';
import { AnnotationLayerPicker } from './AnnotationLayerPicker';
import { AnnotationToolPopover, ToolOptionsBar, annotationTools, defaultToolColors, toolColorToCss, toolHasSettings, useSharedToolColors } from '../annotationTools';
import type { SharedColorTool } from '../annotationTools';
import './reader-file-switch.css';
import type { AnnotationColor, PaperDocument, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';
import { AnnotationToolIcon, FitWidthIcon, ZoomInIcon, ZoomOutIcon } from './ReaderIcons';
import type { PdfZoomAnchor, ReaderContentMode, ReaderFileMode, ReaderToolSettings } from './types';
export function ReaderToolbar({
  paper,
  contentMode,
  onReturnToLibrary,
  fileMode,
  currentTranslatedFileId,
  parallelSyncLocked,
  activeAnnotationTool,
  activeAnnotationColor,
  customAnnotationColor,
  toolSettings,
  contextAnnotationId,
  contextAnnotationTool,
  contextAnnotationColor,
  contextToolSettings,
  zoom,
  onFileModeChange,
  onContentModeChange,
  onTranslatedFileIdChange,
  onParallelSyncLockedChange,
  onSelectAnnotationTool,
  onSelectAnnotationColor,
  onCustomAnnotationColorChange,
  onToolSettingsChange,
  onUpdateContextAnnotationColor,
  onUpdateContextAnnotationSettings,
  onClearContextAnnotation,
  onZoomChange,
  onFitWidth,
}: {
  paper: PaperDocument;
  contentMode: ReaderContentMode;
  onReturnToLibrary?: () => void;
  fileMode: ReaderFileMode;
  currentTranslatedFileId: string;
  parallelSyncLocked: boolean;
  activeAnnotationTool: ReaderTool;
  activeAnnotationColor: AnnotationColor;
  customAnnotationColor: string;
  toolSettings: ReaderToolSettings;
  contextAnnotationId?: string | null;
  contextAnnotationTool?: 'text' | 'rect' | 'arrow' | null;
  contextAnnotationColor?: AnnotationColor | null;
  contextToolSettings?: ReaderToolSettings | null;
  zoom: number;
  onFileModeChange: (mode: ReaderFileMode) => void;
  onContentModeChange: (mode: ReaderContentMode) => void;
  onTranslatedFileIdChange: (fileId: string) => void;
  onParallelSyncLockedChange: (locked: boolean) => void;
  onSelectAnnotationTool: (type: ReaderTool) => void;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  onCustomAnnotationColorChange: (color: string) => void;
  onToolSettingsChange: (settings: ReaderToolSettings) => void;
  onUpdateContextAnnotationColor?: (annotationId: string, color: AnnotationColor) => void;
  onUpdateContextAnnotationSettings?: (annotationId: string, settings: ReaderToolSettings) => void;
  onClearContextAnnotation?: () => void;
  onZoomChange: (zoom: number, anchor?: PdfZoomAnchor) => void;
  onFitWidth: () => void;
}) {
  const shortcutProps = useShortcutProps();
  const hasTranslatedPdf = Boolean(paper.translatedPdfs.length);
  // Task 97fcfb6c: per-tool recent colours live in the shared annotation store, so the board
  // (and any future host) sees the same "last used" colour per tool.
  const [sharedToolColors, setSharedToolColor] = useSharedToolColors();
  const toolColorFor = (tool: ReaderTool): AnnotationColor => (sharedToolColors[tool as SharedColorTool] as AnnotationColor | undefined) ?? defaultToolColors[tool];
  const rememberToolColor = (tool: ReaderTool, color: AnnotationColor) => {
    if (tool === 'cursor' || tool === 'hand' || tool === 'eraser') return;
    setSharedToolColor(tool as SharedColorTool, color);
  };
  const [toolSettingsOpenFor, setToolSettingsOpenFor] = useState<ReaderTool | null>(null);


  useEffect(() => {
    setToolSettingsOpenFor((current) => (current === activeAnnotationTool || current === contextAnnotationTool ? current : null));
  }, [activeAnnotationTool, contextAnnotationTool]);

  // Selecting an annotation no longer opens its settings panel by itself (task 540986ab): the panel covered
  // the page and stole focus from in-place text editing. The tool button lights up as "contextual" and a
  // click on it opens the panel for that annotation on demand.
  useEffect(() => {
    setToolSettingsOpenFor(null);
  }, [contextAnnotationId]);

  const handleSelectTool = (tool: ReaderTool) => {
    if (contextAnnotationId && contextAnnotationTool === tool && toolHasSettings(tool)) {
      setToolSettingsOpenFor((current) => (current === tool ? null : tool));
      return;
    }
    if (contextAnnotationId) onClearContextAnnotation?.();
    const isCurrentTool = activeAnnotationTool === tool;
    if (isCurrentTool && toolHasSettings(tool)) {
      setToolSettingsOpenFor((current) => (current === tool ? null : tool));
    } else {
      setToolSettingsOpenFor(null);
    }
    onSelectAnnotationTool(tool);
    if (tool !== 'cursor' && tool !== 'hand' && tool !== 'eraser') {
      onSelectAnnotationColor(toolColorFor(tool));
    }
  };

  const handleSelectColor = (color: AnnotationColor) => {
    if (contextAnnotationId) {
      onUpdateContextAnnotationColor?.(contextAnnotationId, color);
      return;
    }
    rememberToolColor(activeAnnotationTool, color);
    onSelectAnnotationColor(color);
  };

  const handleCustomColor = (value: string) => {
    const color = value as AnnotationColor;
    onCustomAnnotationColorChange(value);
    if (contextAnnotationId) {
      onUpdateContextAnnotationColor?.(contextAnnotationId, color);
      return;
    }
    rememberToolColor(activeAnnotationTool, color);
    onSelectAnnotationColor(color);
  };



  const optionsTool = toolSettingsOpenFor && (toolSettingsOpenFor === contextAnnotationTool || toolSettingsOpenFor === activeAnnotationTool) ? toolSettingsOpenFor : null;
  const currentColor = contextAnnotationColor ?? toolColorFor(activeAnnotationTool) ?? activeAnnotationColor;
  const currentToolSettings = contextToolSettings ?? toolSettings;
  const handleToolSettingsChange = (settings: ReaderToolSettings) => {
    if (contextAnnotationId) {
      onUpdateContextAnnotationSettings?.(contextAnnotationId, settings);
      return;
    }
    onToolSettingsChange(settings);
  };

  return (
    <>
    <ReaderToolbarPortal onReturnToLibrary={contentMode === 'pdf' ? onReturnToLibrary : undefined} compactLabel={`${fileMode === 'parallel' ? zh.reader.parallelPdf : fileMode === 'translated' ? zh.reader.translatedPdf : zh.reader.sourcePdf} · ${Math.round(zoom * 100)}%`}>
    <header
      className="reader-toolbar"
      data-reader-layer="toolbar"
      aria-label="阅读工具栏"
      tabIndex={0}
    >
      <div className="reader-toolbar-primary">
        <div className="reader-toolbar-group reader-toolbar-file">
          {contentMode === 'pdf' && <div className="segmented compact reader-file-switch" data-file-mode={fileMode} role="group" aria-label="PDF 文件模式">
            <button
              className={fileMode === 'source' ? 'active' : ''}
              aria-pressed={fileMode === 'source'}
              type="button"
              {...shortcutProps('reader.file.source', zh.reader.sourcePdf)}
              onClick={() => onFileModeChange('source')}
              disabled={!paper.sourcePdf}
            >
              {zh.reader.sourcePdf}
            </button>
            <button
              className={fileMode === 'translated' ? 'active' : ''}
              aria-pressed={fileMode === 'translated'}
              type="button"
              {...shortcutProps('reader.file.translated', zh.reader.translatedPdf)}
              onClick={() => onFileModeChange('translated')}
              disabled={!hasTranslatedPdf}
            >
              {zh.reader.translatedPdf}
            </button>
            <button
              className={fileMode === 'parallel' ? 'active' : ''}
              aria-pressed={fileMode === 'parallel'}
              type="button"
              {...shortcutProps('reader.file.parallel', zh.reader.parallelPdf)}
              onClick={() => onFileModeChange('parallel')}
              disabled={!paper.sourcePdf || !hasTranslatedPdf}
            >
              {zh.reader.parallelPdf}
            </button>
          </div>}

          {contentMode === 'pdf' && (fileMode === 'translated' || fileMode === 'parallel') && paper.translatedFileIds.length > 1 && (
            <select
              className="translated-file-select"
              value={currentTranslatedFileId}
              onChange={(event) => {
                onTranslatedFileIdChange(event.target.value);
                if (fileMode !== 'parallel') {
                  onFileModeChange('translated');
                }
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

          {contentMode === 'pdf' && fileMode === 'parallel' && (
            <label className="parallel-sync-toggle">
              <input
                type="checkbox"
                checked={parallelSyncLocked}
                onChange={(event) => onParallelSyncLockedChange(event.target.checked)}
              />
              <span>{zh.reader.parallelSync}</span>
            </label>
          )}
        </div>
      </div>

      {contentMode === 'pdf' && onReturnToLibrary && <div className="reader-toolbar-center">
        <button type="button" className="reader-return-library" aria-label="返回文献库" title="返回文献库" onClick={onReturnToLibrary}>文献库</button>
      </div>}
      <div className="reader-toolbar-end">
        {contentMode === 'pdf' && <div className="reader-toolbar-group reader-toolbar-nav">
          <div className="zoom-controls" aria-label="Zoom controls">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(0.2, Number((zoom - 0.1).toFixed(2))))}
              {...shortcutProps('reader.zoomOut', zh.reader.zoomOut)}
            >
              <ZoomOutIcon />
            </button>
            <button type="button" className="zoom-pct-btn" onClick={() => onZoomChange(1)} title="Reset to 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={onFitWidth} {...shortcutProps('reader.fitWidth', zh.reader.fitWidth)}>
              <FitWidthIcon />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(5, Number((zoom + 0.1).toFixed(2))))}
              {...shortcutProps('reader.zoomIn', zh.reader.zoomIn)}
            >
              <ZoomInIcon />
            </button>
          </div>


        </div>}
      </div>
    </header>
    </ReaderToolbarPortal>
    {contentMode === 'pdf' && <ReaderAnnotationDock>
        {contentMode === 'pdf' && <div className="reader-toolbar-group reader-toolbar-annotations">
          <div className="annotation-toolbar" aria-label="Annotation tools">
            {annotationTools.map((tool) => {
              const isContextual = contextAnnotationTool === tool.id;
              const toolColor = isContextual ? contextAnnotationColor ?? toolColorFor(tool.id) : toolColorFor(tool.id);
              const isActive = activeAnnotationTool === tool.id;
              return (
                <div key={tool.id} className="annotation-tool-slot">
                  <button
                    className={`annotation-tool-btn ${isActive ? 'active' : ''} ${isContextual ? 'contextual' : ''}`.trim()}
                    type="button"
                    onClick={() => handleSelectTool(tool.id)}
                    {...shortcutProps(`reader.tool.${tool.id}`, tool.id === 'hand' ? '手形拖动：按住左键移动；空格＋左键可临时拖动' : isContextual ? `${tool.label}（点击打开所选标注的设置）` : toolHasSettings(tool.id) ? `${tool.label}（再次点击打开设置）` : tool.label)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                    aria-haspopup={toolHasSettings(tool.id) ? 'dialog' : undefined}
                    aria-expanded={toolHasSettings(tool.id) ? optionsTool === tool.id : undefined}
                  >
                    <AnnotationToolIcon id={tool.id} />
                    {tool.id !== 'cursor' && tool.id !== 'hand' && tool.id !== 'eraser' && (
                      <span className="annotation-tool-color-dot" style={{ background: toolColorToCss(toolColor) }} />
                    )}
                  </button>
                  {optionsTool === tool.id && (
                    <AnnotationToolPopover title={annotationTools.find((candidate) => candidate.id === optionsTool)?.label ?? '标注'} onClose={() => { setToolSettingsOpenFor(null); if (contextAnnotationId) onClearContextAnnotation?.(); }}>
                    <ToolOptionsBar
                      tool={optionsTool}
                      toolSettings={currentToolSettings}
                      activeColor={currentColor}
                      customAnnotationColor={customAnnotationColor}
                      onSelectAnnotationColor={handleSelectColor}
                      onCustomAnnotationColorChange={handleCustomColor}
                      onToolSettingsChange={handleToolSettingsChange}
                      highlightAppearance={<HighlightAppearanceControl />}
                    />
                    </AnnotationToolPopover>
                  )}
                </div>
              );
            })}
            <AnnotationLayerPicker />
            <ReaderShortcutSettings />
          </div>
        </div>}

    </ReaderAnnotationDock>}
    </>
  );
}
