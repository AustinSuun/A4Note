# 总览笔记字段卡片：去掉标题分隔点，左侧把手拖动全局排序（arena-two，2026-09-27）

任务：`07abf228-0789-4a9c-9589-10cc1d2accb3`。分支 `fix/summary-field-sort-arena-two`（基于 main `bbab3b6`，即 9ddfe985 已合并后的树）。

## 结论（先说清模型边界）

- 卡片顺序是**只读视图**：`SummaryDocumentEditor` 现在按**全局字段目录（summary layout `columns`）的顺序**渲染字段卡片；笔记文件里的块顺序、自由内容位置、字段成员、marker、字节全部不动。
- 拖动/键盘排序 = **只改全局目录顺序**（`moveSummaryFieldBeside` → 既有 `saveSummaryFieldCatalog(session, next, baseline)` CAS 路径，`save_summary_layout` 带 `expectedContent`）。同一 `summaryLayoutSession()`（按路径共享）的所有订阅者——其他论文的总览笔记、文献库综览表、字段目录对话框——同步更新，无需重新打开。
- 没有任何批量改写笔记；不需要"重排文件"，因此不存在跨笔记不一致的风险。

## 交互

1. 卡片标题：`字段` 小标签（弱化底色）+ 字段名（加粗），不再是「总览字段 · 字段名」；自由内容卡片仍为「自由内容 N」。
2. 每张**可排序**字段卡片（字段在全局目录中、可编辑、目录已加载且无错误、本篇 ≥2 张可排序卡片）左侧有 16×22 六点把手（`.summary-document-handle`，`cursor:grab; touch-action:none`），`aria-label` 含全局位次与 ↑/↓ 提示，`title` 说明"对所有总览笔记生效"。
3. 指针：只有在把手上按下才开始拖动（pointer capture）；拖动中根容器加 `sorting`（禁止选区、`grabbing` 光标、预览层不响应指针），被拖卡片 `lifted`（半透明虚线），目标卡片 `drop-before/after` 显示 3px 强调线；靠近容器上下边缘自动滚动；Escape 取消；松手落到当前位置或未移动则不写盘。
4. 键盘：把手聚焦后 ↑/↓ 把字段移到本篇**上一/下一张显示卡片**之前/之后（跨过本篇没有的字段，不会碰它们）；到头时 `aria-live` 提示"已在本篇最前/最后"；焦点保持在同一把手（未用 `disabled`，用 `aria-disabled/aria-busy` 表示保存中）。
5. 完成后 `.summary-document-notice`（aria-live=polite）宣告「已更新全局字段顺序：X 现在位于 Y 之前（第 n / N 位）」。
6. 只读（`readOnly`/`surfaceActive=false`）、目录加载失败、未登记字段：不显示把手，卡片仍按目录顺序显示。
7. 保存失败或并发冲突（`expectedContent` 不匹配）：抛错 → 组件把被拒绝的草稿从共享 session 回退到之前已知内容（仅当 baseline 未变），所有视图恢复原顺序，并以 `role=alert` 显示「字段顺序未保存，已恢复原顺序：…」，不假装成功；把手立即可再次使用。
8. 直接编辑、标题点击、滚动行为不变（卡片正文拖选文字不会触发排序——浏览器与原生均实测）。

## 代码

- 新增 `src/core/summaryFieldOrder.ts`：`orderSummarySegments(segments, columns)`（自由内容跟随其后面的字段块；领头自由内容保持最前；未登记字段按文件顺序排在已登记之后；技术段不动）、`visibleSummaryFieldIds`、`moveSummaryFieldBeside(columns, id, target, side)`（基于既有 `reorderSummaryField`）、`sameSummaryFieldOrder`。
- `src/features/library/SummaryDocumentEditor.tsx`：渲染 `ordered` 段；把手 + pointer/keyboard 排序状态机（`dragRef`、rAF 自动滚动、Escape）、`commitOrder`（CAS 保存 + 失败回退）、通知区；标题改为 kind 标签。`data-summary-field` 只出现在可排序卡片上。
- `summary-document-editor.css`：`.summary-document-kind`、`.summary-document-handle`、`.sorting`、`.lifted`、`.drop-before/.drop-after`、`.summary-document-notice`。
- `package.json` `test:summary-fields` 追加两条测试。

