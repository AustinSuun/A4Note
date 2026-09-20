# 项目任务服务

平台无关的任务登记、执行进度和用户验收。A4 Note「任务」是 React 原生场景，不是聊天窗口；不启动、调度或连接特定 Agent 产品。所有 Agent 必须连接同一个、按项目身份隔离的任务服务。

## 任务流程

任务板只有三列活跃工作阶段，归档只从顶部历史入口进入：

```text
queued → in_progress → review → archived
             ↑             │
             └─────────────┘  用户不满意：request_changes 回 queued
```

- `queued`：发布 Agent 已和用户确认目标、范围、验收标准、优先级和限制，并直接发布任务；等待执行 Agent 原子领取。
- `in_progress`：某个执行 Agent 已领取并负责执行；持续更新进度和 heartbeat。
- `review`：执行 Agent 已提交结果；用户检查实际效果，满意后归档，不满意则退回队列。
- `archived`：用户验收通过的只读历史记录；任务、事件、附件和结果都保留。

发布 Agent 只沟通、确认和发布，不自动领取、执行或归档。执行 Agent 自主读取同一任务板，按用户授权依次领取队列任务。任务发布、领取和提交不需要实施方案或人工方案审批；没有 `submit_plan`、`approve_plan`、`reject_plan` 接口、命令或界面。

数据库仍可能暂时读取旧的 `backlog` 状态作为兼容数据，界面将其显示在队列并标注待一次性迁移；受控迁移完成后不再产生该状态。迁移真实数据前必须停止旧服务并备份整个 `%USERPROFILE%\.a4note-project-tasks\` 数据目录（数据库、WAL/SHM、附件和私有连接文件），不能在运行中直接覆盖数据库。

## 桌面版一键启动（默认关闭）

任务场景默认关闭，服务不会随软件或系统启动。进入设置的“资料库 → 场景”，勾选“任务”；再打开任务场景，点击“打开项目文件夹并启动看板”。首次选择项目文件夹后会记住目录和端口；连接凭据只驻留内存。需要 Node.js 22.13+，缺少时界面会提示，不自动安装 Node。

已有同一项目的服务会复用。旧手动服务没有 `projectId` 健康标识时，请先在原终端 Ctrl+C 停止一次；其他程序或其他项目占端口时不强行关闭。关闭看板不结束已启动的共享服务，以免中断 Agent。

## 新 Agent 从项目发现看板

用户显式打开项目并连接成功后，会在项目根 `AGENTS.md` 追加有界接入段，保留原规则、BOM 和换行，不写凭据或 session 文件。新 Agent 应先读取项目规则，使用 CLI `doctor` 或 MCP `connection_status` 确认服务身份，再 join 并读取任务；仅按用户授权领取，不自动领取任意任务。

服务未启动、项目身份不匹配或远程不可达时报告阻塞，不自行另起数据库或服务。远程显式配置还需要 `TASKS_EXPECTED_PROJECT_ID`。接入段被编辑、项目身份变化、文件不安全或存在注册锁时不覆盖旧规则，要求人工核对。

## 手动启动

需要 Node.js 22.13+，使用内置 SQLite：

```sh
node apps/project-tasks/server.mjs
# 另一终端显示用户看板凭据；不要发给执行 Agent
node apps/project-tasks/cli.mjs access
```

A4 Note 切到「任务」，地址默认为 `http://127.0.0.1:4319`，输入 operatorToken。默认数据目录为用户主目录 `.a4note-project-tasks/<项目绝对路径SHA256前16位>`，包含数据库、附件和私有连接文件，不在源码目录。可配置 `TASKS_PORT`、`TASKS_DATA_DIR`、`TASKS_PROJECT_ROOT`、`TASKS_PROJECT_NAME`、`TASKS_ALLOWED_ORIGINS`、`TASKS_ALLOWED_HOSTS` 和 `TASKS_BIND`。

远程 Agent 不能直接访问 localhost：由用户配置可信 SSH 转发或 HTTPS 认证代理，再提供 `TASKS_URL` 与 enrollment/session 凭据。不要公网裸露 HTTP 服务，也不要向执行 Agent 提供 operatorToken。

## Agent 临时会话与快速提示词

任务看板顶部保留“发布者提示词”和“执行者提示词”两个快速复制按钮。它们只是短入口，完整规则仍以项目根 `AGENTS.md` 和本文档为准。

