// Display-only PDF highlight geometry: neither selection data nor underline geometry changes.
import assert from 'node:assert/strict';
import { extname, } from 'node:path';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, next) {
  const sourceImport = !context.parentURL?.includes('/node_modules/');
  return next(sourceImport && specifier.startsWith('.') && !extname(specifier) ? specifier + '.ts' : specifier, context);
} });
const { highlightRects } = await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');
const { highlightPositionStyle, underlinePositionStyle } = await import('../src/features/reader/pdf/pdfAnnotationHelpers.ts');
hooks.deregister();
const near = (actual, expected, title, tolerance = 0.00001) => assert.ok(Math.abs(actual - expected) < tolerance, `${title}: expected ${expected}, got ${actual}`);
let checks = 0;
function check(title, condition, detail) { assert.ok(condition, `${title}: ${JSON.stringify(detail)}`); checks++; }
const bottom = rect => rect.y + rect.height;
const line = (x, y, width = 70, height = 2) => ({ x, y, width, height });
const raw = line(10, 20);
const before = highlightPositionStyle(raw), underlineBefore = underlinePositionStyle(raw);
const single = highlightRects({ ...raw, segments: [raw] })[0];
check('a single line trims only the visually protruding top', single.y > raw.y && single.y < raw.y + raw.height * 0.15, single);
near(bottom(single), Number.parseFloat(before.top) + Number.parseFloat(before.height), 'single line bottom unchanged'); checks++;
near(single.x, raw.x, 'selection begins at the same character'); near(single.width, raw.width, 'selection ends at the same character'); checks += 2;
check('persisted position is still exactly the selection run', raw.y === 20 && raw.height === 2, raw);
check('underline geometry is unaffected', JSON.stringify(underlinePositionStyle(raw)) === JSON.stringify(underlineBefore), underlineBefore);
for (const size of [0.7, 1.5, 2.8, 5.5]) {
  const rect = highlightRects({ ...raw, height: size })[0];
  check(`top trim scales with glyph size ${size}`, rect.y > raw.y && rect.y < raw.y + size * 0.15, rect);
  near(bottom(rect), raw.y + size * 1.2, 'lower edge preserved at ' + size); checks++;
}
const rows = [line(12, 20), line(11, 22.35), line(10, 24.7)];
const joined = highlightRects({ ...rows[0], segments: rows });
check('three continuous selected lines remain separate horizontal glyph runs', joined.length === 3 && joined.every((rect, index) => rect.x === rows[index].x && rect.width === rows[index].width), joined);
for (let i = 0; i < joined.length - 1; i++) {
  check(`normal line ${i + 1} meets the following highlight with fractional-pixel overlap`, bottom(joined[i]) > joined[i + 1].y && bottom(joined[i]) - joined[i + 1].y < rows[i].height * 0.08, joined);
}
near(bottom(joined.at(-1)), bottom(single) + 4.7, 'last line keeps original lower edge'); checks++;
const paragraph = [rows[0], line(11, 26.2)];
const apart = highlightRects({ ...paragraph[0], segments: paragraph });
near(bottom(apart[0]), bottom(single), 'paragraph gap never bridged'); checks++;
const twoColumns = [line(4, 20, 26), line(66, 22.35, 27)];
const columns = highlightRects({ ...twoColumns[0], segments: twoColumns });
near(bottom(columns[0]), bottom(single), 'different columns never stitched'); checks++;
const narrowColumns = [line(30,20,18),line(55,22.35,18)];
const narrow = highlightRects({ ...narrowColumns[0], segments:narrowColumns });
near(bottom(narrow[0]), bottom(single), 'adjacent narrow columns cannot appear to be a wrapped text line'); checks++;
const mixedFont = [line(10, 20), line(10, 22.35, 2, 0.7)];
const footnote = highlightRects({ ...mixedFont[0], segments: mixedFont });
near(bottom(footnote[0]), bottom(single), 'superscript / tiny run does not join body highlight'); checks++;
for (const angle of [90, 180, 270]) {
  const rotated = { x: 40, y: 20, width: 2, height: 30, orientation: angle };
  const rect = highlightRects({ ...rotated, segments: [rotated] })[0];
  const style = highlightPositionStyle(rotated);
  check(`rotated ${angle} keeps original glyph axis`, rect.x === Number.parseFloat(style.left) && rect.y === Number.parseFloat(style.top) && rect.width === Number.parseFloat(style.width) && rect.height === Number.parseFloat(style.height), rect);
}
for (const scale of [1, 1.25, 1.5]) {
  const toPx = y => y / 100 * 792 * scale;
  check(`${scale * 100}% zoom has no anti-aliased white line seam`, toPx(bottom(joined[0]) - joined[1].y) >= 0.3 * scale);
}
console.log(JSON.stringify({ passed: checks }));
