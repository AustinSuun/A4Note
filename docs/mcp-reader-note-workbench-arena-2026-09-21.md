# 阅读器笔记工作台（24ea34e5）实施与验证记录

任务：24ea34e5（high，spec_revision 4，17 项验收）——「阅读器笔记工作台重设计：可调分屏/悬浮速记/专注模式、
Markdown 固定内容列与平滑切换」。执行者：arena-one（本机标签 arena），独立 worktree
`.worktrees/reader-note-workbench-arena`，分支 `feat/reader-note-workbench-arena`，基线 main 见合并提交说明。

## 1. 设计

四态状态机（`src/features/reader/noteWorkbench.ts`，纯函数、无 DOM 依赖）：

- `reading`（PDF 专注，笔记收起）／`split`（边读边记）／`floating`（悬浮速记）／`writing`（专注写作）。
- `resolveNoteWorkbenchMode(prefs, available)`：宽窗（>=1200px）使用用户偏好；980–1199px 仍可用分屏与专注写作；
  窄于 980px 时**临时**降级为悬浮卡，返回 `temporary: true` 并保留 `prefs.mode`，宽窗恢复后回到原偏好。
- `splitWidthPx(available, ratio)`：默认比例 0.37（34%–40% 区间），夹在 26%–62%，并保证 PDF 侧至少 520px、
  笔记侧至少 300px。
- `clampFloatingRect` / `floatingCardBox`：悬浮卡几何以容器比例存储（窗口与 100%–200% 缩放后仍然成立），
  横向 `x <= 1 - width`、纵向同理，卡片不可能越出内容区。
- 偏好按论文分键存储：`a4note.reader.noteWorkbench.<paperId>`，含 `mode / previousMode / wideMode / splitRatio /
  floating / activeNoteId`；`normalizeNoteWorkbenchPrefs` 对损坏或残缺字段逐项安全回退，存储被拒（隐私模式/满盘）
  不影响阅读。

React 侧：`useNoteWorkbench(paperId, available)` 提供 `setMode / restoreMode / setSplitRatio / setFloatingRect /
setActiveNote`。`ReaderScene` 只在模式变化时同步侧栏开合与 `writing` 展开态，正文列宽度来自 `splitWidthPx`
并由现有 `useReaderDrawerLayout` 消费，因此拖动分隔条写回的是「比例」而不是像素常量。

界面：`ReaderNoteWorkbenchMenu` 是阅读顶栏**唯一**入口——主按钮恢复上次模式（`reading` 与 `wideMode` 之间切换），
相邻下拉菜单提供四种模式、新建论文笔记与笔记历史；菜单支持方向键/Home/End/Escape，焦点回到打开它的控件，
每个模式项带 `kbd` 提示与 `aria-keyshortcuts`。

共享命令注册表接缝：`NOTE_WORKBENCH_COMMAND_LIST` 暴露 `reader.notes.toggle`、`reader.notes.quickCapture`、
`reader.notes.mode.split`、`reader.notes.mode.focus`、`reader.notes.mode.floating`、`reader.pdf.focus`
（id + 标题 + 默认键位）。`useReaderWritingShortcuts` 改为**单一**监听器：命中的按键映射为上述命令 id 后调用同一个
`runWorkbenchCommand`，因此快捷键分支的 scoped resolver（`src/core/shortcuts.ts`，见 `.worktrees/shortcuts-qingyan`）
注册同一份清单即可接管，不需要第二套监听。`src/features/reader/*` 未复制任何快捷键判定表。

移除的旧入口：阅读场景右侧纵向「继续笔记」耳朵（旧 `ReaderScene` L189-194）、笔记面板头部的「全宽写作/返回分栏」
按钮（`ReaderSideDrawer` 的 `reader-writing-expand`）。annotations/chat 面板与拖宽分隔条不受影响。

