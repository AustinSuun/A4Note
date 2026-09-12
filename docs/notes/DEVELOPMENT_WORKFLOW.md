# Aster 协作开发流程

本文档说明多人协作时如何领任务、建分支、修改代码、提交合并请求和处理冲突。产品目标见 `GOAL.md`，模块边界见 `ARCHITECTURE.md`，代码规范见 `CODING_STANDARDS.md`，UI 规范见 `UI_GUIDELINES.md`。

## 1. 基本原则

- `main` 必须保持可运行。
- 不直接向 `main` 提交代码。
- 每个任务开独立分支。
- 每个 PR 只解决一个清晰问题。
- 合并前必须跑验证。
- 影响模块边界、数据结构、PDF 标注、文件导入、SQLite、AI Provider 或 UI 体系的改动必须有人 review。

## 2. 开发前必须读

新成员或新任务开始前至少阅读：

```text
README.md
docs/notes/DEVELOPMENT_HANDBOOK.md
docs/notes/AGENT_STATUS.md
plans/PROJECT_STATUS.json
docs/notes/AI_DEVELOPMENT_PLAN.md
docs/notes/GOAL.md
docs/notes/ARCHITECTURE.md
docs/notes/DEVELOPMENT_WORKFLOW.md
docs/notes/CODING_STANDARDS.md
docs/notes/UI_GUIDELINES.md
docs/notes/MODULE_OWNERS.md
```

`AI_DEVELOPMENT_PLAN.md` 是产品定位、阶段顺序和下一批任务的权威入口，优先级高于 `DEVELOPMENT_TASKS.md`。

按任务范围追加：

```text
改 src/workbench/**、src/core/workspace.ts、src/core/resources.ts、
src/features/explorer/**、src/features/agents/**、
src/platform/projects/**、src/platform/agentCli/**
或 src/ui/styles/workbench.css  -> docs/notes/WORKSPACE_BASELINE.md

改 PDF 阅读器或标注                -> docs/notes/READER_BASELINE.md
改工作台视觉、token 或共享样式      -> docs/notes/UI_REDESIGN_BASELINE.md
改 src/ui/styles/markdown.css、
   src/shared/markdown/** 或
   Markdown 主题变量               -> docs/notes/MARKDOWN_THEME_CONTRACT.md
接入外部 CLI Agent                 -> docs/notes/CLI_REUSE_STRATEGY.md
改 src/core/agentProtocol.ts、
   src/core/agentHistory.ts、
   src-tauri/src/agent_cli/**、
   src-tauri/src/agent_bridge.rs 或
   src-tauri/src/agent_history.rs  -> CLI_REUSE_STRATEGY.md + WORKSPACE_BASELINE.md
```


如果任务只改一个模块，也要先看对应模块的 `index.ts` 和 `types.ts`，确认外部接口。

## 3. 任务拆分标准

一个任务应能在 1 到 3 天内完成，并且有明确验收标准。

好的任务例子：

```text
拆 ReaderToolbar 到独立模块
把 PdfReader 移到 features/reader/pdf
新增 shared/ui/Button
修复译文 PDF 标注 file_id 隔离
给 AI Provider 增加设置页展示
```

不好的任务例子：

```text
重做 UI
优化架构
完善阅读器
接入所有 AI
整理全部代码
```

每个任务至少写清：

```text
目标：
影响目录：
不允许修改：
验收标准：
需要运行的验证：
```

## 4. 分支命名

建议格式：

```text
feature/<module>-<short-name>
refactor/<module>-<short-name>
fix/<module>-<short-name>
docs/<short-name>
```

例子：

```text
feature/reader-toolbar
refactor/app-import-flow-hook
fix/annotation-file-id
docs/development-workflow
```

## 5. 开发流程

1. 从最新 `main` 创建分支。
2. 只修改任务相关目录。
3. 小步提交，提交信息写清楚模块和意图。
4. 提交 PR 前运行验证。
5. 填写 PR 模板。
6. 请求对应模块 owner review。
7. 通过后合并。
8. 合并后其他成员同步 `main`。

## 6. 验证要求

普通前端改动至少运行：

```powershell
npm run build
npm run test:architecture
```

涉及 UI 状态、阅读器、导入、标注、数据模型或 Rust 后端时运行：

