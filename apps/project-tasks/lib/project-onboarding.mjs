import fs from 'node:fs';
import path from 'node:path';
const begin = '<!-- A4NOTE-TASKS:BEGIN v1 -->';
const end = '<!-- A4NOTE-TASKS:END -->';
export function agentGuide({ projectRoot, projectId, runtimeDir }) {
  if ([projectRoot, runtimeDir].some((s) => /[\r\n`]/.test(s)))
    throw Error('项目或安装路径包含不适合生成说明的字符，请手动配置Agent。');
  const cli = path.join(runtimeDir, 'cli.mjs');
  const ps = process.platform === 'win32';
  const quote = (s) => ps ? "'" + s.replaceAll("'", "''") + "'" : "'" + s.replaceAll("'", "'\"'\"'") + "'";
  const setup = ps
    ? `$env:TASKS_PROJECT_ROOT = ${quote(projectRoot)}\n$env:TASKS_EXPECTED_PROJECT_ID = ${quote(projectId)}\n$cli = ${quote(cli)}\n$session = Join-Path $env:USERPROFILE ('.a4note-project-tasks/sessions/' + [guid]::NewGuid().ToString() + '.json')`
    : `export TASKS_PROJECT_ROOT=${quote(projectRoot)}\nexport TASKS_EXPECTED_PROJECT_ID=${quote(projectId)}\ncli=${quote(cli)}\nsession="$HOME/.a4note-project-tasks/sessions/$(node -p 'crypto.randomUUID()').json"`;
  const config = { command: 'node', args: [path.join(runtimeDir, 'mcp.mjs')], cwd: projectRoot,
    env: { TASKS_PROJECT_ROOT: projectRoot, TASKS_EXPECTED_PROJECT_ID: projectId } };
  return `${begin}
## A4 Note 项目任务看板接入

遵守本文件原有项目规则；以下内容只说明任务服务接入，不授予额外文件修改或派发权限。
新对话先检查本项目服务，再自选临时代号加入并读取任务。不要自动领取任意任务；仅按用户授权领取。
此入口供能读取AGENTS.md并执行本机命令/MCP的Agent使用，不会自动给任何Agent软件安装或配置MCP。

### CLI（在运行A4 Note的同一台电脑、同一OS用户下执行）

下面是${ps ? 'PowerShell' : 'POSIX shell'}命令。一次对话复用同一个session文件；新对话生成新文件，不得放入项目或共享给其他Agent。

a4note命令位置来自安装目录，不要求所选项目包含A4源码。先清除当前会话误设的TASKS_DATA_DIR/TASKS_URL等其他项目配置，不修改系统全局环境。

\`\`\`${ps ? 'powershell' : 'sh'}
${setup}
node "$cli" doctor
# doctor成功后再加入；将“自选代号”替换为当前对话代号
node "$cli" join --alias 自选代号 --session "$session"
node "$cli" list --session "$session"
node "$cli" get TASK_ID --session "$session"
\`\`\`

- 服务不存在、身份不符或不可达时，报告阻塞，请用户回到A4点击“打开项目文件夹并启动看板”。不要自行启动server/bootstrap，不要另建任务库、抢占端口或杀进程。
- 每次修改前get最新任务、附件和revision；按实际revision运行claim/progress/upload/submit，不盲目递增。409冲突后重读。
- 代码任务由执行Agent完成验证并合并到本地main后再submit，结果中注明交付与合并commit；冲突、脏main或验证失败时报告阻塞，不强行覆盖。归档只确认验收，不触发合并；默认不推送、打包、安装或发布。
- 直接队列流程：任务发布后进入queued，执行Agent可直接claim，无需方案审批。创建任务时必须写清description、acceptance和priority；submit后进入review，由用户检查实际效果并归档或退回队列。旧版服务（capabilities无queue/acceptance）需用户授权升级，不自行重启/迁移。
- claim TASK_ID --revision N；progress TASK_ID --revision N --text "进度"；submit TASK_ID --revision N --text "结果与验证"。这些命令都必须附带 --session "$session"。
- 约60秒heartbeat；需求变化先get再acknowledge。release必须停止文件写入后带--writes-stopped。文件/worktree认领规则仍然有效。
- 上传图片：upload TASK_ID --revision N --file IMAGE --purpose result --session "$session"；读取附件用download ATTACHMENT_ID --output PRIVATE_FILE --session "$session"。取不到参考图须明确说明，不能假称已看图。
- 默认worker，不自行提权dispatcher；派发需要用户明确授权。Agent提交只是待检查，只有用户能验收归档。
- 不运行access或把管理凭据发给执行者；不打印或提交私有连接/session文件。

### 标准stdio MCP（需要客户端/用户配置，不自动注入）

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

连接后先调用connection_status，再join、list_tasks、get_task；其他操作用update_task/attach_file/read_attachment/heartbeat。
远程网页Agent不能直接访问本机localhost：必须通过已授权的同机命令桥或用户配置的可信认证转发；不要公开裸露服务。worktree也指向上面的同一项目根，不各自启动服务。
${end}`;
}

// Append-only: never rewrite existing rules or silently replace an edited block.
export function registerAgentGuide(options) {
  const root = options.projectRoot;
  const lockPath = path.join(root, '.a4note-agent-guide.lock');
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
    const names = fs.readdirSync(root).filter((n) => n.toLowerCase() === 'agents.md');
    if (names.length > 1) throw Error('存在多个大小写不同的AGENTS文件，请手动确认入口。');
    const file = path.join(root, names[0] ?? 'AGENTS.md');
    const block = agentGuide(options);
    let old = Buffer.alloc(0), stat;
    if (names.length) {
      stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 512 * 1024)
        throw Error('AGENTS.md不是可安全追加的普通文件，已保留原文件。');
      old = fs.readFileSync(file);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(old);
    if (text.includes('\0')) throw Error('AGENTS.md不是UTF-8文本，未修改。');
    if (text.includes('<!-- A4NOTE-TASKS:')) {
      if (text.replaceAll('\r\n', '\n').includes(block))
        return { status: 'ready', file, changed: false };
      throw Error('已有A4接入段与当前配置不同或曾被编辑，未覆盖；请人工核对接入段。');
    }
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const addition = (old.length ? newline + newline : '') + block.replaceAll('\n', newline) + newline;
    if (stat) {
      const current = fs.lstatSync(file);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.ino !== stat.ino || !fs.readFileSync(file).equals(old))
        throw Error('AGENTS.md正在变化，请稍后重新打开项目。');
      // O_APPEND preserves every pre-existing byte, including BOM and line endings.
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd);
        if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1)
          throw Error('AGENTS.md在追加前发生变化，未写入。');
        fs.writeSync(fd, addition, null, 'utf8');
      } finally { fs.closeSync(fd); }
    } else fs.writeFileSync(file, addition, { flag: 'wx', encoding: 'utf8' });
    return { status: 'ready', file, changed: true };
  } catch (error) {
    return { status: 'warning', message: '看板服务已连接，但Agent接入说明未自动写入：' + error.message };
  } finally {
    if (lock !== undefined) {
      try {
        const owned = fs.fstatSync(lock), current = fs.lstatSync(lockPath);
        if (owned.ino === current.ino && owned.dev === current.dev) fs.unlinkSync(lockPath);
      } catch {}
      fs.closeSync(lock);
    }
  }
}
