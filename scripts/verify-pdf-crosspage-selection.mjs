// Regression for cross-page text selections (audit 4de2cac5 §F3, card 8dba61be): a highlight/underline
// drag that crosses a page boundary must be split per page instead of being dropped, and overlay text
// (text boxes, sticky comments) must never leak into the quote. Runs the real pdfSelection helpers on
// a minimal DOM double that models node order, Range boundaries and intersectsNode.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';

globalThis.Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3 };
const resolution = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const selection = await import('../src/features/reader/pdf/pdfSelection.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---------- minimal DOM double ----------
class FakeText {
  constructor(text) { this.nodeType = 3; this.text = text; this.parentNode = null; this.childNodes = []; }
  get textContent() { return this.text; }
  get length() { return this.text.length; }
}
class FakeElement {
  constructor(tagName, { className = '', dataset = {} } = {}) { this.nodeType = 1; this.tagName = tagName.toUpperCase(); this.className = className; this.dataset = dataset; this.childNodes = []; this.parentNode = null; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.childNodes.push(node); } return this; }
  contains(node) { for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === this) return true; return false; }
  get textContent() { return this.childNodes.map((child) => child.textContent).join(''); }
  descendants() { return this.childNodes.flatMap((child) => (child.nodeType === 1 ? [child, ...child.descendants()] : [child])); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    return this.descendants().filter((node) => node.nodeType === 1 && matchesCompound(node, parts.at(-1)) && parts.slice(0, -1).every((part) => ancestorMatches(node, part, this)));
  }
}
function matchesCompound(node, compound) {
  const tag = compound.match(/^[a-z]+/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const cls of compound.match(/\.[\w-]+/g) ?? []) if (!node.className.split(/\s+/).includes(cls.slice(1))) return false;
  for (const attr of compound.match(/\[[\w-]+\]/g) ?? []) {
    const name = attr.slice(1, -1);
    if (!name.startsWith('data-')) return false;
    const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (node.dataset[key] === undefined) return false;
  }
  return true;
}
function ancestorMatches(node, compound, root) {
  for (let cursor = node.parentNode; cursor && cursor !== root.parentNode; cursor = cursor.parentNode) if (cursor.nodeType === 1 && matchesCompound(cursor, compound)) return true;
  return false;
}
/** Linear positions: element open/close markers and one slot per text character, in document order. */
class FakeDocument {
  constructor(root) { this.root = root; this.positions = new Map(); let counter = 0; const visit = (node) => { if (node.nodeType === 3) { this.positions.set(node, { start: counter, end: counter + node.length }); counter += node.length; return; } const open = counter++; for (const child of node.childNodes) visit(child); this.positions.set(node, { start: open, end: counter++ }); }; visit(root); }
  span(node) { return this.positions.get(node); }
  boundary(container, offset) {
    if (container.nodeType === 3) return this.span(container).start + offset;
    if (offset <= 0) return this.span(container).start + 0.5;
    const previous = container.childNodes[Math.min(offset, container.childNodes.length) - 1];
    return this.span(previous).end + 0.5;
  }
  textBetween(start, end) {
    let text = '';
    const walk = (node) => { if (node.nodeType === 3) { const { start: base } = this.span(node); for (let index = 0; index < node.length; index++) if (base + index >= start && base + index < end) text += node.text[index]; return; } node.childNodes.forEach(walk); };
    walk(this.root);
    return text;
  }
  range(startContainer, startOffset, endContainer, endOffset) { const range = new FakeRange(this); range.setStart(startContainer, startOffset); range.setEnd(endContainer, endOffset); return range; }
}
class FakeRange {
  constructor(document) { this.document = document; }
  setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
  setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
  cloneRange() { return this.document.range(this.startContainer, this.startOffset, this.endContainer, this.endOffset); }
  get startPosition() { return this.document.boundary(this.startContainer, this.startOffset); }
  get endPosition() { return this.document.boundary(this.endContainer, this.endOffset); }
  intersectsNode(node) { const { start, end } = this.document.span(node); return this.startPosition < end && this.endPosition > start; }
  toString() { return this.document.textBetween(this.startPosition, this.endPosition); }
}

