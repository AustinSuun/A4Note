import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from '@codemirror/view';

interface LineSize { height: number; contentKey: string }
interface BlockSize { to: number; text: string; height: number; lines: number[] }
interface Sizes { signature: string; lines: Map<number, LineSize>; blocks: Map<number, BlockSize> }
const empty = (): Sizes => ({ signature: '', lines: new Map(), blocks: new Map() });
export const previewSizesChanged = StateEffect.define<Sizes>();
export const previewSizes = StateField.define<Sizes>({
  create: empty,
  update(value, tr) {
    if (tr.docChanged) {
      const lines = new Map<number, LineSize>(), blocks = new Map<number, BlockSize>();
      for (const [start, size] of value.lines) {
        const from = tr.changes.mapPos(start, 1), line = tr.newDoc.lineAt(from);
        if (line.from === from && line.text === tr.startState.doc.lineAt(start).text) lines.set(from, size);
      }
      for (const [start, size] of value.blocks) {
        const from = tr.changes.mapPos(start, 1), to = tr.changes.mapPos(size.to, -1);
        if (from < to && tr.newDoc.sliceString(from, to) === size.text) blocks.set(from, { ...size, to });
      }
      value = { ...value, lines, blocks };
    }
    for (const effect of tr.effects) if (effect.is(previewSizesChanged)) value = effect.value;
    return value;
  },
});
export const previewLineHeight = (state: EditorState, from: number) => state.field(previewSizes, false)?.lines.get(from)?.height ?? 0;
export const previewBlockSize = (state: EditorState, from: number) => state.field(previewSizes, false)?.blocks.get(from);
export const previewBlockAttributes = (from: number, to: number) => ({ 'data-preview-block-from': String(from), 'data-preview-block-to': String(to) });

export interface MeasurementDecorations {
  rendered: DecorationSet;
  source: DecorationSet;
  tableIdle: DecorationSet;
  at: (position: number) => DecorationSet;
  widgetDOM: (widget: WidgetType) => HTMLElement;
}
type Piece = { from: number; to: number; spec: { class?: string; attributes?: Record<string, string>; tagName?: string; widget?: WidgetType; previewMeasureHighlight?: boolean; side?: number } };
function attributes(element: HTMLElement, spec: Piece['spec']) {
  if (spec.class) element.className += ` ${spec.class}`;
  for (const [name, value] of Object.entries(spec.attributes ?? {})) {
    if (name === 'class') element.className += ` ${value}`;
    else if (name === 'style') element.style.cssText += ';' + value;
    else element.setAttribute(name, value);
  }
}
/** Serialize the editor's own decorations, not a second Markdown parser. Nested
 * marks keep their shared parent spans so code padding/line breaking match CM.
 * Measurement nodes are inert and never mounted in CM's managed contentDOM.
 */
