const API_SNAPSHOT_PATH = '/api/orchestration/snapshot';
const OAUTH_TOKEN_PATH = '/oauth/token';
const BOARD_TOKEN_PROXY_PATH = '/api/agent-board/token';
const BOARD_SNAPSHOT_PROXY_PATH = '/api/agent-board/snapshot';
const BOARD_DISCONNECT_PROXY_PATH = '/api/agent-board/disconnect';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const PAIRING_TOKEN_TYPE = 'urn:t3:params:oauth:token-type:environment-bootstrap';
const ACCESS_TOKEN_TYPE = 'urn:t3:params:oauth:token-type:access_token';

export const SESSION_STATES = Object.freeze([
  'starting',
  'ready',
  'running',
  'waiting',
  'stopped',
  'error',
]);

export const THREAD_STATES = Object.freeze([
  'active',
  'idle',
  'archived',
  'closed',
  'compacted',
  'error',
]);

export const TURN_STATES = Object.freeze([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
]);

const ERROR_KINDS = Object.freeze([
  'notConfigured',
  'pairingFailed',
  'unauthorized',
  'forbidden',
  'notFound',
  'network',
  'invalidResponse',
  'unknown',
]);

const AUTH_MODES = new Set(['none', 'bearer', 'dpop', 'custom', 'pairing']);

export class ConnectorConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConnectorConfigError';
  }
}

