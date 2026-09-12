export { HttpSyncApi, SyncApiError } from './syncApi';
export type { SyncApi, SyncAuthResult, SyncDevice, SyncStatus, SyncUser } from './syncApi';
import { SyncCoordinator } from '../../core/syncCoordinator';
import type { SyncRemote, SyncLocalStore } from '../../core/syncCoordinator';
import { HttpSyncApi } from './syncApi';
import {
  applySyncPull,
  loadSyncOutbox,
  loadSyncState,
  markSyncRetry,
  reconcileSyncOperations,
  recordSyncError,
} from './syncRepository';
export {
  applySyncPull,
  loadSyncOutbox,
  loadSyncState,
  markSyncRetry,
  reconcileSyncOperations,
  recordSyncError,
} from './syncRepository';

export function createDesktopSyncCoordinator(api: SyncRemote = new HttpSyncApi(), batchSize = 50) {
  const local: SyncLocalStore = {
    loadState: loadSyncState,
    loadOutbox: loadSyncOutbox,
    reconcilePush: reconcileSyncOperations,
    applyPull: (response) => applySyncPull(response.cursor, response.changes),
    markRetry: markSyncRetry,
    recordError: recordSyncError,
  };
  return new SyncCoordinator(api, local, batchSize);
}
