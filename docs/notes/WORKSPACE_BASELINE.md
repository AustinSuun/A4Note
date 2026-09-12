# A4Note 工作台基线（Project / Workspace / Tab / AgentSession）

> 状态：已落地能力的权威描述。产品方向和阶段顺序见 `AI_DEVELOPMENT_PLAN.md`；视觉语言见 `UI_REDESIGN_BASELINE.md`；PDF 阅读器约定见 `READER_BASELINE.md`。
>
> 本文只描述**已经实现**的结构与约束。计划中但尚未实现的能力集中在第 9 节，实现前不得在界面上提前加入口。

## 1. 适用范围

改动以下任一位置前必须先读本文：

```text
src/core/workspace.ts
src/core/agentProtocol.ts
src/workbench/**
src/features/explorer/**
src/features/agents/**
src/platform/projects/**
src/platform/agentCli/**
src/platform/workbench/**
src-tauri/src/workbench_store.rs
src-tauri/src/agent_cli/**
src-tauri/src/agent_bridge.rs
src/ui/styles/workbench.css
src/ui/App.tsx 中的外壳装配部分
```

## 2. 产品模型

```text
Project -> Workspace -> Tab -> View / Tool / AgentSession
```

- `Project`：一个本地文件夹（`kind: 'folder'`），也是 Agent 会话的默认工作目录。内置资料库是唯一的 `kind: 'builtin'` 项目，`rootPath` 为 `aster://library`，不指向真实目录。
- `Workspace`：项目下可恢复的上下文，持有 `layout`、`tabs` 和 `activeTabId`。一个项目可以有多个工作区。
- `WorkspaceTab`：工作区里的一个标签页，由 `key` 去重、由 `pinned` + `order` 排序。
- `AgentSession`：绑定项目工作目录和 Provider 的长期会话，不绑定某篇论文；关闭标签不会删除会话。

模型规则：

- 同一规范化路径（统一分隔符、去尾斜杠、小写）不能重复创建 Project。
- 删除 Project 只删除 A4Note 记录，绝不动磁盘文件。
- 删除 Project 会连带删除它的 Workspace 和这些 Workspace 下的 AgentSession。
- 删除 AgentSession 会连带关闭绑定它的标签页。

## 3. 界面结构

```text
┌──────────────┬─────────────────────────────────────────────┐
│ ProjectSide  │ WorkbenchTopBar                             │
│ bar          ├─────────────────────────────────────────────┤
│              │ TabStrip                                    │
│  品牌        ├───────────┬─────────────────────────────────┤
│  工具入口    │ FileTree  │ TabHost                         │
│  项目/工作区 │ Panel     │   （+ 覆盖层：设置）            │
│  命令/设置   │ (可选)    │                                 │
└──────────────┴───────────┴─────────────────────────────────┘
```

`WorkbenchShell` 只负责这张网格，插槽由 `App.tsx` 填充：

```ts
interface WorkbenchShellProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  tabStrip: ReactNode;
  explorer?: ReactNode;   // 有值时外层类名切到 workbench-shell with-explorer
  content: ReactNode;
  overlay?: ReactNode;    // 覆盖在 TabHost 之上，当前用于设置
  dialogs?: ReactNode;
}
```

### 3.1 左侧 ProjectSidebar

自上而下：品牌区 -> 工具入口（概览 / 资料库 / 阅读 / AI 对话）-> 项目列表 -> 底部命令面板与设置入口。

- 项目行可展开，展开后显示该项目的工作区；工作区行显示会话数量。
- 工作区支持双击重命名（内联 input）、删除；项目支持新建工作区、删除。
- 不使用 icon-only 竖排导航栏；侧边栏是带文字的信息栏。

### 3.2 顶栏 WorkbenchTopBar

- 面包屑：当前项目 / 当前工作区。
- 文件树开关（只对 `kind: 'folder'` 的项目可用）。
- 在 VS Code 中打开、在资源管理器中打开。
- 新建 Agent 会话：按检测到的 Provider 分别给按钮，检测不到时按钮禁用并给出原因。
- 顶栏不放解释性说明文字。

### 3.3 TabStrip

单行标签，横向滚动且不显示滚动条。支持：

- 点击激活、关闭。
- pin：固定标签排在前面，标题用斜体表示。
- 拖拽换位：拖动中的标签是 `.dragging`，落点标签是 `.drop-target`。

