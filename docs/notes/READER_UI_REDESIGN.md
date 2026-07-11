# Aster 阅读器 Phase 3 UI 重设计方案

> 状态：已暂停。用户在后续评审中明确要求撤销标签页式设计方向，当前实现方向改为保留现有阅读器结构，并优化顶部工具栏、常用功能入口和标注工具可见性。本文档仅作为历史方案归档，新的实施依据以 `READER_UI_DIRECTION.md` 和当前代码中的 `ReaderToolbar` 为准。

本文档定义阅读器 Phase 3 的 UI 重设计方向和任务分解。

对应 `DEVELOPMENT_TASKS.md` 阶段 3。阶段 2 已完成代码结构拆分和低噪音视觉调整，阶段 3 进行全面的 UI 重组，使阅读器具备成熟文献阅读工具的布局能力，同时保持 Aster 自身的视觉语言。

---

## 1. 参考来源

设计参考以下开源 / 成熟 PDF 阅读器的经过验证的 UI 模式：

| 参考 | 借鉴点 |
|---|---|
| Zotero 7 PDF Reader | 左侧面板（目录/缩略图/标注索引）；文字选中后浮出标注工具；右侧笔记面板；工具栏三区组织 |
| PDF.js Viewer（Mozilla） | 工具栏左/中/右三区划分；左侧大纲/缩略图切换；中部页码导航 |
| VS Code | Activity bar（场景轨）+ 侧边面板 + 编辑区三区；面板可独立折叠 |
| Obsidian | 笔记面板风格；可收起侧边栏；专注模式隐藏侧栏 |

Aster 不复制上述任何一个产品，而是从这些经过验证的 UI 模式中选取适合当前场景的部分，保持自身的绿色主题和中文字体规则。

---

## 2. 设计目标

### 2.1 核心目标

```text
阅读优先   阅读区占据最大可用空间，工具是辅助，不是主体
三区清晰   左侧导航 / 中间内容 / 右侧辅助 的职责边界清晰
按需出现   每个面板默认折叠，使用时打开，用完收起
工具不打扰 标注工具在文本选中时弹出，不需要提前切换模式
层级稳定   工具栏、面板、PDF 页面的视觉层级关系不随状态频繁变化
```

### 2.2 视觉关键词（延续阶段 2）

```text
低噪音
高密度
专业
阅读空间优先
随手启用，用完收起
```

---

## 3. 布局重组：从二区变三区

### 3.1 当前布局

```
[44px scene-rail] | [reader-scene]
                      ├── reader-toolbar（顶部单行）
                      └── reader-layout grid（2列）
                           ├── PDF主区（flex:1）
                           └── 右侧抽屉（304px, 可关闭）
```

**问题：**
- 无左侧面板，无法显示 PDF 目录/大纲
- 工具栏单行塞入全部控制，PDF 模式下折行或过拥挤
- 右侧4个 tab 超出文档目标的3个

### 3.2 目标布局

```
[52px scene-rail] | [reader-scene]
                      ├── reader-toolbar（顶部三区）
                      └── reader-body（3列 grid）
                           ├── 左侧面板（240px，可折叠）
                           │    目录 / 缩略图
                           ├── PDF主区（minmax(0, 1fr)）
                           │    PdfReader / ReaderMarkdown
                           └── 右侧抽屉（320px，可折叠）
                                笔记 / AI / 引用
```

**左侧面板规则：**
- 默认折叠
- 通过工具栏左区一个 icon 切换
- 不折叠时占 240px，折叠时为0（不占位）
- 在 markdown 模式下隐藏（只在 PDF 模式显示）

**右侧抽屉规则：**
- 默认折叠（延续现有行为）
- 宽度从 304px 增加到 320px
- tab 收敛为3个（详见第5节）

---

## 4. 工具栏重组

### 4.1 当前工具栏

单行，包含：title block + 内容模式 + 文件模式 + 译文选择 + 并排同步 + 标注工具 + 颜色 + 布局预设 + 缩放控件 + 面板开关

**问题：** PDF 模式下挤满一行；标注工具和颜色每次都可见但大多数时候不在用。

### 4.2 目标工具栏（三区）

```
[左区]                [中区]                 [右区]
左面板开关            标注工具               缩放-
内容模式(PDF/MD)      （仅PDF模式）          页码跳转
文件模式              工具: cursor/          缩放+
(原文/译文/并排)       高亮/下划线/           适配宽度
译文选择              批注/便签/区域          ───────
并排同步              当前颜色色块            布局预设
                                            右面板开关组
```

**规则：**
- 中区只在 PDF 模式下显示；Markdown 模式时中区为空
- 工具栏高度固定 38px（比现在更紧凑）
- 去掉 `reader-title-block`（"阅读器" 字样标题）
- 布局预设 + 右面板开关放在右区末尾，形成右对齐控制组
- 保持所有现有功能，仅重新分组

### 4.3 工具栏 CSS 变化

