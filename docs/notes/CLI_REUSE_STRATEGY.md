# CLI 集成与复用策略

> 状态：`A-2` 已完成。本文件是 Agent CLI 参考仓库、许可证边界、协议选型和可复用机制的权威依据。
>
> 本机验证环境：Windows 11，`codex-cli 0.146.0`，`2.1.220 (Claude Code)`，验证日期 2026-07-31。命令参数以本节记录的本机输出为准，不凭记忆硬编码。

## 1. 决策摘要

A4Note 不在 React UI 里重新实现 Codex、Claude Code 或其他 Agent 运行时，也不把任何外部应用整体复制进仓库。

三条硬结论：

1. **不 scrape 人类可读 stdout。** 两个参考实现都走结构化协议：Codex 用 `codex app-server` 的 stdio JSON-RPC，Claude Code 用 `--output-format stream-json`，其余 CLI 走 ACP。文本抓取只作为协议不可用时的显式降级路径。
2. **Rust 侧必须自己写 supervisor。** 两个参考仓库都是 Electron + TypeScript，没有可直接搬运的 Tauri/Rust 进程管理层。可复用的是协议定义、生命周期设计和边界条件，不是实现代码。
3. **许可证决定复用方式。** paseo 是 AGPL-3.0，只能读、不能抄；t3code 是 MIT，可以按条件复用代码；协议上游是 Apache-2.0，可以依赖。

## 2. 参考仓库与许可证边界

| 仓库 | 许可证 | 允许的复用方式 |
| --- | --- | --- |
| `getpaseo/paseo` | AGPL-3.0（Copyright (c) 2025-present Mohamed Boudra；其中第三方组件各自保留原许可） | **只读设计参考。** 可以借鉴机制、状态划分、边界条件和常量取值，必须用自己的实现重写。禁止复制源码、逐行翻译或整体移植文件。 |
| `pingdotgg/t3code` | MIT（Copyright (c) 2026 T3 Tools Inc.） | **允许代码级复用**，条件是保留版权声明和许可声明。仅限仓库自身的源码；`.repos/`（vendored 的 alchemy-effect、effect-smol 等）和 `patches/` 属第三方，各自独立判断。 |
| `openai/codex` | Apache-2.0 | 协议上游。`codex-rs/app-server-protocol/`（含 `schema/{json,precomputed,typescript}`）是 app-server JSON-RPC 的权威定义，可依赖或按 Apache-2.0 条件引用。 |
| `agentclientprotocol/agent-client-protocol` | Apache-2.0 | ACP 上游。后续接入 Copilot / Cursor / Gemini 类 Provider 时的协议来源。 |

执行规则：

- 从 paseo 复制任何代码片段进 A4Note 之前必须停下来问用户；AGPL 会传染整个应用。
- 从 t3code 复制超过片段级别的内容时，在目标文件头保留 MIT 归属。
- 不 vendor 整个应用。只引入协议定义和本文件第 5 节明确列出的机制。
- 引入任何上游 schema 时记录版本或 commit，不引入无版本标记的快照。

## 3. 本机已验证事实

以下全部来自本机实际执行，不是记忆。改动适配器参数前先重跑一次。

### 3.1 Codex

```text
which          C:\Users\Austin\AppData\Roaming\npm\codex.ps1（同目录另有 codex、codex.cmd）
codex --version   codex-cli 0.146.0
codex app-server  存在，标记 [experimental]
  子命令          daemon / proxy / generate-ts / generate-json-schema
  裸 app-server   即在 stdio 上运行 app server（不要在验证脚本里裸调，会挂住）
codex app-server generate-json-schema --out <DIR>   从本机二进制导出协议 schema
codex app-server generate-ts --out <DIR>            导出 TypeScript 绑定
```

关键收益：schema 可以**从本机安装的 codex 导出**，不必像 t3code 那样把上游 commit 钉死在生成脚本里（t3code 的做法是 `UPSTREAM_REF` + `ManualSchemas` 补丁表，用来修上游 schema 缺口）。A4Note 应优先用本机导出，把上游仓库当作对照。

### 3.2 Claude Code

