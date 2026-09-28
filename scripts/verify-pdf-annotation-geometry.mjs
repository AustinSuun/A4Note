// Regression for card 6d59b629: highlight / underline bands sat right of and below the selected
// text, and the quick-action popup floated mid-line, worst at ≥118 % zoom and on multi-line
// selections. Three sources, all fixed at the geometry layer (no fudge offsets):
//   1. The text-layer spans inherited the UI font (a CJK sans stack, kerning on). The run-fit
//      scale (pdfTextLayerFit) only corrects a run's total advance, so glyphs in the middle of a
//      run drifted by up to a third of an em from the painted bitmap; every Range rect, band edge
//      and caret inherited that drift. Runs now carry the generic family pdf.js resolved for the
//      PDF font (`TextItemBox.fontFamily` → `data-text-font`) and lay out without kerning.
//   2. `mergeRectsIntoLineSegments` merged lines whose top edges were < 1.2 % of the page apart —
//      the line pitch of 9 pt text at 10 pt leading on A4 (1.188 %) — so consecutive small lines
//      collapsed into one band spanning the leading. The tolerance is now relative to line height.
//   3. The SelectionPopup mixed client pixels with layout pixels under root (UI) zoom and forgot
//      the scroller padding. It is now anchored in page percent (`selectionPopupAnchor`) and
//      rendered inside the page's render layer, next to the preview band and the saved mark.
// These checks run the real extraction (pdf.js on a synthetic A4 Times-Roman document) and the
// real helpers; the browser walk-through with real drags is verify-pdf-annotation-geometry-browser.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3 };
const resolution = registerHooks({
  resolve(specifier, context, next) {
    const inRepoSource = !context.parentURL?.includes('/node_modules/');
    return next(inRepoSource && specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const geometry = await import('../src/features/reader/pdf/pdfGeometry.ts');
const selection = await import('../src/features/reader/pdf/pdfSelection.ts');
const appearance = await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');
const helpers = await import('../src/features/reader/pdf/pdfAnnotationHelpers.ts');
const popup = await import('../src/features/reader/pdf/pdfSelectionPopup.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message, { actual, expected, tolerance });
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------- fixture: A4, Times-Roman; one 11 pt body line and three 9 pt lines at 10 pt leading ----------
const A4 = { width: 595.276, height: 841.89 };
const BODY = { x: 54, baseline: 740, size: 11, text: 'Line 12: curved trajectories, numerical ODE solvers lead to inaccurate results.' };
const SMALL = { x: 54, baseline: 400, size: 9, leading: 10, lines: ['First small line of a footnote-sized paragraph set solid.', 'Second small line follows at ten point leading.', 'Third small line closes the paragraph.'] };
function syntheticPdf() {
  const escape = (text) => text.replace(/[()\\]/g, '\\$&');
  const ops = ['BT', `/F1 ${BODY.size} Tf`, `${BODY.x} ${BODY.baseline} Td`, `(${escape(BODY.text)}) Tj`, 'ET',
    'BT', `/F1 ${SMALL.size} Tf`, `${SMALL.leading} TL`, `${SMALL.x} ${SMALL.baseline} Td`];
  for (const line of SMALL.lines) ops.push(`(${escape(line)}) Tj`, 'T*');
  ops.push('ET');
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Page /Parent 4 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Catalog /Pages 4 0 R >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
const pdf = await pdfjsLib.getDocument({ data: syntheticPdf(), useSystemFonts: false, standardFontDataUrl: `${fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts', import.meta.url))}/` }).promise;
const page = await pdf.getPage(1);
const pct = { x: (pt) => (pt / A4.width) * 100, y: (pt) => (pt / A4.height) * 100 };

// ---------- 1. extraction: generic font family, percentages that do not drift with zoom ----------
const boxesByScale = new Map();
for (const scale of [1, 1.5, 2]) boxesByScale.set(scale, await geometry.extractTextItemBoxes(page, page.getViewport({ scale })));
const [body, ...small] = boxesByScale.get(1);
ok(boxesByScale.get(1).length === 4 && small.length === 3, 'fixture yields one body run and three small runs', boxesByScale.get(1).map(b => b.text));
ok(boxesByScale.get(1).every(box => box.fontFamily === 'serif'), 'every run carries the generic family pdf.js resolved for Times-Roman (serif)', boxesByScale.get(1).map(b => b.fontFamily));
near(body.x, pct.x(BODY.x), 'run box starts at the PDF x origin', 1e-6);
near(body.y, pct.y(A4.height - BODY.baseline - BODY.size), 'run box top is baseline − font size (ascent box)', 1e-6);
near(body.height, pct.y(BODY.size), 'run box height is the font size', 1e-6);
for (const scale of [1.5, 2]) {
  boxesByScale.get(scale).forEach((box, index) => {
    const reference = boxesByScale.get(1)[index];
    for (const key of ['x', 'y', 'width', 'height']) near(box[key], reference[key], `stored ${key} % is identical at ${scale * 100} % zoom (no drift with viewport scale)`, 1e-6);
    ok(box.fontFamily === reference.fontFamily && box.text === reference.text, 'text and font family are scale independent');
  });
}
ok(geometry.textFontFamily('serif') === 'serif' && geometry.textFontFamily('sans-serif') === 'sans-serif' && geometry.textFontFamily('monospace') === 'monospace', 'the three generic families pass through');
ok(geometry.textFontFamily('Times New Roman') === undefined && geometry.textFontFamily(undefined) === undefined && geometry.textFontFamily(12) === undefined, 'anything but a generic family is dropped (the text layer never names a concrete font)');

// ---------- 2. band and rule metrics in pixels at 100 / 150 / 200 % ----------
// The band covers ascender → descender of the selected glyphs: top = baseline − 0.9 em, bottom =
// baseline + 0.2 em (pdf.js hands us the ascent box; the trim/extension live in the appearance
// helpers). The rule sits just below the baseline. Everything is stored in page percent, so the
// pixel error at any zoom is only the percent → pixel rounding.
const bodyWidthPt = (await page.getTextContent()).items.find(item => item.str === BODY.text).width;
for (const zoom of [1, 1.5, 2]) {
  const px = { x: (p) => (p / 100) * A4.width * zoom, y: (p) => (p / 100) * A4.height * zoom };
  const baselinePx = (A4.height - BODY.baseline) * zoom;
  const em = BODY.size * zoom;
  const [band] = appearance.highlightRects({ ...body, segments: [body] });
  near(px.y(band.y), baselinePx - 0.9 * em, `highlight band top is baseline − 0.9 em at ${zoom * 100} %`, 0.5);
  near(px.y(band.y + band.height), baselinePx + 0.2 * em, `highlight band bottom is baseline + 0.2 em at ${zoom * 100} %`, 0.5);
  near(px.x(band.x), BODY.x * zoom, `highlight band starts on the first glyph at ${zoom * 100} %`, 0.5);
  near(px.x(band.x + band.width), (BODY.x + bodyWidthPt) * zoom, `highlight band ends on the last glyph advance at ${zoom * 100} %`, 0.5);
  const rule = helpers.underlinePositionStyle(body);
  const ruleTop = px.y(parseFloat(rule.top));
  ok(ruleTop >= baselinePx - 0.5 && ruleTop <= baselinePx + 0.15 * em + 0.5, `underline rule top sits just under the baseline at ${zoom * 100} %`, { ruleTop, baselinePx, em });
  near(px.x(parseFloat(rule.left)), BODY.x * zoom, `underline starts on the first glyph at ${zoom * 100} %`, 0.5);
  near(px.x(parseFloat(rule.left) + parseFloat(rule.width)), (BODY.x + bodyWidthPt) * zoom, `underline ends on the last glyph advance at ${zoom * 100} %`, 0.5);
}
// Slicing a run for a partial selection keeps the same top/height (the band edges only move along the run).
{
  const slice = selection.sliceTextItemBox(body, 0.25, 0.5);
  ok(slice.y === body.y && slice.height === body.height && slice.x > body.x && slice.width < body.width, 'partial selection keeps the run cross-axis geometry');
}

// ---------- 3. line merging: consecutive 9 pt lines at 10 pt leading stay separate lines ----------
{
  const pitch = small[1].y - small[0].y;
  ok(Math.abs(pitch - pct.y(SMALL.leading)) < 1e-6 && pitch < 1.2, 'fixture pitch is below the old fixed 1.2 % tolerance', { pitch, height: small[0].height });
  const merged = selection.mergeRectsIntoLineSegments(small.map(box => ({ x: box.x, y: box.y, width: box.width, height: box.height })));
  ok(merged.length === 3, 'three small lines produce three segments (old code merged them into one band across the leading)', merged);
  merged.forEach((segment, index) => near(segment.y, small[index].y, `segment ${index} keeps its own line top`, 1e-9));
  // Two runs of one line (a run break inside the line, e.g. a font change) still merge.
  const [a] = small;
  const left = { x: a.x, y: a.y, width: a.width * 0.4, height: a.height };
  const right = { x: a.x + a.width * 0.4 + 0.3, y: a.y + a.height * 0.05, width: a.width * 0.6, height: a.height };
  ok(selection.mergeRectsIntoLineSegments([right, left]).length === 1, 'runs of the same line merge (small gap, tiny baseline jitter)');
  // A superscript-sized run raised inside the line height still belongs to the line.
  const superscript = { x: a.x + a.width + 0.2, y: a.y - a.height * 0.35, width: 1, height: a.height * 0.6 };
  ok(selection.mergeRectsIntoLineSegments([left, superscript]).length === 1, 'a raised superscript run merges into its line');
  // A rect one line pitch away never merges, at any size.
  ok(selection.mergeRectsIntoLineSegments([left, { ...left, y: left.y + left.height * 1.1 }]).length === 2, 'the next line (pitch 1.1 × height) is its own segment');
  // Vertical (rotated) columns use the same rule along x.
  const column = { x: 80, y: 10, width: pct.x(SMALL.size), height: 30 };
  const nextColumn = { ...column, x: column.x - pct.x(SMALL.leading) };
  ok(selection.mergeRectsIntoLineSegments([column, nextColumn], 90).length === 2, 'two vertical columns one pitch apart stay separate');
  ok(selection.mergeRectsIntoLineSegments([column, { ...column, y: column.y + column.height + 0.5 }], 90).length === 1, 'two runs of one vertical column merge');
}

// ---------- 4. quick-action popup anchor (page percent, first line above / last line below) ----------
{
  const line = { x: 10, y: 20, width: 50, height: 1.3 };
  const second = { x: 10, y: 23, width: 30, height: 1.3 };
  assert.deepEqual(popup.selectionPopupAnchor([line], { x: 30, y: 20.6 }, { height: 1000 }), { x: 30, y: 20, placement: 'above' }, 'above the line, over the pointer');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([line], { x: 75, y: 20.6 }, { height: 1000 }), { x: 60, y: 20, placement: 'above' }, 'pointer past the line end is clamped to the line');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([line], { x: 75, y: 50 }, { height: 1000 }), { x: 35, y: 20, placement: 'above' }, 'pointer off the line falls back to the line centre');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([line], null, { height: 1000 }), { x: 35, y: 20, placement: 'above' }, 'no pointer → line centre');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([second, line], { x: 20, y: 23.6 }, { height: 1000 }), { x: 35, y: 20, placement: 'above' }, 'multi-line: hangs above the first line (centred) even when the drag ended on the last one');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([second, line], { x: 20, y: 20.4 }, { height: 1000 }), { x: 20, y: 20, placement: 'above' }, 'multi-line: follows the pointer when it is on the first line');
  checks++;
  const top = { x: 10, y: 2, width: 50, height: 1.3 };
  assert.deepEqual(popup.selectionPopupAnchor([top, { ...second, y: 3.5 }], { x: 20, y: 2.5 }, { height: 1000 }), { x: 20, y: 4.8, placement: 'below' }, 'no room above the first line (20 px < clearance) → below the last line');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([top], { x: 20, y: 2.5 }, { height: 4000 }), { x: 20, y: 2, placement: 'above' }, 'the same page at 4× the pixel height has room above (only the flip depends on zoom)');
  checks++;
  ok(popup.selectionPopupAnchor([], { x: 1, y: 1 }, { height: 1000 }) === null && popup.selectionPopupAnchor([{ x: 1, y: 1, width: 0, height: 1 }], null, { height: 1000 }) === null, 'no usable segment → no anchor');
  const edge = { x: 1, y: 20, width: 20, height: 1.3 };
  assert.deepEqual(popup.selectionPopupAnchor([edge], { x: 2, y: 20.5 }, { width: 400, height: 1000 }), { x: 10, y: 20, placement: 'above' }, 'a selection at the page edge keeps the popup inside the page (40 px margin at the layout width)');
  checks++;
  assert.deepEqual(popup.selectionPopupAnchor([edge], { x: 2, y: 20.5 }, { width: 4000, height: 1000 }), { x: 2, y: 20, placement: 'above' }, 'the horizontal margin shrinks with the page size (1 % of a 4000 px page)');
  checks++;
  ok(popup.SELECTION_POPUP_CLEARANCE_PX >= 40 && popup.SELECTION_POPUP_CLEARANCE_PX <= 80, 'clearance covers the popup height plus its gap');
}

