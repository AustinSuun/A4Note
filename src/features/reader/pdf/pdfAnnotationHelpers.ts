import type { AnnotationColor, AnnotationDraft, AnnotationType, PositionJson } from '../../../core/types';
import { zh } from '../../../ui/zh';
import { numberValue } from './pdfGeometry';

export function annotationSegments(position: PositionJson) {
  const maybeSegments = position.segments;
  return Array.isArray(maybeSegments) ? (maybeSegments as PositionJson[]) : [position];
}

export function positionStyle(position: PositionJson) {
  return {
    left: `${numberValue(position.x, 18)}%`,
    top: `${numberValue(position.y, 28)}%`,
    width: `${numberValue(position.width, 42)}%`,
    height: `${numberValue(position.height, 5)}%`,
  };
}

export function highlightPositionStyle(position: PositionJson) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const orientation = segmentOrientation(position);
  if (orientation === 90 || orientation === 270) {
    // Rotated run (page /Rotate 90/270): the glyph box's ascent axis is horizontal, so the
    // band is trimmed along x. Top→bottom text (90) has its ascender on the right edge,
    // bottom→top text (270) on the left edge; the same proportions as the horizontal case.
    const glyphWidth = Math.max(width, 0.2);
    const ascentInset = Math.max(glyphWidth * 0.28, 0.02);
    const descentInset = Math.max(glyphWidth * 0.18, 0.015);
    const band = Math.max(glyphWidth - ascentInset - descentInset, glyphWidth * 0.5);
    return {
      left: `${orientation === 90 ? x + descentInset : x + ascentInset}%`,
      top: `${y}%`,
      width: `${band}%`,
      height: `${numberValue(position.height, 5)}%`,
    };
  }
  // Selection rectangles carry the glyph box including ascent/descent padding.
  // A band that spans the full box looks like a solid slab over the line and
  // visually collides with the rows above and below, so trim a proportional
  // share from both edges and keep the band centred on the x-height.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const topInset = Math.max(height * 0.28, 0.02);
  const bottomInset = Math.max(height * 0.18, 0.015);
  const band = Math.max(height - topInset - bottomInset, height * 0.5);
  if (orientation === 180) {
    // Upside-down run: the ascender side is the bottom edge, so the descent inset goes on top.
    return { left: `${x}%`, top: `${y + bottomInset}%`, width: `${width}%`, height: `${band}%` };
  }
  return {
    left: `${x}%`,
    top: `${y + topInset}%`,
    width: `${width}%`,
    height: `${band}%`,
  };
}

export function underlinePositionStyle(position: PositionJson, thicknessOverride?: number) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const orientation = segmentOrientation(position);
  if (orientation === 90 || orientation === 270) {
    // Rotated run: the baseline is vertical and sits just inside the descender edge, i.e. the
    // left edge for top→bottom text (90) and the right edge for bottom→top text (270). The rule
    // is placed on the descender side of it, clamped into the glyph box; the stylesheet's
    // `.vertical-rule` variant keeps the element in place and draws it 2px wide.
    const glyphWidth = Math.max(width, 0.2);
    const lineWidth = thicknessOverride ?? Math.min(Math.max(glyphWidth * 0.08, 0.05), 0.42);
    const descender = glyphWidth * 0.2;
    const baselineGap = Math.min(Math.max(glyphWidth * 0.08, 0.02), 0.12);
    const left = orientation === 90
      ? Math.max(x + descender - baselineGap - lineWidth, x)
      : Math.min(x + glyphWidth - descender + baselineGap, x + glyphWidth - lineWidth);
    return { left: `${left}%`, top: `${y}%`, width: `${lineWidth}%`, height: `${numberValue(position.height, 5)}%` };
  }
  // `height` is the full glyph box: the baseline sits above its bottom edge by
  // the descender. Drawing at `y + height` therefore lands inside the descent
  // of the same row and the rule crosses g/y/p. Clear the descender first, then
  // add a small gap so the rule sits under the glyphs without touching the next
  // line. The stroke also scales with the run height instead of a flat 1px.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const lineHeight = thicknessOverride ?? Math.min(Math.max(height * 0.08, 0.05), 0.42);
  const descender = height * 0.2;
  const baselineGap = Math.min(Math.max(height * 0.08, 0.02), 0.12);
  if (orientation === 180) {
    // Upside-down run: the baseline sits just below the top edge, so the rule's bottom edge
    // moves up into the top descender slack (the stylesheet still lifts it by its own height).
    const ruleBottom = Math.max(y + descender - baselineGap, y + lineHeight);
    return { left: `${x}%`, top: `${ruleBottom}%`, width: `${width}%`, height: `${lineHeight}%` };
  }
  // `top` marks the rule's BOTTOM edge; `.annotation-mark.underline` lifts the
  // element by its own height. The stylesheet keeps a 1px minimum so a hairline
  // stays visible, and anchoring the bottom makes that clamp grow the rule
  // upwards into the descender slack.
  const ruleBottom = Math.min(y + height - descender + baselineGap + lineHeight, y + height);
  return {
    left: `${x}%`,
    top: `${ruleBottom}%`,
    width: `${width}%`,
    height: `${lineHeight}%`,
  };
}

