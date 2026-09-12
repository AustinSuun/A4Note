# A4 Note Desktop

> 当前开发主线与开发 AI 执行规范见 [AI_DEVELOPMENT_PLAN.md](docs/notes/AI_DEVELOPMENT_PLAN.md)。当旧任务文档与该主计划冲突时，以主计划为准。

Agent 接手任务前请先阅读 [DEVELOPMENT_HANDBOOK.md](docs/notes/DEVELOPMENT_HANDBOOK.md)，再查看 [AGENT_STATUS.md](docs/notes/AGENT_STATUS.md) 和机器可读的 [PROJECT_STATUS.json](plans/PROJECT_STATUS.json)。

A4 Note 是一个本地优先、可扩展的知识笔记工作台。它围绕获取、标注、关联、成稿的 4A 知识流，连接资料、PDF、笔记和知识关系。

当前版本仍以“资料库 / 文献库 + PDF 阅读 + Markdown 笔记 + PDF 标注 + 本地上下文 AI 对话”作为最小可用闭环。文献管理是第一阶段的核心场景之一，但长期设计目标是“知识对象 + 统一信息关联系统”：文献、PDF、Markdown 笔记、标注、摘录、AI 对话片段、主题页面、项目资料和插件数据都能被稳定关联、查找和复用。

## 当前主要功能

- 工作台：左侧列出项目文件夹及其工作区，每个工作区可打开多个标签（工具、文件预览、Agent 会话），支持固定和拖拽换位；项目、工作区、标签和活动标签重启后从 SQLite 恢复。
- 项目文件夹：选择本地文件夹作为项目，只读文件树懒加载，支持在 VS Code、资源管理器或系统默认应用中打开。
- 本机 CLI Agent 会话：检测本机安装的 codex / claude，用项目目录作为工作目录新建会话，流式显示回答与工具活动（执行命令、修改文件、联网搜索等），支持停止当前一轮和结束进程。权限由沙箱决定（只读 / 可改写工作目录 / 完全访问，默认只读，完全访问必须自己选）。codex 与 claude 两个适配器都已实现，对话历史落在 SQLite 里，重启应用后 transcript 会回来。
- 资料库 / 文献库：PDF 导入、表格检索、标签墙过滤、排序、批量标签、批量删除、复制 Markdown/CSV/BibTeX。
- PDF 导入：复制文件到应用数据目录，自动从 PDF/文件名生成标题和作者草稿，用户可修改后确认。
- 标签输入：chip 标签输入，回车新建标签，自动提示已有标签，空标签兜底为“未分类”。
- 文件绑定：原文 PDF 和译文 PDF 绑定到同一篇文献，译文 PDF 可手动配对导入。
- 阅读器：PDF.js 多页连续阅读、原文/译文切换、缩放、页码跳转、鼠标浏览和平移。
- PDF 标注：高亮、下划线、区域框选、批注、便签、颜色预设、自定义颜色、删除、撤销/重做。
- 独立标注：原文 PDF 和译文 PDF 使用不同 `file_id` 保存标注，互不混用。
- 笔记：Markdown 笔记与文献绑定，支持编辑、预览和保存。
- AI 对话（文献场景）：围绕当前文献、笔记和标注的本地上下文对话界面，当前先保存对话记录并绑定当前文献，真实 Provider 接入后续扩展。与上面的 Agent 会话是两件事：这里绑定论文，Agent 会话绑定项目目录和本机 CLI。
- 设置：界面密度、默认阅读布局、元数据源偏好、本地资料库路径、备份、诊断信息和扩展能力状态。
- 默认指南：首次初始化会创建 `A4 Note 使用指南`，作为真实文献记录进入文献库。

