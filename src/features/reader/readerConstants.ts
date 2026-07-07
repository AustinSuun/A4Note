import type { ReaderLayout, ReaderTool } from '../../core/types';
import { zh } from '../../ui/zh';

export const annotationPresetColors = ['yellow', 'green', 'blue', 'purple'] as const;

export const layoutPresets: Array<{ id: ReaderLayout; label: string }> = [
  { id: 'focus', label: zh.reader.focusLayout },
  { id: 'note', label: zh.reader.noteLayout },
  { id: 'ai', label: zh.reader.aiLayout },
];

export const annotationTools: Array<{ id: ReaderTool; label: string }> = [
  { id: 'cursor', label: zh.reader.cursor },
  { id: 'highlight', label: zh.reader.highlight },
  { id: 'comment', label: zh.reader.comment },
  { id: 'underline', label: zh.reader.underline },
  { id: 'area', label: zh.reader.area },
];
