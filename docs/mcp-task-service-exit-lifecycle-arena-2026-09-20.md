# 任务服务退出生命周期（5f8ce0ee）实现与验证报告 — Arena 2026-09-20

任务：`5f8ce0ee-75cb-4daa-bdc9-7e187535ecb1` 修复"关闭软件后任务服务残留"。执行者：Arena状态核查（worker，本会话私有 session）。状态：实现完成，提交待验收；未归档、未打包安装、未重启用户现用 4319 服务、未迁移真实库。

## 1. 问题成因

- 看板服务 `gateway.mjs` 由软件以脱离父进程的方式启动（多窗口 / 多项目 / 外部 Agent 共用），软件退出时没有任何一处负责停止它。
- 旧协议（v3）网关的 health 不带 pid，也没有停止接口；启动脚本只会在"下次启动"时结束旧网关，所以关掉软件后 node 进程与端口一直保留。
- 机器上仍可见 5 个 9-19～9-20 遗留的仓库网关进程（PID 48716/28448/25332/16916/29680，父进程已不存在），就是这一缺陷的直接证据；它们不属于本任务的隔离实例，未经用户授权本会话未处理。

## 2. 方案要点

1. 网关升级到 v4：health 报告 `pid/startedAt/capabilities.shutdown`；新增仅 hub token 可用的 `GET /api/gateway/status`（项目、SSE 流按来源分 `app/other`、5 分钟内活跃 Agent）与 `POST /api/gateway/shutdown`（拒绝浏览器 Origin、项目令牌 403、进程内实例 409）。收到停止请求后：停止监听 → 只删除属于自己 pid 的 `gateway-connection.json` → 退出，5 秒看门狗兜底。
2. 新增 `gateway-lifecycle.mjs`：`inspect` 只读识别，`stop` 只有在"私有记录 + 监听者 health 身份 + 上报 pid"三者一致时才发出停止；状态分 `running / legacy / stale-record / foreign / pid-mismatch / none`。外部程序占用端口、pid 不一致一律跳过；死 pid 的旧记录只清理不发信号；旧版（v3）网关沿用启动脚本的同 id 退役策略；优雅停止超时后仅在 health 仍为同 id/pid 时才 SIGTERM。同别名的多个会话在提示中去重。
3. Rust 侧（`project_tasks.rs`）：只有"本进程启动了服务、用户未选择保留、尚未决定"时才拦截窗口关闭，并向 WebView 发 `a4note://task-service-exit`；WebView 10 秒无回应则放行下一次关闭（防卡死阀）；`RunEvent::Exit` 再做一次有界（12 s）兜底停止。新增命令 `inspect_project_tasks / stop_project_tasks / set_project_tasks_exit_policy / resolve_app_exit`。
4. 前端退出流程（`projectTasksLifecycle.ts`）：暂停自身 SSE → inspect → 若有其他 A4 Note 窗口仍连接则保留服务并提示 → 若有 Agent 在线则弹原生对话框"退出 A4 Note"（列出 Agent，按钮"退出并停止服务 / 取消"）→ 停止 → `resolve_app_exit`。停止失败时提示 PID 与后续处理方式，不会静默残留。
5. 任务场景新增服务栏（`TaskServiceControls`）：显示服务 PID 与在线 Agent 数、"关闭软件时保留后台服务"开关（默认关）、"停止服务"按钮（有 Agent 时二次确认）、失效记录一键清理。
6. 启动协议升到 4：用户下次用新版本启动看板时会自动结束并替换现有 v3 网关（同端口同凭据，Agent 短暂断连后自动重连）。

## 3. 改动文件

- `apps/project-tasks/gateway.mjs`、`server.mjs`、`gateway-bootstrap.mjs`、`gateway-lifecycle.mjs`（新）、`test/gateway-lifecycle.test.mjs`（新）、`README.md`、`package.json`（test:project-tasks 纳入新测试）
- `src-tauri/src/project_tasks.rs`、`src-tauri/src/lib.rs`、`src-tauri/capabilities/default.json`（dialog ask/message）、`src-tauri/tauri.conf.json`（资源 gateway-lifecycle.mjs）
- `src/platform/projectTasksLifecycle.ts`（新）、`projectTasks.ts`、`projectTaskLauncher.ts`、`src/features/taskboard/TaskServiceControls.tsx`（新）、`taskboard-service.css`（新）、`TaskBoard.tsx`
- `scripts/verify-project-task-launcher.mjs`（新增断言）、`docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json`

## 4. 自动化验证