// ---------- 5. wiring contracts (source/CSS) ----------
{
  const textLayer = await read('src/features/reader/pdf/PdfTextLayer.tsx');
  ok(textLayer.includes('data-text-font={item.fontFamily}'), 'text runs expose the generic family for the CSS substitute stack');
  const css = await read('src/ui/styles/reader.css');
  ok(/\.pdf-text-layer span\[data-text-font="serif"\][^}]*"Times New Roman"/.test(css), 'serif runs use a Times-metric substitute before the generic keyword');
  ok(/\.pdf-text-layer span\[data-text-font="sans-serif"\][^}]*Arial/.test(css) && /\.pdf-text-layer span\[data-text-font="monospace"\][^}]*"Courier New"/.test(css), 'sans-serif and monospace runs use metric-compatible substitutes');
  ok(/\.pdf-text-layer span\s*{[^}]*font-kerning:\s*none/.test(css) && /\.pdf-text-layer span\s*{[^}]*font-variant-ligatures:\s*none/.test(css), 'text runs lay out one glyph per character (no kerning / ligatures), like pdf.js paints them');
  ok(/\.selection-popup\s*{[^}]*position:\s*absolute[^}]*transform:\s*translate\(-50%,\s*calc\(-100% - 10px\)\)/s.test(css) && /\.selection-popup\.below\s*{[^}]*translate\(-50%,\s*10px\)/.test(css), 'popup is centred on its anchor, 10 px above the line (or below when flipped)');
  const reader = await read('src/features/reader/pdf/PdfReader.tsx');
  ok(reader.includes('selectionPopupAnchor(') && reader.includes('textSelectionGeometry(pageElement, range)'), 'popup anchor and annotation draft share textSelectionGeometry');
  ok(!/selectionPopup\.x\s*-\s*\(containerRef/.test(reader) && !/x:\s*event\.clientX,\s*y:\s*event\.clientY/.test(reader), 'no client-pixel popup placement is left');
  const popupSource = await read('src/features/reader/pdf/SelectionPopup.tsx');
  ok(popupSource.includes('data-placement={anchor.placement}') && popupSource.includes('left: `${anchor.x}%`'), 'popup renders from the percent anchor');
  const extraction = await read('src/features/reader/pdf/pdfGeometry.ts');
  ok(extraction.includes('styles[item.fontName]'), 'extraction reads the pdf.js text style of each run');
}

await pdf.cleanup?.();
await pdf.loadingTask?.destroy?.();
console.log(`verify-pdf-annotation-geometry: ${checks} checks passed`);