export function measurementLine(view: EditorView, from: number, decorations: DecorationSet, widgetDOM: MeasurementDecorations['widgetDOM']) {
  const line = view.state.doc.lineAt(from), doc = view.dom.ownerDocument;
  const element = doc.createElement('div'); element.className = 'cm-line';
  const marks: Piece[] = [], replacements: Piece[] = [], widgets: Piece[] = [];
  decorations.between(line.from, line.to, (start, end, value) => {
    const piece = { from: Math.max(start, line.from), to: Math.min(end, line.to), spec: value.spec };
    if (start === end && !value.spec.widget) { if (start === line.from) attributes(element, value.spec); }
    else if (value.spec.widget) (start === end ? widgets : replacements).push(piece);
    else if (value.spec.class || value.spec.tagName || value.spec.attributes) marks.push(piece);
    else replacements.push(piece);
  });
  // Main decorations have higher precedence than syntax highlighting; reversing
  // these layers splits inline-block headings/code into different wrap units.
  marks.sort((a, b) => Number(Boolean(a.spec.previewMeasureHighlight)) - Number(Boolean(b.spec.previewMeasureHighlight)) || a.from - b.from || b.to - a.to);
  const boundaries = [...new Set([line.from, line.to, ...marks.flatMap(m => [m.from, m.to]), ...replacements.flatMap(m => [m.from, m.to]), ...widgets.map(w => w.from)])].sort((a, b) => a - b);
  const appendWidget = (parent: HTMLElement, widget: WidgetType) => {
    const buffer = () => { const img = doc.createElement('img'); img.className = 'cm-widgetBuffer'; img.setAttribute('aria-hidden', 'true'); return img; };
    parent.append(buffer(), widgetDOM(widget), buffer());
  };
  let stack: Piece[] = [], parents: HTMLElement[] = [element];
  const parentAt = (pos: number) => {
    const next = marks.filter(m => m.from <= pos && m.to > pos);
    let shared = 0;
    while (shared < stack.length && shared < next.length && stack[shared] === next[shared]) shared++;
    parents.length = shared + 1;
    for (const mark of next.slice(shared)) {
      const span = doc.createElement(mark.spec.tagName ?? 'span'); attributes(span, mark.spec);
      parents.at(-1)!.append(span); parents.push(span);
    }
    stack = next; return parents.at(-1)!;
  };
  for (let i = 0; i < boundaries.length; i++) {
    const pos = boundaries[i];
    if (replacements.some(r => r.from < pos && r.to > pos)) continue;
    const parent = parentAt(pos);
    for (const widget of widgets.filter(w => w.from === pos)) appendWidget(widget.spec.side && widget.spec.side < 0 ? element : parent, widget.spec.widget!);
    const replacement = replacements.find(r => r.from === pos);
    if (replacement) { if (replacement.spec.widget) appendWidget(parent, replacement.spec.widget); continue; }
    const end = boundaries[i + 1];
    if (end != null && end > pos) parent.append(doc.createTextNode(view.state.sliceDoc(pos, end)));
  }
  if (!element.childNodes.length) element.append(doc.createElement('br'));
  return element;
}
/** A caret can reveal one inline construct while a tall neighbour stays rendered.
 * Measure the distinct reachable mixed states too, not just the two extremes. */
function mixedStates(view: EditorView, from: number, model: MeasurementDecorations) {
  const line = view.state.doc.lineAt(from), regions = new Map<string, [number, number]>();
  model.source.between(line.from, line.to, (start, end, value) => {
    if (start >= end || !value.spec.class?.includes('source') || value.spec.class === 'cm-md-source-marker') return;
    if (value.spec.class.includes('cm-md-callout-marker')) { start = line.from; end = line.to; }
    const range: [number, number] = [Math.max(start, line.from), Math.min(end, line.to)];
    regions.set(range.join(':'), range);
  });
  if (regions.size < 2) return [];
  const ranges = [...regions.values()], seen = new Set<string>(), result: number[] = [];
  const positions = [line.from, line.to, ...ranges.flatMap(([a, b]) => [a - 1, a, a + 1, b - 1, b, b + 1, b + 2])];
  for (const pos of positions) {
    if (pos < line.from || pos > line.to) continue;
    const key = ranges.map(([a, b]) => pos >= a - 1 && pos <= b + 1 ? '1' : '0').join('');
    if (seen.has(key)) continue;
    seen.add(key); result.push(pos);
  }
  return result;
}
const ceil = (n: number) => Math.ceil(n * 64) / 64;

/** Reserve both states only for visible authored lines/table blocks. No scroll
 * compensation, clipped source, document edits, or second editable surface.
 */
let nextOwner = 0;
const measureRequests = new WeakMap<EditorView, () => void>();
/** Image completion/status can change an inline widget without changing the
 * content element's total height. Do not rely on CM geometryChanged alone. */
