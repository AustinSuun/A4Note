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
  // Selection rectangles carry the glyph box including ascent/descent padding.
  // A band that spans the full box looks like a solid slab over the line and
  // visually collides with the rows above and below, so trim a proportional
  // share from both edges and keep the band centred on the x-height.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const topInset = Math.max(height * 0.28, 0.02);
  const bottomInset = Math.max(height * 0.18, 0.015);
  const band = Math.max(height - topInset - bottomInset, height * 0.5);
  return {
    left: `${x}%`,
    top: `${y + topInset}%`,
    width: `${width}%`,
    height: `${band}%`,
  };
}

export function underlinePositionStyle(position: PositionJson) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  // `height` is the full glyph box: the baseline sits above its bottom edge by
  // the descender. Drawing at `y + height` therefore lands inside the descent
  // of the same row and the rule crosses g/y/p. Clear the descender first, then
  // add a small gap so the rule sits under the glyphs without touching the next
  // line. The stroke also scales with the run height instead of a flat 1px.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const lineHeight = Math.min(Math.max(height * 0.08, 0.05), 0.42);
  const descender = height * 0.2;
  const baselineGap = Math.min(Math.max(height * 0.08, 0.02), 0.12);
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