```css
/* 三区 flex 布局 */
.reader-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;      /* 38px 替代原 46px */
  padding: 0 8px;
  gap: 6px;
}
.reader-toolbar-left   { display: flex; align-items: center; gap: 4px; }
.reader-toolbar-center { display: flex; align-items: center; gap: 4px; flex: 1; justify-content: center; }
.reader-toolbar-right  { display: flex; align-items: center; gap: 4px; }
```

---

## 5. 右侧抽屉 Tab 收敛

### 5.1 当前 tabs

```
notes / annotations / chat / relations
```

### 5.2 目标 tabs

```
笔记 (notes) / AI (chat) / 引用 (cite)
```

**「引用」tab 内容：**

```
引用
├── [折叠区] 标注列表        ← 现 AnnotationListPanel
│    每项可跳转、编辑、删除、追加到笔记
└── [折叠区] 文献关系        ← 现 RelationPanel
     来源、引用、对象、AI 线程上下文
```

**实现策略：**
- 不强制合并 `AnnotationListPanel` 和 `RelationPanel` 的内部逻辑
- 新建 `CitationPanel.tsx` 作为引用 tab 的外壳
- `CitationPanel` 内部用折叠区（类似 VS Code sidebar section）组织两个子面板
- `ReaderSidePanelTab` 类型增加 `'cite'`，移除 `'annotations'` 和 `'relations'`（内部保留实现文件）

---

## 6. 左侧面板：PDF 大纲

### 6.1 功能描述

左侧面板的第一版只做 **PDF 目录（Outline）**。

- 调用 `pdfDocument.getOutline()` 获取 PDF 书签结构
- 每个条目显示标题，点击跳转到对应页码
- 支持多级层次（缩进）
- 无大纲的 PDF 显示"本文档没有目录"提示
- 缩略图（第二版再做）

### 6.2 组件设计

```text
新建文件：
  src/features/reader/pdf/PdfOutlinePanel.tsx
  src/features/reader/ReaderLeftPanel.tsx

ReaderLeftPanel:
  - 管理左面板 tab（outline / thumbnail）
  - 目前只有 outline
  - 接收 pdfDocument 并传给 PdfOutlinePanel
  - 折叠时渲染 null（不渲染内容）

PdfOutlinePanel:
  - 接收 pdfDocument
  - useEffect 调 pdfDocument.getOutline()
  - 递归渲染 OutlineItem 列表
  - 点击项目发出 onJumpToPage(page)
  - 最大嵌套层级限制为 4 层（防止超深结构撑爆布局）
```

### 6.3 大纲数据处理

PDF.js `getOutline()` 返回 `OutlineNode[]`，每个节点包含：
- `title: string`
- `dest: any` （目标页面引用）
- `items: OutlineNode[]`（子节点）

需要通过 `pdfDocument.getPageIndex(dest[0])` 解析 dest 为页码。这个调用是异步的，需要批量处理。

**实现方案：**

```typescript
// 在 PdfOutlinePanel 内部，加载完 outline 后批量解析页码
async function resolveOutlinePages(
  nodes: OutlineNode[],
  pdfDocument: PDFDocumentProxy
): Promise<ResolvedOutlineNode[]>
```

---

## 7. 文字选中弹出工具（SelectionPopup）

### 7.1 设计来源

Zotero PDF Reader 在未锁定模式下，文字选中后在鼠标附近弹出小工具条，包含：高亮/下划线 + 当前颜色。这个交互节省了切换工具的步骤，非常适合快速标注场景。

### 7.2 Aster 的实现目标

- 用户用鼠标选中一段文本后，在选区右上角附近弹出浮层
- 浮层包含：高亮、下划线、添加批注（3 个按钮） + 当前颜色小图标
- 点击高亮或下划线：立即使用当前颜色创建标注，弹层消失
- 点击添加批注：先创建高亮，再弹出批注编辑 popover
- 点击外部 / Escape：弹层消失，取消选区
- 与工具栏标注工具的关系：
  - 工具栏仍保留完整工具行（locked mode）
  - SelectionPopup 是补充的快捷入口（默认模式）
  - 当工具栏处于高亮/下划线 locked 模式时，不显示弹层（保留当前行为）

### 7.3 组件设计

```text
新建文件：
  src/features/reader/pdf/SelectionPopup.tsx

定位方式：
  - mouseup 事件触发时记录位置
  - 在 PdfReader 的 state 中存储 { visible, x, y, selection }
  - SelectionPopup 接收 { x, y } 做 absolute 定位
  - 弹层使用 transform: translate(-50%, -100%) 使其出现在选区上方

CSS class:
  .selection-popup
  .selection-popup-actions（按钮行）
```

---

## 8. App Shell 视觉细化

### 8.1 Scene Rail 改动

当前 scene-rail 是 44px 宽 icon-only。

目标：
- 宽度从 44px 增加到 52px
- `.scene-button` 宽度/高度从 34px 增加到 38px
- `active` 状态增加文字 label（中文2-3字，在 icon 下方）
- label 字号 10px，不换行
- 非 active 状态不显示 label（保持紧凑）

### 8.2 整体 app-shell 响应式

