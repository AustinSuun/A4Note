export type AuthMode = 'none' | 'bearer' | 'dpop' | 'custom' | 'pairing';
export type ConnectorConfig = {
  httpBaseUrl: string;
  wsBaseUrl?: string;
  /** Same-origin Agent Board proxy used by browser pairing connections. */
  proxyBaseUrl?: string;
  authMode: AuthMode;
  /** Ephemeral request material. Never persist or log these fields. */
  bearerToken?: string;
  accessToken?: string;
  dpopProof?: string;
  customHeaders?: Record<string, string>;
  pairingToken?: string;
};
export type ConnectionErrorKind =
  | 'notConfigured'
  | 'unauthorized'
  | 'pairingFailed'
  | 'forbidden'
  | 'notFound'
  | 'network'
  | 'invalidResponse'
  | 'unknown';
export type ConnectionCheck = {
  ok: boolean;
  endpoint: string;
  latencyMs?: number;
  authRequired?: boolean;
  errorKind?: ConnectionErrorKind;
  errorMessage?: string;
  snapshotSequence?: string | number;
};
export type OrchestrationSnapshot = {
  snapshotSequence: string | number;
  projects: Array<{
    id?: string;
    title: string;
    summary: string;
    status?: string;
    rawStatus?: string;
  }>;
  threads: Array<{
    id?: string;
    projectId?: string;
    title: string;
    summary: string;
    status?: string;
    rawStatus?: string;
    sessionStatus?: string;
    rawSessionStatus?: string;
    turnStatus?: string;
    rawTurnStatus?: string;
  }>;
  updatedAt?: string;
};
export type DispatchPreview = {
  taskId: string;
  projectId: string;
  threadId: string;
  messageId: string;
  text: string;
  requiresConfirmation: true;
};

/** Accepts a full /pair URL, a /pair path, or a raw T3 pairing code. */
export function parsePairingUrl(value: string, fallbackBaseUrl?: string): {
  endpoint: string;
  token: string;
};
