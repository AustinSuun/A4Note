import type { AnnotationColor, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';

export const annotationPresetColors = ['yellow', 'green', 'blue', 'purple'] as const;

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
