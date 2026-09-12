# Aster 主开发方案（面向开发 AI）

> 状态：当前产品与工程开发的权威执行入口。
>
> 优先级：本文件中的产品定位、阶段顺序和模块边界高于旧版 `DEVELOPMENT_TASKS.md` 中以阅读器为中心的阶段顺序。旧文档仍可用于查询已经确认的功能细节，但不得据此改变本文件的主线。

## 1. 开始开发前必须执行

开发 AI 在修改代码前必须：

```powershell
git status --short
rg --files src src-tauri docs/notes
npm run test:architecture
```

然后阅读：

```text
docs/notes/AI_DEVELOPMENT_PLAN.md
docs/notes/ARCHITECTURE.md
docs/notes/CODING_STANDARDS.md
docs/notes/DEVELOPMENT_WORKFLOW.md
docs/notes/WORKSPACE_BASELINE.md
docs/notes/CLI_REUSE_STRATEGY.md
docs/notes/UI_REDESIGN_BASELINE.md
```

涉及 PDF 时额外阅读 `READER_BASELINE.md`；涉及外部 CLI 时额外阅读 `docs/superpowers/specs/2026-07-08-ai-chat-cli-design.md`。

基本约束：

- 不撤销工作区中自己没有创建的修改。
- 不进行全量重写；基于现有 React/Tauri/SQLite 工程渐进迁移。
- 一个任务解决一个明确问题，优先控制在 1 至 3 天内。
- 新能力必须进入所属模块，不继续扩大 `App.tsx`、`nativeApi.ts`、`src-tauri/src/lib.rs`。
- 修改跨模块公共类型、SQLite schema、Tauri 命令或插件 API 时必须增加测试。
- 不伪造已完成能力。没有真实数据模型或后端命令时，不添加只能展示的假入口。

## 2. 产品定位

Aster 是本地优先、可扩展的知识管理工作台，同时提供一等公民级的本地 AI Agent 工作区。

核心模型：

```text
Project -> Workspace -> Tab -> View / Tool / AgentSession
```

- `Project`：用户选择的本地文件夹，也是 CLI Agent 默认工作目录。
- `Workspace`：项目下可恢复的工作上下文，保存标签页、布局和活动会话。
- `Tab`：Agent 对话、PDF、Markdown、文件预览、终端、Diff 或插件视图。
- `AgentSession`：绑定项目工作目录和 Provider 的长期会话，不绑定某篇论文。
- `Resource`：文件、文件夹、PDF、Markdown、网页摘录等通用资源。
- `KnowledgeObject / Relation`：资源、笔记、会话和插件对象之间的统一关联层。

产品核心由以下部分组成：

1. Paseo 风格的项目、工作区、标签页和 Agent 会话工作台。
2. 本地文件与知识资源管理。
3. Codex、Claude Code 等本地 CLI Provider。
4. 可插拔工具系统。

文献管理和 PDF 阅读仍是高频能力，但不再定义整个软件：

```text
通用 PDF 资源 -> 通用 PDF 阅读器

文献插件
  -> 论文元数据、DOI、作者、标签
  -> 原文/译文 PDF 关系
  -> 调用通用 PDF 阅读器
```

## 3. 当前工程状态

已存在并应保留：

- Tauri 2 + React 19 + TypeScript + Vite。
- SQLite 和应用内部文件库。
- PDF.js 阅读器、基础标注、Markdown 笔记。
- 文献导入、元数据、标签和译文 PDF 绑定。
- `core / platform / features / workbench / shared / ui` 模块边界。
- 命令、事件、Provider、设置和工作台面板注册表雏形。
- AI 对话 UI 与本地模拟上下文逻辑。
- UI token、feature CSS 和工作台视觉层。
- `Project / Workspace / Tab / AgentSession` 纯模型（`src/core/workspace.ts`）与工作台外壳（`src/workbench/`）。细节见 `WORKSPACE_BASELINE.md`。
- 项目文件夹选择、只读文件树、文件预览、VS Code / 资源管理器 / 默认应用打开（`src/platform/projects/` + `src-tauri/src/workspace_fs.rs`）。
- Codex / Claude Code CLI 的安装检测（`src/platform/agentCli/`，只检测不启动）。
- Agent CLI 的 Rust 进程底座与两个真实适配器（`src-tauri/src/agent_cli/` + `agent_bridge.rs`，`CLI-0` ~ `CLI-3`：真实子进程、流式事件、停止与结束进程）。
- 工作台状态的 SQLite 持久化（`src-tauri/src/workbench_store.rs` + `src/platform/workbench/`，旧的 `localStorage['aster.workbench']` 首次运行自动迁入并保留）。
- 通用 Resource 注册与 URI 规范化（`src/core/resources.ts` + `resources` 表，`RES-2`）。生产者是"打开文件标签"，PDF Resource 已由 `PDF-0` 消费，后续消费者为 `AGT-4`。
- Agent 消息历史的 SQLite 持久化（`src-tauri/src/agent_history.rs` + `src/core/agentHistory.ts`，`CLI-4`：挂载时回填，重启后对话还在）。
- 按领域拆分的 Rust 后端（`P2-1`）：`lib.rs` 只剩 97 行的模块表 + `generate_handler!` + `run()`，命令体在 `app_paths` / `database` / `guide` / `diagnostics` / `backup` / `pdf_metadata` / `library_{import,papers,annotations,notes,ai}` / `project_commands` / `state_commands` 里，跨领域端到端测试在 `library_tests.rs`。

当前边界与后续限制：

- 文献能力已通过 `library.core` first-party plugin 提供面板、PDF Resource opener 和可卸载贡献；文献数据/导入仍由核心 repository 管理。
- 终端 / Diff 标签类型已落地：终端使用受限的 executable+args 项目命令，Diff 使用两文件文本对比；暂不支持 shell 脚本和二进制 Diff。

兼容要求：现有文献、PDF、笔记和标注数据不得因为工作台迁移而丢失。

## 4. 目标模块结构

`(已存在)` 表示已经落地的文件；其余是目标位置，不要求一次性搬迁。

