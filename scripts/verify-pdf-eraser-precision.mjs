// Regression for the eraser (card 8dba61be follow-up): erasing must remove only what the eraser
// actually covers instead of dropping a whole sparse polyline edge, and the pointer must stop
// erasing (and stop drifting) once it leaves the page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';

const resolution = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { eraseInkPosition, eraserSpanOnSegment, pointInsideEraser } = await import('../src/features/reader/pdf/pdfInk.ts');
const { pdfPointerCoordinates } = await import('../src/features/reader/pdf/pdfCoordinates.ts');
resolution.deregister();

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
let checks = 0;
const check = (label, fn) => { fn(); checks += 1; console.log(`  ok  ${label}`); };

const points = (position) => position.points.map((point) => (point ? { x: round(point.x), y: round(point.y) } : null));
const round = (value) => Math.round(value * 1000) / 1000;
const stroke = (list) => ({ x: 0, y: 0, width: 100, height: 1, strokeWidth: 3, points: list });

console.log('eraser hit-test geometry');

check('eraser that misses the stroke leaves it untouched (identity)', () => {
  const position = stroke([{ x: 10, y: 10 }, { x: 20, y: 10 }]);
  assert.equal(eraseInkPosition(position, { x: 80, y: 80 }, 2, 2, 'round'), position);
});

check('a long sparse edge is clipped, not discarded wholesale', () => {
  // The pen only samples every ~0.16%, so one edge can span the page. Erasing at its middle must
  // keep both far ends instead of deleting the entire run.
  const position = stroke([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 50, y: 50 }, 5, 5, 'round');
  assert.ok(next && next !== position, 'expected the stroke to change');
  assert.deepEqual(points(next), [
    { x: 0, y: 50 }, { x: 45, y: 50 },
    null,
    { x: 55, y: 50 }, { x: 100, y: 50 },
  ]);
});

check('erased gap width matches the eraser diameter', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 50, y: 50 }, 3, 3, 'round');
  const list = points(next);
  const gap = list[3].x - list[1].x;
  assert.equal(round(gap), 6, `gap ${gap} should equal the 2*radius diameter`);
});

check('grazing the very edge of a segment does not erase a whole block', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  // Eraser centred 2.9 above the line with radius 3: it barely clips the stroke.
  const next = eraseInkPosition(position, { x: 50, y: 52.9 }, 3, 3, 'round');
  const list = points(next);
  const gap = list[3].x - list[1].x;
  assert.ok(gap < 3, `a graze should remove a sliver, removed ${gap}`);
});

check('surviving endpoints keep their original coordinates', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 50, y: 50 }, 5, 5, 'round');
  const list = points(next);
  assert.deepEqual(list[0], { x: 0, y: 50 });
  assert.deepEqual(list[list.length - 1], { x: 100, y: 50 });
});

check('erasing every point deletes the annotation (null)', () => {
  const position = stroke([{ x: 50, y: 50 }, { x: 51, y: 50 }]);
  assert.equal(eraseInkPosition(position, { x: 50.5, y: 50 }, 20, 20, 'round'), null);
});

check('an eraser fully covering one end trims only that end', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 0, y: 50 }, 10, 10, 'round');
  const list = points(next);
  assert.equal(list[0].x, 10, 'stroke should now start at the eraser boundary');
  assert.equal(list[list.length - 1].x, 100, 'far end must be preserved');
  assert.ok(!list.includes(null), 'trimming one end must not split the run');
});

check('square eraser clips on its box boundary', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 50, y: 50 }, 4, 4, 'square');
  const list = points(next);
  assert.equal(round(list[1].x), 46);
  assert.equal(round(list[3].x), 54);
});

check('anisotropic radii are honoured per axis', () => {
  const span = eraserSpanOnSegment({ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 50, y: 50 }, 10, 1, 'round');
  assert.ok(span, 'expected a hit');
  assert.equal(round(span[0] * 100), 40);
  assert.equal(round(span[1] * 100), 60);
});

check('a segment entirely outside the eraser reports no span', () => {
  assert.equal(eraserSpanOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 50 }, 3, 3, 'round'), null);
});

check('existing run separators (null) survive erasing', () => {
  const position = stroke([{ x: 0, y: 50 }, { x: 20, y: 50 }, null, { x: 60, y: 50 }, { x: 100, y: 50 }]);
  const next = eraseInkPosition(position, { x: 80, y: 50 }, 5, 5, 'round');
  const list = points(next);
  assert.equal(list.filter((point) => point === null).length, 2, 'original + new separator');
  assert.deepEqual(list[0], { x: 0, y: 50 });
});

check('bounding box is recomputed from the surviving points', () => {
  const position = stroke([{ x: 10, y: 50 }, { x: 90, y: 50 }]);
  const next = eraseInkPosition(position, { x: 10, y: 50 }, 20, 20, 'round');
  assert.equal(round(next.x), 30, 'x should move to the new left-most point');
  assert.ok(next.width > 0 && next.height > 0);
});

check('pointInsideEraser matches the round/square contract', () => {
  assert.equal(pointInsideEraser({ x: 3, y: 3 }, { x: 0, y: 0 }, 5, 5, 'round'), true);
  assert.equal(pointInsideEraser({ x: 4.9, y: 4.9 }, { x: 0, y: 0 }, 5, 5, 'round'), false);
  assert.equal(pointInsideEraser({ x: 4.9, y: 4.9 }, { x: 0, y: 0 }, 5, 5, 'square'), true);
});

