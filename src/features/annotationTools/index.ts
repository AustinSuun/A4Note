/**
 * Annotation tools shared by the PDF reader and the whiteboard (task 97fcfb6c):
 * one icon set, one colour palette, one option panel per tool, one settings store.
 * Hosts keep their own active tool; everything else about a tool is defined here.
 */
export { AnnotationToolIcon } from './AnnotationToolIcon';
export { AnnotationToolPopover } from './AnnotationToolPopover';
export { ToolColorPalette } from './ToolOptionsBar';
export { ToolOptionsBar } from './ToolOptionsBar';
export {
  ARROW_STROKE_MAX, ARROW_STROKE_MIN, ERASER_THICKNESS_MAX, ERASER_THICKNESS_MIN, INK_STROKE_MAX, INK_STROKE_MIN, SHAPE_STROKE_MAX, SHAPE_STROKE_MIN,
  annotationColorInputValue, annotationTools, defaultToolColors, toolColorPresets, toolColorToCss, toolHasSettings,
} from './constants';
export {
  ANNOTATION_TOOL_COLORS_STORAGE_KEY, ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, annotationToolStore, createAnnotationToolStore, defaultAnnotationToolSettings,
  isPresetColorName, loadAnnotationToolSettings, loadSharedToolColors, normalizeStoredAnnotationToolSettings, normalizeStoredToolColors, saveAnnotationToolSettings,
  saveSharedToolColors, useSharedAnnotationToolSettings, useSharedToolColors,
} from './toolSettings';
export type { AnnotationToolSettings, AnnotationToolStore, ArrowEnding, ArrowStyle, EraserShape, ShapeKind, SharedColorTool, SharedToolColors } from './toolSettings';
