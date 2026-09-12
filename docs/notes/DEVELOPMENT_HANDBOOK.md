# A4 Note 开发手册

本文档是 A4 Note 的 Agent/开发者协作入口。它规定模块边界、场景插件化、任务交接和验证方式；产品优先级以 [`AI_DEVELOPMENT_PLAN.md`](./AI_DEVELOPMENT_PLAN.md) 为准，实时状态以 [`AGENT_STATUS.md`](./AGENT_STATUS.md) 和 [`../../plans/PROJECT_STATUS.json`](../../plans/PROJECT_STATUS.json) 为准。

## 1. 接手任务前

仓库根目录 `AGENTS.md` 是新 Agent 的最短入口；它只指向本手册、状态快照和标准命令，不复制会变化的项目进度。

每个 Agent 开始工作前按以下顺序检查：

```powershell
Set-Location D:\WorkSpace\Aster
Get-Content -Encoding utf8 docs\notes\AGENT_STATUS.md
Get-Content -Raw -Encoding utf8 plans\PROJECT_STATUS.json
npm run status
git status --short
git diff --stat
```

然后阅读与任务相关的模块文档。至少阅读 `README.md`、`AI_DEVELOPMENT_PLAN.md`、本文档和 `DEVELOPMENT_WORKFLOW.md`；涉及 Reader、工作台、CLI、资源或 UI 时，再阅读对应的 baseline 文档。

工作区已有未提交修改时，不得用 `git reset --hard`、`git checkout --` 或清理命令回滚它们。先确认修改是否与任务相关，再在现有状态上做最小变更。

## 2. 模块职责和依赖方向

```text
core       纯模型、协议、注册表、状态迁移
platform   Tauri/SQLite/文件系统/网络适配器
features   一个业务能力的 UI 和业务协调
workbench  工作台外壳、场景/视图装配、标签和侧栏
shared     可复用 UI、hooks、工具
ui         应用入口和跨模块组合，不承载新业务实现
```

依赖方向应保持为 `ui -> workbench/features -> platform/core`，共享能力只能向下依赖。`core` 不得导入 React、Tauri、浏览器 API 或具体 feature；`workbench` 不得导入 feature、platform 或 `ui`。新增能力应进入所属模块的 `index.ts` 稳定出口。

## 3. 场景插件化规则

所有场景都必须由插件贡献，内置场景也不例外。内置插件使用稳定的命名空间：

```text
overview.core
library.core
reader.core
ai.core
markdown.core
```

场景 ID 是用户可见的稳定标识，插件 ID 是生命周期和设置的归属标识。场景贡献至少说明：

```ts
{
  id,
  label,
  icon,
  key,
  pluginId,
  scope,
  sidebarMode,
  supportsOpenItems,
  defaultSidebarPanel,
}
```

规则如下：

1. `createAsterCore` 只负责激活插件，禁止直接把场景数组注入注册表。
2. 场景插件负责注册自己的场景、设置、命令、资源打开器和工作台面板，并在停用时完整释放贡献。
3. React 视图通过 `src/workbench/sceneViews.tsx` 的 `SceneViewRegistry` 注册。插件元数据和 React 渲染保持分层，`core` 不导入 React。
4. `App.tsx` 只装配状态和上下文，不再增加 `if (scene === ...)` 的新业务分支。新场景必须新增插件定义和视图贡献。
5. 场景专属工具放在场景的 `contextual` sidebar、`workspace` sidebar 或面板贡献中；全局导航只负责选择场景。`workspace` 模式会用场景侧栏替换导航列，并由宿主提供返回场景入口。当前内置的 Markdown、阅读、文献库和 AI 对话均采用此模式：Markdown 侧栏提供文件树，阅读侧栏提供已打开 PDF 标签，文献库和 AI 对话暂留空白区域。后续需要独立侧栏的场景应优先声明 `sidebarMode: 'workspace'`，不得重新增加宿主专用的场景/文件二选一状态。
6. 支持多文档的场景设置 `supportsOpenItems: true`，打开项必须通过稳定的 `WorkspaceTab`/`Resource` 身份管理，切换不能重挂载已有文档。
7. 外部插件第一阶段只允许官方签名包或用户手动导入的已验证包。外部插件不能直接注入任意 React/HTML，必须经过受控视图协议和沙箱边界。

新增场景的标准步骤：