### 任务发布者提示词

```text
你是当前项目的任务发布者（dispatcher）。先读取项目根 AGENTS.md 和 apps/project-tasks/README.md，确认项目身份后再连接任务板。先和用户确认目标、范围、验收标准、优先级和限制，明确后直接创建或编辑任务进入 queued。不要自行领取、执行或归档任务，也不要把 operatorToken 提供给执行 Agent。
```

### 执行者提示词

```text
你是当前项目的任务执行者（worker）。先读取项目根 AGENTS.md 和 apps/project-tasks/README.md，确认项目身份后按用户授权读取 queued 任务并原子领取。读取最新要求、验收标准和参考附件，持续执行、更新进度并发送 heartbeat，完成后直接提交结果进入 review。遇到阻塞、范围变化，或未授权的安装、迁移、重启、发布时暂停并报告；不要自行归档。
```

每个新对话自选代号，每次 join 有独立 UUID。私有 session 文件不得提交 Git，执行者之间不能共享。默认 worker；派发角色需明确用户授权。

```sh
node apps/project-tasks/cli.mjs join --alias 青松 --session /private/青松.json
node apps/project-tasks/cli.mjs list --session /private/青松.json
node apps/project-tasks/cli.mjs get TASK_ID --session /private/青松.json
node apps/project-tasks/cli.mjs claim TASK_ID --revision 1 --session /private/青松.json
node apps/project-tasks/cli.mjs progress TASK_ID --revision 2 --text "实现中，检查图片缩放" --session /private/青松.json
node apps/project-tasks/cli.mjs heartbeat --session /private/青松.json
node apps/project-tasks/cli.mjs upload TASK_ID --revision 3 --file /private/result.png --purpose result --caption "调整后效果" --session /private/青松.json
node apps/project-tasks/cli.mjs submit TASK_ID --revision 4 --file /private/result.md --session /private/青松.json
```

revision 只是示例：每次修改前 get 最新版本，409 冲突后必须重新读取，不盲目递增重试。SQLite 事务保证并发领取只有一个成功。工作时约 60 秒 heartbeat，失联不会自动转交；交还必须先停止文件写入并使用 `release TASK_ID --revision N --writes-stopped`。

派发者使用 `join --role dispatcher --authorized-dispatcher`，通过 `create --json task.json` 创建包含 `title`、`description`、`acceptance`、`priority` 的任务；修改用 `edit TASK_ID --revision N --json changed.json`。派发者不能领取，执行者不能改要求，用户负责归档。

## MCP：标准 stdio

启动 `node <项目路径>/apps/project-tasks/mcp.mjs`，cwd 设项目根目录。工具包括 `connection_status`、`join`、`list_tasks`、`get_task`、`heartbeat`、`create_task`、`update_task`、`attach_file`、`read_attachment` 及独立验收工具。`update_task` 只提供领取、确认要求版本、进度、提交、交还和编辑；没有方案审批动作或用户归档动作。

## 数据规则

- 任务说明、验收标准和参考附件是执行依据；没有方案版本闸门。
- 参考材料变化提升需求版本，执行者重新读取并 `acknowledge` 后才能提交；结果证据不提升要求版本。
- 用户退回 review 时保留原结果、反馈、事件和附件，清除负责人后回到 queued。
- 归档只读，保留全部附件和历史事件；主总览不显示归档列。
- 任务详情支持粘贴、拖入和选择截图；单文件 10MB，每任务 50 份，总附件 512MB。
- SSE 使用请求头认证，token 不进 URL；SVG/HTML 等主动内容强制下载，不嵌入图片预览。
- 备份必须停止服务后复制完整数据目录；运行中不能只复制主 SQLite 文件，因为 WAL 可能未合并。

## 验证

```sh
node --test apps/project-tasks/test/service.test.mjs
```

隔离工作区另行验证了剪贴板上传、SSE 领取、文件选择、返工和用户归档；这些测试使用临时合成数据，不替代 Windows 系统剪贴板或 Tauri WebView 的逐项验收。

## 用户授权离线接管与中断交接

