import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
// Read-only artifact integrity check; never installs or launches the application.
const root = 'artifacts/windows/latest/';
const info = JSON.parse(fs.readFileSync(root + 'build-info.json', 'utf8'));
for (const key of ['executable', 'installer']) {
  const file = root + info.files[key];
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  assert.equal(sha256, info.sha256[key]);
  console.log(JSON.stringify({ file, size: bytes.length, sha256 }));
}
const signature = fs.readFileSync(root + info.files.installer + '.sig', 'utf8').trim();
assert.ok(signature);
const manifest = JSON.parse(fs.readFileSync(root + 'latest.json', 'utf8'));
assert.equal(manifest.version, info.version);
assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
console.log(JSON.stringify(info, null, 2));
console.log('Artifact hashes and manifest consistency passed; signature present (not independent cryptographic verification).');