```text
src/
  core/
    workspace.ts              # (已存在) Project/Workspace/Tab/AgentSession 纯模型
    types.ts                  # (已存在) 文献、标注、关系、Provider 类型
    types/
      resource.ts
      plugin.ts
    commands/
    events/
    relations/
    providers/

  platform/
    projects/                 # (已存在) 文件夹选择、文件树、外部打开
    agentCli/                 # (已存在) CLI 检测
    workbench/                # (已存在) 工作台快照的 SQLite 适配器
    resources/
    database/
    nativeApi.ts              # (已存在) 兼容入口，逐步变薄

  workbench/
    WorkbenchShell.tsx        # (已存在)
    ProjectSidebar.tsx        # (已存在，含工作区树)
    WorkbenchTopBar.tsx       # (已存在)
    TabStrip.tsx              # (已存在)
    TabHost.tsx               # (已存在)
    CommandPalette.tsx        # (已存在)
    WorkspacePanelHost.tsx    # (已存在)
    workspaceStore.ts         # (已存在)
    useWorkbench.ts           # (已存在)
    workbenchLabels.ts        # (已存在) 文案契约，避免依赖 ui/

  features/
    explorer/                 # (已存在) FileTreePanel + FileTab
    agents/                   # (已存在) AgentSessionPanel + useAgentProviders
    library/                  # (已存在)
    reader/                   # (已存在)
    ai/                       # (已存在)
    settings/                 # (已存在)
    projects/
    notes/
    pdf/
    literature/
    relations/

  shared/
    ui/
    hooks/
    utils/

src-tauri/src/
  lib.rs                      # (已存在) P2-1 之后只有模块表 + generate_handler! + run()
  app_paths.rs                # (已存在) 资料库路径、初始化、跨平台 reveal / 默认程序打开
  database.rs                 # (已存在) 连接与建表、标签规范化、时间戳
  guide.rs                    # (已存在) 内置指南种子
  diagnostics.rs              # (已存在) 诊断信息
  backup.rs                   # (已存在) 备份与恢复
  pdf_metadata.rs             # (已存在) PDF 首页文本猜元数据
  library_import.rs           # (已存在) 导入原文/译文、按 file_id 取字节
  library_papers.rs           # (已存在) 文献列表、元数据、标签、删除
  library_annotations.rs      # (已存在) 标注增删改与撤销恢复
  library_notes.rs            # (已存在) 笔记 upsert
  library_ai.rs               # (已存在) AI 会话与消息
  library_tests.rs            # (已存在) 跨领域端到端测试
  project_commands.rs         # (已存在) 项目文件夹命令
  state_commands.rs           # (已存在) 工作台快照与 Agent 历史命令
  workspace_fs.rs             # (已存在) 项目文件夹、文件树、预览、外部打开、CLI 检测
  workbench_store.rs          # (已存在) 工作台快照的 SQLite repository
  agent_history.rs            # (已存在) agent_messages 仓库
  agent_bridge.rs             # (已存在) Agent 会话命令与 agent://event
  agent_cli/
    mod.rs
    protocol.rs
    transport.rs
    peer.rs
    turn.rs
    launch.rs
    process.rs
    supervisor.rs
    providers/
      codex.rs
      claude.rs
  resources/
  literature/
```

后端这一层已经是"一个领域一个文件"而不是原先设想的 `commands/ database/ files/` 目录：命令、它的 DTO 和它的 database 函数放在同一个模块里，DTO 字段的可见性就只在一个文件里。某个领域涨到几百行以上时再把它变成目录。

这是目标结构，不要求一次性搬迁。每次只在新增能力或明确重构任务中移动相关代码。

依赖方向：

```text
shared <- core
core <- platform
shared + core <- workbench
shared + core + platform + workbench <- features
```

禁止：

- `core` 依赖 React、Tauri 或 feature。
- `workbench/**` import `ui/`、`platform/` 或 `features/`（由 `npm run test:architecture` 逐文件断言）。
- React 组件直接调用 `invoke()`。
- feature 直接解析 CLI stdout/stderr。
- CLI 进程直接写 Aster SQLite。
- 文献模块要求通用 PDF 阅读器必须具有 `paperId`。

## 5. 核心数据模型

> 已实现部分的权威定义在 `src/core/workspace.ts`，说明见 `WORKSPACE_BASELINE.md`。本节保留契约意图；两者不一致时以代码为准，并同步更新本节。

### 5.1 Project

```ts
type ProjectKind = 'folder' | 'builtin';

interface Project {
  id: string;
  name: string;
  rootPath: string;
  kind: ProjectKind;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}
```

规则：

- `rootPath` 是用户明确授权的本地文件夹。
- `kind: 'builtin'` 只给内置资料库使用，`rootPath` 为 `aster://library`，不指向真实目录。
- 同一规范化路径不可重复创建 Project。
- 删除 Project 只移除 Aster 记录，不删除用户文件。

### 5.2 Workspace

```ts
interface WorkspaceLayout {
  fileTreeVisible: boolean;
  rightDrawerVisible: boolean;
}

interface Workspace {
  id: string;
  projectId: string;
  name: string;
  activeTabId?: string;
  layout: WorkspaceLayout;
  tabs: WorkspaceTab[];
  createdAt: string;
  updatedAt: string;
}
```

### 5.3 WorkspaceTab

```ts
type WorkspaceTabKind =
  | 'tool'
  | 'agent'
  | 'pdf'
  | 'markdown'
  | 'file'
  | 'terminal'
  | 'diff'
  | `plugin:${string}`;

interface WorkspaceTab {
  id: string;
  workspaceId: string;
  kind: WorkspaceTabKind;
  key: string;
  title: string;
  resourceId?: string;
  sessionId?: string;
  state: Record<string, JsonValue>;
  pinned: boolean;
  order: number;
}
```

`key` 是去重键：重复打开同一资源只激活已有标签。`tool` 是过渡 kind，用于把 overview / library / reader / aiChat 四个既有场景托管进标签，等它们各自迁移为真实资源标签后再收敛。已实现的 kind 只有 `tool` / `file` / `agent`。

### 5.4 AgentSession

```ts
type AgentProviderId = 'codex' | 'claude' | 'local' | `plugin:${string}`;
type AgentSessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'failed' | 'closed';

interface AgentSession {
  id: string;
  projectId: string;
  workspaceId: string;
  providerId: AgentProviderId;
  providerSessionId?: string;
  modelId?: string;
  permissionMode: 'default' | 'autoReview' | 'fullAccess';
  status: AgentSessionStatus;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
}
```

状态机由 `agentSessionTransitions` 定义，非法迁移被拒绝并返回未变更的 state。恢复时处于 `starting` / `running` / `stopping` 的会话一律恢复为 `failed`。

这里只有会话状态，没有回合状态：一次回合结束是 `running -> idle`，会话可以继续对话；`closed` 才是会话自身的终态，且允许 `closed -> starting` 以支持恢复（`CLI-4`）。`idle -> running` 合法，因为进程是否还活着只有 supervisor 知道，模型不去编码存活性，只拒绝明显荒谬的迁移（如 `closed -> running`）。回合完成由 `src/core/agentProtocol.ts` 的 `AgentEvent` 表达，见第 7 节。

### 5.5 Resource

```ts
type ResourceKind = 'file' | 'folder' | 'pdf' | 'markdown' | 'image' | 'web' | `plugin:${string}`;

interface Resource {
  id: string;
  projectId?: string;
  kind: ResourceKind;
  uri: string;
  title: string;
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}
```

已落地于 `src/core/resources.ts`（纯 core）与 `src/core/workspace.ts` 的注册表。三条规矩：

- `uri` 永远是 `normalizeResourceUri` 的输出，这个函数**幂等**，`resourceKey(uri)` 就是去重身份（`file:`/`aster:` 折叠大小写，web 只折叠 scheme 与 host）。
- URI 语法只有 TypeScript 一份。Rust 原样存 `uri`，`resources_uri` 索引故意不是 UNIQUE —— 去重是模型职责，模型出 bug 应该表现为一行重复记录，不是一次失败的保存。
- 标签用 `resourceTabKey(uri)` 作 key，所以一条路径的两种写法不会开出两个标签；删资源只解绑标签，不关标签。

PDF 标注绑定 `resourceId/fileId + page + position`，不得只绑定 `paperId`。文献插件通过 Relation 将 `paper` 与 PDF Resource 关联。

## 6. SQLite 增量方案

新增表建议（六张现在都已经在 `src-tauri/schema.sql` 里：前五张随 `PWS-1` / `RES-2`，`agent_messages` 随 `CLI-4`）：

```text
projects
workspaces
workspace_tabs
resources
agent_sessions
agent_messages
```

旧的 `ai_threads / ai_messages` 暂时保留。迁移步骤：

