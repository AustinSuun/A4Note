import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

interface BlockSize { height: number; sourceHeight: number; to: number; text: string }
interface Sizes { signature: string; blocks: Map<number, BlockSize>; lines: Map<number, number> }
const empty = (): Sizes => ({ signature: '', blocks: new Map(), lines: new Map() });
export const mathSizesChanged = StateEffect.define<Sizes>();
export const mathSizes = StateField.define<Sizes>({
  create: empty,
  update(value, tr) {
    // Map untouched ranges so typing elsewhere does not temporarily collapse
    // existing reservations. Changed formula text/lines are measured afresh.
    if (tr.docChanged) {
      const blocks = new Map<number, BlockSize>(), lines = new Map<number, number>();
      for (const [start, size] of value.blocks) {
        const from = tr.changes.mapPos(start, 1), to = tr.changes.mapPos(size.to, -1);
        if (from < to && tr.newDoc.sliceString(from, to) === size.text) blocks.set(from, { ...size, to });
      }
      for (const [start, height] of value.lines) {
        const from = tr.changes.mapPos(start, 1), line = tr.newDoc.lineAt(from);
        if (line.from === from && line.text === tr.startState.doc.lineAt(start).text) lines.set(from, height);
      }
      value = { ...value, blocks, lines };
    }
    for (const effect of tr.effects) if (effect.is(mathSizesChanged)) value = effect.value;
    return value;
  },
});
export function mathAttributes(from: number, to: number, display: boolean) {
  return { 'data-math-from': String(from), 'data-math-to': String(to), 'data-math-display': String(display) };
}
export function mathBlockSize(state: EditorState, from: number) { return state.field(mathSizes, false)?.blocks.get(from); }
export function mathLineHeight(state: EditorState, from: number) { return state.field(mathSizes, false)?.lines.get(from); }

type RenderMath = (source: string, display: boolean) => HTMLElement;
function expression(raw: string) { const trim = raw.startsWith('$$') || raw.startsWith('\\') ? 2 : 1; return raw.slice(trim, -trim); }
const ceil = (n: number) => Math.ceil(n * 64) / 64;

/** Measure BOTH representations before interaction, not a fixed pixel guess or
 * scroll correction. Only visible formula blocks/lines are measured; sizes are
 * editor-local and discarded for content, width, typography and font changes.
 * The measurement tree is outside CodeMirror's managed content and never editable.
 */
