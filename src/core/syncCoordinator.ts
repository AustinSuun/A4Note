import {
  isRetryableSyncStatus,
  retryDelayMs,
  type SyncPullResponse,
  type SyncPushOperation,
  type SyncPushResponse,
  type SyncState,
  type SyncOutboxItem,
} from './sync';

export interface SyncRemote {
  push(deviceId: string, operations: SyncPushOperation[]): Promise<SyncPushResponse>;
  pull(cursor: string, limit?: number): Promise<SyncPullResponse>;
}

export interface SyncLocalStore {
  loadState(): Promise<SyncState>;
  loadOutbox(limit: number): Promise<SyncOutboxItem[]>;
  reconcilePush(results: SyncPushResponse['results']): Promise<void>;
  applyPull(response: SyncPullResponse): Promise<void>;
  markRetry(operationId: string, error: string, nextRetryAt: number): Promise<void>;
  recordError(error: unknown): Promise<void>;
}

export interface SyncRunSummary {
  pushed: number;
  pulled: number;
  cursor: string;
  hasMore: boolean;
}

export class SyncCoordinator {
  private readonly remote: SyncRemote;
  private readonly local: SyncLocalStore;
  private readonly batchSize: number;
  private running: Promise<SyncRunSummary> | null = null;

  constructor(
    remote: SyncRemote,
    local: SyncLocalStore,
    batchSize = 50,
  ) {
    this.remote = remote;
    this.local = local;
    this.batchSize = batchSize;
  }

  async runOnce(): Promise<SyncRunSummary> {
    if (this.running) return this.running;
    this.running = this.runOnceInternal();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async runOnceInternal(): Promise<SyncRunSummary> {
    const state = await this.local.loadState();
    let outbox: SyncOutboxItem[];
    try {
      outbox = await this.local.loadOutbox(this.batchSize);
    } catch (error) {
      try {
        await this.local.recordError(error);
      } catch {
        // Preserve the original queue parsing error if diagnostics storage fails.
      }
      throw error;
    }
    let pushed = 0;
    if (outbox.length) {
      const operations = outbox.map(toPushOperation);
      try {
        const response = await this.remote.push(state.deviceId, operations);
        await this.local.reconcilePush(response.results);
        pushed = response.results.length;
      } catch (error) {
        await this.scheduleRetries(outbox, error);
        await this.local.recordError(error);
        throw error;
      }
    }

    let cursor = state.cursor;
    let pulled = 0;
    let hasMore = false;
    do {
      try {
        const response = await this.remote.pull(cursor, this.batchSize);
        await this.local.applyPull(response);
        cursor = response.cursor;
        pulled += response.changes.length;
        hasMore = response.hasMore;
      } catch (error) {
        await this.local.recordError(error);
        throw error;
      }
    } while (hasMore);

    return { pushed, pulled, cursor, hasMore };
  }

  private async scheduleRetries(outbox: SyncOutboxItem[], error: unknown) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 0;
    if (status && !isRetryableSyncStatus(status)) return;
    const message = error instanceof Error ? error.message : String(error);
    const nextRetryAt = Date.now() + retryDelayMs(Math.max(...outbox.map((item) => item.retryCount), 0));
    await Promise.all(outbox.map((item) => this.local.markRetry(item.operationId, message, nextRetryAt)));
  }
}

function toPushOperation(item: SyncOutboxItem): SyncPushOperation {
  return {
    operationId: item.operationId,
    entity: item.entity,
    entityId: item.entityId,
    operation: item.operation,
    baseVersion: item.baseVersion,
    payload: item.payload,
  };
}
