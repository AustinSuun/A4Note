import { Annotation, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

// Parent state can update the editor (for example after changing the document
// title or applying an external patch). Those transactions must not be
// reported back as user edits, otherwise the parent and CodeMirror can keep
// re-inserting the heading into each other.
export const externalDocumentSync = Annotation.define<boolean>();
/** Opening a note leaves CodeMirror's initial caret at line 1. The user never
 * chose that position, so live preview must not reveal syntax there (a first
 * line heading would open as `# Title`). Reveal is armed by the first real
 * selection or edit transaction — pointer/keyboard, typing, widget clicks, TOC
 * or search jumps — and disarmed when focus leaves the editor or an unfocused
 * editor receives a different document. Programmatic focus() alone does not
 * arm it; the first click, arrow key or keystroke does. */
export const setLiveRevealArmed = StateEffect.define<boolean>();
export const liveRevealArmed = StateField.define<boolean>({
  create: () => false,
  update(armed, transaction) {
    for (const effect of transaction.effects) if (effect.is(setLiveRevealArmed)) return effect.value;
    if ((transaction.selection || transaction.docChanged) && !transaction.annotation(externalDocumentSync)) return true;
    return armed;
  },
});
// focusout, not CodeMirror's contentDOM blur: image tools inputs and table
// action buttons are focusable inside the editor and must keep the revealed
// construct open. Window blur (relatedTarget null) still folds.
const liveRevealFocus = ViewPlugin.fromClass(class {
  constructor(private readonly view: EditorView) { view.dom.addEventListener('focusout', this.leave); }
  destroy() { this.view.dom.removeEventListener('focusout', this.leave); }
  private readonly leave = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && this.view.dom.contains(next)) return;
    if (this.view.state.field(liveRevealArmed, false)) this.view.dispatch({ effects: setLiveRevealArmed.of(false) });
  };
});
export const liveRevealGate = [liveRevealArmed, liveRevealFocus];
