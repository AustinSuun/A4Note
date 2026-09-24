/** Database notes have no filesystem parent; this identity is never a disk path. */
export function paperNoteImageDocument(paperId: string, noteId: string): string {
  return `paper-note://${encodeURIComponent(paperId)}/${encodeURIComponent(noteId)}`;
}
export function paperImageReference(documentPath: string, source: string): { paperId: string; name: string } | null {
  const context = /^paper-note:\/\/([a-zA-Z0-9_-]+)\/[^/]+$/.exec(documentPath);
  const reference = /^summary-assets\/([a-zA-Z0-9][a-zA-Z0-9.-]{0,79}\.(?:png|jpe?g|webp))$/.exec(source.trim().replace(/^<|>$/g, ''));
  if (!context || !reference) return null;
  return { paperId: context[1], name: reference[1] };
}
