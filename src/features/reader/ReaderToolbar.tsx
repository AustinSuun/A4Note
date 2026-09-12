import { useEffect, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from 'react';
import type { AnnotationColor, PaperDocument, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';
import { AnnotationToolIcon, FitWidthIcon, SidebarIcon, ZoomInIcon, ZoomOutIcon } from './ReaderIcons';
import { annotationColorInputValue, annotationTools, defaultToolColors, toolColorPresets } from './readerConstants';
import type { PdfZoomAnchor, ReaderContentMode, ReaderFileMode, ReaderToolSettings } from './types';

const ERASER_THICKNESS_MIN = 8;
const ERASER_THICKNESS_MAX = 48;
const INK_STROKE_MIN = 1.5;
const INK_STROKE_MAX = 10;
const ARROW_STROKE_MIN = 1.5;
const ARROW_STROKE_MAX = 9;
const SHAPE_STROKE_MIN = 1;
const SHAPE_STROKE_MAX = 8;
export function ReaderToolbar({
  paper,
  contentMode,
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
  readerPageState,
  sidePanelOpen,
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
  onJumpToPage,
  onSidePanelOpenChange,
}: {
  paper: PaperDocument;
  contentMode: ReaderContentMode;
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
  readerPageState: { currentPage: number; totalPages: number };
  sidePanelOpen: boolean;
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
  onJumpToPage: (page: number) => void;
  onSidePanelOpenChange: (open: boolean) => void;
}) {
  const hasTranslatedPdf = Boolean(paper.translatedPdfs.length);
  const [pageInput, setPageInput] = useState(String(readerPageState.currentPage));
  const [toolColors, setToolColors] = useState<Record<ReaderTool, AnnotationColor>>(() => ({ ...defaultToolColors }));
  const [toolSettingsOpenFor, setToolSettingsOpenFor] = useState<ReaderTool | null>(null);

  useEffect(() => {
    setPageInput(String(readerPageState.currentPage));
  }, [readerPageState.currentPage, paper.paperId]);

  useEffect(() => {
    setToolSettingsOpenFor((current) => (current === activeAnnotationTool ? current : null));
  }, [activeAnnotationTool]);

  const handleSelectTool = (tool: ReaderTool) => {
    if (contextAnnotationId) onClearContextAnnotation?.();
    const isCurrentTool = activeAnnotationTool === tool;
    if (isCurrentTool && toolHasSettings(tool)) {
      setToolSettingsOpenFor((current) => (current === tool ? null : tool));
    } else {
      setToolSettingsOpenFor(null);
    }
    onSelectAnnotationTool(tool);
    if (tool !== 'cursor' && tool !== 'eraser') {
      onSelectAnnotationColor(toolColors[tool]);
    }
  };

  const handleSelectColor = (color: AnnotationColor) => {
    if (contextAnnotationId) {
      onUpdateContextAnnotationColor?.(contextAnnotationId, color);
      return;
    }
    setToolColors((prev) => ({ ...prev, [activeAnnotationTool]: color }));
    onSelectAnnotationColor(color);
  };

  const handleCustomColor = (value: string) => {
    const color = value as AnnotationColor;
    onCustomAnnotationColorChange(value);
    if (contextAnnotationId) {
      onUpdateContextAnnotationColor?.(contextAnnotationId, color);
      return;
    }
    setToolColors((prev) => ({ ...prev, [activeAnnotationTool]: color }));
    onSelectAnnotationColor(color);
  };

  const handlePageSubmit = () => {
    const nextPage = Math.max(1, Math.min(readerPageState.totalPages, Number(pageInput) || readerPageState.currentPage));
    setPageInput(String(nextPage));
    onJumpToPage(nextPage);
  };

  const optionsTool = contextAnnotationTool ?? toolSettingsOpenFor;
  const currentColor = contextAnnotationColor ?? toolColors[activeAnnotationTool] ?? activeAnnotationColor;
  const currentToolSettings = contextToolSettings ?? toolSettings;
  const handleToolSettingsChange = (settings: ReaderToolSettings) => {
    if (contextAnnotationId) {
      onUpdateContextAnnotationSettings?.(contextAnnotationId, settings);
      return;
    }
    onToolSettingsChange(settings);
  };

  return (
    <header
      className="reader-toolbar"
      data-reader-layer="toolbar"
      aria-label="Reader toolbar"
    >
      <div className="reader-toolbar-primary">
        <div className="reader-toolbar-group reader-toolbar-file">
          {contentMode === 'pdf' && <div className="segmented compact reader-file-switch" aria-label="PDF file mode">
            <button
              className={fileMode === 'source' ? 'active' : ''}
              type="button"
              onClick={() => onFileModeChange('source')}
              disabled={!paper.sourcePdf}
            >
              {zh.reader.sourcePdf}
            </button>
            <button
              className={fileMode === 'translated' ? 'active' : ''}
              type="button"
              onClick={() => onFileModeChange('translated')}
              disabled={!hasTranslatedPdf}
            >
              {zh.reader.translatedPdf}
            </button>
            <button
              className={fileMode === 'parallel' ? 'active' : ''}
              type="button"
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

      <div className="reader-toolbar-center">
        {contentMode === 'pdf' && <div className="reader-toolbar-group reader-toolbar-annotations">
          <div className="annotation-toolbar" aria-label="Annotation tools">
            {annotationTools.map((tool) => {
              const isContextual = contextAnnotationTool === tool.id;
              const toolColor = isContextual ? contextAnnotationColor ?? toolColors[tool.id] : toolColors[tool.id];
              const isActive = activeAnnotationTool === tool.id;
              return (
                <div key={tool.id} className="annotation-tool-slot">
                  <button
                    className={`annotation-tool-btn ${isActive ? 'active' : ''} ${isContextual ? 'contextual' : ''}`.trim()}
                    type="button"
                    onClick={() => handleSelectTool(tool.id)}
                    title={tool.label}
                    aria-pressed={isActive}
                    aria-expanded={optionsTool === tool.id}
                  >
                    <AnnotationToolIcon id={tool.id} />
                    {tool.id !== 'cursor' && tool.id !== 'eraser' && (
                      <span className="annotation-tool-color-dot" style={{ background: toolColorToCss(toolColor) }} />
                    )}
                  </button>
                  {optionsTool === tool.id && (
                    <ToolOptionsBar
                      tool={optionsTool}
                      toolSettings={currentToolSettings}
                      activeColor={currentColor}
                      customAnnotationColor={customAnnotationColor}
                      onSelectAnnotationColor={handleSelectColor}
                      onCustomAnnotationColorChange={handleCustomColor}
                      onToolSettingsChange={handleToolSettingsChange}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>}

        {contentMode === 'pdf' && <div className="reader-toolbar-group reader-toolbar-nav">
          <div className="zoom-controls" aria-label="Zoom controls">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(0.7, Number((zoom - 0.1).toFixed(2))))}
              title={zh.reader.zoomOut}
            >
              <ZoomOutIcon />
            </button>
            <button type="button" className="zoom-pct-btn" onClick={() => onZoomChange(1)} title="Reset to 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={onFitWidth} title={zh.reader.fitWidth}>
              <FitWidthIcon />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))}
              title={zh.reader.zoomIn}
            >
              <ZoomInIcon />
            </button>
          </div>

          <div className="page-jump-shell" title={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}>
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={handlePageSubmit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handlePageSubmit();
              }}
              aria-label={zh.reader.pageStatus(readerPageState.currentPage, readerPageState.totalPages)}
            />
            <span>/ {readerPageState.totalPages}</span>
          </div>
        </div>}
      </div>

      <div className="reader-toolbar-end">
        {!sidePanelOpen && (
          <button
            className="reader-workspace-toggle"
            type="button"
            onClick={() => onSidePanelOpenChange(true)}
            title={zh.reader.openPanel}
            aria-label={zh.reader.openPanel}
            aria-pressed="false"
          >
            <SidebarIcon />
          </button>
        )}
      </div>
    </header>
  );
}

function ToolOptionsBar({
  tool,
  toolSettings,
  activeColor,
  customAnnotationColor,
  onSelectAnnotationColor,
  onCustomAnnotationColorChange,
  onToolSettingsChange,
}: {
  tool: ReaderTool;
  toolSettings: ReaderToolSettings;
  activeColor: AnnotationColor;
  customAnnotationColor: string;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  onCustomAnnotationColorChange: (color: string) => void;
  onToolSettingsChange: (settings: ReaderToolSettings) => void;
}) {
  if (!toolHasSettings(tool)) return null;

  const eraserThickness = clampNumber(toolSettings.eraserSize, ERASER_THICKNESS_MIN, ERASER_THICKNESS_MAX);

  return (
    <div className={`reader-tool-options-bar tool-options-${tool}`} onMouseDown={(event) => event.stopPropagation()}>
      {(tool === 'highlight' || tool === 'underline') && (
        <ToolColorPalette
          label={tool === 'highlight' ? '高亮颜色' : '下划线颜色'}
          value={activeColor}
          customColor={customAnnotationColor}
          onChange={(color) => onSelectAnnotationColor(color as AnnotationColor)}
          onCustomColorChange={onCustomAnnotationColorChange}
        />
      )}

      {tool === 'ink' && (
        <>
          <ThicknessOption
            label="画笔粗细"
            hint="悬停后滚轮可调粗细"
            value={toolSettings.inkStrokeWidth}
            min={INK_STROKE_MIN}
            max={INK_STROKE_MAX}
            step={0.5}
            onChange={(inkStrokeWidth) => onToolSettingsChange({ ...toolSettings, inkStrokeWidth })}
          />
          <ToolColorPalette
            label="画笔颜色"
            value={activeColor}
            customColor={customAnnotationColor}
            onChange={(color) => onSelectAnnotationColor(color as AnnotationColor)}
            onCustomColorChange={onCustomAnnotationColorChange}
          />
        </>
      )}

      {tool === 'eraser' && (
        <>
          <div className="tool-option-block" onWheel={(event) => adjustSettingWithWheel(event, eraserThickness, ERASER_THICKNESS_MIN, ERASER_THICKNESS_MAX, 2, (eraserSize) => onToolSettingsChange({ ...toolSettings, eraserSize }))}>
            <span className="tool-option-label">橡皮粗细</span>
            <input
              className="annotation-tool-range"
              type="range"
              min={ERASER_THICKNESS_MIN}
              max={ERASER_THICKNESS_MAX}
              step={2}
              value={eraserThickness}
              style={{ '--range-progress': rangeProgress(toolSettings.eraserSize, ERASER_THICKNESS_MIN, ERASER_THICKNESS_MAX) } as CSSProperties}
              onChange={(event) => onToolSettingsChange({ ...toolSettings, eraserSize: Number(event.target.value) })}
            />
            <span className="tool-option-value">{eraserThickness}</span>
            <span className="tool-option-hint">滚轮调整擦除范围</span>
          </div>
          <div className="tool-option-block compact">
            <span className="tool-option-label">擦除形状</span>
            <div className="tool-option-segmented">
              <button
                type="button"
                className={toolSettings.eraserShape === 'round' ? 'active' : ''}
                aria-label="圆形橡皮"
                title="圆形橡皮"
                onClick={() => onToolSettingsChange({ ...toolSettings, eraserShape: 'round' })}
              >
                <span className={`eraser-shape-icon round ${toolSettings.eraserShape === 'round' ? 'active' : ''}`.trim()} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={toolSettings.eraserShape === 'square' ? 'active' : ''}
                aria-label="方形橡皮"
                title="方形橡皮"
                onClick={() => onToolSettingsChange({ ...toolSettings, eraserShape: 'square' })}
              >
                <span className={`eraser-shape-icon square ${toolSettings.eraserShape === 'square' ? 'active' : ''}`.trim()} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}

      {tool === 'arrow' && (
        <>
          <ThicknessOption
            label="箭头粗细"
            hint="悬停后滚轮可调线宽"
            value={toolSettings.arrowStrokeWidth}
            min={ARROW_STROKE_MIN}
            max={ARROW_STROKE_MAX}
            step={0.2}
            onChange={(arrowStrokeWidth) => onToolSettingsChange({ ...toolSettings, arrowStrokeWidth })}
          />
          <div className="tool-option-block">
            <span className="tool-option-label">箭头样式</span>
            <div className="tool-option-segmented arrow-style-picker">
              <button
                type="button"
                className={toolSettings.arrowStyle === 'solid' ? 'active' : ''}
                title="实线箭头"
                onClick={() => onToolSettingsChange({ ...toolSettings, arrowStyle: 'solid' })}
              >
                <LineStylePreview kind="solid" />
                <span>实线</span>
              </button>
              <button
                type="button"
                className={toolSettings.arrowStyle === 'dashed' ? 'active' : ''}
                title="虚线箭头"
                onClick={() => onToolSettingsChange({ ...toolSettings, arrowStyle: 'dashed' })}
              >
                <LineStylePreview kind="dashed" />
                <span>虚线</span>
              </button>
              <button
                type="button"
                className={toolSettings.arrowStyle === 'double' ? 'active' : ''}
                title="双向箭头"
                onClick={() => onToolSettingsChange({ ...toolSettings, arrowStyle: 'double' })}
              >
                <LineStylePreview kind="double" />
                <span>双向</span>
              </button>
            </div>
          </div>
          <div className="tool-option-block compact">
            <span className="tool-option-label">端点</span>
            <div className="tool-option-segmented">
              <button
                type="button"
                className={toolSettings.arrowEnding === 'arrow' ? 'active' : ''}
                title="绘制箭头"
                onClick={() => onToolSettingsChange({ ...toolSettings, arrowEnding: 'arrow' })}
              >
                <LineStylePreview kind="arrow" />
                <span>箭头</span>
              </button>
              <button
                type="button"
                className={toolSettings.arrowEnding === 'line' ? 'active' : ''}
                title="绘制无箭头横线"
                onClick={() => onToolSettingsChange({ ...toolSettings, arrowEnding: 'line' })}
              >
                <LineStylePreview kind="line" />
                <span>横线</span>
              </button>
            </div>
          </div>
          <ToolColorPalette
            label="箭头颜色"
            value={activeColor}
            customColor={customAnnotationColor}
            onChange={(color) => onSelectAnnotationColor(color as AnnotationColor)}
            onCustomColorChange={onCustomAnnotationColorChange}
          />
        </>
      )}

      {tool === 'text' && (
        <>
          <div className="tool-option-block compact">
            <span className="tool-option-label">文字样式</span>
            <div className="tool-option-segmented text-style-picker">
              <button
                type="button"
                className={toolSettings.textBold ? 'active' : ''}
                title="加粗文字"
                onClick={() => onToolSettingsChange({ ...toolSettings, textBold: !toolSettings.textBold })}
              >
                B
              </button>
              <button
                type="button"
                className={toolSettings.textItalic ? 'active' : ''}
                title="倾斜文字"
                onClick={() => onToolSettingsChange({ ...toolSettings, textItalic: !toolSettings.textItalic })}
              >
                I
              </button>
              <button
                type="button"
                className={toolSettings.textBorderColor !== 'transparent' ? 'active' : ''}
                title="文字外框"
                aria-label="文字外框"
                onClick={() =>
                  onToolSettingsChange({
                    ...toolSettings,
                    textBorderColor: toolSettings.textBorderColor === 'transparent' ? '#ffffff' : 'transparent',
                  })
                }
              >
                <span className="text-outline-preview" aria-hidden="true">T</span>
              </button>
            </div>
            <span className="tool-option-hint">点击页面创建文本标记</span>
          </div>
          <div className="tool-option-block compact text-size-option">
            <span className="tool-option-label">字号</span>
            <select
              value={toolSettings.textFontSize}
              onChange={(event) => onToolSettingsChange({ ...toolSettings, textFontSize: Number(event.target.value) })}
              aria-label="文本字号"
            >
              {[12, 13, 14, 16, 18, 20, 24].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <ToolColorPalette
            label="文字颜色"
            value={toolSettings.textColor}
            customColor={toolSettings.textColor}
            onChange={(textColor) => onToolSettingsChange({ ...toolSettings, textColor })}
            onCustomColorChange={(textColor) => onToolSettingsChange({ ...toolSettings, textColor })}
          />
          <ToolColorPalette
            label="外边框"
            value={toolSettings.textBorderColor}
            customColor={toolSettings.textBorderColor === 'transparent' ? '#ffffff' : toolSettings.textBorderColor}
            onChange={(textBorderColor) => onToolSettingsChange({ ...toolSettings, textBorderColor })}
            onCustomColorChange={(textBorderColor) => onToolSettingsChange({ ...toolSettings, textBorderColor })}
          />
          <ToolColorPalette
            label="背景"
            value={toolSettings.textBackgroundColor}
            customColor={toolSettings.textBackgroundColor === 'transparent' ? '#ffffff' : toolSettings.textBackgroundColor}
            allowTransparent
            onChange={(textBackgroundColor) => onToolSettingsChange({ ...toolSettings, textBackgroundColor })}
            onCustomColorChange={(textBackgroundColor) => onToolSettingsChange({ ...toolSettings, textBackgroundColor })}
          />
        </>
      )}

      {tool === 'rect' && (
        <>
          <div className="tool-option-block compact">
            <span className="tool-option-label">图形</span>
            <div className="tool-option-segmented">
              <button
                type="button"
                className={toolSettings.shapeKind === 'rect' ? 'active' : ''}
                title="矩形"
                onClick={() => onToolSettingsChange({ ...toolSettings, shapeKind: 'rect' })}
              >
                <ShapePreview kind="rect" />
                <span>矩形</span>
              </button>
              <button
                type="button"
                className={toolSettings.shapeKind === 'ellipse' ? 'active' : ''}
                title="椭圆"
                onClick={() => onToolSettingsChange({ ...toolSettings, shapeKind: 'ellipse' })}
              >
                <ShapePreview kind="ellipse" />
                <span>椭圆</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            className={`tool-option-chip ${toolSettings.shapeFillEnabled ? 'active' : ''}`.trim()}
            title="切换是否填充图形颜色"
            onClick={() => onToolSettingsChange({ ...toolSettings, shapeFillEnabled: !toolSettings.shapeFillEnabled })}
          >
            <span className="tool-option-chip-icon fill-preview" />
            {toolSettings.shapeFillEnabled ? '填充开启' : '仅描边'}
          </button>
          <ThicknessOption
            label="线条粗细"
            hint="悬停后滚轮可调线宽"
            value={toolSettings.shapeStrokeWidth}
            min={SHAPE_STROKE_MIN}
            max={SHAPE_STROKE_MAX}
            step={0.2}
            onChange={(shapeStrokeWidth) => onToolSettingsChange({ ...toolSettings, shapeStrokeWidth })}
          />
          <ToolColorPalette
            label="图形颜色"
            value={activeColor}
            customColor={customAnnotationColor}
            onChange={(color) => onSelectAnnotationColor(color as AnnotationColor)}
            onCustomColorChange={onCustomAnnotationColorChange}
          />
        </>
      )}
    </div>
  );
}

function ThicknessOption({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const nextValue = clampNumber(value, min, max);
  return (
    <div className="tool-option-block thickness-option" onWheel={(event) => adjustSettingWithWheel(event, nextValue, min, max, step, onChange)} title={hint}>
      <span className="tool-option-label">{label}</span>
      <div className="thickness-preview" style={{ '--preview-stroke-width': nextValue } as CSSProperties}>
        <span />
      </div>
      <input
        className="annotation-tool-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={nextValue}
        style={{ '--range-progress': rangeProgress(nextValue, min, max) } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="tool-option-value">{formatNumber(nextValue)}</span>
      <span className="tool-option-hint">{hint}</span>
    </div>
  );
}

function ToolColorPalette({
  label,
  value,
  customColor,
  allowTransparent,
  onChange,
  onCustomColorChange,
}: {
  label: string;
  value: string;
  customColor: string;
  allowTransparent?: boolean;
  onChange: (color: string) => void;
  onCustomColorChange: (color: string) => void;
}) {
  const inputValue = annotationColorInputValue(value === 'transparent' ? customColor : value);
  return (
    <div className={`tool-option-color-group ${allowTransparent ? 'with-transparent-toggle' : ''}`.trim()} aria-label={label}>
      <span className="tool-option-label">{label}</span>
      {allowTransparent && (
        <label className="tool-option-transparent-toggle" title="无背景">
          <input
            type="checkbox"
            checked={value === 'transparent'}
            onChange={(event) => onChange(event.target.checked ? 'transparent' : inputValue)}
          />
          <span>无背景</span>
        </label>
      )}
      <label className="tool-option-color-custom" title={`${label}：自定义颜色`}>
        <input
          type="color"
          value={inputValue}
          onChange={(event) => {
            onCustomColorChange(event.target.value);
            onChange(event.target.value);
          }}
        />
        <span style={{ background: inputValue }} />
      </label>
      <div className="tool-option-color-presets">
        {toolColorPresets.map((color) => (
          <button
            key={color}
            type="button"
            className={value === color ? 'active' : ''}
            style={{ background: color }}
            title={color}
            aria-label={color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

function toolHasSettings(tool: ReaderTool) {
  return tool === 'highlight' || tool === 'underline' || tool === 'ink' || tool === 'eraser' || tool === 'arrow' || tool === 'text' || tool === 'rect';
}

function LineStylePreview({ kind }: { kind: 'solid' | 'dashed' | 'double' | 'arrow' | 'line' }) {
  const marker = kind === 'arrow' || kind === 'double';
  return (
    <svg className={`line-style-preview ${kind}`} viewBox="0 0 42 16" aria-hidden="true">
      <path d={kind === 'dashed' ? 'M5 8h8m5 0h8m5 0h6' : 'M5 8h30'} />
      {marker && <path d="M31 4l5 4-5 4" />}
      {kind === 'double' && <path d="M10 4 5 8l5 4" />}
    </svg>
  );
}

function ShapePreview({ kind }: { kind: 'rect' | 'ellipse' }) {
  return <span className={`shape-preview ${kind}`} aria-hidden="true" />;
}

function adjustSettingWithWheel(
  event: ReactWheelEvent<HTMLElement>,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const nextValue = clampNumber(Number((value + direction * step).toFixed(2)), min, max);
  onChange(nextValue);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rangeProgress(value: number, min: number, max: number) {
  const ratio = (clampNumber(value, min, max) - min) / (max - min);
  return `${(ratio * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function toolColorToCss(color: AnnotationColor): string {
  if (color.startsWith('#')) return color;
  const map: Record<string, string> = {
    yellow: 'rgba(255,229,121,.96)',
    green: 'rgba(100,180,130,.9)',
    blue: 'rgba(92,142,219,.92)',
    purple: 'rgba(151,112,219,.9)',
  };
  return map[color] ?? '#f2c94c';
}