长期目标见 [GOAL.md](docs/notes/GOAL.md)。其中“主要功能范围清单（审阅版）”列出了 P0/P1/P2 功能和待确认项，方便继续评审。模块边界、依赖方向、插件边界和渐进式重构规则见 [ARCHITECTURE.md](docs/notes/ARCHITECTURE.md)。阅读器阶段 2 的功能基线见 [READER_BASELINE.md](docs/notes/READER_BASELINE.md)。协作开发流程见 [DEVELOPMENT_WORKFLOW.md](docs/notes/DEVELOPMENT_WORKFLOW.md)，代码标准见 [CODING_STANDARDS.md](docs/notes/CODING_STANDARDS.md)，UI 规范见 [UI_GUIDELINES.md](docs/notes/UI_GUIDELINES.md)，模块 owner 建议见 [MODULE_OWNERS.md](docs/notes/MODULE_OWNERS.md)。后续重点会从单一文献库扩展为通用资料库，加入 Obsidian 式双链、目录构建、关系链查看、AI Provider、插件系统，以及接近 Obsidian / VS Code 的可组合工作台布局。

下一阶段可分配任务见 [DEVELOPMENT_TASKS.md](docs/notes/DEVELOPMENT_TASKS.md)。

## 技术栈

- 桌面框架：Tauri 2
- 前端：React 19 + TypeScript + Vite
- PDF 阅读：PDF.js
- 后端：Rust
- 本地数据库：SQLite，使用 `rusqlite` bundled SQLite
- 本地文件库：应用数据目录下的兼容目录 `AsterData/files/papers`

## 开发环境准备

建议开发系统：Windows 10/11。

多人协作前建议先读（仓库根目录 `AGENTS.md` 是最短入口）：

```text
AGENTS.md
README.md
docs/notes/GOAL.md
docs/notes/ARCHITECTURE.md
docs/notes/READER_BASELINE.md
docs/notes/DEVELOPMENT_WORKFLOW.md
docs/notes/CODING_STANDARDS.md
docs/notes/UI_GUIDELINES.md
docs/notes/MODULE_OWNERS.md
docs/notes/DEVELOPMENT_HANDBOOK.md
docs/notes/AGENT_STATUS.md
plans/PROJECT_STATUS.json
docs/notes/DEVELOPMENT_TASKS.md
```

需要安装：

1. Node.js
   - 建议安装 LTS 版本。
   - 安装后确认：

   ```powershell
   node -v
   npm -v
   ```

2. Rust
   - 通过 rustup 安装：https://rustup.rs
   - 安装后确认：

   ```powershell
   rustc --version
   cargo --version
   ```

3. Windows C++ 构建工具
   - 安装 Visual Studio Build Tools 或 Visual Studio。
   - 需要包含 `Desktop development with C++` 工作负载。
   - Tauri/Rust 在 Windows 上构建 native 程序需要 MSVC 工具链。

4. WebView2 Runtime
   - Windows 11 通常已内置。
   - 如果运行 Tauri 程序时报 WebView2 缺失，需要安装 Microsoft Edge WebView2 Runtime。

5. Tauri CLI
   - 项目已经把 `@tauri-apps/cli` 放在 devDependencies 中，一般不需要全局安装。
   - 使用 `npm run tauri:dev` 和 `npm run tauri:build` 即可。

## 安装依赖

进入项目目录：

```powershell
cd D:\WorkSpace\Aster
npm install
```

如果是从服务器新拉下来的代码，优先执行一次 `npm install`。不要提交 `node_modules`、`dist`、`src-tauri/target` 这些构建产物。

## 本地运行

真实桌面开发模式：

```powershell
npm run tauri:dev
```

浏览器预览模式：

```powershell
npm run dev
```

注意：浏览器预览不能完整调用桌面文件选择器、本地文件复制、打开资料库目录、读取内部 PDF 等 Tauri 能力。导入 PDF、阅读内部 PDF、配对译文 PDF、SQLite 持久化等功能请使用 `npm run tauri:dev`。

## 构建 exe

标准 Windows 打包使用下面的命令：

```powershell
npm run package:windows
```

该命令会先执行 Tauri 配置中的前端生产构建，再编译 Rust 和生成 NSIS 安装包。

打包完成后的固定目录为：

```text
artifacts/windows/latest/a4note.exe
artifacts/windows/latest/A4 Note_x64-setup.exe
artifacts/windows/latest/build-info.json
```

每次成功打包前，当前 `latest` 整目录会自动归档到带版本和时间戳的目录，不会覆盖上一个版本：

```text
artifacts/windows/archive/<version>-<yyyyMMdd-HHmmss-pid>/
```