正文列：新增共享 token `--authoring-content-max-width: 720px`（`src/ui/styles/tokens.css`）。阅读侧
`.md-body / .markdown-live-codemirror / .markdown-reader-content` 使用该 token 居中、窄容器自动收缩；
独立 Markdown 的窄版正文列同步改用同一 token（原先硬编码 760px），全仓不再存在第二套正文列宽度常量。chrome
（标题栏、工具栏、历史列表）不受该宽度限制。

## 2. 修改文件

- `src/features/reader/noteWorkbench.ts`（新增）
- `src/features/reader/useNoteWorkbench.ts`（新增）
- `src/features/reader/ReaderNoteWorkbenchMenu.tsx`（新增）
- `src/features/reader/ReaderScene.tsx`
- `src/features/reader/ReaderSideDrawer.tsx`
- `src/features/reader/ReaderMarkdown.tsx`
- `src/features/reader/ReaderNoteActivity.tsx`（未改；模式切换继续复用 `RetainedReaderNote` 保活编辑器）
- `src/features/reader/useReaderDrawerLayout.ts`
- `src/features/reader/useReaderWritingShortcuts.ts`
- `src/features/reader/reader-writing-layout.css`
- `src/features/explorer/markdown-dock-layout.css`
- `src/ui/styles/tokens.css`
- `scripts/verify-note-workbench.mjs`（新增，`npm run test:note-workbench`）
- `scripts/verify-note-workbench-browser.mjs`（新增，`npm run test:note-workbench-browser`）
- `scripts/verify-all.mjs`、`package.json`

## 3. 验证

- `npm run test:note-workbench`：51/51（四态解析、断点、比例与最小宽度、悬浮几何与越界、按论文偏好、损坏回退、
  活动笔记、命令映射、接线守卫）。
- `npm run test:note-workbench-browser`：42/42，隔离 headless Chrome + 真实 Vite（真实 `useNoteWorkbench`、
  `ReaderNoteWorkbenchMenu`、`ReaderDrawerResizer`、`reader-writing-layout.css`、`tokens.css`；合成宿主复刻
  `ReaderScene` 外壳；不接触用户配置/任务服务/原生资料库）。覆盖 9 个场景：入口恢复上次模式、菜单与键盘提示、
  分屏默认宽度与 PDF 最小宽度、拖动分隔条并按论文持久化、悬浮卡拖动/缩放/边界、专注写作满宽且编辑器不卸载、
  Escape 返回进入前模式、窄窗临时悬浮且不覆盖宽屏偏好、共享 token 与 reduced-motion、按论文模式与活动笔记、
  损坏偏好回退、重载恢复。截图与结论：`.tmp/shots/note-workbench/<run>/`（含 `result.json`）。
- `npm run test:reader`、`npm run verify`、`npm run build`：见交付说明与提交信息。
- 运行期间对 4 个产品源码文件取 SHA-256 前后比对，确认验证过程只读。

## 4. 与其他任务的协调

- `.worktrees/shortcuts-qingyan` 正在实现 scoped shortcut resolver（`src/core/shortcuts.ts`，提交 8c847d3）。
  本任务不修改该文件，也不在分支上添加 `src/core/shortcuts.ts`；只提供命令 id 清单与单一监听器改造，两分支合并时
  冲突面为 0（清单以数据形式导出，resolver 直接消费）。
- 与 `3128932d`（阅读器重叠高亮/跨行几何）、`8dba61be`（擦除精度）、`35496a06` 等工作无关文件不重叠；未改动
  `src/features/reader/pdf/**`。

## 5. 已知缺口（如实记录）

- 专注写作的 `Escape` 返回「进入前的模式」：从悬浮卡进入专注写作时返回悬浮卡（而不是强制回分屏），这是按验收
  ⑤「退出恢复进入前模式」实现的行为。
- 浏览器级证据使用合成宿主复刻 `ReaderScene` 外壳，不覆盖真实 PDF 渲染、原生持久化与打包产物；整机安装包验收
  不在本轮范围（未打包、未安装、未发布）。
- 笔记历史入口直接切换到工作台并复用面板内的历史弹层，没有新增独立历史视图。