| 项目 | 结果 |
| --- | --- |
| `node --test apps/project-tasks/test/gateway-lifecycle.test.mjs` | 6/6：真实网关子进程 inspect/优雅停止/记录删除/数据与附件跨重启保留、hub-only 鉴权（项目令牌 404/403、浏览器 Origin 403）、重复停止幂等、pid 不一致不发信号、外部监听者不动、失效记录清理但活 pid 不杀、旧版 skip/terminate、进程内实例拒绝远程停止、同别名多会话去重 |
| `npm run test:project-tasks`（改动后） | 77 项：76 pass、1 skipped（平台不允许文件符号链接）。首轮并行运行时他人未提交的 `acceptance-cli.test.mjs` 出现一次文件级 `test failed`，单独运行与整套复跑均通过 |
| `cargo test project_tasks`（真实 node 脚本） | 5 passed；`cargo check --tests` 通过 |
| `npm run build`、`npm run test:architecture`（lib.rs 158 行） | 通过 |
| `node scripts/verify-project-task-launcher.mjs` | 通过（退出处理器在启动前安装等新增断言） |
| 完整 PowerShell `npm run verify`（改动后） | VERIFY_EXIT=0，日志见附件 `full-verify-after.log` |

## 5. 原生隔离实测（Windows，开发环境 debug 二进制）

环境：工作区源码 `tauri build --debug --no-bundle`，独立 identifier / WebView profile / USERPROFILE / APPDATA（`.tmp/arena-queue-20260920/home`），网关端口 4451，CDP 9261；全程不接触用户的 4319 服务、真实资料库与安装版进程。驱动：`.tmp/arena-queue-20260920/exit-test.mjs`（P1/P2）、`exit-test-p3c.mjs`（P3）。

- P1 关闭即停（10/10，`result.json`）：看板连接 → 网关 PID 32260 由本实例启动 → 点击标题栏关闭 → 软件 1106 ms 内退出（code 0）→ 网关 pid 消失、端口关闭、`gateway-connection.json` 删除、`tasks.sqlite` 保留。截图 `p1-board.png`。
- P2 重开恢复 + 保留策略（6/6）：重新启动 → 新网关 PID 47648、同项目身份、旧任务可见（`p2-board-after-restart.png`）；勾选"关闭软件时保留后台服务"后关闭 → 网关继续运行 → `gateway-lifecycle.mjs stop` CLI 优雅停止（method=graceful）。
- P3 Agent 在线（19/19，`result-p3.json`）：CLI worker `arena-exit-worker` 加入 → 关闭 → 原生对话框"退出 A4 Note"出现，正文列出 Agent（`1 个 Agent 最近在线：arena-exit-worker（project）`），按钮为"退出并停止服务 / 取消"（Win32 枚举确认）→ 点"取消"：对话框关闭、软件与网关都在、看板自动重连（`p3-after-cancel.png`）→ 再次关闭：对话框再次出现 → 点"退出并停止服务"：软件约 2 s 退出（code 0）、无后续警告框、网关停止、记录删除、数据保留。
- 清理：每轮结束扫描测试二进制路径与隔离记录，无残留进程；隔离网关已全部停止。

说明：此前一版 P3 驱动用 `SendKeys {ENTER}` 确认，对话框未在前台导致按键未送达，被误判为"确认后不退出"；换成按钮标签点击后复现三次全部通过。原因已在驱动脚本注释中记录，避免后续复测再踩。

## 6. 覆盖范围与未尽事项（如实）

- 已覆盖：关闭看板窗口即退出；重开恢复数据；"保留"策略；活跃 Agent 时的提示/取消/确认；外部程序占端口、pid 不一致、失效记录、旧版网关、进程内实例、重复停止（单元/集成，真实子进程）。
- 多窗口：另一个 A4 Note 窗口仍连接时按 `streams.app` 判定保留服务并提示，逻辑有集成测试（按 Origin 分流统计），原生只跑了单窗口，未做双实例原生实测。
- 多项目：网关按项目列出 Agent 与流，停止是网关级别；原生实测为单项目。
- 托盘：当前产品没有托盘常驻入口，退出路径只有窗口关闭 / 应用 Exit；若日后加入托盘需复用 `resolve_app_exit`。
- 崩溃恢复：软件异常退出后网关会留下，下次启动由 bootstrap 复用或按协议退役，死 pid 记录由 inspect/stop 清理；WebView 无响应时 10 秒放行阀生效（原生第二次关闭超过宽限即放行并由 Exit 兜底停止，实测出现过一次并正常退出）。
- 安装版：未打包、未安装、未发布。用户现用安装版（`D:\A4 Note`，PID 29732，网关 34772/v3）不含本修复，需要重新打包后才生效；首次用新版本启动看板时会自动替换旧 v3 网关。
- 机器上 5 个早期遗留仓库网关进程未处理，等待用户授权后再清理。

## 7. 附件

`result.json`、`result-p3.json`、`p1-board.png`、`p2-board-after-restart.png`、`p3-after-cancel.png`、`p3c-driver.log`、`full-verify.log`。
