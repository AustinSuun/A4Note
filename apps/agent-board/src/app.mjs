import {
  ConnectorConfigError,
  T3EnvironmentConnector,
  buildFallbackTaskPackage,
  createDispatchPreview,
  parsePairingUrl,
} from './connector.mjs';

const state = {
  connector: null,
  config: null,
  snapshot: null,
  selectedProjectId: '',
  selectedThreadId: '',
  preview: null,
};

const $ = (id) => document.getElementById(id);
const connectionForm = $('connection-form');
const endpointInput = $('endpoint');
const authModeInput = $('auth-mode');
const bearerTokenInput = $('bearer-token');
const accessTokenInput = $('access-token');
const dpopProofInput = $('dpop-proof');
const customHeadersInput = $('custom-headers');
const pairingUrlInput = $('pairing-url');
const projectSelect = $('project-select');
const threadSelect = $('thread-select');

const errorLabels = {
  notConfigured: '未配置 endpoint',
  unauthorized: '认证失败（401）',
  pairingFailed: '配对失败（链接可能已失效）',
  forbidden: '没有权限（403）',
  notFound: 'endpoint 不存在（404）',
  network: '网络/CORS/超时失败',
  invalidResponse: '响应格式无效',
  unknown: '未知连接错误',
};

const statusLabels = {
  starting: 'starting',
  ready: 'ready',
  running: 'running',
  waiting: 'waiting',
  stopped: 'stopped',
  active: 'active',
  idle: 'idle',
  archived: 'archived',
  closed: 'closed',
  compacted: 'compacted',
  completed: 'completed',
  failed: 'failed',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
  error: 'error / unknown',
};

function setAuthFields() {
  const mode = authModeInput.value;
  $('bearer-fields').hidden = mode !== 'bearer';
  $('dpop-fields').hidden = mode !== 'dpop';
  $('custom-fields').hidden = mode !== 'custom';
  $('pairing-fields').hidden = mode !== 'pairing';
  endpointInput.disabled = false;
  if (mode === 'pairing') {
    endpointInput.placeholder = '完整 URL 或 /pair 路径时填写，例如 http://127.0.0.1:3773';
    if (!endpointInput.value.trim()) endpointInput.value = 'http://127.0.0.1:3773';
  }
  else endpointInput.placeholder = 'https://environment.example';
}

function statusText(status, raw) {
  if (!status) return '未提供';
  const label = statusLabels[status] || status;
  return raw && raw !== status ? `${label} · raw=${raw}` : label;
}

function setConnectionStatus(result, kind = 'idle') {
  const box = $('connection-status');
  const dot = $('connection-dot');
  dot.className = `status-dot ${kind}`;
  box.className = `status-box ${kind}`;
  box.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = result.title || (result.ok ? '连接成功' : (errorLabels[result.errorKind] || '连接失败'));
  box.append(title);
  const detail = document.createElement('span');
  if (result.ok) {
    detail.textContent = `${result.endpoint} · ${result.latencyMs ?? 0} ms · sequence ${result.snapshotSequence}`;
  } else {
    detail.textContent = result.detail || result.errorMessage || '请求未完成。';
  }
  box.append(detail);
}

function appendOption(select, value, label, disabled = false) {
  const option = document.createElement('option');
  option.value = value || '';
  option.textContent = label;
  option.disabled = disabled;
  select.append(option);
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  const hasSnapshot = Boolean(snapshot);
  $('snapshot-empty').hidden = hasSnapshot;
  $('snapshot-content').hidden = !hasSnapshot;
  $('refresh-snapshot').disabled = !state.connector;
  $('create-preview').disabled = !state.selectedProjectId || !state.selectedThreadId;
  if (!snapshot) return;

  $('snapshot-sequence').textContent = String(snapshot.snapshotSequence);
  $('snapshot-updated').textContent = snapshot.updatedAt ? `updated ${snapshot.updatedAt}` : 'updated time unavailable';

  const previousProjectId = state.selectedProjectId;
  projectSelect.replaceChildren();
  for (const project of snapshot.projects) {
    const label = project.id ? `${project.title} · ${project.id}` : `${project.title} · 缺少稳定 ID`;
    appendOption(projectSelect, project.id, label, !project.id);
  }
  state.selectedProjectId = snapshot.projects.some((item) => item.id === previousProjectId)
    ? previousProjectId
    : snapshot.projects.find((item) => item.id)?.id || '';
  projectSelect.value = state.selectedProjectId;

  const previousThreadId = state.selectedThreadId;
  threadSelect.replaceChildren();
  const threads = snapshot.threads.filter((thread) => !state.selectedProjectId || thread.projectId === state.selectedProjectId);
  for (const thread of threads) {
    const label = thread.id
      ? `${thread.title} · ${thread.id} · ${statusText(thread.status, thread.rawStatus)}`
      : `${thread.title} · 缺少稳定 ID`;
    appendOption(threadSelect, thread.id, label, !thread.id);
  }
  state.selectedThreadId = threads.some((item) => item.id === previousThreadId)
    ? previousThreadId
    : threads.find((item) => item.id)?.id || '';
  threadSelect.value = state.selectedThreadId;
  renderThreadDetail();
}