`.build/tauri-packaging/` 只保存本次打包的临时 Cargo 目录；打包成功后会自动清理。若构建失败，该目录会保留，便于排查。

如果打包时报文件被占用，通常是旧版 A4 Note 仍在运行。先关闭程序，或在任务管理器里结束 `a4note.exe` 进程后重新执行 `npm run package:windows`。

查看目录规划而不实际构建：

```powershell
npm run package:windows -- --dry-run
```

`npm run tauri:build` 仍可用于底层调试，但不会整理交付产物；交付 Windows exe 时统一使用 `npm run package:windows`。

## 验证命令

常用验证：

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

项目脚本还提供：

```powershell
npm run verify
npm run status
npm run test:core
npm run test:workspace
npm run test:resources
npm run test:agent-protocol
npm run test:pdfjs
npm run test:reader
npm run test:reader-helpers
npm run test:ai-toolbar
npm run test:ui-state
npm run test:architecture
npm run test:scene-plugins
npm run test:library-export
npm run test:error-boundary
npm run test:agent-status
```

其中 `npm run verify` 会串行执行前端构建、核心 smoke、工作台模型、资源模型、Agent CLI 协议与历史行映射、PDF.js、阅读器渲染、阅读器 helper、AI 工具栏、UI 状态、架构边界、导出、错误边界和 Rust 测试（当前 115 个）。

`npm run verify` 必须从 PowerShell 运行：`scripts/verify-all.mjs` 在 Windows 上用 `cmd.exe` 包装每一步。


## 目录结构

```text
Aster/
  src/
    core/            前端核心类型、文献模型、关系图、工作台注册表、Markdown 渲染
                     workspace.ts 是 Project/Workspace/Tab/Resource/AgentSession 纯模型
                     resources.ts 是资源身份：URI 规范化、去重 key、标签 key
                     agentProtocol.ts 是 Agent CLI 事件契约与纯归约
                     agentHistory.ts 是 transcript 与历史行的互相映射（纯函数）
    features/        按业务能力拆分的前端模块：library/reader/ai/settings/explorer/agents
    workbench/       工作台外壳：侧边栏、顶栏、标签条、TabHost、命令面板、面板 Host、store
    shared/          通用 UI、hooks、utils 的稳定入口
    platform/        Tauri native API 封装、本地文件和数据库能力边界
                     projects/ 项目文件夹与文件树，agentCli/ 本地 CLI 检测与会话生命周期
                     workbench/ 工作台快照的 SQLite 适配器
    data/            浏览器预览用 seed 数据
    ui/              React UI、阅读器、样式、中文文案、标签输入
    main.tsx         前端入口
  src-tauri/
    src/             Rust 后端命令、SQLite、文件导入、PDF 元数据提取
                     lib.rs 只有模块表、命令注册段和 run()：命令体在各自的领域模块里
                     app_paths.rs 资料库路径、初始化、跨平台"在文件管理器里显示"
                     database.rs 连接与建表、标签规范化、时间戳等公共 SQLite 工具
                     guide.rs 内置指南的种子数据
                     diagnostics.rs 诊断信息，backup.rs 备份与恢复
                     pdf_metadata.rs 从 PDF 首页文本猜标题/作者/DOI/年份
                     library_import.rs 导入原文与译文、按 file_id 取字节、在外部打开
                     library_papers.rs 文献列表与元数据、标签、删除
                     library_annotations.rs 标注增删改与撤销恢复
                     library_notes.rs 笔记 upsert，library_ai.rs AI 会话与消息
                     library_tests.rs 跨领域的端到端测试（临时 AsterData 根）
                     project_commands.rs 项目文件夹命令（实现在 workspace_fs.rs）
                     workspace_fs.rs 项目文件夹、文件树、预览、外部打开、CLI 检测
                     workbench_store.rs 工作台快照读写
                     state_commands.rs 工作台快照与 Agent 历史的命令（SQLite 那一侧）
                     agent_cli/ Agent CLI 协议、错误类型、回合隔离、内存 stdio 夹具、
                                真实子进程传输（tree-kill 阶梯）、会话 supervisor 与
                                providers/codex.rs（codex app-server 适配器）、
                                providers/claude.rs（claude -p stream-json 适配器）
                     agent_bridge.rs Agent 会话的五个 Tauri 命令与 agent://event 事件频道
                     agent_history.rs agent_messages 仓库（命令在 state_commands.rs，这里没有 tauri::）
    assets/          内置默认指南 Markdown/PDF
    capabilities/    Tauri 权限配置
    schema.sql       SQLite 表结构
    tauri.conf.json  Tauri 应用配置
  scripts/           验证脚本
  package.json       前端依赖和 npm 脚本
```