// ---------- a two-page reader: text layer + an overlay text box on page 1, third page untouched ----------
const PAGE_TEXT = {
  1: ['First page line one', 'First page last line'],
  2: ['Second page first line', 'Second page line two'],
  3: ['Third page never selected'],
};
const spans = {};
const pages = {};
const textLayers = {};
const root = new FakeElement('div', { className: 'pdf-document' });
for (const [pageNumber, lines] of Object.entries(PAGE_TEXT)) {
  const page = new FakeElement('div', { className: 'pdf-page', dataset: { page: pageNumber } });
  const render = new FakeElement('div', { className: 'pdf-render-layer' });
  const textLayer = new FakeElement('div', { className: 'pdf-text-layer selectable' });
  spans[pageNumber] = lines.map((line, index) => new FakeElement('span', { dataset: { textIndex: String(index) } }).append(new FakeText(line)));
  textLayer.append(...spans[pageNumber]);
  const overlay = new FakeElement('div', { className: 'annotation-overlay' });
  if (pageNumber === '1') overlay.append(new FakeElement('div', { className: 'annotation-mark text text-inline' }).append(new FakeElement('div', { className: 'sticky-note-content text-annotation-content' }).append(new FakeText('NOTE BODY'))));
  render.append(new FakeElement('canvas', { className: 'pdf-canvas-page' }), textLayer, overlay);
  page.append(render);
  root.append(page);
  pages[pageNumber] = page;
  textLayers[pageNumber] = textLayer;
}
const document = new FakeDocument(root);
const textNode = (pageNumber, index) => spans[pageNumber][index].childNodes[0];
const items = (pageNumber) => PAGE_TEXT[pageNumber].map((text, index) => ({ text, x: 10, y: 10 + index * 4, width: 60, height: 3, fontSize: 12 }));

// ---- cross-page drag: from the middle of page 1's last line into page 2's first line ----
{
  const range = document.range(textNode(1, 1), 6, textNode(2, 0), 11);
  const touched = selection.textSelectionPageElements(root, range);
  same(touched.map((page) => page.dataset.page), ['1', '2'], 'a cross-page range touches exactly the two pages it spans (page 3 untouched)');
  ok(range.toString().includes('NOTE BODY'), 'the raw browser range would drag the overlay text box body along', range.toString());

  const first = selection.clipRangeToNode(range, textLayers[1]);
  ok(first.startContainer === textNode(1, 1) && first.startOffset === 6, 'page 1 clip keeps the original start');
  ok(first.endContainer === textLayers[1] && first.endOffset === textLayers[1].childNodes.length, 'page 1 clip ends at the end of its text layer');
  same(first.toString(), 'page last line', 'page 1 clip covers the rest of page 1 only');
  const firstSelections = selection.textItemSelectionsFromRange(first, pages[1]);
  same(firstSelections, [{ itemIndex: 1, startOffset: 6, endOffset: 20 }], 'page 1 offsets come from the clipped range');
  same(selection.quoteFromTextItemSelections(items(1), firstSelections), 'page last line', 'page 1 quote is built from text layer runs only');

  const second = selection.clipRangeToNode(range, textLayers[2]);
  ok(second.startContainer === textLayers[2] && second.startOffset === 0, 'page 2 clip starts at the beginning of its text layer');
  ok(second.endContainer === textNode(2, 0) && second.endOffset === 11, 'page 2 clip keeps the original end');
  same(second.toString(), 'Second page', 'page 2 clip covers the selected head of page 2 only');
  const secondSelections = selection.textItemSelectionsFromRange(second, pages[2]);
  same(secondSelections, [{ itemIndex: 0, startOffset: 0, endOffset: 11 }], 'page 2 offsets come from the clipped range');
  same(selection.quoteFromTextItemSelections(items(2), secondSelections), 'Second page', 'page 2 quote');
  ok(!selection.quoteFromTextItemSelections(items(1), firstSelections).includes('NOTE') && !selection.quoteFromTextItemSelections(items(2), secondSelections).includes('NOTE'), 'overlay text never reaches either quote');
  const rects = [...selection.textSelectionRectsFromOffsets(items(1), firstSelections), ...selection.textSelectionRectsFromOffsets(items(2), secondSelections)];
  ok(rects.length === 2 && rects.every((rect) => rect.width > 0 && rect.height > 0), 'each page gets its own geometry from its own offsets', rects);
}

