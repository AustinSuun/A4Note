// Task ae61143f: viewport ↔ layout conversion under root CSS zoom + popover clamping/flipping.
// Run: node --experimental-strip-types scripts/verify-viewport-to-layout.mjs
import assert from 'node:assert/strict';
import {
  clampPopoverPosition, layoutViewportSize, parseZoomValue, placePopoverAtPointer, pointerToElementLayout,
  readRootZoom, rectToLayout, viewportDeltaToLayout, viewportLengthToLayout, viewportPointToLayout,
} from '../src/shared/ui/viewportToLayout.ts';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

check('parseZoomValue accepts factors, percentages and rejects keywords', () => {
  assert.equal(parseZoomValue('1.18'), 1.18);
  assert.equal(parseZoomValue('118%'), 1.18);
  assert.equal(parseZoomValue('150%'), 1.5);
  assert.equal(parseZoomValue('normal'), null);
  assert.equal(parseZoomValue(''), null);
  assert.equal(parseZoomValue(undefined), null);
  assert.equal(parseZoomValue('0'), null);
});

check('readRootZoom measures rect/offset first, then falls back to computed zoom and --ui-zoom', () => {
  const measured = { offsetWidth: 1000, getBoundingClientRect: () => ({ width: 1180 }), ownerDocument: null };
  assert.equal(readRootZoom(measured), 1.18);
  const legacy = { offsetWidth: 1000, getBoundingClientRect: () => ({ width: 1000 }), ownerDocument: null };
  assert.equal(readRootZoom(legacy), 1);
  const hidden = {
    offsetWidth: 0, getBoundingClientRect: () => ({ width: 0 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ zoom: '1.5', getPropertyValue: () => '' }) } },
  };
  assert.equal(readRootZoom(hidden), 1.5);
  const variableOnly = {
    offsetWidth: 0, getBoundingClientRect: () => ({ width: 0 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ zoom: 'normal', getPropertyValue: (name) => (name === '--ui-zoom' ? '1.25' : '') }) } },
  };
  assert.equal(readRootZoom(variableOnly), 1.25);
  assert.equal(readRootZoom(null), 1);
});

check('viewport → layout conversions are exact inverses of the zoom for 1 / 1.18 / 1.5', () => {
  for (const zoom of [1, 1.18, 1.5]) {
    const point = viewportPointToLayout({ clientX: 115, clientY: 920 }, zoom);
    near(point.x * zoom, 115, 1e-9, `x round-trip @${zoom}`);
    near(point.y * zoom, 920, 1e-9, `y round-trip @${zoom}`);
    near(viewportLengthToLayout(236, zoom) * zoom, 236, 1e-9, `length @${zoom}`);
    const delta = viewportDeltaToLayout(59, -30, zoom);
    near(delta.x * zoom, 59, 1e-9, `dx @${zoom}`);
    near(delta.y * zoom, -30, 1e-9, `dy @${zoom}`);
    const size = layoutViewportSize(zoom, { innerWidth: 1568, innerHeight: 1000 });
    near(size.width * zoom, 1568, 1e-9, `viewport width @${zoom}`);
    near(size.height * zoom, 1000, 1e-9, `viewport height @${zoom}`);
    const rect = rectToLayout({ left: 118, top: 236, width: 590, height: 295 }, zoom);
    near(rect.left * zoom, 118, 1e-9, `rect.left @${zoom}`);
    near(rect.height * zoom, 295, 1e-9, `rect.height @${zoom}`);
  }
  assert.deepEqual(viewportPointToLayout({ clientX: 115, clientY: 920 }, 1), { x: 115, y: 920 });
});

check('pointerToElementLayout returns element-local layout px', () => {
  const element = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 300 }) };
  const local = pointerToElementLayout({ clientX: 350, clientY: 200 }, element, 1.25);
  near(local.x, 200, 1e-9, 'local x');
  near(local.y, 120, 1e-9, 'local y');
  assert.deepEqual(pointerToElementLayout({ clientX: 30, clientY: 40 }, null, 1), { x: 30, y: 40 });
});