```powershell
npm run verify
```

只改文档时可以不跑完整验证，但 PR 中要写明“仅文档改动”。

涉及 Tauri/Rust 命令时至少运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

涉及 `src/core/workspace.ts`、`src/workbench/**` 或工作台外壳装配时至少运行：

```powershell
npm run test:workspace
npm run test:resources
npm run test:ui-state
npm run test:architecture
```

涉及 `src/core/resources.ts`、`src-tauri/schema.sql` 或 `src-tauri/src/workbench_store.rs` 时至少运行：

```powershell
npm run test:resources
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml workbench_store
```

URI 语法只有 TypeScript 一份（`src/core/resources.ts`）。Rust 原样存 `uri`，边界脚本断言 `workbench_store.rs` 里没有 `normalize_uri`、`resources_uri` 索引不是 UNIQUE：去重是模型职责，模型出 bug 应该表现为一行重复记录，而不是一次失败的保存。加新的资源生产者时先补 `npm run test:resources` 的断言，再改实现。

涉及 `src/core/agentProtocol.ts`、`src/core/agentHistory.ts`、`src-tauri/src/agent_cli/**`、`src-tauri/src/agent_bridge.rs` 或 `src-tauri/src/agent_history.rs` 时至少运行：

```powershell
npm run test:agent-protocol
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml
```

Agent 事件名和字段名在 TS 与 Rust 两侧各有一份，只改一侧会静默错位，必须同一个 PR 改完。改进程层（`launch.rs` / `process.rs` / `supervisor.rs`）时，`npm run test:architecture` 还守着几条不变量：四个被剥离的父会话环境变量、Windows shim 的元字符拒绝与 `CREATE_NO_WINDOW`、`ChildTransport` 走同一个 `AgentTransport` 且 tree-kill、supervisor 不自己分帧也不认识 SQLite 和 Tauri。

改适配器和 Tauri 桥（`providers/codex.rs` / `providers/claude.rs` / `agent_bridge.rs` / `lib.rs` 注册段 / `src/platform/agentCli/**` / `AgentSessionPanel`）时，同一个脚本还守着：`agent_cli/` 里不出现 `tauri::`（只有 `agent_bridge.rs` 同时认识两边）；`AGENT_EVENT` 与前端的 `AGENT_EVENT_CHANNEL` 必须都是 `agent://event`；五个命令在 `agent_bridge.rs`、`generate_handler!` 和 `platform/agentCli` 三处同名，其中四个阻塞命令必须是 `#[tauri::command(async)]`；退出清理挂在 `RunEvent::Exit` 上的 `agent_bridge::shutdown(app)`；两个适配器的权限兜底都取最小档（codex 的 `sandbox_for` 落 `read-only`、claude 的 `permission_for` 落 `MANUAL_MODE`），codex 的 `approvalPolicy` 恒为 `"never"`，claude 的 `can_use_tool` 恒回 `behavior:"deny"` 且其他控制请求也必须被答复；`provider_for` 里 `codex` 与 `claude` 两个分支都在，未知 id 仍被 `NotInstalled` 拒绝；`useAgentSession` 不 import `@tauri-apps`；会话面板不再有 `<textarea disabled` 和 `agentRuntimePending`（输入框已经能真的发消息，不能改回占位态）。

改历史（`agent_history.rs` / `src/core/agentHistory.ts` / `platform/agentCli/agentHistory.ts` / `useAgentSession` 的读写 effect）时，守的是那道墙和一致性：`load_agent_messages` / `save_agent_messages` 挂在 `state_commands.rs`（`P2-1` 之前在 `lib.rs`）而**不是** `agent_bridge.rs`，且都是 `#[tauri::command(async)]`；`agent_bridge.rs` 里既不出现 `rusqlite` 也不出现 `agent_history`；`agent_history.rs` 里不出现 `tauri::`；`agent_messages` **没有**指向 `agent_sessions` 的外键（快照整表重写那张表，级联会删光所有对话），孤儿行由 `workbench_store` 在同一个事务里调 `prune_orphans` 扫掉；UPSERT 不改 `created_at`；`src/core/agentHistory.ts` 保持纯 core（不认识 React、Tauri、platform 与 features）。行的语义变化写在 `npm run test:agent-protocol` 里，那份脚本跑的是真实模块。

