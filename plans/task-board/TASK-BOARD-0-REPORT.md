# TASK-BOARD-0 调查报告

调查时间：2026-09-05T13:23:11+08:00

结论：**A**。当前环境存在可用于连接器实现的正式协议面：T3 Code 的 orchestration HTTP API/WebSocket RPC，以及 Codex 的官方 `app-server` JSON-RPC。它们可以覆盖会话/线程枚举、指定线程发送回合、状态读取和流式事件订阅。当前未把这些接口配置成无需认证的本机公开服务，因此下一阶段必须实现认证后的连接器，并把版本/权限失败显示为明确状态；不能把桌面 Electron IPC 或 UI 自动点击当作替代接口。

## t3code 版本/来源

- 产品：T3 Code Nightly，进程产品版本 `0.0.39.0`。
- 安装位置：`C:\Users\Austin\AppData\Local\Programs\t3code\T3 Code (Nightly).exe`。
- 打包元数据：`resources/app.asar` 的 `package.json` 声明 `0.0.39-nightly.20260904.1280`，commit `d6e29dc9dee9`；`resources/server.asar` 的 server 包同版本。
- 运行方式：Electron 桌面端加载 `app.asar`，配套本地/远端 environment server（`server.asar`）。当前探测到 T3 进程，但没有发现监听在 `3000/4000/4096/5173/8000/8205` 的公开本地 HTTP 端口。

## 已验证事实

### T3 orchestration API

从安装包内 `apps/desktop/dist-electron/main.cjs` 的 contracts 和 `apps/server/dist/bin.mjs` 的服务实现中确认：

- HTTP `GET /api/orchestration/snapshot` 返回 `OrchestrationReadModel`，其中包含 `snapshotSequence`、`projects`、`threads`、`updatedAt`，可作为任务板的全量快照/枚举入口。
- HTTP `GET /api/orchestration/threads/:threadId` 返回指定线程详情；支持 `turnLimit` 和 `beforeCursor` 查询参数。
- HTTP `POST /api/orchestration/dispatch` 接收 `ClientOrchestrationCommand`，返回 `{ sequence }`。
- 上述三个 HTTP endpoint 都声明 `EnvironmentAuthenticatedAuth` middleware；请求头合同是可选 `authorization`/`dpop`，未认证不能视为可调用。
- WebSocket RPC 合同声明方法：`orchestration.dispatchCommand`、`orchestration.getWorkflowScript`、`orchestration.getTurnDiff`、`orchestration.getFullThreadDiff`、`orchestration.searchThreads`、`orchestration.getArchivedShellSnapshot`、`orchestration.subscribeShell`、`orchestration.subscribeThread`。订阅方法标记 `stream: true`，错误合同包含 `EnvironmentAuthorizationError`。
- `ClientOrchestrationCommand` 明确包含 `thread.create`、`thread.turn.start`、`thread.turn.interrupt`、`thread.approval.respond`、`thread.user-input.respond`、`thread.session.stop` 等命令。`thread.turn.start` 的负载有稳定 `threadId`、`message.messageId`、用户文本、模型/运行模式和创建时间字段，因此可以向指定线程追加任务。
- 事件合同包含 `thread.message-sent`、`thread.turn-start-requested`、`thread.turn-interrupt-requested`、`thread.approval-response-requested`、`thread.user-input-response-requested`、`thread.session-stop-requested`、`thread.session-set`、`thread.turn-diff-completed`、`thread.activity-appended`；内部流式命令还包含 `thread.message.assistant.delta` 与 `thread.message.assistant.complete`。
- 运行时状态合同可区分：会话 `starting | ready | running | waiting | stopped | error`；线程 `active | idle | archived | closed | compacted | error`；回合 `completed | failed | interrupted | cancelled`。这比单纯读取 UI 文本可靠。
- Relay API 还声明 `GET /v1/mobile/agent-activity` 和 `POST /v1/environments/:environmentId/threads/:threadId/agent-activity`，用途是发布/读取移动端 Live Activity 聚合，不应误用为完整任务分配协议。

### Codex app-server

