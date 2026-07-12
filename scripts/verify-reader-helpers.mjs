import assert from 'node:assert/strict';

const selection = await import('../src/features/reader/pdf/pdfSelection.ts');
const interaction = await import('../src/features/reader/pdf/pdfInteraction.ts');

const mergedRects = selection.mergeRectsIntoLineSegments([
  { x: 10, y: 10, width: 6, height: 2 },
  { x: 16.6, y: 10.4, width: 4, height: 2 },
  { x: 4, y: 22, width: 8, height: 2 },
]);
assert.deepEqual(mergedRects, [
  { x: 10, y: 10, width: 10.600000000000001, height: 2.4000000000000004 },
  { x: 4, y: 22, width: 8, height: 2 },
]);

const selected = selection.textSelectionFromDrag(
  [
    { text: 'First', x: 10, y: 10, width: 10, height: 3, fontSize: 12 },
    { text: 'line', x: 22, y: 10.2, width: 8, height: 3, fontSize: 12 },
    { text: 'Second', x: 10, y: 20, width: 14, height: 3, fontSize: 12 },
  ],
  { x: 8, y: 8, width: 26, height: 7 },
);
assert.equal(selected.quote, 'First line');
assert.equal(selected.position.segments.length, 1);
assert.equal(selection.textSelectionFromDrag([], { x: 0, y: 0, width: 5, height: 5 }), null);

let prevented = false;
let stopped = false;
const point = interaction.pointFromEvent({
  clientX: 60,
  clientY: 45,
  preventDefault() {
    prevented = true;
  },
  stopPropagation() {
    stopped = true;
  },
  currentTarget: {
    getBoundingClientRect() {
      return { left: 10, top: 5, width: 100, height: 80 };
    },
  },
});
assert.deepEqual(point, { x: 50, y: 50 });
assert.equal(prevented, true);
assert.equal(stopped, true);

const pageRelativePoint = interaction.pointFromEvent(
  {
    clientX: 160,
    clientY: 120,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {
      getBoundingClientRect() {
        return { left: 150, top: 110, width: 20, height: 20 };
      },
    },
  },
  {
    getBoundingClientRect() {
      return { left: 60, top: 20, width: 200, height: 200 };
    },
  },
);
assert.deepEqual(pageRelativePoint, { x: 50, y: 50 });

const dragDraft = interaction.createDragDraft(4, { x: 12, y: 24 });
assert.deepEqual(dragDraft, { page: 4, startX: 12, startY: 24, currentX: 12, currentY: 24 });
assert.deepEqual(interaction.updateDragDraftPoint(dragDraft, { x: 18, y: 30 }), { ...dragDraft, currentX: 18, currentY: 30 });
assert.deepEqual(
  interaction.stickyPositionFromDrag(
    { x: 20, y: 30, width: 16, height: 8, textColor: '#111111' },
    { annotationId: 'ann-1', page: 4, offsetX: 5, offsetY: 7 },
    { x: 50, y: 60 },
  ),
  { x: 45, y: 53, width: 16, height: 8, textColor: '#111111' },
);
assert.deepEqual(
  interaction.stickyPositionFromDrag(
    { x: 8, y: 12, width: 5, height: 3, shapeKind: 'ellipse' },
    { annotationId: 'shape-1', page: 4, offsetX: 2, offsetY: 1 },
    { x: 40, y: 50 },
  ),
  { x: 38, y: 49, width: 5, height: 3, shapeKind: 'ellipse' },
);

const pages = [
  fakePage(1, { top: -900, bottom: -20, height: 880 }),
  fakePage(2, { top: 80, bottom: 960, height: 880 }),
];
const container = {
  getBoundingClientRect() {
    return { top: 0, bottom: 900, height: 900 };
  },
  querySelectorAll(selector) {
    assert.equal(selector, '.pdf-page[data-page]');
    return pages;
  },
};
assert.equal(interaction.currentVisiblePage(container), 2);

let scrolled = false;
const offscreenPage = fakePage(3, { top: 980, bottom: 1860, height: 880 });
offscreenPage.closest = () => container;
offscreenPage.scrollIntoView = (options) => {
  scrolled = true;
  assert.deepEqual(options, { block: 'center', behavior: 'auto' });
};
interaction.scrollPageIntoViewIfNeeded(offscreenPage);
assert.equal(scrolled, true);

console.log('Reader helper verification passed');

function fakePage(page, rect) {
  return {
    dataset: { page: String(page) },
    getBoundingClientRect() {
      return rect;
    },
  };
}