1. 新表增量创建，不删除旧表。
2. 新 Agent 工作台只写新表。
3. 提供一次性兼容映射，把无项目的旧会话放入“旧版资料库”虚拟 Project。
4. 完成回归验证后再讨论旧表退役，不在首轮迁移中删除。

每个 schema 改动必须：

- 使用增量迁移。
- 在已有数据库上重复运行不会失败。
- 增加 Rust round-trip 测试。
- 明确外键删除策略。**明确"没有外键"也算明确**：`agent_messages` 就故意没有指向 `agent_sessions` 的外键，因为工作台快照整表重写 `agent_sessions`，级联删除会让拖一次标签就删光所有对话；孤儿行改由 `agent_history::prune_orphans` 在同一个事务里扫掉。

## 7. Agent CLI 统一协议

必须复用成熟仓库的进程与事件处理经验，具体规则见 `CLI_REUSE_STRATEGY.md`。

许可证边界（不可越过）：`getpaseo/paseo` 是 AGPL-3.0，只能作为只读设计参考，禁止复制代码；`pingdotgg/t3code` 是 MIT，可保留归属后复用代码；协议上游 `openai/codex` 与 `agentclientprotocol/agent-client-protocol` 是 Apache-2.0。

契约已落地（`CLI-0`）：前端侧在 `src/core/agentProtocol.ts`（纯类型 + 纯 reducer），Rust 侧在 `src-tauri/src/agent_cli/`（`protocol.rs` 分帧与错误、`transport.rs` stdio 抽象与内存夹具、`peer.rs` 请求关联、`turn.rs` 回合隔离）。两侧字段名一致（Rust 用 camelCase 序列化），事件跨 Tauri 边界不需要二次翻译。

进程底座也已落地（`CLI-1`）：`launch.rs`（启动配置、父会话环境变量剥离、Windows shim 与注入防护）、`process.rs`（真实 `Child` 传输 + tree-kill 阶梯）、`supervisor.rs`（一个会话一个线程、runId 铸造、排队、取消、退出清理）。`ProviderSession` trait 是留给适配器的唯一接缝：适配器只翻译某一种 CLI 的协议，不拥有传输、pump 循环和 runId。第一个适配器与 Tauri 命令已随 `CLI-2` 落地：`providers/codex.rs` + `agent_bridge.rs`（五个命令、单一 `agent://event` 频道）。

历史是这条链的最后一段（`CLI-4`）：`src/core/agentHistory.ts` 把 transcript 与 `agent_messages` 的行互相映射（纯函数，和 `agentProtocol.ts` 同一层），`src-tauri/src/agent_history.rs` 只存不算。它有意不挂在 `agent_bridge.rs` 上——那是 CLI 那一侧的墙，CLI 永远不该有办法碰到 Aster 的数据库。

前端只调用统一接口：

```ts
interface AgentProviderAdapter {
  detect(): Promise<AgentProviderStatus>;
  start(request: StartAgentSessionRequest): Promise<StartAgentSessionResult>;
  send(request: SendAgentMessageRequest): Promise<AgentRunHandle>;
  stop(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}
```

统一事件：

```ts
type AgentEvent =
  | { type: 'started'; sessionId: string; runId: string }
  | { type: 'delta'; sessionId: string; runId: string; content: string }
  | { type: 'tool'; sessionId: string; runId: string; payload: JsonValue }
  | { type: 'completed'; sessionId: string; runId: string }
  | { type: 'stopped'; sessionId: string; runId: string }
  | { type: 'failed'; sessionId: string; runId: string; error: AgentError };
```

`completed` 是**回合**结束，不是会话结束：会话本身回到 `idle`（见第 5.4 节）。`AgentError` 一次带全 `kind` / `message` / `detail` / `exitCode` / `signal`，一次终止只合成一个错误交给所有等待者，不是每个 pending 请求各报一次。

进程规则：

- Rust/Tauri 管理子进程生命周期。
- React 不保存 Child Process 句柄。
- 每次运行有独立 `runId`，旧运行事件不得污染新运行；早于 `startTurn` 返回的事件先缓冲再重放，`runId` 不匹配的事件丢弃。
- **优先使用结构化协议**：Codex 用 `codex app-server` 的 stdio JSON-RPC，Claude Code 用 `--output-format stream-json`，其他 CLI 用 ACP。抓取人类可读 stdout 只是协议不可用时的降级路径，必须显式标记为降级。
- stdout 按 JSONL 分帧（去行尾 `\r`，容忍并忽略非 JSON 行）；stderr 只保留尾部片段用于补充错误信息，不作为事件流。
- 应用退出、关闭标签、停止运行时必须清理子进程；本机 `codex` / `claude` 都是 npm shim，必须 tree-kill，不能只杀直接子进程。
- 启动子进程前剥离父会话环境变量（`CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SSE_PORT`、`CLAUDE_AGENT_SDK_VERSION`），否则 CLI 会拒绝在另一个会话内启动。
- 命令参数必须基于本机安装版本和参考仓库验证，不凭记忆硬编码。本机已验证事实记在 `CLI_REUSE_STRATEGY.md` 第 3 节。
- `fullAccess` 必须由用户明确选择；默认使用保守权限。
- working directory 必须限制在当前 Project 或用户明确选择的目录。

首批 Provider：

1. Codex CLI。
2. Claude Code CLI。

Copilot、OpenCode、Pi 等进入后续阶段，不与首批 Provider 并行扩张。

## 8. 插件边界

核心提供扩展点：

- Commands
- Events
- Settings
- Workbench panels
- Tab/view contributions
- Agent providers
- Resource openers
- Metadata providers
- Translation providers

第一版插件为本地可信插件，但仍需声明：

```text
id
version
entry
permissions
contributions
```

插件不能：

- 直接写 SQLite。
- 绕过 Resource API 删除文件。
- 冒充 core 命令或 Provider。
- 在未声明权限时启动进程或访问任意路径。

文献管理作为内置插件/模块实现，通用 PDF 阅读器作为内置工具实现。

## 9. UI 工作台基线

> 已落地。实际结构、插槽契约和禁止复活的旧类名见 `WORKSPACE_BASELINE.md` 第 3 节。

参考 Paseo 的信息组织和轻量感，但不逐像素复制。

目标结构：

```text
左侧项目/工作区树
  + 顶部工作区标题和操作
  + 中间多标签工作区
  + 可选右侧工具抽屉
```

左侧栏：

- 搜索/命令入口。
- 本地 Project 列表。
- Project 下的 Workspace 和 Agent 会话入口。
- 设置入口固定在底部。

顶部：

- 当前 Project/Workspace。
- 打开 VS Code。
- 在系统资源管理器中打开文件夹。
- 显示/隐藏项目文件树。
- 新建 Agent 对话并选择 Provider。
- 不放解释性说明文字。

中间：

- 标签页可打开 Agent、PDF、Markdown 和文件预览。
- 标签状态持久化。
- 当前阶段不做完整 VS Code docking；先做单行 tab strip 和一个可选右侧抽屉。
- 所有打开的标签保持挂载并用 CSS 隐藏，切换标签不重挂 PDF 或聊天状态。

视觉规则见 `UI_REDESIGN_BASELINE.md`：连续画布、低对比边界、少阴影、小圆角、紧凑控件、安静的中性色。

## 10. PDF 与文献模块边界

### 通用 PDF 工具

负责：

- 通过 Resource 打开 PDF。
- PDF.js 渲染、缩放、页码、文本层。
- 标注和标注回跳。
- 可选的笔记/AI 右侧抽屉。

不负责：