仅 worker 会话可接管另一负责人的 in_progress 任务。用户明确说明即可由执行者转述并记录，无需旧负责人 release 或另开审批；这是一条可审计的用户授权声明，不是服务独立认证了聊天。无用户授权不能自动抢占。
服务端在同一事务内检查 revision、负责人和最后心跳；超过120秒无心跳才算离线，时间缺失/无效/未来时间均为未知并拒绝。两个接管者只有一个成功。旧会话即使恢复心跳，也不能更新、上传结果、交还或提交该任务。

```sh
node apps/project-tasks/cli.mjs get TASK_ID --session PRIVATE_SESSION
node apps/project-tasks/cli.mjs takeover TASK_ID --revision N --user-authorized --workspace-checked --text "用户要求我接替离线负责人；已核验独立worktree" --session PRIVATE_SESSION
# 接管后必须再次get，读取要求、附件、handoff和历史，再以最新revision acknowledge。
node apps/project-tasks/cli.mjs handoff TASK_ID --revision N --json handoff.json --session PRIVATE_SESSION
```

handoff.json 可包含 completed、remaining、blockers、nextSteps、branch、worktree、commit、uncommittedChanges、resources、validation 字符串字段。交接保留作者和时间；新负责人可补充，历史不会覆盖。没有交接时 detail.handoff=null，须只读盘点，不能假称已完成。
MCP update_task 同步支持 takeover（userAuthorized、workspaceChecked、reason）及 handoff（handoff对象）。接管重置 claimed_spec，需要重读并 acknowledge 后才能提交。
工作区核验不可省略：任务权限不能阻止旧进程继续写文件；先核验隔离worktree/文件归属，必要时请用户协调旧写入，不能凭离线擅自杀进程。新客户端连接不支持接管的旧服务时会明确失败，不降级为伪造交还。进行中列表展示服务提供的负责人状态与最后心跳，事件历史保留授权说明和交接。

## 验收与本地 main 集成

新服务绑定项目根后，代码交付必须显式提交 delivery 清单，不再从共享 dirty HEAD 猜测成果。CLI submit 增加 `--delivery-json delivery.json`，MCP update_task.submit 增加 delivery 对象。

```json
{
  "kind": "code",
  "sourceRef": "refs/heads/feature/example",
  "commit": "完整交付SHA",
  "baseCommit": "完整基线SHA",
  "paths": ["实际变化文件的完整清单"],
  "validation": "真实执行的测试、结果、证据路径及未测范围"
}
```

纯审计/验收等无代码任务提交 `{"kind":"none","reason":"无需合并的具体原因"}`。未提供声明的旧交付显示unknown，绑定仓库时阻止其静默归档；未绑定仓库的旧服务兼容归档，但明确显示not_configured，不能解释为已合并。

人工归档和已授权的自动验收统一通过集成闸门：记录验收结论→取得仓库合并锁→隔离worktree生成候选→可信验证→检测main未变化且已检出的main无脏文件→更新本地main→确认提交包含关系→归档。冲突/验证失败/缺少配置保留review，记录错误与用户验收时间；处理原因后再次点“效果满意，归档”重试。已在main时只对账，不重复合并。Git成功但SQLite失败时下次以真实包含关系恢复。未推送任何远端，也不会安装/发布。

### 可信验证命令（部署前配置）

服务进程环境 `TASKS_GIT_VERIFY_ARGV` 是JSON字符串数组 `[可执行文件, 参数...]`。仅项目用户/部署负责人配置，任务负载无权提供执行命令。不配置就阻止代码合并，绝不跳过验证。该命令在隔离候选工作区执行，应负责独立依赖准备和项目验证，退出0才通过；不能依赖共享node_modules、真实数据或启动常驻进程。Windows应显式调用powershell.exe或node.exe，避免把.cmd误当可直接执行程序。不要将此配置写入任务附件或会话凭据。

当前实现串行、同步执行验证（最长10分钟）；验证期间同一服务请求可能等待，因此在低干扰时段安排大项目集成。长任务后重新读取看板和心跳。服务若崩溃会保留Git公共目录下`a4note-task-integration.lock`；用户核实对应PID已停止、没有其他集成操作后才移除该锁，再重试。不会凭超时自动删锁或杀进程。

代码任务失败保持review，不污染main；源分支后续新增提交不进入已验收SHA。修改交付内容必须退回并重新提交/验收。状态分别展示交付SHA、合并结果、合并SHA、错误及远端未推送；所有集成事件持久化，不自动追溯修改历史归档卡。
