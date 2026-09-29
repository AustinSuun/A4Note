export const annotationPresetColors = ['yellow', 'green', 'blue', 'purple'] as const;

// Task 97fcfb6c: the palette, per-tool colours, tool table and helpers are shared with the
// whiteboard through `src/features/annotationTools` – single source of truth, re-exported here
// for the reader's existing importers.
export { annotationColorInputValue, annotationTools, defaultToolColors, toolColorPresets, toolColorToCss, toolHasSettings } from '../annotationTools';

export type { AnnotationColor, ReaderTool } from '../../core/types';