- DOI、作者、期刊等论文元数据。
- 原文/译文的论文语义。
- 文献标签和 BibTeX。

### 文献插件

负责：

- 文献导入和元数据。
- DOI、作者、年份、期刊、标签。
- source/translated PDF 关系。
- BibTeX/RIS/CSV 等导入导出。
- 调用通用 PDF 工具打开关联资源。

现有阅读器不得立即重写。先增加 `resourceId` 适配层，再逐步移除内部对 `paperId` 的强依赖。

## 11. 分阶段开发路线

### 阶段 A：方案与边界稳定

状态：已完成。

任务：

- `A-1` 确立本主计划和文档优先级。已完成。
- `A-2` 明确参考 CLI 仓库、许可证和可复用部分。已完成，见 `CLI_REUSE_STRATEGY.md`：参考 `getpaseo/paseo`（AGPL-3.0，只读设计参考）和 `pingdotgg/t3code`（MIT，可按条件复用），协议上游是 Apache-2.0 的 `openai/codex` 与 `agentclientprotocol/agent-client-protocol`。阶段 D 已解除阻塞。
- `A-3` 确认 Aster/A4Note 产品命名，不在确认前批量改名。已确认对外用 A4Note，见 `A4NOTE_BRAND_NAMING.md`。
- `A-4` 修复源文件和文档中的编码问题。已完成（含 `src-tauri/src/lib.rs` 的残留乱码）。

退出标准：所有新任务都引用本计划，产品定位不再以文献为唯一中心。

### 阶段 B：工作台核心模型

依赖：阶段 A。

任务 `PWS-0`：定义纯 TypeScript 模型。**Done。**

影响：

```text
src/core/workspace.ts
src/workbench/workspaceStore.ts
scripts/verify-workspace-model.mjs
```

验收：Project、Workspace、Tab、AgentSession 可创建、排序、关闭、恢复；纯逻辑测试通过。已通过 `npm run test:workspace`。

任务 `PWS-1`：SQLite 持久化。**Done。**

影响：

```text
src-tauri/schema.sql
src-tauri/src/workbench_store.rs
src-tauri/src/lib.rs
src/platform/workbench/
src/workbench/useWorkbench.ts
src/main.tsx
scripts/verify-workspace-model.mjs
scripts/verify-architecture-boundaries.mjs
```

验收：重启应用后 Project、Workspace、活动标签恢复；删除 Project 不删除磁盘文件。只替换 `WorkbenchStorage` 适配器，不改调用方。

落地形态：命令边界搬运 `serializeWorkbenchState()` 的 JSON 文本，Rust 侧解析成类型化记录后单事务全量重写五张表；`platform/workbench` 自己声明 `WorkbenchSnapshotStorage`，`main.tsx` 在首帧前 await 快照并调用 `configureWorkbenchStorage`。不在桌面运行时或读取失败时回落到 `localStorage` 默认适配器。细节见 `WORKSPACE_BASELINE.md` 第 6、8 节。

任务 `PWS-2`：WorkbenchShell。**Done。**

影响：

```text
src/workbench/
src/features/explorer/
src/features/agents/
src/ui/App.tsx
src/ui/styles/workbench.css
src/ui/styles/layout.css
```

验收：左侧项目树和 tab strip 使用真实 store；原有场景通过兼容 TabHost 打开；不复制原有业务状态。已通过 `npm run verify`。

### 阶段 C：项目与文件资源

可与 `PWS-2` 部分并行，但依赖 `PWS-0`。

任务：

- `RES-0` 选择本地文件夹并创建 Project。**Done。**
- `RES-1` 文件树只读浏览、刷新、展开和打开文件。**Done。**
- `RES-2` 通用 Resource 注册与 URI 规范化。**Done**（`src/core/resources.ts` 单点持有 URI 语法；注册表按 `resourceKey` 去重；`resources` 表落库，索引故意不是 UNIQUE）。
- `RES-3` 打开 VS Code、系统文件夹和外部默认应用。**Done。**

验收：Project 使用真实目录；大目录采用懒加载；无权限和路径失效有明确错误状态。`RES-0/1/3` 已满足，细节见 `WORKSPACE_BASELINE.md` 第 8 节。

### 阶段 D：Agent CLI 进程底座

依赖：`PWS-0`、`RES-0`、`A-2`（已完成，参考仓库与协议选型见 `CLI_REUSE_STRATEGY.md`）。

任务 `CLI-0`：统一协议和测试夹具。**Done。**

- CLI 安装检测。`detect_agent_cli`（Rust）+ `src/platform/agentCli/`（前端），返回命令、版本、可执行文件路径或失败原因。只检测，不启动。
- 统一契约。前端 `src/core/agentProtocol.ts`：`AgentEvent` 联合、`AgentError`（`kind` / `message` / `detail` / `exitCode` / `signal`）、`AgentProviderAdapter`、`delta` 与 `snapshot` 两种文本模式、`AgentRunState` reducer、`AgentRunGate` 缓冲与重放。Rust `src-tauri/src/agent_cli/`：`protocol.rs`（JSONL 分帧去 `\r`、容忍非 JSON 行、camelCase 事件、8 KiB stderr 尾部按字符边界截断）、`transport.rs`（`AgentTransport` trait + `InMemoryTransport`/`FakePeer` 夹具）、`peer.rs`（`id` 关联、可选截止时间、终止只合成一个错误并 fail-all）、`turn.rs`（`RunGate` 回合隔离）。
- `AgentSessionStatus` 语义修正：`idle | starting | running | stopping | failed | closed`。回合结束是 `running -> idle`，`completed` 只作为回合事件存在；`closed -> starting` 留给 `CLI-4` 恢复。`schema.sql` 与 `workbench_store.rs` 不需要改（`status` 存字符串）。
- 影响文件：`src/core/agentProtocol.ts`（新增）、`src/core/workspace.ts`、`src/features/agents/AgentSessionPanel.tsx`、`src/ui/zh.ts`、`src-tauri/src/agent_cli/`（新增 5 个文件）、`src-tauri/src/lib.rs`（只加 `pub mod agent_cli;`）、`scripts/verify-agent-protocol.mjs`（新增）、`scripts/verify-workspace-model.mjs`、`scripts/verify-architecture-boundaries.mjs`、`scripts/verify-all.mjs`、`package.json`。
- 边界（`CLI-0` 当批）：不注册任何 Tauri 命令，不启动真实进程，`AgentSessionPanel` 的输入框仍然禁用。真实进程、环境变量剥离和 tree-kill 属于 `CLI-1`；命令与可用输入框属于 `CLI-2`（已解除）。
- 验收：`cargo test` 40 passed（其中 `agent_cli` 18 个：分帧跨 chunk 与 `\r\n`、空行与非 JSON 行、错误帧带 provider code、无换行收尾的 flush、stderr 字符边界截断、事件 camelCase 往返、请求关联、流式通知顺序、只有带截止时间的请求会超时、非零退出一个错误发给所有等待者、stdin 关闭后丢弃通知并拒绝请求、未知响应 id 只记为 notice、干净退出仍解出最后一帧、`RunGate` 缓冲/重放/丢弃）、`npm run test:agent-protocol`、`npm run test:workspace`、`npm run test:architecture` 全通过。

任务 `CLI-1`：Rust Process Supervisor。**Done。**