当前阶段不做 VS Code 式分屏和拖拽停靠，只有单行 tab strip 加一个可选右侧抽屉。

### 3.4 TabHost

**所有打开的标签同时挂载**，非激活标签用 `opacity` / `pointer-events` / `visibility` 隐藏。这样切回标签时 PDF 渲染状态、滚动位置和聊天输入都不会丢。

代价：标签越多同时挂载的组件越多。需要重资源的标签（未来的终端、Diff）必须自己做惰性内容，而不是靠 TabHost 卸载。

没有标签时 TabHost 渲染 `fallback` 空状态：

- 有工作区但没有标签 -> 提示打开资料库。
- 连工作区都没有 -> 提示添加项目文件夹。

### 3.5 文件树与设置

- 文件树是 `features/explorer/FileTreePanel`，位于标签内容区左侧，由工作区的 `layout.fileTreeVisible` 控制。
- 设置是覆盖层（`.workbench-overlay`），不是独立场景，也不占标签位。

## 4. 标签页种类

`WorkspaceTabKind` 目前实现了三种，其余是预留：

| kind | key 形式 | 内容 | 状态 |
| --- | --- | --- | --- |
| `tool` | `tool:overview` / `tool:library` / `tool:reader` / `tool:aiChat` | 四个既有场景 | 已实现 |
| `file` | `file:${path}` | `features/explorer/FileTab` 文本预览 | 已实现 |
| `agent` | 会话 id | `features/agents/AgentSessionPanel` | 已实现（codex / claude 可真实对话；消息历史随 `CLI-4` 落 SQLite） |
| `pdf` / `markdown` / `terminal` / `diff` / `plugin:*` | - | - | 预留，未实现 |

`App.tsx` 的 `renderTabContent(tab)` 按 `tab.kind` 分发，未知 kind 返回 `null`。不要为未实现的 kind 加占位界面。

### 4.1 新增一种标签的步骤

```text
1. 在 core/workspace.ts 的 WorkspaceTabKind 里确认 kind（已预留的直接用）。
2. 组件放进对应 features/ 模块，不放 workbench/。
3. App.tsx 里加一个 renderTabContent 分支，并给出稳定的 key。
4. 需要持久化的视图状态走 store.updateTabState(tabId, patch)，不要自建 state 容器。
5. 在 scripts/verify-ui-state.mjs 里补断言。
```

## 5. 派生的 activeScene

`activeScene` **不是**独立状态，而是从当前激活的 tool 标签派生：

```ts
const activeScene = activeTab?.kind === 'tool' ? sceneFromToolTabKey(activeTab.key) : null;
```

因此焦点落在 file / agent 标签时 `activeScene` 为 `null`，阅读器快捷键自然失效，不需要额外判断。`lastSceneRef` 保留最后一个具体 `SceneId`，供 `saveUiState` 持久化使用。

不要新增一个与标签并行的 scene state：两份真相会立刻不同步。

## 6. 状态与持久化

- 纯模型：`src/core/workspace.ts`。无 React、无 Tauri、无 storage，所有决策都在这里。
- 存储与订阅：`src/workbench/workspaceStore.ts`。只保存快照、写存储、通知订阅者。
- React 接入：`src/workbench/useWorkbench.ts`，基于 `useSyncExternalStore`，单实例共享 store。

当前存储适配器（`PWS-1`，已完成）：

```text
桌面运行时  src/platform/workbench/  -> load_workbench_state / save_workbench_state -> SQLite
浏览器/失败 workspaceStore 自带的 localStorage 默认适配器（key 仍是 aster.workbench）
```

- 边界只搬运 `serializeWorkbenchState()` 的 JSON 文本，Rust 侧解析后写入 `workbench_state / projects / workspaces / workspace_tabs / resources / agent_sessions`，读回时再序列化成同一形状。模型形状的唯一权威仍在 `src/core/workspace.ts`。
- `read()` 保持同步：快照在 `src/main.tsx` 的 bootstrap 里 await 一次后缓存，因此首帧之前状态已经就位（`App.tsx` 看到空工作台就会播种内置项目，不能让它先看到空的）。
- `write()` 去抖 250 ms 并串行排队，一串标签操作合成一次事务；`beforeunload` 会立刻冲刷未落盘的快照。
- 首次运行会把旧的 `localStorage['aster.workbench']` 迁进 SQLite，并**保留**原 key，便于回退。
- SQLite 读取失败或不在桌面运行时，`createWorkbenchStorage()` 返回 `null`，store 保持自己的 localStorage 默认适配器，不会用伪造的空快照覆盖用户状态。
- `platform/` 不 import `workbench/` 的类型：`WorkbenchSnapshotStorage` 在 platform 侧单独声明，靠结构类型对接，依赖方向仍是 `platform -> core`。


