import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const projectsHome = (home = os.homedir()) =>
  path.join(home, '.a4note-project-tasks');

/** Windows treats drive/separator case as the same folder; the private data key must too. */
export const normalizeRoot = (root) => {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export const dataDirName = (root) =>
  createHash('sha256').update(normalizeRoot(root)).digest('hex').slice(0, 16);

const taskCount = (dir) => {
  try {
    const db = new DatabaseSync(path.join(dir, 'tasks.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT count(*) n FROM tasks').get().n; } finally { db.close(); }
  } catch { return 0; }
};
const stamp = (dir) => {
  try { return fs.statSync(path.join(dir, 'tasks.sqlite')).mtimeMs; }
  catch { try { return fs.statSync(dir).mtimeMs; } catch { return Number.MAX_SAFE_INTEGER; } }
};

/** Resolve the private data directory for a project root. Older builds keyed the
 * directory by the exact root spelling, so a folder picked as `d:/x` and a service
 * started as `D:\x` produced two boards. Reuse the existing directory that holds the
 * project's data; never merge, copy, or migrate databases here. */
export function resolveDataDir(root, base = projectsHome()) {
  const canonical = path.join(base, dataDirName(root));
  if (taskCount(canonical) > 0) return canonical;
  const wanted = normalizeRoot(root);
  let best = null;
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); }
  catch { return canonical; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    let conn = null;
    try { conn = JSON.parse(fs.readFileSync(path.join(dir, 'connection.json'), 'utf8')); } catch {}
    if (typeof conn?.projectRoot !== 'string' || normalizeRoot(conn.projectRoot) !== wanted) continue;
    const tasks = taskCount(dir), mtime = stamp(dir);
    if (!best || tasks > best.tasks || (tasks === best.tasks && mtime < best.mtime)) best = { dir, tasks };
  }
  return best?.dir ?? canonical;
}
