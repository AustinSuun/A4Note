import fs from 'node:fs';

function readAsarEntry(asarPath, entryPath) {
  const buffer = fs.readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8'));
  let node = header;
  for (const part of entryPath.split('/')) node = node.files[part];
  const dataStart = 16 + headerSize;
  return buffer.subarray(dataStart + Number(node.offset), dataStart + Number(node.offset) + node.size).toString('utf8');
}

const entries = [
  ['desktop-main', 'C:/Users/Austin/AppData/Local/Programs/t3code/resources/app.asar', 'apps/desktop/dist-electron/main.cjs'],
  ['desktop-preload', 'C:/Users/Austin/AppData/Local/Programs/t3code/resources/app.asar', 'apps/desktop/dist-electron/preload.cjs'],
];

function listAsarFiles(asarPath, prefix = '') {
  const buffer = fs.readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8'));
  const result = [];
  function walk(node, current) {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = current ? `${current}/${name}` : name;
      if (child.files) walk(child, path);
      else if (!prefix || path.startsWith(prefix)) result.push(path);
    }
  }
  walk(header, '');
  return result;
}

const patterns = [
  /ipcMain\.(handle|on|once)\([^)]{0,180}/gi,
  /ipcRenderer\.(invoke|send|on)\([^)]{0,180}/gi,
  /localhost:[0-9]{2,5}/gi,
  /127\.0\.0\.1:[0-9]{2,5}/gi,
  /WebSocket[^;]{0,220}/gi,
  /(?:threadId|conversationId|sessionId)[^,;\n]{0,180}/gi,
  /(?:mcp|MCP)[^,;\n]{0,180}/g,
  /["'`]\/api\/[A-Za-z0-9_./{}:-]{2,120}["'`]/g,
  /["'`]desktop:[A-Za-z0-9_./{}:-]{2,120}["'`]/g,
  /["'`]agent-[A-Za-z0-9_./{}:-]{2,120}["'`]/g,
];

for (const [label, asarPath, entryPath] of entries) {
  const source = readAsarEntry(asarPath, entryPath);
  console.log(`### ${label} ${entryPath} bytes=${source.length}`);
  for (const pattern of patterns) {
    const matches = [];
    for (const match of source.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, ' ').slice(0, 260);
      if (!matches.includes(value)) matches.push(value);
      if (matches.length >= 20) break;
    }
    if (matches.length > 0) {
      console.log(pattern.toString());
      for (const value of matches) console.log(`  ${value}`);
    }
  }
}

for (const [label, asarPath, prefix] of [
  ['desktop-bundle-index', entries[0][1], 'apps/desktop/dist-electron'],
  ['server-bundle-index', 'C:/Users/Austin/AppData/Local/Programs/t3code/resources/server.asar', 'apps/server'],
]) {
  const files = listAsarFiles(asarPath, prefix);
  console.log(`### ${label} files=${files.length}`);
  for (const path of files.filter((file) => /(?:license|readme|package\.json|dist|server|index|main|preload|\.d\.ts)/i.test(file)).slice(0, 200)) {
    console.log(`  ${path}`);
  }
}

const desktopSource = readAsarEntry(entries[0][1], entries[0][2]);
for (const needle of [
  '/api/orchestration/snapshot',
  '/api/orchestration/threads/:threadId',
  '/api/orchestration/dispatch',
  'ClientOrchestrationCommand',
  'OrchestrationReadModel',
  'DispatchResult',
  'agent-activity',
  'ORCHESTRATION_WS_METHODS',
  'subscribeThread',
  'subscribeShell',
  'thread.message.assistant.delta',
  'thread.turn-start-requested',
  'ClientThreadTurnStartCommand',
  'ThreadCreateCommand',
  'ThreadMessageSentPayload',
  'ThreadTurnStartRequestedPayload',
  'OrchestrationSession',
  'ProviderInteractionMode',
  'thread.runtime-mode-set',
  'plugin',
  'extension',
  'agent-platform',
  'makeIpcMethod',
  'orchestration.dispatchCommand',
  'environmentHttpApiClient',
  'httpBaseUrl',
  '/api/auth/pairing-token',
  '/api/auth/pairing-links',
  '/api/auth/clients',
  'PairingToken',
  'PairingCredential',
  'PairingLink',
  'pairingCredential',
  'pairing-token',
  'websocket-ticket',
  'EnvironmentBootstrap',
  'BootstrapToken',
  'RemotePairingUrl',
  'parseRemotePairing',
  'pairingCode',
  'pairingSecret',
  'fragmentParams',
  'hosted-pairing-host',
  'subject_token_type',
  'client_label',
]) {
  let offset = desktopSource.indexOf(needle);
  let count = 0;
  while (offset >= 0 && count < 8) {
    const context = desktopSource.slice(Math.max(0, offset - 900), Math.min(desktopSource.length, offset + needle.length + 1200))
      .replace(/\s+/g, ' ')
      .replace(/(Bearer|DPoP) [A-Za-z0-9._-]+/g, '$1 <redacted>');
    console.log(`### route-context ${needle} occurrence=${count + 1}`);
    console.log(context);
    offset = desktopSource.indexOf(needle, offset + needle.length);
    count += 1;
  }
}

const serverAsarPath = 'C:/Users/Austin/AppData/Local/Programs/t3code/resources/server.asar';
const serverFiles = listAsarFiles(serverAsarPath, 'apps/server/dist')
  .filter((file) => file.endsWith('.mjs') && !file.includes('/client/'));
for (const entryPath of serverFiles) {
  const source = readAsarEntry(serverAsarPath, entryPath);
  const hits = [];
  for (const pattern of patterns.slice(2)) {
    for (const match of source.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, ' ').slice(0, 260);
      if (!hits.includes(value)) hits.push(value);
      if (hits.length >= 20) break;
    }
  }
  if (hits.length > 0) {
    console.log(`### server-entry ${entryPath} bytes=${source.length}`);
    for (const hit of hits) console.log(`  ${hit}`);
  }
}

const serverSource = readAsarEntry(serverAsarPath, 'apps/server/dist/bin.mjs');
for (const needle of [
  'EnvironmentTokenExchangeErrors',
  'AuthTokenExchangeRequest',
  'subject_token_type',
  'invalid_grant',
  'one-time-token',
  'pairingCredential',
  'tokenExchange',
  'environment.auth.token',
  'access_token_issuance_failed',
  'consumePairing',
  'getByCredential',
  'proofKeyThumbprint',
  'serverAuth.issueAccessToken',
]) {
  let offset = serverSource.indexOf(needle);
  let count = 0;
  while (offset >= 0 && count < 6) {
    const context = serverSource.slice(Math.max(0, offset - 700), Math.min(serverSource.length, offset + needle.length + 1100))
      .replace(/\s+/g, ' ')
      .replace(/(Bearer|DPoP) [A-Za-z0-9._-]+/g, '$1 <redacted>');
    console.log(`### server-route-context ${needle} occurrence=${count + 1}`);
    console.log(context);
    offset = serverSource.indexOf(needle, offset + needle.length);
    count += 1;
  }
}
