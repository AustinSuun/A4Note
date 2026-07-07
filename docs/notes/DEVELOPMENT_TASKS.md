# Aster 协作任务队列

本文档把当前项目的下一阶段工作拆成可分配的小任务。协作流程见 `DEVELOPMENT_WORKFLOW.md`，模块 owner 见 `MODULE_OWNERS.md`。

任务状态建议：

```text
Backlog      尚未开始
Ready        可以领取
In Progress 进行中
Review       等待 review
Done         已合并
Blocked      被阻塞
```

## 1. 当前优先级

优先处理顺序：

1. 降低协作冲突：继续拆 `App.tsx`、`PdfReader.tsx`、`styles.css`。
2. 建立 UI 基础组件和 token。
3. 稳定阅读器模块边界。
4. 拆分后端 Rust 大文件。
5. 再继续做新功能。

## 2. 阶段 1：协作基础稳定

**阶段状态：** Done

**完成日期：** 2026-07-07

**阶段目标：**

让 Aster 从“已经能运行的工程”进入“多人可以稳定接手开发”的状态。这个阶段不以新增大功能为主，而是降低协作冲突、固定模块边界、建立 UI 基础组件和验证习惯，让后续阅读器、文献库、AI、插件和后端能力可以并行推进。

**核心目标：**

1. 降低大文件冲突。
   - 继续减少 `App.tsx` 的状态和副作用负担。
   - 避免多人继续同时修改 `styles.css`。
   - 将 PDF 阅读器核心稳定放在 reader 模块内。

2. 固化模块协作边界。
   - 新增代码优先进入 `features / workbench / shared / platform / core` 对应模块。
   - 外部只通过模块 `index.ts` 使用能力。
   - 架构边界检查必须持续通过。

3. 建立基础 UI 系统。
   - 开始沉淀 `shared/ui`。
   - 建立颜色、间距、圆角、阴影等 token。
   - 为后续整体 UI 优化打基础，而不是继续堆散乱 CSS。

4. 建立稳定验证习惯。
   - 普通任务至少跑 `npm run build` 和 `npm run test:architecture`。
   - 涉及阅读器、导入、标注、数据或后端时跑 `npm run verify`。
   - PR 必须说明影响模块和验证结果。

**本阶段不做：**

- 不大规模重做 UI。
- 不接入复杂 AI Provider。
- 不做插件市场。
- 不重写 PDF 阅读器。
- 不推倒现有数据模型。

**阶段退出标准：**

- `App.tsx` 中至少抽出 1 到 2 个稳定 hook。
- `styles.css` 被拆出基础结构，或至少完成 token / component 的第一步拆分。
- `shared/ui` 至少有 1 到 2 个真实基础组件。
- `PdfReader` 路径和验证脚本全部稳定在 reader 模块内。
- `npm run verify` 通过。
- 新任务可以按 `DEVELOPMENT_TASKS.md`、PR 模板和模块 owner 表直接分配。

**建议本阶段第一批任务：**

```text
P0-1 修复 UI 乱码
P0-2 抽 usePersistedUiState
P0-5 拆 styles.css 基础结构
P1-1 建立 shared/ui/Button
```

## 3. P0 任务：协作阻塞点

### Task P0-1: 修复 UI 乱码

**状态：** Done

**建议分支：**

```text
fix/ui-aria-label-encoding
```

**负责人角色：** UI System / Docs

**影响文件：**

```text
src/ui/App.tsx
```

**目标：**

修复 `scene-rail` 的乱码 `aria-label`，避免中文 UI 和无障碍标签中出现编码损坏。

**验收标准：**

- `aria-label` 使用正常中文。
- `rg -n "绉|鍦|烘|櫙|鐨|涓|鏂|鍏|犲|渚|浠|妗|鈥" src docs README.md` 不再匹配源码乱码。
- `npm run build` 通过。

**验证命令：**

