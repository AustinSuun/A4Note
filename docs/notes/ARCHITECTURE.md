# Aster 模块化架构设计

本文档用于指导 Aster 后续模块化开发、协作开发和渐进式重构。`GOAL.md` 说明产品目标；本文说明代码应该如何组织、模块之间如何通信、哪些边界不能随意打破。

## 1. 架构目标

Aster 的长期定位是本地优先、可扩展的通用知识工作台。架构必须同时支持：

- 当前可用闭环：资料库、PDF 阅读、标注、译文 PDF、Markdown 笔记、AI 对话。
- 中期目标：统一 `KnowledgeObject / Relation` 关系系统。
- 长期目标：Obsidian 式知识关联、Zotero 级 PDF 标注、AI Provider、插件系统、可组合工作台界面。

因此架构设计的核心目标是：

- 业务能力模块化。
- 数据关系统一。
- UI 工作台可扩展。
- 插件通过受控 API 接入。
- 现有功能不能因为重构被破坏。

## 2. 当前状态

当前代码主要集中在：

```text
src/core/
src/platform/
src/features/
src/workbench/
src/shared/
src/ui/
src/data/
src-tauri/
```

其中：

- `src/core/types.ts` 已包含文献、标注、关系、工作台和 Provider 相关类型。
- `src/core/workspace.ts` 已包含 `Project / Workspace / WorkspaceTab / Resource / AgentSession` 纯模型与全部状态迁移，无 React、无 Tauri、无 storage。详见 `WORKSPACE_BASELINE.md`。
- `src/core/resources.ts` 已包含资源身份（`RES-2`）：URI 规范化（幂等）、`resourceKey` 去重身份、`resourceTabKey`、kind/标题推断和本地路径往返。URI 语法只在这里有一份，Rust 侧不写第二份。
- `src/core/relations.ts` 已有前端关系图映射和查询层。
- `src/core/workbench.ts` 已有工作台面板注册表。
- `src/core/aiProviders.ts` 已有 AI Provider runner 雏形。
- `src/core/asterCore.ts` 已有命令、事件、插件、Provider、设置等前端核心能力。
- `src/core/builtinScenePlugins.ts` 与 `overviewPlugin.ts`、`libraryPlugin.ts`、`readerPlugin.ts`、`aiPlugin.ts`、`markdownPlugin.ts` 已将内置场景统一纳入插件生命周期。
- `src/platform/nativeApi.ts` 已作为前端访问 Tauri/native 能力的边界。
- `src/platform/projects/` 已承载项目文件夹选择、文件树列举、文本预览和外部打开（VS Code / 资源管理器 / 默认应用）。
- `src/platform/agentCli/` 已承载 Codex / Claude Code CLI 的安装检测，只检测不启动。
- `src/platform/workbench/` 已承载工作台快照的 SQLite 适配器（`load_workbench_state` / `save_workbench_state`、去抖写入、旧 `localStorage` 快照迁移）。
- `src/features/library/` 已拆出 `LibraryScene`、`LibraryDetailPanel`、`ImportDialog`、`TagInput` 和 `types`，是当前 feature 模块样板。
- `src/features/reader/` 已拆出 `ReaderScene`、工具栏、侧边抽屉、Markdown 面板、标注列表、关系面板和 reader helper，阅读器外层已进入模块化阶段。
- `src/features/ai/AIChatScene.tsx` 已承载 AI 对话展示组件。
- `src/features/explorer/` 已承载 `FileTreePanel` 和 `FileTab`。
- `src/features/agents/` 已承载 `AgentSessionPanel` 和 `useAgentProviders`。
- `src/features/settings/index.tsx` 已承载设置、诊断、备份和插件设置展示组件，状态和副作用仍由 `App.tsx` 持有。
- `src/workbench/` 已承载工作台外壳：`WorkbenchShell`、`ProjectSidebar`、`WorkbenchTopBar`、`TabStrip`、`TabHost`、`CommandPalette`、`WorkspacePanelHost`、`workspaceStore`、`useWorkbench`、`workbenchLabels`。
- `src/workbench/sceneViews.tsx` 已提供场景 React 视图和场景专属侧栏视图注册表；`App.tsx` 只负责装配上下文，不再按内置场景写渲染分支。
- `src/shared/` 已建立 UI、hooks、utils 的稳定导出入口，后续按需填充。
- `src/ui/App.tsx` 已不再承载主要场景组件和外壳布局，但仍承担大量状态管理、快捷键、持久化和业务协调，后续需要继续抽 hooks。
- `src/features/reader/pdf/PdfReader.tsx` 是阅读器 PDF 核心，仍然较大，后续需要按渲染、标注、便签、文本层、快捷键拆分。
- `src-tauri/src/workspace_fs.rs` 已承载项目文件夹、文件树、文本预览、外部打开和 CLI 检测。
- `src-tauri/src/workbench_store.rs` 已承载工作台快照的 SQLite repository（单事务全量重写 `workbench_state / projects / workspaces / workspace_tabs / resources / agent_sessions`）。`resources.uri` 原样存前端算好的值，索引故意不是 UNIQUE。同一个事务顺手扫掉已消失会话的消息历史（`agent_history::prune_orphans`）——`agent_messages` 故意不是外键子表，见 `schema.sql`。
- `src-tauri/src/agent_cli/` 已承载 Agent CLI 协议层（`CLI-0`）、进程层（`CLI-1`）与第一个 Provider 适配器（`CLI-2`）。协议层：JSONL 分帧、事件 DTO 与错误类型、`AgentTransport` stdio 抽象与内存夹具、请求关联与超时、回合隔离，整层同步、不接触 `std::process::Child`。进程层：`launch.rs` 启动配置（父会话环境变量剥离、Windows `cmd` shim 与元字符拒绝、`PATH` 预解析）、`process.rs` 真实 `Child` 传输（读取线程 + tree-kill 阶梯）、`supervisor.rs` 一个会话一个线程（runId 铸造、排队、取消、退出清理）与 `ProviderSession` 适配器接缝。适配器层：`providers/codex.rs` 讲 `codex app-server` 的 v2 `thread/*` + `turn/*` JSON-RPC。整个 `agent_cli/` 里没有 `tauri::`，也不认识 `rusqlite`。前端对应的纯契约是 `src/core/agentProtocol.ts`。
- `src-tauri/src/agent_bridge.rs` 是运行时与 Tauri 之间唯一的接缝（`CLI-2`）：五个命令（`start_agent_session` / `send_agent_message` / `stop_agent_session` / `close_agent_session` / `agent_session_running`）、单一事件频道 `agent://event`、`register` 建 sink、`shutdown` 挂在 `RunEvent::Exit`。它不解释任何 CLI 方言，也不碰 SQLite。
- `src-tauri/src/agent_history.rs` 已承载 Agent 消息历史（`CLI-4`）：一行一次交换、主键 `(session_id, seq)`、写是只更新变了的行的 UPSERT（`created_at` 不动），`tool_payloads_json` / `error_json` 原样存不二次建模。它是仓库不是运行时，里面没有 `tauri::`；两个命令 `load_agent_messages` / `save_agent_messages` 挂在 `state_commands.rs`（`P2-1` 之前挂在 `lib.rs`），**不**挂在 `agent_bridge.rs` —— 那是 CLI 那一侧的墙，CLI 不该有办法碰到 Aster 的数据库。
- `src-tauri/src/lib.rs` 已经按领域拆完（`P2-1`）：2799 行 → 97 行，只剩模块表、`generate_handler!` 注册段和 `run()`。命令体在拥有那几张表的模块里 —— `app_paths` / `database` / `guide` / `diagnostics` / `backup` / `pdf_metadata` / `library_import` / `library_papers` / `library_annotations` / `library_notes` / `library_ai` / `project_commands` / `state_commands`，跨领域的端到端测试在 `library_tests.rs`。`npm run test:architecture` 钉住这条：`lib.rs` 里不许出现 `#[tauri::command]` 或 `rusqlite`，行数上限 160，注册条目必须写成 `模块::命令`。