无操作即无写入：mutation 在没有变化时返回同一个对象引用，`commit()` 比较引用后直接返回，不通知订阅者也不落盘。新增 mutation 必须保持这个约定。

恢复时的修复规则（`normalizeWorkbenchState`）：

- 丢弃缺 id / 缺 rootPath 的项目，丢弃指向不存在项目的工作区，丢弃指向不存在工作区的会话。
- 解绑指向已消失会话的标签。
- 丢弃 URI 为空、`projectId` 指向不存在项目、或与另一条记录同 `resourceKey` 的资源；旧的 `file:<原始路径>` 标签键改写到 `resourceTabKey` 上（所以一条路径的两种旧写法收敛成一个标签）；指向已消失资源的标签只**解绑**，不关闭 —— 标签的 `state.path` 还在，用户不该因为一条记录消失而丢掉正在看的东西。
- 修复越界的 `activeProjectId` / `activeWorkspaceId` / `activeTabId`。
- `starting` / `running` / `stopping` 的会话恢复为 `failed`：进程不可能跨重载存活，不允许显示成还在跑。

资源身份（`RES-2`）：

- `src/core/resources.ts` 是纯 core，独占 URI 语法。`normalizeResourceUri` 幂等（Windows / UNC / POSIX 路径与 URI 都能进），`resourceKey(uri)` 是去重身份（`file:`/`aster:` 折叠大小写，web 只折叠 scheme 与 host），标签用 `resourceTabKey(uri)` 作 key，所以 `D:\a\B.pdf` 与 `d:/a/b.pdf` 只会开一个标签。
- Rust 侧**不写第二份规范化**：`uri` 由前端算好、原样入库，`resources_uri` 索引故意不是 UNIQUE —— 去重是模型职责，模型出 bug 应该表现为一行重复记录，而不是一次失败的保存（`workbench_store::tests::two_resources_may_share_one_uri` 锁住了这条）。
- `registerResource` 按 `resourceKey` 幂等，只补空缺、不覆盖已有值，什么都没变时返回原 state（即不落盘）。`ResourcePatch` 不含 `uri`：换 URI 就是换资源。删 Project 连带删它的资源，`projectId` 为空的是工作台级的、不跟着走。

会话状态是**会话**的状态，不是回合的状态（`CLI-0` 修正）：

```text
idle | starting | running | stopping | failed | closed
```

一次回合结束是 `running -> idle`，会话可以继续对话；`closed` 是会话自身的终态，且允许 `closed -> starting` 以支持恢复（`CLI-4`）。写入 `completed` 会被 `updateAgentSession` 拒绝——回合完成由 `src/core/agentProtocol.ts` 的 `AgentEvent`（`started` / `delta` / `tool` / `completed` / `stopped` / `failed`）表达。SQLite 侧不需要跟着改，status 只是字符串列。


## 7. 模块边界

```text
shared <- core
core <- platform
shared + core <- workbench
shared + core + platform + workbench <- features
```

对工作台的具体含义：

- `src/workbench/**` **不能** import `../ui/`、`../platform/`、`../features/`。这条由 `scripts/verify-architecture-boundaries.mjs` 逐文件断言。
- 因此文件树、文件预览和 Agent 面板都在 `features/`（它们需要 `platform/`）。
- 因此工作台组件的中文文案通过 props 传入：`App.tsx` 传 `zh.workbench`，契约是 `src/workbench/workbenchLabels.ts` 的 `WorkbenchLabels`。图标同样由 props 传入（`commandIcon` / `settingsIcon` / `TabStripItem.icon`）。
- React 组件不直接 `invoke()`。所有本地能力经由 `src/platform/projects`（文件夹、文件树、外部打开）和 `src/platform/agentCli`（CLI 检测、会话生命周期、`agent://event` 事件订阅）。`features/agents/useAgentSession.ts` 里没有任何 `@tauri-apps` 导入，这条由边界脚本断言。