- 在已有的 `src-tauri/src/agent_cli/` 上补了三个文件，`protocol.rs` / `transport.rs` / `peer.rs` / `turn.rs` 全部照原样复用，没有另起一套分帧。
- `launch.rs`：`LaunchConfig` + `build_command()`，所有不碰进程表就能失败的检查都在 spawn 之前完成；`STRIPPED_ENV_VARS` 删掉 `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` / `CLAUDE_AGENT_SDK_VERSION`；Windows 上非 `.exe` 走 `cmd /C`（npm shim 的三件套），因此命令名和每个参数都过 `SHELL_METACHARACTERS` 检查并**拒绝**而不是转义；`CREATE_NO_WINDOW` 避免闪黑框；Unix 侧 `process_group(0)`；`resolve_program()` 按 `PATH` / `PATHEXT` 先查一次，否则 `cmd /C <missing>` 会启动成功而让 `NotInstalled` 在 Windows 上不可达。
- `process.rs`：`ChildTransport` 实现同一个 `AgentTransport` trait，只搬运行、不认 JSON；读取各占一个线程（`read` 必须能超时，阻塞管道读做不到），stdout 按行读避免半个多字节字符被 lossy 转换毁掉中文；停止是阶梯 stdin EOF → reap → 软 tree-kill → 强制 tree-kill → 兜底 `kill`（Windows `taskkill /T`，Unix 负 pid 进程组），退出锁存，`Drop` 保证不留活着的 CLI。
- `supervisor.rs`：一个会话一个线程，控制消息进、`AgentEvent` 出；runId 由 supervisor 铸造成 `{session_id}-{n}`（回合可能在 CLI 回答前就失败，而 `conversationId` 这类句柄命名的是会话），Provider 自己的句柄只用于识别过期帧；握手跑在调用者线程上所以 `NotInstalled` / 握手失败是 `Err` 而不是事件；回合中途来的消息排队；`stop()` 先问 Provider 能不能取消，不能才本地收尾；`is_running` 看 `AtomicBool`，`close` / `close_all` / `impl Drop` 负责应用退出清理。
- `ProviderSession` trait（`launch` / `connect` / `handshake` / `begin_turn` / `run_id` / `cancel_turn` / `translate` / `on_payload`）+ `SessionIo` 是留给适配器的接缝，适配器拿不到底层传输。`CLI-2` 的 `providers/codex.rs` 是第一个实现，`CLI-3` 的 `providers/claude.rs` 是第二个，落地时这一层一行没改。
- 影响文件：`src-tauri/src/agent_cli/{launch,process,supervisor}.rs`（新增）、`src-tauri/src/agent_cli/mod.rs`、`scripts/verify-architecture-boundaries.mjs`。`lib.rs` **没有再动**。
- 边界（`CLI-1` 当批）：仍然不注册任何 Tauri 命令，`AgentSessionPanel` 输入框仍然禁用；会话只能从 Rust 侧驱动，UI 没有途径到达它。命令跟第一个适配器一起来——`CLI-2` 已解除这一条。
- 验收：`cargo test` 58 passed（其中 `agent_cli` 36 个，新增 18 个：launch 5 / process 4 / supervisor 9），`npm run test:architecture` 与 `npm run verify` 全通过，三个新文件 `rustfmt --check` 干净。

任务 `CLI-2`：Codex Adapter。**Done。**

- `providers/codex.rs` 是第一个 `ProviderSession`（`CLI-1` 留下的接缝）：只翻译 Codex 的协议，不自己拿传输、不自己管 runId。走 `codex app-server` 的 v2 `thread/*` + `turn/*` JSON-RPC（本机 `codex-cli 0.146.0`，schema 由 `codex app-server generate-json-schema` 导出，对照 Apache-2.0 上游 `openai/codex → codex-rs/app-server-protocol/`），不解析交互式 stdout。
- 方言里四件必须处理的事：`turn/start` 在任何 update 之前就返回 turn id，所以流可能比响应先到（`awaiting_turn` 采纳第一个看到的 id）；服务端帧不带 `jsonrpc` 且多一个 `emittedAtMs`；一次失败会被播报两遍（`willRetry:false` 的 `error` + `status:"failed"` 的 `turn/completed`），而重试的 error 长得几乎一样，所以适配器锁定回合、只发一个终止事件，重试只作为 `{kind:"retry"}` 通知出现；中断由 codex 自己以 `status:"interrupted"` 收尾。
- 权限即沙箱：`thread/start` / `thread/resume` 直接收 `approvalPolicy` 与 `sandbox` 两个参数（**不需要** `-c` config 覆盖）。`approvalPolicy` 恒为 `"never"`，`sandbox_for` 把 `default` / `autoReview` / `fullAccess` 映射到 `read-only` / `workspace-write` / `danger-full-access`，未知模式取最小权限。CLI 仍然发来的审批请求被回 JSON-RPC error 并在 transcript 里显示。
- `agent_bridge.rs` 是运行时与 Tauri 唯一的接缝，注册了**五个**命令而不是原计划的三个：`start_agent_session` / `send_agent_message` / `stop_agent_session` / `close_agent_session` / `agent_session_running`。`stop`（结束这一轮）与 `close`（结束会话）必须分开，否则关标签会漏子进程；`agent_session_running` 是因为 UI 状态会过期，重新挂载时必须问运行时。四个会阻塞的命令是 `#[tauri::command(async)]`；`register` 在 `.setup()` 里建 sink 并 `app.manage`；`shutdown` 挂在 `RunEvent::Exit`，因为 Tauri 的退出路径不跑析构函数。事件走单一频道 `agent://event`。
- 前端：`agentProtocol.ts` 增加 `toAgentError` 与 transcript 归约（仍是纯函数），`platform/agentCli/agentSession.ts` 做 invoke 包装，`features/agents/useAgentSession.ts` 管一个会话的运行时（面板卸载不杀 CLI、重新挂载采纳已在跑的进程、乐观 prompt、resume 失败退回新会话一次、`send` 被拒后回滚并复查进程），`AgentSessionPanel` 换成真实 transcript + 可用输入框，权限下拉在进程活着时禁用（沙箱启动时就定下）。删除会话会先结束进程。
- 影响文件：`src-tauri/src/agent_cli/providers/{mod,codex}.rs`（新增）、`src-tauri/src/agent_bridge.rs`（新增）、`src-tauri/src/agent_cli/mod.rs`、`src-tauri/src/lib.rs`（`mod agent_bridge;` + 五个命令 + `register` + `RunEvent::Exit` 上的 `shutdown`）、`src/core/agentProtocol.ts`、`src/platform/agentCli/*`、`src/features/agents/*`、`src/ui/{App.tsx,zh.ts}`、`src/ui/styles/workbench.css`、`scripts/verify-{architecture-boundaries,agent-protocol}.mjs`。
- 边界：`CLI-2` 当批 transcript 只在内存里（历史由 `CLI-4` 补上）；`CLI-2` 当批选到 `claude` 的会话被 `NotInstalled` 拒绝（`CLI-3` 已解除这一条）；`agent_cli/` 里没有 `tauri::`，CLI 依旧写不到 Aster 的 SQLite。
- 验收：`cargo test` **82 passed**（`agent_cli` 57，其中 `providers::codex` 17；`agent_bridge` 3），`npm run verify` 全绿，`verify-architecture-boundaries.mjs` 里"还没有命令、输入框仍禁用"的三条断言已翻成正面断言。
- 仍需桌面手动验证：在装了 codex 的机器上跑 `npm run tauri:dev`，验证工作目录、权限、流式输出、停止、失败恢复和退出无残留进程。

任务 `CLI-3`：Claude Code Adapter。**Done。**