```powershell
rg -n "绉|鍦|烘|櫙|鐨|涓|鏂|鍏|犲|渚|浠|妗|鈥" src docs README.md
npm run build
```

### Task P0-2: 抽 `usePersistedUiState`

**状态：** Done

**建议分支：**

```text
refactor/app-use-persisted-ui-state
```

**负责人角色：** Workbench / UI System

**影响文件：**

```text
src/ui/App.tsx
src/shared/hooks/usePersistedUiState.ts
src/shared/hooks/index.ts
scripts/verify-ui-state.mjs
```

**目标：**

把 `App.tsx` 中 UI 状态持久化相关逻辑抽到 hook，减少 `App.tsx` 对 localStorage 结构和 workspace layout 细节的直接承担。

**验收标准：**

- `App.tsx` 不再直接包含 `loadUiState`、`saveUiState`、`defaultUiState`、`normalizeWorkspaceLayouts` 这类持久化细节函数。
- `usePersistedUiState` 暴露当前 UI 状态和保存动作。
- 现有 UI 状态恢复行为不变。
- `npm run test:ui-state` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:ui-state
npm run verify
```

### Task P0-3: 抽 `useAnnotationHistory`

**状态：** Done

**建议分支：**

```text
refactor/reader-use-annotation-history
```

**负责人角色：** Reader

**影响文件：**

```text
src/ui/App.tsx
src/features/reader/useAnnotationHistory.ts
src/features/reader/index.ts
scripts/verify-reader-rendering.mjs
```

**目标：**

把标注撤销/重做、历史栈、恢复和本地删除逻辑从 `App.tsx` 抽到 reader 专用 hook。

**验收标准：**

- 高亮、下划线、区域框选、批注、便签仍可创建。
- 删除、撤销、重做行为不变。
- 原文 PDF 和译文 PDF 标注仍按 `file_id` 隔离。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P0-4: 移动 `PdfReader.tsx` 到 reader 模块

**状态：** Done

**建议分支：**

```text
refactor/reader-pdf-location
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/PdfReader.tsx
src/ui/PdfReader.tsx 已移除
src/features/reader/ReaderDocumentPane.tsx
src/features/reader/index.ts
scripts/verify-architecture-boundaries.mjs
scripts/verify-reader-rendering.mjs
```

**目标：**

把 PDF 阅读器核心移动到 `features/reader/pdf/`，第一步只移动文件和 import，不拆内部逻辑。

**验收标准：**

- 旧路径 `src/ui/PdfReader.tsx` 不再存在。
- `ReaderDocumentPane` 从 `features/reader/pdf/PdfReader` 引入。
- PDF.js 渲染验证通过。
- 阅读器验证通过。
- 架构边界脚本更新并通过。

**验证命令：**

```powershell
npm run test:pdfjs
npm run test:reader
npm run test:architecture
npm run verify
```

### Task P0-5: 拆分 `styles.css` 基础结构

**状态：** Done

**建议分支：**

```text
refactor/ui-split-style-files
```

**负责人角色：** UI System

**影响文件：**

```text
src/ui/styles.css
src/ui/styles/tokens.css
src/ui/styles/base.css
src/ui/styles/layout.css
src/ui/styles/components.css
src/ui/styles/library.css
src/ui/styles/reader.css
src/main.tsx
```

**目标：**

先按文件拆分 CSS，不做大规模视觉改版。降低后续多人同时改 `styles.css` 的冲突风险。

**验收标准：**

- `styles.css` 只作为入口或被 `main.tsx` 替换为多个 CSS import。
- token、基础元素、布局、通用组件、library、reader 样式分别进入对应文件。
- 构建后的视觉行为保持不变。
- `npm run build` 通过。
- `npm run test:reader` 通过。

**验证命令：**

```powershell
npm run build
npm run test:reader
```

## 4. 阶段 2：阅读器核心功能补全与 UI 重整

**阶段状态：** Ready

**阶段目标：**

让阅读器从“工程上能打开 PDF 的基础阅读场景”进入“核心阅读流程可用、标注和笔记链路稳定、UI 方向明确”的状态。当前阅读器功能还没有完整实现，界面也需要整体调整，所以本阶段不能只做代码拆分；必须先明确阅读器功能基线和 UI 方案，再按功能闭环逐步补齐。

**核心目标：**

1. 明确阅读器功能基线。
   - 梳理当前已实现、部分实现、未实现的阅读器能力。
   - 明确第一版阅读器必须完成的功能闭环。
   - 把“暂不做”的能力写清楚，避免阶段范围失控。

2. 补齐核心阅读流程。
   - 文献进入阅读器后，原文 PDF、译文 PDF、Markdown 笔记能稳定切换。
   - 缩放、页码跳转、连续阅读、专注阅读、边读边记、AI 辅助阅读布局稳定可用。
   - 阅读器右侧抽屉中的笔记、标注、对话、关系能够围绕当前文献协同工作。

3. 补齐标注和笔记链路。
   - 高亮、下划线、区域框选、批注、便签、颜色、自定义颜色、删除、撤销/重做行为形成可用闭环。
   - 原文 PDF 和译文 PDF 标注继续按 `file_id` 隔离。
   - 标注列表、PDF 选中、笔记引用和关系面板之间的 ID 链路不能断。

4. 重整阅读器 UI。
   - 阅读器主区域优先，右侧抽屉和工具栏不抢空间。
   - 工具栏控制继续保持紧凑，但模式和工具入口要更清晰。
   - 阅读器视觉逐步靠近“低噪音、专业、高密度”。
   - UI 方案需要先被记录，再分任务落地。

5. 稳定 PDF 阅读器内部边界。
   - 将 `src/features/reader/pdf/PdfReader.tsx` 从单个大文件拆成渲染、文本层、标注层、交互工具和 helper。
   - 先拆结构，不重写 PDF 渲染策略。
   - 保持现有 PDF.js 渲染、缩放、页码跳转和连续阅读行为稳定。

6. 补强阅读器验证。
   - `npm run test:reader` 必须覆盖新路径和关键行为。
   - 涉及 PDF、标注、文本层、阅读器状态时必须跑 `npm run verify`。

**本阶段不做：**

- 不重写整个 PDF 阅读器。
- 不引入新的 PDF 渲染库。
- 不做完整插件化标注系统。
- 不做全软件 UI 改版，本阶段只聚焦阅读器场景。
- 不接 OCR、自动翻译 API、复杂引用管理或完整 Zotero 级高级标注。
- 不改 SQLite schema，除非发现标注数据无法表达现有需求。

**阶段退出标准：**

- 阅读器功能缺口清单完成，并写入任务或设计文档。
- 阅读器 UI 调整方向明确，有可执行的布局和视觉规则。
- 用户可以完成：打开文献 -> 切换原文/译文 -> 阅读 -> 创建标注 -> 编辑/删除/撤销标注 -> 写笔记 -> 从关系或标注列表回跳。
- PDF 渲染、文本层、标注层、便签/批注交互有明确文件边界。
- 阅读器主区域、工具栏和右侧抽屉的视觉层级比当前更清晰。
- `npm run test:reader` 通过。
- `npm run verify` 通过。
- 阅读器相关任务可以分配给不同人，不再要求所有人同时改 `PdfReader.tsx`。

**建议本阶段第一批任务：**

```text
P2R-0 梳理阅读器功能缺口和第一版功能基线
P2R-1 制定阅读器 UI 调整方案
P2R-2 拆 PdfReader 类型和 helper
P2R-3 拆 PdfPageView 和 PdfTextLayer
P2R-4 拆 AnnotationOverlay 和 AnnotationMark
P2R-5 拆阅读器交互 helper
P2R-6 阅读器视觉低噪音调整
```

## 5. 阶段 2 任务：阅读器核心功能补全与 UI 重整

### Task P2R-0: 梳理阅读器功能缺口和第一版功能基线

**状态：** Ready

**建议分支：**

```text
docs/reader-feature-baseline
```

**负责人角色：** Reader / Product

**影响文件：**

```text
docs/notes/READER_BASELINE.md
docs/notes/DEVELOPMENT_TASKS.md
```

**目标：**

把当前阅读器功能按“已实现、部分实现、未实现、本阶段不做”梳理清楚，并定义阶段 2 的第一版阅读器功能基线。

**验收标准：**

- 文档中列出 PDF 阅读、原文/译文切换、布局模式、标注工具、笔记、AI、关系回跳、持久化、快捷键和错误状态。
- 每项能力都有状态：`done / partial / missing / later`。
- 阶段 2 必做范围和不做范围清楚。
- 后续 P2R 任务能对应到缺口清单。

**验证命令：**

```powershell
npm run test:architecture
```

### Task P2R-1: 制定阅读器 UI 调整方案

**状态：** Backlog

**建议分支：**

```text
docs/reader-ui-direction
```

**负责人角色：** Reader / UI System

**影响文件：**

```text
docs/notes/READER_UI_DIRECTION.md
docs/notes/UI_GUIDELINES.md
docs/notes/DEVELOPMENT_TASKS.md
```

**目标：**

明确阅读器 UI 的布局、工具栏、右侧抽屉、标注工具、笔记/AI/关系面板和专注模式调整方向。

**验收标准：**

- 文档说明阅读器主区域、工具栏、右侧抽屉、底部/浮层入口如何组织。
- 文档说明哪些按钮保留常驻，哪些进入抽屉、菜单或命令面板。
- 文档说明视觉目标：低噪音、高密度、阅读空间优先。
- 后续 UI 实现任务能直接按文档拆分。

**验证命令：**

```powershell
npm run test:architecture
```

### Task P2R-2: 拆 `PdfReader` 类型和 helper

**状态：** Backlog

**建议分支：**

```text
refactor/reader-pdf-types-helpers
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/PdfReader.tsx
src/features/reader/pdf/types.ts
src/features/reader/pdf/pdfGeometry.ts
src/features/reader/pdf/pdfAnnotationHelpers.ts
scripts/verify-reader-rendering.mjs
```

**目标：**

先把 `PdfReader.tsx` 中的类型定义和纯 helper 函数移出，减少主文件体积。只移动代码，不改变行为。

**验收标准：**

- `PageMeta`、`TextItemBox`、`RectBox`、`AnnotationMarkModel`、`DragDraft` 等类型进入 `types.ts`。
- 坐标、矩形、选区、颜色和样式相关纯函数进入 helper 文件。
- `PdfReader.tsx` 行数明显下降。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P2R-3: 拆 `PdfPageView` 和 `PdfTextLayer`

**状态：** Backlog

**建议分支：**

```text
refactor/reader-pdf-page-view
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/PdfReader.tsx
src/features/reader/pdf/PdfPageView.tsx
src/features/reader/pdf/PdfTextLayer.tsx
src/features/reader/pdf/types.ts
scripts/verify-reader-rendering.mjs
```

**目标：**

把 PDF 单页渲染和文本层渲染从 `PdfReader.tsx` 中拆出，让页面渲染逻辑可以独立维护。

**验收标准：**

- `PdfPageView` 在独立文件中。
- `PdfTextLayer` 在独立文件中。
- PDF.js 渲染质量、输出缩放和渲染序列保护不回退。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P2R-4: 拆 `AnnotationOverlay` 和 `AnnotationMark`

**状态：** Backlog

**建议分支：**

```text
refactor/reader-annotation-overlay
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/PdfReader.tsx
src/features/reader/pdf/AnnotationOverlay.tsx
src/features/reader/pdf/AnnotationMark.tsx
src/features/reader/pdf/types.ts
scripts/verify-reader-rendering.mjs
```

**目标：**

把标注层和单个标注渲染从 `PdfReader.tsx` 中拆出，给后续标注体验打磨留出独立边界。

**验收标准：**

- 高亮、下划线、区域框选、批注、便签继续显示。
- 双击便签、编辑批注、删除、追加到笔记等行为不回退。
- 当前文件 `file_id` 过滤仍有效。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P2R-5: 拆 PDF 交互 helper

**状态：** Backlog

**建议分支：**

```text
refactor/reader-pdf-interaction-helpers
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/PdfReader.tsx
src/features/reader/pdf/pdfInteraction.ts
src/features/reader/pdf/pdfSelection.ts
src/features/reader/pdf/types.ts
scripts/verify-reader-rendering.mjs
```

**目标：**

把拖拽、选区合并、当前页判断、滚动回跳等交互 helper 独立出来。降低后续修改标注交互时的风险。

**验收标准：**

- 鼠标拖拽创建标注行为不变。
- 文本选择高亮行为不变。
- 点击关系面板对象回跳页码和标注行为不变。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P2R-6: 阅读器视觉低噪音调整

**状态：** Backlog

**建议分支：**

```text
ui/reader-low-noise-pass
```

**负责人角色：** Reader / UI System

**影响文件：**

```text
src/ui/styles/reader.css
src/features/reader/ReaderToolbar.tsx
src/features/reader/ReaderSideDrawer.tsx
src/features/reader/AnnotationListPanel.tsx
```

**目标：**

在不重做 UI 的前提下，降低阅读器视觉噪音，让 PDF 主区域更突出。

**验收标准：**

- 工具栏更紧凑但不影响可发现性。
- 右侧抽屉层级更轻。
- 标注列表更易扫读。
- PDF 主区域不被过多背景、边框或按钮干扰。
- `npm run build` 通过。
- `npm run test:reader` 通过。

**验证命令：**

```powershell
npm run build
npm run test:reader
```

## 6. P1 任务：设计系统和模块完善

### Task P1-1: 建立 `shared/ui/Button`

**状态：** Done

**建议分支：**

```text
feature/shared-ui-button
```

**负责人角色：** UI System

**影响文件：**

```text
src/shared/ui/Button.tsx
src/shared/ui/index.ts
src/ui/styles/components.css
```

**目标：**

建立统一按钮组件，先支持 `variant`、`size`、`danger`、`disabled` 和 `title`。

**验收标准：**

- 新增 `Button` 组件。
- 至少在一个低风险位置替换原生按钮，例如设置页或空状态。
- 不改变现有功能。
- `npm run build` 通过。

**验证命令：**

```powershell
npm run build
```

### Task P1-2: 建立 `shared/ui/Panel`

**状态：** Done

**建议分支：**

```text
feature/shared-ui-panel
```

**负责人角色：** UI System

**影响文件：**

```text
src/shared/ui/Panel.tsx
src/shared/ui/index.ts
src/ui/styles/components.css
src/features/settings/index.tsx
```

**目标：**

建立统一面板组件，替换设置页中低风险的 `soft-panel` 用法。

**验收标准：**

- `Panel` 支持标题、描述、children。
- 设置页至少 2 个面板使用 `Panel`。
- 视觉保持接近现有样式。
- `npm run build` 通过。

**验证命令：**

```powershell
npm run build
```

### Task P1-3: 抽 `useImportFlow`

**状态：** Backlog

**建议分支：**

```text
refactor/library-use-import-flow
```

**负责人角色：** Library / Platform

**影响文件：**

```text
src/ui/App.tsx
src/features/library/useImportFlow.ts
src/features/library/index.ts
src/features/library/ImportDialog.tsx
scripts/verify-core-smoke.mjs
```

**目标：**

把 PDF 选择、元数据提取、导入确认、导入后进入阅读器的流程从 `App.tsx` 抽成 library hook。

**验收标准：**

- 浏览器预览模式仍能 mock 导入。
- Tauri 模式仍调用 `selectPdfFile`、`extractPdfMetadata`、`importPdfToLibrary`。
- 导入后文献出现在文献库。
- 空标签仍兜底为“未分类”。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run verify
```