新增工作台文案时：先加进 `WorkbenchLabels`，再加进 `src/ui/zh.ts` 的 `workbench` 段，不要在 `workbench/` 里写死中文。

## 8. 原生能力

Rust 侧集中在 `src-tauri/src/workspace_fs.rs`，命令通过 `src-tauri/src/lib.rs` 注册：

| 命令 | 用途 | 约束 |
| --- | --- | --- |
| `describe_project_folder` | 判断路径是否存在、是否是目录 | 路径失效要能显示明确状态 |
| `list_directory_entries` | 单层列目录 | 懒加载；跳过生成目录；上限 2000 条，超出返回 `truncated` |
| `read_text_file_preview` | 文件标签预览 | 只读头部 256 KiB；二进制返回 `binary: true` |
| `reveal_path` | 在资源管理器中显示 | 文件通过所在文件夹定位 |
| `open_path_external` | 系统默认应用打开 | - |
| `open_path_in_vscode` | 在 VS Code 中打开 | 走 shell（Windows 是 `.cmd` shim）；命令名做字符白名单校验 |
| `detect_agent_cli` | 检测 CLI 是否安装 | 只检测，不启动 |

被默认跳过的生成目录见 `IGNORED_DIRECTORY_NAMES`（`node_modules`、`target`、`.git` 等）。

工作台快照的读写在 `src-tauri/src/workbench_store.rs`，同样通过 `lib.rs` 注册：

| 命令 | 用途 | 约束 |
| --- | --- | --- |
| `load_workbench_state` | 读回快照 JSON | 从未保存过返回 `null`，调用方保留自己的空状态 |
| `save_workbench_state` | 整份快照写入 | 单事务内先删子表再删父表，再全量插入；不做行级 diff |

两个命令都先调用 `initialize_database`：工作台比资料库先加载，本次启动可能还没跑过 `initialize_library`。

Agent 运行时的命令在 `src-tauri/src/agent_bridge.rs`（`CLI-2`），同样通过 `lib.rs` 注册：

| 命令 | 用途 | 约束 |
| --- | --- | --- |
| `start_agent_session` | 启动并握手一个 CLI 会话 | `async`（握手会阻塞）；连接失败在这里就报错，不做成迟到的事件；返回 `providerSessionId` / `textMode` |
| `send_agent_message` | 排一条用户消息 | `async`；空内容直接拒；run id 随 `started` 事件到 |
| `stop_agent_session` | 结束当前这一轮 | `async`；会话仍然活着，可以接下一条 |
| `close_agent_session` | 结束会话本身 | `async`（要 join 线程）；返回前子进程已经没了 |
| `agent_session_running` | 运行时是否还有这个会话的进程 | 同步；UI 状态可能过期，崩掉的 CLI 在这里答 `false` |

所有事件走单一频道 `agent://event`，payload 自带 `sessionId`。`agent_bridge` 是唯一同时认识 `agent_cli` 和 Tauri 的文件：`agent_cli/` 里没有 `tauri::`，也不认识 `rusqlite`，所以 CLI 永远写不到 Aster 的 SQLite。会话在 `RunEvent::Exit` 上显式 `shutdown`——Tauri 的退出路径不跑析构函数。

`provider_for` 认两个分支：`codex`（`codex app-server` 的 v2 JSON-RPC）和 `claude`（`claude -p` 的 stream-json，裸类型化对象、不是 JSON-RPC）。未知 provider 返回 `NotInstalled` 而不是被当成其中任意一个启动。

工作目录约束：Agent 会话的 `workingDirectory` 只能是当前 Project 的 `rootPath` 或用户明确选择的目录，`agent_bridge` 里用 `workspace_fs::resolve_existing_path` 再复检一次并要求是文件夹；`fullAccess` 必须由用户在会话面板里显式选择，默认是保守权限。权限模式映射到各自 CLI 的档位（codex 的沙箱 `read-only` / `workspace-write` / `danger-full-access`，claude 的 `--permission-mode` `manual` / `acceptEdits` / `bypassPermissions`），未知模式两边都取最小权限。claude 没有 `--cwd`，它的工作目录只能由 spawn 决定。


## 9. 尚未实现（不要提前加入口）

`AI_DEVELOPMENT_PLAN.md` 第 1 节的硬约束：没有真实数据模型或后端命令时，不添加只能展示的假入口。

