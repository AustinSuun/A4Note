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
    // `width` runs from the far ascender edge to the baseline. Descenders therefore sit just
    // outside the box: on the left for top→bottom text (90), on the right for bottom→top (270).
    // Extend only that baseline edge so g/y/p/q/j-equivalents are painted without widening the
    // line on both sides or changing the persisted selection geometry.
    const glyphWidth = Math.max(width, 0.2);
    const descender = glyphWidth * TEXT_DESCENDER_RATIO;
    return {
      left: `${orientation === 90 ? x - descender : x}%`,
      top: `${y}%`,
      width: `${glyphWidth + descender}%`,
      height: `${numberValue(position.height, 5)}%`,
    };
  }
  // PDF.js gives us an ascent box whose bottom edge is the baseline, not a full ink box. Keep
  // that whole ascent box and add proportional descender space only on the baseline side. This
  // fixes the old 28%/18% trimming that ended the band above the baseline and clipped descenders.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const descender = height * TEXT_DESCENDER_RATIO;
  if (orientation === 180) {
    return { left: `${x}%`, top: `${y - descender}%`, width: `${width}%`, height: `${height + descender}%` };
  }
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}%`,
    height: `${height + descender}%`,
  };
}

export function underlinePositionStyle(position: PositionJson, thicknessOverride?: number) {
  const x = numberValue(position.x, 18);
  const y = numberValue(position.y, 28);
  const width = numberValue(position.width, 42);
  const orientation = segmentOrientation(position);
  if (orientation === 90 || orientation === 270) {
    // Rotated run: the baseline is the left edge for top→bottom text (90) and the right edge for
    // bottom→top text (270). Put the rule beyond that edge with a real gap; keeping it inside the
    // ascent box is what made the old rule cross the glyph body.
    const glyphWidth = Math.max(width, 0.2);
    const lineWidth = underlineThickness(glyphWidth, thicknessOverride);
    const baselineGap = underlineGap(glyphWidth);
    const left = orientation === 90
      ? x - baselineGap - lineWidth
      : x + glyphWidth + baselineGap;
    return { left: `${left}%`, top: `${y}%`, width: `${lineWidth}%`, height: `${numberValue(position.height, 5)}%` };
  }
  // Horizontal selection boxes end at the baseline. Return the rule's actual top edge (the CSS
  // no longer translates it upward), leaving 2–4% of the run height as breathing room.
  const height = Math.max(numberValue(position.height, 5), 0.2);
  const lineHeight = underlineThickness(height, thicknessOverride);
  const baselineGap = underlineGap(height);
  if (orientation === 180) {
    return { left: `${x}%`, top: `${y - baselineGap - lineHeight}%`, width: `${width}%`, height: `${lineHeight}%` };
  }
  return {
    left: `${x}%`,
    top: `${y + height + baselineGap}%`,
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
  return underlineThickness(median);
}

const TEXT_DESCENDER_RATIO = 0.2;

function underlineGap(axis: number) {
  return Math.min(Math.max(axis * 0.04, 0.02), 0.12);
}

function underlineThickness(axis: number, override?: number) {
  return override ?? Math.min(Math.max(axis * 0.08, 0.05), 0.42);
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