## 验证

- `npx tsc -p tsconfig.app.json --noEmit` 0（注意：根 tsconfig 是 project references，裸 `tsc --noEmit` 检查 0 个文件）；`npm run build`（`tsc -b && vite build`）通过。
- 新增纯逻辑测试 `scripts/verify-summary-field-order.mjs`：8 组断言（目录顺序视图/自由内容跟随/未登记字段/无目录、纯视图不改源、visible ids、相邻移动只改顺序、同位无操作、缺失字段拒绝、两篇子集一致）。
- 新增浏览器测试 `scripts/verify-summary-field-sort-browser.mjs`：两份真实编辑器挂载在同一页面，共享模拟目录 IPC（内存 layout，`save_summary_layout` 校验 `expectedContent`）。25 断言：标题无 `·`；两篇均按目录顺序、自由内容跟随其块；笔记字节不变；把手只在字段卡片；把手度量（grab/touch-action none/位于标题左侧）；拖动中 lifted/drop-line、无选区无编辑器；落下仅一次保存、目录仅顺序变化、两篇同步、字节仍一致、通知出现并退出 sorting；↑ 键移动、焦点保留、↓ 跨过本篇没有的字段；正文拖选不排序；Escape 取消不保存；保存失败 → alert + 两篇恢复 + 未写盘 + 把手可用；并发改动被 expectedContent 拒绝且不覆盖；只读无把手仍按目录序；640px 宽 + zoom 1.25 把手可见；无 pageerror/console.error。
- `npm run test:summary-fields` 全绿（含既有 direct-edit 14、scroll、excerpt 等）。
- `npm run verify`：见 delivery validation（`test:ui-state` 为 main 既有失败，42184f1 引入的 `reader-toolbar-center` 与旧断言冲突，本任务未改 reader）。
- 原生 dev:live 隔离实例 `arena-two-sort`（`tauri dev --config`，identifier `app.aster.research.dev.arena-two-sort.w37a64a37ec`，独立 AsterData + WebView2 profile，DEV 绿条，CDP 9329，未触碰真实资料库）：`scripts/verify-summary-field-sort-native.mjs <before|after|restart>`。
  - before（`git stash` 到 bbab3b6 源码）：标题「总览字段 · 主要功能」等 4/4 含 `·`，把手 0，无法排序。
  - after：标题 `字段数据集` 等 0 含 `·`；把手 4/4，仅字段卡片，16×22，grab；拖动最后一张到第一张前 → 目录 `[online,venue,dataset,…,code,…]` → `[online,venue,code,dataset,…]`，两篇显示同步，`read_paper_summary` 字节前后一致，目录除顺序外逐字段相同；把手 ↑ 键移动生效且焦点仍在把手；正文拖选不排序；暗色；900×700 窄窗把手可见并可拖；第二篇（导入 fixture PDF `1706.03762.pdf`）总览笔记按目录顺序显示，在第二篇拖动后回到第一篇卡片已是新顺序；文献库「综览」表列头顺序 = 目录顺序；pageerror/console.error 0（`Runtime.enable` 回放的 HMR 期间旧消息单独记录）。
  - restart：taskkill 实例后重新启动，`read_summary_layout` 顺序与 after 结束时写入的 `expected-order.json` 完全一致，卡片顺序一致。
  - 截图 `docs/screenshots/summary-field-sort-arena-two/`。

## 未做 / 边界

- 没有引入按笔记单独排序（任务要求全局）；文件顺序保持不变意味着"以源码修复"看到的仍是文件原顺序（有意为之，说明文字已写在提示里）。
- 字段目录对话框（`SummaryFieldSettings`）的上移/下移与本功能写同一目录，未改动。
- 未安装/打包/发布，未重启 4319，未触碰真实资料库。
