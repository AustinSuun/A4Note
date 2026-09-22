// Regression for card 9222954f: at high zoom with the reading list open, the selection preview and
// the created underline/highlight landed left of the pointer. The transparent text runs were laid
// out in a substitute font whose advances differ from the PDF font, so the caret the browser put
// under the pointer and the character offset the reader mapped back onto the pdf.js run box
// disagreed by an amount that grew with the offset into the run and with the zoom.
// The fix fits every run onto its PDF box (pdfTextLayerFit) and slices selection bands from the
// fitted glyphs (textSelectionRectsFromLayer). These checks run the real helpers on a DOM double
// and pin the source contracts; the browser walk-through with real mouse drags and screenshots is
// scripts/verify-pdf-text-layer-offset-browser.mjs.
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
const fit = await import('../src/features/reader/pdf/pdfTextLayerFit.ts');
const selection = await import('../src/features/reader/pdf/pdfSelection.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message, { actual, expected });

// ---------- DOM double: a text layer with runs whose glyph advance differs from the PDF box ----------
// `advance` is the browser's natural glyph extent (px) along the flow axis, `layer` the client box
// of the render layer. The measurer answers exactly like Range.getBoundingClientRect would for a
// run that has been fitted (glyphs scaled onto the PDF box) or not (natural advance).
function textLayerDouble({ layer, items, advances, fitted }) {
  const spans = items.map((item, index) => {
    const properties = new Map();
    return {
      dataset: { textIndex: String(index) },
      style: { setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name), properties },
      firstChild: { nodeType: 3, textContent: item.text, index },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    };
  });
  const vertical = (item) => item.orientation === 90 || item.orientation === 270;
  const runOrigin = (item) => ({ x: layer.left + (item.x / 100) * layer.width, y: layer.top + (item.y / 100) * layer.height });
  const scaleOf = (item, index) => {
    if (!fitted) return 1;
    const value = spans[index].style.properties.get(fit.TEXT_RUN_SCALE_PROPERTY);
    return value === undefined ? 1 : Number(value);
  };
  // Glyph rect of characters [start, end) of run `index`, in the layer's client pixels.
  const glyphRect = (index, start, end) => {
    const item = items[index];
    const advance = advances[index];
    const scale = scaleOf(item, index);
    const origin = runOrigin(item);
    const from = (start / item.text.length) * advance * scale;
    const to = (end / item.text.length) * advance * scale;
    return vertical(item)
      ? { left: origin.x, top: origin.y + from, width: (item.width / 100) * layer.width, height: to - from }
      : { left: origin.x + from, top: origin.y, width: to - from, height: (item.height / 100) * layer.height };
  };
  const document = {
    createRange() {
      let node = null, start = 0, end = 0;
      return {
        selectNodeContents(target) { node = target; start = 0; end = target.textContent.length; },
        setStart(target, offset) { node = target; start = offset; },
        setEnd(target, offset) { node = target; end = offset; },
        getBoundingClientRect: () => glyphRect(node.index, start, end),
      };
    },
  };
  const textLayer = {
    ownerDocument: document,
    getBoundingClientRect: () => layer,
    querySelectorAll: (selector) => (selector === 'span[data-text-index]' ? spans : []),
    querySelector: (selector) => spans.find((span) => selector === `span[data-text-index="${span.dataset.textIndex}"]`) ?? null,
  };
  return { textLayer, spans, glyphRect };
}