// ---- single-page and multi-line selections keep working (no regression) ----
{
  const single = document.range(textNode(1, 0), 0, textNode(1, 1), 10);
  same(selection.textSelectionPageElements(root, single).map((page) => page.dataset.page), ['1'], 'a single-page range touches one page');
  const clipped = selection.clipRangeToNode(single, textLayers[1]);
  ok(clipped.startContainer === single.startContainer && clipped.endContainer === single.endContainer, 'clipping a range already inside the layer changes nothing');
  const selections = selection.textItemSelectionsFromRange(clipped, pages[1]);
  same(selections, [{ itemIndex: 0, startOffset: 0, endOffset: 19 }, { itemIndex: 1, startOffset: 0, endOffset: 10 }], 'multi-line offsets');
  same(selection.quoteFromTextItemSelections(items(1), selections), 'First page line one First page', 'multi-line quote joins lines with one space');
  const overlayOnly = document.range(pages[1].querySelector('.text-annotation-content').childNodes[0], 0, pages[1].querySelector('.text-annotation-content').childNodes[0], 4);
  same(selection.textSelectionPageElements(root, overlayOnly), [], 'a selection inside an overlay text box touches no page text layer');
}

// ---- quote assembly follows run gaps, not DOM boundaries ----
{
  const glued = [{ text: 'Hel', x: 10, y: 5, width: 3, height: 2, fontSize: 10 }, { text: 'lo', x: 13, y: 5, width: 2, height: 2, fontSize: 10 }];
  same(selection.quoteFromTextItemSelections(glued, [{ itemIndex: 0, startOffset: 0, endOffset: 3 }, { itemIndex: 1, startOffset: 0, endOffset: 2 }]), 'Hello', 'adjacent runs on one line are glued');
  const spaced = [glued[0], { ...glued[1], x: 13.6 }];
  same(selection.quoteFromTextItemSelections(spaced, [{ itemIndex: 0, startOffset: 0, endOffset: 3 }, { itemIndex: 1, startOffset: 0, endOffset: 2 }]), 'Hel lo', 'a gap wider than a quarter percent separates words');
  same(selection.quoteFromTextItemSelections(glued, [{ itemIndex: 0, startOffset: 1, endOffset: 3 }, { itemIndex: 5, startOffset: 0, endOffset: 2 }]), 'el', 'offsets are honoured and unknown items skipped');
  const rotated = [{ text: 'Top', x: 90, y: 10, width: 3, height: 5, fontSize: 10, orientation: 90 }, { text: 'Next', x: 85, y: 10, width: 3, height: 6, fontSize: 10, orientation: 90 }];
  same(selection.quoteFromTextItemSelections(rotated, [{ itemIndex: 0, startOffset: 0, endOffset: 3 }, { itemIndex: 1, startOffset: 0, endOffset: 4 }]), 'Top Next', 'rotated columns are separated like lines');
}

// ---- the reader wires the split and the stylesheet keeps overlay text unselectable ----
{
  const readerSource = await readFile(new URL('../src/features/reader/pdf/PdfReader.tsx', import.meta.url), 'utf8');
  assert.match(readerSource, /textSelectionPageElements\(containerRef\.current, range\)/);
  assert.match(readerSource, /clipRangeToNode\(range, textLayer\)/);
  assert.match(readerSource, /quoteFromTextItemSelections\(page\.textItems, textItemSelections\)/);
  assert.match(readerSource, /for \(const draft of drafts\) await saveAnnotationDraft\(draft\);/);
  assert.doesNotMatch(readerSource, /textLayer\?\.contains\(range\.commonAncestorContainer\)/);
  const readerCss = await readFile(new URL('../src/ui/styles/reader.css', import.meta.url), 'utf8');
  assert.match(readerCss, /\.annotation-mark, \.annotation-mark \.text-annotation-content, \.annotation-mark \.sticky-note-content \{ user-select: none; -webkit-user-select: none; \}/);
  const textCss = await readFile(new URL('../src/features/reader/pdf/pdf-text-annotation.css', import.meta.url), 'utf8');
  assert.match(textCss, /\.annotation-mark\.text\.text-inline\.editing \.annotation-text-editor \{[^}]*user-select: text;/);
  assert.doesNotMatch(textCss, /\.annotation-mark\.text\.text-inline \.annotation-text-editor \{[^}]*user-select: text;/);
  checks += 8;
}

console.log(`PDF cross-page selection: ${checks} assertions passed`);