改后端命令时（`P2-1` 之后）还有一层形状检查：命令体必须写在拥有那几张表的领域模块里，`lib.rs` 只加一行注册且条目必须是 `模块::命令`。`npm run test:architecture` 断言 `lib.rs` 里没有 `#[tauri::command]`、没有 `rusqlite`/`params!`/`Connection`、行数小于 160 —— 也就是说"顺手把实现写回 crate 根"会直接挂在验证上，而不是等到下一次拆分。

`npm run verify` 必须从 PowerShell 运行：`scripts/verify-all.mjs` 在 win32 上用 `cmd.exe` 包装每一步，在 POSIX shell 里会报 `spawn cmd.exe ENOENT`。

## 7. PR 合并规则

PR 必须说明：

- 改了什么。
- 影响哪些模块。
- 是否改了数据结构。
- 是否改了 UI。
- 是否影响导入、阅读、标注、AI 或插件。
- 跑了哪些验证。
- 有哪些风险或后续工作。

合并前至少满足：

- 构建通过。
- 架构边界检查通过。
- 对应模块 owner 已 review。
- 没有无关格式化和无关重构。
- 没有绕过 `core / platform / features / workbench / shared` 的边界。

## 8. 冲突处理

减少冲突的规则：

- 不让多人同时大改 `src/ui/App.tsx`。
- 不让多人同时大改 `src/features/reader/pdf/PdfReader.tsx`。
- 不让多人同时大改 `src-tauri/src/lib.rs` 的命令注册段（`P2-1` 之后这个文件只有 97 行，冲突面已经压到"各自加一行注册"，但同一段还是同一段）。
- 不让多人同时大改 `src/ui/styles/tokens.css` 或 `src/ui/styles/workbench.css`（`src/ui/styles.css` 现在只是 8 行 import 汇总，冲突点已经转移到拆出来的分文件）。
- 不让多人随意改 `src/core/types.ts`。
- 大文件拆分期间安排单人窗口期。

出现冲突时：

- 由对应模块 owner 主导解决。
- 不为了合并方便删除别人逻辑。
- 解决后重新运行相关验证。
- 冲突复杂时拆成更小 PR，不在一个 PR 里顺手重构多个模块。

## 9. 当前优先协作方向

任务顺序的权威来源是 `AI_DEVELOPMENT_PLAN.md` 的第 16 节，这里只记录它当前的排法：

1. `PDF-0` Reader 输入从 Paper 改吃 PDF Resource（`RES-2` 已经给它准备好资源身份）。
2. `AGT-4` 会话里的 `@resource` 上下文（`RES-2` 的第二个消费者）。

已经完成、不用再排的老条目：`PdfReader.tsx` 已在 `src/features/reader/pdf/`，`styles.css` 已拆成 `tokens.css` / `layout.css` / `base.css` / `components.css` / 各场景样式，`shared/ui` 已有 `Button` 和 `Panel`；`CLI-3` Claude Code 适配器已落地（新增 `providers/claude.rs`，在 `agent_bridge::provider_for` 加一个分支；`textMode` 实测是 `delta` 而不是计划里写的 `snapshot`，因为 `--include-partial-messages` 给的是真增量）；`CLI-4` Agent 消息历史已落 SQLite（`agent_messages` 表 + `src-tauri/src/agent_history.rs` + `src/core/agentHistory.ts`，挂载时回填，重启后对话还在）；`RES-2` 通用 Resource 注册与 URI 规范化已落地（`src/core/resources.ts` + `resources` 表 + `npm run test:resources`），但它现在只有"打开文件标签"一个生产者，消费者是 `PDF-0` 和 `AGT-4`，在那之前不要加"资源库"面板；`P2-1` `src-tauri/src/lib.rs` 已按领域拆完（2799 行 → 97 行，13 个领域模块 + `library_tests.rs`，diff 里只有搬动，`cargo test` 前后都是 115 个），命令注册段的争用从此只剩一行一条，后端不再是"谁都要改同一个文件"的冲突点。仍然欠着的是从 `App.tsx`（1872 行）抽出 hooks，可以和上面几项并行，但要单人窗口期。
