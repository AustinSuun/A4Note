import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { createNotePushOperation, normalizeSyncCursor, retryDelayMs, shouldApplyPullChange } = await import('../src/core/sync.ts');
const { SyncCoordinator } = await import('../src/core/syncCoordinator.ts');
const { HttpSyncApi } = await import('../src/platform/sync/syncApi.ts');

const operation = createNotePushOperation({ id: 'note-1', title: 'T', content: 'C', paperId: null, serverVersion: 3 }, 'op-1');
assert.equal(operation.baseVersion, 3);
assert.equal(operation.payload.format, 'markdown');
assert.equal(operation.operationId, 'op-1');
assert.equal(normalizeSyncCursor('  '), '0');
assert.equal(shouldApplyPullChange(3, 4), true);
assert.equal(shouldApplyPullChange(4, 4), false);
assert.equal(retryDelayMs(3), 8_000);

const calls = [];
const local = {
  async loadState() { return { deviceId: 'device-1', cursor: '10' }; },
  async loadOutbox() { return [{ ...operation, retryCount: 0 }]; },
  async reconcilePush(results) { calls.push(['reconcile', results.length]); },
  async applyPull(response) { calls.push(['pull', response.cursor]); },
  async markRetry() { calls.push(['retry']); },
  async recordError() { calls.push(['error']); },
};
const remote = {
  async push() { return { results: [{ operationId: 'op-1', entityId: 'note-1', status: 'accepted', version: 4 }] }; },
  async pull(cursor) {
    return cursor === '10'
      ? { cursor: '11', hasMore: true, changes: [{ entity: 'note', entityId: 'note-2', operation: 'upsert', version: 1 }] }
      : { cursor: '12', hasMore: false, changes: [] };
  },
};
const summary = await new SyncCoordinator(remote, local).runOnce();
assert.deepEqual(summary, { pushed: 1, pulled: 1, cursor: '12', hasMore: false });
assert.deepEqual(calls, [['reconcile', 1], ['pull', '11'], ['pull', '12']]);

let concurrentPushes = 0;
const concurrentRemote = {
  async push() {
    concurrentPushes += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { results: [] };
  },
  async pull() { return { cursor: '10', hasMore: false, changes: [] }; },
};
const concurrentCoordinator = new SyncCoordinator(concurrentRemote, {
  ...local,
  async loadOutbox() { return [{ ...operation, retryCount: 0 }]; },
  async reconcilePush() {},
});
await Promise.all([concurrentCoordinator.runOnce(), concurrentCoordinator.runOnce()]);
assert.equal(concurrentPushes, 1);

const api = new HttpSyncApi('https://sync.test', async (url) => {
  if (String(url).includes('/sync/push')) {
    return new Response(JSON.stringify({ entityId: 'note-1', currentVersion: 9, currentData: { id: 'note-1', title: 'remote', content: 'r', format: 'markdown' } }), { status: 409 });
  }
  return new Response(JSON.stringify({ cursor: '4', has_more: false, changes: [{ entity: 'note', entity_id: 'note-1', operation: 'upsert', version: 9, data: { id: 'note-1', title: 'remote', content: 'r', format: 'markdown', paper_id: null } }] }), { status: 200 });
});
const conflictResponse = await api.push('device-1', [operation]);
assert.equal(conflictResponse.results[0].status, 'conflict');
assert.equal(conflictResponse.results[0].version, 9);
const normalizedPull = await api.pull('3');
assert.equal(normalizedPull.changes[0].entityId, 'note-1');
assert.equal(normalizedPull.hasMore, false);
const malformedApi = new HttpSyncApi('https://sync.test', async () => new Response(JSON.stringify({ results: [{ operationId: 'op-1', entityId: 'note-1', status: 'unexpected' }] }), { status: 200 }));
await assert.rejects(() => malformedApi.push('device-1', [operation]), /unsupported push result status/);
console.log('sync verification passed');
