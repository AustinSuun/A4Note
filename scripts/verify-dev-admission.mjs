// Launcher admission + environment strip source contracts, against real temporary
// directories (sentinel "production" folder, junction alias, exclusive lock). No native GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { liveDevPlan, liveTauriConfig } from './dev-live-config.mjs';
import { ALLOW_PRODUCTION_ENV, EXPECTED_ENV, acquireDevLock, assertSafeDevPath, checkDevAdmission, plannedDataRoot } from './dev-live-admission.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a4-env-admission-'));
let passed = 0;
const pass = () => passed++;
try {
  const roaming = path.join(root, 'roaming');
  const production = path.join(roaming, 'app.aster.research', 'AsterData');
  await fs.mkdir(production, { recursive: true });
  await fs.writeFile(path.join(production, 'sentinel'), 'DO NOT TOUCH');
  const env = { APPDATA: roaming };

  const a = liveDevPlan(path.join(root, 'checkout'), { instance: 'alpha' });
  const b = liveDevPlan(path.join(root, 'checkout'), { instance: 'beta', port: 1422, cdpPort: 9231 });
  const otherCheckout = liveDevPlan(path.join(root, 'checkout-2'), { instance: 'alpha' });
  const pa = await checkDevAdmission(a, env);
  const pb = await checkDevAdmission(b, env);
  const pc = await checkDevAdmission(otherCheckout, env);
  assert.equal(pa[EXPECTED_ENV.id], a.identifier); pass();
  assert.equal(pa[EXPECTED_ENV.root], path.join(roaming, a.identifier, 'AsterData')); pass();
  assert.equal(pa[EXPECTED_ENV.profile], a.profileDir); pass();
  // Two instances, or the same instance in two checkouts, never share a data root or profile.
  assert.notEqual(pa[EXPECTED_ENV.root], pb[EXPECTED_ENV.root]); pass();
  assert.notEqual(pa[EXPECTED_ENV.root], pc[EXPECTED_ENV.root]); pass();
  assert.notEqual(pa[EXPECTED_ENV.profile], pb[EXPECTED_ENV.profile]); pass();
  assert.ok(!pa[EXPECTED_ENV.root].startsWith(production) && !production.startsWith(pa[EXPECTED_ENV.root])); pass();

  // Negative: missing / relative APPDATA, stale expectations, production override, non-dev identity.
  await assert.rejects(checkDevAdmission(a, {}), /APPDATA/); pass();
  await assert.rejects(checkDevAdmission(a, { APPDATA: 'relative' }), /APPDATA/); pass();
  await assert.rejects(checkDevAdmission(a, { ...env, [ALLOW_PRODUCTION_ENV]: '1' }), /A4NOTE_ALLOW_PRODUCTION_LIBRARY/); pass();
  await assert.rejects(checkDevAdmission(a, { ...env, [EXPECTED_ENV.id]: 'stale' }), /already set/); pass();
  await assert.rejects(checkDevAdmission({ ...a, identifier: 'app.aster.research' }, env), /not an isolated dev identity/); pass();
  await assert.rejects(checkDevAdmission({ ...a, identifier: 'app.aster.research.dev.' }, env), /not an isolated dev identity/); pass();
  // Negative: a plan whose directories point into the production library or overlap each other.
  await assert.rejects(checkDevAdmission({ ...a, profileDir: path.join(production, 'webview') }, env), /overlaps the production library/); pass();
  await assert.rejects(checkDevAdmission({ ...a, stateDir: path.dirname(production) }, env), /overlaps the production library/); pass();
  await assert.rejects(checkDevAdmission({ ...a, profileDir: path.join(plannedDataRoot(a, env), 'webview') }, env), /overlap/); pass();
  await assert.rejects(assertSafeDevPath('relative')); pass();
  await assert.rejects(assertSafeDevPath(root + path.sep + '..' + path.sep + 'production')); pass();

  // Exclusive owner lock: the second launcher must refuse, never kill.
  await fs.mkdir(a.stateDir, { recursive: true });
  const lockPath = path.join(a.stateDir, 'owner.lock.json');
  const lock = await acquireDevLock(lockPath);
  try { await assert.rejects(acquireDevLock(lockPath), /owner lock/); pass(); }
  finally { await lock.close(); await fs.unlink(lockPath); }

  // Junction/symlink alias to the production folder is refused even when the leaf differs.
  const alias = path.join(root, 'alias');
  await fs.symlink(path.dirname(production), alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(assertSafeDevPath(path.join(alias, 'profile')), /symlink|junction/); pass();
  await assert.rejects(checkDevAdmission({ ...a, profileDir: path.join(alias, 'profile') }, env)); pass();

  // Nothing above touched the sentinel production folder or created dev roots.
  assert.equal(await fs.readFile(path.join(production, 'sentinel'), 'utf8'), 'DO NOT TOUCH'); pass();
  assert.deepEqual(await fs.readdir(production), ['sentinel']); pass();
  assert.equal(await fs.access(pa[EXPECTED_ENV.root]).then(() => true, () => false), false); pass();

  // Environment strip: product module installed before React, dependency-free, backend-verified wording only.
  const strip = await fs.readFile('src/platform/devEnvironmentStrip.ts', 'utf8');
  assert.doesNotMatch(strip, /^\s*import\s/m, 'strip module must not import anything'); pass();
  assert.match(strip, /get_dev_environment/); pass();
  assert.match(strip, /__TAURI_INTERNALS__/); pass();
  const code = strip.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.indexOf('独立测试库') > code.indexOf("env.mode === 'isolated'"), 'the isolated wording is only reachable after the native verdict'); pass();
  assert.match(strip, /浏览器预览/); pass();
  assert.match(strip, /if \(env\.mode === 'release'\)[\s\S]*badge\?\.remove\(\)/, 'release verdict removes the strip outside a dev server'); pass();
  const main = await fs.readFile('src/main.tsx', 'utf8');
  assert.match(main, /installDevEnvironmentStrip\(\{/, 'main.tsx installs the strip'); pass();
  assert.ok(main.indexOf('installDevEnvironmentStrip({') < main.indexOf('ReactDOM.createRoot'), 'strip is installed before React mounts'); pass();
  assert.match(main, /dev: import\.meta\.env\.DEV/); pass();
  const live = await fs.readFile('scripts/dev-live.mjs', 'utf8');
  assert.match(live, /VITE_A4NOTE_DEV_IDENTIFIER['"]: JSON\.stringify\(plan\.identifier\)/, 'dev:live hands its identity to the strip'); pass();
  assert.match(live, /checkDevAdmission\(plan, process\.env\)/); pass();
  assert.match(live, /\.\.\.devEnv,/, 'dev:live passes the admitted expectations to the native child'); pass();
  // Native side: gate wired into every library command and the setup path; command registered.
  const access = await fs.readFile('src-tauri/src/library_access.rs', 'utf8');
  assert.match(access, /fn operation\(\)[\s\S]*isolation_gate\(\)\?/); pass();
  assert.match(access, /fn maintenance\(\)[\s\S]*isolation_gate\(\)\?/); pass();
  const lib = await fs.readFile('src-tauri/src/lib.rs', 'utf8');
  assert.match(lib, /dev_environment::initialize\(app\.handle\(\)\)\.blocked/); pass();
  assert.match(lib, /dev_environment::get_dev_environment/); pass();
  const conf = JSON.parse(await fs.readFile('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(conf.identifier, 'app.aster.research', 'the shipped product keeps the production identity'); pass();

  // Launcher window config no longer asserts isolation in its title; the badge does after verification.
  const config = liveTauriConfig({ app: { windows: [{ label: 'main' }] } }, a);
  assert.ok(!config.app.windows[0].title.includes('独立测试库')); pass();
  assert.ok(config.app.windows[0].title.includes(`DEV · ${a.instance}`)); pass();

  console.log(JSON.stringify({ passed, failed: 0, scope: 'real temporary directories, junction alias, exclusive lock, two planned identities, strip/native source contracts; no native GUI' }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