当前不要立刻大规模移动文件。应先建立模块边界，再按稳定闭环逐步迁移。

## 3. 目标目录结构

长期建议结构：

```text
src/
  core/
    types.ts
    workspace.ts
    resources.ts
    agentProtocol.ts
    agentHistory.ts
    commands.ts
    events.ts
    relations.ts
    workbench.ts
    plugins.ts
    providers/
      ai.ts
      metadata.ts
      translation.ts

  platform/
    nativeApi.ts
    projects/
    agentCli/
    workbench/
    repositories/
    fileSystem.ts
    sqlite.ts

  workbench/
    WorkbenchShell.tsx
    ProjectSidebar.tsx
    WorkbenchTopBar.tsx
    TabStrip.tsx
    TabHost.tsx
    CommandPalette.tsx
    WorkspacePanelHost.tsx
    workspaceStore.ts
    useWorkbench.ts
    workbenchLabels.ts

  features/
    library/
    reader/
    explorer/
    agents/
    notes/
    ai/
    settings/
    relations/

  shared/
    ui/
    hooks/
    utils/

src-tauri/
  src/
    workspace_fs.rs
    workbench_store.rs
    agent_cli/
      mod.rs
      protocol.rs       # JSONL 分帧、事件 DTO、错误类型、stderr 尾部
      transport.rs      # AgentTransport trait + 内存 stdio 夹具
      peer.rs           # 请求关联、超时、终止错误合成
      turn.rs           # 回合隔离（RunGate）
      launch.rs         # 启动配置：环境剥离、Windows shim、PATH 解析
      process.rs        # 真实 Child 传输 + tree-kill 阶梯
      supervisor.rs     # 会话线程、runId、取消、退出清理、ProviderSession
      providers/
        mod.rs            # ProviderHandle（两个适配器共用的会话 id 回传口）
        codex.rs          # CLI-2：codex app-server 的 thread/* + turn/* JSON-RPC
        claude.rs         # CLI-3：claude -p 的 stream-json，裸类型化对象、非 JSON-RPC
    agent_bridge.rs     # CLI-2：五个 Tauri 命令 + agent://event，唯一同时认识 Tauri 的文件
    agent_history.rs    # CLI-4：agent_messages 仓库（命令在 state_commands.rs，这里没有 tauri::）
    lib.rs              # P2-1：只剩模块表 + generate_handler! + run()
    app_paths.rs        # 资料库路径、初始化、跨平台 reveal / 默认程序打开
    database.rs         # 连接与建表、标签规范化、时间戳等公共 SQLite 工具
    guide.rs            # 内置指南种子
    diagnostics.rs      # 诊断信息
    backup.rs           # 备份与恢复
    pdf_metadata.rs     # 从 PDF 首页文本猜标题/作者/DOI/年份
    library_import.rs   # 导入原文与译文、按 file_id 取字节、在外部打开
    library_papers.rs   # 文献列表、元数据、标签、删除
    library_annotations.rs # 标注增删改与撤销恢复
    library_notes.rs    # 笔记 upsert
    library_ai.rs       # AI 会话与消息
    library_tests.rs    # 跨领域端到端测试（临时 AsterData 根）
    project_commands.rs # 项目文件夹命令（实现在 workspace_fs.rs）
    state_commands.rs   # 工作台快照与 Agent 历史命令（SQLite 那一侧的墙）
```

