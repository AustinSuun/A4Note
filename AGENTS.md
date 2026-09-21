# A4 Note Agent 入口

开始任何开发任务前，先在 `D:\WorkSpace\Aster` 执行：

```powershell
Get-Content -Encoding utf8 docs\notes\DEVELOPMENT_HANDBOOK.md
Get-Content -Encoding utf8 docs\notes\AGENT_STATUS.md
npm run status
git status --short
```

稳定的模块边界、插件化规则、交接格式和验证矩阵以
`docs/notes/DEVELOPMENT_HANDBOOK.md` 为准；当前进度以
`plans/PROJECT_STATUS.json` 为准，人类可读的交接摘要见
`docs/notes/AGENT_STATUS.md`。

完成或阻塞任务时，同时更新上述两个状态文件的 `updatedAt`、工作范围、验证结果和下一步。提交前至少运行
`npm run test:agent-status`；涉及代码时按开发手册选择 `npm run build` 或 `npm run verify`。

不要把实时进度复制到 Skill、README 或提示词中。Skill 只能承载不随单个任务变化的操作流程，状态文件才是跨 Agent、跨时间的项目事实来源。

## UI 交付截图与开发环境

涉及界面效果的任务，执行 Agent 应使用隔离开发入口 `npm run dev:live -- --instance <Agent代号> --port <独立端口> --cdp-port <独立端口>`；不要用普通 `npm run dev` 或未经明确放行的 `npm run tauri:dev` 作为可验收截图来源。截图应来自真实应用区域，覆盖修改后关键状态及必要的前后/边界对比，并保留底部 `DEV <代号> · 独立测试库` 状态条，以证明未使用正式资料库。

将截图以任务结果附件上传（`--purpose result`，填写说明）；开发者截图属于交付证据，不等于独立验收。需要独立验收时，由不同 Agent 建立 acceptance 会话并绑定其实际截图。完整命令和角色边界见 `apps/project-tasks/README.md`。

截图默认自动化产出，不要手工凭印象描述效果：用 `playwright-core`（已在 `node_modules`）驱动本机 Chrome 连接 `dev:live` 的 `--cdp-port`，脚本须收集 `pageerror` 与 console error 以佐证「无控制台报错」，并全程 try/catch 写日志文件。截图存 `.tmp/shots/`，不要放进 `docs/`。若某状态受环境限制截不到（例如浏览器预览无法启动本机看板服务、只能停在未连接态），必须在提交说明中写明受限范围与原因，不得用其他状态的截图顶替。操作细节与常见坑见 `docs/mcp-dev-preview-visual-acceptance.md`。

## 代码任务完成与合并

代码任务由执行Agent完成验证并合并到本地main后再submit，结果中注明交付与合并commit；冲突、脏main或验证失败时报告阻塞，不强行覆盖。归档只确认验收，不触发合并；默认不推送、打包、安装或发布。


<!-- A4NOTE-TASKS:BEGIN v1 -->
## A4 Note 项目任务看板接入

遵守本文件原有项目规则；以下内容只说明任务服务接入，不授予额外文件修改或派发权限。
新对话先检查本项目服务，再自选临时代号加入并读取任务。不要自动领取任意任务；仅按用户授权领取。
此入口供能读取AGENTS.md并执行本机命令/MCP的Agent使用，不会自动给任何Agent软件安装或配置MCP。

### CLI（在运行A4 Note的同一台电脑、同一OS用户下执行）

下面是PowerShell命令。一次对话复用同一个session文件；新对话生成新文件，不得放入项目或共享给其他Agent。

a4note命令位置来自安装目录，不要求所选项目包含A4源码。先清除当前会话误设的TASKS_DATA_DIR/TASKS_URL等其他项目配置，不修改系统全局环境。

```powershell
$env:TASKS_PROJECT_ROOT = 'D:\WorkSpace\Aster'
$env:TASKS_EXPECTED_PROJECT_ID = 'db83d583-436f-474c-9480-a42e4147b46a'
$cli = 'D:\A4 Note\project-tasks\cli.mjs'
$session = Join-Path $env:USERPROFILE ('.a4note-project-tasks/sessions/' + [guid]::NewGuid().ToString() + '.json')
node "$cli" doctor
# doctor成功后再加入；将“自选代号”替换为当前对话代号
node "$cli" join --alias 自选代号 --session "$session"
node "$cli" list --session "$session"
node "$cli" get TASK_ID --session "$session"
```

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

```json
{
  "command": "node",
  "args": [
    "D:\\A4 Note\\project-tasks\\mcp.mjs"
  ],
  "cwd": "D:\\WorkSpace\\Aster",
  "env": {
    "TASKS_PROJECT_ROOT": "D:\\WorkSpace\\Aster",
    "TASKS_EXPECTED_PROJECT_ID": "db83d583-436f-474c-9480-a42e4147b46a"
  }
}
```

连接后先调用connection_status，再join、list_tasks、get_task；其他操作用update_task/attach_file/read_attachment/heartbeat。
远程网页Agent不能直接访问本机localhost：必须通过已授权的同机命令桥或用户配置的可信认证转发；不要公开裸露服务。worktree也指向上面的同一项目根，不各自启动服务。
<!-- A4NOTE-TASKS:END -->
