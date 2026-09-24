# 阅读器笔记入口右移（书签把手）任务派发记录

任务卡：`9b69c4b5-729c-4ee0-b8d7-03c0ddf882eb`（本机看板 · queued · high · spec_revision 3）
派发者：arena（远程 MCP 会话，代号「竞场」，dispatcher 授权由用户在对话中给出）
日期：2026-09-22

## 背景

阅读器标题栏左侧的 `ReaderNoteWorkbenchMenu`（「📖 笔记工作台 · PDF 专注 ▾」，约 150px）是
24ea34e5 引入的笔记工作台唯一入口。用户截图圈出该按钮并用箭头指向窗口右侧，要求把入口放到右边并重新设计。

## 方案对比与决定

派发前给出三个方案（静态示意见 `docs/prototypes/reader-note-edge-handle-2026-09-22.html`）：

| 方案 | 形态 | 优点 | 代价 |
| --- | --- | --- | --- |
| A | 标题栏右上角 28px 图标按钮 + 模式角标 | 占位最小、改动最小、右侧面板类控件的通用位置 | 模式靠图标表达，需学习一次 |
| B | 标题栏右上角分体按钮（图标 + 模式短文字 + ▾） | 文字明示模式 | 右侧仍偏挤，窄窗需退化 |
| C | 内容区右边缘竖向书签把手，打开后骑在分隔条上 | 与右侧面板的空间映射最强，兼任拖宽把手 | 需处理滚动条、悬浮卡、写作态、点击/拖动区分 |

用户选定 **方案 C**，优先级 **high**；「新建论文笔记 / 笔记历史」两项的去向由执行者决定（≤2 次点击可达）；
要求更新 `scripts/verify-note-workbench-browser.mjs` 并新增把手相关断言。

## 任务说明要点（完整内容以任务卡为准）

- 把手始终停靠在「PDF 与右侧抽屉的边界」：抽屉关闭时贴内容区右边缘，打开时骑在 `ReaderDrawerResizer` 上并随拖宽同帧移动，垂直居中。
- 收起态 22×88（NotebookPen + 竖排「笔记」），打开态 16×56 强调色（ChevronRight）；悬浮态贴右边缘且与悬浮卡互不阻挡；写作态把手在左边缘表示「返回论文」。
- 单击 = `NOTE_WORKBENCH_COMMANDS.toggle`；≥4px 位移视为拖宽；右键 / 长按 / ↓ 打开现有模式菜单（锚定把手内侧）；面板头部补紧凑模式切换。
- 保留 `useShortcutProps` 绑定，使 Ctrl 引导层键帽能锚定到把手；命令 id 与默认键位不变。
- 标题栏彻底移除旧入口（含 `ReaderResponsiveToolbar` 折叠项）；不改 PDF 渲染 / 标注 / 图层 / 底部工具栏。
- 与进行中的 63b530ee、54576b3e、f3878879 核对 `ReaderScene.tsx`、`ReaderSideDrawer.tsx`、`reader-writing-layout.css`、ShortcutHints 锚点的归属。

## 附件

- `reader-note-entry-reference.jpg`（reference）：用户原始截图。
- `note-toggle-redesign-mockup.html`（reference）：三方案对比示意，与本仓库 `docs/prototypes/reader-note-edge-handle-2026-09-22.html` 相同。

## 看板快照（派发时）

- in_progress：63b530ee 快捷键提示键帽、54576b3e 文本标注控件、f3878879 图层按钮高度。
- queued：本卡（9b69c4b5）。
- review：无；archived：63。

## 边界

- 本会话只发布任务，未领取、未执行、未改动 `src/`；未推送、未打包。
- 本文件与 prototype 为未提交的新增文件，由执行者随任务一并纳入提交，或由用户自行处理。