`P2-1` 落地时把原先设想的 `commands/ database/ import/ annotations/ backup/` 目录改成了平铺的领域文件：每个模块自己拿着命令、DTO 和 helper，DTO 字段的可见性就只在一个文件里，不用为了共享类型把 `pub(crate)` 铺开。真的有一个领域涨到几百行以上时再把它变成目录。

迁移顺序：

1. 先从 `App.tsx` 抽 UI 组件，不改业务行为。
2. 再从 `PdfReader.tsx` 抽阅读器内部模块。
3. 再把 `nativeApi.ts` 和后端命令按领域拆分（后端那一半已由 `P2-1` 完成）。
4. 最后再做数据库通用关系表迁移。

## 4. 模块职责

### 4.1 core

`core` 是纯业务核心，不应该依赖 React 组件，也不应该直接依赖 Tauri。

负责：

- 类型定义。
- 命令系统。
- 事件系统。
- Provider 注册。
- 插件注册。
- 工作台面板注册。
- 关系图映射和查询。
- Agent CLI 契约与纯归约（`agentProtocol.ts`：事件类型、`AgentError`、`delta` / `snapshot` 文本语义、回合门 `AgentRunGate`）。它是 UI 与 Rust supervisor 共用的唯一契约，因此必须零依赖。
- Agent 历史行与 transcript 的互相映射（`agentHistory.ts`：`seq` 只数已开过 run 的回合、回填的 runId 带 `#restored{seq}` 标记且存回时剥掉、摘要决定哪几行需要写回）。它同样是纯函数：hook 只决定什么时候读写，不决定行长什么样。
- 资源身份（`resources.ts`：URI 规范化与幂等、`resourceKey` 去重、`resourceTabKey`、kind 与标题推断、本地路径往返）。同理，它是 UI、工作台模型和原生层共用的唯一 URI 语法，Rust 侧不得再写一份。
- Markdown 渲染等纯函数。