```text
which             C:\Users\Austin\AppData\Roaming\npm\claude.ps1（同目录另有 claude、claude.cmd）
claude --version  2.1.220 (Claude Code)
结构化 IO         -p / --print
                  --input-format   text | stream-json
                  --output-format  text | json | stream-json
                  --include-partial-messages   （需配合 --print + stream-json）
会话              --session-id <uuid> / -r,--resume [value] / --fork-session
权限              --permission-mode  acceptEdits | auto | bypassPermissions | manual | dontAsk | plan
目录              --add-dir <directories...>
```

paseo 走 TypeScript Agent SDK，A4Note 的 supervisor 在 Rust，等价路径是 `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`，协议形态与 SDK 一致，不需要 Node 中间层。`CLI-3` 落地时实测补两点（2.1.220）：这条路径还必须带 `--verbose`，CLI 自己要求；而且**没有 `--cwd`**，工作目录只能由 spawn 决定。方言不是 JSON-RPC —— 帧是裸的、按行分隔的类型化对象，只有 `type`，既没有 `id` 也没有 `method`。

### 3.3 未安装

`gemini`、`opencode` 本机不存在。ACP 分支现在无法本机验证，推迟到首批两个 Provider 稳定之后，不在 `CLI-2` / `CLI-3` 期间提前抽象。

### 3.4 权限模式映射

A4Note 的 `AgentSession.permissionMode` 到 Claude Code（`agent_cli/providers/claude.rs` 的 `permission_for`，已落地于 `CLI-3`）：

```text
default     -> manual
autoReview  -> acceptEdits
fullAccess  -> bypassPermissions   必须由用户显式选择，不做默认值
未知模式     -> manual              取最小权限，绝不取最大
```

`manual` 是这里的"只读档"：会问的操作一律被拒，所以这一轮能读能搜，不能写。claude 的审批请求走控制协议（`can_use_tool`），A4Note 一律回 `behavior:"deny"` 并附一句给模型的说明，同时在 transcript 里记一条 `approvalDenied`；其他 subtype 也必须答（回 `subtype:"error"`），否则它后面那一轮会一直等下去。

Codex 的对应项**不走** `-c` 配置覆盖：0.146.0 的 `thread/start` / `thread/resume` 直接收 `approvalPolicy` 与 `sandbox` 两个参数，`CLI-2` 就是这么传的，所以不需要动 codex 的配置文件。实测映射（`agent_cli/providers/codex.rs` 的 `sandbox_for`）：

```text
default     -> read-only
autoReview  -> workspace-write
fullAccess  -> danger-full-access   必须由用户显式选择，不做默认值
未知模式     -> read-only            取最小权限，绝不取最大
```

`approvalPolicy` 恒为 `"never"`：A4Note 还没有审批 UI，会问的策略只会让每一轮卡在一个永远不会弹出的对话框上，所以沙箱是唯一的真实限制。CLI 仍然主动发起的审批请求被回 JSON-RPC error 并在 transcript 里显示，不静默吞掉。

## 4. 可复用机制清单

每条给出参考来源、事实和 A4Note 落点。常量取值是设计参考，Rust 侧自己实现，不复制代码。

### 4.1 JSONL 行分帧

来源：paseo `packages/server/src/server/agent/providers/jsonl-rpc-process.ts`。

缓冲 stdout，按 `\n` 切分，去掉行尾 `\r`，跳过空行，逐行 `JSON.parse`；**遇到非 JSON 行只告警并忽略，不视为致命错误**（CLI 会往 stdout 混入非协议输出）。

落点：`src-tauri/src/agent_cli/protocol.rs` 的 framing 层。Windows 上 `\r` 必须处理。**已落地（`CLI-0`）**：`JsonlDecoder::push` / `flush`，测试覆盖跨 chunk 切分的帧、空行与非 JSON 行、结尾无换行的最后一行。

### 4.2 请求关联与超时

事实：以 `id` 关联的 pending map + 每请求独立计时器；默认超时 30_000 ms，另有"永不超时"模式（长回合必须用它，否则一次长对话会被误杀）。

落点：supervisor 内部的 request registry。A4Note 的 `send` 属于长回合，用无超时模式；`detect` / 初始化握手用有限超时。**已落地（`CLI-0`）**：`peer.rs` 的 `AgentPeer::send_request(.., timeout: Option<Duration>)`，`None` 即永不超时，`DEFAULT_REQUEST_TIMEOUT = 30s`。

