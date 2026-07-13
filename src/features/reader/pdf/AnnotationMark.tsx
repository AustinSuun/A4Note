import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { AnnotationColor, PositionJson } from '../../../core/types';
import { zh } from '../../../ui/zh';
import { annotationColorInputValue, toolColorPresets } from '../readerConstants';
import {
  annotationCustomColorStyle,
  annotationSegments,
  highlightPositionStyle,
  positionStyle,
  underlinePositionStyle,
} from './pdfAnnotationHelpers';
import { numberValue } from './pdfGeometry';
import type { AnnotationMarkModel, AnnotationResizeHandle } from './types';

const resizeHandles: AnnotationResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function AnnotationMark({
  annotation,
  draft,
  onSelectAnnotation,
  onBeginStickyDrag,
  onBeginAnnotationResize,
  onEditStickyAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  focused,
  eraserActive,
}: {
  annotation: AnnotationMarkModel;
  draft?: boolean;
  onSelectAnnotation?: (annotationId: string) => void;
  onBeginStickyDrag?: (annotationId: string, pageNumber: number, event: MouseEvent<HTMLDivElement>) => void;
  onBeginAnnotationResize?: (annotationId: string, pageNumber: number, handle: AnnotationResizeHandle, event: MouseEvent<HTMLElement>) => void;
  onEditStickyAnnotation?: (annotation: AnnotationMarkModel, event: MouseEvent<HTMLElement>) => void;
  onUpdateAnnotationColor?: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation?: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote?: (annotationId: string) => void;
  focused?: boolean;
  eraserActive?: boolean;
}) {
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const segments = annotationSegments(annotation.positionJson);
  const annotationId = annotation.id;
  const isTextBox = annotation.type === 'comment' || annotation.type === 'text';
  const isMovable = isTextBox || annotation.type === 'rect';
  const isResizable = annotation.type === 'rect' || annotation.type === 'text';
  const customColorStyle = annotation.color.startsWith('#') ? annotationCustomColorStyle(annotation.type, annotation.color) : undefined;

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!annotation.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (isMovable && !eraserActive) {
      onBeginStickyDrag?.(annotation.id, annotation.page, event);
    }
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!annotation.id) return;
    event.preventDefault();
    if (!isMovable) {
      event.stopPropagation();
    }
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!annotation.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (eraserActive) {
      if (annotation.type !== 'ink') return;
      void onDeleteAnnotation?.(annotation.id);
      return;
    }
    onSelectAnnotation?.(annotation.id);
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!annotation.id || !isTextBox || draft || eraserActive) return;
    event.preventDefault();
    event.stopPropagation();
    onEditStickyAnnotation?.(annotation, event);
  };

  const inlineActions =
    focused && annotationId && !draft ? (
      <div className="annotation-inline-actions">
        {isTextBox && (
          <button
            type="button"
            title={zh.reader.noteEdit}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditStickyAnnotation?.(annotation, event);
            }}
          >
            <EditIcon />
          </button>
        )}
        <button
          type="button"
          title={zh.reader.appendAnnotationToNote}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAppendAnnotationToNote?.(annotationId);
          }}
        >
          <QuoteIcon />
        </button>
        <button
          type="button"
          title={zh.reader.deleteAnnotation}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectAnnotation?.(annotationId);
            void onDeleteAnnotation?.(annotationId);
          }}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className="annotation-color-pill"
          style={{ background: colorToCss(annotation.color) }}
          title="选择颜色"
          aria-expanded={colorPaletteOpen}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setColorPaletteOpen((current) => !current);
          }}
        >
          <ColorSwatchIcon color={colorToCss(annotation.color)} />
        </button>
        {colorPaletteOpen && (
          <div className="annotation-color-palette" onClick={(event) => event.stopPropagation()}>
            <span className="annotation-color-palette-label">标注颜色</span>
            <label className="annotation-color-custom-choice" title="自定义颜色">
              <input
                type="color"
                value={annotationColorInputValue(annotation.color)}
                onChange={(event) => {
                  void onUpdateAnnotationColor?.(annotationId, event.target.value as AnnotationColor);
                  setColorPaletteOpen(false);
                }}
              />
              <span style={{ background: annotationColorInputValue(annotation.color) }} />
            </label>
            <div className="annotation-color-presets">
              {toolColorPresets.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={annotationColorInputValue(annotation.color) === color ? 'active' : ''}
                  style={{ background: color }}
                  title={color}
                  aria-label={color}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onUpdateAnnotationColor?.(annotationId, color);
                    setColorPaletteOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null;

  const resizeControls =
    focused && annotationId && !draft && !eraserActive && isResizable ? (
      <div className="annotation-resize-controls" aria-label="调整标注大小">
        {resizeHandles.map((handle) => (
          <button
            key={handle}
            type="button"
            className={`annotation-resize-handle ${handle}`}
            aria-label={`从${handle}方向调整大小`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onBeginAnnotationResize?.(annotationId, annotation.page, handle, event);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        ))}
      </div>
    ) : null;

  if (annotation.type === 'ink') {
    return (
      <div
        className={`annotation-mark ink ${annotation.color} ${draft ? 'draft' : ''} ${focused ? 'focused' : ''}`}
        title={annotation.comment || annotation.quote}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        style={{ ...positionStyle(annotation.positionJson), ...vectorColorStyle(annotation.color), ...strokeWidthStyle(annotation.positionJson) }}
      >
        <svg className="annotation-vector annotation-ink-vector" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {inkPointSegments(annotation.positionJson).map((segment, index) => (
            <polyline key={index} points={localPointString(annotation.positionJson, segment)} />
          ))}
        </svg>
        {inlineActions}
      </div>
    );
  }

  if (annotation.type === 'arrow') {
    const arrow = arrowLine(annotation.positionJson);
    const arrowStyle = arrowStyleFromPosition(annotation.positionJson);
    const arrowEnding = arrowEndingFromPosition(annotation.positionJson);
    const arrowStrokeWidth = Math.max(numberValue(annotation.positionJson.strokeWidth, 3.4), 1);
    const arrowHeadSize = Math.min(Math.max(arrowStrokeWidth * 2 + 8, 11), 26);
    const markerId = `arrow-head-${safeSvgId(annotation.id ?? 'draft')}`;
    return (
      <div
        className={`annotation-mark arrow ${annotation.color} ${draft ? 'draft' : ''} ${focused ? 'focused' : ''}`}
        title={annotation.comment || annotation.quote}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        style={{ ...positionStyle(annotation.positionJson), ...vectorColorStyle(annotation.color), ...strokeWidthStyle(annotation.positionJson) }}
      >
        <svg className={`annotation-vector annotation-arrow-vector arrow-style-${arrowStyle} arrow-ending-${arrowEnding}`} aria-hidden="true">
          <defs>
            <marker
              id={markerId}
              markerWidth={arrowHeadSize}
              markerHeight={arrowHeadSize}
              refX="10.5"
              refY="6"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
            >
              <path className="annotation-arrow-head" d="M1.5 1.5 10.5 6 1.5 10.5" />
            </marker>
          </defs>
          <line
            x1={`${arrow.x1}%`}
            y1={`${arrow.y1}%`}
            x2={`${arrow.x2}%`}
            y2={`${arrow.y2}%`}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={arrowStyle === 'dashed' ? '7 5' : undefined}
            markerStart={arrowEnding === 'arrow' && arrowStyle === 'double' ? `url(#${markerId})` : undefined}
            markerEnd={arrowEnding === 'arrow' ? `url(#${markerId})` : undefined}
          />
        </svg>
        {inlineActions}
      </div>
    );
  }

  return (
    <>
      {segments.map((segment, index) => (
        <div
          key={`${annotation.id ?? annotation.quote}-${index}`}
          className={`annotation-mark ${annotation.type} ${annotation.color} ${annotation.type === 'rect' ? `${shapeKindFromPosition(annotation.positionJson)} ${Boolean(annotation.positionJson.fillEnabled) ? 'filled' : 'outline'}` : ''} ${draft ? 'draft' : ''} ${focused ? 'focused' : ''}`.trim()}
          title={annotation.comment || annotation.quote}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          style={
            annotation.type === 'underline'
              ? { ...underlinePositionStyle(segment), ...customColorStyle }
              : annotation.type === 'highlight'
                ? { ...highlightPositionStyle(segment), ...customColorStyle }
                : annotation.type === 'rect'
                  ? { ...positionStyle(segment), ...shapeVisualStyle(annotation.positionJson, annotation.color) }
                  : annotation.type === 'text'
                    ? { ...positionStyle(segment), ...textAnnotationVisualStyle(annotation.positionJson) }
                    : { ...positionStyle(segment), ...customColorStyle }
          }
        >
          {isTextBox && (
            <div
              className="sticky-note-content"
              style={{
                fontSize: `${numberValue(annotation.positionJson.fontSize, 13)}px`,
                fontWeight: Boolean(annotation.positionJson.bold) ? 700 : 500,
                fontStyle: Boolean(annotation.positionJson.italic) ? 'italic' : 'normal',
                color: String(annotation.positionJson.textColor ?? '#202822'),
              }}
            >
              {annotation.comment || annotation.quote || (annotation.type === 'text' ? zh.reader.textLabel : zh.reader.commentAnnotation)}
            </div>
          )}
          {index === 0 ? resizeControls : null}
          {index === 0 ? inlineActions : null}
        </div>
      ))}
    </>
  );
}

type InkPoint = { x: number; y: number };

function inkPointSegments(position: PositionJson) {
  const raw = position.points;
  if (!Array.isArray(raw)) return [];
  const segments: InkPoint[][] = [];
  let current: InkPoint[] = [];
  for (const rawPoint of raw) {
    const point = inkPointFromJson(rawPoint);
    if (!point) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function inkPointFromJson(point: unknown): InkPoint | null {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  const value = point as Record<string, unknown>;
  const x = numberValue(value.x, Number.NaN);
  const y = numberValue(value.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function localPointString(position: PositionJson, points: InkPoint[]) {
  const x = numberValue(position.x, 0);
  const y = numberValue(position.y, 0);
  const width = Math.max(numberValue(position.width, 1), 0.1);
  const height = Math.max(numberValue(position.height, 1), 0.1);
  return points
    .map((point) => `${((point.x - x) / width) * 100},${((point.y - y) / height) * 100}`)
    .join(' ');
}

function arrowLine(position: PositionJson) {
  const x = numberValue(position.x, 0);
  const y = numberValue(position.y, 0);
  const width = Math.max(numberValue(position.width, 1), 0.1);
  const height = Math.max(numberValue(position.height, 1), 0.1);
  const startX = numberValue(position.startX, x);
  const startY = numberValue(position.startY, y);
  const endX = numberValue(position.endX, x + width);
  const endY = numberValue(position.endY, y + height);
  return {
    x1: ((startX - x) / width) * 100,
    y1: ((startY - y) / height) * 100,
    x2: ((endX - x) / width) * 100,
    y2: ((endY - y) / height) * 100,
  };
}

function arrowStyleFromPosition(position: PositionJson) {
  const value = position.arrowStyle;
  return value === 'dashed' || value === 'double' ? value : 'solid';
}

function arrowEndingFromPosition(position: PositionJson) {
  return position.arrowEnding === 'line' ? 'line' : 'arrow';
}

function shapeKindFromPosition(position: PositionJson) {
  return position.shapeKind === 'ellipse' ? 'ellipse' : 'rect';
}

function shapeVisualStyle(position: PositionJson, color: string): CSSProperties {
  const stroke = colorToCss(color);
  const strokeWidth = Math.max(numberValue(position.strokeWidth, 2.4), 1);
  const fillEnabled = Boolean(position.fillEnabled);
  return {
    outline: `${strokeWidth}px solid ${stroke}`,
    background: fillEnabled ? colorWithAlpha(stroke, 0.18) : 'transparent',
  };
}

function textAnnotationVisualStyle(position: PositionJson): CSSProperties {
  const borderColor = String(position.borderColor ?? '#ffffff');
  const backgroundColor = String(position.backgroundColor ?? 'transparent');
  return {
    outline: `1.5px solid ${borderColor === 'transparent' ? 'rgba(255,255,255,.01)' : borderColor}`,
    background: backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
  };
}

function strokeWidthStyle(position: PositionJson): CSSProperties {
  const strokeWidth = numberValue(position.strokeWidth, 0);
  return strokeWidth > 0 ? ({ '--annotation-stroke-width': strokeWidth } as CSSProperties) : {};
}

function vectorColorStyle(color: string) {
  return { color: colorToCss(color) };
}

function colorToCss(color: string) {
  if (color.startsWith('#')) return color;
  if (color === 'yellow') return 'rgba(217,169,29,.95)';
  if (color === 'green') return 'rgba(66,146,95,.92)';
  if (color === 'blue') return 'rgba(72,126,205,.96)';
  if (color === 'purple') return 'rgba(133,94,198,.94)';
  return color;
}

function colorWithAlpha(color: string, alpha: number) {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const value = color.slice(1);
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }
  return color;
}

function safeSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h8M10 7V5h4v2M9 10v7M15 10v7M6 7l1 13h10l1-13" />
    </svg>
  );
}

function ColorSwatchIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill={color} stroke="none" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h5v5H9a4 4 0 0 1-4 4V9a2 2 0 0 1 2-2Zm10 0h5v5h-3a4 4 0 0 1-4 4V9a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4l10-10-4-4L5 15v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