// Reference geometry: 370 % zoom, the reading list (360 px) pushes the page right, the scroller is
// scrolled down and the page starts left of the viewport when scrolled horizontally.
const ZOOM = 3.7;
const LAYER = { left: 367 - 900, top: -313, width: 612 * ZOOM, height: 792 * ZOOM };
const LINE = 'Line 12: curved trajectories, numerical ODE solvers lead to inaccurate results when applying mean flows.';
const ITEMS = [
  { text: LINE, x: 8.8235, y: 24.6212, width: 76.1732, height: 1.3889, fontSize: 11 },
  { text: 'Short run', x: 8.8235, y: 26.3889, width: 6.5, height: 1.3889, fontSize: 11 },
  { text: 'Rotated column', x: 90, y: 10, width: 1.5, height: 20, fontSize: 11, orientation: 90 },
  { text: '   ', x: 50, y: 50, width: 2, height: 1, fontSize: 11 },
];
// Substitute font 12.8 % wider than the PDF font on the long line (the CJK stack vs Times), narrower on the short one.
const ADVANCES = [
  (ITEMS[0].width / 100) * LAYER.width * 1.128,
  (ITEMS[1].width / 100) * LAYER.width * 0.93,
  (ITEMS[2].height / 100) * LAYER.height * 1.05,
  (ITEMS[3].width / 100) * LAYER.width,
];

// ---------- textRunScale ----------
{
  near(fit.textRunScale(200, 250), 0.8, 'scale maps the glyph advance onto the PDF extent');
  near(fit.textRunScale(200, 200), 1, 'identical extents need no scale');
  ok(fit.textRunScale(0, 100) === 1 && fit.textRunScale(100, 0) === 1 && fit.textRunScale(NaN, 100) === 1 && fit.textRunScale(100, Infinity) === 1, 'unusable extents fall back to 1');
  near(fit.textRunScale(1000, 1), 10, 'scale is capped above');
  near(fit.textRunScale(1, 1000), 0.1, 'scale is capped below');
}

// ---------- fitTextRunsToPdfBoxes ----------
{
  const { textLayer, spans } = textLayerDouble({ layer: LAYER, items: ITEMS, advances: ADVANCES, fitted: false });
  ok(fit.fitTextRunsToPdfBoxes(textLayer, ITEMS) === 4, 'every run of the layer is visited');
  near(Number(spans[0].style.properties.get('--pdf-run-scale')), 1 / 1.128, 'wide substitute run is scaled down onto its PDF box', 1e-4);
  near(Number(spans[1].style.properties.get('--pdf-run-scale')), 1 / 0.93, 'narrow substitute run is scaled up onto its PDF box', 1e-4);
  near(Number(spans[2].style.properties.get('--pdf-run-scale')), 1 / 1.05, 'rotated runs are fitted along their vertical flow axis', 1e-4);
  ok(!spans[3].style.properties.has('--pdf-run-scale'), 'a run that already matches gets no transform');
  // Second pass at another zoom: stale scales are reset before measuring, so the result does not compound.
  ok(fit.fitTextRunsToPdfBoxes(textLayer, ITEMS) === 4, 'refit runs again');
  near(Number(spans[0].style.properties.get('--pdf-run-scale')), 1 / 1.128, 'refitting does not compound the previous scale', 1e-4);
  const hidden = textLayerDouble({ layer: { left: 0, top: 0, width: 0, height: 0 }, items: ITEMS, advances: ADVANCES, fitted: false });
  ok(fit.fitTextRunsToPdfBoxes(hidden.textLayer, ITEMS) === 0 && !hidden.spans[0].style.properties.has('--pdf-run-scale'), 'a layer without a box (hidden tab, released page) is left untouched for a later pass');
}

