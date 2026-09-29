import type { CSSProperties, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import type { AnnotationColor, ReaderTool } from '../../core/types';
import {
  ARROW_STROKE_MAX, ARROW_STROKE_MIN, ERASER_THICKNESS_MAX, ERASER_THICKNESS_MIN, INK_STROKE_MAX, INK_STROKE_MIN, SHAPE_STROKE_MAX, SHAPE_STROKE_MIN,
  annotationColorInputValue, toolColorPresets, toolHasSettings,
} from './constants';
import type { AnnotationToolSettings } from './toolSettings';

/**
 * Option panel body for one annotation tool. Rendered inside `AnnotationToolPopover` by
 * the PDF reader toolbar and by the whiteboard toolbar, so both hosts show the same
 * controls, ranges, swatches and copy for the same tool.
 */
export function ToolOptionsBar({
  tool,
  toolSettings,
  activeColor,
  customAnnotationColor,
  onSelectAnnotationColor,
  onCustomAnnotationColorChange,
  onToolSettingsChange,
  highlightAppearance,
  hint,
}: {
  tool: ReaderTool;
  toolSettings: AnnotationToolSettings;
  activeColor: AnnotationColor;
  customAnnotationColor: string;
  onSelectAnnotationColor: (color: AnnotationColor) => void;
  onCustomAnnotationColorChange: (color: string) => void;
  onToolSettingsChange: (settings: AnnotationToolSettings) => void;
  /** Reader-only block (highlight opacity/blend); the board has no highlight tool. */
  highlightAppearance?: ReactNode;
  /** Host-specific one-line hint; defaults to the reader wording. */
  hint?: string;
}) {
  if (!toolHasSettings(tool)) return null;

  const eraserThickness = clampNumber(toolSettings.eraserSize, ERASER_THICKNESS_MIN, ERASER_THICKNESS_MAX);

  return (
    <div className={`reader-tool-options-bar tool-options-${tool}`} onMouseDown={(event) => event.stopPropagation()}>
      <small className="tool-option-hint">{hint ?? (tool === 'eraser' ? '仅擦除手写笔迹；其他标注请选中后删除。' : tool === 'highlight' || tool === 'underline' ? '拖选 PDF 文字后应用；扫描图片需要先有可选文字层。' : '设置应用于当前工具，选中已有标注时修改该标注。')}</small>
      {(tool === 'highlight' || tool === 'underline') && (
        <ToolColorPalette
          label={tool === 'highlight' ? '高亮颜色' : '下划线颜色'}
          value={activeColor}
          customColor={customAnnotationColor}
          onChange={(color) => onSelectAnnotationColor(color as AnnotationColor)}
          onCustomColorChange={onCustomAnnotationColorChange}
        />
      )}

      {tool === 'highlight' && highlightAppearance}

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
              aria-label="橡皮粗细"
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
            step={0.1}
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
            </div>
            <span className="tool-option-hint">点击页面后直接输入；Esc 或点击外部完成，框随文字扩展</span>
          </div>
          <ToolColorPalette
            label="文字颜色"
            value={toolSettings.textColor}
            customColor={toolSettings.textColor}
            onChange={(textColor) => onToolSettingsChange({ ...toolSettings, textColor })}
            onCustomColorChange={(textColor) => onToolSettingsChange({ ...toolSettings, textColor })}
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
        aria-label={label}
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

export function ToolColorPalette({
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
      <div className="tool-option-color-heading">
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
      </div>
      <div className="tool-option-color-row">
        <label className="tool-option-color-custom" title={`${label}：自定义颜色`}>
          <input
            type="color"
            aria-label={`${label}：自定义颜色`}
            value={inputValue}
            onChange={(event) => {
              onCustomColorChange(event.target.value);
            }}
          />
          <span style={{ background: inputValue }} />
        </label>
        <div className="tool-option-color-presets">
          {toolColorPresets.map((color) => (
            <button
              key={color}
              type="button"
              className={inputValue.toLowerCase() === color.toLowerCase() && value !== 'transparent' ? 'active' : ''}
              aria-pressed={inputValue.toLowerCase() === color.toLowerCase() && value !== 'transparent'}
              style={{ background: color }}
              title={color}
              aria-label={color}
              onClick={() => onChange(color)}
            />
          ))}
        </div>
      </div>
    </div>
  );
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
