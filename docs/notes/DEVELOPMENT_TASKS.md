# Aster 协作任务队列

> 本文件保留旧阶段任务和功能拆分细节。当前产品已经转向“项目工作台 + 本地 Agent CLI + 可插拔知识工具”，新的阶段顺序和待执行任务以 `AI_DEVELOPMENT_PLAN.md` 为准。

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

> 阶段 1、阶段 2 已完成；阶段 3（阅读器 UI 全面重组）暂停；阶段 12（项目工作台外壳）已完成，见第 12 节。下一批任务以 `AI_DEVELOPMENT_PLAN.md` 第 16 节为准。

历史优先级（阶段 1 至阶段 3 期间使用）：

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

**阶段状态：** Done

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

**状态：** Done

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

把当前阅读器功能按“已实现、部分实现、未实现、本阶段不做”梳理清楚，并定义阶段 2 的第一版阅读器功能基线。当前基线见 `READER_BASELINE.md`。

**验收标准：**

- `READER_BASELINE.md` 列出 PDF 阅读、原文/译文切换、并排同步、阅读辅助抽屉、标注工具、笔记、AI、标注引用和回跳。
- 每项能力都有状态：`done / partial / missing / later`。
- 阶段 2 必做范围和不做范围清楚。
- 后续 P2R 任务能对应到缺口清单。

**验证命令：**

```powershell
npm run test:architecture
```

### Task P2R-1: 制定阅读器 UI 调整方案

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

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

**状态：** Done

**建议分支：**

```text
refactor/tauri-command-modules
```

**负责人角色：** Backend

**影响文件：**

```text
src-tauri/src/lib.rs                     （2799 行 -> 97 行，只剩模块表 + 注册段 + run()）
src-tauri/src/app_paths.rs               （新增，123 行）
src-tauri/src/database.rs                （新增，81 行）
src-tauri/src/guide.rs                   （新增，95 行）
src-tauri/src/diagnostics.rs             （新增，126 行）
src-tauri/src/backup.rs                  （新增，103 行）
src-tauri/src/pdf_metadata.rs            （新增，383 行）
src-tauri/src/library_import.rs          （新增，391 行）
src-tauri/src/library_papers.rs          （新增，302 行）
src-tauri/src/library_annotations.rs     （新增，296 行）
src-tauri/src/library_notes.rs           （新增，79 行）
src-tauri/src/library_ai.rs              （新增，210 行）
src-tauri/src/library_tests.rs           （新增，418 行，整块 mod tests 原样搬过来）
src-tauri/src/project_commands.rs        （新增，54 行）
src-tauri/src/state_commands.rs          （新增，89 行）
src-tauri/src/workbench_store.rs         （9 处 crate:: -> crate::database::）
src-tauri/src/agent_history.rs           （3 处同样的改名）
scripts/verify-all.mjs                   （格式串断言改读 app_paths.rs）
scripts/verify-core-smoke.mjs            （两条断言改读 library_import.rs）
scripts/verify-reader-rendering.mjs      （同上）
scripts/verify-architecture-boundaries.mjs（新增 lib.rs 形状断言 + CLI-4 那道墙改指 state_commands.rs）
```

**目标：** 按领域拆分 Rust 后端大文件，保持 Tauri command 对外名称不变。

#### 1. 一个领域一个文件，而不是一个 `commands.rs`

原计划是 `commands/ database/ import/ annotations/ backup/` 五个目录。实际落地成平铺的领域文件：**命令、它的 DTO、它的 database 函数放在同一个模块里**。理由是可见性 —— DTO 如果集中在共享类型文件里，每个字段都得对外开放；跟着命令走的话，`ImportPdfRequest` 的字段只在 `library_import.rs` 里可见。真的有一个领域涨到几百行以上时再把它变成目录。

#### 2. 为什么 diff 里只有搬动

crate 根里的私有项对**所有后代模块**本来就是可见的，所以搬出去时把它们改成 `pub(crate)` 恰好保住原来的可达范围，一个调用点都不用改。命令本身变成 `pub fn`（`generate_handler!` 要从外面点名），DTO 也一并 `pub(crate)`，这样有效可见性两边相等，`private_interfaces` 那条 lint 不会响。全部 152 个顶层项由一个一次性脚本搬（脚本会双向校验项与模块的映射表，任何没被归类的项直接报错终止），所以没有"漏搬一个函数还编译得过"的可能。

#### 3. `library_tests.rs` 里的 `mod tests` 是嵌套的

5 个端到端测试每一个都横跨导入、标签、笔记、标注、AI 会话好几个领域 —— 按模块拆开测，恰好会停止覆盖它们要守的那道接缝，所以整块 `#[cfg(test)] mod tests { ... }` 原样搬进一个文件，只在上面补 `use crate::...`。测试体一行没改：断言什么没变，只是它调的函数换了住处。

#### 4. 拆完之后加了三条防回流断言

`lib.rs` 现在是 97 行，但"现在很短"不是不变量。`npm run test:architecture` 因此断言：里面不许出现 `#[tauri::command]`，不许出现 `rusqlite` / `params!` / `Connection`，行数必须小于 160，十三个领域模块都在模块表里，且 `generate_handler!` 的每个条目都必须写成 `模块::命令` —— 少了最后这条，一个命令体可以搬回 crate 根还照样被注册，然后这个文件就开始长回 2800 行。

#### 5. 验收结论

- `cargo check --all-targets`：0 error、0 warning。中途出过 12 个 `E0425`（`workbench_store.rs` / `agent_history.rs` 还在按 `crate::current_timestamp_ms` 这样的老路径调三个已搬到 `database` 的函数）和 3 个 unused import，两轮都是改脚本重跑，不是手工补丁。
- `cargo test --manifest-path src-tauri/Cargo.toml`：**115 passed; 0 failed**，与拆分前一模一样（`agent_cli` 75、`workbench_store` 15、`agent_history` 10、`agent_bridge` 3、`workspace_fs` 7、`library_tests` 5）。
- `rustfmt --edition 2021` 对 17 个动过的文件退出码 0。
- `npm run verify` 全绿（14 步，末尾 `A4Note verification passed`）。三个验证脚本里指向 `lib.rs` 的断言改成指向搬过去的模块，断言内容本身没有放松。

**验证命令：**

```powershell
Set-Location D:\WorkSpace\Aster
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
P2-1 Rust 后端拆分已完成；后续改后端只需注意 lib.rs 的注册段（一个命令一行），不再有整文件争用。
```

建议第一批领取：

```text
1. P2R-0 梳理阅读器功能缺口和第一版功能基线
2. P2R-1 制定阅读器 UI 调整方案
3. P2R-2 拆 PdfReader 类型和 helper
```

---

## 9. 阶段 3：阅读器 UI 全面重组

**阶段状态：** Paused

**设计文档：** `docs/notes/READER_UI_REDESIGN.md`

**暂停原因：** 用户后续明确要求撤销标签页式设计方向。阶段 3 旧方案暂时只作为历史归档保留，不应继续执行；当前阅读器 UI 工作以现有结构上的工具栏优化、常用入口直达和标注工具可见性为主。

**阶段目标：**

在阶段 2 完成的代码边界拆分和低噪音视觉调整基础上，对阅读器进行全面的 UI 重组，使其具备成熟文献阅读工具的布局能力：三区布局（左侧导航 + PDF 主区 + 右侧辅助）、工具栏三区化、右侧 tab 收敛、PDF 大纲面板和选中弹出标注工具。

**核心目标：**

1. 抽取 `ReaderContext`，消除 App.tsx 向 ReaderScene 传递 ~30 个 props 的现状，为后续 UI 扩展打好基础。
2. 工具栏从单行全塞改为左/中/右三区，功能分组清晰。
3. 右侧抽屉 tab 从 4 个收敛为 3 个（笔记 / AI / 引用）。
4. 新增左侧可折叠面板，第一版实现 PDF 目录大纲。
5. 新增文字选中弹出工具（SelectionPopup），参考 Zotero 模式。
6. App Shell scene rail 视觉细化（宽度 52px，active 状态带 label）。

**阶段退出标准：**

- `ReaderContext` 建立，子组件通过 context 取状态，不再依赖 ~30 个 props 链。
- 工具栏三区化，高度 ≤ 38px，PDF/Markdown 模式下控件正确显示/隐藏。
- 右侧 tab 为 3 个（笔记 / AI / 引用），引用 tab 内包含标注列表和文献关系。
- 左侧面板可以通过工具栏 icon 折叠/展开，PDF 大纲可点击跳页。
- 选中文本后弹出快捷标注工具，点击直接创建标注。
- Scene rail 宽 52px，active 状态有中文 label。
- `npm run verify` 通过。
- `npm run build` 通过。

**本阶段不做：**

- 不做页面缩略图面板。
- 不做完整标注筛选/导出。
- 不做 Obsidian 双链。
- 不做多窗口 / docking。
- 不引入新的 UI 框架。
- 不重写 PDF.js 渲染策略。
- 不改标注数据模型。

## 10. 阶段 3 任务

> 暂停说明：以下 P3 任务来自旧的标签页式/全面重组方案。除非用户重新确认恢复该方案，否则不要继续按这些任务拆阅读器 UI。

### Task P3R-0: 抽取 ReaderContext

**状态：** Paused

**建议分支：**

```text
refactor/reader-context
```

**负责人角色：** Reader / Workbench

**影响文件：**

```text
src/features/reader/ReaderContext.tsx        新建
src/features/reader/index.ts                 导出 ReaderProvider / useReaderContext
src/features/reader/ReaderScene.tsx          包裹 ReaderProvider，去掉 ~30 个 prop
src/features/reader/ReaderToolbar.tsx        改用 useReaderContext
src/features/reader/ReaderDocumentPane.tsx   改用 useReaderContext
src/features/reader/ReaderSideDrawer.tsx     改用 useReaderContext
src/features/reader/AnnotationListPanel.tsx  改用 useReaderContext
src/features/reader/ReaderMarkdown.tsx       改用 useReaderContext
src/ui/App.tsx                               传入 annotationHandlers 和 paper，减少 reader props
```

**目标：**

把 App.tsx 中的 reader 状态迁入 `ReaderContext`。迁移策略：App.tsx 仍持有状态初值，通过 `initialState` + `onPersistState` 与 context 同步，避免一次性重写引发功能回退。

**验收标准：**

