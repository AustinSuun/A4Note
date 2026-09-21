// Task 540986ab — PDF text annotations edit in place, no automatic settings popover,
// compact one-line default box that grows with its content.
// Pure-logic checks of pdfTextAnnotation.ts plus source contracts on the wiring.
// The browser walk-through with screenshots lives in verify-pdf-text-annotation-browser.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const text = await import('../src/features/reader/pdf/pdfTextAnnotation.ts');
resolution.deregister();

let passed = 0;
const check = (condition, name) => { assert.ok(condition, name); passed += 1; };

// --- units and layout ---------------------------------------------------------
const legacy = text.textAnnotationLayout({ x: 10, y: 60, width: 22, height: 7, fontSize: 13 });
check(legacy.fontUnit === 'px' && legacy.autoWidth === false && legacy.fontSize === 13, 'legacy annotations keep fixed pixels and fixed width');
const fresh = text.textAnnotationLayout({ x: 10, y: 10, width: 0, height: 0, fontSize: 16, fontUnit: 'page', autoWidth: true, maxWidth: 60 });
check(fresh.fontUnit === 'page' && fresh.autoWidth && fresh.maxWidth === 60, 'new annotations use page units and auto width');
check(text.textAnnotationLayout({ fontUnit: 'page', autoWidth: false, fontSize: 16 }).autoWidth === false, 'manual resize flag turns auto width off');
check(text.textLength(16, 'page') === 'calc(var(--pdf-display-zoom, 1) * 16px)' && text.textLength(13, 'px') === '13px', 'font length follows the zoom variable only for page units');
check(text.TEXT_DEFAULT_FONT_SIZE === 24 && text.TEXT_FONT_SIZE_OPTIONS.length === 32 && text.TEXT_FONT_SIZE_OPTIONS[0] === 2 && text.TEXT_FONT_SIZE_OPTIONS.at(-1) === 64, 'default font size is 24 and selector covers 2–64 step 2');

const autoStyle = text.textBoxStyle({ x: 30, y: 10 }, fresh);
check(autoStyle.width === 'auto' && autoStyle.height === 'auto' && autoStyle.maxWidth === '60%', 'auto box hugs content up to its max width');
const nearRight = text.textBoxStyle({ x: 70, y: 10 }, fresh);
check(nearRight.maxWidth === '28.5%', 'max width shrinks to the remaining page width minus the edge margin');
const fixedStyle = text.textBoxStyle({ x: 10, y: 60, width: 22, height: 7 }, legacy);
check(fixedStyle.width === '22%' && fixedStyle.minHeight === '7%' && fixedStyle.height === 'auto', 'fixed box keeps its width and never clips below the stored height');
const typography = text.textTypographyStyle(fresh);
check(typography.lineHeight === text.TEXT_LINE_HEIGHT && typography.fontWeight === 500 && String(typography.padding).includes('--pdf-display-zoom'), 'padding scales with zoom so the box proportion is stable');

// --- placement near edges -----------------------------------------------------
const middle = text.placeNewTextBox({ x: 30, y: 20, pageWidthPx: 612, pageHeightPx: 792, fontPx: 16 });
check(middle.x === 30 && middle.y === 20 && middle.maxWidth === 60, 'a click in the page body keeps its anchor and the 60% cap');
const right = text.placeNewTextBox({ x: 97, y: 20, pageWidthPx: 612, pageHeightPx: 792, fontPx: 16 });
check(right.x < 97 && right.x + right.maxWidth <= 100 - text.TEXT_EDGE_MARGIN_PERCENT + 1e-9 && right.maxWidth >= (16 * text.TEXT_MIN_WIDTH_EM / 612) * 100 - 1e-9, 'a click at the right edge moves the anchor left so a few characters fit');
const bottom = text.placeNewTextBox({ x: 30, y: 99.5, pageWidthPx: 612, pageHeightPx: 792, fontPx: 16 });
check(bottom.y === 100 - text.TEXT_EDGE_MARGIN_PERCENT, 'a click below the bottom margin is pulled back onto the page');
const clamped = text.clampTextBoxToPage({ x: 30, y: 98, width: 20, height: 6 });
check(clamped.y === 100 - text.TEXT_EDGE_MARGIN_PERCENT - 6 && clamped.x === 30, 'a measured box that would overflow the bottom shifts up instead of clipping');
const clampedRight = text.clampTextBoxToPage({ x: 95, y: 10, width: 20, height: 6 });
check(clampedRight.x === 80, 'a measured box wider than the remaining page shifts left');

// --- text normalisation -------------------------------------------------------
check(text.normalizeInlineText('a\u00a0b\r\nc\n\n') === 'a b\nc', 'editor text drops NBSP/CRLF artefacts and trailing blank lines');
check(text.normalizeInlineText('\u200b') === '', 'zero-width placeholders count as empty');
check(text.roundPercent(12.34567) === 12.346, 'percent geometry is stored with 3 decimals');

// --- source contracts ---------------------------------------------------------
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const reader = read('src/features/reader/pdf/PdfReader.tsx');
check(/if \(activeTool === 'text'\) \{[\s\S]*?setInlineText\(\{[\s\S]*?onCompleteOneShotTool\?\.\(\);\s*return;/.test(reader), 'text tool opens the inline editor instead of the comment popover');
check(/if \(annotation\.type === 'text'\) \{[\s\S]*?setInlineText\(\{\s*annotationId: annotation\.id/.test(reader), 'editing an existing text annotation happens in place');
check(reader.includes("void saves.run('删除标注', async () => onDeleteAnnotation(annotation.id), reopen, annotation.id);"), 'an emptied text annotation is removed on commit');
check(reader.includes('autoWidth: false'), 'manual resize turns the box into a fixed width');
const mark = read('src/features/reader/pdf/AnnotationMark.tsx');
check(mark.includes('<InlineTextEditor') && mark.includes('textBoxStyle(segment, textLayout)'), 'AnnotationMark renders the inline editor and the content-sized box');
const editor = read('src/features/reader/pdf/InlineTextEditor.tsx');
check(editor.includes('contentEditable="plaintext-only"') && editor.includes("event.key === 'Escape'") && editor.includes('isComposing'), 'editor is plain text, Escape finishes, IME composition is respected');
check(!/onKeyDown[\s\S]*?event\.key === 'Enter' && !\(/.test(editor), 'plain Enter keeps inserting a line break');
const toolbar = read('src/features/reader/ReaderToolbar.tsx');
check(!toolbar.includes('contextAnnotationTool ?? toolSettingsOpenFor'), 'selecting an annotation no longer auto-opens the tool settings popover');
check(toolbar.includes("contextAnnotationId && contextAnnotationTool === tool && toolHasSettings(tool)"), 'the lit tool button opens the selected annotation settings on demand');
const pageView = read('src/features/reader/pdf/PdfPageView.tsx');
check(pageView.includes("'--pdf-display-zoom': displayZoom"), 'render layer publishes the zoom for page-unit fonts');
const types = read('src/features/reader/pdf/types.ts');
check(/textFontSize: 24,/.test(types), 'tool default font size raised to 24');

console.log(`verify-pdf-text-annotation: ${passed} checks passed`);