- 本机命令 `codex --version` 输出 `codex-cli 0.153.4`。
- `codex app-server --help` 明确提供 stdio、WebSocket、Unix socket、`generate-ts` 和 `generate-json-schema`；裸 `app-server` 是 stdio 服务，不能在探测脚本中无界启动。
- 官方 OpenAI 文档 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 说明它是 Codex 为富客户端提供的正式接口，支持认证、会话历史、审批和流式 Agent 事件；文档列出 `thread/start`、`thread/list`、`thread/read`、`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`、`thread/status/changed` 等方法。
- 官方文档还明确 JSON-RPC/JSONL wire contract：请求带 `method`、`params`、`id`，通知带 `method`、`params`；线程和回合 ID 是稳定关联键。WebSocket 传输目前标为 experimental/unsupported，外部暴露必须配置认证和 TLS。

### Electron IPC、插件和 MCP

- `app.asar` 的 preload 暴露的是受控桌面 IPC（`desktop:*`），包括文件选择、窗口、更新、SSH/environment 管理和预览自动化；没有发现面向第三方的“枚举 T3 线程/发送线程消息”桌面 IPC channel。
- 包内确实存在 MCP 相关 schema/事件（例如 `mcp.status.updated`、MCP 工具事件），但没有发现一个独立、无需认证、面向任务板的 MCP server 入口。MCP 是 Agent 工具/事件能力，不等于 T3 orchestration 控制面。
- 未发现独立 T3 插件/扩展开发入口可供本任务直接安装；安装包内只有打包后的桌面端和 server 产物。仓库已有 `docs/notes/CLI_REUSE_STRATEGY.md` 记录 T3 Code 为 MIT，但第三方 vendored 依赖需各自遵守许可证。

## 能力判定

| 能力 | 判定 | 依据/限制 |
| --- | --- | --- |
| 枚举 Agent 对话 | 支持 | `GET /api/orchestration/snapshot`、`orchestration.searchThreads`、Codex `thread/list`；需要已认证 environment/app-server 连接。 |
| 取得稳定 ID | 支持 | T3 `threadId`/`projectId`、Codex `thread.id`/`turn.id`；ID 不应从标题或 UI 文本推导。 |
| 向指定会话追加任务 | 支持 | T3 `POST /api/orchestration/dispatch` 的 `thread.turn.start`，或 WS `orchestration.dispatchCommand`；Codex `turn/start`/`turn/steer`。可能触发运行时/审批权限错误。 |
| 读取运行状态 | 支持 | T3 snapshot/thread detail 与状态字段；Codex `thread/read`、`thread/status/changed`。应保留 `waiting`、`error` 等非完成态。 |
| 接收事件/进度 | 支持 | T3 `subscribeThread`/`subscribeShell` 流；Codex JSONL notifications 和 `turn/*`、`item/*` 事件。 |
| MCP 作为任务板控制面 | 未验证/不推荐 | 只确认包内 MCP schema/事件存在，没有确认独立任务分配 MCP server。 |
| 桌面 IPC 作为外部 API | 不支持 | 只看到内部 Electron `ipcMain`/preload channel；没有稳定的第三方 IPC 版本承诺。 |

## 证据（命令、文件、接口）

实际运行过：

```powershell
Get-Content -Raw -Encoding utf8 docs\notes\CLI_REUSE_STRATEGY.md
Get-Content -Raw -Encoding utf8 AGENTS.md
Get-Command codex,t3code
Get-Process | Where-Object { $_.ProcessName -match 'codex|t3|aster' }
codex --version
codex app-server --help
node plans\task-board\investigation\inspect-t3code-bundle.mjs
foreach($port in 3000,4000,4096,5173,8000,8205) { ... Invoke-WebRequest ... }
npm run test:agent-status
git status --short
```

允许保存的探测脚本为 [inspect-t3code-bundle.mjs](D:\WorkSpace\Aster\plans\task-board\investigation\inspect-t3code-bundle.mjs)。脚本只读取打包 JS 的接口/合同字符串，截断并去重输出，不读取会话数据库、消息正文、凭据、token 或 cookie。

## 推荐连接器

优先实现 T3 environment connector：

