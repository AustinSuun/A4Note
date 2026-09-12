import { invoke } from '@tauri-apps/api/core';
import { normalizeSyncCursor, type SyncNotePayload, type SyncPullChange, type SyncPushResult, type SyncState } from '../../core/sync';

interface NativeSyncState {
  device_id: string;
  cursor: string;
  last_success_at: number | null;
  last_error: string | null;
}

interface NativeOutboxRecord {
  operation_id: string;
  entity: 'note';
  entity_id: string;
  operation: 'upsert' | 'delete';
  base_version: number;
  payload_json: string;
  retry_count: number;
}

export async function loadSyncState(): Promise<SyncState> {
  const state = await invoke<NativeSyncState>('get_sync_state');
  return {
    deviceId: state.device_id,
    cursor: normalizeSyncCursor(state.cursor),
    lastSuccessAt: state.last_success_at ? new Date(state.last_success_at).toISOString() : undefined,
    lastError: state.last_error ?? undefined,
  };
}

export async function loadSyncOutbox(limit = 50) {
  const records = await invoke<NativeOutboxRecord[]>('list_sync_outbox', { query: { limit } });
  return records.map((record) => ({
    operationId: record.operation_id,
    entity: record.entity,
    entityId: record.entity_id,
    operation: record.operation,
    baseVersion: record.base_version,
    payload: parsePayload(record.payload_json, record.operation),
    retryCount: record.retry_count,
  }));
}

function parsePayload(raw: string, operation: 'upsert' | 'delete'): SyncNotePayload {
  if (operation === 'delete') return { title: '', content: '', format: 'markdown', paperId: null };
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'object' && value !== null) {
      const payload = value as Partial<SyncNotePayload>;
      if (typeof payload.title !== 'string' || typeof payload.content !== 'string') {
        throw new Error('sync outbox upsert payload is missing title or content');
      }
      return {
        title: payload.title,
        content: payload.content,
        format: 'markdown',
        paperId: typeof payload.paperId === 'string' ? payload.paperId : null,
      };
    }
    throw new Error('sync outbox payload must be an object');
  } catch {
    throw new Error('sync outbox contains invalid JSON');
  }
}

export async function reconcileSyncOperations(results: SyncPushResult[]) {
  await invoke<void>('reconcile_sync_operations', {
    request: {
      operations: results.map((result) => ({
        operation_id: result.operationId,
        entity_id: result.entityId,
        status: result.status,
        version: result.version ?? null,
        error: result.error ?? null,
        server_payload_json: result.data ? JSON.stringify(result.data) : null,
      })),
    },
  });
}

export async function markSyncRetry(operationId: string, error: string, nextRetryAt: number) {
  await invoke<void>('mark_sync_retry', {
    request: { operation_id: operationId, error, next_retry_at: nextRetryAt },
  });
}

export async function applySyncPull(cursor: string, changes: SyncPullChange[]) {
  await invoke<void>('apply_sync_pull', {
    request: {
      cursor,
      changes: changes.map((change) => ({
        entity: change.entity,
        entity_id: change.entityId,
        operation: change.operation,
        version: change.version,
        data: change.data ? {
          id: change.data.id,
          paper_id: change.data.paperId,
          title: change.data.title,
          content: change.data.content,
          format: change.data.format,
          created_at: toMillis(change.data.createdAt),
          updated_at: toMillis(change.data.updatedAt),
          deleted_at: toMillis(change.data.deletedAt),
        } : null,
      })),
    },
  });
}

export async function recordSyncError(error: unknown) {
  await invoke<void>('record_sync_error', { error: error instanceof Error ? error.message : String(error) });
}

function toMillis(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