- 走 `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose`（本机 `2.1.220`）。`--verbose` 是这条组合的必需项；**没有 `--cwd`**，工作目录只由 spawn 决定。
- 复用同一协议与 supervisor，一行没改：`providers/claude.rs` 是第二个 `ProviderSession`，加上 `agent_bridge::provider_for` 的一个分支就是全部改动。接缝够用这件事至此被第二个适配器验证过了。
- 方言不是 JSON-RPC。帧是裸的、按行分隔的类型化对象，只有 `type`，既没有 `id` 也没有 `method`，所以它们以 `RpcFrame::Payload` -> `PeerNotice::Payload` 到达适配器的 `on_payload`，不走请求关联。
- 没有握手可答：第一条用户消息之前 CLI 一个字都不写，所以开会话不花模型调用。`handshake` 改成盯住刚起来的进程 500 ms —— 拒了 flag 或没登录的进程会在窗口内退出，否则会话会看起来已启动、直到用户发第一条消息才失败。
- 回合没有名字：一条 `{"type":"user",...}` 进去，`system` / `stream_event` / `assistant` / `result` 回来。适配器自己铸 `claude-turn-{n}` 并返回 `TurnStart::Known`，`run_id()` 永远不该被调用。
- **原计划这一条是错的**：它不是快照式文本。`--include-partial-messages` 转出的是 Anthropic 自己的 `text_delta` 真增量，所以 `textMode` 报 `delta`。随后那条 `assistant` 全量帧是同一段话的重复，按 **message id** 抑制（一个回合可能有多条消息，按回合抑制会漏掉没流过的那条）。
- `system`/`init` 每回合都重发，并带着 `--resume` 需要的 `session_id`，所以 `ProviderHandle::publish` 是幂等的；这个句柄也从 codex 专用的 `CodexHandle` 提升成两个适配器共用的类型。
- 停止是控制协议：`{"subtype":"interrupt"}` 出去、一条 `control_response` 回来，**由这条回答结束回合**（按我们自己记下的 `request_id` 匹配），而不是赌中断后还会有 `result`。
- 权限映射：`default -> manual`、`autoReview -> acceptEdits`、`fullAccess -> bypassPermissions`，未知模式回落 `manual`（取最小，绝不取最大）。`can_use_tool` 一律回 `behavior:"deny"` 加一句给模型的说明并在 transcript 里记 `approvalDenied`；其他 subtype 也必须答（回 `subtype:"error"`），否则它后面那一轮会一直等下去。
- 工具通知复用 UI 已有词汇（`Bash*` -> `commandExecution`、`Edit`/`Write`/`NotebookEdit` -> `fileChange`、`Web*` -> `webSearch`、`TodoWrite` -> `todoList`、`mcp__*` -> `mcpToolCall`、其余 -> `toolUse`），所以 `zh.ts` 只多了一个词条；失败的 `tool_result` 复用调用时那个 kind 加 `status:"failed"`，不发明新 kind。
- 影响文件：`src-tauri/src/agent_cli/providers/claude.rs`（新增）、`providers/mod.rs`、`providers/codex.rs`（只补测试模块缺的 `use std::sync::{Arc, Mutex};`）、`src-tauri/src/agent_bridge.rs`、`src/ui/zh.ts`、`scripts/verify-architecture-boundaries.mjs`。运行时与 `lib.rs` 注册段都没动。
- 验收：`cargo test` **100 passed**（新增 18 个 `providers::claude`），`npm run test:architecture` / `npm run test:agent-protocol` / `npm run verify` 全绿。
- 仍需桌面手动验证：`npm run tauri:dev` -> 新建 Claude Code 会话 -> 流式回答 -> 停止这一轮 -> 结束进程 -> 退出后无残留 `claude` 进程。

任务 `CLI-4`：会话持久化。**Done。**

- 一行一次交换，主键 `(session_id, seq)`。`seq` 只数"已经开过 run 的回合"，所以它连续、可以就地 UPSERT，也不需要为 `AgentTurn` 发明一个它本来没有的配对键。排队中还没被 CLI 看见的消息不落库——写进去等于伪造，而且它拿到 run 之后会把后面每一条的 seq 全部挤位。
- 命令落在数据库那一侧而不是 `agent_bridge.rs`：那个模块是 CLI 那一侧的墙，永远不许碰 Aster 的 SQLite。新增 `src-tauri/src/agent_history.rs` 作仓库，`load_agent_messages` / `save_agent_messages` 两个 `#[tauri::command(async)]` 与 `workbench_store` 同一种接法（当时挂在 `lib.rs`，`P2-1` 之后搬到 `state_commands.rs`，仍在墙的同一侧）。
- `agent_messages` **故意不是** `agent_sessions` 的外键子表：工作台快照每次保存都整表重写那张表，`ON DELETE CASCADE` 会让拖一次标签就删光所有对话。真正没了的会话由 `agent_history::prune_orphans` 在同一个事务里扫掉，一致性照旧。
- 写是"只写变了的行"：`agentMessageDigest` 不含时间戳，并把 runId 归一化过再算，所以打开一个会话一行都不重写。唯一例外是被应用退出打断的那一行（状态 `running`），回填时修成 `stopped` 并正好写回一次——否则 `isAgentTranscriptBusy` 永远为真，输入框会卡在一个已经没有进程可停的回合后面。
- 回填的 runId 必须带 `#restored{seq}` 标记，存回去时再剥掉：`run_id` 是 supervisor 的进程内计数器（`{sessionId}-{n}`），重启后新一轮完全可能与历史同名，不标记就会把新答案流进旧回合（还会撞 React key）。
- 读失败会说出来（`zh.workbench.agentHistoryUnavailable`）并停掉这一挂载的写：没有"已存了什么"的基线，新回合的 seq 可能盖掉一行读不出来的真实记录。写失败只是不标记那一行，下一次 transcript 变化自然重试。
- 写侧是节流不是防抖：延迟从上一次写起算，所以流一分钟的回答中途也在存，而不是只在它停下来时才存；一轮刚结束立刻冲一次，退出前那条答案不会丢。
- 影响文件：`src-tauri/src/agent_history.rs`（新增）、`src-tauri/schema.sql`、`src-tauri/src/workbench_store.rs`（快照事务里扫孤儿）、`src-tauri/src/lib.rs`、`src/core/agentHistory.ts`（新增，纯函数）、`src/platform/agentCli/{agentHistory.ts,index.ts}`、`src/features/agents/useAgentSession.ts`、`src/ui/zh.ts`、`scripts/verify-{architecture-boundaries,agent-protocol,core-smoke}.mjs`。
- 验收：`cargo test` **115 passed**（新增 `agent_history` 10、`workbench_store` 2），`npm run verify` 全绿。`verify-core-smoke.mjs` 里那条 `paper_file_path_from_database` 断言改成容忍换行——`lib.rs` 这次过了 rustfmt。
- 仍需桌面手动验证：`npm run tauri:dev` -> codex 与 claude 各跑一轮 -> 停止这一轮 -> 结束进程 -> 重启应用确认对话回来 -> 退出后无残留进程。

退出标准：Codex 和 Claude 至少各完成一次桌面端真实手动验证。

### 阶段 E：Agent 工作区 UI

依赖：阶段 B、D。

任务：