### Task P1-4: 抽 `useChatThreads`

**状态：** Backlog

**建议分支：**

```text
refactor/ai-use-chat-threads
```

**负责人角色：** AI

**影响文件：**

```text
src/ui/App.tsx
src/features/ai/useChatThreads.ts
src/features/ai/index.ts
src/core/aiProviders.ts
scripts/verify-ui-state.mjs
```

**目标：**

把本地 AI 线程状态、草稿、发送、清空、上下文绑定逻辑从 `App.tsx` 抽到 AI 模块。

**验收标准：**

- AI 对话仍绑定当前文献。
- `runAiProvider()` 仍接收 `KnowledgeGraphSnapshot`。
- AI 使用过的上下文仍能写入 `AiThreadContext`。
- `npm run test:ui-state` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:ui-state
npm run verify
```

## 7. P2 任务：后端和长期结构

### Task P2-1: 拆分 `src-tauri/src/lib.rs`

**状态：** Backlog

**建议分支：**

```text
refactor/tauri-command-modules
```

**负责人角色：** Backend

**影响文件：**

```text
src-tauri/src/lib.rs
src-tauri/src/commands/mod.rs
src-tauri/src/database/mod.rs
src-tauri/src/files/mod.rs
src-tauri/src/import/mod.rs
src-tauri/src/annotations/mod.rs
src-tauri/src/backup/mod.rs
```

**目标：**

按领域拆分 Rust 后端大文件，保持 Tauri command 对外名称不变。

**验收标准：**

- 现有 Tauri command 名称不变。
- 现有 Rust 测试全部通过。
- 前端 `nativeApi.ts` 不需要因为拆文件而改调用名称。
- `cargo test --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