- `ReaderScene` 的 props 从 ~30 个减少到 ≤ 8 个（paper、initialState、onPersistState、annotationHandlers、noteSave、noteCreate、aiThreadContexts、sidePanels）。
- 所有原有功能（模式切换、缩放、页码跳转、标注、笔记、AI、关系、撤销/重做）行为不回退。
- `npm run test:reader` 通过。
- `npm run verify` 通过。

**验证命令：**

```powershell
npm run test:reader
npm run verify
```

### Task P3R-1: 工具栏三区重组

**状态：** Backlog（依赖 P3R-0 完成）

**建议分支：**

```text
ui/reader-toolbar-three-section
```

**负责人角色：** Reader / UI System

**影响文件：**

```text
src/features/reader/ReaderToolbar.tsx
src/ui/styles/reader.css
```

**目标：**

把工具栏从单行全塞改为左/中/右三区。去掉 `reader-title-block`。中区只在 PDF 模式显示标注工具；左区放文件模式和左面板开关；右区放缩放、布局和面板开关。工具栏高度降至 38px。

**验收标准：**

- 三区布局：`.reader-toolbar-left`、`.reader-toolbar-center`、`.reader-toolbar-right`。
- Markdown 模式下中区（标注工具）隐藏。
- 所有现有控件功能不变，只是重新分组。
- 工具栏高度 ≤ 38px。
- `npm run build` 通过，`npm run test:reader` 通过。

**验证命令：**

```powershell
npm run build
npm run test:reader
```

### Task P3R-2: 右侧抽屉 Tab 收敛

**状态：** Backlog（可与 P3R-1 并行，依赖 P3R-0）

**建议分支：**

```text
ui/reader-drawer-cite-tab
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/ReaderSidePanelContent.tsx
src/features/reader/CitationPanel.tsx              新建
src/features/reader/readerHelpers.ts
src/features/reader/types.ts
src/core/types.ts
src/ui/styles/reader.css
```

**目标：**

把右侧抽屉 tab 从 `notes / annotations / chat / relations` 收敛为 `notes / chat / cite`。新建 `CitationPanel.tsx`，内部用折叠区组织 `AnnotationListPanel` 和 `RelationPanel`。`ReaderSidePanelTab` 类型增加 `'cite'`，移除 `'annotations'` 和 `'relations'`（内部实现文件保留不改）。

**验收标准：**

- 右侧抽屉只有 3 个 tab：笔记 / AI / 引用。
- 引用 tab 内标注列表和文献关系可展示，仍可点击跳转。
- 所有已有标注跳转、引用回跳行为不回退。
- `npm run test:reader` 通过，`npm run verify` 通过。

**验证命令：**


```powershell
npm run test:reader
npm run verify
```


### Task P3R-3: 左侧面板 — PDF 大纲

**状态：** Backlog（依赖 P3R-0、P3R-1 完成）

**建议分支：**

```text
feature/reader-left-panel-outline
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/ReaderLeftPanel.tsx          新建
src/features/reader/pdf/PdfOutlinePanel.tsx      新建
src/features/reader/ReaderScene.tsx              集成左侧面板
src/features/reader/ReaderToolbar.tsx            左区加左面板开关
src/ui/styles/reader.css
```

**目标：**

新增可折叠左侧面板，第一版只实现 PDF 大纲（Outline/目录）。调用 `pdfDocument.getOutline()` 获取书签结构，批量解析页码（`pdfDocument.getPageIndex()`），渲染为可点击条目列表，点击跳转对应页码。支持多级层次缩进（最多 4 层）。无大纲的 PDF 显示空状态提示。

**验收标准：**

- 工具栏左区有大纲开关 icon，点击折叠/展开左侧面板（240px ↔ 0）。
- 有大纲的 PDF：显示层级目录，点击跳转。
- 无大纲的 PDF："本文档没有目录"。
- Markdown 模式下左侧面板隐藏。
- 折叠/展开使用 CSS transition（≤ 150ms）。
- `npm run build` 通过，`npm run test:reader` 通过。

**验证命令：**

```powershell
npm run build
npm run test:reader
```

### Task P3R-4: 文字选中弹出标注工具（SelectionPopup）

**状态：** Backlog（依赖 P3R-0 完成）

**建议分支：**

```text
feature/reader-selection-popup
```

**负责人角色：** Reader

**影响文件：**

```text
src/features/reader/pdf/SelectionPopup.tsx       新建
src/features/reader/pdf/PdfReader.tsx            集成 SelectionPopup
src/ui/styles/reader.css
```

**目标：**

参考 Zotero 模式，在用户鼠标选中文本后，在选区右上角弹出浮层，包含：高亮、下划线、添加批注（3 个按钮） + 当前颜色色块。点击即创建标注，无需提前切换工具。工具栏处于 locked 模式（高亮/下划线工具激活）时不显示弹层，保持现有行为。

**验收标准：**

- 光标模式下选中文本后弹出 SelectionPopup，位置在选区右上方。
- 点击高亮/下划线按钮：用当前颜色立即创建对应标注，弹层消失。
- 点击批注按钮：创建高亮，弹出批注编辑 popover。
- 点击外部或按 Escape：弹层消失，不创建标注。
- 工具栏处于 locked 模式时 SelectionPopup 不出现。
- `npm run test:reader` 通过，`npm run build` 通过。

**验证命令：**

```powershell
npm run build
npm run test:reader
```

### Task P3U-1: App Shell 视觉细化

**状态：** Superseded（被第 12 节「项目工作台外壳」取代，不再执行）

**取代原因：**

本任务的改造目标是 `.app-shell` + `.scene-rail` + `.scene-button` 这套竖排图标导航。项目工作台外壳落地后，这些类已从 `src/ui/App.tsx` 和 `src/ui/styles/layout.css` 中删除，导航改为「左侧项目/工作区树 + 顶栏 + 标签页」结构，样式集中在 `src/ui/styles/workbench.css`。`scripts/verify-architecture-boundaries.mjs` 现在会断言 `App.tsx` 与 `layout.css` 不再出现 `scene-rail` / `scene-host`，因此本任务的验收标准已经不可能成立。

侧边栏视觉细化的后续需求请直接在第 12 节的工作台任务下提出。

**原始内容（仅存档）：**

将 scene-rail 宽度从 44px 扩至 52px，scene-button 从 34px 扩至 38px。active 状态在 icon 下方加中文 label（2–3字，10px，字重 600）。非 active 状态不显示 label，保持紧凑。

## 11. 阶段 3 分配建议

可以并行的任务：

```text
P3R-1  工具栏三区重组（依赖 P3R-0）
P3R-2  右侧抽屉 tab 收敛（依赖 P3R-0）
P3R-4  SelectionPopup（依赖 P3R-0）
```

需要串行或谨慎安排的任务：

```text
P3R-0  ReaderContext 是阶段 3 前置，必须优先完成，再进入 P3R-1 至 P3R-4。
P3R-3  左侧面板依赖 P3R-0（状态）和 P3R-1（左区工具栏开关），建议 P3R-1 后进行。
P3R-1 和 P3R-2 都会改 ReaderToolbar / ReaderSidePanelContent，避免同时进行。
P3R-4 会改 PdfReader.tsx，避免与 P3R-3 同时大改同一区域。
P3U-1 已被第 12 节取代，不要再领取。
```

建议第一批领取：

```text
1. P3R-0  抽取 ReaderContext（前置，优先）
```

## 12. 阶段 12：项目工作台外壳（已完成）

**阶段状态：** Done

本节记录已经落地的「项目工作台」阶段。任务 ID 与 `AI_DEVELOPMENT_PLAN.md` 第 11 节的阶段 B/C 一致，这里只补充实际影响文件、验收结论和回归入口。末尾额外记录阶段 D 的前两个任务：`CLI-0`（协议层，无进程）与 `CLI-1`（真实子进程与会话 supervisor，无 Tauri 命令）。


产品结构从「场景导航（scene-rail）」改为：

```text
左侧项目 / 工作区树
  + 顶栏（项目路径、VS Code、资源管理器、文件树开关、新建 Agent 会话）
  + 单行标签页（tab strip）
  + 可选左侧文件树 + 标签内容区 + 设置覆盖层
```

原有的 overview / library / reader / aiChat 四个场景没有重写，而是作为 `kind: 'tool'` 标签页托管在 TabHost 里，`activeScene` 从当前激活的 tool 标签派生，所以阅读器快捷键和命令面板行为保持不变。

### Task PWS-0: Project/Workspace/Tab/AgentSession 纯模型

**状态：** Done

**负责人角色：** Workbench/Core

**影响文件：**

```text
src/core/workspace.ts
src/workbench/workspaceStore.ts
scripts/verify-workspace-model.mjs
package.json
```

**已实现：**

- `src/core/workspace.ts` 是纯数据 + 纯迁移：不引用 React、Tauri 和任何 storage。所有 mutation 返回新 state；没有变化时返回同一个对象引用，`workspaceStore.commit()` 据此跳过空提交和空持久化。
- 模型：`Project`（含 `kind: 'folder' | 'builtin'`）、`Workspace`（含 `layout` 与内联 `tabs`）、`WorkspaceTab`（含 `key` / `pinned` / `order` / `state`）、`AgentSession`（含 `permissionMode` 与 `status`）。
- 标签按 `key` 去重：重复打开同一资源只会激活已有标签。排序规则为 pinned 优先，然后按 `order`，`reindexTabs` 保证 order 连续。
- 关闭标签不会删除对应的 `AgentSession`（历史比标签活得久）；删除会话会连带关闭绑定它的标签。
- `agentSessionTransitions` 定义状态机，非法迁移被拒绝并返回未变更的 state，而不是抛错。
- `deserializeWorkbenchState` / `normalizeWorkbenchState` 接受任意输入（旧快照、手改文件）：丢弃无效项目/工作区/会话，修复 `activeProjectId` / `activeWorkspaceId` / `activeTabId`，解绑指向已消失会话的标签，并把重载时处于 `starting` / `running` / `stopping` 的会话恢复为 `failed`（进程不可能跨重载存活）。
- 删除 Project 只移除 Aster 记录，模型层从不触碰磁盘文件。

**验证命令：**

```powershell
npm run test:workspace
npm run verify
```

### Task RES-0 / RES-1 / RES-3: 项目文件夹、文件树与外部打开

**状态：** Done

**负责人角色：** Native/Resources

**影响文件：**

```text
src-tauri/src/workspace_fs.rs
src-tauri/src/lib.rs
src/platform/projects/projectApi.ts
src/platform/projects/index.ts
src/features/explorer/FileTreePanel.tsx
src/features/explorer/FileTab.tsx
src/features/explorer/index.ts
```

