import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, describe, test } from 'node:test';

import {
  ConnectorConfigError,
  T3EnvironmentConnector,
  buildApiUrl,
  buildAuthHeaders,
  buildFallbackTaskPackage,
  createDispatchPreview,
  mapSessionStatus,
  mapThreadStatus,
  mapTurnStatus,
  normalizeBaseUrl,
  normalizeSnapshot,
  parsePairingUrl,
} from '../src/connector.mjs';

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map((server) => new Promise((resolve) => server.close(resolve))));
  openServers.clear();
});

function startMockServer(handler) {
  const server = createServer(handler);
  openServers.add(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, baseUrl: `http://127.0.0.1:${port}`, requests: [] });
  }));
}

const snapshot = {
  snapshotSequence: 'seq-17',
  updatedAt: '2026-09-05T14:00:00Z',
  projects: [
    { id: 'project-alpha', title: 'Alpha', summary: 'Project summary', status: 'active' },
  ],
  threads: [
    {
      id: 'thread-1',
      projectId: 'project-alpha',
      title: 'Build connector',
      summary: 'Connector work',
      status: 'idle',
      sessionStatus: 'ready',
      turnStatus: 'completed',
    },
  ],
};

describe('connector pure contracts', () => {
  test('normalizes a safe endpoint and joins API paths', () => {
    assert.equal(normalizeBaseUrl(' https://example.test/env/?secret=drop#fragment '), 'https://example.test/env');
    assert.equal(buildApiUrl('https://example.test/env', '/api/orchestration/snapshot'), 'https://example.test/env/api/orchestration/snapshot');
    assert.throws(() => normalizeBaseUrl('file:///tmp/env'), ConnectorConfigError);
    assert.throws(() => normalizeBaseUrl('https://user:pass@example.test'), ConnectorConfigError);
  });

  test('parses desktop and hosted pairing URLs without retaining the token in the endpoint', () => {
    const local = parsePairingUrl('http://127.0.0.1:3773/pair#token=REDACTED_TEST_PAIR');
    assert.deepEqual(local, {
      endpoint: 'http://127.0.0.1:3773',
      token: 'REDACTED_TEST_PAIR',
    });
    const hosted = parsePairingUrl('https://relay.example/pair?host=https%3A%2F%2Fenv.example%2F&token=query-token');
    assert.deepEqual(hosted, { endpoint: 'https://env.example', token: 'query-token' });
    const hostedFragment = parsePairingUrl('https://relay.example/pair#token=fragment-token&host=https%3A%2F%2Fenv.example%2Fapi');
    assert.deepEqual(hostedFragment, { endpoint: 'https://env.example', token: 'fragment-token' });
    const relative = parsePairingUrl('/pair#token=relative-token', 'http://127.0.0.1:3773');
    assert.deepEqual(relative, { endpoint: 'http://127.0.0.1:3773', token: 'relative-token' });
    const rawCode = parsePairingUrl('raw-pairing-code', 'http://127.0.0.1:3773/api');
    assert.deepEqual(rawCode, { endpoint: 'http://127.0.0.1:3773', token: 'raw-pairing-code' });
    assert.throws(() => parsePairingUrl('http://127.0.0.1:3773/draft/abc'), /路径必须是 \/pair/);
    assert.throws(() => parsePairingUrl('http://127.0.0.1:3773/pair'), /没有 token/);
    assert.throws(() => parsePairingUrl('/pair#token=relative-token'), /需要先填写 HTTP endpoint/);
    assert.throws(() => parsePairingUrl('ftp://127.0.0.1:3773/pair#token=bad'), /必须使用 http 或 https/);
  });

  test('builds bearer and DPoP headers only from in-memory config', () => {
    assert.deepEqual(buildAuthHeaders({ authMode: 'none' }), { Accept: 'application/json' });
    assert.equal(buildAuthHeaders({ authMode: 'bearer', bearerToken: 'REDACTED_TEST_BEARER' }).Authorization, 'Bearer REDACTED_TEST_BEARER');
    assert.deepEqual(buildAuthHeaders({ authMode: 'dpop', accessToken: 'REDACTED_TEST_ACCESS', dpopProof: 'REDACTED_TEST_DPOP' }), {
      Accept: 'application/json',
      Authorization: 'DPoP REDACTED_TEST_ACCESS',
      DPoP: 'REDACTED_TEST_DPOP',
    });
    assert.throws(() => buildAuthHeaders({ authMode: 'bearer' }), ConnectorConfigError);
  });

  test('maps explicit status values and preserves unknown raw values', () => {
    assert.equal(mapSessionStatus('running'), 'running');
    assert.equal(mapThreadStatus('archived'), 'archived');
    assert.equal(mapTurnStatus('failed'), 'failed');
    assert.equal(mapSessionStatus('paused-by-provider'), 'error');
    assert.equal(mapThreadStatus('paused-by-provider'), 'error');
    assert.equal(mapTurnStatus('paused-by-provider'), 'error');

    const result = normalizeSnapshot({
      ...snapshot,
      threads: [{ ...snapshot.threads[0], status: 'provider-specific' }],
    });
    assert.equal(result.snapshotSequence, 'seq-17');
    assert.equal(result.projects[0].id, 'project-alpha');
    assert.equal(result.threads[0].id, 'thread-1');
    assert.equal(result.threads[0].status, 'error');
    assert.equal(result.threads[0].rawStatus, 'provider-specific');
  });

  test('rejects snapshots without sequence or arrays', () => {
    assert.throws(() => normalizeSnapshot({ projects: [], threads: [] }), /snapshotSequence/);
    assert.throws(() => normalizeSnapshot({ snapshotSequence: 1, projects: {}, threads: [] }), /projects/);
  });
});