不负责：

- 直接操作 DOM。
- 直接调用 Tauri `invoke`。
- 直接渲染 UI。
- 直接操作 SQLite。

### 4.2 platform

`platform` 是前端访问本地能力的边界。

负责：

- 包装 Tauri 命令。
- 封装本地文件、数据库、PDF 字节读取、备份恢复等原生能力。
- 给上层提供稳定 TypeScript API。

不负责：

- 复杂 UI 状态。
- 场景布局。
- 业务决策。

当前 `src/platform/nativeApi.ts` 承担 platform 边界职责，后续可继续按文件、数据库、备份等领域拆分。

### 4.3 workbench

`workbench` 是界面框架层。

负责：

- 工作台网格与插槽（`WorkbenchShell`）。
- 项目/工作区导航（`ProjectSidebar`）。
- 顶栏动作（`WorkbenchTopBar`）。
- 标签条与标签宿主（`TabStrip` / `TabHost`）。
- 命令面板。
- 工作台面板 Host。
- 布局与标签状态的读写包装（`workspaceStore` / `useWorkbench`）。
- 快捷键分发。

不负责：

- 文献导入细节。
- PDF 标注算法。
- AI Provider 实现。
- 调用 Tauri 或读取中文字符串表。

硬约束：`src/workbench/**` 不 import `src/ui/*`、`src/platform/*`、`src/features/*`。因此：

- 需要原生能力的面板（文件树、Agent 会话）放在 `features/`。
- 文案通过 `WorkbenchLabels` 由 `App.tsx` 注入（`zh.workbench`），图标通过 props 注入。

这条边界由 `scripts/verify-architecture-boundaries.mjs` 逐文件断言。

### 4.4 features/library

资料库模块。

负责：

- PDF 导入流程。
- 元数据确认。
- 标签输入和标签墙。
- 表格、排序、筛选、批量操作。
- 文献详情。
- 译文 PDF 绑定入口。
- BibTeX / Markdown / CSV 导出。

不负责：

- PDF 页面渲染。
- 标注具体绘制。
- AI 推理。

### 4.5 features/reader

阅读器模块。

负责：

- PDF.js 渲染。
- Markdown 阅读模式。
- 原文 / 译文 PDF 切换。
- 文本层。
- 高亮、下划线、区域框选、便签。
- 标注删除、键盘删除、撤销/重做。
- PDF 内标注工具栏。

不负责：

- 文献导入。
- 元数据补全。
- 全局插件管理。

### 4.6 features/notes

笔记模块。

负责：

- Markdown 编辑。
- 自动保存。
- 预览。
- 标注引用到笔记。
- 后续双链、反链、块引用。

### 4.7 features/ai

AI 模块。

负责：

- AI 对话 UI。
- AI Provider 选择。
- `runAiProvider()` 调用。
- AI 使用的知识图谱上下文。
- AI 消息和关系记录。

### 4.8 features/settings

设置模块。

负责：

- 用户设置。
- 插件设置。
- 资料库路径。
- 诊断信息。
- 备份恢复。
- Provider 配置。

### 4.9 features/explorer

项目文件浏览模块。

负责：

- 只读文件树（懒加载展开、刷新、跳过生成目录）。
- 文件标签的文本预览，二进制文件给出明确提示而不是乱码。
- 在资源管理器/默认应用中打开选中路径的入口。

不负责：

- 文件写入、重命名、删除。
- PDF 渲染（PDF 由阅读器模块处理）。

### 4.10 features/agents

Agent 会话模块。

负责：

- Agent 会话面板：Provider 检测结果、状态、工作目录、权限模式、真实 transcript 与输入框。
- Provider 检测 hook（`useAgentProviders`）。
- 单个会话的运行时 hook（`useAgentSession`）：订阅 `agent://event`、乐观插入 prompt、重新挂载时采纳已在跑的进程、`send` 被拒后回滚并复查进程是否还活着、挂载时读一次历史并把变了的行写回去（`CLI-4`）。

不负责：

