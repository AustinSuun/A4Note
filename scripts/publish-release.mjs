import {verifyDraftAssets,verifyPublishedUrls} from './release-assets.mjs';
// Publish only complete, signed, immutable Windows releases. Never run tests or installers.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'AustinSuun/A4Note';
const run = (args, required = true) => {
  const r = spawnSync('gh', args, { cwd: root, encoding: 'utf8', env: process.env });
  if (required && (r.error || r.status !== 0)) throw new Error(`GitHub operation failed: ${r.stderr || r.error || r.status}`);
  return r;
};
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const pkg = await json('package.json');
const info = await json('artifacts/windows/latest/build-info.json');
const latest = await json('artifacts/windows/latest/latest.json');
const extension = await json('artifacts/browser-extension/build-info.json');
const config = await json('src-tauri/tauri.conf.json');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || info.version !== pkg.version || config.version !== pkg.version || latest.version !== pkg.version || !info.updaterSigned || info.captureExtensionVersion !== extension.version) throw new Error('Release versions/signing metadata do not match. Rebuild paired artifacts.');
const installer = `artifacts/windows/latest/${info.files.installer}`;
const bytes = await readFile(path.join(root, installer));
if (createHash('sha256').update(bytes).digest('hex').toUpperCase() !== info.sha256.installer) throw new Error('Installer digest mismatch');
const signature = (await readFile(path.join(root, `${installer}.sig`), 'utf8')).trim();
const platform = latest.platforms['windows-x86_64'];
const tag = `v${pkg.version}`;
if (!signature || platform.signature !== signature || platform.url !== `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(info.files.installer.replaceAll(' ', '.'))}`) throw new Error('Updater manifest does not reference this signed installer');
const extensionPath = `artifacts/browser-extension/${extension.filename}`;
if (createHash('sha256').update(await readFile(path.join(root, extensionPath))).digest('hex') !== extension.sha256) throw new Error('Extension digest mismatch');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Cannot resolve release commit');
const commit = git.stdout.trim();
if (info.sourceCommit !== commit) throw new Error('Build commit differs from HEAD. Rebuild rather than mislabel the release.');
const existing = run(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,targetCommitish'], false);
if (existing.status === 0 && !JSON.parse(existing.stdout).isDraft) {
  if (process.env.CI === 'true') { console.log('Release already published; duplicate CI run skipped without replacing assets.'); process.exit(0); }
  throw new Error('This version is already published. Bump version; never overwrite a released updater.');
}
if (existing.status === 0 && JSON.parse(existing.stdout).targetCommitish !== commit) throw new Error('Existing draft targets a different commit. Resolve it explicitly before retrying.');
if (existing.status !== 0) run(['release', 'create', tag, '--repo', repo, '--target', commit, '--draft', '--title', `A4 Note ${tag}`, '--notes', `${latest.notes}\n\nWindows x64。首次请手动安装一次；后续在设置→关于→软件更新操作。浏览器插件另行更新。\n\n发布任务执行构建和签名/哈希检查；源码须先通过受保护分支的必要CI，未进行真实资料库安装验收。更新签名不是Windows Authenticode签名。`]);
run(['release', 'upload', tag, '--repo', repo, '--clobber', installer, `${installer}.sig`, 'artifacts/windows/latest/latest.json', 'artifacts/windows/latest/build-info.json', extensionPath]);
const uploaded = JSON.parse(run(['release', 'view', tag, '--repo', repo, '--json', 'assets']).stdout).assets;
const requiredUrls = [platform.url, `${platform.url}.sig`, `https://github.com/${repo}/releases/download/${tag}/latest.json`, `https://github.com/${repo}/releases/download/${tag}/build-info.json`, `https://github.com/${repo}/releases/download/${tag}/${extension.filename}`];
const expected=[];
for(const file of [installer,`${installer}.sig`,'artifacts/windows/latest/latest.json','artifacts/windows/latest/build-info.json',extensionPath]){
  const content=await readFile(path.join(root,file));expected.push({name:path.basename(file).replaceAll(' ','.'),size:content.length,sha256:createHash('sha256').update(content).digest('hex')});
}
verifyDraftAssets(uploaded,expected);
run(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
const published=JSON.parse(run(['release','view',tag,'--repo',repo,'--json','assets']).stdout).assets;
verifyPublishedUrls(published,requiredUrls);
console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