/** One rule thickness for every segment of an annotation: the median glyph-box axis keeps
 * multi-line underlines even even when a single line box differs from the rest. */
export function underlineThicknessForSegments(segments: PositionJson[]): number | undefined {
  if (!segments.length) return undefined;
  const axes = segments
    .map((segment) => {
      const orientation = segmentOrientation(segment);
      const axis = orientation === 90 || orientation === 270 ? numberValue(segment.width, 0.2) : numberValue(segment.height, 0.2);
      return Math.max(axis, 0.2);
    })
    .sort((a, b) => a - b);
  const median = axes[Math.floor((axes.length - 1) / 2)];
  return Math.min(Math.max(median * 0.08, 0.05), 0.42);
}

/** Run direction stored on rotated selection segments (see pdfSelection.withSegmentOrientation). */
function segmentOrientation(position: PositionJson) {
  const value = position.orientation;
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

export function annotationCustomColorStyle(type: AnnotationType, color: string) {
  if (type === 'underline' || type === 'ink' || type === 'arrow') {
    return { background: color };
  }
  if (type === 'highlight') {
    return { background: `${color}73`, mixBlendMode: 'multiply' as const };
  }
  if (type === 'area' || type === 'rect' || type === 'text') {
    return { outlineColor: color, background: `${color}2a` };
  }
  if (type === 'comment') {
    return { background: color };
  }
  return { background: `${color}b8` };
}

export function buildAnnotationDraft(type: AnnotationType, position: PositionJson, color: AnnotationColor = annotationColor(type)): AnnotationDraft {
  const finalPosition =
    type === 'underline'
      ? { ...position, height: Math.max(numberValue(position.height, 0), 0.2) }
      : type === 'comment' || type === 'text'
        ? { ...position, width: numberValue(position.width, 18), height: numberValue(position.height, 8) }
        : position;
  return {
    type,
    quote: annotationLabel(type),
    comment: type === 'comment' ? zh.reader.commentAnnotation : '',
    color,
    positionJson: finalPosition,
  };
}

export function annotationColor(type: AnnotationType): AnnotationColor {
  if (type === 'comment') return 'green';
  if (type === 'underline') return 'blue';
  if (type === 'area' || type === 'rect') return 'purple';
  if (type === 'text') return 'green';
  if (type === 'ink' || type === 'arrow') return 'blue';
  return 'yellow';
}

export function nextAnnotationColor(color: AnnotationColor): AnnotationColor {
  if (color === 'yellow') return 'green';
  if (color === 'green') return 'blue';
  if (color === 'blue') return 'purple';
  return 'yellow';
}

export function annotationLabel(type: AnnotationType) {
  if (type === 'comment') return zh.reader.commentLabel;
  if (type === 'underline') return zh.reader.underlineLabel;
  if (type === 'area') return zh.reader.areaLabel;
  if (type === 'text') return zh.reader.textLabel;
  if (type === 'ink') return zh.reader.inkLabel;
  if (type === 'rect') return zh.reader.rectLabel;
  if (type === 'arrow') return zh.reader.arrowLabel;
  return zh.reader.highlightLabel;
}