// ---------- client → PDF → render round trip through the fitted layer ----------
{
  const { textLayer, glyphRect } = textLayerDouble({ layer: LAYER, items: ITEMS, advances: ADVANCES, fitted: true });
  fit.fitTextRunsToPdfBoxes(textLayer, ITEMS);
  const measure = selection.textRunExtentMeasurer(textLayer);
  const toClientX = (percent) => LAYER.left + (percent / 100) * LAYER.width;
  const toClientY = (percent) => LAYER.top + (percent / 100) * LAYER.height;

  // The pointer pressed on character 9 and released after character 60 of the long line: the
  // browser reports those offsets; the band must render exactly under the glyphs it measured.
  const visible = selection.visibleTextItemSelection(ITEMS[0], { itemIndex: 0, startOffset: 9, endOffset: 60 });
  ok(visible.start === 9 && visible.end === 59 && LINE[59] === ' ', 'the trailing blank the drag crossed is trimmed from the band');
  const pointer = glyphRect(0, visible.start, visible.end);
  const [rect] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 9, endOffset: 60 }], LAYER, measure);
  near(toClientX(rect.x), pointer.left, 'band starts under the pointer at 370 % with sidebar + horizontal scroll', 1e-6);
  near(toClientX(rect.x + rect.width), pointer.left + pointer.width, 'band ends under the pointer at 370 % with sidebar + horizontal scroll', 1e-6);
  near(rect.y, ITEMS[0].y, 'band keeps the PDF run top (one even height per font size)');
  near(rect.height, ITEMS[0].height, 'band keeps the PDF run height');
  // The old proportional slice (still used as fallback) is what drifted: on the fitted run both agree,
  // on an unfitted run the glyph-based band would sit 12.8 % further along – the reported bug.
  const [proportional] = selection.textSelectionRectsFromOffsets(ITEMS, [{ itemIndex: 0, startOffset: 9, endOffset: 60 }]);
  near(rect.x, proportional.x, 'fitted glyph band agrees with the character-ratio slice (scale is stored with 4 decimals)', 1e-3);
  near(rect.width, proportional.width, 'fitted glyph band width agrees with the character-ratio slice', 5e-3);
  const unfitted = textLayerDouble({ layer: LAYER, items: ITEMS, advances: ADVANCES, fitted: false });
  const drift = unfitted.glyphRect(0, 9, 59).left - pointer.left;
  ok(drift > 15, 'without the fit the caret under the pointer sits tens of pixels right of the PDF character (the bug)', { driftPx: drift });

  // Sidebar width / scroll offset must not enter the percentages at all.
  const shifted = { ...LAYER, left: LAYER.left + 360 + 900, top: LAYER.top + 322 };
  const shiftedLayer = textLayerDouble({ layer: shifted, items: ITEMS, advances: ADVANCES, fitted: true });
  fit.fitTextRunsToPdfBoxes(shiftedLayer.textLayer, ITEMS);
  const [shiftedRect] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 9, endOffset: 60 }], shifted, selection.textRunExtentMeasurer(shiftedLayer.textLayer));
  near(shiftedRect.x, rect.x, 'closing the sidebar / scrolling leaves the persisted percentages unchanged', 1e-9);
  near(shiftedRect.width, rect.width, 'closing the sidebar / scrolling leaves the persisted width unchanged', 1e-9);

  // Whole run, whitespace trimming, rotated runs, fallbacks.
  const [whole] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 0, endOffset: LINE.length }], LAYER, measure);
  near(whole.x, ITEMS[0].x, 'a whole-run selection starts at the run box', 1e-6);
  ok(whole.width <= ITEMS[0].width + 1e-9 && whole.width > ITEMS[0].width * 0.999, 'a whole-run selection covers the run box without exceeding it', { width: whole.width, run: ITEMS[0].width });
  const [trimmed] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 8, endOffset: 16 }], LAYER, measure);
  near(toClientX(trimmed.x), glyphRect(0, 9, 15).left, 'leading/trailing whitespace is dropped before measuring', 1e-6);
  ok(selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 3, startOffset: 0, endOffset: 3 }], LAYER, measure).length === 0, 'a whitespace-only selection yields no band');
  const [column] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 2, startOffset: 4, endOffset: 11 }], LAYER, measure);
  near(toClientY(column.y), glyphRect(2, 4, 11).top, 'rotated runs slice along y from the measured glyphs', 1e-6);
  near(column.x, ITEMS[2].x, 'rotated runs keep the PDF run x');
  near(column.width, ITEMS[2].width, 'rotated runs keep the PDF run width');
  const [fallback] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 9, endOffset: 60 }], LAYER, () => null);
  assert.deepEqual(fallback, proportional); checks++;
  const [noLayer] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 9, endOffset: 60 }], { left: 0, top: 0, width: 0, height: 0 }, measure);
  assert.deepEqual(noLayer, proportional); checks++;
  // A still-loading font can overshoot the run: the band is clamped into the run box instead of leaking.
  const overshoot = () => ({ left: toClientX(ITEMS[0].x) - 40, top: 0, width: (ITEMS[0].width / 100) * LAYER.width + 80, height: 10 });
  const [clamped] = selection.textSelectionRectsFromLayer(ITEMS, [{ itemIndex: 0, startOffset: 0, endOffset: LINE.length }], LAYER, overshoot);
  near(clamped.x, ITEMS[0].x, 'glyph rects outside the run are clamped to its start', 1e-9);
  near(clamped.width, ITEMS[0].width, 'glyph rects outside the run are clamped to its end', 1e-9);
  ok(selection.textRunExtentMeasurer({ ownerDocument: null, querySelector: () => null })(0, 0, 1) === null, 'a detached layer cannot be measured');
  ok(measure(99, 0, 1) === null, 'unknown runs cannot be measured');
}

