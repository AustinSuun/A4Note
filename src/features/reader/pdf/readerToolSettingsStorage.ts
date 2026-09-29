/**
 * Compatibility shim (task 97fcfb6c): the reader's tool-settings persistence moved into the
 * shared annotation store (`src/features/annotationTools/toolSettings.ts`) so the whiteboard
 * and the PDF reader read and write the same values under the same historical storage key.
 */
export {
  ANNOTATION_TOOL_SETTINGS_STORAGE_KEY as READER_TOOL_SETTINGS_STORAGE_KEY,
  loadAnnotationToolSettings as loadReaderToolSettings,
  normalizeStoredAnnotationToolSettings as normalizeStoredReaderToolSettings,
  saveAnnotationToolSettings as saveReaderToolSettings,
} from '../../annotationTools';
