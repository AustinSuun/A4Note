import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.AGENT_BOARD_PORT || 4174);
const host = process.env.AGENT_BOARD_HOST || '127.0.0.1';
const mockEnabled = process.env.AGENT_BOARD_MOCK === '1';
const proxyConnections = new Map();
const proxyConnectionTtlMs = 15 * 60 * 1000;
function configuredOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}
const allowedProxyOrigins = new Set([
  'http://127.0.0.1:3773',
  'http://localhost:3773',
  'http://192.168.56.1:3773',
  ...(mockEnabled ? [`http://127.0.0.1:${port}`] : []),
  ...(configuredOrigin(process.env.AGENT_BOARD_T3_ENDPOINT) ? [configuredOrigin(process.env.AGENT_BOARD_T3_ENDPOINT)] : []),
]);
const mockSnapshot = {
  snapshotSequence: 'mock-seq-1',
  updatedAt: '2026-09-05T14:40:00Z',
  projects: [{ id: 'mock-project', title: 'Mock Project', summary: '脱敏 fixture', status: 'idle' }],
  threads: [{
    id: 'mock-thread',
    projectId: 'mock-project',
    title: 'Mock Thread',
    summary: '仅用于浏览器回归',
    status: 'idle',
    sessionStatus: 'ready',
    turnStatus: 'completed',
  }],
};
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

function parseTargetEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('endpoint_missing');
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('endpoint_invalid');
  }
  if (!allowedProxyOrigins.has(url.origin)) throw new Error('endpoint_not_allowed');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

async function readJsonBody(request, maxBytes = 32 * 1024) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error('body_too_large');
  }
  try {
    const parsed = JSON.parse(body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body_invalid');
    return parsed;
  } catch {
    throw new Error('body_invalid');
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function safeErrorCode(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9_.:-]{0,80}$/i.test(trimmed) ? trimmed : undefined;
}

async function upstreamErrorPayload(upstream) {
  const payload = { error: 'upstream_rejected' };
  try {
    const body = await upstream.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const code = safeErrorCode(body.code || body.error);
      const reason = safeErrorCode(body.reason || body.dpopFailureReason);
      if (code) payload.code = code;
      if (reason) payload.reason = reason;
    }
  } catch {
    // Some auth failures intentionally have an empty body. Preserve only status.
  }
  return payload;
}

function getProxyConnection(connectionId) {
  const connection = connectionId ? proxyConnections.get(connectionId) : undefined;
  if (!connection) return undefined;
  if (Date.now() - connection.createdAt > proxyConnectionTtlMs) {
    proxyConnections.delete(connectionId);
    return undefined;
  }
  return connection;
}

async function proxyTokenExchange(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid_request' });
    return;
  }
  let endpoint;
  try {
    endpoint = parseTargetEndpoint(body.endpoint);
  } catch {
    sendJson(response, 400, { error: 'invalid_endpoint' });
    return;
  }
  if (typeof body.pairingToken !== 'string' || !body.pairingToken.trim()) {
    sendJson(response, 400, { error: 'invalid_request' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let upstream;
  try {
    upstream = await fetch(`${endpoint}/oauth/token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: body.pairingToken,
        subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
        requested_token_type: 'urn:t3:params:oauth:token-type:access_token',
      }),
      signal: controller.signal,
    });
  } catch {
    sendJson(response, 502, { error: 'upstream_unreachable' });
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok) {
    sendJson(response, upstream.status, await upstreamErrorPayload(upstream));
    return;
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'upstream_invalid_response' });
    return;
  }
  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    sendJson(response, 502, { error: 'upstream_invalid_response' });
    return;
  }
  const connectionId = randomUUID();
  proxyConnections.set(connectionId, {
    endpoint,
    accessToken: payload.access_token,
    createdAt: Date.now(),
  });
  sendJson(response, 200, { connectionId });
}

async function proxySnapshot(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid_request' });
    return;
  }
  const connectionId = typeof request.headers['x-agent-board-connection'] === 'string'
    ? request.headers['x-agent-board-connection']
    : '';
  const connection = getProxyConnection(connectionId);
  if (!connection) {
    sendJson(response, 401, { error: 'missing_credential' });
    return;
  }
  let endpoint;
  try {
    endpoint = parseTargetEndpoint(body.endpoint);
  } catch {
    sendJson(response, 400, { error: 'invalid_endpoint' });
    return;
  }
  if (endpoint !== connection.endpoint) {
    sendJson(response, 403, { error: 'endpoint_mismatch' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let upstream;
  try {
    upstream = await fetch(`${endpoint}/api/orchestration/snapshot`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${connection.accessToken}` },
      signal: controller.signal,
    });
  } catch {
    sendJson(response, 502, { error: 'upstream_unreachable' });
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok) {
    sendJson(response, upstream.status, await upstreamErrorPayload(upstream));
    return;
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'upstream_invalid_response' });
    return;
  }
  sendJson(response, 200, payload);
}

function disconnectProxyConnection(request, response) {
  const connectionId = typeof request.headers['x-agent-board-connection'] === 'string'
    ? request.headers['x-agent-board-connection']
    : '';
  if (connectionId) proxyConnections.delete(connectionId);
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

const server = createServer(async (request, response) => {
  const requested = request.url?.split('?')[0] || '/';
  if (mockEnabled) {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'Accept, Authorization, DPoP, Content-Type');
  }
  if (mockEnabled && request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (mockEnabled && request.method === 'GET' && requested === '/api/orchestration/snapshot') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(mockSnapshot));
    return;
  }
  if (mockEnabled && request.method === 'POST' && requested === '/oauth/token') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const params = new URLSearchParams(body);
    if (params.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:token-exchange'
      || !params.get('subject_token')) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'invalid_request' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ access_token: 'REDACTED_MOCK_ACCESS_TOKEN', token_type: 'Bearer' }));
    return;
  }
  if (request.method === 'POST' && requested === '/api/agent-board/token') {
    await proxyTokenExchange(request, response);
    return;
  }
  if (request.method === 'POST' && requested === '/api/agent-board/snapshot') {
    await proxySnapshot(request, response);
    return;
  }
  if (request.method === 'POST' && requested === '/api/agent-board/disconnect') {
    disconnectProxyConnection(request, response);
    return;
  }
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const filePath = normalize(join(root, relative));
  const rootPath = normalize(root).replace(/[\\/]+$/, '');
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log(`Agent Board listening at http://127.0.0.1:${port}`);
});