**已实现（RES-0 选择文件夹）：**

- `selectProjectFolder()` 通过 `@tauri-apps/plugin-dialog` 选目录，用户取消返回 `null`。
- `describe_project_folder` 返回 `{ path, name, exists, is_directory }`，路径失效时前端能显示明确状态而不是静默失败。
- 同一规范化路径不重复建 Project：`findProjectByRootPath` + `normalizeProjectPath`（统一分隔符、去尾斜杠、小写）。

**已实现（RES-1 文件树）：**

- `list_directory_entries` 单层读取，懒加载展开，不递归整棵树。
- 生成目录（`node_modules`、`target`、`.git` 等，见 `IGNORED_DIRECTORY_NAMES`）默认跳过；单目录条目上限 `MAX_DIRECTORY_ENTRIES = 2000`，超出时返回 `truncated: true`。
- 排序：目录优先，然后按名称不区分大小写。
- `read_text_file_preview` 只读文件头部（`MAX_TEXT_PREVIEW_BYTES = 256 KiB`），二进制文件返回 `binary: true` 而不是乱码。

**已实现（RES-3 外部打开）：**

- `reveal_path`（资源管理器/Finder，文件通过所在文件夹定位）、`open_path_external`（系统默认应用）、`open_path_in_vscode`。
- VS Code 在 Unix 是 shell 脚本、在 Windows 是 `.cmd` shim，所以启动器走 shell 而不是直接 exec；命令名做字符白名单校验（`is_safe_command_char`），拒绝任何可被 shell 重新解释的输入。

**边界：**

- React 组件不调用 `invoke()`；只有 `src/platform/projects/projectApi.ts` 与后端对话。
- 文件树和文件标签属于 `features/explorer`，因为 `workbench/` 不允许依赖 `platform/`。

**验证命令：**