- 子进程生命周期（属于 Rust `agent_cli`）。
- 解析 CLI 协议帧（必须由 Rust 转成统一事件后再交给前端）。Rust 侧优先使用结构化协议：Codex 走 `codex app-server` 的 stdio JSON-RPC，Claude Code 走 `claude -p` 的 `--output-format stream-json`（裸的类型化对象，不是 JSON-RPC）；抓取人类可读 stdout 只是降级路径，首批两个适配器都没有用到它。参考仓库、许可证边界和本机已验证参数见 `CLI_REUSE_STRATEGY.md`。
- 定义事件与状态归约（属于 `src/core/agentProtocol.ts`）：事件类型、`delta` / `snapshot` 文本语义、回合隔离、transcript 归约都在 core，面板只渲染归约结果。首批两个适配器实测都是 `delta`。
- 决定历史行长什么样（属于 `src/core/agentHistory.ts`）：`seq` 怎么数、回填的 runId 怎么标记、哪几行需要写回，都是纯函数；hook 只负责什么时候读、什么时候写。
- 直接 `invoke()`（属于 `src/platform/agentCli`）。

会话面板现在是真的能对话的（`CLI-2` / `CLI-3`），而且对话是真的被记住的（`CLI-4`）：协议层（`CLI-0`）、进程底座（`CLI-1`）、Codex 与 Claude Code 两个适配器、五个会话命令与两个历史命令都在，输入框只在 provider 未检测到时禁用。仍然不许假装的一件事：**读不到历史时必须说出来并停掉这一次挂载的写**，不能让新消息盖掉一行读不出来的旧记录。`provider_for` 没有分支的 provider id 依旧被 `NotInstalled` 明确拒绝，不许挑一个适配器凑上去。`npm run test:architecture` 断言输入框不再是 `<textarea disabled`、旧的"运行时未接入"文案已删除。


## 5. 依赖方向

推荐依赖方向：

```text
shared <- core
core <- platform
shared + core <- workbench
shared + core + platform + workbench <- features
```

更具体地说：

- `features/*` 可以依赖 `core`、`platform`、`shared`、`workbench`，也可以引用 `src/ui/zh` 取中文文案。
- `workbench` 只能依赖 `core` 和 `shared`。它不依赖 `ui`、`platform`，也不依赖任何 feature 内部实现。
- `core` 不依赖 `features`。
- `core` 不依赖 React。
- `platform` 不依赖 UI。
- 插件只通过 `core` 暴露的 API 接入，不直接 import 具体 feature 内部文件。

禁止方向：

- `core` import `src/ui/*`。
- `core` 直接调用 Tauri。
- `workbench/*` import `src/ui/*`、`src/platform/*` 或 `src/features/*`。
- `features/library` 直接 import `features/reader` 内部组件。
- 插件直接写 SQLite。
- UI 组件直接拼 SQL、直接操作文件系统或直接调用 `invoke()`。

## 6. 核心数据边界

### 6.1 当前业务实体

当前已存在：

- `PaperDocument`
- `paper_files`
- `notes`
- `annotations`
- `ai_threads`
- `ai_messages`
- `tags`

短期内继续保留这些表和类型，保证当前功能稳定。

### 6.2 目标关系模型

中期引入：

- `KnowledgeObject`
- `Relation`
- `knowledge_objects`
- `relations`

迁移原则：

- 不推倒当前业务表。
- 先由现有表生成对象和关系快照。
- 再逐步把新增功能写入统一对象和关系 API。
- 最后再考虑数据库层的关系表迁移。

### 6.3 关系系统 API 边界

后续应形成统一 API：

```ts
createObject(input)
updateObject(id, patch)
deleteObject(id)
restoreObject(id)

createRelation(sourceId, targetId, type, metadata)
updateRelation(id, patch)
deleteRelation(id)
getRelations(objectId, options)
getRelatedObjects(objectId, options)
getRelationPath(sourceId, targetId, options)
```

所有插件、AI、笔记、标注、目录构建都应通过这层 API 接入。

## 7. 工作台架构

### 7.1 场景与标签

工作台的容器是标签页，不是固定页面。内置场景现在作为 `kind: 'tool'` 标签托管在 `TabHost` 里：

- 概览
- 资料库
- 阅读
- AI 对话
- Markdown 笔记

设置是覆盖层，不占标签位。`activeScene` 从当前激活的 tool 标签派生，不是独立状态。