describe('T3 environment connector', () => {
  test('binds the injected fetch implementation to the global context', async () => {
    let observedThis;
    function fetchImpl() {
      observedThis = this;
      return Promise.resolve(new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }
    const result = await new T3EnvironmentConnector({
      httpBaseUrl: 'http://127.0.0.1:3773',
      authMode: 'none',
    }, { fetchImpl }).checkConnection();
    assert.equal(result.ok, true);
    assert.equal(observedThis, globalThis);
  });

  test('exchanges a pairing token in memory before reading snapshot', async () => {
    const fixture = await startMockServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      fixture.requests.push({
        method: req.method,
        path: req.url,
        body,
        authorization: req.headers.authorization || '',
      });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/oauth/token') {
        res.end(JSON.stringify({ access_token: 'REDACTED_TEST_ACCESS' }));
        return;
      }
      res.end(JSON.stringify(snapshot));
    });
    const connector = new T3EnvironmentConnector({
      httpBaseUrl: fixture.baseUrl,
      authMode: 'pairing',
      pairingToken: 'REDACTED_TEST_PAIR',
    });

    const result = await connector.checkConnection();
    assert.equal(result.ok, true);
    assert.equal(result.snapshotSequence, 'seq-17');
    assert.deepEqual(fixture.requests, [
      {
        method: 'POST',
        path: '/oauth/token',
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange&subject_token=REDACTED_TEST_PAIR&subject_token_type=urn%3At3%3Aparams%3Aoauth%3Atoken-type%3Aenvironment-bootstrap&requested_token_type=urn%3At3%3Aparams%3Aoauth%3Atoken-type%3Aaccess_token',
        authorization: '',
      },
      {
        method: 'GET',
        path: '/api/orchestration/snapshot',
        body: '',
        authorization: 'Bearer REDACTED_TEST_ACCESS',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /REDACTED_TEST_PAIR|REDACTED_TEST_ACCESS/);
  });

  test('uses a same-origin proxy handle without exposing the exchanged access token to the browser', async () => {
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/api/agent-board/token')) {
        return new Response(JSON.stringify({ connectionId: 'REDACTED_PROXY_HANDLE' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/agent-board/snapshot')) {
        assert.equal(options.headers['X-Agent-Board-Connection'], 'REDACTED_PROXY_HANDLE');
        assert.equal(options.body, JSON.stringify({ endpoint: 'http://127.0.0.1:3773' }));
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/agent-board/disconnect')) {
        assert.equal(options.headers['X-Agent-Board-Connection'], 'REDACTED_PROXY_HANDLE');
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const connector = new T3EnvironmentConnector({
      httpBaseUrl: 'http://127.0.0.1:3773',
      proxyBaseUrl: 'http://127.0.0.1:4174',
      authMode: 'pairing',
      pairingToken: 'REDACTED_PROXY_PAIR',
    }, { fetchImpl });

    const checked = await connector.checkConnection();
    const loaded = await connector.fetchSnapshot();
    await connector.clearCredentials();
    assert.equal(checked.ok, true);
    assert.equal(loaded.snapshotSequence, 'seq-17');
    assert.equal(requests.length, 4);
    assert.doesNotMatch(JSON.stringify(requests[0]), /REDACTED_TEST_ACCESS/);
    assert.doesNotMatch(JSON.stringify(checked), /REDACTED_PROXY_PAIR|REDACTED_TEST_ACCESS/);
  });

  test('classifies pairing exchange authorization failures without exposing the pairing token', async () => {
    const fixture = await startMockServer((_req, res) => {
      res.statusCode = 401;
      res.end('pairing rejected');
    });
    const result = await new T3EnvironmentConnector({
      httpBaseUrl: fixture.baseUrl,
      authMode: 'pairing',
      pairingToken: 'REDACTED_TEST_PAIR',
    }).checkConnection();
    assert.equal(result.ok, false);
    assert.equal(result.errorKind, 'unauthorized');
    assert.doesNotMatch(JSON.stringify(result), /REDACTED_TEST_PAIR/);
  });

  test('returns a first-class notConfigured result', async () => {
    const result = await new T3EnvironmentConnector({ authMode: 'none' }).checkConnection();
    assert.deepEqual(result, {
      ok: false,
      endpoint: '',
      authRequired: undefined,
      errorKind: 'notConfigured',
      errorMessage: '未配置 T3 environment endpoint。',
    });
  });

  test('does not echo credentials from an invalid endpoint', async () => {
    const result = await new T3EnvironmentConnector({
      httpBaseUrl: 'https://user:embedded-value@example.test/environment',
      authMode: 'none',
    }).checkConnection();
    assert.equal(result.ok, false);
    assert.equal(result.errorKind, 'invalidResponse');
    assert.equal(result.endpoint, '');
    assert.doesNotMatch(JSON.stringify(result), /embedded-value|user:/);
  });

  test('checks the snapshot endpoint and preserves the sequence', async () => {
    const fixture = await startMockServer((req, res) => {
      fixture.requests.push({ method: req.method, path: req.url });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(snapshot));
    });
    const connector = new T3EnvironmentConnector({ httpBaseUrl: `${fixture.baseUrl}/env/`, authMode: 'none' });

    const checked = await connector.checkConnection();
    const loaded = await connector.fetchSnapshot();
    assert.equal(checked.ok, true);
    assert.equal(checked.snapshotSequence, 'seq-17');
    assert.equal(loaded.snapshotSequence, 'seq-17');
    assert.deepEqual(fixture.requests, [
      { method: 'GET', path: '/env/api/orchestration/snapshot' },
      { method: 'GET', path: '/env/api/orchestration/snapshot' },
    ]);
  });

  for (const [status, errorKind, authRequired] of [[401, 'unauthorized', true], [403, 'forbidden', true], [404, 'notFound', undefined]]) {
    test(`classifies HTTP ${status} as ${errorKind}`, async () => {
      const fixture = await startMockServer((_req, res) => {
        res.statusCode = status;
        res.end('no details');
      });
      const result = await new T3EnvironmentConnector({ httpBaseUrl: fixture.baseUrl, authMode: 'none' }).checkConnection();
      assert.equal(result.ok, false);
      assert.equal(result.errorKind, errorKind);
      assert.equal(result.authRequired, authRequired);
      assert.match(result.errorMessage, new RegExp(`HTTP ${status}`));
    });
  }

  test('classifies malformed JSON as invalidResponse without returning body text', async () => {
    const fixture = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"private-value":"must-not-be-echoed"');
    });
    const result = await new T3EnvironmentConnector({ httpBaseUrl: fixture.baseUrl, authMode: 'none' }).checkConnection();
    assert.equal(result.errorKind, 'invalidResponse');
    assert.doesNotMatch(result.errorMessage, /must-not-be-echoed/);
  });

  test('classifies an aborted request as network timeout', async () => {
    const fixture = await startMockServer((_req, res) => {
      setTimeout(() => res.end(JSON.stringify(snapshot)), 400);
    });
    const result = await new T3EnvironmentConnector({ httpBaseUrl: fixture.baseUrl, authMode: 'none' }, { timeoutMs: 250 }).checkConnection();
    assert.equal(result.ok, false);
    assert.equal(result.errorKind, 'network');
    assert.match(result.errorMessage, /超时/);
  });
});