```css
/* 更新 layout.css */
.app-shell { grid-template-columns: 52px 1fr; }

/* active 状态带 label */
.scene-button { flex-direction: column; gap: 2px; }
.scene-button-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
  opacity: 0;
}
.scene-button.active .scene-button-label { opacity: 1; }
```

---

## 9. ReaderContext 重构（技术前置）

### 9.1 当前问题

`App.tsx` 直接持有所有 reader 状态（layout / contentMode / fileMode / zoom / pageState / focusedAnnotationId / sidePanelOpen / sidePanelTab / translatedFileId / parallelSyncLocked / activeAnnotationTool / activeAnnotationColor / noteDraftPatch）并通过 ~30 个 props 传递给 `ReaderScene`。

任何 reader UI 的改动（如增加左侧面板状态）都需要修改 App.tsx、ReaderScene、ReaderToolbar 的 props 接口，风险和工作量高。

### 9.2 解决方案

建立 `ReaderContext`，把所有 reader 关注点收进 context：

```
src/features/reader/ReaderContext.tsx
  └── ReaderProvider（包裹 ReaderScene 内部）
  └── useReaderContext()（子组件使用）
```

**迁移策略（不是一次性重写）：**

1. 新建 `ReaderContext.tsx` 定义 context 类型和 Provider
2. `App.tsx` 仍持有状态（不动），把 state + setters 作为 `initialState` 和 `onPersistState` 传给 `ReaderProvider`
3. `ReaderProvider` 在内部管理状态副本，在需要时通过 `onPersistState` 上报给 App
4. `ReaderScene` 包裹在 `ReaderProvider` 内，不再传 30 个 props
5. 子组件逐步从 props 改为 `useReaderContext()`
6. 稳定后，将状态完全移入 context，App.tsx 只保留 `selectedPaperId` 和跨场景状态

### 9.3 `useAnnotationHistory` 集成

`useAnnotationHistory` 目前需要 `aster`、`selectedPaper`、`readerFileMode` 等外部依赖，无法直接挪进 context 内部而不带入 aster 引用。

解决方案：
- `ReaderContext` 不拥有 `useAnnotationHistory` 的实例
- 而是接收 annotation 操作方法作为参数（从 App.tsx 传入）
- 这样 context 提供统一接口，不改变 hook 的依赖图

```typescript
type ReaderContextConfig = {
  paper: PaperDocument | null;
  persistedState: PersistedReaderState;
  onPersistState: (state: PersistedReaderState) => void;
  annotationHandlers: {
    createAnnotation: (...) => Promise<string | undefined>;
    updateAnnotationComment: (...) => Promise<void>;
    updateAnnotationColor: (...) => Promise<void>;
    updateAnnotationPosition: (...) => Promise<void>;
    deleteAnnotation: (...) => Promise<void>;
    undoAnnotationAction: () => void;
    redoAnnotationAction: () => void;
    canUndo: boolean;
    canRedo: boolean;
  };
  noteSave: (noteId: string, content: string) => Promise<void>;
  noteCreate: (paperId: string) => Promise<void>;
};
```

---

## 10. 视觉设计规则（延续阶段 2，做增量）

### 10.1 颜色 token（不改变，只明确用法）

```css
/* 主色调 - 已有 */
--accent:        #4d836b;   /* 绿色，用于选中状态、高亮颜色指示 */
--accent-strong: #2f654f;   /* 深绿，用于交互文字颜色 */
--accent-soft:   #e1eee6;   /* 浅绿，用于选中背景 */

/* 新增建议（可选，仅在 tokens.css 追加） */
--surface-elevated: #ffffff;  /* 弹层、popover 背景 */
--panel-bg:  rgba(255,255,255,.58);  /* 侧边面板背景 */
--toolbar-bg: rgba(255,255,255,.82); /* 工具栏背景 */
```

### 10.2 左侧面板视觉

```css
.reader-left-panel {
  width: 240px;
  height: 100%;
  border-right: 1px solid rgba(36,45,39,.06);
  background: rgba(255,255,255,.48);
  overflow: hidden;
  transition: width .15s ease;
}
.reader-left-panel.collapsed { width: 0; }
```

### 10.3 SelectionPopup 视觉

```css
.selection-popup {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(32,40,34,.88);
  box-shadow: 0 6px 18px rgba(26,41,33,.18);
  pointer-events: auto;
  backdrop-filter: blur(4px);
}
.selection-popup button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: transparent;
  color: white;
  box-shadow: none;
}
.selection-popup button:hover { background: rgba(255,255,255,.15); }
```

---

## 11. 不做范围

Phase 3 明确不做：

- 不做页面缩略图（Thumbnail）面板（Phase 4 候选）
- 不做完整 Zotero 级标注筛选、分类、导出
- 不做完整 Obsidian 双链和全局反链
- 不做多窗口 / docking / 拖拽布局
- 不引入新的 UI 框架
- 不重写 PDF.js 渲染策略
- 不改变标注数据模型
- 不做删除线 / 自由画笔 / 形状 / 箭头工具