// ---------- source contracts: one pipeline, no per-tool or per-zoom offsets ----------
{
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const textLayer = await read('src/features/reader/pdf/PdfTextLayer.tsx');
  assert.match(textLayer, /import \{ fitTextRunsToPdfBoxes \} from '\.\/pdfTextLayerFit'/);
  assert.match(textLayer, /useLayoutEffect\(\(\) => \{[\s\S]*fitTextRunsToPdfBoxes\(layer, textItems\)[\s\S]*\}, \[textItems, zoom, selectable\]\)/);
  assert.match(textLayer, /width: 'max-content', height: `\$\{item\.height\}%`/);
  assert.match(textLayer, /width: `\$\{item\.width\}%`, height: 'max-content'/);
  assert.match(textLayer, /new ResizeObserver\(/);
  assert.doesNotMatch(textLayer, /width: `\$\{item\.width\}%`,\s*\n\s*height: `\$\{item\.height\}%`/);
  assert.match(textLayer, /className=\{selectable \? 'pdf-text-layer selectable' : 'pdf-text-layer'\}/);
  assert.match(textLayer, /data-text-index=\{index\}/);
  checks += 8;
  const css = await read('src/ui/styles/reader.css');
  assert.match(css, /\.pdf-text-layer span \{[^}]*transform-origin: 0 0;[^}]*transform: scaleX\(var\(--pdf-run-scale, 1\)\);/s);
  assert.match(css, /\.pdf-text-layer span\[data-text-orientation="90"\],\s*\n\.pdf-text-layer span\[data-text-orientation="270"\] \{\s*transform: scaleY\(var\(--pdf-run-scale, 1\)\);/);
  checks += 2;
  const reader = await read('src/features/reader/pdf/PdfReader.tsx');
  assert.match(reader, /const preciseRects = page \? textSelectionRectsFromLayer\(page\.textItems, textItemSelections, layer\.getBoundingClientRect\(\), textRunExtentMeasurer\(textLayer\)\) : \[\]/);
  assert.match(reader, /const draft = textSelectionDraft\(pageElement, range, 'highlight'\);/);
  assert.match(reader, /const draft = textSelectionDraft\(pageElement, range, tool\);/);
  // No per-zoom or per-layout offsets: the pipeline is client rect → percentages, nothing else.
  assert.doesNotMatch(reader, /zoom (?:>=?|===) 3\.7|370/);
  assert.doesNotMatch(reader, /sidebarWidth|readingListWidth|offsetCorrection/i);
  checks += 5;
  const fitSource = await read('src/features/reader/pdf/pdfTextLayerFit.ts');
  assert.match(fitSource, /export const TEXT_RUN_SCALE_PROPERTY = '--pdf-run-scale'/);
  assert.match(fitSource, /span\.style\.removeProperty\(TEXT_RUN_SCALE_PROPERTY\)/);
  checks += 2;
  const pkg = JSON.parse(await read('package.json'));
  ok(pkg.scripts['test:pdf-text-layer-offset']?.includes('verify-pdf-text-layer-offset.mjs'), 'npm script for this regression exists');
  ok(pkg.scripts['test:pdf-text-layer-offset-browser']?.includes('verify-pdf-text-layer-offset-browser.mjs'), 'npm script for the browser walk-through exists');
}

console.log(`PDF text layer offset: ${checks} assertions passed`);
