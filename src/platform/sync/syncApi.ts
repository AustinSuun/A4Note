import type {
  SyncPullResponse,
  SyncPushOperation,
  SyncPushResponse,
  SyncState,
} from '../../core/sync';
import { normalizeSyncCursor } from '../../core/sync';

export interface SyncUser {
  id: string;
  username: string;
  nickname: string;
}

export interface SyncDevice {
  id: string;
  platform: string;
}

export interface SyncAuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  user: SyncUser;
  device: SyncDevice;
}

export interface SyncStatus {
  cursor: string;
  pendingOperations: number;
  lastChangeAt?: string;
}

export class SyncApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    requestId?: string,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'SyncApiError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
    this.details = details;
  }
}

export interface SyncApi {
  login(username: string, password: string): Promise<SyncAuthResult>;
  register(username: string, password: string, nickname?: string): Promise<SyncAuthResult>;
  refresh(): Promise<SyncAuthResult>;
  logout(): Promise<void>;
  push(deviceId: string, operations: SyncPushOperation[]): Promise<SyncPushResponse>;
  pull(cursor: string, limit?: number): Promise<SyncPullResponse>;
  status(): Promise<SyncStatus>;
  setTokens(tokens: Pick<SyncAuthResult, 'accessToken' | 'refreshToken'>): void;
}

type FetchLike = typeof fetch;

export class HttpSyncApi implements SyncApi {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl = defaultSyncApiUrl(),
    fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    this.fetchImpl = fetchImpl;
  }

  setTokens(tokens: Pick<SyncAuthResult, 'accessToken' | 'refreshToken'>) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken ?? null;
  }

  async login(username: string, password: string) {
    const result = await this.request<SyncAuthResult>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    this.setTokens(result);
    return result;
  }

  async register(username: string, password: string, nickname?: string) {
    const result = await this.request<SyncAuthResult>('/auth/register', {
      method: 'POST',
      body: { username, password, ...(nickname ? { nickname } : {}) },
    });
    this.setTokens(result);
    return result;
  }

  async refresh() {
    if (!this.refreshToken) throw new SyncApiError('Sync session has no refresh token', 401);
    const result = await this.request<SyncAuthResult>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: this.refreshToken },
      retryOnUnauthorized: false,
    });
    this.setTokens(result);
    return result;
  }

  async logout() {
    if (!this.accessToken) return;
    try {
      await this.request<void>('/auth/logout', { method: 'POST', retryOnUnauthorized: false });
    } finally {
      this.accessToken = null;
      this.refreshToken = null;
    }
  }

  push(deviceId: string, operations: SyncPushOperation[]) {
    return this.request<SyncPushResponse>('/sync/push', {
      method: 'POST',
      body: {
        deviceId,
        operations: operations.map((operation) => ({
          operationId: operation.operationId,
          entity: operation.entity,
          entityId: operation.entityId,
          operation: operation.operation,
          baseVersion: operation.baseVersion,
          payload: operation.payload,
        })),
      },
    }).then((payload) => normalizePushResponse(asRecord(payload))).catch((error: unknown) => {
      // The design permits a batch-level 409. Convert either the documented
      // `results` envelope or a single conflict body into the same response
      // shape used for successful pushes, preserving the local operation id.
      if (!(error instanceof SyncApiError) || error.status !== 409) throw error;
      const details = asRecord(error.details);
      if (Array.isArray(details.results)) return normalizePushResponse(details);
      const entityId = typeof details.entityId === 'string' ? details.entityId : operations[0]?.entityId;
      const operation = operations.find((item) => item.entityId === entityId) ?? operations[0];
      if (!operation) throw error;
      return {
        results: [{
          operationId: operation.operationId,
          entityId: operation.entityId,
          status: 'conflict',
          version: toNumber(details.version ?? details.currentVersion),
          data: normalizeNoteData(details.data ?? details.currentData),
          error: error.message,
        }],
      } satisfies SyncPushResponse;
    });
  }

  pull(cursor: string, limit = 100) {
    const query = new URLSearchParams({ cursor, limit: String(Math.max(1, Math.min(limit, 200))) });
    return this.request<SyncPullResponse>(`/sync/pull?${query.toString()}`, { method: 'GET' }).then(normalizePullResponse);
  }

  status() {
    return this.request<SyncStatus>('/sync/status', { method: 'GET' });
  }

  private async request<T>(
    path: string,
    options: { method: string; body?: unknown; retryOnUnauthorized?: boolean },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await readJson(response);
    if (response.status === 401 && options.retryOnUnauthorized !== false && this.refreshToken) {
      await this.refresh();
      return this.request(path, { ...options, retryOnUnauthorized: false });
    }
    if (!response.ok) {
      const error = asRecord(payload);
      throw new SyncApiError(
        typeof error.message === 'string' ? error.message : `Sync request failed (${response.status})`,
        response.status,
        typeof error.requestId === 'string' ? error.requestId : undefined,
        typeof error.code === 'string' ? error.code : undefined,
        error.details ?? payload,
      );
    }
    return payload as T;
  }
}

function defaultSyncApiUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ASTER_SYNC_API_URL ?? 'http://localhost:8080';
}

function normalizePushResponse(payload: Record<string, unknown>): SyncPushResponse {
  if (!Array.isArray(payload.results)) throw malformedResponse('push response must contain results');
  return {
    results: payload.results.map((value) => {
      const item = asRecord(value);
      const operationId = String(item.operationId ?? item.operation_id ?? '');
      const entityId = String(item.entityId ?? item.entity_id ?? '');
      if (!operationId || !entityId) throw malformedResponse('push result is missing operationId or entityId');
      if (item.status !== 'accepted' && item.status !== 'conflict') {
        throw malformedResponse(`unsupported push result status: ${String(item.status)}`);
      }
      return {
        operationId,
        entityId,
        status: item.status,
        version: toNumber(item.version),
        data: normalizeNoteData(item.data),
        error: typeof item.error === 'string' ? item.error : undefined,
      };
    }),
  };
}

function normalizePullResponse(payload: SyncPullResponse): SyncPullResponse {
  const raw = asRecord(payload);
  if (typeof raw.cursor !== 'string' && typeof raw.cursor !== 'number') {
    throw malformedResponse('pull response is missing cursor');
  }
  if (!Array.isArray(raw.changes)) throw malformedResponse('pull response must contain changes');
  return {
    cursor: normalizeSyncCursor(String(raw.cursor ?? '0')),
    hasMore: raw.hasMore === true || raw.has_more === true,
    changes: raw.changes.map((value) => {
      const item = asRecord(value);
      const entity = item.entity;
      const entityId = String(item.entityId ?? item.entity_id ?? '');
      const operation = item.operation;
      const version = Number(item.version ?? 0);
      if (entity !== 'note' || !entityId || (operation !== 'upsert' && operation !== 'delete') || !Number.isInteger(version) || version < 1) {
        throw malformedResponse('pull response contains an invalid change');
      }
      const data = normalizeNoteData(item.data);
      if (operation === 'upsert' && (!data || data.id !== entityId)) {
        throw malformedResponse('upsert change data does not match entityId');
      }
      if (data && data.version === 0) data.version = version;
      return { entity: 'note', entityId, operation, version, data };
    }),
  };
}

function normalizeNoteData(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    content: String(item.content ?? ''),
    format: item.format === 'markdown' ? 'markdown' as const : 'markdown' as const,
    paperId: typeof (item.paperId ?? item.paper_id) === 'string' ? String(item.paperId ?? item.paper_id) : null,
    createdAt: typeof (item.createdAt ?? item.created_at) === 'string' ? String(item.createdAt ?? item.created_at) : undefined,
    updatedAt: typeof (item.updatedAt ?? item.updated_at) === 'string' ? String(item.updatedAt ?? item.updated_at) : undefined,
    deletedAt: typeof (item.deletedAt ?? item.deleted_at) === 'string' ? String(item.deletedAt ?? item.deleted_at) : null,
    version: Number(item.version ?? 0),
  };
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function malformedResponse(message: string): SyncApiError {
  return new SyncApiError(message, 502, undefined, 'malformed_sync_response');
}

export type { SyncState };
