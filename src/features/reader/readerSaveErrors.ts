const eventName = 'reader-annotation-save-error';
export function reportReaderSaveError(paperId: string, message: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { paperId, message } }));
}
export const readerSaveErrorEvent = eventName;