check('the user report reproduces: a raw clientY written into a fixed menu lands zoom× too far, and the error grows with the coordinate', () => {
  const view = { innerWidth: 1568, innerHeight: 1200 };
  const zoom = 1.18;
  // Old formula: raw clientY clamped by innerHeight - 225 - 8 (viewport px), then interpreted in layout px.
  const oldTop = Math.max(8, Math.min(920, view.innerHeight - 225 - 8));
  const oldOnScreen = oldTop * zoom;
  assert.ok(Math.abs(oldOnScreen - 920) > 150, `old placement should be visibly wrong (${oldOnScreen})`);
  const oldTopNearTop = Math.max(8, Math.min(120, view.innerHeight - 225 - 8)) * zoom;
  assert.ok(Math.abs(oldTopNearTop - 120) < Math.abs(oldOnScreen - 920), 'the old error is proportional to the coordinate');
  // New: convert first, clamp against the real menu size in layout px.
  const placed = placePopoverAtPointer({ clientX: 115, clientY: 920 }, { width: 220, height: 60 }, { margin: 8, viewport: layoutViewportSize(zoom, view) }, zoom);
  near(placed.top * zoom, 920, 0.01, 'new top on screen');
  near(placed.left * zoom, 115, 0.01, 'new left on screen');
});

check('clampPopoverPosition keeps the top-left on the anchor when the popover fits', () => {
  const placed = clampPopoverPosition({ x: 200, y: 300 }, { width: 220, height: 150 }, { width: 1000, height: 800 });
  assert.deepEqual(placed, { left: 200, top: 300, flippedX: false, flippedY: false });
});

check('clampPopoverPosition flips left / up when the anchor is near the right / bottom edge', () => {
  const placed = clampPopoverPosition({ x: 950, y: 760 }, { width: 220, height: 150 }, { width: 1000, height: 800 });
  assert.deepEqual(placed, { left: 730, top: 610, flippedX: true, flippedY: true });
});

check('clampPopoverPosition falls back to clamping when neither side has room or flip is disabled', () => {
  const tiny = clampPopoverPosition({ x: 150, y: 120 }, { width: 220, height: 150 }, { width: 300, height: 200 });
  assert.deepEqual(tiny, { left: 72, top: 42, flippedX: false, flippedY: false });
  const noFlip = clampPopoverPosition({ x: 950, y: 760 }, { width: 220, height: 150 }, { width: 1000, height: 800 }, { flip: false });
  assert.deepEqual(noFlip, { left: 772, top: 642, flippedX: false, flippedY: false });
  const margin = clampPopoverPosition({ x: 2, y: -10 }, { width: 50, height: 40 }, { width: 500, height: 400 }, { margin: 8 });
  assert.deepEqual(margin, { left: 8, top: 8, flippedX: false, flippedY: false });
});

check('offsets apply on the un-flipped side and mirror when flipped (drag preview / cursor gap)', () => {
  const normal = clampPopoverPosition({ x: 100, y: 100 }, { width: 200, height: 40 }, { width: 1000, height: 800 }, { offset: { x: 14, y: 14 } });
  assert.deepEqual(normal, { left: 114, top: 114, flippedX: false, flippedY: false });
  const flipped = clampPopoverPosition({ x: 980, y: 100 }, { width: 200, height: 40 }, { width: 1000, height: 800 }, { offset: { x: 14, y: 14 } });
  assert.deepEqual(flipped, { left: 766, top: 114, flippedX: true, flippedY: false });
});

check('an unmeasured popover (0×0) still lands exactly on the pointer', () => {
  const placed = placePopoverAtPointer({ clientX: 640, clientY: 480 }, { width: 0, height: 0 }, { viewport: { width: 1000, height: 800 } }, 1.5);
  near(placed.left, 640 / 1.5, 1e-9, 'left');
  near(placed.top, 480 / 1.5, 1e-9, 'top');
});

console.log(JSON.stringify({ passed: true, checks }, null, 2));
