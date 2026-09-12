import type { Note } from '../models/note';

export type SyncOperation = 'upsert' | 'delete';

export interface SyncChange {
  operationId: string;
  entity: 'note';
  entityId: string;
  operation: SyncOperation;
  baseVersion: number;
  payload?: Pick<Note, 'title' | 'content' | 'format' | 'paperId'>;
}

export interface SyncPullResult {
  cursor: string;
  hasMore: boolean;
  changes: Array<{
    entity: 'note';
    entityId: string;
    operation: SyncOperation;
    version: number;
    data?: Note;
  }>;
}

export interface SyncPushResult {
  operationId: string;
  entityId: string;
  status: 'accepted' | 'conflict';
  version?: number;
  data?: Note;
  error?: string;
}

/** Implement this interface when the server API contract is ready. */
export interface SyncProvider {
  push(changes: SyncChange[]): Promise<SyncPushResult[]>;
  pull(cursor: string, limit?: number): Promise<SyncPullResult>;
}