console.log('\nshared pointer coordinates');

const renderRect = { left: 424.2, top: -137.4, width: 731.6, height: 1034.85 };
const renderLayer = { getBoundingClientRect: () => renderRect };
const pageElement = {
  classList: { contains: (name) => name === 'pdf-page' },
  closest: () => null,
  querySelector: (selector) => selector === '.pdf-render-layer' ? renderLayer : null,
};

check('preview pixels and hit percentages come from one fractional scrolled rect', () => {
  const sample = pdfPointerCoordinates(
    pageElement,
    renderRect.left + renderRect.width * 0.75,
    renderRect.top + renderRect.height * 0.34,
  );
  assert.ok(sample?.inside);
  assert.equal(round(sample.xPx), round(renderRect.width * 0.75));
  assert.equal(round(sample.yPx), round(renderRect.height * 0.34));
  assert.equal(round(sample.xPercent), 75);
  assert.equal(round(sample.yPercent), 34);
});

check('raw coordinates stay continuous outside and on re-entry without clamping', () => {
  const inside = pdfPointerCoordinates(pageElement, renderRect.left + renderRect.width - 0.25, 200);
  const outside = pdfPointerCoordinates(pageElement, renderRect.left + renderRect.width + 5, 200);
  const returned = pdfPointerCoordinates(pageElement, renderRect.left + renderRect.width - 0.25, 200);
  assert.equal(inside.inside, true);
  assert.equal(outside.inside, false);
  assert.ok(outside.xPercent > 100, 'off-page sample must remain raw instead of snapping to 100%');
  assert.equal(returned.xPx, inside.xPx, 're-entry must return to the same pixel without a jump');
  assert.equal(returned.xPercent, inside.xPercent);
});

console.log('\npointer mapping contract (source)');

const readerSource = readFileSync(resolve(repoRoot, 'src/features/reader/pdf/PdfReader.tsx'), 'utf8');
const eraseBody = readerSource.slice(
  readerSource.indexOf('function eraseInkAtPointer'),
  readerSource.indexOf('function updateEraserCursor'),
);
const cursorBody = readerSource.slice(
  readerSource.indexOf('function updateEraserCursor'),
  readerSource.indexOf('const createTextAnnotationAtPointer'),
);

check('eraser does not use the clamping pointFromEvent helper', () => {
  assert.ok(eraseBody.length > 0, 'eraseInkAtPointer must exist');
  assert.ok(!/pointFromEvent\(/.test(eraseBody), 'clamped pointer would smear erasing along the page edge');
});

check('preview and hit testing use the same raw coordinate sample', () => {
  assert.match(eraseBody, /pdfPointerCoordinates\(event\.currentTarget, event\.clientX, event\.clientY\)/);
  assert.match(cursorBody, /pdfPointerCoordinates\(event\.currentTarget, event\.clientX, event\.clientY\)/);
  assert.ok(!/event\.clientX\s*-\s*rect\.left/.test(eraseBody), 'erase must not duplicate the transform');
  assert.ok(!/event\.clientX\s*-\s*rect\.left/.test(cursorBody), 'preview must not duplicate the transform');
});

check('eraser rejects every off-page sample before touching ink', () => {
  assert.match(eraseBody, /if \(!pointer\?\.inside\) return/);
  assert.ok(!/100\s*\+\s*radius[XY]/.test(eraseBody), 'one-radius off-page mutations are forbidden');
});

check('cursor preview is no longer clamped to the page box', () => {
  assert.ok(cursorBody.length > 0, 'updateEraserCursor must exist');
  assert.ok(!/clamp\(x,\s*0,\s*rect\.width\)/.test(cursorBody), 'clamped ring drifts away from the real cursor');
});

check('cursor preview is cleared immediately outside the page instead of retaining a stale ring', () => {
  assert.match(cursorBody, /if \(!pointer\?\.inside\)/);
  assert.match(cursorBody, /setEraserCursor\(null\)/);
  assert.ok(!/rect\.width\s*\*\s*0\.15/.test(cursorBody), 'the old dead zone kept the last cursor position visible');
});

check('eraser uses pointer capture so a pressed stroke has one coordinate owner across boundaries', () => {
  assert.match(readerSource, /activeTool === 'eraser'[\s\S]{0,500}setPointerCapture\(event\.pointerId\)/);
  assert.match(readerSource, /finishEraserPointer\(event\)/);
  assert.match(readerSource, /onPointerLeave:[\s\S]{0,180}setEraserCursor\(null\)/);
});

check('rapid eraser samples accumulate from cached geometry rather than stale annotation props', () => {
  assert.match(eraseBody, /eraserPositionsRef\.current\.get\(annotation\.id\)/);
  assert.match(eraseBody, /const previousPosition = cached \?\? annotation\.positionJson/);
  assert.match(eraseBody, /eraseInkPosition\(previousPosition,/);
  assert.match(eraseBody, /eraserPositionsRef\.current\.set\(annotation\.id, nextPosition\)/);
});

console.log(`\nverify-pdf-eraser-precision: ${checks} checks passed`);
