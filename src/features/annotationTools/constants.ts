import type { AnnotationColor, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';

/** Colour swatches shown in every tool popover (reader and board). */
export const toolColorPresets = [
  '#202822',
  '#6b746c',
  '#9b1c1c',
  '#d92d20',
  '#f97316',
  '#f2c94c',
  '#56cc9d',
  '#2eaadc',
  '#5c8edb',
  '#9770db',
  '#ffffff',
  '#e7ebe5',
  '#d9c8b4',
  '#f3a6a6',
  '#f7c58b',
  '#ffe579',
  '#b9e7c5',
  '#a7d8ef',
  '#b9cef7',
  '#cbb7ef',
] as const;

/** Named preset colours → hex used by `<input type="color">` and by SVG paint on the board. */
export function annotationColorInputValue(color: string) {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color === 'yellow') return '#ffd54a';
  if (color === 'green') return '#56cc9d';
  if (color === 'blue') return '#5c8edb';
  if (color === 'purple') return '#9770db';
  return '#ffffff';
}

/** Toolbar order and labels shared by both hosts (the board hides the PDF-only entries). */
export const annotationTools: Array<{ id: ReaderTool; label: string }> = [
  { id: 'cursor',    label: zh.reader.cursor    },
  { id: 'hand',      label: '手形拖动'           },
  { id: 'highlight', label: zh.reader.highlight },
  { id: 'underline', label: zh.reader.underline },
  { id: 'text',      label: zh.reader.textBox   },
  { id: 'ink',       label: zh.reader.ink       },
  { id: 'eraser',    label: zh.reader.eraser    },
  { id: 'rect',      label: '图形'              },
  { id: 'arrow',     label: zh.reader.arrow     },
];

/** 每个标注工具的默认颜色（互相独立，用户操作时各自记忆） */
export const defaultToolColors: Record<ReaderTool, AnnotationColor> = {
  cursor:    'yellow',
  hand:      'yellow',
  highlight: 'yellow',
  underline: 'blue',
  comment:   'yellow',
  text:      'green',
  ink:       'blue',
  eraser:    'yellow',
  area:      'purple',
  rect:      'purple',
  arrow:     'blue',
};

export function toolHasSettings(tool: ReaderTool) {
  return tool === 'highlight' || tool === 'underline' || tool === 'ink' || tool === 'eraser' || tool === 'arrow' || tool === 'text' || tool === 'rect';
}

/** CSS paint for the colour dot on a tool button. */
export function toolColorToCss(color: AnnotationColor | string): string {
  if (color.startsWith('#')) return color;
  const map: Record<string, string> = {
    yellow: 'rgba(255,229,121,.96)',
    green: 'rgba(100,180,130,.9)',
    blue: 'rgba(92,142,219,.92)',
    purple: 'rgba(151,112,219,.9)',
  };
  return map[color] ?? '#f2c94c';
}

export const ERASER_THICKNESS_MIN = 8;
export const ERASER_THICKNESS_MAX = 48;
export const INK_STROKE_MIN = 1.5;
export const INK_STROKE_MAX = 10;
export const ARROW_STROKE_MIN = 1.5;
export const ARROW_STROKE_MAX = 9;
export const SHAPE_STROKE_MIN = 1;
export const SHAPE_STROKE_MAX = 8;
