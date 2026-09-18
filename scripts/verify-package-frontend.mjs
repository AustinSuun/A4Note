import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source = fs.readFileSync('scripts/package-windows-release.mjs', 'utf8');
const configStart = source.indexOf('await writeFile(buildOverridePath,');
const configEnd = source.indexOf('const result = spawnSync(', configStart);
assert.ok(configStart > 0 && configEnd > configStart);
// Execute the actual packaging config construction against Windows paths, without building.
for (const rootDir of ['D:\\WorkSpace\\Aster', 'D:\\Research Projects\\A4 Note']) {
  const frontendDistDir = path.win32.join(rootDir, '.build', 'tauri-packaging', 'run-fixture', 'frontend');
  const buildOverridePath = path.win32.join(rootDir, '.build', 'tauri-packaging', 'run-fixture', 'tauri-build.json');
  let config;
  const context = {
    rootDir, frontendDistDir, buildOverridePath, path: path.win32,
    process: { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } },
    writeFile: async (file, content) => { assert.equal(file, buildOverridePath); config = JSON.parse(content); },
  };
  const command = await vm.runInNewContext(`(async () => { ${source.slice(configStart, configEnd)} return buildCommand; })()`, context);
  assert.equal(config.build.frontendDist, '../.build/tauri-packaging/run-fixture/frontend');
  assert.throws(() => new URL(config.build.frontendDist));
  assert.equal(config.build.beforeBuildCommand, 'npm run build -- --outDir .build/tauri-packaging/run-fixture/frontend');
  assert.equal(command.args[3], 'npm run tauri:build -- --config .build/tauri-packaging/run-fixture/tauri-build.json');
}
const checkStart = source.indexOf('const frontendIndex =');
const checkEnd = source.indexOf('await mkdir(stagedLatestDir', checkStart);
assert.ok(checkStart > 0 && checkEnd > checkStart);
async function checkEmbedded(html, binary) {
  await vm.runInNewContext(`(async () => { ${source.slice(checkStart, checkEnd)} })()`, {
    frontendDistDir: 'frontend', executableSource: 'application.exe', path, Buffer,
    readFile: async file => file === 'application.exe' ? Buffer.from(binary) : html,
    console: { log() {} },
  });
}
const html = '<script src="/assets/index-test.js"></script><link href="/assets/index-test.css">';
await checkEmbedded(html, '/assets/index-test.js /assets/index-test.css');
await assert.rejects(checkEmbedded(html, ''), /not embedded/);
await assert.rejects(checkEmbedded(html, '/assets/index-test.js'), /not embedded/);
await assert.rejects(checkEmbedded('<html></html>', ''), /no generated asset/);
assert.ok(checkEnd < source.indexOf('await rename(latestDir, archiveDir)'));
console.log('Packaging frontend guard passed: Windows drive/space paths remain relative, shell arguments are unambiguous, missing embedded assets fail before promotion. No build/install/native operations.');