export function mathLayoutStability(render: RenderMath) {
  return [mathSizes, ViewPlugin.fromClass(class {
    private dead = false;
    private fontRevision = 0;
    private readonly fonts: FontFaceSet;
    private readonly fontLoaded = () => { this.fontRevision++; this.schedule(); };
    constructor(private readonly view: EditorView) {
      this.fonts = view.dom.ownerDocument.fonts;
      this.fonts.addEventListener('loadingdone', this.fontLoaded);
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || update.transactions.some(t => t.reconfigured || t.effects.some(e => !e.is(mathSizesChanged)))) this.schedule();
    }
    destroy() { this.dead = true; this.fonts.removeEventListener('loadingdone', this.fontLoaded); }
    private schedule() {
      if (this.dead) return;
      this.view.requestMeasure({ key: this, read: () => ({ state: this.view.state, sizes: this.measure() }), write: result => {
        // requestMeasure's write phase still belongs to an EditorView update.
        // Dispatch only after it finishes, and reject stale asynchronous work.
        if (result.sizes) queueMicrotask(() => {
          if (this.dead) return;
          if (this.view.state !== result.state) { this.schedule(); return; }
          this.view.dispatch({ effects: mathSizesChanged.of(result.sizes!) });
        });
      } });
    }
    private measure(): Sizes | undefined {
      const view = this.view;
      const nodes = [...view.contentDOM.querySelectorAll<HTMLElement>('[data-math-from]')];
      if (!nodes.length) return;
      const style = getComputedStyle(view.contentDOM);
      const width = view.contentDOM.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0) return;
      const signature = [width, style.font, style.lineHeight, style.letterSpacing, style.wordSpacing, style.tabSize, style.wordBreak, style.whiteSpace, this.fontRevision].join('|');
      const previous = view.state.field(mathSizes);
      const sizes: Sizes = previous.signature === signature
        ? { signature, blocks: new Map(previous.blocks), lines: new Map(previous.lines) }
        : { signature, blocks: new Map(), lines: new Map() };
      let changed = previous.signature !== signature;
      const doc = view.dom.ownerDocument;
      const host = doc.createElement('div');
      host.className = 'cm-content cm-md-layout-measure';
      host.setAttribute('aria-hidden', 'true');
      host.inert = true;
      // Match the content's typography and usable width, but not its min-height,
      // padding, reserved sizes or position in the document flow.
      Object.assign(host.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0', width: `${width}px`, minHeight: '0', height: 'auto', padding: '0', margin: '0', font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, tabSize: style.tabSize, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak });
      view.dom.append(host);
      try {
        for (const node of nodes) {
          const from = Number(node.dataset.mathFrom), to = Number(node.dataset.mathTo);
          if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > view.state.doc.length || to <= from) continue;
          if (node.dataset.mathDisplay === 'true') {
            if (sizes.blocks.has(from)) continue;
            const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
            // Mid-paragraph display syntax is not a whole-line block. Retain
            // its existing boundary behavior instead of deleting surrounding text.
            if (from !== first.from || to !== last.to) continue;
            const raw = view.state.sliceDoc(from, to);
            const math = render(expression(raw), true);
            host.replaceChildren(math);
            const renderedHeight = math.getBoundingClientRect().height;
            host.replaceChildren();
            for (const text of raw.split('\n')) {
              const line = doc.createElement('div'); line.className = 'cm-line';
              const source = doc.createElement('span'); source.className = 'cm-md-math-source cm-md-math-display-source';
              let offset = 0;
              for (const token of text.matchAll(/\\[a-zA-Z]+|\\[\[\]]|[$^_{}&]/g)) {
                source.append(text.slice(offset, token.index));
                const marker = doc.createElement('span'); marker.className = 'cm-md-source-marker'; marker.textContent = token[0]; source.append(marker);
                offset = token.index! + token[0].length;
              }
              source.append(text.slice(offset) || (text ? '' : '\u200b'));
              line.append(source); host.append(line);
            }
            const sourceHeight = host.getBoundingClientRect().height;
            sizes.blocks.set(from, { height: ceil(Math.max(renderedHeight, sourceHeight)), sourceHeight, to, text: raw });
            changed = true;
          } else {
            const line = node.closest<HTMLElement>('.cm-line');
            const lineFrom = view.state.doc.lineAt(from).from;
            if (!line || sizes.lines.has(lineFrom)) continue;
            let height = 0;
            for (const sourceMode of [false, true]) {
              const clone = line.cloneNode(true) as HTMLElement;
              clone.style.minHeight = '';
              const seen = new Set<number>();
              for (const formula of [...clone.querySelectorAll<HTMLElement>('[data-math-from][data-math-display="false"]')]) {
                const start = Number(formula.dataset.mathFrom), end = Number(formula.dataset.mathTo);
                // Highlighting can split one source mark into multiple spans.
                if (seen.has(start)) { formula.remove(); continue; }
                seen.add(start);
                const raw = view.state.sliceDoc(start, end);
                const replacement = sourceMode ? doc.createElement('span') : render(expression(raw), false);
                if (sourceMode) { replacement.className = 'cm-md-math-source'; replacement.textContent = raw; }
                formula.replaceWith(replacement);
              }
              host.replaceChildren(clone);
              height = Math.max(height, clone.getBoundingClientRect().height);
            }
            sizes.lines.set(lineFrom, ceil(height));
            changed = true;
          }
        }
      } finally { host.remove(); }
      return changed ? sizes : undefined;
    }
  })];
}