### 4.3 stderr 尾部缓冲

事实：stderr 只保留尾部 8192 字节的环形缓冲，**唯一用途是给错误信息补充上下文**，不作为事件流。

落点：`AgentError.detail`。避免把整份 stderr 灌进前端或数据库。**已落地（`CLI-0`）**：`StderrTail`（`STDERR_TAIL_LIMIT = 8192`），按字符边界裁剪，不会切坏多字节字符。

### 4.4 退出与失败传播

事实：进程退出时用 exit code + signal + stderr 尾部合成**一个**错误，先通知退出订阅者，再 `failAll()` 拒绝所有 pending 请求。`send()` 在进程已释放或 stdin 不可写时静默丢弃。

落点：`CLI-0` 的错误类型必须能同时携带 exit code、signal 和 stderr 尾部；`CLI-1` 保证不留悬挂的 pending 请求。**错误类型已落地（`CLI-0`）**：`AgentPeer::termination_error(&exit)` 合成唯一错误（`with_detail(stderr 尾部)` + `with_exit(code, signal)`），`fail_all` 把它交给每个 pending 请求；stdin 关闭后 `send_notification` 静默丢弃并累计 `dropped_writes`，`send_request` 直接返回 `Transport` 错误且不登记 pending。**真实进程路径也已落地（`CLI-1`）**：`ChildTransport` 观察到的退出会被锁存，`PumpOutcome::Closed` 让 supervisor 对打开的回合发**一个** `failed`（`resolve` 的失败路径会先清掉当前回合，所以不会补第二个），会话线程随后 `shutdown`。


### 4.5 进程终止阶梯

事实：`close()` 先 `stdin.end()`，再 tree-kill：SIGTERM → 等 2_000 ms → SIGKILL → 等 1_000 ms → 告警。必须是 tree-kill，因为这些 CLI 是 shim，会派生孙进程。

落点：`CLI-1` 的停止和应用退出清理。本机 `codex` / `claude` 都是 npm shim（`.ps1` / `.cmd` / 无扩展名三件套），单杀直接子进程会留下孤儿。这条是"关闭应用后无残留 CLI 子进程"验收项的实现依据。**已落地（`CLI-1`）**：`process.rs` 的 `StopLadder`（`graceful` 2 s / `forceful` 1 s / `poll` 50 ms）走 stdin EOF → 宽限期内 reap → 软 tree-kill → 强制 tree-kill → 兜底 `Child::kill`；Windows 用 `taskkill /PID <pid> /T`，Unix 用负 pid 对 `process_group(0)` 建的进程组发 `TERM` / `KILL`。`impl Drop for ChildTransport` 与 `impl Drop for AgentSupervisor`（→ `close_all()` → 逐个 `join`）是"退出无残留"的两道保证；`StopLadder::fast()` 让测试用毫秒走完整条升级路径。

### 4.6 回合事件隔离与缓冲

来源：paseo `provider-runner.ts`。`ProviderTurnRunner` 形态是 `startTurn(prompt, options) -> { turnId }`、`subscribe(cb) -> unsubscribe`、`getSessionId()`。

关键细节：**事件可能早于 `startTurn` 返回**。实现先缓冲这些事件，拿到 `turnId` 后重放，之后丢弃 turnId 不匹配的事件。

落点：A4Note 已有 `runId`，但缺少这套缓冲/重放/过滤。**已落地（`CLI-0`）**：Rust 侧 `turn.rs` 的 `RunGate`（`buffer` / `open` 重放并丢弃不匹配 / `accept` / `close`），前端侧 `src/core/agentProtocol.ts` 的 `createAgentRunGate` / `bufferAgentEvent` / `openAgentRunGate`。`CLI-1` 直接用了它，没有另写一套（边界脚本断言 supervisor 里出现 `RunGate::new()`）：runId 由 supervisor 铸造成 `{session_id}-{n}`，Provider 自己的回合句柄只用来识别过期帧，适配器不碰 gate。

### 4.7 增量文本与累积文本

