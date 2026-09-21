# 任务板场景与服务一体化：启用场景后一键绑定服务

任务卡：`5569ca49-70d6-449b-88c8-61041ee8c924`（本机看板 · review 待用户验收）
分支：`feat/tasks-scene-service-binding`（worktree `.worktrees/scene-binding-qinglan`，基线 `34738d6`）

## 背景与问题

「任务」场景 (`tasks.core`) 默认关闭。用户勾选启用后，只会看到一个连接面板：
场景启用与服务启动两件事完全分离，中间没有任何引导。复核链路后确认的断点：

1. 勾选场景后无引导，用户不知道还要选目录、启服务。
2. 无 Node 版本预检。`src-tauri/src/project_tasks.rs` 只在 spawn 返回 `NotFound` 时提示
   「没有找到 Node.js，请安装 22.13 以上版本」；已安装但版本过低时会以别的形式失败，错误不指向根因。
3. 无端口占用预检，只拦截 `port < 1024`。
4. 取消目录选择时静默返回 `null`，界面没有「已取消」反馈。
5. 浏览器端只能手动连接（`supportsLocalTaskLaunch = isTauri`）——这是设计限制，本次如实保留并在文案中说明。

链路本身（供后续参考）：
勾选场景 → 「打开项目文件夹并启动看板」 → `selectProjectFolder()` → `launchLocalTasks()` →
`invoke('start_project_tasks')` → 校验 url 为 127.0.0.1 且端口 ≥1024 → `TaskClient` 取 `/me` 要求
`role === 'human'` → `snapshot()` 校验 `project.id === connection.projectId` → 落库 `port/serviceProjectId/lastConnected`。

## 本次改动

**只读预检命令**（`src-tauri/src/project_tasks.rs`，注册于 `src-tauri/src/lib.rs`）
新增 `preflight_project_tasks`，返回 Node 存在性与版本（≥22.13）、bundled bootstrap 资源、
项目目录有效性、端口占用四项。**只报告，不抢占端口、不结束任何进程、不启动服务。**

**引导组件**（`src/features/taskboard/TaskBindingGuide.tsx`，新增）
把「环境检查 → 选项目 → 启动并验证连接」三步显式呈现，逐步给出 ✓ / ! / × 与原因。
阻塞项（缺 Node、版本过低、缺资源、目录失效）会禁用启动按钮并列出待解决问题；
端口占用只记为警告而非阻塞——那通常就是本项目已在运行的服务，直接启动即可复用。
组件不自行调用 `start_project_tasks`，只通过 `onStart` 把动作交回 TaskBoard 既有逻辑，
因此「默认关闭、不自动启动」的策略没有被绕过。面板底部明确写出这两条边界。

**绑定状态可视化**（`src/features/taskboard/TaskServiceControls.tsx`）
状态栏原本只有 PID 与在线 Agent 数，现补充「已绑定 <项目> · 端口 <n>」，
避免把另一个（或过期的）服务误认成眼前这个。停止服务、退出策略、重新连接沿用原有实现。

**回归护栏**（`scripts/verify-task-binding-guide.mjs`，新增，接入 `scripts/verify-all.mjs`）
15 项断言：三步骤渲染、两条边界文案、六类阻塞判定、端口占用不算阻塞，
并静态断言组件内不含结束进程的操作、不直接调用启动命令。

## 验证

- `cargo check` 通过（先跑 `node scripts/prepare-native-host.mjs`，否则缺 native-host 构建产物必失败）。
- `tsc -b --force` 零错误。
- `node scripts/verify-task-binding-guide.mjs` → 15 checks passed。
- `npm run test:agent-status` 通过。
- `npm run verify`：首轮因 `scripts/verify-project-task-launcher.mjs:30` 用正则锁死了
  `<TaskServiceControls connected={!!client} />` 的精确写法而失败。该断言意图是「控件已挂载且由实时 client 驱动」，
  已放宽为允许附加 props，意图不变；单跑该脚本通过。

## 安装包资源核查

`src-tauri/tauri.conf.json` 声明 18 条资源，逐条确认文件存在（含 `lib/task-delivery.mjs`）；
扫描 `apps/project-tasks` 下 13 个运行时相对导入，全部被现有映射覆盖，**无缺口**。

## 边界

- 未推远端、未打包、未重启 4319 端口上的服务。
- Agent 提交只进入「待检查」；归档与验收由用户在看板完成。