工作台的结构契约、标签种类和模块边界见 [WORKSPACE_BASELINE.md](docs/notes/WORKSPACE_BASELINE.md)。


## 本地资料库

A4 Note 会在系统应用数据目录里使用本地资料库。为兼容早期版本，当前仍保留以下旧目录和数据库文件名：

```text
AsterData/
  aster.db
  files/
    papers/
      {paper_id}/
        source.pdf
        translated.zh.pdf
  backups/
```

开发和测试时不要手动移动 `files/papers` 下的文件。需要查看或备份资料库时，优先使用应用设置页里的资料库路径、文件库路径和备份功能。

## 数据模型概念

当前落地模型仍以 `papers` 为第一类知识对象实现文献工作流。后续架构会逐步抽象出更通用的 `KnowledgeObject` 和 `Relation` 层，让文献、笔记、主题页面、项目资料、AI 对话片段和插件数据都能通过统一关系系统管理。

统一关系系统是 A4 Note 的核心架构方向，详细设计见 [GOAL.md](docs/notes/GOAL.md) 的“统一信息关联系统”。开发时应按“对象和关系分离、稳定 ID、类型可扩展、关系可双向查询、插件通过受控 API 写入”的原则设计。

核心实体：

- `papers`：文献元数据。
- `paper_files`：原文 PDF、译文 PDF、补充文件。
- `notes`：文献绑定 Markdown 笔记。
- `annotations`：PDF 标注，绑定 `paper_id + file_id + page + position_json`。
- `tags / paper_tags`：标签墙和文献标签。
- `ai_threads / ai_messages`：绑定到文献的 AI 对话。

重要约束：

- 原文 PDF 和译文 PDF 标注必须按 `file_id` 隔离。
- 标注撤销/重做需要保持原始 `annotation_id`，否则右侧列表、PDF 选中和笔记引用会断链。
- 文献库首页不展示底层绑定信息，绑定信息应放在阅读器、详情抽屉或后续专门页面。
- 新增功能不要只按“文献专用”写死；如果能力可能服务笔记、项目资料、课程记录或插件对象，应优先按知识对象和关系的方向设计接口。
- 新增对象或新关联时，优先思考它是 `KnowledgeObject`、`Relation`，还是某种对象的专属元数据；不要随意增加只能被单一页面理解的临时字段。
- UI 新增视图时不要写成固定死页面；优先按 `Scene / View / Panel / Pane / WorkspaceLayout` 的方向设计，让后续能支持标签页、分屏、可折叠面板和插件视图。

## 开发注意事项