事实：paseo 有两个 final-text reducer（替换式与增长式），因为部分 Provider 发增量、部分重发累积全文。

落点：适配器层归一化，统一向上发增量 `delta`。适配器必须声明自己是哪种语义，不让 UI 猜。**已落地（`CLI-0`）**：`AgentRunState.textMode: 'delta' | 'snapshot'`，由 `createAgentRunState` 在建会话时声明；`applyAgentEvent` 按声明拼接或替换，UI 不判断。首批两个适配器（`CLI-2` / `CLI-3`）实测都是增量：codex 发 `item/agentMessage/delta`，claude 在 `--include-partial-messages` 下转出 Anthropic 自己的 `text_delta`。所以 `snapshot` 这一档目前没有实际使用者，留着是因为归一化发生在适配器里 —— 只能重发全文的 CLI 必须有办法说出来，而不是让 UI 去猜。claude 那条 `assistant` 全量帧不是 snapshot 语义，它是同一段话的重复，按 message id 抑制掉。


### 4.8 可执行文件探测（Windows）

来源：paseo `packages/server/src/executable-resolution/{executable-resolution,windows}.ts`。

事实：

- 用 `which -a`（`which(name, { all: true })`）枚举 PATH 上**全部**匹配项，不取第一个就收工。
- Windows 候选包含裸名、`.exe`、`.cmd`；另外扫 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\<pkg>\<name>.exe`。
- 探测方式是跑 `--version`，超时 2000 ms；命令是 Windows 脚本时才用 `shell: true`。
- 错误分类是重点：**被 kill 或返回非零退出码都算"已安装"**，只有 `ENOENT` / `EACCES` / `ENOEXEC` / `UNKNOWN` 算不存在。
- 参数需要 Windows 引号处理（`quoteWindowsArgument` / `quoteWindowsCommand`）。

落点：`workspace_fs.rs` 现有的 `detect_agent_cli` 已经能返回命令、版本和路径。补齐两点：`.cmd` / `.ps1` shim 要走 shell 执行；非零退出码不要报"未安装"。启动侧的那一半已落地（`CLI-1`）：`launch.rs::resolve_program` 按 `PATH` + `PATHEXT` 枚举候选，`requires_shell()` 判断要不要走 `cmd /C`。目前 `workspace_fs::locate_executable` 与它是同一段 PATH 走查的两份拷贝，等检测也搬到 Provider 后面时合成一份。

### 4.9 父会话环境变量剥离

事实：paseo `provider-launch-config.ts` 显式从子进程环境里删除：

```text
CLAUDECODE
CLAUDE_CODE_ENTRYPOINT
CLAUDE_CODE_SSE_PORT
CLAUDE_AGENT_SDK_VERSION
```

否则被拉起的 CLI 会以"不能在另一个会话内启动"失败。

落点：`CLI-1` spawn 时必须剥离。**A4Note 自身就是在 Claude Code 里开发的**，开发期一定会撞上这个问题；这也意味着这条不能只靠手工测试发现，要在 supervisor 里写死并加测试。**已落地（`CLI-1`）**：`launch.rs` 的 `STRIPPED_ENV_VARS` 就是上面四个名字，`build_command()` 逐个 `env_remove`，测试 `removes_the_parent_session_variables_and_keeps_the_extras` 断言四个都被删掉且额外变量仍在；`verify-architecture-boundaries.mjs` 也逐个断言这四个名字仍在源码里，改名或漏一个会在验证阶段就红掉。

同一文件还有命令覆盖模型：`ProviderCommand { mode: 'replace' | 'append' }`，并把最终来源标为 `default | append | override`。A4Note 若开放自定义命令，沿用这个三态来源标记，便于诊断"参数是谁改的"。

### 4.10 会话生命周期与回合生命周期分离

事实：paseo `packages/protocol/src/agent-lifecycle.ts` 的会话状态只有五个：

```text
initializing | idle | running | error | closed
```

回合结束是另一套事件：`turn_completed` / `turn_failed` / `turn_canceled`。

落点（**已修正**，`CLI-0`）：`src/core/workspace.ts` 的 `AgentSessionStatus` 原先是 `idle | starting | running | stopping | completed | failed`，把会话终止和回合完成混在一起了。现在是：

```text
idle | starting | running | stopping | failed | closed
```

一次回合结束是 `running -> idle`，会话可继续对话；`closed` 才是会话自身的终态，并且允许 `closed -> starting` 以支持恢复（`CLI-4`）。`idle -> running` 合法，因为进程是否还活着只有 supervisor 知道；`closed -> running` 和 `failed -> running` 非法。回合完成表示为 `AgentEvent` 的 `completed`（语义对齐 `turn_completed`）。

同批落地：`agentSessionTransitions`、`scripts/verify-workspace-model.mjs` 的断言（含"写入 `completed` 会被拒绝"）、`src/ui/zh.ts` 的 `agentStatusClosed` 与 `AgentSessionPanel` 的 `statusLabels`。SQLite 侧不需要改：`schema.sql` 与 `workbench_store.rs` 把 status 当字符串存取，状态机在 `src/core/workspace.ts` 里。

### 4.11 fake peer 测试夹具

事实：两个仓库都提供假对端而不是真起 CLI：

```text
paseo   codex/test-utils/fake-app-server.ts
t3code  test/fixtures/codex-app-server-mock-peer.ts
        test/fixtures/acp-mock-peer.ts
