import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AcceptancePolicyError } from './acceptance-policy.mjs';
const fail = message => { throw new AcceptancePolicyError(400, message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function cleanText(value, label, max = 64000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail(`${label}格式无效`);
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
function directDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('拒绝符号链接/联接或非目录路径');
  if (normalized(fs.realpathSync.native(directory)) !== normalized(path.resolve(directory))) fail('拒绝解析到其他位置的目录');
}
function validateRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('授权项目必须是绝对路径');
  const absolute = path.resolve(root), volume = path.parse(absolute).root;
  let cursor = volume;
  directDirectory(cursor);
  for (const part of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); directDirectory(cursor);
  }
  return absolute;
}
function inside(root, directory) {
  const relative = path.relative(root, directory);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) fail('路径超出授权项目');
  directDirectory(directory);
}
function childDirectory(root, parent, name, exclusive = false) {
  inside(root, parent);
  const directory = path.join(parent, name);
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST' || exclusive) throw error; }
  inside(root, directory);
  return directory;
}

/** No CLI/body may choose authorizedProjectRoot without prior user authorization.
 * Creates notes only on explicit needsNotes=true; never launches an app, modifies
 * preferences or gitignore, makes screenshots, overwrites old runs, or deletes data.
 * Pre-existing symlinks/junctions are refused, including ancestor directories.
 * Node lacks portable openat: this is NOT an isolation boundary against a hostile
 * same-OS-user process swapping directories between checks. Use an isolated profile.
 */
export function createAcceptanceFixtures({ authorizedProjectRoot, taskId, runId, needsNotes,
  note, sample, environment, binding }, now = Date.now()) {
  if (needsNotes !== true) return { created: false, reason: '本次验收不需要测试笔记，未创建文件' };
  if (!uuid(taskId) || !uuid(runId)) fail('任务和运行ID须为UUID，禁止路径片段');
  if (!Number.isSafeInteger(now) || now < 0) fail('时间无效');
  const noteText = cleanText(note, '最小复现笔记'), sampleText = cleanText(sample, '样式样例');
  const environmentText = cleanText(environment, '隔离环境说明', 4000);
  if (!binding || binding.taskId !== taskId || !Number.isInteger(binding.deliveryRevision) || binding.deliveryRevision < 1 ||
      !Number.isInteger(binding.criteriaRevision) || binding.criteriaRevision < 1 ||
      typeof binding.buildSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.buildSha256)) fail('交付/标准/构建绑定无效');
  const root = validateRoot(authorizedProjectRoot);
  const tests = childDirectory(root, root, '.a4-tests');
  const acceptance = childDirectory(root, tests, 'acceptance');
  const task = childDirectory(root, acceptance, taskId);
  const run = childDirectory(root, task, runId, true);
  childDirectory(root, run, 'screenshots', true);
  const files = [];
  const write = (name, text) => {
    // Revalidate every ancestor before each exclusive write.
    validateRoot(run);
    const filename = path.join(run, name), bytes = Buffer.from(text.endsWith('\n') ? text : text + '\n', 'utf8');
    const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    inside(root, run);
    const read = fs.readFileSync(filename);
    if (!read.equals(bytes)) fail('测试文件写入后校验不一致');
    files.push({path:path.relative(root,filename).split(path.sep).join('/'),sha256:hash(read),size:read.length});
  };
  write('测试笔记.md', noteText); write('样式样例.md', sampleText);
  const inputs = cloneFiles(files);
  write('验收报告.md', `# 验收运行记录\n\n状态：未执行。创建夹具不代表验收通过。\n\n任务：${taskId}\n运行：${runId}\n创建时间：${new Date(now).toISOString()}\n交付版本：${binding.deliveryRevision}\n标准版本：${binding.criteriaRevision}\n构建SHA256：${binding.buildSha256}\n\n## 隔离环境与范围\n\n${environmentText}\n\n## 初始输入指纹\n\n${inputs.map(f=>'- '+f.path+' SHA256 '+f.sha256).join('\n')}\n\n## 待执行\n\n- 记录可信应用实际路径、版本、来源和构建指纹。\n- 记录窗口尺寸、DPI/缩放、主题及数据/profile/IPC隔离。\n- 逐项填写步骤、预期、实际、通过/失败/未执行。\n- 截图仅捕获授权应用区域，注明角色与时间；没有基线时明确缺失。\n- 结束后重验初始输入指纹，将真实报告与截图上传任务服务。\n\n本目录不包含生成或伪造的验收截图；screenshots 当前为空。\n`);
  return {created:true,directory:run,taskId,runId,files:cloneFiles(files),inputs};
}
const cloneFiles = files => files.map(f=>({...f}));

export function verifyFixtureInputs(authorizedProjectRoot, manifest) {
  const root = validateRoot(authorizedProjectRoot);
  if (!manifest?.created || !Array.isArray(manifest.inputs) || manifest.inputs.length !== 2) fail('夹具清单无效');
  if (!uuid(manifest.taskId) || !uuid(manifest.runId)) fail('夹具身份无效');
  const base = `.a4-tests/acceptance/${manifest.taskId}/${manifest.runId}/`;
  const expected = new Set(['测试笔记.md','样式样例.md'].map(n=>base+n));
  return manifest.inputs.map(entry => {
    if (!expected.delete(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('夹具清单路径或指纹无效');
    const file = path.join(root,...entry.path.split('/'));
    validateRoot(path.dirname(file));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('拒绝链接或非文件输入');
    const currentSha256 = hash(fs.readFileSync(file));
    return {path:entry.path,unchanged:currentSha256===entry.sha256,expectedSha256:entry.sha256,currentSha256};
  });
}
