import type { AnnotationColor, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';

export const annotationPresetColors = ['yellow', 'green', 'blue', 'purple'] as const;

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

export function annotationColorInputValue(color: string) {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color === 'yellow') return '#ffe579';
  if (color === 'green') return '#56cc9d';
  if (color === 'blue') return '#5c8edb';
  if (color === 'purple') return '#9770db';
  return '#ffffff';
}

export const annotationTools: Array<{ id: ReaderTool; label: string }> = [
  { id: 'cursor',    label: zh.reader.cursor    },
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