场景现在通过 `SceneContribution` 注册。内置场景和插件场景统一进入 `AsterSceneRegistry`，每个场景可声明 `research`、`workspace` 或 `custom` 域，以及 `enabledByDefault`、插件来源、`sidebarMode`、`defaultSidebarPanel` 和 `supportsOpenItems`。`sidebarMode` 的 `contextual` 值将专属侧栏追加到场景导航下方，`workspace` 值则在点击场景后用该侧栏替换导航列，并由宿主显示返回场景入口。插件必须在 manifest 中申请 `scenes` 权限，才能通过 `context.scenes.register()` 注册场景。前端将启用状态持久化到 `aster.enabledScenes`；停用场景只隐藏入口并在必要时切换到可用场景，不删除已有标签或数据。文献库、阅读、AI 对话和 Markdown 采用 `workspace` 侧栏；阅读侧栏显示当前打开的 PDF 标签，文献库和 AI 侧栏暂时保持空白，后续插件可复用同一契约。

内置场景同样必须走插件激活：`createAsterCore` 初始化空场景注册表，再激活各场景插件。UI 视图通过 `SceneViewRegistry` 注册，场景专属文件树等内容通过 `SceneSidebarViewRegistry` 注册；外部插件只接受签名校验后的 `declarative-v1` JSON，由宿主渲染受控块，不能直接注入任意 React/HTML 或执行脚本。

已实现的标签种类：`tool`、`file`、`agent`。已在类型里预留但未实现：`pdf`、`markdown`、`terminal`、`diff`、`plugin:*`。

后续新增：

- 笔记 / 知识库
- 目录 / 关系图
- 项目 / 课程
- 插件贡献标签

新增标签种类的步骤见 `WORKSPACE_BASELINE.md` 第 4.1 节。

### 7.2 面板

面板通过 `WorkbenchPanelContribution` 注册。

当前已有：

- `library.details`
- `reader.notes`
- `reader.annotations`
- `reader.chat`
- `reader.relations`

后续插件也应通过同一机制贡献面板。

### 7.3 命令面板

命令面板应作为全局入口。

命令来源：

- core 命令
- 工作台面板命令
- feature 命令
- 插件命令

命令需要声明：

- id
- label
- group
- source
- shortcut
- visibleInPalette

## 8. 插件架构边界

插件运行时已支持 manifest、权限、官方签名、完整性校验、市场索引、手动导入、启停/重载生命周期和 `declarative-v1` 受控视图协议；外部插件不执行任意脚本。

插件可贡献：

- 命令
- 设置项
- 工作台面板
- AI Provider
- 元数据源
- 翻译源
- 后续对象类型和关系类型

插件不能：

- 直接操作 SQLite。
- 直接删除用户文件。
- 绕过资料库 API 修改核心数据。
- 覆盖核心命令 ID。

插件数据必须记录来源，例如：

```text
plugin:{plugin_id}
```

## 9. AI Provider 边界

AI 通过 `AiProviderContribution` 和 `runAiProvider()` 接入。

Provider 不应该直接读取 UI 状态，而应接收结构化上下文：

- 当前知识对象
- `KnowledgeGraphSnapshot`
- 用户消息
- 可用笔记、标注、关系

AI 输出如果要保存为笔记、标注、关系，必须通过受控 API 写入。

当前 Provider：

- `local-context-assistant`
- `codex-cli`：规划中
- `claude-code-cli`：规划中

## 10. PDF 标注边界

阅读器标注系统必须稳定优先。

核心要求：

- 原文和译文按 `file_id` 独立标注。
- 高亮和下划线基于文字选择。
- 区域框选保留自由区域。
- 便签支持拖动和基础文本样式。
- 删除、键盘删除、撤销、重做稳定。
- 标注不能因为点击、切换工具、刷新局部状态而消失。
- 标注保存后必须能重启恢复。

后续高级能力：

- 标注搜索和筛选。
- 批量标注操作。
- 标注导出。
- 标注生成笔记。
- 从笔记回跳 PDF 标注。

## 11. 协作开发规则

### 11.1 新功能放哪里