t3code  packages/effect-codex-app-server/src/_internal/stdio.ts
          makeChildStdio(handle) / makeInMemoryStdio()（队列支撑的内存 stdio）
          makeTerminationError -> TransportError / ProcessExitedError
```

落点：这正是 `CLI-0` 要求的 fake-process 夹具。**已落地（`CLI-0`）**：`transport.rs` 的 `AgentTransport` trait 抽象 stdio，`InMemoryTransport` + `FakePeer` 是队列支撑的内存实现（`send_line` / `send_chunk` / `send_stderr` / `exit` / `written` / `stdin_closed`），`peer.rs` 的 `termination_error` 对应 `makeTerminationError`。分帧层与请求关联层都不接触 `std::process::Child`，`peer.rs` 的 7 个测试覆盖增量输出、非 JSON 行、超时、非零退出、stdin 关闭与孤儿响应 id。夹具**不是** `#[cfg(test)]`，`CLI-1` 可以直接复用。


## 5. 复用边界

```text
A4Note UI
  -> AgentSession service
  -> 归一化 AgentProvider 适配器
  -> Tauri/Rust 进程 supervisor
  -> 本地 CLI 可执行文件
```

UI 只知道归一化操作和事件：

```text
detectProvider / startSession / sendMessage / stopSession / closeSession
providerEvent: started | delta | tool | completed | stopped | failed
```

适配器独占 Provider 差异：

- 可执行文件探测与版本检查；
- 命令与参数构造；
- 工作目录处理；
- 权限/沙箱映射；
- 协议帧到统一事件的转换；
- 停止与清理行为；
- 错误归一化。

禁止把 Provider 专用逻辑写进 `App.tsx`，禁止让 UI 解析 CLI 原始输出。

## 6. A4Note 自有部分

A4Note 拥有：

- `Project`、`Workspace`、`Tab`、`AgentSession` 的身份与状态机；
- 标签历史与布局持久化；
- 项目文件与资源引用；
- 知识上下文选择；
- 用户可见文案与错误状态；
- SQLite 持久化与显式知识库写入。

CLI 进程不得直接写 A4Note 的 SQLite。任何笔记、关系或元数据变更必须回到 A4Note 侧执行，并按需要经用户确认。

## 7. 实施顺序

