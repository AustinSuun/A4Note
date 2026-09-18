import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { markdownCaretScrollDelta, markdownScrollHost, observeMarkdownEndSpace } from '../../shared/markdown/markdownScrollSpace';

/** Follow deliberate keyboard edits, not reading-wheel scrolling or external document sync. */
export const markdownCaretComfort = ViewPlugin.fromClass(class {
  viewport: HTMLElement;
  dispose: () => void = () => {};
  destroyed = false;
  constructor(readonly view: EditorView) {
    this.viewport = view.scrollDOM;
    // CM mounts its theme after plugin construction. Resolve overflow only after layout.
    view.requestMeasure({
      read: () => markdownScrollHost(view.scrollDOM),
      write: viewport => {
        if (this.destroyed) return;
        this.viewport = viewport;
        this.dispose = observeMarkdownEndSpace(view.dom, viewport, () => view.requestMeasure());
      },
    });
  }
  update(update: ViewUpdate) {
    if (!update.view.hasFocus || !update.state.selection.main.empty) return;
    const keyboard = update.transactions.some(transaction =>
      transaction.isUserEvent('input') || transaction.isUserEvent('delete') ||
      transaction.isUserEvent('undo') || transaction.isUserEvent('redo') ||
      (transaction.isUserEvent('select') && !transaction.isUserEvent('select.pointer')));
    if (!keyboard || (!update.docChanged && !update.selectionSet)) return;
    this.view.requestMeasure({
      key: this,
      read: view => {
        if (this.destroyed || !view.hasFocus || !view.state.selection.main.empty || !this.viewport.clientHeight) return 0;
        const caret = view.coordsAtPos(view.state.selection.main.head);
        const rect = this.viewport.getBoundingClientRect();
        return caret ? markdownCaretScrollDelta(caret.top, caret.bottom, rect.top + this.viewport.clientTop, this.viewport.clientHeight) : 0;
      },
      write: delta => { if (!this.destroyed && delta) this.viewport.scrollTop += delta; },
    });
  }
  destroy() { this.destroyed = true; this.dispose(); }
});
