import { signingEnvironment } from './signing-environment.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifactRoot = path.join(rootDir, 'artifacts', 'windows');
const latestDir = path.join(artifactRoot, 'latest');
const archiveRoot = path.join(artifactRoot, 'archive');
const packageConfig = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageConfig.version ?? '0.0.0';
const runId = `${formatStamp(new Date())}-${process.pid}`;
const runRoot = path.join(rootDir, '.build', 'tauri-packaging', runId);
const cargoTargetDir = path.join(runRoot, 'target');
const stagedLatestDir = path.join(runRoot, 'latest');
const archiveDir = path.join(archiveRoot, `${version}-${runId}`);

if (process.argv.includes('--help')) {
  printUsage();
  process.exit(0);
}

if (process.argv.includes('--dry-run')) {
  printPlan();
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.error('Windows packaging must run on Windows so Tauri can produce a Windows exe.');
  process.exit(1);
}

const signingEnv = await signingEnvironment();
await mkdir(path.dirname(cargoTargetDir), { recursive: true });
console.log(`Building Windows release into ${path.relative(rootDir, cargoTargetDir)}`);

const hostBuild = spawnSync(process.execPath, ['scripts/prepare-native-host.mjs', '--target-dir', path.join(runRoot, 'native-target')], { cwd: rootDir, env: process.env, stdio: 'inherit' });
if (hostBuild.error) throw hostBuild.error;
if (hostBuild.status !== 0) process.exit(hostBuild.status || 1);

const buildCommand = process.platform === 'win32'
  ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm run tauri:build'] }
  : { command: 'npm', args: ['run', 'tauri:build'] };
const result = spawnSync(buildCommand.command, buildCommand.args, {
  cwd: rootDir,
  env: { ...signingEnv, CARGO_TARGET_DIR: cargoTargetDir },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  console.error(`Tauri build failed with exit code ${result.status ?? 'unknown'}.`);
  console.error(`Build files were kept at ${path.relative(rootDir, runRoot)} for diagnosis.`);
  process.exit(result.status ?? 1);
}

const releaseDir = path.join(cargoTargetDir, 'release');
const executableSource = path.join(releaseDir, 'a4note.exe');
const installerSource = await findInstaller(path.join(releaseDir, 'bundle', 'nsis'));
await assertFile(executableSource, 'Tauri release executable');

await mkdir(stagedLatestDir, { recursive: true });
const executableTarget = path.join(stagedLatestDir, 'a4note.exe');
const installerTarget = path.join(stagedLatestDir, 'A4 Note_x64-setup.exe');
await cp(executableSource, executableTarget);
await cp(installerSource, installerTarget);
await cp(`${installerSource}.sig`, `${installerTarget}.sig`);
const signature = (await readFile(`${installerTarget}.sig`, 'utf8')).trim();
if (!signature) throw new Error('Updater signature is required.');

const metadata = {
  schemaVersion: 1,
  sourceCommit: (() => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }); if (r.status !== 0) throw new Error('Cannot resolve build commit'); return r.stdout.trim(); })(),
  productName: 'A4 Note',
  version,
  builtAt: new Date().toISOString(),
  platform: 'windows-x64',
  updaterSigned: true,
  captureTransport: 'native_messaging',
  captureExtensionVersion: JSON.parse(await readFile(path.join(rootDir, 'apps/browser-extension/manifest.json'), 'utf8')).version,
  nativeHost: {
    extensionId: JSON.parse(await readFile(path.join(rootDir, 'apps/native-host/identity.json'), 'utf8')).extensionId,
    sha256: await sha256(path.join(rootDir, 'src-tauri/resources/native-host/a4note-native-host.exe')),
    manifestSha256: await sha256(path.join(rootDir, 'src-tauri/resources/native-host/host-manifest.json')),
  },
  files: {
    executable: path.basename(executableTarget),
    installer: path.basename(installerTarget),
  },
  sha256: {
    executable: await sha256(executableTarget),
    installer: await sha256(installerTarget),
  },
};
await writeFile(path.join(stagedLatestDir, 'build-info.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

await writeFile(path.join(stagedLatestDir, 'latest.json'), JSON.stringify({
  version,
  notes: process.env.A4NOTE_RELEASE_NOTES || `A4 Note ${version}：软件内签名更新、论文自动识别、分类下载入库及工作区改进。更新前请备份重要资料；浏览器扩展需单独更新。`,
  pub_date: metadata.builtAt,
  // GitHub normalizes spaces in uploaded asset names to periods.
  platforms: { 'windows-x86_64': { signature, url: `https://github.com/AustinSuun/A4Note/releases/download/v${version}/${encodeURIComponent(path.basename(installerTarget).replaceAll(' ', '.'))}` } },
}, null, 2) + '\n', 'utf8');

await mkdir(archiveRoot, { recursive: true });
const hadLatest = await isDirectory(latestDir);
if (hadLatest) {
  console.log(`Archiving previous latest build to ${path.relative(rootDir, archiveDir)}`);
  await rename(latestDir, archiveDir);
}

try {
  await rename(stagedLatestDir, latestDir);
} catch (error) {
  if (hadLatest && !(await isDirectory(latestDir)) && (await isDirectory(archiveDir))) {
    await rename(archiveDir, latestDir);
  }
  throw error;
}

await rm(runRoot, { recursive: true, force: true });
console.log('Windows package complete.');
console.log(`Latest exe: ${path.relative(rootDir, path.join(latestDir, path.basename(executableTarget)))}`);
console.log(`Latest installer: ${path.relative(rootDir, path.join(latestDir, path.basename(installerTarget)))}`);
console.log(`Exe SHA-256: ${metadata.sha256.executable}`);
if (hadLatest) {
  console.log(`Previous latest archived at: ${path.relative(rootDir, archiveDir)}`);
}

function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function assertFile(filePath, label) {
  if (!(await isFile(filePath))) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
}

async function findInstaller(nsisDir) {
  const entries = await readdir(nsisDir, { withFileTypes: true });
  const installers = entries
    .filter((entry) => entry.isFile() && /setup|installer/i.test(entry.name) && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(nsisDir, entry.name));
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one NSIS installer in ${nsisDir}, found ${installers.length}.`);
  }
  return installers[0];
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dirPath) {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function printPlan() {
  console.log('Windows packaging plan:');
  console.log(`  temporary build: ${path.relative(rootDir, runRoot)}`);
  console.log(`  latest output:   ${path.relative(rootDir, latestDir)}`);
  console.log(`  archive output:  ${path.relative(rootDir, archiveDir)}`);
}

function printUsage() {
  console.log('Usage: npm run package:windows [-- --dry-run]');
  console.log('Builds a Windows release, archives the previous latest build, and writes stable outputs under artifacts/windows/latest.');
}