export function requestPreviewLayoutMeasure(view: EditorView) {
  measureRequests.get(view)?.();
  view.requestMeasure();
}
export function previewLayoutStability(create: (view: EditorView) => MeasurementDecorations) {
  return [previewSizes, ViewPlugin.fromClass(class {
    private dead = false;
    private readonly owner = String(++nextOwner);
    private readonly sheet: HTMLStyleElement;
    private fontRevision = 0;
    private readonly fontLoaded = () => { this.fontRevision++; this.schedule(); };
    constructor(private readonly view: EditorView) {
      measureRequests.set(view, () => this.schedule());
      this.sheet = view.dom.ownerDocument.createElement('style');
      const nonce = view.state.facet(EditorView.cspNonce);
      if (nonce) this.sheet.nonce = nonce;
      view.dom.setAttribute('data-preview-layout-owner', this.owner);
      view.dom.append(this.sheet);
      view.dom.ownerDocument.fonts.addEventListener('loadingdone', this.fontLoaded); this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(previewSizesChanged)))) this.writeStyles();
      if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || update.transactions.some(t => t.reconfigured || t.effects.some(e => !e.is(previewSizesChanged)))) this.schedule();
    }
    destroy() { this.dead = true; measureRequests.delete(this.view); this.view.dom.ownerDocument.fonts.removeEventListener('loadingdone', this.fontLoaded); this.sheet.remove(); this.view.dom.removeAttribute('data-preview-layout-owner'); }
    private writeStyles() {
      // Changing line-decoration attributes makes CM rebuild inline widgets and
      // drops focused image controls. A scoped sheet changes geometry without
      // touching managed content DOM, widget identity, or editable text.
      const sizes = this.view.state.field(previewSizes);
      const scope = `[data-preview-layout-owner="${this.owner}"] > .cm-scroller > .cm-content`;
      const rules: string[] = [];
      for (const [from, size] of sizes.lines) rules.push(`${scope} > [data-preview-line="${from}"]{min-height:${size.height}px!important;box-sizing:border-box}`);
      for (const [from, size] of sizes.blocks) {
        rules.push(`${scope} > .cm-md-table-reservation[data-preview-block-from="${from}"]{min-height:${size.height}px}`);
        size.lines.forEach((height, index) => rules.push(`${scope} > [data-preview-table-start="${from}"][data-preview-table-index="${index}"]{min-height:${height}px!important;box-sizing:border-box}`));
      }
      this.sheet.textContent = rules.join('\n');
      this.view.requestMeasure();
    }
    private schedule() {
      this.view.requestMeasure({ key: this, read: () => ({ state: this.view.state, sizes: this.measure() }), write: result => {
        if (result.sizes) queueMicrotask(() => {
          if (this.dead) return;
          if (this.view.state !== result.state) { this.schedule(); return; }
          this.view.dispatch({ effects: previewSizesChanged.of(result.sizes!) });
        });
      } });
    }
    private measure(): Sizes | undefined {
      const view = this.view, doc = view.dom.ownerDocument;
      const nodes = [...view.contentDOM.querySelectorAll<HTMLElement>('[data-preview-line], [data-preview-block-from]')];
      if (!nodes.length) return;
      const style = getComputedStyle(view.contentDOM);
      const width = view.contentDOM.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0) return;
      const signature = [width, style.font, style.lineHeight, style.letterSpacing, style.wordSpacing, style.tabSize, style.whiteSpace, style.wordBreak, style.overflowWrap, style.direction, style.fontFeatureSettings, style.fontVariationSettings, this.fontRevision].join('|');
      const previous = view.state.field(previewSizes);
      const sizes: Sizes = previous.signature === signature ? { signature, lines: new Map(previous.lines), blocks: new Map(previous.blocks) } : { ...empty(), signature };
      let changed = previous.signature !== signature;
      let model: MeasurementDecorations | undefined;
      const host = doc.createElement('div'); host.className = 'cm-content cm-md-layout-measure'; host.inert = true; host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0', width: `${width}px`, minHeight: '0', height: 'auto', padding: '0', margin: '0', font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, tabSize: style.tabSize, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, direction: style.direction, fontFeatureSettings: style.fontFeatureSettings, fontVariationSettings: style.fontVariationSettings });
      view.dom.append(host);
      try {
        for (const node of nodes) {
          if (node.dataset.previewBlockFrom != null) {
            const from = Number(node.dataset.previewBlockFrom), to = Number(node.dataset.previewBlockTo);
            if (sizes.blocks.has(from) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > view.state.doc.length || from >= to) continue;
            model ??= create(view);
            let widget: WidgetType | undefined;
            model.rendered.between(from, to, (start, end, value) => { if (start === from && end === to && value.spec.block) widget = value.spec.widget; });
            if (!widget) continue;
            host.replaceChildren(model.widgetDOM(widget));
            const renderedHeight = host.getBoundingClientRect().height;
            const lines: number[] = [];
            for (const set of [model.source, model.tableIdle]) {
              host.replaceChildren();
              for (let n = view.state.doc.lineAt(from).number; n <= view.state.doc.lineAt(to).number; n++) host.append(measurementLine(view, view.state.doc.line(n).from, set, model.widgetDOM));
              [...host.children].forEach((line, index) => { lines[index] = Math.max(lines[index] ?? 0, ceil(line.getBoundingClientRect().height)); });
            }
            const first = view.state.doc.lineAt(from).number;
            for (let index = 0; index < lines.length; index++) {
              const lineFrom = view.state.doc.line(first + index).from;
              for (const pos of mixedStates(view, lineFrom, model)) {
                const candidate = measurementLine(view, lineFrom, model.at(pos), model.widgetDOM);
                host.children[index].replaceWith(candidate);
                lines[index] = Math.max(lines[index], ceil(candidate.getBoundingClientRect().height));
              }
            }
            const sourceHeight = lines.reduce((sum, h) => sum + h, 0), height = ceil(Math.max(renderedHeight, sourceHeight));
            lines[lines.length - 1] += height - sourceHeight;
            sizes.blocks.set(from, { to, text: view.state.sliceDoc(from, to), height, lines }); changed = true;
          } else {
            const from = Number(node.dataset.previewLine);
            if (!Number.isInteger(from) || from < 0 || from > view.state.doc.length) continue;
            // Images can finish loading without a document change. Measure the
            // decoded geometry again; merely revealing source reuses the img.
            const images = [...node.querySelectorAll<HTMLImageElement>('img.cm-md-image')];
            const context = [...node.classList].filter(name => name !== 'cm-activeLine').sort().join(' ');
            const folded = node.querySelector('.cm-md-heading-fold-toggle')?.getAttribute('aria-expanded') ?? '';
            const contentKey = context + '|' + folded + '|' + images.map(img => {
              const image = img.getBoundingClientRect(), wrapper = img.parentElement!.getBoundingClientRect();
              return `${img.complete}|${img.currentSrc}|${image.width}|${image.height}|${wrapper.width}|${wrapper.height}`;
            }).join(';');
            if (sizes.lines.get(from)?.contentKey === contentKey) continue;
            model ??= create(view);
            let height = 0;
            for (const set of [model.rendered, model.source]) {
              const line = measurementLine(view, from, set, model.widgetDOM); host.replaceChildren(line);
              height = Math.max(height, line.getBoundingClientRect().height);
            }
            for (const pos of mixedStates(view, from, model)) {
              const line = measurementLine(view, from, model.at(pos), model.widgetDOM); host.replaceChildren(line);
              height = Math.max(height, line.getBoundingClientRect().height);
            }
            sizes.lines.set(from, { height: ceil(height), contentKey }); changed = true;
          }
        }
      } finally { host.remove(); }
      return changed ? sizes : undefined;
    }
  })];
}
