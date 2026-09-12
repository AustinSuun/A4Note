import assert from 'node:assert/strict';
import { findOwnedPluginCandidate, selectPluginLifecycleFallbacks } from '../src/core/pluginBindings.ts';

const active = new Set(['overview.core', 'reader.core', 'markdown.core']);
const isActive = (pluginId) => active.has(pluginId);
const candidates = [
  { id: 'overview.core.view', sceneId: 'overview', pluginId: 'overview.core' },
  { id: 'reader.core.view', sceneId: 'reader', pluginId: 'reader.core' },
  { id: 'markdown.core.view', sceneId: 'markdown', pluginId: 'markdown.core' },
  { id: 'disabled.core.view', sceneId: 'disabled', pluginId: 'disabled.core' },
];

assert.equal(
  findOwnedPluginCandidate(
    { id: 'overview.core.view', sceneId: 'overview', pluginId: 'overview.core' },
    candidates,
    isActive,
  )?.sceneId,
  'overview',
);
assert.equal(
  findOwnedPluginCandidate(
    { id: 'overview.core.view', sceneId: 'overview', pluginId: 'other.core' },
    candidates,
    isActive,
  ),
  undefined,
  'an adapter from another plugin must never cross the ownership boundary',
);

assert.deepEqual(
  selectPluginLifecycleFallbacks([], [], candidates, isActive, 'sceneId').map((candidate) => candidate.sceneId),
  ['overview', 'reader', 'markdown'],
  'active first-party candidates bridge a registration snapshot that has not arrived yet',
);
assert.deepEqual(
  selectPluginLifecycleFallbacks(
    [{ id: 'reader.core.view', sceneId: 'reader', pluginId: 'reader.core' }],
    [],
    candidates,
    isActive,
    'sceneId',
  ).map((candidate) => candidate.sceneId),
  ['overview', 'markdown'],
  'an active registration reserves its scene even when its adapter is unresolved',
);
assert.deepEqual(
  selectPluginLifecycleFallbacks(
    [],
    [candidates[0]],
    candidates,
    isActive,
    'sceneId',
  ).map((candidate) => candidate.sceneId),
  ['reader', 'markdown'],
  'already resolved adapters must not be duplicated in the registry',
);
assert.deepEqual(
  selectPluginLifecycleFallbacks([], [], [
    { id: 'reader.documents', sceneId: 'reader', pluginId: 'reader.core' },
    { id: 'markdown.files', sceneId: 'markdown', pluginId: 'markdown.core' },
  ], isActive, 'id').map((candidate) => candidate.id),
  ['reader.documents', 'markdown.files'],
);

console.log('Plugin runtime binding verification passed');
