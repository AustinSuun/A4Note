import assert from 'node:assert/strict';

const {
  inferResourceKind,
  resolveResourceOpener,
  resourceOpenerMatches,
} = await import('../src/core/resources.ts');

const scenes = [
  { id: 'reader', pluginId: 'reader.core' },
  { id: 'markdown', pluginId: 'markdown.core' },
  { id: 'demo.scene', pluginId: 'demo.plugin' },
];
const openers = [
  { id: 'reader.pdf', kind: 'pdf', sceneId: 'reader', priority: 100, tabKind: 'pdf' },
  { id: 'markdown.editor', kind: 'markdown', sceneId: 'markdown', priority: 100, tabKind: 'markdown' },
  { id: 'plugin:demo.low', kind: 'demo-resource', sceneId: 'demo.scene', extensions: ['demo'], priority: 5 },
  { id: 'plugin:demo.high', kind: 'demo-resource', sceneId: 'demo.scene', extensions: ['.demo'], priority: 10 },
  { id: 'plugin:demo.scheme', kind: 'scheme-resource', sceneId: 'demo.scene', schemes: ['demo'], priority: 20 },
];
const active = new Set(['reader.core', 'markdown.core', 'demo.plugin']);
const resolve = (uri, resourceKind) => resolveResourceOpener({
  uri,
  resourceKind,
  openers,
  scenes,
  isPluginActive: (id) => active.has(id),
});

assert.equal(resolve('D:/notes/paper.pdf')?.id, 'reader.pdf');
assert.equal(resolve('D:/notes/note.md')?.id, 'markdown.editor');
assert.equal(resolve('D:/notes/example.demo')?.id, 'plugin:demo.high');
assert.equal(resolve('demo://item/42')?.id, 'plugin:demo.scheme');
assert.equal(resourceOpenerMatches(openers[2], 'D:/notes/example.demo'), true);
assert.equal(resolve('D:/notes/unknown.bin'), undefined);

active.delete('demo.plugin');
assert.equal(resolve('D:/notes/example.demo'), undefined, 'disabled owner plugin must not route resources');
active.add('demo.plugin');
active.delete('reader.core');
assert.equal(resolve('D:/notes/paper.pdf'), undefined, 'disabled owner scene plugin must not route resources');

const tieOpeners = [
  { id: 'plugin:z', kind: 'tie', priority: 1 },
  { id: 'plugin:a', kind: 'tie', priority: 1 },
];
assert.equal(resolveResourceOpener({ uri: 'aster://tie', resourceKind: 'tie', openers: tieOpeners })?.id, 'plugin:a');
assert.equal(inferResourceKind('D:/notes/unknown.demo'), 'file');
console.log('Resource opener verification passed');
