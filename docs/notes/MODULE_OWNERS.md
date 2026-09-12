# Aster 模块负责人建议

本文档用于多人协作时明确模块边界和 review 责任。当前可以先作为建议表使用，后续团队稳定后再替换成具体人员姓名或 GitHub 账号。

## 1. Owner 职责

模块 owner 负责：

- 审查该模块的 PR。
- 维护模块边界。
- 判断是否需要拆分文件。
- 确认改动没有破坏核心工作流。
- 冲突时主导解决。

owner 不是唯一能改该模块的人，但涉及该模块的重要改动应由 owner review。

## 2. 模块划分

| 模块 | 目录 | 建议 owner | Review 重点 |
| --- | --- | --- | --- |
| 产品目标和架构 | `docs/notes/AI_DEVELOPMENT_PLAN.md`, `docs/notes/ARCHITECTURE.md`, `docs/notes/GOAL.md` | 产品/架构负责人 | 方向是否一致，边界是否清晰 |
| Core | `src/core/` | 核心架构负责人 | 类型、关系系统、命令、Provider、插件边界 |
| 场景插件 | `src/core/*Plugin.ts`, `src/core/builtinScenePlugins.ts`, `src/workbench/sceneViews.tsx` | 核心架构负责人 + 对应 feature owner | 场景 ID/插件 ID 稳定性、最小权限、视图和专属侧栏注册、停用释放 |
| Workbench/Core 模型 | `src/core/workspace.ts`, `src/workbench/workspaceStore.ts` | 工作台负责人 | 纯模型无副作用、无操作不写入、恢复修复规则 |
| Resource 身份 | `src/core/resources.ts`, `src-tauri/schema.sql` 的 `resources` 表 | 工作台负责人 | URI 语法只此一份（Rust 不得再写规范化）、`normalizeResourceUri` 必须幂等、去重走 `resourceKey`、`folder` 不靠名字猜、`resources_uri` 索引保持非 UNIQUE |
| Platform | `src/platform/` | 桌面能力负责人 | Tauri 调用封装、文件/数据库边界 |
| Platform 项目与 CLI | `src/platform/projects/`, `src/platform/agentCli/` | 桌面能力负责人 | 路径校验、懒加载、`detect_agent_cli` 只检测不启动、会话生命周期只透传给 `agent_bridge` 命令、错误状态 |
| Backend | `src-tauri/` | Rust/SQLite 负责人 | 数据库迁移、文件复制、命令安全、测试 |
| Backend 领域模块 | `src-tauri/src/lib.rs`, `src-tauri/src/{app_paths,database,guide,diagnostics,backup,pdf_metadata,library_*,project_commands,state_commands}.rs` | Rust/SQLite 负责人 | `lib.rs` 保持只有模块表 + `generate_handler!` + `run()`（`P2-1` 之后有行数上限），命令体必须进拥有那几张表的模块，注册条目写成 `模块::命令`，跨领域的端到端测试留在 `library_tests.rs` |
| Backend 工作区文件系统 | `src-tauri/src/workspace_fs.rs` | Rust/SQLite 负责人 | 路径白名单、条目上限、预览上限、外部打开安全 |
| Library | `src/features/library/` | 文献库负责人 | 导入、标签、表格、详情、导出 |
| Reader | `src/features/reader/`, `src/features/reader/pdf/PdfReader.tsx` | 阅读器负责人 | PDF 渲染、标注、右侧面板、阅读空间 |
| AI | `src/features/ai/`, `src/core/aiProviders.ts` | AI 负责人 | Provider 抽象、上下文、会话绑定 |
| Explorer | `src/features/explorer/` | 桌面能力负责人 | 只读语义、懒加载、二进制提示 |
| Agents | `src/features/agents/` | Agent 运行时负责人 | 不伪造尚未支持的 Provider（未知 provider 必须报错而不是看起来能聊）、读不到历史时必须说出来并停掉这一次挂载的写（不能让新消息盖掉一行读不出来的旧记录）、状态与权限模式、沙箱在启动时定下、检测失败提示 |
| Agent Runtime | `src/core/agentProtocol.ts`, `src-tauri/src/agent_cli/`（含 `providers/codex.rs`、`providers/claude.rs`）, `src-tauri/src/agent_bridge.rs` | Agent 运行时负责人 | 两侧事件名同步、一次终止只合成一个错误、回合隔离、夹具不绑定真实 `Child`、父会话环境变量必须剥离、停止走 tree-kill 阶梯且退出后无残留、runId 由 supervisor 铸造、Provider 特殊逻辑只进 `ProviderSession`（会话 id 回传统一走 `providers/mod.rs` 的 `ProviderHandle`）、权限兜底取最小档（codex `read-only` / claude `manual`）、适配器必须自报 `textMode` 而不让 UI 猜、`agent_cli/` 里不出现 `tauri::`、Tauri 命令只在 `agent_bridge.rs`、阻塞命令必须 `async`、退出清理挂在 `RunEvent::Exit` |
| Agent 历史 | `src/core/agentHistory.ts`, `src-tauri/src/agent_history.rs`, `src-tauri/schema.sql` 的 `agent_messages` 表 | Agent 运行时负责人 + Rust/SQLite 负责人 | 那道墙必须在（两个命令挂 `state_commands.rs`，`agent_bridge.rs` 里不出现 `rusqlite`/`agent_history`，`agent_history.rs` 里不出现 `tauri::`）、行形状由纯 core 决定、`seq` 只数已开过 run 的回合、回填的 runId 必须带 `#restored{seq}` 标记、UPSERT 不改 `created_at`、`agent_messages` 不加指向 `agent_sessions` 的外键（孤儿行交给 `prune_orphans`） |
| Workbench | `src/workbench/`, `src/platform/workbench/`, `src-tauri/src/workbench_store.rs` | 工作台负责人 | 命令面板、面板 Host、标签与布局、快照持久化、禁止 import `ui/`/`platform/`/`features/` |
| UI System | `src/shared/ui/`, `src/ui/styles.css`, `src/ui/styles/tokens.css`, `src/ui/styles/layout.css`, `src/ui/styles/workbench.css` | UI 负责人 | token、组件一致性、视觉规范 |
| Settings | `src/features/settings/` | 设置负责人 | 设置持久化、诊断、备份入口 |
| Docs | `README.md`, `docs/` | 文档负责人 | 新人入口、协作流程、标准一致性 |