export class ConnectorRequestError extends Error {
  constructor({ kind, message, status, endpoint, cause } = {}) {
    super(message || 'Connector request failed.');
    this.name = 'ConnectorRequestError';
    this.errorKind = ERROR_KINDS.includes(kind) ? kind : 'unknown';
    this.status = Number.isInteger(status) ? status : undefined;
    this.endpoint = endpoint || '';
    this.cause = cause;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeErrorCode(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9_.:-]{0,80}$/i.test(trimmed) ? trimmed : undefined;
}

function firstString(...values) {
  for (const value of values) {
    const result = nonEmptyString(value);
    if (result) return result;
  }
  return undefined;
}

function explicitId(record, ...keys) {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function statusValue(record, ...keys) {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mapStatus(value, known) {
  return known.includes(value) ? value : 'error';
}

export function mapSessionStatus(value) {
  return mapStatus(value, SESSION_STATES);
}

export function mapThreadStatus(value) {
  return mapStatus(value, THREAD_STATES);
}

export function mapTurnStatus(value) {
  return mapStatus(value, TURN_STATES);
}

function mapProject(value) {
  const record = isRecord(value) ? value : {};
  const rawStatus = statusValue(record, 'status', 'projectStatus', 'state');
  return {
    id: explicitId(record, 'id', 'projectId'),
    title: firstString(record.title, record.name, record.label) || '未命名项目',
    summary: firstString(record.summary, record.description) || '',
    rawStatus,
    status: rawStatus ? mapThreadStatus(rawStatus) : undefined,
  };
}

function mapThread(value) {
  const record = isRecord(value) ? value : {};
  const session = isRecord(record.session) ? record.session : {};
  const turn = isRecord(record.turn) ? record.turn : {};
  const rawStatus = statusValue(record, 'status', 'threadStatus', 'state');
  const rawSessionStatus = statusValue(
    record,
    'sessionStatus',
    'session_state',
  ) || statusValue(session, 'status', 'state');
  const rawTurnStatus = statusValue(record, 'turnStatus') || statusValue(turn, 'status', 'state');

  return {
    id: explicitId(record, 'id', 'threadId'),
    projectId: explicitId(record, 'projectId'),
    title: firstString(record.title, record.name, record.label) || '未命名线程',
    summary: firstString(record.summary, record.description, record.preview) || '',
    rawStatus,
    status: rawStatus ? mapThreadStatus(rawStatus) : undefined,
    rawSessionStatus,
    sessionStatus: rawSessionStatus ? mapSessionStatus(rawSessionStatus) : undefined,
    rawTurnStatus,
    turnStatus: rawTurnStatus ? mapTurnStatus(rawTurnStatus) : undefined,
  };
}

export function normalizeSnapshot(payload) {
  if (!isRecord(payload)) {
    throw new ConnectorRequestError({
      kind: 'invalidResponse',
      message: 'Snapshot response must be a JSON object.',
    });
  }

  const { snapshotSequence, projects, threads, updatedAt } = payload;
  const validSequence = (typeof snapshotSequence === 'string' && Boolean(snapshotSequence.trim()))
    || (typeof snapshotSequence === 'number' && Number.isFinite(snapshotSequence));
  if (!validSequence || !Array.isArray(projects) || !Array.isArray(threads)) {
    throw new ConnectorRequestError({
      kind: 'invalidResponse',
      message: 'Snapshot response is missing snapshotSequence, projects, or threads.',
    });
  }

  return {
    snapshotSequence,
    projects: projects.map(mapProject),
    threads: threads.map(mapThread),
    updatedAt: nonEmptyString(updatedAt),
  };
}

export function normalizeBaseUrl(value) {
  const input = nonEmptyString(value);
  if (!input) return '';

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new ConnectorConfigError('Endpoint must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorConfigError('Endpoint must use http or https.');
  }
  if (url.username || url.password) {
    throw new ConnectorConfigError('Endpoint credentials must not be embedded in the URL.');
  }

  // Query strings and fragments can accidentally contain credentials. They are not part of
  // the environment base URL and are intentionally discarded before any request is made.
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function parsePairingUrl(value, fallbackBaseUrl = '') {
  const input = nonEmptyString(value);
  if (!input) throw new ConnectorConfigError('请输入 T3 配对链接。');

  let url;
  try {
    url = new URL(input);
  } catch {
    // T3 also exposes the same one-time credential as a pairing code. Accepting a
    // raw code avoids forcing users to reconstruct a URL when the desktop dialog
    // only offers “Show code”. Whitespace is rejected so pasted prose cannot be
    // accidentally sent as a credential.
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input) && !input.startsWith('/') && !/\s/.test(input)) {
      const base = normalizeBaseUrl(fallbackBaseUrl);
      if (!base) throw new ConnectorConfigError('直接配对码需要先填写 HTTP endpoint。');
      const endpointUrl = new URL(base);
      endpointUrl.pathname = '/';
      endpointUrl.search = '';
      endpointUrl.hash = '';
      return Object.freeze({
        endpoint: endpointUrl.toString().replace(/\/$/, ''),
        token: input,
      });
    }
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      throw new ConnectorConfigError('配对链接必须使用 http 或 https。');
    }
    if (!/^\/pair\/?(?:[?#]|$)/i.test(input)) {
      throw new ConnectorConfigError('配对链接必须是完整 URL，或以 /pair 开头的路径。');
    }
    const base = normalizeBaseUrl(fallbackBaseUrl);
    if (!base) {
      throw new ConnectorConfigError('相对配对路径需要先填写 HTTP endpoint。');
    }
    try {
      url = new URL(input, `${base}/`);
    } catch {
      throw new ConnectorConfigError('配对链接的 endpoint 无效。');
    }
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorConfigError('配对链接必须使用 http 或 https。');
  }
  if (url.username || url.password) {
    throw new ConnectorConfigError('配对链接不能包含嵌入式账户凭据。');
  }
  if (!/\/pair\/?$/i.test(url.pathname)) {
    throw new ConnectorConfigError('配对链接路径必须是 /pair。');
  }

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const fragmentParams = new URLSearchParams(fragment);
  const token = nonEmptyString(fragmentParams.get('token'))
    || nonEmptyString(url.searchParams.get('token'));
  if (!token) throw new ConnectorConfigError('配对链接中没有 token。');

  const hostedEndpoint = nonEmptyString(url.searchParams.get('host'))
    || nonEmptyString(fragmentParams.get('host'));
  const endpointUrl = new URL(hostedEndpoint ? normalizeBaseUrl(hostedEndpoint) : url.origin);
  // T3 resolves remote hosts to their origin (its own client drops any path),
  // so never append API routes below a pairing page or hosted relay path.
  endpointUrl.pathname = '/';
  endpointUrl.search = '';
  endpointUrl.hash = '';
  const endpoint = endpointUrl.toString().replace(/\/$/, '');
  if (!endpoint) throw new ConnectorConfigError('配对链接没有有效的 environment host。');

  return Object.freeze({ endpoint, token });
}

export function buildApiUrl(baseUrl, path) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new ConnectorConfigError('Endpoint is not configured.');
  const base = new URL(`${normalized}/`);
  return new URL(String(path).replace(/^\/+/, ''), base).toString();
}

function customHeaderEntries(customHeaders) {
  if (!isRecord(customHeaders)) {
    throw new ConnectorConfigError('Custom auth mode requires an in-memory header object.');
  }
  return Object.entries(customHeaders).filter(([name, value]) => {
    if (!nonEmptyString(name) || typeof value !== 'string') return false;
    return !/^(cookie|set-cookie|proxy-authorization)$/i.test(name);
  });
}

export function buildAuthHeaders(config = {}) {
  const authMode = AUTH_MODES.has(config.authMode) ? config.authMode : 'none';
  const auth = isRecord(config.auth) ? config.auth : config;
  const headers = { Accept: 'application/json' };

  if (authMode === 'bearer') {
    const token = nonEmptyString(auth.bearerToken || auth.token);
    if (!token) throw new ConnectorConfigError('Bearer auth requires an in-memory token.');
    headers.Authorization = `Bearer ${token}`;
  } else if (authMode === 'dpop') {
    const token = nonEmptyString(auth.accessToken || auth.token);
    const proof = nonEmptyString(auth.dpopProof);
    if (!token || !proof) {
      throw new ConnectorConfigError('DPoP auth requires an in-memory access token and proof.');
    }
    headers.Authorization = `DPoP ${token}`;
    headers.DPoP = proof;
  } else if (authMode === 'custom') {
    for (const [name, value] of customHeaderEntries(auth.customHeaders)) headers[name] = value;
  } else if (authMode === 'pairing') {
    const token = nonEmptyString(auth.accessToken);
    if (!token) throw new ConnectorConfigError('配对认证尚未换取 access token。');
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function errorKindForStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 502 || status === 504) return 'network';
  return 'unknown';
}

function pairingErrorKindForStatus(status) {
  return status === 400 ? 'pairingFailed' : errorKindForStatus(status);
}

async function safeResponseErrorDetail(response) {
  if (!response || typeof response.json !== 'function') return '';
  try {
    const readable = typeof response.clone === 'function' ? response.clone() : response;
    const payload = await readable.json();
    if (!isRecord(payload)) return '';
    const code = safeErrorCode(payload.code || payload.error);
    const reason = safeErrorCode(payload.reason || payload.dpopFailureReason);
    if (!code && !reason) return '';
    return [code, reason && reason !== code ? reason : ''].filter(Boolean).join(':');
  } catch {
    return '';
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function elapsedMs(start) {
  return Math.max(0, Math.round(performance.now() - start));
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function endpointForError(error, fallback) {
  return error instanceof ConnectorRequestError ? error.endpoint : fallback;
}

function proxyUrl(baseUrl, path) {
  return buildApiUrl(baseUrl, path);
}

export function connectionError(error, endpoint = '', latencyMs) {
  const kind = error instanceof ConnectorRequestError
    ? error.errorKind
    : error instanceof ConnectorConfigError
      ? 'invalidResponse'
      : 'unknown';
  return {
    ok: false,
    endpoint: endpointForError(error, endpoint),
    ...(Number.isFinite(latencyMs) ? { latencyMs } : {}),
    authRequired: kind === 'unauthorized' || kind === 'forbidden' || kind === 'pairingFailed' ? true : undefined,
    errorKind: kind,
    errorMessage: error?.message || '连接失败。',
  };
}

export function createDispatchPreview({ taskId, projectId, threadId, messageId, text } = {}, idFactory) {
  const required = [
    ['taskId', taskId],
    ['projectId', projectId],
    ['threadId', threadId],
    ['text', text],
  ];
  for (const [name, value] of required) {
    if (!nonEmptyString(value)) throw new ConnectorConfigError(`Dispatch preview requires ${name}.`);
  }

  const generatedId = typeof idFactory === 'function'
    ? idFactory()
    : globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resolvedMessageId = nonEmptyString(messageId) || nonEmptyString(generatedId);
  if (!resolvedMessageId) {
    throw new ConnectorConfigError('Dispatch preview requires a message id.');
  }

  return Object.freeze({
    taskId: taskId.trim(),
    projectId: projectId.trim(),
    threadId: threadId.trim(),
    messageId: resolvedMessageId,
    text,
    requiresConfirmation: true,
  });
}

export function buildFallbackTaskPackage({ taskId = 'TASK-UNASSIGNED', title = '', text = '' } = {}) {
  const safeTaskId = nonEmptyString(taskId) || 'TASK-UNASSIGNED';
  const safeTitle = nonEmptyString(title) || '未命名任务';
  const safeText = typeof text === 'string' ? text : '';
  return [
    `任务 ID：${safeTaskId}`,
    `目标：${safeTitle}`,
    '',
    safeText,
    '',
    '发送前请在目标 T3 会话中核对项目、线程、权限和完整文本。',
  ].join('\n');
}

export class T3EnvironmentConnector {
  constructor(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
    this.config = { ...config };
    // WebView implementations can brand-check fetch's `this` value. Store a
    // bound function so invoking it through the connector cannot become an
    // “Illegal invocation” network failure; injected test fetchers still work.
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
    this.timeoutMs = Math.max(250, Number(timeoutMs) || 8000);
    this.accessToken = nonEmptyString(this.config.accessToken);
    this.proxyConnectionId = '';
  }

  get endpoint() {
    try {
      return normalizeBaseUrl(this.config.httpBaseUrl);
    } catch {
      // Never return a raw invalid URL: it may contain embedded credentials.
      return '';
    }
  }

  async #requestSnapshot() {
    const rawEndpoint = nonEmptyString(this.config.httpBaseUrl);
    if (!rawEndpoint) {
      throw new ConnectorRequestError({
        kind: 'notConfigured',
        message: '未配置 T3 environment endpoint。',
        endpoint: '',
      });
    }
    let endpoint;
    try {
      endpoint = normalizeBaseUrl(rawEndpoint);
    } catch (error) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: error.message,
        endpoint: '',
        cause: error,
      });
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new ConnectorRequestError({
        kind: 'network',
        message: '当前运行环境没有可用的 fetch。',
        endpoint,
      });
    }

    let url;
    let headers;
    let requestOptions;
    try {
      const proxyBaseUrl = nonEmptyString(this.config.proxyBaseUrl);
      const useProxy = this.config.authMode === 'pairing' && proxyBaseUrl;
      url = useProxy
        ? proxyUrl(proxyBaseUrl, BOARD_SNAPSHOT_PROXY_PATH)
        : buildApiUrl(endpoint, API_SNAPSHOT_PATH);
      headers = await this.#buildRequestHeaders(endpoint);
      requestOptions = useProxy
        ? {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          }
        : { method: 'GET', headers };
    } catch (error) {
      if (error instanceof ConnectorRequestError) throw error;
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: error.message,
        endpoint,
        cause: error,
      });
    }