1. `A-2` 参考仓库、许可证和可复用范围。**已完成，即本文件。**
2. `CLI-0` 固定协议 DTO、事件、错误类型，落地内存 stdio 夹具与 fake peer 测试；同批修正第 4.10 节指出的 `AgentSessionStatus` 语义。**已完成**：前端 `src/core/agentProtocol.ts`，Rust `src-tauri/src/agent_cli/{mod,protocol,transport,peer,turn}.rs`（18 个内联测试），检查项 `npm run test:agent-protocol`。
3. `CLI-1` 在 `src-tauri/src/agent_cli/` 实现进程 supervisor。**已完成**：`launch.rs`（启动配置、环境剥离、Windows shim 与元字符拒绝、`resolve_program`）、`process.rs`（`ChildTransport` 实现 `CLI-0` 的 `AgentTransport` trait，读取线程 + tree-kill 阶梯，不另起分帧）、`supervisor.rs`（一个会话一个线程、runId 铸造、排队、取消、退出清理、`ProviderSession` 接缝），当时 `agent_cli` 共 36 个内联测试，检查项 `npm run test:architecture` + `cargo test --manifest-path src-tauri/Cargo.toml`。`providers/` 留给 `CLI-2`。
4. `CLI-2` Codex 适配器，走 `codex app-server`；schema 用 `codex app-server generate-json-schema` 从本机导出，对照 `openai/codex` 上游。**已完成**：`providers/codex.rs`（v2 `thread/*` + `turn/*`，17 个内联测试）加 `agent_bridge.rs`。实际注册了**五个**命令而不是原计划的三个——`stop`（结束这一轮）和 `close`（结束会话）必须分开，否则关标签会漏子进程；`agent_session_running` 是因为 UI 状态会过期，重新挂载时得问运行时而不是猜。输入框已打开，`agent_cli` 现在 57 个内联测试，全量 `cargo test` 82 个。
5. `CLI-3` Claude Code 适配器，走 `claude -p --input-format stream-json --output-format stream-json`，复用同一 supervisor。**已完成**：`providers/claude.rs`（18 个内联测试）加 `agent_bridge::provider_for` 的一个分支，运行时一行没改。两处与原计划不同：一是它的方言**不是** JSON-RPC，帧只有 `type`、没有 `id`/`method`，所以走 `RpcFrame::Payload` 而不是请求关联；二是 `textMode` 实测应报 `delta` 而不是 `snapshot` —— `--include-partial-messages` 转出的是 Anthropic 自己的 `text_delta` 真增量，随后那条 `assistant` 全量快照按 message id 抑制掉。全量 `cargo test` 100 个。
6. `CLI-4` 会话持久化。`PWS-1` 已落地，会话记录本身已随工作台快照进 SQLite；这一步补的是消息历史表。**已完成**：`src-tauri/src/agent_history.rs`（`agent_messages`，一行一次交换，主键 `(session_id, seq)`，10 个内联测试）加纯 core 的 `src/core/agentHistory.ts`（行与 transcript 互相映射）。三处值得记下：一是两个命令挂在数据库那一侧而**不是** `agent_bridge.rs`（当时是 `lib.rs`，`P2-1` 之后是 `state_commands.rs`）—— 历史是 A4Note 自己的库，CLI 那一侧的墙必须继续挡住 `rusqlite`；二是 `agent_messages` 故意不做 `agent_sessions` 的外键子表（快照是整表重写，级联会删光所有对话），孤儿行由 `workbench_store` 在同一个事务里调 `prune_orphans` 扫掉；三是回填的 runId 必须带 `#restored{seq}` 标记，因为 supervisor 的 run 计数随进程重启，不标记的话新一轮的流式事件会落进一条旧回合里。全量 `cargo test` 115 个。
7. ACP 类 Provider 排在首批两个稳定之后，本机需先安装一个 ACP 实现才能验证。


`CLI-1` 最终没有动 `src-tauri/src/lib.rs`（`pub mod agent_cli;` 是 `CLI-0` 加的，本批只新增了三个 `agent_cli` 文件）。真正动注册段的是 `CLI-2`：`mod agent_bridge;`、五个命令、`.setup()` 里的 `agent_bridge::register(app)`、`RunEvent::Exit` 上的 `agent_bridge::shutdown(app)`；`CLI-4` 又加了 `mod agent_history;` 和两个历史命令，并顺手让整个文件过了 `rustfmt --edition 2021`。`P2-1` 随后把这个文件拆完了：2799 行 → 97 行，只剩模块表、注册段和 `run()`，两个历史命令搬到 `state_commands.rs`（还是数据库那一侧），`agent_bridge.rs` 与整个 `agent_cli/` 一行没动 —— 那道墙的两侧本来就已经分好文件，所以这次拆分对 Agent 运行时是零影响。往后加 Provider 命令的成本是"改 `agent_bridge.rs` + 在 `lib.rs` 加一行 `agent_bridge::xxx,`"。
