# 阅读器标注列表面板入口修复（qingyan / 2026-09-21）

任务：`0bd39f48-74fe-41e6-8a5a-4e1112e7331f`（high）。分支 `fix/annotation-list-entry-qingyan`，
基线 main `18f3ea9`，独立 worktree `.worktrees/annot-list-qingyan`。

## 1. 问题与根因

卡片要求「+」菜单能添加标注面板、列表展示颜色/引文/页码、点击跳转选中、列表数与 SQLite 一致。
只读排查后确认三处缺陷，而不是最初判断的一处：

1. **面板入口缺失（主因）**：`src/features/reader/ReaderSideDrawer.tsx` 的
   `workspacePanelTabs` 白名单写死为 `['notes', 'chat', 'cite']`，漏掉 `annotations`。
   其余基础设施本已齐备——`src/core/workbench.ts` 注册了 `reader.annotations`，
   `src/features/reader/contributions.tsx` 注册了渲染器，`readerHelpers.ts` 有 label/icon/命令标题。
   「+」菜单的 `addablePanels` 完全由该常量过滤，因此标注面板只能由程序调用打开，用户无从进入。
2. **引文未渲染**：`AnnotationListPanel.tsx` 只渲染页码与类型。`annotation-quote` 这个类名
   属于「引用到笔记」按钮，并非引文文本；`annotation.quote` 从未出现在界面上。
3. **点击不跳页**：列表行的 `onClick` 绑定 `onFocusAnnotation`，它只设置选中态。
   真正会跳页的是 `onNavigateAnnotation`（`setReaderRequestedPage` + 设置聚焦），
   该回调已传入 `ReaderSidePanelContent` 并供其他面板使用，唯独没接到标注列表上。

## 2. 改动

- `src/features/reader/ReaderSideDrawer.tsx`：`workspacePanelTabs` 插入 `annotations`（置于
  `notes` 之后，与 workbench contribution 的 order 对齐）。
- `src/features/reader/AnnotationListPanel.tsx`：在页码/类型行下渲染 `annotation.quote`。
- `src/ui/styles/reader.css`：新增 `.annotation-list-quote`（左侧引文竖线，最多三行截断）。
- `src/features/reader/ReaderSidePanelContent.tsx`：标注列表的 `onFocusAnnotation`
  改接 `onNavigateAnnotation`，使点击既跳页又选中。

提交：`8e917a2`（入口）、`2299fb0`（引文与跳转）。

## 3. 验收证据

隔离实例：`npm run dev:live -- --instance qingyan --port 1433 --cdp-port 9243`，
自动化经 CDP 9243 操作，截图保留底部 `DEV qingyan · 独立测试库（原生已核验 …）` 状态条。
隔离库由 fixture 播种一篇内置指南 PDF，并在其 SQLite 中写入 3 条标注（第 1/2/3 页，
yellow/blue/green，highlight/underline/comment）。

| 验收项 | 结果 |
| --- | --- |
| 「+」菜单出现标注入口 | `MENU_ITEMS = ["笔记","标注","对话","引用"]` |
| 列表显示页码/类型/颜色/引文 | 三行分别为「第 1 页 高亮」「第 2 页 下划线」「第 3 页 批注」，各带引文与颜色行 |
| 点击跳转并选中 | 点第 1 行 → 页码输入框 `1`、聚焦行 `[0]`；点第 2 行 → 页码 `2`、聚焦行 `[1]` |
| 列表数与 SQLite 一致 | SQLite `annotations` 3 行；列表 `.annotation-list-item` 3 项；文献库列显示「注 3」 |

自动化全程收集 `pageerror` 与 console error，均为空（`ERRS []`）。
截图存 `.tmp/shots/`（不入 `docs/`），关键帧：`annot-91-plus-menu.png`（+ 菜单含标注）、
`annot-B1-quotes.png`（引文渲染）、`annot-G2-row2-page2.png`（跳到第 2 页且第 2 行选中）。

## 4. 测试

- `npm run build`：通过。
- `get_diagnostics`：0 error。
- `npm run verify`：34 个套件中 3 个失败——`test:reader`、`test:pdf-text-annotation`、
  `test:ui-state`。**这三项为基线既有失败，与本次改动无关**，依据：
  - 在 `git stash` 掉全部改动的干净基线上单独重跑 `test:reader`，复现完全相同的断言失败
    （`expected: /const inset = Math\.min\(Math\.max\(height \* 0\.04, 0\.015\), 0\.12\)/`）。
  - 改动前后两次 verify 失败的套件与断言一致；失败断言指向 `pdfAnnotationHelpers.ts` 的
    下划线 inset 公式与 `.annotation-color-presets` 的十列栅格，属于他人在途任务领域。
  - verify 日志中对本次修改的三个文件零引用。

## 5. 风险与遗留

- 上述 3 项基线失败仍待其归属任务处理，本卡未触碰相关文件。
- 隔离库为合成数据（fixture PDF + 播种标注），未使用任何真实资料。
- 验证期间清理过一次自己实例的陈旧 `owner.lock.json`（owner PID 已确认不存在、
  锁内路径与实例名均为本会话所有），未终止他人进程。