## 3. 高风险文件

这些文件改动需要额外 review：

```text
src/core/types.ts
src/core/workspace.ts
src/core/resources.ts
src/core/agentProtocol.ts
src/core/agentHistory.ts
src/core/relations.ts
src/core/asterCore.ts
src/core/builtinScenePlugins.ts
src/core/*Plugin.ts
src/workbench/sceneViews.tsx
src/platform/nativeApi.ts
src/workbench/workspaceStore.ts
src/ui/App.tsx
src/features/reader/pdf/PdfReader.tsx
src/ui/styles.css
src/ui/styles/tokens.css
src/ui/styles/workbench.css
src-tauri/src/lib.rs
src-tauri/src/library_import.rs
src-tauri/src/library_annotations.rs
src-tauri/src/workspace_fs.rs
src-tauri/src/workbench_store.rs
src-tauri/src/agent_cli/protocol.rs
src-tauri/src/agent_cli/supervisor.rs
src-tauri/src/agent_cli/providers/mod.rs
src-tauri/src/agent_bridge.rs
src-tauri/src/agent_history.rs
src-tauri/schema.sql
package.json
```

其中：

- `src/core/workspace.ts` 和 `src/workbench/workspaceStore.ts` 由 Workbench/Core owner 控制合并窗口，改动前先补 `npm run test:workspace` 断言。
- `src/core/resources.ts` 是资源身份的唯一权威：`normalizeResourceUri` 的输出被当成 `uri` 存进 SQLite，也被当成标签 key，所以改它等于改历史数据的身份。改动前先补 `npm run test:resources` 断言，并保持幂等（把输出再喂回去必须不变）。`workbench_store.rs` 里不得出现第二份规范化，`resources_uri` 索引不得改成 UNIQUE —— 去重是模型职责，模型出 bug 应该表现为一行重复记录，不是一次失败的保存。
- `src-tauri/src/workbench_store.rs` 与 `src-tauri/schema.sql` 一起改：快照形状的权威在 `src/core/workspace.ts`，Rust 侧只是它的存储投影。
- `src-tauri/src/lib.rs` 从 `P2-1` 起只有模块表、`generate_handler!` 和 `run()`（2799 行 → 97 行）。新增命令时改的是"某个领域模块 + 这里一行注册"，不是这个文件的长度：`npm run test:architecture` 断言它里面没有 `#[tauri::command]`、没有 `rusqlite`/`params!`/`Connection`、行数小于 160，且每个注册条目都写成 `模块::命令`。它仍然是高风险文件，因为整个命令表在这里，两个同时加命令的分支必然冲突；动之前先 rebase，不要与其它注册型任务并行排期。
- `src-tauri/src/library_import.rs` 和 `src-tauri/src/library_annotations.rs` 是 `P2-1` 拆出来的两个要点文件：前者复制用户的 PDF 进资料库（导入是复制不是链接）并按 `file_id` 找回字节，后者持有标注身份 —— 撤销/恢复必须复用原 `annotation_id`，否则右侧列表、PDF 选中和笔记引用会断链。跨领域的端到端测试在 `library_tests.rs`，改这两个文件时先看那 5 个测试还成立不成立。
- `src/core/agentProtocol.ts` 与 `src-tauri/src/agent_cli/protocol.rs` 是**同一份线上契约的两种语言**：事件名或字段名只改一侧就会静默错位，必须同一个 PR 改完，并跑 `npm run test:agent-protocol` + `npm run test:architecture`。
- `src-tauri/src/agent_cli/supervisor.rs` 是所有 Provider 共用的会话运行时：runId 铸造、回合排队、取消语义和退出清理都在这里，改它会同时影响每个适配器。新增 Provider 时优先扩 `ProviderSession`，不要往 supervisor 里塞某一种 CLI 的特殊分支。`CLI-3` 是这条规则的第一次验证：Claude Code 的方言与 codex 完全不同（裸类型化对象，没有 `id`/`method`），但运行时一行没改，全部差异都落在 `providers/claude.rs` 里。
- `src-tauri/src/agent_cli/providers/mod.rs` 只放两个适配器共用的东西（当前是 `ProviderHandle` 这个会话 id 回传口）。往这里加 Provider 专用逻辑等于把差异又抬回共用层，应该退回各自的适配器文件。`ProviderHandle::publish` 必须保持幂等——claude 每一轮都重发 `system/init`。
- `src/core/agentHistory.ts` 与 `src-tauri/src/agent_history.rs` 是一对，但**不在同一侧墙内**：前者决定一行长什么样（`seq` 怎么数、回填的 runId 怎么标、哪几行需要写回），后者只存不算。历史属于 Aster 自己的数据库，所以两个命令挂在 `state_commands.rs`（`P2-1` 之前在 `lib.rs`）而不是 `agent_bridge.rs`——CLI 那一侧不该有办法碰到它。改行语义前先补 `npm run test:agent-protocol` 断言；改表结构时记住 `agent_messages` 故意没有指向 `agent_sessions` 的外键（快照是整表重写，级联会删光所有对话），孤儿行由 `workbench_store` 在同一个事务里调 `prune_orphans` 扫掉。

- `src/ui/styles/workbench.css` 只由 UI owner 改；feature 场景样式仍归各 feature owner。


## 4. 临时规则

在团队人数较少时，可以一个人兼任多个 owner，但 PR 仍应按模块边界说明影响范围。

如果某个任务跨越三个以上模块，先拆任务，不要直接开大 PR。

如果必须跨模块修改，PR 说明里要写清楚：

```text
为什么必须跨模块：
每个模块改了什么：
回滚风险：
验证命令：
```
