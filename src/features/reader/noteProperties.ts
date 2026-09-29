// Fold state of the reader note "笔记属性" panel, remembered per paper+note so
// the sidebar, floating and writing surfaces (which each mount their own panel
// over the same note session) agree, and so re-opening keeps the user's choice.
// Data itself never lives here: properties are the note's frontmatter.
const memory = new Map<string, boolean>();
const storageKey = (paperId: string, noteId: string) => `a4note.reader-note.properties-open:${encodeURIComponent(paperId)}:${encodeURIComponent(noteId)}`;

export function notePropertiesFold(paperId: string, noteId: string, fallback: boolean) {
  const key = storageKey(paperId, noteId);
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    const stored = localStorage.getItem(key);
    if (stored === '1' || stored === '0') { memory.set(key, stored === '1'); return stored === '1'; }
  } catch { /* storage is optional */ }
  return fallback;
}

export function rememberNotePropertiesFold(paperId: string, noteId: string, open: boolean) {
  const key = storageKey(paperId, noteId);
  memory.set(key, open);
  try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* storage is optional */ }
}
