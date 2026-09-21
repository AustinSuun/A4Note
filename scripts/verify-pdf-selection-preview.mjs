// Contract test for the live text-selection band (card 35496a06): while dragging, the reader paints
// the selection through the highlight layer with the same band geometry the persisted highlight
// will use, the native ::selection stays transparent (restored under forced-colors), and the
// highlight appearance defaults/presets behave as documented.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';

const resolution = registerHooks({
  resolve(specifier, context, next) {
    const inRepoSource = !context.parentURL?.includes('/node_modules/');
    return next(inRepoSource && specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const appearance = await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');
const helpers = await import('../src/features/reader/pdf/pdfAnnotationHelpers.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// ---- geometry: the preview and the persisted highlight share one band function, for every run size / orientation ----
for (const run of [
  { x: 8, y: 12, width: 40, height: 1.6 },          // footnote-sized run
  { x: 8, y: 20, width: 60, height: 2.9 },          // body text
  { x: 8, y: 30, width: 50, height: 5.4 },          // section title
  { x: 90, y: 10, width: 2.9, height: 40, orientation: 90 },
  { x: 8, y: 80, width: 60, height: 2.9, orientation: 180 },
  { x: 4, y: 10, width: 2.9, height: 40, orientation: 270 },
]) {
  const preview = appearance.highlightRects({ ...run, segments: [run] });
  const persisted = appearance.highlightRects({ ...run, segments: [{ ...run }] });
  assert.deepEqual(preview, persisted, `preview and persisted highlight rects are identical for ${JSON.stringify(run)}`);
  checks++;
  const [rect] = preview;
  const vertical = run.orientation === 90 || run.orientation === 270;
  const across = vertical ? rect.width / run.width : rect.height / run.height;
  ok(across >= 0.5 && across <= 0.6, 'band keeps 50–60% of the run across the glyph axis (proportional, not a fixed px height)', { run, rect, across });
  const inset = vertical ? (rect.x - run.x) / run.width : (rect.y - run.y) / run.height;
  ok(inset >= 0.17 && inset <= 0.29, 'band starts after the ascender/descender inset', { run, rect, inset });
}
// Same band for the same run at any zoom: geometry is expressed in page percent.
{
  const run = { x: 10, y: 10, width: 30, height: 2 };
  const a = helpers.highlightPositionStyle(run);
  ok(a.top === '10.56%' && a.height === '1.08%', 'percent geometry is zoom independent', a);
}

// ---- reader wiring ----
{
  const reader = await read('src/features/reader/pdf/PdfReader.tsx');
  assert.match(reader, /document\.addEventListener\('selectionchange', schedule\)/);
  assert.match(reader, /const draft = textSelectionDraft\(pageElement, range, 'highlight'\);\s*\n\s*return draft \? \[\{ \.\.\.draft, color, id: `selection-preview-\$\{index\}` \}\] : \[\];/);
  assert.match(reader, /activeTool === 'highlight' \? activeAnnotationColor : \(SELECTION_PREVIEW_COLOR as AnnotationColor\)/);
  assert.match(reader, /selectionPreview=\{selectionPreviewByPage\[page\.pageNumber\] \?\? \[\]\}/);
  assert.match(reader, /selection\.removeAllRanges\(\);\s*\n\s*setSelectionPreview\(\[\]\);/);
  // finishTextSelection builds its drafts from the same function, so the persisted band equals the preview.
  assert.match(reader, /const draft = textSelectionDraft\(pageElement, range, tool\);/);
  checks += 6;
  const overlay = await read('src/features/reader/pdf/AnnotationOverlay.tsx');
  assert.match(overlay, /selectionPreview\?: readonly AnnotationMarkModel\[\];/);
  assert.match(overlay, /const highlightAnnotations: AnnotationMarkModel\[\] = \[\.\.\.annotations, \.\.\.drafts, \.\.\.selectionPreview\];/);
  assert.doesNotMatch(overlay, /selectionPreview\.map\(/);
  checks += 3;
  const layer = await read('src/features/reader/pdf/PdfHighlightLayer.tsx');
  assert.match(layer, /data-selection-preview=\{mark\.id\?\.startsWith\('selection-preview'\) \? 'true' : undefined\}/);
  checks++;
}

// ---- stylesheet: native selection invisible, text layer box untouched, forced-colors restored ----
{
  const css = await read('src/ui/styles/reader.css');
  assert.match(css, /\.pdf-text-layer\.selectable span::selection \{ background: transparent; color: transparent; \}/);
  assert.match(css, /\.pdf-text-layer\.selectable::selection \{ background: transparent; color: transparent; \}/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*\n\s*\.pdf-text-layer\.selectable span::selection, \.pdf-text-layer\.selectable::selection \{ background: Highlight; color: HighlightText; \}/);
  assert.match(css, /\.pdf-text-layer\.selectable span \{\s*box-sizing: content-box;\s*margin-top: -0\.08em;\s*padding-top: 0\.08em;\s*padding-bottom: 0\.22em;\s*line-height: 1\.12;\s*\}/);
  checks += 4;
}

// ---- appearance: defaults, bounds, control range, preset swatch value ----
{
  ok(appearance.DEFAULT_HIGHLIGHT_OPACITY === 40 && appearance.MIN_HIGHLIGHT_OPACITY === 10 && appearance.MAX_HIGHLIGHT_OPACITY === 60, 'opacity defaults and bounds');
  assert.deepEqual(appearance.HIGHLIGHT_PRESET_FILLS, { yellow: '#ffd54a', green: '#8fd9a3', blue: '#8fb9f2', purple: '#bf9cf0' });
  checks++;
  const control = await read('src/features/reader/HighlightAppearanceControl.tsx');
  assert.match(control, /min=\{MIN_HIGHLIGHT_OPACITY\} max=\{MAX_HIGHLIGHT_OPACITY\}/);
  checks++;
  const constants = await read('src/features/reader/readerConstants.ts');
  assert.match(constants, /if \(color === 'yellow'\) return '#ffd54a';/);
  checks++;
}

console.log(`PDF selection preview: ${checks} assertions passed`);