    const started = performance.now();
    const timeout = timeoutSignal(this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...requestOptions,
        signal: timeout.signal,
      });
    } catch (error) {
      timeout.cancel();
      throw new ConnectorRequestError({
        kind: 'network',
        message: isAbortError(error)
          ? '连接超时。请检查 endpoint、网络或浏览器 CORS/代理设置。'
          : '网络请求失败。请检查 endpoint、网络或浏览器 CORS/代理设置。',
        endpoint,
        cause: error,
      });
    }
    timeout.cancel();

    const latencyMs = elapsedMs(started);
    if (!response || typeof response.ok !== 'boolean') {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '请求返回了无效的 Response。',
        endpoint,
      });
    }
    if (!response.ok) {
      const detail = await safeResponseErrorDetail(response);
      throw new ConnectorRequestError({
        kind: errorKindForStatus(response.status),
        message: `T3 endpoint 返回 HTTP ${response.status}${detail ? `（${detail}）` : ''}。`,
        status: response.status,
        endpoint,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: 'T3 endpoint 返回的 JSON 无法解析。',
        status: response.status,
        endpoint,
        cause: error,
      });
    }

    try {
      return { snapshot: normalizeSnapshot(payload), latencyMs, status: response.status };
    } catch (error) {
      if (error instanceof ConnectorRequestError) {
        error.endpoint = endpoint;
        error.status = response.status;
        throw error;
      }
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: 'T3 endpoint 返回的 snapshot 不符合合同。',
        status: response.status,
        endpoint,
        cause: error,
      });
    }
  }

  async #buildRequestHeaders(endpoint) {
    if (this.config.authMode !== 'pairing') return buildAuthHeaders(this.config);
    const proxyBaseUrl = nonEmptyString(this.config.proxyBaseUrl);
    if (proxyBaseUrl) {
      const connectionId = await this.#createProxyConnection(endpoint, proxyBaseUrl);
      return {
        Accept: 'application/json',
        'X-Agent-Board-Connection': connectionId,
      };
    }
    const accessToken = await this.#exchangePairingToken(endpoint);
    return buildAuthHeaders({ authMode: 'pairing', accessToken });
  }

  async #createProxyConnection(endpoint, proxyBaseUrl) {
    if (this.proxyConnectionId) return this.proxyConnectionId;
    const pairingToken = nonEmptyString(this.config.pairingToken);
    if (!pairingToken) {
      throw new ConnectorRequestError({
        kind: 'pairingFailed',
        message: '配对凭据缺失、已过期或已被清除。',
        endpoint,
      });
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new ConnectorRequestError({
        kind: 'network',
        message: '当前运行环境没有可用的 fetch。',
        endpoint,
      });
    }

    let response;
    const timeout = timeoutSignal(this.timeoutMs);
    try {
      response = await this.fetchImpl(proxyUrl(proxyBaseUrl, BOARD_TOKEN_PROXY_PATH), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, pairingToken }),
        signal: timeout.signal,
      });
    } catch (error) {
      timeout.cancel();
      throw new ConnectorRequestError({
        kind: 'network',
        message: isAbortError(error)
          ? '本机配对代理超时。请检查 Agent Board 是否仍在运行。'
          : '本机配对代理不可用。请检查 Agent Board 是否仍在运行。',
        endpoint,
        cause: error,
      });
    }
    timeout.cancel();

    if (!response || typeof response.ok !== 'boolean') {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '本机配对代理返回了无效的 Response。',
        endpoint,
      });
    }
    if (!response.ok) {
      const detail = await safeResponseErrorDetail(response);
      throw new ConnectorRequestError({
        kind: pairingErrorKindForStatus(response.status),
        message: response.status === 400
          ? `配对链接已失效、已被使用，或当前 environment 拒绝配对${detail ? `（${detail}）` : ''}。`
          : `本机配对代理返回 HTTP ${response.status}${detail ? `（${detail}）` : ''}。`,
        status: response.status,
        endpoint,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '本机配对代理返回的 JSON 无法解析。',
        status: response.status,
        endpoint,
        cause: error,
      });
    }
    const connectionId = isRecord(payload) ? nonEmptyString(payload.connectionId) : undefined;
    if (!connectionId) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '本机配对代理没有返回连接句柄。',
        status: response.status,
        endpoint,
      });
    }
    this.proxyConnectionId = connectionId;
    this.config.pairingToken = '';
    return connectionId;
  }

  async #exchangePairingToken(endpoint) {
    if (this.accessToken) return this.accessToken;
    const pairingToken = nonEmptyString(this.config.pairingToken);
    if (!pairingToken) {
      throw new ConnectorRequestError({
        kind: 'unauthorized',
        message: '配对凭据缺失或已被清除。',
        endpoint,
      });
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new ConnectorRequestError({
        kind: 'network',
        message: '当前运行环境没有可用的 fetch。',
        endpoint,
      });
    }

    const url = buildApiUrl(endpoint, OAUTH_TOKEN_PATH);
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: pairingToken,
      subject_token_type: PAIRING_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
    }).toString();
    const timeout = timeoutSignal(this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: timeout.signal,
      });
    } catch (error) {
      timeout.cancel();
      throw new ConnectorRequestError({
        kind: 'network',
        message: isAbortError(error)
          ? '配对交换超时。请检查 endpoint、网络或浏览器 CORS/代理设置。'
          : '配对交换失败。请检查 endpoint、网络或浏览器 CORS/代理设置。',
        endpoint,
        cause: error,
      });
    }
    timeout.cancel();

    if (!response || typeof response.ok !== 'boolean') {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '配对交换返回了无效的 Response。',
        endpoint,
      });
    }
    if (!response.ok) {
      const detail = await safeResponseErrorDetail(response);
      throw new ConnectorRequestError({
        kind: pairingErrorKindForStatus(response.status),
        message: response.status === 400
          ? `配对链接已失效、已被使用，或当前 environment 拒绝配对${detail ? `（${detail}）` : ''}。`
          : `配对交换返回 HTTP ${response.status}${detail ? `（${detail}）` : ''}。`,
        status: response.status,
        endpoint,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '配对交换返回的 JSON 无法解析。',
        status: response.status,
        endpoint,
        cause: error,
      });
    }
    const accessToken = isRecord(payload) ? nonEmptyString(payload.access_token) : undefined;
    if (!accessToken) {
      throw new ConnectorRequestError({
        kind: 'invalidResponse',
        message: '配对交换响应缺少 access_token。',
        status: response.status,
        endpoint,
      });
    }
    this.accessToken = accessToken;
    this.config.pairingToken = '';
    return accessToken;
  }

  async checkConnection() {
    const rawEndpoint = nonEmptyString(this.config.httpBaseUrl);
    if (!rawEndpoint) return connectionError(new ConnectorRequestError({
      kind: 'notConfigured',
      message: '未配置 T3 environment endpoint。',
      endpoint: '',
    }));

    const started = performance.now();
    try {
      const result = await this.#requestSnapshot();
      return {
        ok: true,
        endpoint: this.endpoint,
        latencyMs: result.latencyMs,
        authRequired: false,
        snapshotSequence: result.snapshot.snapshotSequence,
      };
    } catch (error) {
      return connectionError(error, this.endpoint, elapsedMs(started));
    }
  }

  async fetchSnapshot() {
    const result = await this.#requestSnapshot();
    return result.snapshot;
  }

  async clearCredentials() {
    const proxyBaseUrl = nonEmptyString(this.config.proxyBaseUrl);
    const connectionId = this.proxyConnectionId;
    this.accessToken = '';
    this.proxyConnectionId = '';
    this.config.pairingToken = '';
    if (!proxyBaseUrl || !connectionId || typeof this.fetchImpl !== 'function') return;
    try {
  await this.fetchImpl(proxyUrl(proxyBaseUrl, BOARD_DISCONNECT_PROXY_PATH), {
        method: 'POST',
        headers: { 'X-Agent-Board-Connection': connectionId },
      });
    } catch {
      // The local server discards expired sessions on its own; never surface credential cleanup failures.
    }
  }
}

export { API_SNAPSHOT_PATH };
export { OAUTH_TOKEN_PATH };