当前**没有**的能力：

```text
PDF / Markdown / 终端 / Diff 标签                 （PDF-2 / NOTE-0）
插件贡献的标签与 Provider                         （阶段 H）
```

资源注册表已经落地（`RES-2`，见第 6 节），但目前**只有一个生产者**：打开文件标签时 `App.tsx` 顺手注册。消费者要等 `PDF-0`（Reader 吃 PDF Resource）和 `AGT-4`（`@resource` 上下文）—— 在那之前不要加"资源库"面板，它现在还没有用户可见的内容。

两种 CLI 都已经通了：`CLI-0` 落地两侧契约（`src/core/agentProtocol.ts` 与 `src-tauri/src/agent_cli/`），`CLI-1` 落地真实子进程、环境剥离、tree-kill 阶梯和会话 supervisor，`CLI-2` 落地 Codex 适配器、五个 Tauri 命令和会话面板的真实 transcript，`CLI-3` 加上 Claude Code 适配器（运行时一行没改，只在 `provider_for` 加了一个分支），`CLI-4` 把消息历史落进 SQLite 并在挂载时回填。装了 `codex` 或 `claude` 的机器上都可以从输入框一路跑到流式回答，重启应用后对话还在。

`AgentSessionPanel` 现在显示：Provider 检测结果（命令、版本、可执行文件路径或失败原因）、会话状态、工作目录、权限模式选择、真实 transcript（文本 + 工具通知 + 每回合状态），以及可用的输入框。输入框只在 provider 未检测到时禁用；权限下拉在进程活着时禁用，因为沙箱在启动时就定下了。`npm run test:architecture` 断言输入框**不**是 `<textarea disabled`、面板调用 `useAgentSession`、且旧的"运行时未接入"文案（`agentRuntimePending`）已删除。

历史的两条纪律（`CLI-4`，细节见 `AI_DEVELOPMENT_PLAN.md` 第 11 节）：切工作区再切回来仍然是重新采纳同一个进程（`agent_session_running`），回填**不**重启已经结束的进程——被回填的回合按定义已经结束，它的 runId 带 `#restored{seq}` 标记，好让新一轮的事件落不到它身上。读历史失败时面板会明说（`zh.workbench.agentHistoryUnavailable`）并停掉这一次挂载的写：没有基线就写，等于可能盖掉一行读不出来的真实记录。


## 10. 样式约定

- 工作台外壳样式集中在 `src/ui/styles/workbench.css`，页面级基础样式在 `src/ui/styles/layout.css`，颜色和尺寸 token 在 `src/ui/styles/tokens.css`。
- feature 场景保留自己的样式；`workbench.css` 不伸手改场景内部结构，只在末尾提供托管在标签里的场景所需的共同节奏（内边距、阴影收敛）。
- 视觉规则：连续画布、低对比边界、少阴影、小圆角、紧凑控件、安静中性色（见 `UI_REDESIGN_BASELINE.md`）。
- 已删除且不得复活的类名：

```text
.app-shell / .scene-rail / .scene-buttons / .scene-utility-buttons
.scene-button* / .scene-brand* / .workspace / .scene-host
.scene-frame* / .settings-frame
```

## 11. 验证

```powershell
npm run test:workspace         # 纯模型 + 存储适配器（PWS-1）+ 会话状态机
npm run test:resources         # Resource URI 规范化、注册表、标签绑定与脏数据修复（RES-2）
npm run test:agent-protocol    # Agent CLI 事件契约、回合隔离、transcript 归约与历史行映射（CLI-0 / CLI-2 / CLI-4）
npm run test:ui-state          # App.tsx 装配与持久化
npm run test:architecture      # 模块边界与必需文件（含 CLI-1 进程层、CLI-2 适配器与命令、CLI-4 历史存储、RES-2 身份单点的不变量）
cargo test --manifest-path src-tauri\Cargo.toml agent_cli   # 协议层 + 进程层 + 两个适配器（75 个）
npm run verify                 # 全量（含 cargo test：115 个，其中 agent_cli 75、workbench_store 15、agent_history 10、agent_bridge 3）
```

`npm run verify` 必须从 PowerShell 运行：`scripts/verify-all.mjs` 在 win32 上用 `cmd.exe` 包装每一步。

改了工作台模型、外壳装配或原生命令时，先补验证脚本断言，再改实现。