- `AGT-0` 新建/选择 Agent Provider。**Done**（顶栏按 Provider 新建会话，检测不到时禁用并说明原因）。
- `AGT-1` AgentSession tab 与消息流。**Done**（随 `CLI-2`：标签、会话面板、进程底座、Codex 适配器、五个 Tauri 命令和真实 transcript 都在）。
- `AGT-2` streaming、停止、重试、错误和空状态。**Done**：流式文本、停止、错误和空状态均可见；失败回合提供“重试这一轮”并重发原始 prompt。
- `AGT-3` 会话历史与 Workspace 恢复。**Done**：会话记录与标签绑定随 `PWS-1` 持久化并在重启后恢复（运行中的会话恢复为 `failed`），消息历史随 `CLI-4` 落 `agent_messages` 并在挂载时回填。
- `AGT-4` `@resource` 上下文选择。**Done**：Agent 面板从当前项目 Resource 注册表选择资源，发送时附带稳定的 `@resource(id)`、标题和规范化 URI；重复资源按 id 去重，未声称 CLI 已读取文件内容。

验收：Agent 不依赖当前论文；新会话必须选择 Project/working directory；关闭标签不丢历史。

`AgentSessionPanel` 现在是真的能对话的（`CLI-2` / `CLI-3`），而且对话是真的被记住的（`CLI-4`）：输入框只在 provider 未检测到时禁用，`codex` 与 `claude` 两种会话都能真的跑，重启后历史回填。剩下不许假装的一件事——读不到历史时必须说出来并停写，不能让新消息盖掉读不出来的旧记录。`provider_for` 之外的 provider id 依旧被明确拒绝，不许挑一个适配器凑上去。

### 阶段 F：通用 PDF 与笔记工具

依赖：`RES-2`（Done）、TabHost。

任务：

- `PDF-0` Reader 输入从 Paper 适配为 PDF Resource。**Done**：`PdfReader` 只接收 `PdfDocumentSource`；文献阅读器和文件树 PDF 分别通过 `paperPdfSource` / `resourcePdfSource` 适配，Resource PDF 以只读标签打开。
- `PDF-1` 标注使用 resource/file ID。**Done**：文献标注继续使用旧 `annotations` 表的 `paper_id + file_id`，通用 PDF 使用独立 `resource_annotations` 表和 Resource ID CRUD；两条数据链互不混用。
- `PDF-2` PDF tab 状态恢复。**Done**：PDF Resource 标签将 zoom/page 写入 WorkspaceTab.state，重挂载时恢复并持续同步。
- `NOTE-0` Markdown Resource 多标签编辑和自动保存。**Done**：Markdown Resource 标签加载文本、编辑并以 500ms debounce 调用安全 native 写入命令，显示保存状态。
- `NOTE-1` 标注引用 `@annotation(id)` 回跳。**Done**：Markdown 阅读视图将有效标注引用渲染为可点击控件，点击后聚焦对应 Reader 标注。

保留已确认功能：原文/译文/并排同步、统一右侧抽屉、完整标注工具目标、多 Markdown 笔记。

### 阶段 G：文献插件迁移

依赖：阶段 F。

任务：

- `LIT-0` 文献模块通过 Resource/Relation API 管理 PDF。**Done**：PDF Resource 适配器和 Paper Relation API 已统一 Reader/Library 的 PDF、笔记、标注关系视图。
- `LIT-1` 译文 PDF 关系迁移。**Done**：译文文件以 `derived_from` 关系连接原文，文件 ID 和标注链保持隔离。
- `LIT-2` 文献库作为插件视图/工具 tab。**Done**：`library.details` 面板和 `library.pdf` Resource opener 由自动加载的 `library.core` first-party plugin 提供，dispose 会移除其贡献。
- `LIT-3` 保证旧数据库兼容。**Done**：现有 schema 可重复应用，旧 annotations/notes/import 数据回归测试通过。

退出标准：禁用文献模块后，通用 Project、Agent、PDF 和 Markdown 仍可使用。

### 阶段 H：插件系统增强

依赖：核心 API 稳定。

- 插件 manifest 和权限声明。
- Tab/view/resource opener 贡献。
- Agent Provider 插件贡献。
- 插件卸载清理和错误隔离。
- 后续再考虑签名、沙箱和市场。

当前进度：插件运行时已经支持 manifest（版本、身份、权限）校验、权限策略、SHA-256 完整性校验、RSA-SHA256 detached signature 验证、Resource opener/Tab view 贡献、Provider 贡献、卸载清理和激活失败回滚；本地插件目录状态模型、市场索引解析/缓存、签名密钥轮换/撤销和设置页信任状态已落地。插件进程只允许进入 Windows Job Object、Linux bubblewrap 或 macOS sandbox-exec；找不到后端时 fail-closed。远程市场服务部署、OS 文件级 AppContainer 策略和密钥托管仍属于产品运维工作。

## 12. 可并行任务分配

模型和公共接口先行，UI 不得在接口未确认时自建重复模型。

推荐并行工作流：

```text
Lane 1: Workbench/Core
  PWS-0 (Done) -> PWS-1 (Done) -> RES-2 (Done)

Lane 2: Native/Resources
  RES-0 (Done) -> RES-1 (Done) -> RES-3 (Done) -> RES-2 (Done)

Lane 3: Agent Runtime
  CLI-0 (Done) -> CLI-1 (Done) -> CLI-2 (Done) -> CLI-3 (Done) -> CLI-4 (Done)

Lane 4: UI System
  Workbench 外壳 (Done) -> 工作台视觉细化 -> Agent UI

Lane 5: Existing Tools
  Reader regression fixes and Resource adapter preparation
```

冲突控制：

- 同一时间只允许一个任务大改 `App.tsx`。
- `src/core/types.ts` 和 `src/core/workspace.ts` 由 Workbench/Core owner 控制合并窗口。
- `src-tauri/src/lib.rs` 只做模块注册，不继续堆新实现。`P2-1` 已经把它拆到位：2799 行 → 97 行，命令体都在拥有那几张表的领域模块里（`app_paths` / `database` / `guide` / `diagnostics` / `backup` / `pdf_metadata` / `library_import` / `library_papers` / `library_annotations` / `library_notes` / `library_ai` / `project_commands` / `state_commands`）。这条规则从此是被测试守着的，不只是约定：`npm run test:architecture` 断言 `lib.rs` 里没有 `#[tauri::command]`、没有 `rusqlite`/`params!`/`Connection`、行数小于 160，且每个注册条目都写成 `模块::命令`。争用只剩"各自加一行注册"。
- schema 迁移和 Rust repository 由同一 PR 负责，避免契约错位。
- UI System 只改 token/shared/workbench 样式；feature 样式由 feature owner 修改。
- `workbench/**` 的任何新 import 都要过 `npm run test:architecture`：它禁止 `ui/`、`platform/`、`features/`。

## 13. 每个 AI 任务的标准模板

```text
任务 ID：
目标：
前置依赖：
允许修改：
禁止修改：
公共接口：
行为验收：
错误/空状态：
测试：
验证命令：
风险与回滚：
```

开发 AI 的执行顺序：

1. 检查 git 状态和相关模块。
2. 复述任务边界，不重新设计整个产品。
3. 先写或更新测试/验证脚本。
4. 实现最小完整闭环。
5. 运行要求的验证。
6. 检查 diff，不提交无关格式化或生成物。
7. 报告修改、验证、已知风险和下一依赖。

## 14. 验证矩阵

普通前端/类型改动：

```powershell
npm run build
npm run test:architecture
```

工作台模型（`src/core/workspace.ts` / `workspaceStore.ts`）改动：

