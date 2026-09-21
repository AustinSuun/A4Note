// Launcher-side admission for `npm run dev:live`. Pure checks on the planned
// identity and directories; nothing here creates, copies or deletes data. The
// returned environment is what the native side re-verifies at runtime
// (src-tauri/src/dev_environment.rs), so both ends must agree before the window
// is allowed to touch a library.
import fs from 'node:fs/promises';
import path from 'node:path';

export const EXPECTED_ENV = Object.freeze({
  id: 'A4NOTE_DEV_EXPECTED_ID',
  root: 'A4NOTE_DEV_EXPECTED_ROOT',
  profile: 'A4NOTE_DEV_EXPECTED_PROFILE',
});
export const ALLOW_PRODUCTION_ENV = 'A4NOTE_ALLOW_PRODUCTION_LIBRARY';
export const PRODUCTION_IDENTIFIER = 'app.aster.research';
// Same shape the native side and the badge plugin accept: app.aster.research.dev.<instance>.w<10 hex>.
export const DEV_IDENTIFIER_PATTERN = /^app\.aster\.research\.dev\.[a-z][a-z0-9-]{0,23}\.w[0-9a-f]{10}$/;

export async function assertSafeDevPath(target) {
  if (!path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
    throw new Error(`DEV requires absolute, non-traversing paths: ${target}`);
  }
  for (let current = target; ; current = path.dirname(current)) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`DEV refuses symlink/junction paths (${current}); choose an independent directory`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (path.dirname(current) === current) break;
  }
}

/// Where Tauri will put this identity's data on Windows (`%APPDATA%\<identifier>\AsterData`).
export function plannedDataRoot(plan, env) {
  if (!env.APPDATA || !path.isAbsolute(env.APPDATA)) throw new Error('APPDATA unavailable or relative; refusing an unverifiable test launch');
  return path.join(env.APPDATA, plan.identifier, 'AsterData');
}

export async function checkDevAdmission(plan, env) {
  if (!DEV_IDENTIFIER_PATTERN.test(plan.identifier)) {
    throw new Error(`Refusing to launch: ${plan.identifier} is not an isolated dev identity`);
  }
  if (env[ALLOW_PRODUCTION_ENV]) {
    throw new Error(`${ALLOW_PRODUCTION_ENV} is set in this shell; unset it before starting an isolated instance`);
  }
  for (const name of Object.values(EXPECTED_ENV)) {
    if (env[name]) throw new Error(`${name} is already set in this shell (another launcher?); unset it before starting`);
  }
  const dataRoot = plannedDataRoot(plan, env);
  const productionRoot = path.join(env.APPDATA, PRODUCTION_IDENTIFIER, 'AsterData');
  for (const target of [dataRoot, plan.stateDir, plan.profileDir]) {
    await assertSafeDevPath(target);
    if (samePath(target, productionRoot) || isInside(target, productionRoot) || isInside(productionRoot, target)) {
      throw new Error(`Refusing to launch: ${target} overlaps the production library`);
    }
  }
  if (isInside(plan.profileDir, dataRoot) || isInside(dataRoot, plan.profileDir)) {
    throw new Error('Refusing to launch: WebView profile and data root overlap');
  }
  return {
    [EXPECTED_ENV.id]: plan.identifier,
    [EXPECTED_ENV.root]: dataRoot,
    [EXPECTED_ENV.profile]: plan.profileDir,
  };
}

export async function acquireDevLock(lockPath) {
  try {
    return await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Instance has an owner lock: ${lockPath}. Check its PID/paths before manually clearing a stale lock; never terminate another session.`);
    }
    throw error;
  }
}

function normalize(target) {
  const text = path.resolve(target).replaceAll('/', '\\').replace(/\\+$/, '');
  return process.platform === 'win32' ? text.toLowerCase() : text;
}
function samePath(a, b) {
  return normalize(a) === normalize(b);
}
function isInside(child, parent) {
  const c = normalize(child);
  const p = normalize(parent);
  return c !== p && c.startsWith(p + '\\');
}
