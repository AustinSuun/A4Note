/** Pure protocol types and state transitions for the first note sync phase. */

export type SyncEntity = 'note';
export type SyncOperation = 'upsert' | 'delete';
export type SyncOutboxState = 'pending' | 'failed' | 'conflict';

export interface SyncNotePayload {
  title: string;
  content: string;
  format: 'markdown';
  paperId: string | null;
}

export interface SyncNoteData extends SyncNotePayload {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version: number;
}

export interface SyncOutboxItem {
  operationId: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  baseVersion: number;
  payload: SyncNotePayload;
  retryCount: number;
}

export interface SyncState {
  deviceId: string;
  cursor: string;
  lastSuccessAt?: string;
  lastError?: string;
}

export interface SyncPullChange {
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  version: number;
  data?: SyncNoteData;
}

export interface SyncPushOperation {
  operationId: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  baseVersion: number;
  payload: SyncNotePayload;
}

export interface SyncPushResult {
  operationId: string;
  entityId: string;
  status: 'accepted' | 'conflict';
  version?: number;
  data?: SyncNoteData;
  error?: string;
}

export interface SyncConflict {
  operationId: string;
  entityId: string;
  version: number;
  data?: SyncNoteData;
  error?: string;
}

export interface SyncPullResponse {
  cursor: string;
  hasMore: boolean;
  changes: SyncPullChange[];
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}

export function makeOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createNotePushOperation(note: {
  id: string;
  title: string;
  content: string;
  paperId?: string | null;
  format?: 'markdown';
  serverVersion?: number;
}, operationId = makeOperationId()): SyncPushOperation {
  return {
    operationId,
    entity: 'note',
    entityId: note.id,
    operation: 'upsert',
    baseVersion: note.serverVersion ?? 0,
    payload: {
      title: note.title,
      content: note.content,
      format: note.format ?? 'markdown',
      paperId: note.paperId ?? null,
    },
  };
}

export function shouldApplyPullChange(localVersion: number, incomingVersion: number): boolean {
  return incomingVersion > localVersion;
}

export function retryDelayMs(retryCount: number, baseMs = 1_000, maxMs = 5 * 60_000): number {
  const exponent = Math.max(0, Math.min(retryCount, 8));
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

export function normalizeSyncCursor(cursor: string | null | undefined): string {
  const normalized = cursor?.trim();
  return normalized || '0';
}

export function isRetryableSyncStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
