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
  const height = Math.max(numberValue(position.height, 5), 0.85);
  const inset = Math.min(Math.max(height * 0.22, 0.24), 0.76);
  return {
    left: `${x}%`,
    top: `${y + inset}%`,
    width: `${width}%`,
    height: `${Math.max(height - inset * 0.62, 0.68)}%`,
  };
}

export function underlinePositionStyle(position: PositionJson) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const height = Math.max(numberValue(position.height, 5), 0.7);
  const lineHeight = Math.min(Math.max(height * 0.14, 0.32), 0.72);
  const baselineTop = y + height + lineHeight * 0.15;
  return {
    left: `${x}%`,
    top: `${baselineTop}%`,
    width: `${width}%`,
    height: `${lineHeight}%`,
  };
}

export function annotationCustomColorStyle(type: AnnotationType, color: string) {
  if (type === 'underline' || type === 'ink' || type === 'arrow') {
    return { background: color };
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
      ? { ...position, height: Math.max(numberValue(position.height, 0), 0.9) }
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