### Task P2-2: 建立 `features/relations` 真实入口

**状态：** Backlog

**建议分支：**

```text
feature/relations-panel-module
```

**负责人角色：** Core / Relations

**影响文件：**

```text
src/features/relations/index.ts
src/features/relations/RelationList.tsx
src/features/relations/types.ts
src/features/reader/RelationPanel.tsx
src/features/library/LibraryDetailPanel.tsx
```

**目标：**

把关系展示的通用 UI 从 reader/library 中抽出来，形成 relations feature 入口。

**验收标准：**

- reader 和 library 使用同一个关系列表组件。
- `features/relations/index.ts` 不再是空导出。
- `buildPaperRelationView()` 仍在 `core/relations.ts`。
- `npm run build` 通过。
- `npm run test:architecture` 通过。

**验证命令：**

```powershell
npm run build
npm run test:architecture
```

## 8. 分配建议

可以并行的任务：

```text
P2R-0 梳理阅读器功能缺口和第一版功能基线
P2R-1 制定阅读器 UI 调整方案
P1-3 抽 useImportFlow
P1-4 抽 useChatThreads
```

需要串行或谨慎安排的任务：

```text
P2R-0 和 P2R-1 是阶段 2 前置任务，建议先完成，再进入 P2R-2 到 P2R-6。
P2R-2、P2R-3、P2R-4、P2R-5 都会改 PdfReader 相关文件，建议按顺序做，不要并行。
P2R-6 会改 reader.css 和阅读器组件，避免和 P2R-3/P2R-4 同时大改同一组件。
P1-3 useImportFlow 和 P1-4 useChatThreads 都会改 App.tsx，避免同时进行。
P2-1 Rust 后端拆分期间，避免其他人同时改 src-tauri/src/lib.rs。
```

建议第一批领取：

```text
1. P2R-0 梳理阅读器功能缺口和第一版功能基线
2. P2R-1 制定阅读器 UI 调整方案
3. P2R-2 拆 PdfReader 类型和 helper
```