```powershell
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

### Task PWS-2: WorkbenchShell 整体界面重构

**状态：** Done

**负责人角色：** Workbench/Core + UI System

**影响文件：**

```text
src/workbench/WorkbenchShell.tsx
src/workbench/ProjectSidebar.tsx
src/workbench/WorkbenchTopBar.tsx
src/workbench/TabStrip.tsx
src/workbench/TabHost.tsx
src/workbench/useWorkbench.ts
src/workbench/workbenchLabels.ts
src/workbench/index.ts
src/features/agents/AgentSessionPanel.tsx
src/features/agents/useAgentProviders.ts
src/ui/App.tsx
src/ui/zh.ts
src/ui/styles/workbench.css
src/ui/styles/layout.css
```

**已实现：**

- `WorkbenchShell` 只做布局插槽：`sidebar / topBar / tabStrip / explorer / content / overlay / dialogs`，有文件树时切到 `workbench-shell with-explorer`。
- `ProjectSidebar`：品牌区、工具入口（overview / library / reader / aiChat）、项目列表（可展开出工作区与 Agent 会话）、底部命令面板与设置入口。
- `WorkbenchTopBar`：项目/工作区面包屑、文件树开关、打开 VS Code、在资源管理器中打开、按 Provider 新建 Agent 会话。
- `TabStrip`：单行标签，支持 pin、关闭、拖拽换位（`dragging` / `drop-target`）。
- `TabHost`：所有标签同时挂载，非激活标签用 `opacity/pointer-events/visibility` 隐藏，因此切回标签不会重挂 PDF 或聊天状态；无标签时渲染 `fallback` 空状态。
- `App.tsx` 用 `renderTabContent(tab)` 按 `tab.kind` 分发：`tool` -> 四个既有场景，`agent` -> `AgentSessionPanel`，`file` -> `FileTab`；未知 kind 返回 `null`，不渲染占位假入口。
- `activeScene` 由当前 tool 标签派生（`sceneFromToolTabKey`），`lastSceneRef` 在焦点落在 file/agent 标签时为 `saveUiState` 保留一个具体 `SceneId`。
- 设置改为 `workbench-overlay` 覆盖层，不再占用独立场景框。

**边界结论：**

- `src/workbench/**` 不 import `../ui/`、`../platform/`、`../features/`；组件通过 `labels`（`App` 传 `zh.workbench`）拿文案，通过 props 拿图标。
- `features/` 允许 import `../../ui/zh` 和 `platform/`，所以文件树、文件预览、Agent 面板都放在 `features/`。

**删除的旧结构：**

```text
.app-shell / .scene-rail / .scene-buttons / .scene-utility-buttons
.scene-button* / .scene-brand* / .workspace / .scene-host
.scene-frame* / .settings-frame
```

`scripts/verify-architecture-boundaries.mjs` 现在断言 `App.tsx` 渲染 `<WorkbenchShell>` / `<ProjectSidebar>` / `<WorkbenchTopBar>` / `<TabStrip>` / `<TabHost>`，且 `App.tsx` 与 `layout.css` 不再出现 `scene-rail` / `scene-host`。

**验收结论：**

- 左侧项目树与 tab strip 使用真实 `workspaceStore`，不复制业务状态。
- 四个既有场景通过兼容 TabHost 打开，阅读器快捷键与命令面板行为未变。
- `npm run verify` 全绿（含 12 个 Rust 测试）。

**验证命令：**

```powershell
npm run verify
```

### Task PWS-1: 工作台状态持久化到 SQLite

**状态：** Done

**负责人角色：** Workbench/Core + Native

**影响文件：**

```text
src-tauri/schema.sql
src-tauri/src/workbench_store.rs
src-tauri/src/lib.rs
src/platform/workbench/workbenchStorageApi.ts
src/platform/workbench/index.ts
src/workbench/useWorkbench.ts
src/workbench/index.ts
src/main.tsx
scripts/verify-workspace-model.mjs
scripts/verify-architecture-boundaries.mjs
```

**已实现：**

- `schema.sql` 追加 `workbench_state`（单行，`CHECK (id = 1)`）、`projects`、`workspaces`、`workspace_tabs`（含 `workspace_tabs_workspace_order` 索引）、`agent_sessions`；`order` / `key` 落库为 `tab_order` / `tab_key`，时间戳统一 ISO-8601 TEXT。`initialize_database` 每次启动跑 `CREATE TABLE IF NOT EXISTS`，所以追加即迁移。
- `workbench_store.rs` 是 repository：读取按 `ORDER BY rowid` 还原快照数组顺序、标签按 `ORDER BY tab_order`；写入在**单个事务**内先删子表再删父表然后全量插入（几十行，正确性优先于行级 diff，且不会残留已删项目的行）。单个标签的 `state_json` 解析失败时退化为空 map，不让一个坏标签拖垮整份快照。
- 命令边界搬运前端 `serializeWorkbenchState()` 的 JSON 文本：`load_workbench_state` 返回 `Option<String>`（从未保存过为 `null`），`save_workbench_state` 接收 `{ snapshot }`。Rust 侧仍反序列化成类型化记录，形状在进 SQL 前就被校验；`serde` 对未知字段宽容，新版前端加字段不会写坏旧后端。
- `src/platform/workbench/` 自己声明 `WorkbenchSnapshotStorage`，靠结构类型对接 `src/workbench` 的 `WorkbenchStorage`，依赖方向仍是 `platform -> core`。`read()` 保持同步（快照在 bootstrap 里 await 一次后缓存），`write()` 去抖 250 ms 并串行排队，`beforeunload` 冲刷。
- `main.tsx` 改为 async bootstrap：先 `createWorkbenchStorage()` 再 `configureWorkbenchStorage(storage)`，最后才 render——`App.tsx` 一看到空工作台就会播种内置项目，不能让它先看到空的。
- 首次运行把旧的 `localStorage['aster.workbench']` 迁进 SQLite 并保留原 key，便于降级回退。

**边界：**

- 只替换 `WorkbenchStorage` 适配器，调用方（`workspaceStore` / `useWorkbench` / 组件）未改。
- 不在桌面运行时、或 SQLite 读取失败时，`createWorkbenchStorage()` 返回 `null`，store 保持自带的 localStorage 默认适配器，绝不用伪造的空快照覆盖用户状态。
- `src/workbench/**` 依然不 import `platform/`：`configureWorkbenchStorage` 定义在 `workbench/`，由 `main.tsx` 调用。

**验收结论：**

- `cargo test` 22 个用例通过，其中 `workbench_store` 10 个：round-trip、标签按 `tab_order` 恢复、`state` 保真、坏 `state_json` 退化、重存不留已删项目的行、schema 可叠加到既有库、真实文件上的 JSON 边界、camelCase 形状与前端一致、新版前端未知字段不破坏保存。
- `verify-workspace-model.mjs` 新增存储适配器断言：从 `read()` 播种、只读不写、一次变更写一次、无变化不写不通知、退订后不再通知。
- `npm run verify` → `A4Note verification passed`。

**验证命令：**

```powershell
npm run test:workspace
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

### Task CLI-0: Agent CLI 统一协议、错误类型与内存夹具

**状态：** Done

**负责人角色：** Core + Native

**影响文件：**

```text
src/core/agentProtocol.ts
src/core/workspace.ts
src/features/agents/AgentSessionPanel.tsx
src/ui/zh.ts
src-tauri/src/agent_cli/mod.rs
src-tauri/src/agent_cli/protocol.rs
src-tauri/src/agent_cli/transport.rs
src-tauri/src/agent_cli/peer.rs
src-tauri/src/agent_cli/turn.rs
src-tauri/src/lib.rs
scripts/verify-agent-protocol.mjs
scripts/verify-workspace-model.mjs
scripts/verify-architecture-boundaries.mjs
scripts/verify-all.mjs
package.json
```

**已实现（前端契约）：**

- `src/core/agentProtocol.ts` 是纯 core：无 React、无 Tauri、无进程。`AgentEvent` 六种（`started` / `delta` / `tool` / `completed` / `stopped` / `failed`），每个事件都带 `sessionId` + `runId`。
- `AgentRunState` 的 `textMode: 'delta' | 'snapshot'` 在建回合时声明：增量式拼接，快照式整体替换，UI 不猜 Provider 语义。
- 不属于当前 `sessionId` / `runId` 的事件、以及空 `delta`，`applyAgentEvent` 返回**同一个引用**，React 侧不会因此重渲染。
- `started` 会清空残留文本：它表示这一回合从头开始，不是续传。
- `AgentRunGate`（`createAgentRunGate` / `bufferAgentEvent` / `openAgentRunGate`）解决"事件早于 runId 返回"：先缓冲，拿到 runId 后只重放匹配的，丢弃过期回合；没等到自己那个回合就什么都不重放。
- 一次失败只有一个 `AgentError`（`kind` / `message` / `detail` / `exitCode` / `signal`），整体透传，不拆成多个事件。

**已实现（Rust 协议层）：**

- `protocol.rs`：`JsonlDecoder` 按 `\n` 分帧、去 `\r`、跳空行、非 JSON 行降级为文本而不是致命错误，`flush()` 处理结尾没有换行的最后一行；`RpcFrame` 区分 Response / Error / Request / Notification / Payload / Unparsed（`Request` 是 CLI 反向发起的请求，`Payload` 是既没有 `id` 也没有 `method` 的裸对象 —— Claude Code 的方言全是这种，见 `CLI-3`）；`StderrTail` 只留尾部 8 KiB（`STDERR_TAIL_LIMIT`）并按字符边界裁剪；`AgentEvent` 用 `rename_all = "camelCase"` 序列化，字段名与前端一致，跨 Tauri 边界不需要二次翻译。
- `transport.rs`：`AgentTransport` trait（`write_line` / `read` / `close_stdin` / `take_stderr`）是唯一的 stdio 接缝，上面所有代码都不接触 `std::process::Child`；`InMemoryTransport` + `FakePeer` 是队列支撑的内存实现（`send_line` / `send_chunk` / `send_stderr` / `exit` / `written` / `stdin_closed`）。夹具**不是** `#[cfg(test)]`，`CLI-1` 可以直接复用。
- `peer.rs`：`AgentPeer` 按 `id` 关联请求，每请求可选 deadline（`None` = 永不超时，长回合用；`DEFAULT_REQUEST_TIMEOUT` 30 s）。写失败时不登记 pending；通知是 fire-and-forget，丢弃时累计 `dropped_writes`。进程退出只合成**一个** `termination_error`（消息由 exit code / signal 决定，detail 是 stderr 尾部，附 `exitCode` / `signal`），再 `fail_all()` 交给每个等待者。stderr 每次 pump 都排空，保证要解释终止时尾部已经在手上。未知响应 id 是 `PeerNotice::Orphan`，不是失败。
- `turn.rs`：`RunGate` 是前端 `AgentRunGate` 的 Rust 对应物（`buffer` / `open` / `accept` / `close`）。
- 整层**同步**、无 tokio：夹具可以一帧一帧地推进它。真实子进程传输在 `CLI-1` 实现同一个 trait。

**已实现（会话/回合语义修正）：**

- `AgentSessionStatus` 从 `idle | starting | running | stopping | completed | failed` 改为 `idle | starting | running | stopping | failed | closed`。一次回合结束是 `running -> idle`；`closed` 才是会话终态，且允许 `closed -> starting` 以支持恢复（`CLI-4`）。`idle -> running` 合法（进程是否活着只有 supervisor 知道），`closed -> running` / `failed -> running` 非法。
- 同批改：`agentSessionTransitions`、`src/ui/zh.ts` 的 `agentStatusClosed`、`AgentSessionPanel` 的 `statusLabels`。SQLite 不需要改，`schema.sql` 与 `workbench_store.rs` 把 status 当字符串列。

**边界：**

- **不注册任何 Tauri 命令。** `lib.rs` 只写 `pub mod agent_cli;`，`generate_handler!` 里没有 agent 条目；`AgentSessionPanel` 的输入框仍然禁用。`verify-architecture-boundaries.mjs` 把这两条写成断言（没有 `start_agent_session` / `send_agent_message` / `stop_agent_session`，有 `<textarea disabled`，没有 `onSend` / `onSubmit`），所以"不提前加入口"是被测试保护的，不只是约定。
- `src/core/agentProtocol.ts` 不 import `platform/` / `features/` / `ui/` / `workbench/` / `shared/` / `react` / `@tauri-apps`，同样由边界脚本逐条断言。
- 事件名在两种语言里必须同名：边界脚本对六个事件分别断言 TS 的 `type: 'x'` 与 Rust 的 `X {`。

**验收结论：**

- `cargo test --manifest-path src-tauri/Cargo.toml` **40 个通过**（此前 22 个），其中 `agent_cli` 18 个：跨 chunk 切分的帧、空行与非 JSON 行不断流、error 帧保留 Provider code、结尾无换行的最后一行、既非 response 也非 notification 的 JSON 归为文本、stderr 尾部按字符边界裁剪、事件字段名与 UI 一致、failure 事件终态且带 exit（以上 protocol）；新回合重放且旧回合丢弃、只接受打开的那个回合、close 忘掉回合与缓冲（turn）；响应与请求关联、流式通知保序、只有带 deadline 的请求会超时、一次非零退出只用一个错误答复所有等待者、stdin 关闭后拒绝请求并丢弃通知、意外响应 id 只是通知不是失败、干净退出后最后一帧仍会被解码（peer）。
- `npm run test:agent-protocol` → `verify-agent-protocol: ok`（14 组断言，含 gate 重放顺序 `早到 a` / `早到 b`）。
- `npm run test:workspace` → `verify-workspace-model: ok`（含"写入 `completed` 会被拒绝"）。
- `npm run test:architecture` → `Architecture boundary verification passed`。
- 五个新 Rust 文件 `rustfmt --check` 干净（`lib.rs` 的既有格式问题不在本任务范围内）。

**验证命令：**

```powershell
npm run test:agent-protocol
npm run test:workspace
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

### Task CLI-1: Rust process supervisor 与真实子进程传输

**状态：** Done

**负责人角色：** Native

**影响文件：**

```text
src-tauri/src/agent_cli/mod.rs
src-tauri/src/agent_cli/launch.rs
src-tauri/src/agent_cli/process.rs
src-tauri/src/agent_cli/supervisor.rs
scripts/verify-architecture-boundaries.mjs
```

**已实现（`launch.rs`：启动什么、在哪里、带什么环境）：**

- `LaunchConfig`（`program` / `args` / `working_directory` / `env`）+ `build_command()`。所有不用碰进程表就能失败的检查都在这里做完，坏配置不会变成半开的会话：命令名为空、命令名不合法、工作目录不存在都在 spawn 之前返回 `SpawnFailed`。
- `STRIPPED_ENV_VARS` = `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` / `CLAUDE_AGENT_SDK_VERSION`，`env_remove` 逐个删掉。**A4Note 自己就是在 Claude Code 里开发的**，这些变量在开发期一直是设着的；留着的话子 `claude` 会以为自己是嵌套会话（`CLI_REUSE_STRATEGY.md` §4.9）。
- Windows shim：`requires_shell()` 对非 `.exe` / `.com` 的程序名返回 true，走 `cmd /C <program> <args>`——npm 把 `codex` / `claude` 装成 `.cmd` / `.ps1` + 无扩展名三件套，只有真的 `.exe` 能直接执行。走 shell 就意味着注入风险，所以命令名和每个参数都过 `SHELL_METACHARACTERS`（`& | < > ^ " % \r \n`）检查，**发现即拒绝而不是转义**：A4Note 传的东西一个都不需要这些字符，出现就说明配置来自不可信输入。
- `CREATE_NO_WINDOW`：应用自己没有控制台（`windows_subsystem = "windows"`），不加这个标志每次启动会话都会闪一个黑框。
- Unix 侧 `process_group(0)`：让停止阶梯能对整棵树发信号，shim 的孙子进程才是会在单杀里活下来的那些。
- `resolve_program()` 按 `PATH`（Windows 上加 `PATHEXT`）查找裸命令名，路径形式的程序名当路径检查。必须先查：`cmd /C codex` 在 `codex` 不存在时也会启动成功，缺失的工具要到很久以后才以退出码 1 的形式浮现，先查一次才让 `NotInstalled` 在 Windows 上可达。

**已实现（`process.rs`：真实 `Child` 当作传输）：**

- `ChildTransport` 实现 `CLI-0` 的同一个 `AgentTransport` trait，**没有另起一套分帧**：它只搬运行，JSON 一个字都不认（边界脚本断言这个文件里没有 `JsonlDecoder`、也没有 `serde_json`）。
- 读取放在自己的线程上，因为 `AgentTransport::read` 必须能超时，而阻塞的管道读做不到；阻塞被挪出会话线程，输出以 channel item 的形式到达。`read` 先 `try_recv` 排空已经到的行再去付超时的代价，一串帧不会一帧一个等待。
- stdout 按行读（`read_until(b'\n')`）而不是定长 chunk：半个多字节字符做 lossy UTF-8 转换会毁掉中文输出，而行边界本来就是上层分帧的切点。stderr 同样一行一行喂给共享的 `StderrTail`。
- 停止是**阶梯而不是一次 `kill`**：stdin EOF（关掉 stdin 句柄本身就是 EOF）→ 宽限期内 reap → 软 tree-kill → 强制 tree-kill → 最后兜底杀掉我们自己 spawn 的那个。原因是这些 CLI 是 npm shim：`cmd /C claude` 是真正干活的那个进程的**祖父**，杀掉我们 spawn 的东西会把真正的那个留下来。Windows 用 `taskkill /PID <pid> /T`，Unix 用负 pid 对进程组发 `TERM` / `KILL`。
- `StopLadder`（`graceful` 2 s / `forceful` 1 s / `poll` 50 ms）与 `StopLadder::fast()`（200 / 300 / 10 ms）：同样的几级换成毫秒，测试能走完整条升级路径而不给测试套件加上几秒。
- 退出会**锁存**：第一次观察到就记下来，后续 `read` 继续报同一个退出而不是去阻塞在没人再写的流上。`impl Drop for ChildTransport` 保证被丢掉的传输不会留下还在跑的 CLI——不会再有人读它的输出了。
- 没能接上 stdio 或起不了读取线程时走 `abandon()`：这个 child 永远不会有传输拥有它，所以在这里就把整棵树结束掉，而不是漏一个没人观察的 CLI。
- 缺失的命令是唯一一种要换个说法的 spawn 失败：不是 bug，是工具没装，所以 `spawn_with` 在 spawn 之前先 `resolve_program`，返回 `NotInstalled`。

**已实现（`supervisor.rs`：一个会话一个线程，控制消息进，`AgentEvent` 出）：**

- 分工是这个文件的全部意义：Provider 适配器只懂一种 CLI 的协议，**不拥有**传输、pump 循环和 runId；那些都在这里，所以回合隔离、取消和退出清理只写一次，而不是每个 CLI 写一遍。
- `ProviderSession` trait 是 `CLI-2` / `CLI-3` 的接缝：`launch` / `connect`（默认实现就是 `ChildTransport::spawn`）/ `handshake` / `begin_turn` / `run_id` / `cancel_turn` / `translate`。适配器通过 `SessionIo`（`request` / `request_within` / `notify` / `await_response` / `call` / `stderr_tail`）说话，拿不到底层传输。
- **runId 由 supervisor 铸造**，形如 `{session_id}-{n}`：一个回合可能在 CLI 回答之前就失败，而像 codex 的 `conversationId` 这种句柄命名的是**会话**不是回合。Provider 自己的回合句柄记在旁边，只用来认出过期帧——`TurnFrame.run_id` 为 `None` 就保留，与记下的句柄不一致就丢弃。
- `handshake` 跑在**调用者线程**上，所以 `NotInstalled` / 握手失败是 `start()` 的 `Err` 返回值，不是事件。UI 还以为在启动的会话不该先收到事件。
- 每个会话一个线程 `a4note-agent-{session_id}`；`run()` 循环是 `try_recv` 控制消息 → `pump_once` → `resolve()` → `deliver()`。看到退出的那一轮 pump 也照样跑 resolve 和 deliver：CLI 可以在同一次读里发出最后一帧然后死掉。
- 一个回合**只发一个终态事件**：`push()` 是唯一出口（`gate.accept` 通过就发，终态时 `finish_run()`；回合还没打开就 `gate.buffer`，否则按过期丢弃），`resolve` 的失败路径会清掉 `self.run`，所以 pump 看到退出后的 `fail_open_run` 不会再补一个 `failed`。
- 回合进行中来的消息进 `queued` 队列，回合结束后自动接上，runId 递增（`s1-1` → `s1-2`）。
- `stop()` 先问 `provider.cancel_turn`：返回 true 就只置 `stopping` 并等 CLI 自己报结束（保住 transcript 顺序）；返回 false 就本地发 `stopped` 收尾。`Run.stopping` 让第二次 `stop()` 不再问一遍，不响应取消的 Provider 卡不死会话。
- 应用退出清理：`is_running` / `running_count` / `dispatch` 都看 `Arc<AtomicBool>`，`shutdown()` 第一件事就是把它清掉；`close()` 摘掉句柄并 `join` 线程（幂等），`close_all()` 遍历，`impl Drop for AgentSupervisor` 调 `close_all()`。会话 map 的锁中毒用 `into_inner()` 恢复而不是 panic——拒绝清理会漏 CLI 进程。
- 复用而不是重写：回合隔离直接用 `turn.rs` 的 `RunGate`，分帧和请求关联仍在 `protocol.rs` / `peer.rs`。边界脚本断言 supervisor 里没有 `JsonlDecoder`，也不认识 `rusqlite` / `workbench_store` / `tauri::`——CLI 永远不能写 Aster 的 SQLite。

**边界（`CLI-1` 当时的状态；已被下面的 `CLI-2` 取代，保留是为了记录当时为什么不注册命令）：**

- **`CLI-1` 仍然不注册任何 Tauri 命令。** 当时 `lib.rs` 里只有 `pub mod agent_cli;`，`generate_handler!` 里没有 agent 条目，`AgentSessionPanel` 的输入框是禁用占位。命令跟着第一个 Provider 适配器一起来——在真的能驱动一个会话之前，界面上不许出现看起来能发送的东西。**`CLI-2` 之后这三条断言已经翻面**：脚本现在断言五个命令都注册了、输入框不再是 `<textarea disabled`。
- `CLI-1` 结束时会话可以从 Rust 侧驱动（测试就是这么驱动的），但 UI 没有任何途径到达它；这条由 `CLI-2` 的 `agent_bridge.rs` 解除。
- 工作目录由调用者约束（Project 根目录或用户显式选择的文件夹）；`launch.rs` 只保证"路径不存在时在进程启动前就失败"。

**验收结论：**

- `cargo test --manifest-path src-tauri/Cargo.toml` **58 个通过**（此前 40 个），其中 `agent_cli` 36 个。新增 18 个：
  - `launch.rs` 5 个——父会话变量被删掉且额外变量保留、工作目录不存在在进程启动前失败、命令名里的 shell 元字符被拒绝（含空命令名）、shim shell 只在需要的地方用（Windows 上断言 `cmd /C codex app-server` 且参数也过元字符检查，非 Windows 上断言直接执行）、裸名字过 `PATH` 解析且缺失的报不存在。
  - `process.rs` 4 个——读到行 / stderr / 退出码且关闭后的流继续报同一个退出、写一行且子进程在 EOF 后退出（stdin 关闭后再写必须报错）、阶梯能结束一个无视 EOF 的子进程（不输出的进程只能是 `Idle`，第二次 `terminate` 不再走一遍阶梯）、缺失的程序报 `NotInstalled`。测试用临时脚本（Windows 上是 `.cmd`，正好也走了一遍 shim 路径）。
  - `supervisor.rs` 9 个——回合流式输出并完成（`["started","delta","delta","completed"]`，文本 `你好`，runId `s1-1`）、早于 runId 到达的帧只重放一次且之后的过期帧不改变任何东西、CLI 回合中途死掉会让打开的回合失败（`Exited` + `exitCode 9` + detail 里带 stderr `boom`，然后 `!is_running`）、停止会先问 CLI 并等它的回答、不支持取消的 Provider 在本地结束回合（下一条消息变成 `s1-2`）、回合进行中发的消息会排队等它、握手失败返回给调用者（不发任何事件、什么都没写、`send` 报 `Internal`）、关闭会话会结束它的线程和进程（`stdin_closed`、`terminated() == 1`、`["started","stopped"]`、第二次 close 返回 `false`）、关闭 supervisor 会结束每个会话。
- `npm run test:architecture` → `Architecture boundary verification passed`（新增断言：七个子模块都声明了、`AgentSupervisor` / `ProviderSession` / `SessionSpec` / `ChildTransport` 都从模块根 re-export、四个被剥离的变量名、`SHELL_METACHARACTERS` / `CREATE_NO_WINDOW` / `resolve_program`、`impl AgentTransport for ChildTransport` / `taskkill` / `impl Drop for ChildTransport`、进程层不碰 JSON、supervisor 不自己分帧也不认识 SQLite 和 Tauri、`pub trait ProviderSession` / `RunGate::new()` / `impl Drop for AgentSupervisor`）。
- `npm run verify` 全绿。
- 三个新 Rust 文件 `rustfmt --check --edition 2021` 干净（`lib.rs` 的既有格式问题仍不在本任务范围内）。

**验证命令：**

```powershell
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml agent_cli
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

### Task CLI-2: Codex 适配器与 Agent Tauri 命令（第一个能真的对话的版本）

**状态：** Done

**负责人角色：** Native + Frontend

**影响文件：**

```text
src-tauri/src/agent_cli/mod.rs
src-tauri/src/agent_cli/providers/mod.rs
src-tauri/src/agent_cli/providers/codex.rs
src-tauri/src/agent_bridge.rs
src-tauri/src/lib.rs
src/core/agentProtocol.ts
src/platform/agentCli/agentSession.ts
src/platform/agentCli/index.ts
src/features/agents/useAgentSession.ts
src/features/agents/AgentSessionPanel.tsx
src/features/agents/index.ts
src/ui/App.tsx
src/ui/zh.ts
src/ui/styles/workbench.css
scripts/verify-architecture-boundaries.mjs
scripts/verify-agent-protocol.mjs
```

**目标：** 在 CLI-1 的 `ProviderSession` 接缝上接入第一种真实 CLI（`codex app-server`），并把 supervisor 接到 Tauri 与 UI 上，使 Agent 会话面板从"只显示检测结果"变成真的能发消息、能看到流式回答、能停止和结束进程。

#### 1. Codex 适配器（`agent_cli/providers/codex.rs`）

对照 `codex app-server` 0.146.0 及其导出的 schema（上游 `openai/codex`，Apache-2.0）实现 v2 的 `thread/*` + `turn/*` JSON-RPC 方言。这一层只做"翻译"，不认识 Tauri，也不认识 SQLite：

- **握手**：`initialize` -> `initialized` 通知 -> `thread/start`（或带 `resumeProviderSessionId` 时 `thread/resume`）。握手在调用者线程同步完成，所以"没装 codex""握手失败"是 `start_agent_session` 的 `Err`，不是一个迟到的事件。
- **thread id 回传**：适配器本身会被 `supervisor.start` 拿走，因此 codex 分配的 thread id 通过 `ProviderHandle`（`Arc<Mutex<Option<String>>>`，`providers/mod.rs`）读回调用者，写进 `AgentSession.providerSessionId`，供下次 resume。`CLI-3` 落地时这个句柄从 codex 专用的 `CodexHandle` 提升成两个适配器共用的类型，claude 的 `session_id` 走同一条路。
- **回合归属**：`turn/start` 会在任何 update 之前立刻返回 turn id，但 codex 可能在这个响应还在飞的时候就开始推流，所以 `TurnStart::Response` 之外还保留 `awaiting_turn`：先到的帧用 `TurnFrame::any` 落到当前回合，第一个看到的 turn id 被采纳。
- **安静项**：`QUIET_ITEMS = ["agentMessage", "userMessage", "reasoning"]` 是对话本身或我们自己的回声，不算工具活动；已经流过的文本不会因为随后的 `item/completed` 再重复一遍。
- **一次失败只播报一次**：codex 的失败会说两遍（`willRetry:false` 的 `error`，再加 `status:"failed"` 的 `turn/completed`），而"正在重试"的 error 长得几乎一样。适配器锁定自己的回合，只发一个终止事件；重试只作为工具通知 `{kind:"retry"}` 出现。
- **中断**：`turn/interrupt` 之后由 codex 自己以 `turn/completed status:"interrupted"` 收尾，适配器不自己伪造 `stopped`。
- **权限即沙箱**：`approvalPolicy` 恒为 `"never"`，真正限制由 `sandbox_for` 决定 —— `default` -> `read-only`、`autoReview` -> `workspace-write`、`fullAccess` -> `danger-full-access`，未知模式取**最小**权限而不是最大。CLI 仍然主动发起的审批请求会被回 JSON-RPC error 并在 transcript 里记 `{kind:"approvalDenied"}`，不会静默卡住一个永远不会弹出的对话框。
- **工具帧形状**：`{kind, detail?, status?, exitCode?}`，`detail` 截断到 200 字符，保证单个 item 淹不掉 transcript。

#### 2. Tauri 桥（`agent_bridge.rs`，唯一同时认识 runtime 与 Tauri 的文件）

注册了**五个**命令（原计划是三个，实际实现时拆出了 `close` 与 `agent_session_running`）：

| 命令 | 同步性 | 作用 |
| --- | --- | --- |
| `start_agent_session` | `#[tauri::command(async)]` | 连接 + 握手后才返回，返回 `{sessionId, providerSessionId?, textMode, degraded}` |
| `send_agent_message` | `#[tauri::command(async)]` | 排一条用户消息；run id 随后由 `started` 事件带出 |
| `stop_agent_session` | `#[tauri::command(async)]` | 结束当前这一轮，会话仍然活着 |
| `close_agent_session` | `#[tauri::command(async)]` | 结束会话本身，返回前子进程已经没了 |
| `agent_session_running` | `#[tauri::command]`（同步） | 运行时是否还有这个会话的进程；UI 状态可能过期，崩掉的 CLI 在这里答 `false` |

- 四个会阻塞的命令必须是 `async`（握手会等、`close` 会 join 线程），否则会占住主线程；`agent_session_running` 只读一个表，留同步。
- `register(app)` 在 `.setup()` 里用 `AppHandle` 造 sink 并 `app.manage(AgentSupervisor::new(sink))`，在任何窗口能 invoke 之前就位。
- `shutdown(app)` 挂在 `RunEvent::Exit`：Tauri 的退出路径不跑析构函数，只靠 `impl Drop` 会漏子进程。
- 错误以 `AgentError` 结构体过界（`kind`/`message`/`detail`/`exitCode`/`signal`），和 `src/core/agentProtocol.ts` 的 `AgentError` 同形，不塌成一句话。
- 工作目录经 `workspace_fs::resolve_existing_path` 复检且必须是文件夹（命令从任何地方都可达，不能只信调用方）。
- 未知 provider 直接 `NotInstalled` 拒绝，不会被当成 codex 启动。（`CLI-2` 期间 `claude` 走的就是这条路；`CLI-3` 之后 `provider_for` 认 `codex` 与 `claude` 两个分支，其余仍被拒绝。）
- 单一事件频道 `agent://event`，每个 payload 自带 `sessionId`，一个监听器就能路由到正确标签页。

#### 3. 前端：一个会话一个 hook

- `src/core/agentProtocol.ts` 增加 `toAgentError` 与 transcript 归约（`createAgentTranscript` / `appendAgentPrompt` / `applyAgentEventToTranscript` / `isAgentTranscriptBusy`），仍然是纯函数，不认识 React 也不认识 Tauri。
- `src/platform/agentCli/agentSession.ts` 只是 `invoke` 包装加一个事件频道常量，`useAgentSession.ts` 里没有任何 `@tauri-apps` 导入。
- `useAgentSession`：面板卸载**不**杀 CLI（切工作区去看别的东西，长任务要活着），所以重新挂载时先问 `agent_session_running` 再决定是否直接采纳已有进程，而不是第二次握手；乐观插入 prompt，让排队中的消息先可见；resume 失败（`handshakeFailed`）时退回开全新会话一次；`send` 被拒后回滚那条 prompt 并复查进程是否还活着 —— 空闲时死掉的 CLI 不会发任何事件，被拒的 `send` 是唯一线索。
- `AgentSessionPanel`：真实 transcript（文本 + 工具通知 + 每回合状态）加可用输入框；沙箱在进程启动时就定下，所以 live 时权限下拉被禁用并给出"先结束进程"的提示，而不是静默无效。
- 删除会话会先 `closeAgentSession` 再删记录，否则 CLI 继续跑而 UI 里已经没有任何东西能停它。
- 文案改成沙箱语义：不再说"每步确认"，而是"权限由沙箱决定，CLI 自己发起的确认请求会被直接拒绝"。

#### 4. 边界（这一批**没有**做的事）

- **对话历史不持久化。** 关掉应用再打开，会话配置还在，transcript 是空的。这是 `CLI-4`，不在这一批。（已由 `CLI-4` 落地，见本阶段末尾。）
- **没有审批 UI。** 权限只有沙箱这一档，`fullAccess` 必须用户自己在下拉里选，默认仍是只读。
- **Claude Code 不在这一批。** `CLI-2` 期间选到 `claude` 的会话点发送会拿到"暂不支持这个 Agent CLI：claude"，不是假装能聊。已由 `CLI-3` 落地。
- **CLI 依旧不碰 Aster 的 SQLite**，`agent_cli/` 里没有任何 `tauri::`（由 `verify-architecture-boundaries` 断言）。

#### 5. 验收结论

- `cargo test --manifest-path src-tauri/Cargo.toml`：**82 passed; 0 failed**（此前 58 个）。其中 `agent_cli` 57 个（`providers::codex::tests` 17 个：启动参数、握手并公布 thread id、没有 thread id 的握手失败、resume 续用已存 thread、回合流式跑通、响应还在飞时采纳第一个 turn id、别的 turn/thread 的帧被丢掉、我们自己的回声与 reasoning 保持隐藏、流过的消息不被 `item/completed` 重复、没流过的消息靠 `item/completed` 补上、命令项变成一条工具通知、文件改动项列出它碰过的文件、重试的 error 只是通知而最终那个只结束一次回合、中断与未知状态都能收尾、审批请求被拒并进 transcript、权限模式映射沙箱、`turn/interrupt` 真的发到 codex），`agent_bridge::tests` 3 个，`workbench_store` 10 个。
- `npm run verify` 全绿（vite build + 12 个 node 测试 + cargo test）。
- 两个验证脚本里关于 CLI-2 的断言由"必须还没有"翻成"必须已经有"：`impl ProviderSession for CodexSession`、`CODEX_PROGRAM`、五个 JSON-RPC 方法名、`APPROVAL_POLICY` 与三个沙箱分支、`AGENT_EVENT`、`register`/`shutdown`、四个 `async` 命令、`lib.rs` 里五处 `agent_bridge::`、`RunEvent::Exit` 上的 `shutdown`、前端的频道名与五个命令字符串、`.agent-transcript` 与 `.agent-session-composer` 样式；同时用 `doesNotMatch` 钉死"输入框不能再是 `<textarea disabled` 占位"和"`agentRuntimePending` 文案必须已删除"。
- `scripts/verify-agent-protocol.mjs` 增补 `toAgentError` 的六种入参和 transcript 归约的九条行为（空 transcript 不忙、无 run 的 prompt 算忙、别的会话/未知 run 原样返回同一引用、`started` 认领最早那个没有 run 的回合、增量累积、空增量不产生新对象、`completed` 解除忙、无人请求的 `started` 追加 `prompt: ''` 的回合、快照模式不拼接）。

**验证命令：**

```powershell
Set-Location D:\WorkSpace\Aster
npm run test:agent-protocol
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml agent_cli
cargo test --manifest-path src-tauri/Cargo.toml agent_bridge
npm run verify
```

**仍需手动桌面验证（需要 GUI 会话）：** `npm run tauri:dev` -> 在装了 codex 的机器上新建一个 Agent 会话 -> 发一条消息看是否流式返回 -> "停止这一轮" -> "结束进程" -> 关掉应用确认没有残留 `codex` 进程。

### Task CLI-3: Claude Code 适配器（第二种 CLI，不改运行时）

**状态：** Done

**负责人角色：** Native

**影响文件：**

```text
src-tauri/src/agent_cli/providers/claude.rs   （新增）
src-tauri/src/agent_cli/providers/mod.rs
src-tauri/src/agent_cli/providers/codex.rs    （只补测试模块的 use）
src-tauri/src/agent_bridge.rs
src/ui/zh.ts
scripts/verify-architecture-boundaries.mjs
```

**目标：** 在同一个 `ProviderSession` 接缝上接入第二种真实 CLI，验证 `CLI-1` 的接缝是不是真的够用 —— 结论是够用：`supervisor.rs` / `peer.rs` / `process.rs` / `turn.rs` 一行没改，`launch.rs` 一行没改，新增的全部是一个适配器文件加 `provider_for` 的一个分支。

#### 1. 方言：不是 JSON-RPC

对照本机 Claude Code 2.1.220 实测（探针脚本用完即删，不入库）。codex 说的是 JSON-RPC，claude 说的是**裸的、按行分隔的类型化对象**：只有 `type`，没有 `id`，也没有 `method`。所以它们不走 `AgentPeer` 的请求关联，而是以 `RpcFrame::Payload` -> `PeerNotice::Payload` 到达适配器的 `on_payload`。这也是 `CLI-0` 的 `RpcFrame` 需要 `Payload` 变体的原因。

五条决定了这个文件形状的性质：

- **没有握手可答。** 第一条用户消息之前 claude 一个字都不写，所以开会话不花任何模型调用。`handshake` 于是改成"盯住刚起来的进程 500 ms"（`SETTLE_WINDOW`）：拒了某个 flag 或者没登录的进程会在这个窗口内退出，否则会话会看起来已启动、直到用户发第一条消息才失败。
- **回合没有名字。** 一条 `{"type":"user","message":{...}}` 进去，回来是 `system` / `stream_event` / `assistant` / `result`。CLI 从不给这一轮起名，所以适配器自己铸 `claude-turn-{n}` 并返回 `TurnStart::Known`；`run_id()` 永远不会被调用，真被调到就是 `Internal` 错误。
- **文本真的是增量。** `--include-partial-messages` 把 Anthropic 自己的 `message_start` / `content_block_delta`（`delta:{type:"text_delta"}`）/ `message_stop` 原样转出来，所以 `textMode` 报 `delta`，**不是**计划里写的 `snapshot`。随后那条 `assistant` 全量快照会把同一段话再说一遍，因此按 **message id** 抑制：`streamed: HashSet<String>` 记住哪条消息已经流过。按 message id 而不是按回合，是因为一个回合可能有多条消息 —— 流过的不重复，没流过的（工具调用之间那种）仍然要出现。
- **`system`/`init` 每回合都重发**，并且带着 `--resume` 需要的 `session_id`。所以 `ProviderHandle::publish` 必须幂等。
- **停止就是控制协议。** `{"type":"control_request","request":{"subtype":"interrupt"}}` 出去，一条 `control_response` 回来。**结束这一回合靠的是这条回答**（按我们自己记下的 `request_id` 匹配），不是靠中断后是否还会有 `result` —— 那样停止按钮的正确性就取决于一个没保证的行为。

#### 2. 权限：与 CLI-2 同一条纪律

`permission_for`：`autoReview` -> `acceptEdits`、`fullAccess` -> `bypassPermissions`、其余（含未知模式）-> `manual`。未知模式取**最小**权限，一个新前端发来的没见过的字符串不会意外把会话放开。

A4Note 依旧没有审批 UI，所以 claude 的 `can_use_tool` 控制请求一律回 `behavior:"deny"` 加一句给模型看的 `DENY_MESSAGE`（告诉它改用只读方式或请用户调高权限），并在 transcript 里记一条 `{kind:"approvalDenied"}` —— 静默没跑的一步比明确跑不了的一步更糟。**其他 subtype 也必须答**（回 `{"subtype":"error"}`），因为没人回答的控制请求会把它后面那一轮卡死。

#### 3. 工具通知复用现有词汇

`tool_kind_for` 把 claude 的工具名映到 UI 已有的 `kind`：`Bash`/`BashOutput`/`KillShell` -> `commandExecution`，`Edit`/`Write`/`NotebookEdit` -> `fileChange`，`WebSearch`/`WebFetch` -> `webSearch`，`TodoWrite` -> `todoList`，`mcp__*` -> `mcpToolCall`，其余 -> `toolUse`。`src/ui/zh.ts` 因此只多了一个词条（`toolUse: '调用工具'`）：`Read` / `Glob` / `Task` 这些不各自挣一个标签，它们在 detail 行里说自己是谁。

失败的 `tool_result` 复用**调用时那一个 kind** 加 `status:"failed"`（通过 `tools: tool_use_id -> name` 反查），而不是发明一个 `toolResult` kind。成功的 `tool_result` 不出声。`tools` 故意跨 `reset_turn` 存活：一条 `tool_result` 可能在结束回合的那一帧之后才被解出来。

#### 4. 边界（这一批**没有**做的事）

- 运行时一行没改：`supervisor` / `peer` / `process` / `turn` / `launch` / `protocol` 都没动，`lib.rs` 的注册段也没动（只在 `provider_for` 加分支）。
- 历史仍然只在内存里（`CLI-4`，已在下一批落地）。
- `agent_cli/` 里依旧没有 `tauri::`，CLI 依旧写不到 Aster 的 SQLite。

#### 5. 验收结论

- `cargo test --manifest-path src-tauri/Cargo.toml`：**100 passed; 0 failed**（此前 82 个）。新增 18 个 `agent_cli::providers::claude::tests`：启动参数两端都是 stream-json 且没有 `--cwd`、三档权限映射与未知模式回落 `manual`、resume 续用已存 session（空 id 不加 flag）、安静的进程算启动成功而已经退出的进程带着 `exitCode` 失败、一回合只有一条 `user` 帧且挂在我们自己的 marker 下（且没有 `jsonrpc`/`method` 键）、`system`/`init` 公布 session id 但不显示任何东西、流过的文本不被 `assistant` 快照重复、没流过的答案靠快照送到、thinking 与半截工具参数保持隐藏、工具名映到已有标签、一次工具调用只有一条通知而失败会带上工具名、`result` 能替没流过的答案兜底、失败的 `result` 只结束回合一次、审批请求被拒并进 transcript（未知 subtype 回 error 且不产生通知）、一回合经真实 supervisor 流式跑通、停止发出 interrupt 且由它的回答收尾。
- 顺手修掉 `providers/codex.rs` 测试模块缺的 `use std::sync::{Arc, Mutex};` —— 上一批删 `CodexHandle` 时连带删掉了，`mod tests` 通过 `use super::*` 拿这两个名字。
- `scripts/verify-architecture-boundaries.mjs` 增补 CLI-3 断言：`pub mod claude;`、`impl ProviderSession for ClaudeSession`、`CLAUDE_PROGRAM`、七个启动 flag、`launch` 里不出现 `--cwd`（只切这一个函数来查，因为测试模块要指名这个 flag 才能断言它不存在）、`text_delta` 与 `streamed: HashSet<String>` 这对必须同时在、`permission_for` 的三个分支加 `_ => MANUAL_MODE` 回落、`can_use_tool` / `behavior:"deny"` / `subtype:"error"` 三条控制协议回答、`subtype:"interrupt"` 与 `control_response` 收尾、claude.rs 里没有 `tauri::`、`provider_for` 里 `codex` 与 `claude` 两个分支都在。

**验证命令：**

```powershell
Set-Location D:\WorkSpace\Aster
npm run test:architecture
npm run test:agent-protocol
cargo test --manifest-path src-tauri/Cargo.toml agent_cli
npm run verify
```

**仍需手动桌面验证（需要 GUI 会话）：** `npm run tauri:dev` -> 新建一个 `Claude Code` 会话 -> 发一条消息看是否流式返回 -> "停止这一轮" -> "结束进程" -> 关掉应用确认没有残留 `claude` 进程。

### Task RES-2: 通用 Resource 注册与 URI 规范化

**状态：** Done

**负责人角色：** Workbench/Core + Native/Resources

**影响文件：**

```text
src/core/resources.ts                        （新增）
src/core/workspace.ts
src/workbench/workspaceStore.ts
src/ui/App.tsx
src-tauri/schema.sql
src-tauri/src/workbench_store.rs
scripts/verify-resource-model.mjs            （新增）
scripts/verify-workspace-model.mjs
scripts/verify-ui-state.mjs
scripts/verify-architecture-boundaries.mjs
scripts/verify-all.mjs
package.json
```

**目标：** 给"标签、标注和 AI 上下文能指向的同一个东西"一个稳定身份。在这一批之前，一个文件在模型里的身份就是它被打开时那一串路径 —— `D:\a\B.pdf` 和 `d:/a/b.pdf` 会开出两个标签，`PDF-0`（Reader 从 Paper 改吃 PDF Resource）和 `AGT-4`（`@resource` 上下文）都没有可以引用的对象。

#### 1. 一个规范化函数，只在 TypeScript 里

`src/core/resources.ts` 是纯 core：没有 React、没有 `@tauri-apps`、没有存储。Windows 路径、UNC 路径、POSIX 路径和 URI 进去，一个规范 URI 出来，并且**幂等** —— 把输出再喂回去不变，这是 `resourceKey` 能当身份用的前提（空格和中文路径都测了）。`file:`/`aster:` 折叠大小写，web 只折叠 scheme 与 host、保留 path 大小写；`https://x:443/a/` 掉默认端口和尾斜杠，`http://[::1]:8080/x` 的 IPv6 主机不会被端口切断。`localPathFromResourceUri` 是反向那一趟，给原生层用。

**Rust 侧不写第二份规范化。** `uri` 由前端算好、原样入库，`workbench_store.rs` 的文档注释和边界脚本都把这条写死了 —— 两种语言各有一份 URI 语法，迟早会对同一个路径给出两个名字（agent 事件名的教训）。

#### 2. `folder` 不靠猜

`inferResourceKind` 先看扩展名再看 scheme，**从不**推断 `folder`：规范化会把提示目录的尾斜杠去掉，而文件树和导入器本来就知道自己给的是什么，猜错就是把目录送进文本视图。要 `folder` 的调用方显式传 `fallback: 'folder'`。写测试时发现原来那条 `if (normalized.endsWith('/')) return 'folder';` 是死代码（`canonicalFilePath` 对所有 scheme 都去尾斜杠），已删 —— 一个永远不会命中的分支就是"看起来支持目录识别"。

#### 3. 注册表在模型里，去重也在模型里

`registerResource` 按 `resourceKey(uri)` 幂等：同一路径的另一种写法拿到同一条记录，只补空缺、不覆盖已有值，**什么都没变就返回原 state 对象**（`commit()` 按引用比较，所以这条等于"不写快照"）。`ResourcePatch` 故意不含 `uri` —— 换 URI 就是换资源。`removeResource` 只把标签**解绑**，不关标签：标签的 `state.path` 还在，用户没有因为一条记录消失而丢掉正在看的东西。删 Project 会连带它的资源（`projectId` 为空的是工作台级的，不跟着走）。

恢复路径把旧数据修好而不是崩掉：重复 URI、孤儿 `projectId`、空 URI 一律丢弃，`file:<原始路径>` 这种旧标签键改写到 `resourceTabKey` 上（所以一条路径的两种旧写法收敛成一个标签），指向已消失资源的标签只解绑。

#### 4. SQLite：`resources_uri` 索引故意不是 UNIQUE

去重是模型的职责，和标签键一样。因此 `uri` 上只有普通索引，也没有派生的 key 列：模型出 bug 时最坏是多出一行重复记录，而不是保存直接失败、用户丢掉整个工作台快照。Rust 侧 `two_resources_may_share_one_uri` 这个测试把这个决定锁住了。`WorkbenchSnapshot.resources` 带 `#[serde(default)]`，所以 RES-2 之前的快照会加载成空注册表（用真实临时文件测过，不是假设）。

#### 5. 验收结论

- `npm run test:resources`（新增，`verify-resource-model.mjs`）：URI 规范化与幂等、身份与标签键、kind 与标题推断、本地路径往返、注册表幂等与补全、patch、标签晚绑定与解绑、序列化往返、脏数据修复、以及经 `workspaceStore` 走一遍存储适配器（含"重复注册不重复写快照"）。
- `cargo test --manifest-path src-tauri/Cargo.toml`：新增三个 `workbench_store` 测试 —— 带/不带 `projectId` 的资源往返（含 metadata）、一个 URI 两行也必须能存、没有 `resources` 字段的旧快照加载成空注册表。
- `scripts/verify-architecture-boundaries.mjs`：`resources.ts` 的 core 纯净性（同 CLI-0 那张禁止清单，另加 `localStorage`）、四个必须导出的函数、`workspace.ts` 从 `./resources` 导入而不是自己再实现一遍、`App.tsx` 用 `resourceTabKey` 开文件标签、Rust 侧有 `ResourceRecord` 且**没有** `normalize_uri`、`schema.sql` 有 `resources` 表和非 UNIQUE 的 `resources_uri`。
- `verify-ui-state.mjs` 与 `verify-workspace-model.mjs` 同步到新形状：前者断言 `openFileTab` 走注册表，后者断言旧 `file:1` 键在恢复时被改写成 `resource:file:///1`。

**验证命令：**

```powershell
Set-Location D:\WorkSpace\Aster
npm run test:resources
npm run test:architecture
npm run verify
```

**这一批没有做的事：** 没有 UI 入口。资源注册表现在只被"打开文件标签"这一条路径喂数据，`PDF-0` 和 `AGT-4` 才是它的消费者 —— 在它们之前不加"资源库"面板。

### Task CLI-4: 会话消息历史落 SQLite 并在挂载时回填

**状态：** Done

**负责人角色：** Native + Workbench/Core

**影响文件：**

```text
src-tauri/src/agent_history.rs                （新增）
src-tauri/src/lib.rs                          （mod agent_history; + 两个命令）
src-tauri/src/workbench_store.rs              （快照事务里扫孤儿行）
src-tauri/schema.sql                          （agent_messages 表）
src/core/agentHistory.ts                      （新增）
src/platform/agentCli/agentHistory.ts         （新增）
src/platform/agentCli/index.ts
src/features/agents/useAgentSession.ts
src/features/agents/AgentSessionPanel.tsx
src/ui/zh.ts
scripts/verify-agent-protocol.mjs
scripts/verify-architecture-boundaries.mjs
scripts/verify-core-smoke.mjs
```

**目标：** 让"对话被记住"这件事成真。`CLI-2` / `CLI-3` 之后输入框已经能真的跑到流式回答，但 transcript 只活在内存里 —— 重启应用后会话配置还在、对话空了。这一批把一次交换存成一行，并在面板挂载时回填。

#### 1. 一行是一次交换，`seq` 只数已开过 run 的回合

主键 `(session_id, seq)`，所以流式回答是**更新同一行**而不是不断追加。`seq` 不是数组下标：排队中但还没拿到 run 的 prompt 不算历史 —— 存它等于复活一条 CLI 从没看见的消息，而且它自己的 run 一开就会把后面所有 `seq` 顶掉一位。`tool_payloads_json` / `error_json` 原样存，不在存储层二次建模一遍 UI 已经会渲染的东西。

#### 2. 两个命令挂在数据库那一侧，不挂在桥上

历史是 **Aster 自己的数据库**，不是 CLI 的一部分。所以 `load_agent_messages` / `save_agent_messages` 当时注册在 `lib.rs`（`P2-1` 之后搬到 `state_commands.rs`，仍然是数据库那一侧），而 `agent_bridge.rs` 里既不出现 `rusqlite` 也不出现 `agent_history` —— `CLI-0` 立的那道墙（CLI 永远写不到 Aster 的 SQLite）只有这样才继续成立。对称地，`agent_history.rs` 里没有 `tauri::`：它是仓库，不是运行时。两个命令都是 `#[tauri::command(async)]`，并且都先调 `initialize_database`（会话面板可能比资料库先打开）。

#### 3. `agent_messages` 故意没有外键

工作台快照是**整表重写**（先删子表再删父表再全量插入），`agent_sessions` 每次保存都会被清空一遍。如果 `agent_messages` 是它的外键子表，一次普通的快照写入就会级联删光所有对话。所以这里明确"不加外键"也是一个明确的决定，代价是孤儿行要自己扫：`workbench_store` 在**同一个事务**里调 `agent_history::prune_orphans(&transaction, &live_session_ids)`，一致性和快照一起提交或一起回滚。

#### 4. 只写动过的行

`agentMessageDigest` 只对内容取摘要（**不含时间戳**），所以回填回来的行和它来源的那一行摘要相同 —— 打开一个会话什么都不写。`pendingAgentMessageWrites` 只交出摘要变了的行，因此一次流式回答落的是一行 UPSERT，且 `ON CONFLICT ... DO UPDATE SET` 里**没有** `created_at`：那是用户按下发送的时刻，更新不该动它。唯一"打开就写"的例外是被中断的回合：`running` 在回填时被治成 `stopped`，这一行确实变了，应该写回去（否则 `isAgentTranscriptBusy` 会永远为真，把输入框锁在一个没有东西可停的停止按钮后面）。写入按 400 ms 节流而不是去抖 —— 一次长回答如果只去抖，中途崩溃就什么都没落盘。

#### 5. 回填的 runId 必须带标记

supervisor 的 run 计数**随进程重启**（`run_id = "{sessionId}-{n}"`），所以一个新回合完全可能拿到某条历史行已经带着的那个 id，然后把新答案流进那条旧回合里。回填因此给 runId 加 `#restored{seq}`（幂等，回填两次不叠标记），存回数据库时再用 `storedAgentRunId` 剥掉。被回填的回合按定义已经结束，**回填不重启任何进程**；采纳仍在跑的进程走的还是 `agent_session_running`。

#### 6. 读不出来就说出来

读历史失败时面板明说（`zh.workbench.agentHistoryUnavailable`）并**停掉这一次挂载的写**：没有基线就写，等于可能用新消息盖掉一行读不出来的真实记录。非桌面运行时不算错误，只是没有历史。

#### 7. 验收结论

- `cargo test --manifest-path src-tauri/Cargo.toml`：**115 passed; 0 failed**（此前 103 个）。新增 `agent_history` 10 个与 `workbench_store` 2 个（其中 `history_of_a_removed_session_is_swept_with_it` 锁住那次同事务清扫）。分桶：`agent_cli` 75、`workbench_store` 15、`agent_history` 10、`agent_bridge` 3、`workspace_fs` 7、根 `tests::` 5。
- `npm run test:agent-protocol` 增补历史行映射：`seq` 只数有 run 的回合、`running` 治成 `stopped`、坏掉的 `error` 列退回通用文案、回填在已有回合**之上**（挂载期间发出的消息保住自己的位置和 `seq`）、标记幂等与剥离、摘要不含时间戳因此"打开不写"、被治过的那一行确实要写。
- `npm run test:architecture` 增补整道墙：`agentHistory.ts` 的 core 纯净性与四个导出、`AGENT_RESTORED_RUN_MARKER` 与三个 helper、两个命令都是 `async` 且在数据库那一侧（当时是 `lib.rs`，`P2-1` 之后是 `state_commands.rs`）、平台包装里有同名字符串、`agent_bridge.rs` 里没有 `rusqlite|agent_history`、`agent_history.rs` 里没有 `tauri::`、`agent_messages` 有 `PRIMARY KEY (session_id, seq)` 且**没有**指向 `agent_sessions` 的外键、`workbench_store` 调 `prune_orphans`、UPSERT 不改 `created_at`。
- `npm run verify` 全绿。`verify-core-smoke.mjs` 里那条 `paper_file_path_from_database` 断言改成容忍换行：这一批顺手让 `lib.rs` 过了 `rustfmt --edition 2021`（`git show HEAD:` 确认那个 108 字符的签名是 rustfmt 重排的既有代码，不是本批引入），换来的好处是 `P2-1` 拆分时 diff 里只剩真正的搬动。

**验证命令：**

```powershell
Set-Location D:\WorkSpace\Aster
npm run test:agent-protocol
npm run test:architecture
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify
```

**仍需手动桌面验证（需要 GUI 会话）：** `npm run tauri:dev` -> 分别新建 codex 与 claude 会话 -> 发消息看流式返回 -> "停止这一轮" -> "结束进程" -> 关掉应用再打开，确认 transcript 回来了、被中断的那一轮不再显示成在跑 -> 确认没有残留 `codex` / `claude` 进程。

### 阶段 12 已全部落地

`CLI-0`、`CLI-1`、`CLI-2`、`CLI-3`、`CLI-4`、`RES-2` 都已完成：两侧协议、错误类型、回合隔离、内存 stdio 夹具、真实 `Child` 传输、环境剥离、tree-kill 阶梯、会话 supervisor、Codex 与 Claude Code 两个适配器、五个 Tauri 命令、会话面板的真实 transcript、消息历史的 SQLite 持久化与挂载回填、以及通用 Resource 身份都在。装了 `codex` 或 `claude` 的机器上都可以从输入框一路跑到流式回答，重启应用后对话还在。

下一批的入口是 `PDF-0`（Reader 输入从 Paper 改吃 PDF Resource）和 `AGT-4`（会话里的 `@resource` 上下文）—— 它们是 `RES-2` 的两个消费者，在它们之前不要加"资源库"面板（见 `AI_DEVELOPMENT_PLAN.md` 第 1 节：不伪造已完成能力）。

原先"没有 `ProviderSession` 实现，UI 也没有任何途径到达 supervisor"和"transcript 只活在内存里"的描述都已经过期。

### Task ARCH-3：统一场景插件化与 Agent 开发手册

**状态：** In Progress（2026-08-29）

**目标：** 所有内置和外部场景都通过插件生命周期注册；场景视图、专属侧栏和多文档打开能力使用统一贡献协议；不同 Agent 接手时从仓库状态文件获得一致的当前进度。

**已完成第一步：**

- `overview.core`、`library.core`、`reader.core`、`ai.core`、`markdown.core` 均通过 `createAsterCore` 的插件激活流程注册场景。
- `SceneContribution` 增加 `sidebarMode`、`defaultSidebarPanel` 和 `supportsOpenItems`，为场景专属侧栏和多标签能力建立契约。
- `src/workbench/sceneViews.tsx` 提供 UI 层 `SceneViewRegistry`；`App.tsx` 不再按场景写内置视图 `if/else`。
- 新增 `docs/notes/DEVELOPMENT_HANDBOOK.md`、`docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json` 和 `npm run test:agent-status`。

**下一步：** 将 `ProjectSidebar` 的场景专属内容改为读取场景贡献，继续把视图装配下沉到各 feature/plugin 模块，并在 `npm run test:architecture` 中持续阻止绕过插件注册。

**验收：** `npm run test:agent-status`、`npm run test:core`、`npm run test:architecture`、`npm run build` 和 `npm run verify` 全部通过。完成前不重新打包 exe。


**阶段 12 之后的分配建议：**

```text
Lane 1  RES-2 (Done) -> PDF-0 Reader 输入改吃 PDF Resource
Lane 2  CLI-0 (Done) -> CLI-1 (Done) -> CLI-2 (Done) -> CLI-3 (Done) -> CLI-4 (Done) -> AGT-4 @resource 上下文
Lane 3  工作台视觉细化（只改 workbench.css / tokens.css）
Lane 4  P2-1 拆分 src-tauri/src/lib.rs (Done) -> 从 App.tsx 抽 hooks（需要单人窗口期）
```

冲突控制：同一时间只允许一个任务大改 `App.tsx`。`src-tauri/src/lib.rs` 的争用已经彻底解除 —— `P2-1` 把它拆成了 97 行的模块表加注册段，命令体都在各自的领域模块里，两个人同时加后端命令现在只会在"各自那一行注册"上碰面。防回流由 `npm run test:architecture` 守着（`lib.rs` 里不许有 `#[tauri::command]` 或 `rusqlite`、行数上限 160、注册条目必须写成 `模块::命令`）。





