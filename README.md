# Aster Desktop

Aster 是一个本地优先、可扩展的通用知识工作台。它不只服务科研文献管理，也服务课程学习、项目资料整理、个人知识库构建、目录体系搭建、资料阅读、笔记沉淀和 AI 辅助处理。

当前版本仍以“资料库 / 文献库 + PDF 阅读 + Markdown 笔记 + PDF 标注 + 本地上下文 AI 对话”作为最小可用闭环。文献管理是第一阶段的核心场景之一，但长期设计目标是“知识对象 + 统一信息关联系统”：文献、PDF、Markdown 笔记、标注、摘录、AI 对话片段、主题页面、项目资料和插件数据都能被稳定关联、查找和复用。

## 当前主要功能

- 资料库 / 文献库：PDF 导入、表格检索、标签墙过滤、排序、批量标签、批量删除、复制 Markdown/CSV/BibTeX。
- PDF 导入：复制文件到应用数据目录，自动从 PDF/文件名生成标题和作者草稿，用户可修改后确认。
- 标签输入：chip 标签输入，回车新建标签，自动提示已有标签，空标签兜底为“未分类”。
- 文件绑定：原文 PDF 和译文 PDF 绑定到同一篇文献，译文 PDF 可手动配对导入。
- 阅读器：PDF.js 多页连续阅读、原文/译文切换、缩放、页码跳转、鼠标浏览和平移。
- PDF 标注：高亮、下划线、区域框选、批注、便签、颜色预设、自定义颜色、删除、撤销/重做。
- 独立标注：原文 PDF 和译文 PDF 使用不同 `file_id` 保存标注，互不混用。
- 笔记：Markdown 笔记与文献绑定，支持编辑、预览和保存。
- AI 对话：本地上下文对话界面，当前先保存对话记录并绑定当前文献，真实 CLI/Provider 接入后续扩展。
- 设置：界面密度、默认阅读布局、元数据源偏好、本地资料库路径、备份、诊断信息和扩展能力状态。
- 默认指南：首次初始化会创建 `Aster 使用指南`，作为真实文献记录进入文献库。

长期目标见 [GOAL.md](docs/notes/GOAL.md)。其中“主要功能范围清单（审阅版）”列出了 P0/P1/P2 功能和待确认项，方便继续评审。模块边界、依赖方向、插件边界和渐进式重构规则见 [ARCHITECTURE.md](docs/notes/ARCHITECTURE.md)。协作开发流程见 [DEVELOPMENT_WORKFLOW.md](docs/notes/DEVELOPMENT_WORKFLOW.md)，代码标准见 [CODING_STANDARDS.md](docs/notes/CODING_STANDARDS.md)，UI 规范见 [UI_GUIDELINES.md](docs/notes/UI_GUIDELINES.md)，模块 owner 建议见 [MODULE_OWNERS.md](docs/notes/MODULE_OWNERS.md)。后续重点会从单一文献库扩展为通用资料库，加入 Obsidian 式双链、目录构建、关系链查看、AI Provider、插件系统，以及接近 Obsidian / VS Code 的可组合工作台布局。

下一阶段可分配任务见 [DEVELOPMENT_TASKS.md](docs/notes/DEVELOPMENT_TASKS.md)。

## 技术栈

- 桌面框架：Tauri 2
- 前端：React 19 + TypeScript + Vite
- PDF 阅读：PDF.js
- 后端：Rust
- 本地数据库：SQLite，使用 `rusqlite` bundled SQLite
- 本地文件库：应用数据目录下的 `AsterData/files/papers`

## 开发环境准备

建议开发系统：Windows 10/11。

多人协作前建议先读：

```text
README.md
docs/notes/GOAL.md
docs/notes/ARCHITECTURE.md
docs/notes/DEVELOPMENT_WORKFLOW.md
docs/notes/CODING_STANDARDS.md
docs/notes/UI_GUIDELINES.md
docs/notes/MODULE_OWNERS.md
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

```powershell
npm run build
npm run tauri:build
```

构建完成后的 exe 位于：

```text
src-tauri/target/release/aster.exe
```

如果构建时报无法覆盖 `aster.exe`，通常是因为旧程序还在运行。先关闭 Aster，或在任务管理器里结束 `aster.exe` 进程后重新构建。

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
npm run test:core
npm run test:pdfjs
npm run test:reader
npm run test:ui-state
npm run test:architecture
npm run test:library-export
npm run test:error-boundary
```

其中 `npm run verify` 会串行执行前端构建、核心 smoke、PDF.js、阅读器渲染、UI 状态、架构边界、导出、错误边界和 Rust 测试。

## 目录结构

```text
Aster/
  src/
    core/            前端核心类型、文献模型、关系图、工作台注册表、Markdown 渲染
    features/        按业务能力拆分的前端模块，目前已落地 library/reader/ai/settings 入口
    workbench/       工作台框架组件和面板 Host
    shared/          通用 UI、hooks、utils 的稳定入口
    platform/        Tauri native API 封装、本地文件和数据库能力边界
    data/            浏览器预览用 seed 数据
    ui/              React UI、阅读器、样式、中文文案、标签输入
    main.tsx         前端入口
  src-tauri/
    src/             Rust 后端命令、SQLite、文件导入、PDF 元数据提取
    assets/          内置默认指南 Markdown/PDF
    capabilities/    Tauri 权限配置
    schema.sql       SQLite 表结构
    tauri.conf.json  Tauri 应用配置
  scripts/           验证脚本
  package.json       前端依赖和 npm 脚本
```

## 本地资料库

Aster 会在系统应用数据目录里创建本地资料库，结构类似：

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

统一关系系统是 Aster 的核心架构方向，详细设计见 [GOAL.md](docs/notes/GOAL.md) 的“统一信息关联系统”。开发时应按“对象和关系分离、稳定 ID、类型可扩展、关系可双向查询、插件通过受控 API 写入”的原则设计。

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
- 阅读器 PDF 核心代码主要在 `src/features/reader/pdf/PdfReader.tsx`，标注持久化命令在 `src-tauri/src/lib.rs`。
- Tauri 命令需要同时修改：
  - Rust request/command/database 函数
  - `tauri::generate_handler!`
  - `src/platform/nativeApi.ts`
- 前端构建偶尔可能出现 Vite/Rolldown 输出路径错误，通常清理 `dist` 后重跑即可：

```powershell
Remove-Item -Recurse -Force .\dist
npm run build
```

## 当前待完善方向

- 从文献库扩展为通用资料库，支持知识对象、目录、关系链和自定义视图。
- 工作台自由布局：可折叠面板、布局偏好保存、中央标签页、基础分屏、命令面板打开视图。
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

说明旧的 `aster.exe` 正在运行。关闭程序或结束进程后重试。

### 浏览器预览里无法导入 PDF

正常。浏览器模式没有 Tauri 本地文件能力，请使用：

```powershell
npm run tauri:dev
```

### 构建提示 PDF.js worker 或主包体积较大

这是体积优化提示，不代表构建失败。PDF.js worker 本身较大，后续可以再做拆包优化。