1. 由用户显式配置并验证 `httpBaseUrl`/`wsBaseUrl` 和认证方式；认证材料进入系统凭据存储，不能写入任务卡、日志或 SQLite 业务表。
2. 先调用 snapshot，建立 `projectId`/`threadId` 索引；用 thread detail 或 `searchThreads` 做按需刷新。
3. 分配任务使用 `thread.turn.start`，每个命令生成自己的 `commandId`、`messageId` 和时间戳，并记录 connector request id，不记录认证头。
4. 通过 `subscribeThread` 接收 delta、活动、回合完成/失败和 waiting 状态；断线后用 `snapshotSequence`/游标补偿，不依赖轮询 UI。
5. 版本化 schema，拒绝未知命令类型并把 `EnvironmentAuthorizationError`、连接失败、线程不存在和 provider error 分开显示。
6. Codex 直连只作为第二个 provider/本地模式，使用本机版本导出的 schema；不要把 T3 私有 orchestration schema 与 Codex app-server schema 混成一个协议。

## Fallback 方案

如果用户没有提供可授权的 T3 environment endpoint，先实现独立任务板：生成任务包文件（任务 ID、目标、范围、验收、上下文和交接模板），复制任务正文到剪贴板，由用户在目标 T3 会话中确认发送。任务板可以继续读取用户手动回写的报告/状态文件。

Fallback 不能自动完成：会话枚举、准确状态订阅、指定线程投递、审批处理和事件补偿。浏览器 DOM 抓取、按坐标点击、读取 T3 本地数据库或复用内部 IPC 都不应被标记为“正式接入”。

## 安全/隐私限制

- 本调查未读取或输出 Codex/T3 凭据、token、cookie、个人消息内容或完整会话记录，也没有创建会话、发送消息、修改设置或终止 Agent。
- T3 orchestration endpoint 受 `EnvironmentAuthenticatedAuth` 保护；WS 还受 `EnvironmentAuthorizationError` 约束。连接器必须最小权限、用户确认和可撤销凭据。
- Codex 官方文档将 WebSocket app-server 标为 experimental/unsupported；非 localhost 连接必须使用认证和 TLS。默认优先 stdio 或本机/SSH 转发。
- T3 Code 仓库在项目文档中记录为 MIT，可在保留版权/许可证的前提下复用必要片段；不得复制整个应用。`paseo` 是 AGPL-3.0，只能作为设计参考。
- 任务分配连接器不能允许远端 Agent 直接写 Aster SQLite；进度、验证结果和交接应通过受控事件/文件回写，经用户确认后落库。

## 对 TASK-BOARD-1 的具体建议

- 先实现只读连接测试和 snapshot 映射：配置 endpoint、认证状态、连接延迟、版本/schema 能力。
- 再实现显式确认的 `DispatchTask`：展示目标项目/线程、任务摘要、权限范围和将发送的文本，用户确认后发送 `thread.turn.start`。
- 增加订阅适配器：把 T3 事件映射为 `idle/running/waiting/failed/closed`，保留原始 provider 状态用于诊断。
- 设计断线重连与快照游标补偿，避免只靠 WebSocket 内存事件。
- 提供 Codex app-server 本地 provider，但将其能力标记为版本绑定/实验性；不要依赖 T3 私有桌面 IPC。
- 在没有 endpoint/凭据时自动降级为任务包 + 剪贴板 + 用户确认，不尝试自动点击或读取本地会话库。

## 未解决问题

- 当前 T3 桌面实例没有可探测的公开 localhost 监听，尚未在授权 environment 上实际完成一次 snapshot、dispatch 或 subscribe；报告中的 T3 能力来自安装包内正式 contracts/服务定义，而非对真实账户数据的调用。
- 尚未确认当前账号/环境是否拥有 orchestration dispatch 权限、是否需要额外 pairing 或 relay 连接，以及不同 nightly 版本的 schema 兼容窗口。
- 尚未确认 T3 的第三方 connector 注册/插件发布流程；需要向 TASK-BOARD-1 明确“使用已授权 environment API”，不要假设桌面插件可装载。
- T3 `thread.turn.start` 的任务文本、附件、模型和权限策略需要在后续连接器中按实际 schema 完成编码与大小限制测试。
