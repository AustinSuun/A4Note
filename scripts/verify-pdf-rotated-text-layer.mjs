// Regression for reader text-layer geometry on pages with /Rotate (audit 4de2cac5 §6, card e8106251).
// Builds tiny PDFs with the real pdf.js build, extracts text boxes exactly like PdfReader does, and
// checks against the rendered bitmap: every span must cover its glyphs, stay on the page, keep its
// reading order, and produce highlight/underline geometry along the glyph axis for 0/90/180/270.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const requireFromPdf = createRequire(import.meta.resolve('pdfjs-dist/package.json'));
const { createCanvas } = requireFromPdf('@napi-rs/canvas');
const fontPath = join(dirname(requireFromPdf.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
const evidenceDir = process.env.ROTATED_TEXT_LAYER_EVIDENCE_DIR || '';
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

const resolution = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const geometry = await import('../src/features/reader/pdf/pdfGeometry.ts');
const selection = await import('../src/features/reader/pdf/pdfSelection.ts');
const helpers = await import('../src/features/reader/pdf/pdfAnnotationHelpers.ts');
const appearance = await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');
const search = await import('../src/features/reader/pdf/pdfSearch.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message, { actual, expected });
const percent = (value) => parseFloat(value);

const LINES = [
  { text: 'Rotated searchable line', x: 50, y: 740 },
  { text: 'Second rotated line', x: 50, y: 712 },
  { text: 'Third line near the end', x: 50, y: 684 },
];
const FONT_SIZE = 18;

function buildPdf({ width = 612, height = 792, rotate = 0, runs }) {
  const stream = runs.map((run) => `BT /F1 ${FONT_SIZE} Tf ${run.x} ${run.y} Td (${run.text}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${rotate} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function openFixture(data) {
  const task = getDocument({ data: new Uint8Array(data), standardFontDataUrl: fontPath });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  // Same call as PdfReader's page metadata: the intrinsic /Rotate is folded into the viewport.
  const viewport = page.getViewport({ scale: 1 });
  const items = await geometry.extractTextItemBoxes(page, viewport);
  return { task, page, viewport, items };
}

async function renderPage(page, viewport) {
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { canvas, context };
}

function inkBounds(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset] + data[offset + 1] + data[offset + 2] >= 384) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  return left === Infinity ? null : { left, top, right, bottom };
}

const toPixels = (box, viewport) => ({ left: (box.x / 100) * viewport.width, top: (box.y / 100) * viewport.height, width: (box.width / 100) * viewport.width, height: (box.height / 100) * viewport.height });
const inflate = (box, amount) => ({ x: box.x - amount, y: box.y - amount, width: box.width + amount * 2, height: box.height + amount * 2 });
const area = (box) => Math.max(box.width, 0) * Math.max(box.height, 0);
const coverage = (rect, box) => { const hit = selection.intersectionBox(rect, box); return hit ? area(hit) / area(box) : 0; };
const onPage = (box) => box.x >= -0.01 && box.y >= -0.01 && box.x + box.width <= 100.01 && box.y + box.height <= 100.01;
const styleBox = (style) => ({ x: percent(style.left), y: percent(style.top), width: percent(style.width), height: percent(style.height) });

function saveEvidence(name, canvas, context, viewport, items, marks) {
  if (!evidenceDir) return;
  context.lineWidth = 1;
  for (const rect of marks.highlight) { const b = toPixels(rect, viewport); context.fillStyle = 'rgba(255, 229, 121, 0.5)'; context.fillRect(b.left, b.top, b.width, b.height); }
  for (const rect of marks.underline) { const b = toPixels(rect, viewport); context.fillStyle = 'rgba(40, 90, 220, 0.95)'; context.fillRect(b.left, b.top, b.width, b.height); }
  for (const item of items) { const b = toPixels(item, viewport); context.strokeStyle = 'rgba(220, 0, 0, 0.9)'; context.strokeRect(b.left + 0.5, b.top + 0.5, b.width, b.height); }
  writeFileSync(join(evidenceDir, name), canvas.toBuffer('image/png'));
}

for (const rotate of [0, 90, 180, 270]) {
  const vertical = rotate === 90 || rotate === 270;
  // ---- one run: the span must sit exactly on the painted glyphs ----
  {
    const { task, page, viewport, items } = await openFixture(buildPdf({ rotate, runs: LINES.slice(0, 1) }));
    try {
      near(viewport.width, vertical ? 792 : 612, `rotate ${rotate}: viewport width follows /Rotate`);
      near(viewport.height, vertical ? 612 : 792, `rotate ${rotate}: viewport height follows /Rotate`);
      ok(items.length === 1 && items[0].text === LINES[0].text, `rotate ${rotate}: one text item`, items);
      const item = items[0];
      ok(onPage(item), `rotate ${rotate}: span stays inside the page`, item);
      if (rotate === 0) ok(!('orientation' in item), 'horizontal runs keep the legacy box shape (no orientation key)', item);
      else ok(item.orientation === rotate, `rotate ${rotate}: run orientation detected`, item);
      const box = toPixels(item, viewport);
      ok(vertical ? box.height > box.width * 4 : box.width > box.height * 4, `rotate ${rotate}: span follows the run direction`, box);
      const { canvas, context } = await renderPage(page, viewport);
      const ink = inkBounds(context, canvas.width, canvas.height);
      ok(ink, `rotate ${rotate}: bitmap has glyph pixels`);
      const slack = 2.5;
      ok(ink.left >= box.left - slack && ink.top >= box.top - slack && ink.right <= box.left + box.width + slack && ink.bottom <= box.top + box.height + slack,
        `rotate ${rotate}: every glyph pixel lies inside the span box`, { ink, box });
      const gap = item.fontSize * 0.5;
      ok(box.left >= ink.left - gap && box.top >= ink.top - gap && box.left + box.width <= ink.right + gap && box.top + box.height <= ink.bottom + gap,
        `rotate ${rotate}: the span box hugs the glyphs (no off-page or oversized box)`, { ink, box });
      saveEvidence(`rotate-${rotate}-single-run.png`, canvas, context, viewport, items, { highlight: [], underline: [] });
    } finally { await task.destroy(); }
  }
  // ---- three runs: reading order, drag selection, marks, offsets, search ----
  {
    const { task, page, viewport, items } = await openFixture(buildPdf({ rotate, runs: LINES }));
    try {
      ok(items.length === 3, `rotate ${rotate}: three text items`, items.map((item) => item.text));
      ok(items.every(onPage), `rotate ${rotate}: all spans inside the page`, items);
      const lines = selection.groupTextItemsIntoLines(items);
      assert.deepEqual(lines.map((line) => line.map((item) => item.text).join(' ')), LINES.map((line) => line.text), `rotate ${rotate}: line grouping keeps reading order`);
      checks++;
      const first = items.find((item) => item.text === LINES[0].text);
      const second = items.find((item) => item.text === LINES[1].text);
      const drag = selection.textSelectionFromDrag(items, inflate(first, 0.3));
      ok(drag && drag.quote === LINES[0].text, `rotate ${rotate}: dragging along the first line selects only it`, drag);
      ok(drag.position.segments.length === 1, `rotate ${rotate}: one segment`, drag.position.segments);
      const [segment] = drag.position.segments;
      if (rotate === 0) ok(!('orientation' in segment), 'horizontal segments stay unchanged (no orientation key)', segment);
      else ok(segment.orientation === rotate, `rotate ${rotate}: segment remembers the run direction`, segment);
      const everything = selection.textSelectionFromDrag(items, selection.boundingBox(items));
      ok(everything.quote === LINES.map((line) => line.text).join(' '), `rotate ${rotate}: multi-line drag quotes in reading order`, everything.quote);
      ok(everything.position.segments.length === 3, `rotate ${rotate}: one segment per line`);
      const [highlight] = appearance.highlightRects(drag.position);
      ok(highlight && onPage(highlight), `rotate ${rotate}: highlight rect stays on the page`, highlight);
      // The highlight band trims ascender/descender slack, so it lies inside the run and covers at least half of it across.
      ok(coverage(first, highlight) >= 0.999 && coverage(highlight, first) >= 0.5, `rotate ${rotate}: highlight band lies inside the run box`, { highlight, first });
      if (vertical) ok(Math.abs(highlight.y - first.y) < 1e-9 && Math.abs(highlight.height - first.height) < 1e-9 && highlight.x > first.x && highlight.x + highlight.width < first.x + first.width, `rotate ${rotate}: highlight band is trimmed along x (glyph axis)`, { highlight, first });
      else ok(Math.abs(highlight.x - first.x) < 1e-9 && Math.abs(highlight.width - first.width) < 1e-9 && highlight.y > first.y && highlight.y + highlight.height < first.y + first.height, `rotate ${rotate}: highlight band is trimmed along y (glyph axis)`, { highlight, first });
      const rule = styleBox(helpers.underlinePositionStyle(segment));
      ok(onPage(rule), `rotate ${rotate}: underline stays on the page`, rule);
      // Horizontal and 180° rules keep the stylesheet contract (`top` is the rule's bottom edge, CSS lifts it); vertical rules stay in place.
      if (rotate === 0) ok(rule.y <= first.y + first.height + 1e-9 && rule.y >= first.y + first.height * 0.6 && Math.abs(rule.width - first.width) < 1e-9 && rule.height < first.height * 0.5, 'rotate 0: underline sits in the descender slack under the baseline', { rule, first });
      if (rotate === 90) ok(rule.x >= first.x - 1e-9 && rule.x + rule.width <= first.x + first.width * 0.3 && Math.abs(rule.height - first.height) < 1e-9 && Math.abs(rule.y - first.y) < 1e-9 && rule.width < first.width * 0.5, 'rotate 90: underline runs along the left (descender) edge', { rule, first });
      if (rotate === 180) ok(rule.y >= first.y - 1e-9 && rule.y <= first.y + first.height * 0.3 && Math.abs(rule.width - first.width) < 1e-9 && rule.height < first.height * 0.5, 'rotate 180: underline sits in the top descender slack (baseline on top)', { rule, first });
      if (rotate === 270) ok(rule.x + rule.width <= first.x + first.width + 1e-9 && rule.x >= first.x + first.width * 0.7 && Math.abs(rule.height - first.height) < 1e-9 && Math.abs(rule.y - first.y) < 1e-9 && rule.width < first.width * 0.5, 'rotate 270: underline runs along the right (descender) edge', { rule, first });
      const itemIndex = items.indexOf(first);
      const offsets = [{ itemIndex, startOffset: 0, endOffset: 7 }];
      const ratio = 7 / first.text.length;
      const [slice] = selection.textSelectionRectsFromOffsets(items, offsets);
      ok(coverage(first, slice) >= 0.999, `rotate ${rotate}: offset slice lies inside the run`, { slice, first });
      if (rotate === 0) { near(slice.x, first.x, 'rotate 0: slice starts at the left'); near(slice.width, first.width * ratio, 'rotate 0: slice length'); near(slice.height, first.height, 'rotate 0: slice height'); }
      if (rotate === 90) { near(slice.y, first.y, 'rotate 90: slice starts at the top'); near(slice.height, first.height * ratio, 'rotate 90: slice length'); near(slice.width, first.width, 'rotate 90: slice width'); }
      if (rotate === 180) { near(slice.x + slice.width, first.x + first.width, 'rotate 180: slice starts at the right'); near(slice.width, first.width * ratio, 'rotate 180: slice length'); }
      if (rotate === 270) { near(slice.y + slice.height, first.y + first.height, 'rotate 270: slice starts at the bottom'); near(slice.height, first.height * ratio, 'rotate 270: slice length'); }
      ok(selection.dominantTextOrientation(items, offsets) === rotate, `rotate ${rotate}: dominant orientation of a native selection`);
      ok(selection.textItemsSeparated(second, first), `rotate ${rotate}: consecutive lines are separated for search`, { first, second });
      const found = search.findPdfMatches([{ pageNumber: 1, textItems: items }], 'searchable line Second rotated');
      ok(found.matches.length === 1, `rotate ${rotate}: search joins lines with a space`, found);
      const { canvas, context } = await renderPage(page, viewport);
      saveEvidence(`rotate-${rotate}-marks.png`, canvas, context, viewport, items, { highlight: [highlight], underline: [rule] });
    } finally { await task.destroy(); }
  }
}

// ---- pure helpers: vertical column merge and orientation tagging ----
{
  const columns = selection.mergeRectsIntoLineSegments([
    { x: 10, y: 10, width: 2, height: 5 },
    { x: 10.5, y: 15.5, width: 2, height: 5 },
    { x: 20, y: 10, width: 2, height: 5 },
  ], 90);
  assert.deepEqual(columns, [{ x: 10, y: 10, width: 2.5, height: 10.5 }, { x: 20, y: 10, width: 2, height: 5 }]);
  checks++;
  const rows = selection.mergeRectsIntoLineSegments([{ x: 10, y: 10, width: 5, height: 2 }, { x: 15.5, y: 10.5, width: 5, height: 2 }]);
  assert.deepEqual(rows, [{ x: 10, y: 10, width: 10.5, height: 2.5 }], 'horizontal merge unchanged');
  checks++;
  const plain = [{ x: 1, y: 2, width: 3, height: 4 }];
  ok(selection.withSegmentOrientation(plain, 0) === plain, 'horizontal segments are returned untouched');
  assert.deepEqual(selection.withSegmentOrientation(plain, 270), [{ x: 1, y: 2, width: 3, height: 4, orientation: 270 }]);
  checks++;
  ok(selection.textItemOrientation({ orientation: 45 }) === 0 && selection.textItemOrientation(undefined) === 0, 'unknown orientations fall back to horizontal');
  for (const [transform, expected] of [[[12, 0, 0, 12, 0, 0], 0], [[0, 12, 12, 0, 0, 0], 90], [[-12, 0, 0, 12, 0, 0], 180], [[0, -12, -12, 0, 0, 0], 270], [[11, 1, -1, 11, 0, 0], 0]]) {
    ok(geometry.textOrientationFromTransform(transform) === expected, `orientation from transform ${transform.join(',')}`);
  }
  const highlight90 = styleBox(helpers.highlightPositionStyle({ x: 40, y: 10, width: 2, height: 30, orientation: 90 }));
  near(highlight90.x, 40.36, 'rotate 90 highlight: descent inset (18%) on the left edge');
  near(highlight90.width, 1.08, 'rotate 90 highlight: band width');
  ok(highlight90.y === 10 && highlight90.height === 30, 'rotate 90 highlight keeps the run length', highlight90);
  const highlight270 = styleBox(helpers.highlightPositionStyle({ x: 40, y: 10, width: 2, height: 30, orientation: 270 }));
  near(highlight270.x, 40.56, 'rotate 270 highlight: ascent inset (28%) on the left edge');
  const highlight180 = styleBox(helpers.highlightPositionStyle({ x: 10, y: 20, width: 30, height: 2, orientation: 180 }));
  near(highlight180.y, 20.36, 'rotate 180 highlight: descent inset on top');
  near(highlight180.height, 1.08, 'rotate 180 highlight: band height');
  const highlight0 = styleBox(helpers.highlightPositionStyle({ x: 10, y: 20, width: 30, height: 2 }));
  near(highlight0.y, 20.56, 'horizontal highlight unchanged: top inset');
  near(highlight0.height, 1.08, 'horizontal highlight unchanged: band');
  ok(highlight0.x === 10 && highlight0.width === 30, 'horizontal highlight unchanged: x/width', highlight0);
  const underline90 = styleBox(helpers.underlinePositionStyle({ x: 40, y: 10, width: 2, height: 30, orientation: 90 }));
  ok(underline90.x >= 40 && underline90.x + underline90.width <= 40.4 && underline90.y === 10 && underline90.height === 30, 'rotate 90 underline: thin rule inside the left descender strip, full run length', underline90);
  const underline270 = styleBox(helpers.underlinePositionStyle({ x: 40, y: 10, width: 2, height: 30, orientation: 270 }));
  ok(underline270.x >= 41.6 && underline270.x + underline270.width <= 42 && underline270.height === 30, 'rotate 270 underline: thin rule inside the right descender strip', underline270);
  const underline0 = styleBox(helpers.underlinePositionStyle({ x: 10, y: 20, width: 30, height: 2 }));
  near(underline0.y, Math.min(20 + 2 - 0.4 + 0.12 + 0.16, 22), 'horizontal underline unchanged: rule bottom edge');
}

// ---- the text layer must lay rotated runs out along their reading direction ----
{
  const textLayerSource = await readFile(new URL('../src/features/reader/pdf/PdfTextLayer.tsx', import.meta.url), 'utf8');
  assert.match(textLayerSource, /writingMode: 'vertical-rl'/);
  assert.match(textLayerSource, /textOrientation: 'sideways'/);
  assert.match(textLayerSource, /data-text-orientation=/);
  const readerCss = await readFile(new URL('../src/ui/styles/reader.css', import.meta.url), 'utf8');
  assert.match(readerCss, /\.annotation-mark\.underline\.vertical-rule \{[^}]*transform: none/);
  const markSource = await readFile(new URL('../src/features/reader/pdf/AnnotationMark.tsx', import.meta.url), 'utf8');
  assert.match(markSource, /segment\.orientation === 90 \|\| segment\.orientation === 270\) \? 'vertical-rule'/);
  checks += 5;
}

console.log(`PDF rotated text layer: ${checks} assertions passed${evidenceDir ? ` (evidence in ${evidenceDir})` : ''}`);
