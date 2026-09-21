import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Exit-time lifecycle for the shared task gateway.
 * A gateway is only stopped when three independent facts agree: the private
 * connection record, the live health identity of the listener, and the pid the
 * listener reports. Ports and process names alone never justify a signal.
 */
export const defaultStateDir = () =>
  process.env.TASKS_GATEWAY_DIR || path.join(os.homedir(), '.a4note-project-tasks', 'gateway-v1');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const localUrl = value =>
  typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(value) &&
  Number(value.split(':').at(-1)) > 0 && Number(value.split(':').at(-1)) <= 65535;

export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Several sessions of one alias (re-joins inside the activity window) are reported once, with the latest heartbeat. */
function dedupeAgents(agents) {
  const seen = new Map();
  for (const agent of agents) {
    const key = `${agent.project ?? ''}\u0000${agent.alias}\u0000${agent.role ?? ''}`;
    const prev = seen.get(key);
    if (!prev || Date.parse(agent.last_seen) > Date.parse(prev.last_seen)) seen.set(key, agent);
  }
  return [...seen.values()];
}

async function getJson(url, headers = {}, timeout = 1500) {
  const r = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}

/** Read-only identification of the recorded gateway. Never signals or writes. */
export async function inspectGateway({ stateDir = defaultStateDir() } = {}) {
  const c = read(path.join(stateDir, 'gateway-connection.json')), a = read(path.join(stateDir, 'gateway-access.json'));
  if (!c || !a || !localUrl(c.url) || c.id !== a.id || typeof a.token !== 'string') return { state: 'none', stateDir };
  const base = { stateDir, url: c.url, pid: c.pid, id: c.id };
  let health;
  try { const r = await getJson(c.url + '/api/gateway-health'); health = r.ok ? r.body : null; } catch { health = undefined; }
  if (health === undefined) return { ...base, state: 'stale-record', alive: pidAlive(c.pid) };
  if (!health || health.service !== 'a4note-task-gateway' || health.id !== a.id) return { ...base, state: 'foreign' };
  if (!health.capabilities?.shutdown) return { ...base, state: 'legacy', version: health.version ?? null, alive: pidAlive(c.pid) };
  if (health.pid !== c.pid) return { ...base, state: 'pid-mismatch', livePid: health.pid };
  let status = null;
  try { const r = await getJson(c.url + '/api/gateway/status', { Authorization: 'Bearer ' + a.token }); if (r.ok) status = r.body; } catch {}
  const projects = status?.projects ?? [];
  return {
    ...base, state: 'running', version: health.version, startedAt: health.startedAt, projects,
    activeAgents: dedupeAgents(projects.flatMap(p => (p.activeAgents ?? []).map(agent => ({ ...agent, project: p.name ?? p.id })))),
    streams: projects.reduce((sum, p) => ({ app: sum.app + (p.streams?.app ?? 0), other: sum.other + (p.streams?.other ?? 0) }), { app: 0, other: 0 }),
  };
}

async function healthOf(url) {
  try { const r = await getJson(url + '/api/gateway-health', {}, 500); return r.ok ? r.body : null; } catch { return undefined; }
}
async function waitForExit({ url, pid, deadline }) {
  while (Date.now() < deadline) {
    if ((await healthOf(url)) === undefined && !pidAlive(pid)) return true;
    await wait(100);
  }
  return false;
}
function signal(pid, name) {
  try { process.kill(pid, name); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}

/** Stop the recorded gateway. Returns {stopped, method|reason, ...inspection}; never touches foreign listeners. */
export async function stopGateway({ stateDir = defaultStateDir(), reason = '', timeoutMs = 8000, legacy = 'terminate' } = {}) {
  const info = await inspectGateway({ stateDir });
  const connectionPath = path.join(stateDir, 'gateway-connection.json');
  const forget = () => {
    const current = read(connectionPath);
    if (current && current.pid === info.pid && current.url === info.url) { try { fs.unlinkSync(connectionPath); } catch {} }
  };
  switch (info.state) {
    case 'none': return { ...info, stopped: false, skipped: true, reason: 'no-gateway-record' };
    case 'foreign': return { ...info, stopped: false, skipped: true, reason: 'port-owned-by-other-program' };
    case 'pid-mismatch': return { ...info, stopped: false, skipped: true, reason: 'identity-not-confirmed' };
    case 'stale-record':
      if (info.alive) return { ...info, stopped: false, skipped: true, reason: 'process-alive-without-verified-service' };
      forget();
      return { ...info, stopped: true, method: 'stale-cleanup' };
    case 'legacy': {
      if (legacy !== 'terminate') return { ...info, stopped: false, skipped: true, reason: 'legacy-gateway-cannot-stop-gracefully' };
      if (!info.alive || !signal(info.pid, 'SIGTERM')) { forget(); return { ...info, stopped: true, method: 'stale-cleanup' }; }
      // Same private access id as our own older helper: mirror gateway-bootstrap's retire policy.
      let gone = await waitForExit({ url: info.url, pid: info.pid, deadline: Date.now() + timeoutMs });
      let method = 'legacy-terminate';
      if (!gone) { method = 'legacy-kill'; signal(info.pid, 'SIGKILL'); gone = await waitForExit({ url: info.url, pid: info.pid, deadline: Date.now() + 3000 }); }
      if (gone) forget();
      return { ...info, stopped: gone, method: gone ? method : undefined, reason: gone ? undefined : 'process-still-alive' };
    }
    case 'running': {
      const a = read(path.join(stateDir, 'gateway-access.json'));
      let accepted = false;
      try {
        const r = await fetch(info.url + '/api/gateway/shutdown', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
          headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
        });
        accepted = r.ok;
      } catch {}
      let gone = await waitForExit({ url: info.url, pid: info.pid, deadline: Date.now() + timeoutMs });
      let method = 'graceful';
      if (!gone) {
        // Re-confirm before any signal: the listener (or the still-alive pid) must be the one we identified.
        const live = await healthOf(info.url);
        const ours = live ? live.id === info.id && live.pid === info.pid : live === undefined && accepted && pidAlive(info.pid);
        if (ours) {
          method = 'forced';
          signal(info.pid, 'SIGTERM');
          gone = await waitForExit({ url: info.url, pid: info.pid, deadline: Date.now() + 3000 });
        }
      }
      if (gone) forget();
      return { ...info, stopped: gone, accepted, method: gone ? method : undefined, reason: gone ? undefined : accepted ? 'process-still-alive' : 'shutdown-rejected' };
    }
    default: return { ...info, stopped: false, skipped: true, reason: 'unknown-state' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action = 'inspect', ...rest] = process.argv.slice(2);
  const options = {};
  for (const arg of rest) { const m = arg.match(/^--([a-z-]+)=(.*)$/i); if (m) options[m[1]] = m[2]; }
  const stateDir = options['state-dir'] || defaultStateDir();
  const run = action === 'stop'
    ? stopGateway({ stateDir, reason: options.reason ?? '', timeoutMs: Number(options.timeout ?? 8000), legacy: options.legacy ?? 'terminate' })
    : action === 'inspect' ? inspectGateway({ stateDir })
    : Promise.reject(Error('用法：gateway-lifecycle.mjs inspect|stop [--state-dir=…] [--reason=…] [--timeout=ms] [--legacy=terminate|skip]'));
  run.then(result => { process.stdout.write(JSON.stringify(result)); })
    .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