```powershell
npm run test:workspace
npm run test:resources
npm run test:ui-state
npm run verify
```

状态、工作台外壳、Reader、导入或数据改动：

```powershell
npm run verify
```

Rust/Tauri/CLI 改动：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

桌面工作流改动：

```powershell
npm run tauri:dev
```

`npm run verify` 必须从 PowerShell 运行：`scripts/verify-all.mjs` 在 win32 上用 `cmd.exe` 包装每一步，POSIX shell 里会报 `spawn cmd.exe ENOENT`。

必须手动验证：

- Project 文件夹选择和失效路径。
- Workspace/tab 重启恢复。
- Codex/Claude 检测、发送、流式输出、停止和错误。
- 关闭应用后无残留 CLI 子进程。
- PDF 打开、标注恢复和引用回跳。
- 浅色/深色及窄窗口下无明显遮挡。

## 15. Definition of Done

任务只有同时满足以下条件才算完成：

- 行为符合任务验收标准。
- 没有绕过模块边界。
- 数据迁移可重复执行且兼容旧数据。
- 正常、空、加载、错误、不可用和停止状态可见。
- 对应自动验证通过。
- 需要桌面环境的流程完成手动验证。
- 文档或公共类型发生变化时同步更新契约。
- PR 只包含任务相关修改，不包含构建产物和个人数据。

## 16. 当前下一批任务

已完成（不要重做）：

```text
A-1   主计划与文档优先级
A-2   参考 CLI 仓库、许可证与可复用范围（见 CLI_REUSE_STRATEGY.md）
A-3   A4Note 命名确认
A-4   源文件与文档编码修复
PWS-0 Project/Workspace/Tab/AgentSession 纯模型
PWS-1 工作台状态持久化到 SQLite（含旧 localStorage 快照迁移）
PWS-2 WorkbenchShell + ProjectSidebar + TabStrip + TabHost
RES-0 选择本地文件夹并创建 Project
RES-1 只读文件树与文件预览标签
RES-3 VS Code / 资源管理器 / 默认应用打开
AGT-0 按 Provider 新建 Agent 会话（含 CLI 检测）
CLI-0 Agent CLI 统一协议、错误类型、回合隔离与内存 stdio 夹具
CLI-1 launch/process/supervisor：真实子进程传输、环境剥离、tree-kill 阶梯、会话线程
CLI-2 Codex 适配器（codex app-server）+ 五个 agent Tauri 命令 + 真实 transcript 与输入框
CLI-3 Claude Code 适配器（claude -p 的 stream-json，非 JSON-RPC 方言）
AGT-1 AgentSession tab 与消息流
RES-2 通用 Resource 注册与 URI 规范化（resources.ts + resources 表 + verify-resource-model）
CLI-4 Agent 消息历史落 SQLite 并在挂载时回填（agent_messages + agentHistory.ts）
P2-1  按领域拆分 src-tauri/src/lib.rs（2799 行 -> 97 行，13 个领域模块 + library_tests.rs）
```

按顺序执行：

1. 插件安全/目录基础、沙箱启动边界、远程索引缓存和密钥轮换/撤销已完成；下一步是接入正式市场服务、OS 文件级策略和密钥托管。

`RES-2` 之后，"一个标签指向什么"终于有了稳定答案：URI 语法只在 `src/core/resources.ts` 里有一份，Rust 只存不算；去重和标签键都按 `resourceKey`，所以 `D:\a\B.pdf` 与 `d:/a/b.pdf` 只会开一个标签；`resources_uri` 索引故意不是 UNIQUE，模型出 bug 会变成一行重复记录而不是一次失败的保存。`PDF-0` 已将 PDF Resource 接入通用 Reader，注册表的下一个消费者是 `AGT-4`；在此之前不加"资源库"面板。

`CLI-4` 之后 Agent 这条线的能力是完整的：装了 `codex` 或 `claude` 的机器上都可以从输入框一路跑到流式回答，重启应用后对话回填，未知 provider id 仍被 `NotInstalled` 明确拒绝。纪律换了一条：历史是真的了，所以读不到历史时必须说出来并停写这一挂载，不能让新消息覆盖读不出来的旧记录。`scripts/verify-architecture-boundaries.mjs` 现在断言的是正面：五个会话命令加两个历史命令都注册了、输入框不再是 `<textarea disabled`、旧的"运行时未接入"文案已删除、两个适配器的权限兜底都取最小档、`agent_bridge.rs` 里既没有 `rusqlite` 也没有 `agent_history`（CLI 那一侧的墙还在）。

`P2-1` 之后后端不再有“谁都要改同一个文件”的地方：`lib.rs` 只有模块表、`generate_handler!` 和 `run()`，命令体跟着它操作的表走。这一批全是搬动 —— 靠的是 crate 根里的私有项对所有后代模块本来就可见，所以出门时改成 `pub(crate)` 恰好保住原可达范围，调用点一个没动，`cargo test` 前后都是 115 个。新加的三条断言（`lib.rs` 里没有 `#[tauri::command]` / 没有 `rusqlite` / 行数上限 160，且注册条目必须写成 `模块::命令`）把“不要再堆回去”从约定变成了会挂验证的事实。跨领域的那 5 个端到端测试整块留在 `library_tests.rs`：它们横跨导入、标签、笔记、标注、AI 会话，按模块拆开测恰好会停止覆盖那道接缝。

### 当前追加任务：场景插件化与 Agent 协作规范

状态：`In Progress`（2026-08-29）

用户已确认所有场景统一按模块/插件方式管理，并要求不同 Agent、不同时间接手时遵守同一套规范。该任务的执行入口为：

- `docs/notes/DEVELOPMENT_HANDBOOK.md`：稳定的开发、插件化和交接规范。
- `docs/notes/AGENT_STATUS.md`：人类可读的当前进度和交接摘要。
- `plans/PROJECT_STATUS.json`：机器可读的状态快照。

已完成第一步：`overview`、`reader`、`aiChat` 通过 `builtinScenePlugins.ts` 走插件生命周期，`library.core` 与 `markdown.core` 在插件激活时注册自己的场景；`SceneContribution` 已支持 `sidebarMode`、`supportsOpenItems` 和 `defaultSidebarPanel`；内置 React 视图通过 `workbench/sceneViews.tsx` 的 `SceneViewRegistry` 装配。后续必须继续把场景专属侧栏贡献和 feature 视图下沉到各自插件模块，不得把新的场景分支写回 `App.tsx`。

验收要求：`npm run test:agent-status`、`npm run test:architecture`、`npm run build` 和完整 `npm run verify` 均通过；每次交接同步更新状态文件。该任务完成前不重新打包 exe。

## 17. 多端同步（当前主线）

服务器设计稿见 `docs/notes/MULTI_PLATFORM_SYNC_SERVER_DESIGN.md`，客户端执行计划见 `plans/2026-08-15-multi-platform-sync-client.md`。当前已完成客户端同步底座：`src/core/sync.ts` / `syncCoordinator.ts` 定义协议和离线状态机，`src/platform/sync/` 封装 HTTP 与 SQLite 边界，Rust 增加 `sync_state`、`sync_outbox`、`sync_conflicts` 并保证笔记写入和 outbox 入队同事务。代码审查已补上并发锁、本地未上传编辑保护、非法响应拒绝和游标回退保护。服务器尚未落地且协调器尚未接入应用生命周期前，不标记“多端同步完成”；下一依赖是按 `server/openapi.yaml` 实现账号、设备和 notes API，再接入设置页和手动同步入口。
