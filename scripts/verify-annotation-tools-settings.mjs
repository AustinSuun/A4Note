// Task 97fcfb6c: shared annotation tool settings store — reader and board read/write one state.
// Run: node --experimental-strip-types scripts/verify-annotation-tools-settings.mjs
import assert from 'node:assert/strict';
import {
  ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, annotationToolStore, createAnnotationToolStore, defaultAnnotationToolSettings,
  loadAnnotationToolSettings, normalizeStoredAnnotationToolSettings, normalizeStoredToolColors,
} from '../src/features/annotationTools/toolSettings.ts';

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), _map: map };
};

check('defaults match the reader defaults and migrate the historical 13px font size', () => {
  assert.equal(defaultAnnotationToolSettings.inkStrokeWidth, 4);
  assert.equal(defaultAnnotationToolSettings.eraserSize, 18);
  assert.equal(defaultAnnotationToolSettings.arrowStrokeWidth, 3.4);
  assert.equal(defaultAnnotationToolSettings.shapeStrokeWidth, 2.4);
  assert.equal(defaultAnnotationToolSettings.textFontSize, 24);
  assert.equal(normalizeStoredAnnotationToolSettings({ textFontSize: 13 }).textFontSize, 24);
  assert.equal(normalizeStoredAnnotationToolSettings({ textFontSize: 25 }).textFontSize, 26);
  // Non-numeric values fall back to the default (numbers are clamped at render time, as in the reader).
  assert.equal(normalizeStoredAnnotationToolSettings({ eraserSize: 'x' }).eraserSize, 18);
  assert.equal(normalizeStoredAnnotationToolSettings({}).textFontSize, 24);
});

check('the historical reader storage key is preserved so existing preferences migrate as-is', () => {
  assert.equal(ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, 'aster.reader.annotationToolSettings.v1');
  const storage = memoryStorage();
  storage.setItem(ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, JSON.stringify({ ...defaultAnnotationToolSettings, inkStrokeWidth: 7, textFontSize: 13 }));
  const loaded = loadAnnotationToolSettings(storage);
  assert.equal(loaded.inkStrokeWidth, 7);
  assert.equal(loaded.textFontSize, 24);
});

check('settings written through one store are persisted and read by a later host instance', () => {
  const storage = memoryStorage();
  const readerStore = createAnnotationToolStore(storage);
  readerStore.setSettings({ ...readerStore.getSettings(), inkStrokeWidth: 6.5, eraserSize: 40 });
  // Values land under the shared historical key...
  assert.equal(loadAnnotationToolSettings(storage).inkStrokeWidth, 6.5);
  // ...and a host that mounts later (the whiteboard opening its options) reads them.
  const boardStore = createAnnotationToolStore(storage);
  assert.equal(boardStore.getSettings().inkStrokeWidth, 6.5);
  assert.equal(boardStore.getSettings().eraserSize, 40);
  boardStore.setSettings((current) => ({ ...current, shapeStrokeWidth: 5.2 }));
  assert.equal(loadAnnotationToolSettings(storage).shapeStrokeWidth, 5.2);
  // Same-page hosts share the singleton store, so live updates propagate by subscription.
  const live = annotationToolStore();
  let notified = 0;
  const unsubscribe = live.subscribe(() => { notified += 1; });
  live.setSettings({ ...live.getSettings(), arrowStrokeWidth: 5 });
  assert.equal(notified, 1);
  unsubscribe();
});

check('recent colours are shared per tool and survive a reload', () => {
  const storage = memoryStorage();
  const readerStore = createAnnotationToolStore(storage);
  readerStore.setToolColor('ink', '#d92d20');
  readerStore.setToolColor('rect', '#2eaadc');
  readerStore.setToolColor('comment', 'yellow');
  const boardStore = createAnnotationToolStore(storage);
  assert.equal(boardStore.getToolColors().ink, '#d92d20');
  assert.equal(boardStore.getToolColors().rect, '#2eaadc');
  assert.equal(boardStore.getToolColors().comment, 'yellow');
  readerStore.setToolColor('eraser', '#000000');
  assert.equal(boardStore.getToolColors().eraser, undefined, 'pointer tools keep no colour');
});

check('subscribers are notified on every mutation and can unsubscribe', () => {
  const store = createAnnotationToolStore(memoryStorage());
  let events = 0;
  const unsubscribe = store.subscribe(() => { events += 1; });
  store.setSettings({ ...store.getSettings(), eraserSize: 30 });
  store.setToolColor('arrow', '#123456');
  assert.equal(events, 2);
  unsubscribe();
  store.setSettings({ ...store.getSettings(), eraserSize: 32 });
  assert.equal(events, 2);
  assert.equal(store.getSettings().eraserSize, 32);
});

check('malformed storage values fall back to defaults and invalid colours are rejected', () => {
  const storage = memoryStorage();
  storage.setItem(ANNOTATION_TOOL_SETTINGS_STORAGE_KEY, '{oops');
  assert.deepEqual(loadAnnotationToolSettings(storage), defaultAnnotationToolSettings);
  assert.deepEqual(normalizeStoredToolColors({ ink: 'javascript:', rect: 5, arrow: '#abc' }), {});
  assert.deepEqual(normalizeStoredToolColors({ ink: 'green', arrow: '#aabbcc' }), { ink: 'green', arrow: '#aabbcc' });
});

check('the default singleton store is usable without arguments', () => {
  const store = annotationToolStore();
  assert.equal(typeof store.getSettings().inkStrokeWidth, 'number');
  assert.equal(typeof store.getToolColors(), 'object');
});

console.log(JSON.stringify({ passed: true, checks }, null, 2));