function renderThreadDetail() {
  const thread = state.snapshot?.threads.find((item) => item.id === state.selectedThreadId);
  const detail = $('thread-detail');
  detail.replaceChildren();
  if (!thread) {
    detail.textContent = '选择一个有稳定 ID 的线程。';
    return;
  }
  const summary = document.createElement('p');
  summary.textContent = thread.summary || '没有摘要';
  const states = document.createElement('div');
  states.className = 'state-row';
  for (const [label, value, raw] of [
    ['thread', thread.status, thread.rawStatus],
    ['session', thread.sessionStatus, thread.rawSessionStatus],
    ['turn', thread.turnStatus, thread.rawTurnStatus],
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${statusText(value, raw)}`;
    states.append(item);
  }
  detail.append(summary, states);
}

function buildConfig() {
  const authMode = authModeInput.value;
  const config = { httpBaseUrl: endpointInput.value, authMode };
  if (authMode === 'bearer') config.bearerToken = bearerTokenInput.value;
  if (authMode === 'dpop') {
    config.accessToken = accessTokenInput.value;
    config.dpopProof = dpopProofInput.value;
  }
  if (authMode === 'custom') {
    try {
      config.customHeaders = customHeadersInput.value.trim() ? JSON.parse(customHeadersInput.value) : {};
    } catch {
      throw new ConnectorConfigError('Custom headers 必须是有效 JSON。');
    }
  }
  if (authMode === 'pairing') {
    const pairing = parsePairingUrl(pairingUrlInput.value, endpointInput.value || 'http://127.0.0.1:3773');
    config.httpBaseUrl = pairing.endpoint;
    config.pairingToken = pairing.token;
    if (typeof window !== 'undefined' && window.location.origin !== 'null') {
      config.proxyBaseUrl = window.location.origin;
    }
  }
  return config;
}

async function connect() {
  let config;
  try {
    config = buildConfig();
  } catch (error) {
    setConnectionStatus({ ok: false, errorKind: 'invalidResponse', errorMessage: error.message }, 'error');
    return;
  }
  state.config = config;
  if (config.authMode === 'pairing') endpointInput.value = config.httpBaseUrl;
  state.connector = new T3EnvironmentConnector(config);
  setConnectionStatus({ ok: false, errorKind: 'network', errorMessage: '正在读取 snapshot…' }, 'loading');
  const result = await state.connector.checkConnection();
  if (!result.ok) {
    state.snapshot = null;
    renderSnapshot();
    setConnectionStatus(result, 'error');
    return;
  }
  if (config.authMode === 'pairing') {
    config.pairingToken = '';
    pairingUrlInput.value = '';
  }
  try {
    state.snapshot = await state.connector.fetchSnapshot();
    renderSnapshot();
    setConnectionStatus(result, 'success');
  } catch (error) {
    state.snapshot = null;
    renderSnapshot();
    setConnectionStatus({ ok: false, errorKind: error.errorKind || 'unknown', errorMessage: error.message }, 'error');
  }
}

async function refreshSnapshot() {
  if (!state.connector) return;
  setConnectionStatus({ ok: false, errorKind: 'network', errorMessage: '正在刷新 snapshot…' }, 'loading');
  try {
    state.snapshot = await state.connector.fetchSnapshot();
    renderSnapshot();
    setConnectionStatus({
      ok: true,
      endpoint: state.connector.endpoint,
      latencyMs: 0,
      snapshotSequence: state.snapshot.snapshotSequence,
    }, 'success');
  } catch (error) {
    setConnectionStatus({ ok: false, errorKind: error.errorKind || 'unknown', errorMessage: error.message }, 'error');
  }
}

function createPreview() {
  try {
    state.preview = createDispatchPreview({
      taskId: $('task-id').value,
      projectId: state.selectedProjectId,
      threadId: state.selectedThreadId,
      text: $('task-text').value,
    });
  } catch (error) {
    state.preview = null;
    $('preview-output').className = 'preview-output error';
    $('preview-output').textContent = error.message;
    return;
  }
  const output = $('preview-output');
  output.className = 'preview-output';
  output.replaceChildren();
  const badge = document.createElement('strong');
  badge.className = 'preview-confirmation';
  badge.textContent = 'DRY-RUN · 不会发送';
  output.append(badge);
  for (const [label, value] of [
    ['taskId', state.preview.taskId],
    ['projectId', state.preview.projectId],
    ['threadId', state.preview.threadId],
    ['messageId', state.preview.messageId],
  ]) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const key = document.createElement('code');
    key.textContent = label;
    const val = document.createElement('span');
    val.textContent = value;
    row.append(key, val);
    output.append(row);
  }
  const text = document.createElement('pre');
  text.className = 'preview-text';
  text.textContent = state.preview.text;
  output.append(text);
}

function fallbackText() {
  return buildFallbackTaskPackage({
    taskId: $('task-id').value,
    title: state.snapshot?.threads.find((thread) => thread.id === state.selectedThreadId)?.title || 'T3 任务',
    text: $('task-text').value,
  });
}

async function copyFallback() {
  const text = fallbackText();
  $('fallback-output').hidden = false;
  $('fallback-output').textContent = text;
  try {
    await navigator.clipboard.writeText(text);
    setConnectionStatus({
      ok: true,
      title: '任务包已复制',
      detail: '请在目标 T3 会话中人工核对并确认发送。',
      endpoint: 'fallback',
      latencyMs: 0,
      snapshotSequence: 'clipboard',
    }, 'success');
  } catch {
    setConnectionStatus({ ok: false, errorKind: 'network', errorMessage: '浏览器拒绝 Clipboard；已显示可手动复制的任务包。' }, 'error');
  }
}

authModeInput.addEventListener('change', setAuthFields);
connectionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void connect();
});
$('refresh-snapshot').addEventListener('click', () => void refreshSnapshot());
projectSelect.addEventListener('change', () => {
  state.selectedProjectId = projectSelect.value;
  state.selectedThreadId = '';
  renderSnapshot();
});
threadSelect.addEventListener('change', () => {
  state.selectedThreadId = threadSelect.value;
  renderThreadDetail();
  $('create-preview').disabled = !state.selectedProjectId || !state.selectedThreadId;
});
$('create-preview').addEventListener('click', createPreview);
$('copy-fallback').addEventListener('click', () => void copyFallback());
$('show-fallback').addEventListener('click', () => {
  $('fallback-output').hidden = !$('fallback-output').hidden;
  if (!$('fallback-output').hidden) $('fallback-output').textContent = fallbackText();
});
$('clear-credentials').addEventListener('click', () => {
  const previousConnector = state.connector;
  bearerTokenInput.value = '';
  accessTokenInput.value = '';
  dpopProofInput.value = '';
  customHeadersInput.value = '';
  pairingUrlInput.value = '';
  endpointInput.disabled = false;
  setAuthFields();
  state.config = null;
  state.connector = null;
  state.snapshot = null;
  state.selectedProjectId = '';
  state.selectedThreadId = '';
  renderSnapshot();
  setConnectionStatus({ ok: false, errorKind: 'notConfigured', errorMessage: '认证材料已从页面内存清除。' }, 'idle');
  if (previousConnector) void previousConnector.clearCredentials();
});

setAuthFields();
setConnectionStatus({ ok: false, errorKind: 'notConfigured', errorMessage: '请输入用户授权的 T3 environment endpoint。' }, 'idle');
