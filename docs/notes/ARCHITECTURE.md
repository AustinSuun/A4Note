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
- `src/core/relations.ts` 已有前端关系图映射和查询层。
- `src/core/workbench.ts` 已有工作台面板注册表。
- `src/core/aiProviders.ts` 已有 AI Provider runner 雏形。
- `src/core/asterCore.ts` 已有命令、事件、插件、Provider、设置等前端核心能力。
- `src/platform/nativeApi.ts` 已作为前端访问 Tauri/native 能力的边界。
- `src/features/library/` 已拆出 `LibraryScene`、`LibraryDetailPanel`、`ImportDialog`、`TagInput` 和 `types`，是当前 feature 模块样板。
- `src/features/reader/` 已拆出 `ReaderScene`、工具栏、侧边抽屉、Markdown 面板、标注列表、关系面板和 reader helper，阅读器外层已进入模块化阶段。
- `src/features/ai/AIChatScene.tsx` 已承载 AI 对话展示组件。
- `src/features/settings/index.tsx` 已承载设置、诊断、备份和插件设置展示组件，状态和副作用仍由 `App.tsx` 持有。
- `src/workbench/WorkspacePanelHost.tsx` 已承载通用工作台面板 Host。
- `src/workbench/CommandPalette.tsx` 已承载命令面板。
- `src/shared/` 已建立 UI、hooks、utils 的稳定导出入口，后续按需填充。
- `src/ui/App.tsx` 已不再承载主要场景组件，但仍承担大量状态管理、快捷键、持久化和业务协调，后续需要继续抽 hooks。
- `src/features/reader/pdf/PdfReader.tsx` 是阅读器 PDF 核心，仍然较大，后续需要按渲染、标注、便签、文本层、快捷键拆分。
- `src-tauri/src/lib.rs` 同时承担文件系统、SQLite、导入、标注、备份恢复等后端命令，后续需要按领域拆分。

当前不要立刻大规模移动文件。应先建立模块边界，再按稳定闭环逐步迁移。

## 3. 目标目录结构

长期建议结构：

```text
src/
  core/
    types.ts
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
    repositories/
    fileSystem.ts
    sqlite.ts

  workbench/
    WorkbenchShell.tsx
    CommandPalette.tsx
    WorkspacePanelHost.tsx
    layoutStore.ts

  features/
    library/
    reader/
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
    commands/
    database/
    files/
    import/
    annotations/
    backup/
```

迁移顺序：

1. 先从 `App.tsx` 抽 UI 组件，不改业务行为。
2. 再从 `PdfReader.tsx` 抽阅读器内部模块。
3. 再把 `nativeApi.ts` 和后端命令按领域拆分。
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

- 场景切换。
- 命令面板。
- 工作台面板 Host。
- 布局状态保存。
- 面板注册与渲染。
- 快捷键分发。

不负责：

- 文献导入细节。
- PDF 标注算法。
- AI Provider 实现。

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

## 5. 依赖方向

推荐依赖方向：

```text
shared <- core <- platform
shared <- workbench <- features
core <- features
platform <- features
```

更具体地说：

- `features/*` 可以依赖 `core`、`platform`、`shared`。
- `workbench` 可以依赖 `core` 和 `shared`，但不应该依赖具体 feature 内部实现。
- `core` 不依赖 `features`。
- `core` 不依赖 React。
- `platform` 不依赖 UI。
- 插件只通过 `core` 暴露的 API 接入，不直接 import 具体 feature 内部文件。

禁止方向：

- `core` import `src/ui/*`。
- `core` 直接调用 Tauri。
- `features/library` 直接 import `features/reader` 内部组件。
- 插件直接写 SQLite。
- UI 组件直接拼 SQL 或直接操作文件系统。

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

### 7.1 场景

场景是默认工作区布局，不是固定页面。

当前主要场景：

- 资料库
- 阅读
- AI 对话
- 设置

后续新增：

- 笔记 / 知识库
- 目录 / 关系图
- 项目 / 课程
- 插件贡献场景

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

第一阶段插件模型是本地可信插件，不做市场和沙箱。

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
- Markdown 和双链：`features/notes`
- AI 对话和 Provider：`features/ai`
- 设置、备份、诊断：`features/settings`
- 关系面板、对象查询：`core/relations` 和后续 `features/relations`
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
features/notes/index.ts
features/ai/index.ts
features/settings/index.tsx
workbench/index.ts
platform/index.ts
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

- 面板 Host 统一。
- 布局状态统一。
- 命令面板统一。
- 后续中央 tab、分屏、拖拽停靠。

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