- 导入、标签、表格：`features/library`
- PDF 渲染、标注：`features/reader`
- 文件树、文件预览：`features/explorer`
- Agent 会话面板、Provider 检测：`features/agents`
- Markdown 和双链：`features/notes`
- AI 对话和 Provider：`features/ai`
- 设置、备份、诊断：`features/settings`
- 关系面板、对象查询：`core/relations` 和后续 `features/relations`
- 工作台外壳、导航、标签：`src/workbench`（不得引入 `ui/`、`platform/`、`features/`）
- 项目/工作区/标签/会话的模型与迁移：`src/core/workspace.ts`
- 资源身份与 URI 规范化：`src/core/resources.ts`（唯一一份 URI 语法，Rust 侧只存不算）
- Tauri 命令包装：`src/platform/*`，React 组件不直接 `invoke()`
- 通用按钮、弹窗、表格、chip：`shared/ui`

当前代码还没完全拆分前，新增代码也应尽量按这些边界命名和组织，不继续把全部逻辑塞进 `App.tsx`。

### 11.2 修改大文件规则

`App.tsx` 和 `PdfReader.tsx` 已经很大。修改时应遵守：

- 不做无关格式化。
- 一次只改一个行为闭环。
- 修改后补验证脚本。
- 能抽纯函数就先抽到 `core`。
- 能抽 UI 组件就抽到对应 feature 或 shared。

### 11.3 模块导出规则

每个模块应尽量只暴露一个稳定入口，避免其它模块直接 import 内部实现文件。

推荐：

```text
features/library/index.tsx
features/reader/index.ts
features/explorer/index.ts
features/agents/index.ts
features/notes/index.ts
features/ai/index.ts
features/settings/index.tsx
workbench/index.ts
platform/index.ts
platform/projects/index.ts
platform/agentCli/index.ts
platform/workbench/index.ts
shared/ui/index.ts
```

外部模块优先从 `index.ts` 引入公开 API。模块内部文件可以自由组织，但不应被跨模块直接引用。

示例：

```ts
// 推荐
import { LibraryScene } from "../features/library";

// 不推荐
import { LibraryScene } from "../features/library/components/LibraryScene";
```

这个规则的目的不是形式化拆目录，而是保护模块边界。只要公开入口稳定，模块内部就可以重构而不影响其它功能。

### 11.4 模块通信规则

模块之间不应互相调用内部状态。优先通过以下机制通信：

- `commands`：跨模块动作，例如导入 PDF、打开阅读、追加笔记。
- `events`：跨模块通知，例如文献导入完成、标注创建完成。
- `repositories`：读写资料库数据。
- `KnowledgeObject / Relation`：表达对象和关系。
- `WorkbenchPanelContribution`：贡献工作台面板。
- `AiProviderContribution`：贡献 AI 能力。
- `PluginContext`：插件受控接入。

示例：

```ts
commands.execute("notes.appendAnnotation", {
  annotationId,
  noteId,
});
```

不推荐：

```ts
// 阅读器直接修改笔记组件内部状态
notePanelRef.current.appendAnnotation(annotation);
```

如果某个模块必须知道另一个模块的内部结构，通常说明边界设计错了，应先增加命令、事件或关系 API。

### 11.5 验证规则

常规验证：

```powershell
npm run verify
npm run tauri:build
```

涉及阅读器时至少跑：

```powershell
npm run test:reader
npm run build
```

涉及后端数据库时至少跑：

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

涉及 UI 状态和工作台时至少跑：

```powershell
npm run test:ui-state
```

涉及 `src/core/workspace.ts` 或 `src/workbench/workspaceStore.ts` 时至少跑：

```powershell
npm run test:workspace
npm run test:resources
npm run test:architecture
```

涉及 `src/core/resources.ts`、`schema.sql` 或 `src-tauri/src/workbench_store.rs` 时至少跑：

```powershell
npm run test:resources
npm run test:architecture
cargo test --manifest-path src-tauri\Cargo.toml workbench_store
```

涉及 `src/core/agentProtocol.ts`、`src/core/agentHistory.ts`、`src-tauri/src/agent_cli/` 或 `src-tauri/src/agent_history.rs` 时至少跑：

```powershell
npm run test:agent-protocol
npm run test:architecture
cargo test --manifest-path src-tauri\Cargo.toml
```

