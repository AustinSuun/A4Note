# project-tasks 测试子进程环境隔离 — 竞行执行记录（2026-09-22）

- 任务：`f042df17-55e4-40d4-9745-70e411efb7bb`（normal）「project-tasks 测试环境泄漏：tools.test 子进程继承 TASKS_EXPECTED_PROJECT_ID / TASKS_PROJECT_ROOT，导致按 AGENTS.md 配置的 Agent 终端里 npm run verify 必失败，需隔离全部 TASKS_* 变量」
- 执行：竞行（worker 会话 `arena-worker-jingxing`），分支 `fix/project-tasks-test-env-jingxing`，基线 main `9c1f3d4`，worktree 目录沿用 `.worktrees/task-titlebar-drag-jingxing`。
- 现象：在按 AGENTS.md 第 49-50 行导出 `TASKS_PROJECT_ROOT` / `TASKS_EXPECTED_PROJECT_ID` 的终端里，`npm run test:project-tasks` 稳定失败于 `apps/project-tasks/test/tools.test.mjs`「real CLI and MCP stdio clients share tasks but not agent identities」：子进程 `cli.mjs join …` 报「看板服务身份不匹配：不是当前项目，未发送任何连接凭据。」。8cc3cc88、3580532a 两次交付的 `npm run verify` 都因此记为 60 步 59 通过。

## 根因

- `tools.test.mjs` 用 `{ ...process.env, TASKS_DATA_DIR, TASKS_URL }` 组装子进程环境，只删 `TASKS_SESSION_TOKEN` / `TASKS_SESSION_FILE`。终端里的 `TASKS_EXPECTED_PROJECT_ID` 原样进入子进程。
- `lib/agent-client.mjs` `runtime()` 优先取 `process.env.TASKS_EXPECTED_PROJECT_ID`，`checkService()` 用它比对一次性测试服务（`createTaskServer({ project: '工具测试' })`，随机 projectId）的 `/api/health` → 必然不匹配。这是生产 CLI 的有意设计（显式期望身份优先于磁盘 access.json），不应改。
- 同一模式下 `TASKS_ENROLLMENT_TOKEN` 也会泄漏：旧代码 `offline-takeover.test.mjs` 只删 4 个指定键，终端若导出了 `TASKS_ENROLLMENT_TOKEN`，其 `cli.mjs join` 报「注册凭据无效」（本次红测第 2 个失败用例）。
- 对照实验（main 9c1f3d4，未改代码）：导出变量时 `node --test apps/project-tasks/test/tools.test.mjs` → pass 0 / fail 1；`env -u TASKS_EXPECTED_PROJECT_ID -u TASKS_PROJECT_ROOT …` → pass 1 / fail 0；只去掉 `TASKS_PROJECT_ROOT` 仍失败。

## 修改

| 文件 | 改动 |
| --- | --- |
| `apps/project-tasks/test/test-env.mjs`（新增） | `testEnv(overrides)`：复制 `process.env` 时剔除所有 `TASKS_*`（大小写不敏感，Windows 环境变量名不区分大小写），再合入测试显式给出的键；值为 `undefined` 表示删除。 |
| `apps/project-tasks/test/tools.test.mjs` | `env = testEnv({ TASKS_DATA_DIR, TASKS_URL })`，去掉两行 `delete`。 |
| `apps/project-tasks/test/acceptance-cli.test.mjs` | `base = testEnv({ TASKS_PROJECT_ROOT, TASKS_EXPECTED_PROJECT_ID, TASKS_URL, TASKS_DATA_DIR })`；原先手写的 `TASKS_SESSION_*: undefined` 与 `PATH/SystemRoot/HOME/USERPROFILE` 重复赋值（本就来自 process.env）一并删除。 |
| `apps/project-tasks/test/gateway-lifecycle.test.mjs` | 原地的「删除除三键外所有 TASKS_*」循环改为 `testEnv({ TASKS_GATEWAY_DIR, TASKS_PROJECTS_HOME, TASKS_PORT })`。 |
| `apps/project-tasks/test/offline-takeover.test.mjs` | 原来只删 4 个键 → `testEnv({ TASKS_DATA_DIR, TASKS_URL })`。 |
| `apps/project-tasks/test/onboarding.test.mjs` | 原地循环 → `testEnv({ HOME, USERPROFILE })`。 |

未改 `apps/project-tasks/lib/agent-client.mjs`、`cli.mjs`、`mcp.mjs`、`server.mjs` 及任何生产行为；未触碰 4319 生产看板、access、session 文件。

审计：`grep -n "process.env" apps/project-tasks/test/*.mjs` 现只命中 `test-env.mjs` 自身；测试目录内其余 `spawn` 调用（`gateway-lifecycle.test.mjs` 的 `legacy.mjs` 假网关、`dead` 探针）不读取任何 `TASKS_*`，继承环境无害。

## 验证（均在导出 `TASKS_EXPECTED_PROJECT_ID=11111111-2222-3333-4444-555555555555`、`TASKS_PROJECT_ROOT=D:\WorkSpace\Aster` 的 shell 中；套件级另加 `TASKS_ENROLLMENT_TOKEN=leaked-token-should-be-dropped`）

| 命令 | 旧代码 | 新代码 |
| --- | --- | --- |
| `node --test apps/project-tasks/test/tools.test.mjs` | fail 1（「看板服务身份不匹配」，`.tmp/jingxing/test-env/tools-red.log`） | pass 1 / fail 0（`tools-green.log`） |
| `npm run test:project-tasks` | tests 87 / pass 84 / fail 2（tools.test「身份不匹配」+ offline-takeover「注册凭据无效」）/ skipped 1（`project-tasks-red.log`） | tests 87 / pass 86 / fail 0 / skipped 1，后续 verify-task-acceptance / verify-task-edit-conflict / verify-project-task-launcher 均通过（`project-tasks-green.log`） |
| `npm run verify`（独立控制台，同样导出变量，`.tmp/jingxing/test-env/verify.log`） | 上两次交付：60 步 59 通过 | 60 步全部通过，`VERIFY_EXIT 0`（其中 test:project-tasks 步骤 tests 87 / pass 86 / fail 0 / skipped 1；cargo test 步骤照常通过） |
| `npm run build` | — | verify-all 第 24 步 `npm run build`（`tsc -b && vite build`）通过，同一日志 |

## 边界

- 变量剔除只作用于测试派生的子进程；生产 CLI / MCP 对 `TASKS_*` 的读取语义未变。
- 未打包、安装、发布。