describe('dry-run and fallback', () => {
  test('creates a confirmation-required preview without any dispatch method', async () => {
    const fixture = await startMockServer((req, res) => {
      fixture.requests.push({ method: req.method, path: req.url });
      res.end(JSON.stringify(snapshot));
    });
    const connector = new T3EnvironmentConnector({ httpBaseUrl: fixture.baseUrl, authMode: 'none' });
    const preview = createDispatchPreview({
      taskId: 'TASK-BOARD-1',
      projectId: 'project-alpha',
      threadId: 'thread-1',
      messageId: 'REDACTED_TEST_MESSAGE',
      text: '完整任务文本',
    });

    assert.deepEqual(preview, {
      taskId: 'TASK-BOARD-1',
      projectId: 'project-alpha',
      threadId: 'thread-1',
      messageId: 'REDACTED_TEST_MESSAGE',
      text: '完整任务文本',
      requiresConfirmation: true,
    });
    assert.equal(typeof connector.dispatch, 'undefined');
    await Promise.resolve();
    assert.deepEqual(fixture.requests, []);
  });

  test('builds a copyable fallback package without credentials', () => {
    const packageText = buildFallbackTaskPackage({ taskId: 'TASK-1', title: '测试任务', text: '执行内容' });
    assert.match(packageText, /TASK-1/);
    assert.match(packageText, /发送前请在目标 T3 会话中核对/);
    assert.doesNotMatch(packageText, /Bearer|DPoP|cookie|token/i);
  });
});