改了 Agent 事件名或字段名要**同时**改两侧（TS 与 Rust），`npm run test:architecture` 会逐个事件断言两边同名。它同时守着进程层的几条不变量：四个被剥离的父会话环境变量名、`SHELL_METACHARACTERS` / `CREATE_NO_WINDOW` / `resolve_program`、`ChildTransport` 实现 `AgentTransport` 且 tree-kill、进程层不碰 JSON、supervisor 不自己分帧也不认识 `rusqlite` / `tauri::`，以及两个适配器的方言细节与最小权限兜底（五个 agent 命令都已注册、输入框不再是 `<textarea disabled`）。历史那一侧守的是墙本身：两个命令在 `state_commands.rs` 且都是 `#[tauri::command(async)]`、`agent_bridge.rs` 里既没有 `rusqlite` 也没有 `agent_history`、`agent_history.rs` 里没有 `tauri::`、`agent_messages` 没有指向 `agent_sessions` 的外键而 `workbench_store` 在快照事务里调 `prune_orphans`、UPSERT 不改 `created_at`。

`P2-1` 之后同一个脚本还守着后端的形状：`lib.rs` 里不许出现 `#[tauri::command]`、`rusqlite`、`params!` 或 `Connection`，行数必须小于 160，十三个领域模块都得在模块表里，且 `generate_handler!` 的每一个条目都必须写成 `模块::命令` —— 少了最后这条，一个命令体可以悄悄搬回 crate 根还照样被注册。

资源身份反过来只能有**一份**：边界脚本断言 `src/core/resources.ts` 是纯 core、导出规范化与 `resourceKey` / `resourceTabKey`，`workspace.ts` 从 `./resources` 导入而不是自己再实现，`App.tsx` 用 `resourceTabKey` 开文件标签，而 `workbench_store.rs` 里**没有** `normalize_uri`、`schema.sql` 的 `resources_uri` 索引**不是** UNIQUE。

`npm run verify` 必须从 PowerShell 运行：`scripts/verify-all.mjs` 在 win32 上用 `cmd.exe` 包装每一步。

## 12. 近期重构路线

### Step 1：稳定当前闭环

- PDF 标注。
- 删除/撤销/重做。
- 原文/译文独立标注。
- 导入和译文绑定。
- 标签和资料库表格。

### Step 2：抽前端边界

- 第一刀先抽 `features/library`：资料库表格、标签墙、导入弹窗、详情面板。
- 第二刀抽 `features/settings`：设置页、诊断、备份恢复、插件设置。
- 第三刀抽 `features/ai`：独立 AI 场景、阅读器 AI 面板、Provider 选择。
- 第四刀抽 `features/reader`：PDF 阅读器外层状态、标注列表、工具栏。
- 第五刀拆 `PdfReader.tsx` 内部：PDF 渲染、文本层、标注层、便签、快捷键。
- 保留 `core` 纯函数和注册表。

第一刀选择 `features/library` 的原因：

- 资料库 UI 相对独立。
- 风险低于阅读器。
- 能快速降低 `App.tsx` 复杂度。
- 不影响 PDF.js 和标注核心链路。

### Step 3：关系 API 落地

- 当前 `buildPaperKnowledgeGraph()` 继续作为桥接层。
- 增加统一对象和关系 API。
- 后续再迁移数据库。

### Step 4：工作台自由度

- 面板 Host 统一。已完成。
- 命令面板统一。已完成。
- 项目/工作区/标签模型与外壳。已完成，见 `WORKSPACE_BASELINE.md`。
- 布局与标签状态持久化到 SQLite（`PWS-1`）。已完成：`src-tauri/src/workbench_store.rs` + `src/platform/workbench/`，非桌面运行时回落到 `localStorage`。
- 后续分屏与拖拽停靠。未开始，当前只有单行 tab strip。

### Step 5：插件和 AI

- 插件命令和面板。
- 插件设置。
- AI Provider runner。
- 后续真实 CLI/API Provider。

## 13. 当前不做的事

当前阶段不做：

- 完整插件市场。
- 云同步。
- 多人协作。
- 移动端。
- 完整拖拽 Docking。
- 完整在线论文数据库自建。
- 大规模 Agent 系统。

这些是长期规划，但不应压过当前本地可用闭环和关系系统底座。

## 14. 成功标准

短期成功标准：

- 用户能稳定导入 PDF。
- 用户能阅读原文和译文。
- 用户能创建、删除、撤销、恢复标注。
- 标注重启后仍存在。
- 用户能写笔记并引用标注。
- 文献、PDF、笔记、标注、AI 对话能被关系面板展示。
- 工作台面板和命令面板能作为扩展入口。
- 新功能不继续扩大 `App.tsx` 和 `PdfReader.tsx` 的复杂度。