- UI 文案默认中文，主要集中在 `src/ui/zh.ts`。
- 编辑中文文件时必须保持 UTF-8，避免再次出现乱码。
- 手动代码修改优先保持现有风格，不引入新的 UI 框架。
- 多人协作时遵守 [DEVELOPMENT_WORKFLOW.md](docs/notes/DEVELOPMENT_WORKFLOW.md) 和 [MODULE_OWNERS.md](docs/notes/MODULE_OWNERS.md)，不要直接向 `main` 合并未验证的大改动。
- 新增或调整模块时遵守 [CODING_STANDARDS.md](docs/notes/CODING_STANDARDS.md)，优先通过模块 `index.ts` 暴露接口。
- UI 开发需要遵守 [GOAL.md](docs/notes/GOAL.md) 中的“UI、易用性和审美原则”“场景级设计分配”和“设计参考分级”：专业、克制、高密度、低视觉噪音、键盘可用、状态清晰、可撤销、阅读空间优先。主要参考 NN/g、WCAG/WAI、IBM Carbon 和 VS Code UX Guidelines，不直接套用某个视觉系统。
- UI 具体实现规范见 [UI_GUIDELINES.md](docs/notes/UI_GUIDELINES.md)。新增 UI 优先复用或沉淀到 `src/shared/ui/`。
- 阅读器 PDF 核心代码主要在 `src/features/reader/pdf/PdfReader.tsx`，标注持久化命令在 `src-tauri/src/library_annotations.rs`。
- `src/workbench/**` 不得 import `ui/`、`platform/`、`features/`：文案通过 `WorkbenchLabels` 由 `App.tsx` 注入，需要原生能力的面板放在 `features/`。这条由 `npm run test:architecture` 逐文件断言。
- React 组件不直接调用 `invoke()`，本地能力统一经过 `src/platform/`。
- Tauri 命令需要同时修改：
  - Rust request/command/database 函数：写进拥有那几张表的领域模块（如 `library_annotations.rs`、`state_commands.rs`），不要写回 `lib.rs`
  - `lib.rs` 的 `tauri::generate_handler!`，条目必须写成 `模块::命令`
  - 前端边界：新命令优先放进对应的 `src/platform/<domain>/`（如 `projects/`、`agentCli/`、`workbench/`），不要继续往 `src/platform/nativeApi.ts` 里堆
- 前端构建偶尔可能出现 Vite/Rolldown 输出路径错误，通常清理 `dist` 后重跑即可：

```powershell
Remove-Item -Recurse -Force .\dist
npm run build
```

## 当前待完善方向

- 工作台分屏与拖拽停靠（当前只有单行标签栏加一个可选右侧抽屉；项目、工作区、标签本身已持久化到 SQLite）。
- 本地 CLI Agent 运行时：**codex 和 claude 都可以真的对话，而且对话是被记住的。** Rust 侧的进程底座（启动配置、父会话环境变量剥离、真实子进程传输、tree-kill 停止阶梯、一个会话一个线程的 supervisor）、两个适配器（`codex app-server` 的 JSON-RPC 与 `claude -p` 的 stream-json）、五个会话命令和两个历史命令都在，会话面板有流式 transcript、工具活动、"停止这一轮"和"结束进程"，消息历史落 `agent_messages` 表并在挂载时回填。接下来是会话里的 `@resource` 上下文（`AGT-4`）与多会话并行的资源占用策略。
- 让 PDF 阅读器吃通用 Resource 而不是 `paperId`，并解锁 `@resource` 上下文。资源身份本身已经落地（`src/core/resources.ts` + `resources` 表：一条路径无论怎么拼写都只有一条记录、一个标签），但目前只有"打开文件标签"在往里写，用户还看不到它。
- 从文献库扩展为通用资料库，支持知识对象、目录、关系链和自定义视图。
- 选中文字后弹出标注浮层，接近 Zotero 的高亮体验。

- 标注列表搜索、筛选、批量删除、批量改色。
- 从标注一键生成阅读笔记，并支持笔记回跳 PDF。
- 便签直接在 PDF 上编辑、调整大小、折叠展开。
- 导出带标注 PDF、导出 Markdown 摘录。
- Obsidian 式 Markdown 双链、反向链接、主题笔记、项目笔记和知识图谱。
- 插件系统：命令、事件、设置、视图、AI Provider、元数据源、翻译源、导入导出 Provider。
- 在线元数据补全：Crossref、arXiv、DOI 识别增强。
- AI Provider：Codex CLI、Claude Code CLI、本地模型和翻译 API 插件化接入。
- 长期规划：云同步、多设备、多人协作、移动端、插件市场、富文本/块编辑体验、插件沙箱。完整在线论文数据库自建优先级较低，优先通过 Provider 接入外部元数据源。

## 常见问题

### `npm run tauri:build` 无法覆盖 exe

说明旧的 `a4note.exe` 正在运行。关闭程序或结束进程后重试。

### 浏览器预览里无法导入 PDF

正常。浏览器模式没有 Tauri 本地文件能力，请使用：

```powershell
npm run tauri:dev
```

### 构建提示 PDF.js worker 或主包体积较大

这是体积优化提示，不代表构建失败。PDF.js worker 本身较大，后续可以再做拆包优化。
