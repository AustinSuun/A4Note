# 抢救 5f8ce0ee 交付：网关 v4 退出生命周期整理为独立分支 commit — Arena 2026-09-21

任务：`be3b361d-b71a-4447-adb4-c34dce010522`（用户指令，青穹发布）。执行者：Arena状态核查（5f8ce0ee 原执行者）。结果：分支 `rescue/5f8ce0ee-gateway-exit-lifecycle`，commit `9d0f8ab63082d106c9aba3f19be9bfe6c50cdc1c`，基于 `main@8bb915f`；worktree `.worktrees/rescue-5f8ce0ee`。未合并 main、未推送、未打包安装、未重启 4319。

## 1. 做法

1. 以 `main@8bb915f`（当时 main 头）新建 worktree/分支，保证提交只包含相对 main 的增量。
2. 对交付报告 `docs/mcp-task-service-exit-lifecycle-arena-2026-09-20.md` 第 3 节列出的每个文件，用 `git diff --no-index` 把脏树工作副本与 main 检出逐一比较（脏树相对旧分支全部是未跟踪文件，`git diff main -- path` 会误报为删除，故改用 no-index）。
3. 逐 hunk 甄别后再套用：只保留 5f8ce0ee 的 hunk，排除 (a) main 上更新而脏树尚无的内容（离线接管/交付集成闸门：`server.mjs` 的 `projectRoot/gitVerifyArgv`、`projectTasks.ts` 的 delivery/integration/presence 类型、README 新增章节、TaskBoard 的 release/交付状态 UI）——这些在分支上按 main 原样保留；(b) 不属于 5f8ce0ee 的在途改动：228c5438 的 `dragDropEnabled`、`confirmDialog`/`leaving()` 改写、`main.tsx` 拖放守卫、版本号 0.1.21 等。
4. 新增文件整体复制；`project_tasks.rs` 相对 main 仅新增（3 行头部替换 + 188 行新增），整体复制。
5. `cargo check` 重新生成 `src-tauri/gen/schemas/*`，只保留与新增 dialog 能力对应的 `capabilities.json` 一行变化，其余两份仅换行差异已还原。

## 2. 文件对应（报告第 3 节 → commit）

| 报告第 3 节 | commit 中状态 | 备注 |
| --- | --- | --- |
| `apps/project-tasks/gateway.mjs` | M（hunk 1/2/4/5） | hunk 3 为 main 的 projectRoot 接线，保留 main |
| `apps/project-tasks/server.mjs` | M（hunk 2/3：SSE Origin 记录、`streams()`） | hunk 1/4 为 main 的 git 验证接线，保留 main |
| `apps/project-tasks/gateway-bootstrap.mjs` | M（GATEWAY_PROTOCOL 4） | |
| `apps/project-tasks/gateway-lifecycle.mjs` | A | 含同别名会话去重 |
| `apps/project-tasks/test/gateway-lifecycle.test.mjs` | A | 6 项 |
| `apps/project-tasks/README.md` | M（退出行为段落） | main 新增章节保留 |
| `package.json` | M（test:project-tasks 加入新测试） | 版本号未动 |
| `src-tauri/src/project_tasks.rs` | M（整体） | 相对 main 纯新增 |
| `src-tauri/src/lib.rs` | M（3 hunk，158 行 < 160 架构上限） | |
| `src-tauri/capabilities/default.json` | M（dialog ask/message） | 附带生成物 `gen/schemas/capabilities.json` |
| `src-tauri/tauri.conf.json` | M（仅 gateway-lifecycle.mjs 资源映射） | 版本与 dragDropEnabled 未带入 |
| `src/platform/projectTasksLifecycle.ts` | A | |
| `src/platform/projectTasks.ts` | M（hunk 3/4：pauseTaskEventStreams） | main 类型保留 |
| `src/platform/projectTaskLauncher.ts` | M（2 hunk） | |
| `src/features/taskboard/TaskServiceControls.tsx` | A | |
| `src/features/taskboard/taskboard-service.css` | A | |
| `src/features/taskboard/TaskBoard.tsx` | M（仅 import + `<TaskServiceControls connected={!!client} />`） | 首次误套了一个 confirm hunk，已还原后重套并核对 grep |
| `scripts/verify-project-task-launcher.mjs` | M | |
| `docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json` | M | 在 main 版本上新增本条目，`test:agent-status` 通过 |
| `docs/mcp-task-service-exit-lifecycle-arena-2026-09-20.md` | A | 交付报告随行 |

共 22 个文件，+885/−17。

## 3. 分支上验证

- `npm run build`（`tsc -b` + vite）exit 0。
- `npm run test:project-tasks`：90 项（89 通过，1 项平台跳过）+ 验收回归 109 断言 + 编辑冲突 14 断言 + 启动器/资源打包断言通过。
- `npm run test:architecture`、`npm run test:agent-status` 通过。
- `cargo check --tests` exit 0；`cargo test project_tasks` 5 passed（含真实 node 脚本测试）。为通过 Tauri 构建脚本的资源校验，把主工作区被 git 忽略的 `src-tauri/resources/native-host/` 复制到 worktree（不入提交）；`node_modules` 以目录联接指向主工作区。
- 主工作区保持原样：脏项 446 → 446，`.worktrees/rescue-5f8ce0ee` 提交后工作区干净。

## 4. 如实说明

- 提交基于 `8bb915f`；集成 round3（8767e2a8，青岚）已在其后把 main 推进到 `5923514`，合并本分支时按当时 main 处理冲突（预计只有状态文档/README 相邻行）。
- 未在分支上重跑完整 `npm run verify` 与原生退出实测（原生证据见 5f8ce0ee 归档附件，源码同一版本）。
- 228c5438（OS 拖拽 `dragDropEnabled`/文档级守卫）与后续全应用 `confirmDialog` 修复同样只存在于脏树，尚未成为 commit；建议同样方式再抢救一支（`rescue/228c5438-desktop-drop-confirm`），未经指示本轮未做。
- 安装版 0.1.24 不含本分支内容。