1. 在插件模块中创建 `AsterPlugin` 和 manifest，声明最小权限。
2. 在 `activate` 中注册 `SceneContribution`，必要时注册设置、命令、面板和资源打开器。
3. 在 `src/workbench/sceneViews.tsx` 注册 UI 视图，或实现受控的外部视图适配器。
4. 将场景的专属内容挂到场景贡献的 `contextual`/`workspace` sidebar，不把业务逻辑写回 `ProjectSidebar` 或 `App.tsx`；场景只通过 `sidebarMode` 声明布局方式。
5. 为启用/停用、重复注册、释放贡献和未知场景补测试。
6. 更新 `AGENT_STATUS.md`、任务计划和对应模块文档。

## 4. 协作和交接

每次开始、完成或阻塞任务时都要更新 `docs/notes/AGENT_STATUS.md` 和 `plans/PROJECT_STATUS.json`：

- `updatedAt`：使用本地 ISO 时间。
- `activeWork`：当前正在修改的任务、分支和文件。
- `tracks`：每条主线的 `backlog`、`in_progress`、`review`、`done` 或 `blocked`。
- `lastHandoff`：修改文件、验证命令、结果、未完成事项和下一步。

交接记录必须能让下一个 Agent 在不依赖聊天历史的情况下继续工作。至少写清：

```text
目标：
已完成：
修改文件：
验证结果：
已知风险/未完成：
下一步：
```

同一时间只允许一个 Agent 大改 `src/ui/App.tsx`、`src/core/types.ts`、`src-tauri/src/lib.rs`、`src/ui/styles/tokens.css` 或 `src/ui/styles/workbench.css`。能拆到新文件就不要继续扩大这些高冲突文件。

## 5. 验证矩阵

普通 TypeScript/UI 改动：

```powershell
npm run build
npm run test:architecture
```

涉及插件、场景、工作台、状态、资源、Reader、数据或 Rust：

```powershell
npm run verify
```

场景插件接线变更还必须通过：

```powershell
npm run test:scene-plugins
```

只改文档可以不跑完整构建，但必须检查链接和状态文件格式；本手册和状态脚本发生变化时运行：

```powershell
npm run test:agent-status
```

## Resource opener contract

Every resource-backed tab is routed through the core resource opener resolver.
`ResourceOpenerContribution` can match a declared `kind`, file `extensions`
(with or without a leading dot), or URI `schemes`. Higher `priority` wins and
the opener id is the deterministic tie-breaker. Disabled plugin or scene owners
make their opener unavailable immediately. New plugin resource types must add a
resource opener and scene/view contribution instead of an extension switch in
`App.tsx`.

## Windows packaging contract

Windows release packages use one repository-level command:

```powershell
npm run package:windows
```

The command runs the configured frontend production build before compiling the
Rust/Tauri release, so a separate `npm run build` is not required for packaging.

The command builds with an isolated Cargo target, moves the previous
`artifacts/windows/latest` directory into a timestamped
`artifacts/windows/archive/<version>-<timestamp-pid>` directory, and writes the
stable delivery files to `artifacts/windows/latest`:

```text
artifacts/windows/latest/a4note.exe
artifacts/windows/latest/A4 Note_x64-setup.exe
artifacts/windows/latest/build-info.json
```

Do not copy release executables to the repository root or overwrite
`src-tauri/target/release/a4note.exe` as a delivery step. The raw
`npm run tauri:build` command remains available for debugging, but it is not the
standard packaging workflow. A failed package keeps its temporary build
directory under `.build/tauri-packaging/` for diagnosis; a successful package
cleans it up.

`npm run verify` 必须从 PowerShell 执行。提交或交接时不要包含 `dist/`、`src-tauri/target/`、`.tmp/`、个人数据或签名密钥。

## 6. Skill 与实时状态的边界

开发规范不应只做成 Skill。Skill 适合提供固定的检查流程和工具使用说明，但它不会随代码、任务和 Agent 交接自动更新。A4 Note 采用三层方式：

- 本手册：稳定规范和架构不变量。
- `AGENT_STATUS.md`：人类可读的当前状态和交接摘要。
- `plans/PROJECT_STATUS.json`：机器可读的状态快照，脚本负责校验结构。

如果以后需要 Skill，可以让 Skill 强制 Agent 先读这三个文件、运行状态检查并生成交接记录；不要把项目进度复制到 Skill 内部。
