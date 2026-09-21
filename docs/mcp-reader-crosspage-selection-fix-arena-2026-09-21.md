# 阅读器：跨页拖选按页拆分生成标注、文本框正文不再混入选区（任务卡 8dba61be，审计 F3）

- 日期：2026-09-21；执行者：Arena（任务板 worker「Arena执行」）。
- 任务卡：`8dba61be-7a0b-4a26-bbad-3399d3f75aa5`（high），来源审计 `docs/mcp-reader-annotation-audit-arena-2026-09-21.md` 问题 F3。
- 分支：`fix/reader-crosspage-selection-arena`，基于 `main c01715c`（工作树 `.worktrees/fix-crosspage-arena`）。
- 提交：`8d89134`（修复）、`a9fb934`（回归脚本 + verify-all 接入）、后续文档/状态提交见 §6。
- 结论：60% 缩放两页同屏、从第 1 页末行拖到第 2 页首行时，高亮/下划线按页各生成 1 条记录（quote、几何各归本页）；文本框/便签正文非编辑态不可被文字选区选中，也不会进入 quote；单页、跨行选区行为不变。

## 1. 根因

1. `src/features/reader/pdf/PdfReader.tsx` 的 `finishTextSelection` 只接受「公共祖先在当前页文字层内」的 Range：`if (!textLayer?.contains(range.commonAncestorContainer)) return;`。跨页选区的公共祖先是文档容器，于是直接返回，既不生成记录也没有提示（审计 F3 的「静默失效」）。
2. 文本框的正文容器 `.text-annotation-content` 没有 `user-select` 约束，`.annotation-text-editor` 又常开 `user-select: text`；覆盖层在 DOM 顺序上位于文字层之后，跨页/跨区拖选时浏览器会把文本框正文一并纳入 Selection，`selection.toString()` 因而混入正文。

## 2. 修改

| 文件 | 变化 |
| --- | --- |
| `src/features/reader/pdf/pdfSelection.ts` | 新增 `textSelectionPageElements(root, range)`（选区触及的 `.pdf-page`，按文档序）、`clipRangeToNode(range, node)`（把 Range 起止裁到某页文字层内）、`quoteFromTextItemSelections(textItems, selections)`（quote 只由文字层运行按偏移拼装，行/列或间距 > 0.25% 时补空格，复用 `textItemsSeparated`）。 |
| `src/features/reader/pdf/PdfReader.tsx` | `finishTextSelection` 改为：取选区触及的所有页面 → 每页 `clipRangeToNode` → `textSelectionDraft(pageElement, range, tool)` 计算该页的偏移、几何（旋转页仍走运行框切片，水平页用裁剪后 Range 的 `getClientRects`）与 quote → 逐页 `saveAnnotationDraft`。没有任何页面命中时才不创建。SelectionPopup（鼠标工具选中后的高亮/下划线按钮）走同一函数，同样按页拆分。 |
| `src/ui/styles/reader.css` | `.annotation-mark` 及其 `.text-annotation-content` / `.sticky-note-content` 设 `user-select: none`：覆盖层文字不是页面正文。 |
| `src/features/reader/pdf/pdf-text-annotation.css` | 行内编辑器的 `user-select: text` 限定在 `.annotation-mark.text.text-inline.editing` 下，编辑态可正常选字/光标。 |
| `scripts/verify-pdf-crosspage-selection.mjs`（新） | 见 §3；`package.json` 新增 `test:pdf-crosspage-selection`，`scripts/verify-all.mjs` 接入。 |

行为说明：跨页选区被拆成多条记录（每页一条，quote 为该页被选文字），而不是一条跨页记录——位置 JSON 以页面百分比表达，无法跨页；这与验收标准「按页拆分生成标注，或给出明确提示」中的前者一致。

## 3. 回归测试

`npm run test:pdf-crosspage-selection`（31 断言）：在一个最小 DOM 双胞胎（节点顺序、Range 边界、`intersectsNode`、`querySelectorAll` 子集）上运行真实的 `pdfSelection.ts`：

- 三页文档，第 1 页覆盖层含文本框正文 `NOTE BODY`；从第 1 页末行中部拖到第 2 页首行：触及页面恰为 [1, 2]；原始 Range 的 `toString()` 含 `NOTE BODY`，而两页裁剪后的偏移/quote 都不含；第 1 页裁剪保留原起点、终点落在文字层末尾，第 2 页反之；各自的偏移与几何独立；
- 单页两行选区：只触及第 1 页，裁剪不改变边界，偏移与 quote（两行以一个空格连接）不变；仅落在文本框内的选区不触及任何文字层；
- quote 拼装：同一行相邻运行粘连（`Hel`+`lo`→`Hello`）、间距超过 0.25% 补空格、偏移生效、未知条目跳过、竖排列之间补空格；
- 源码/样式契约：`PdfReader.tsx` 使用 `textSelectionPageElements` / `clipRangeToNode` / `quoteFromTextItemSelections` 并逐条保存，不再依赖 `commonAncestorContainer`；两处 CSS 规则存在。

## 4. 隔离实例验收（真实窗口 + SQLite）

- 构建：`.tmp/f3/build-f3.mjs`（`tauri build --debug --no-bundle`，身份 `app.aster.research.dev.arena-f3.*`，端口 1485 / CDP 9315，复用 `.build/live-dev/qingcheng-review-c9f3/target` 缓存）。
- 驱动：`.tmp/f3/f3-crosspage-driver.mjs`（与 F1/审计驱动同构：独立 HOME/AppData/WebView2 profile、`checkDevAdmission` 登记身份、CDP 真实鼠标、`node:sqlite` 只读）。合成 PDF `CrossPageSelection.pdf`（p1 顶部两行 + 底部一行、p2 顶部两行、p3 一行）放在 `.a4-tests/acceptance/8dba61be-…/<runId>/`，每次运行清空隔离库。
- 步骤与结果（22/22 通过，`.tmp/f3/evidence/summary.json`、`driver.log`、截图 `00`–`07`）：
  1. 「文本框」工具在第 1 页点击并输入 `NOTE BODY must not be quoted`，Ctrl+Enter 提交：SQLite 出现 1 条 `text` 记录。
  2. 「缩小」4 次到 60%，页 1 末行与页 2 首行同屏（视口 1280×820）。
  3. 「高亮」从页 1 末行拖到页 2 首行：新增 **2 条 highlight**（page 1 quote `Page one bottom line before break`，page 2 quote `Page two top line after brea`），quote 均不含 `NOTE`，各自段落坐标在 0..100 内，DOM 高亮带落在各自行上。
  4. 「下划线」从页 1 末行左侧空白拖到页 2 第二行：新增 2 条 underline，page 2 记录含 2 个段落、quote `Page two top line after break Page two second line`，页 2 显示 2 条下划线。
  5. 单页两行高亮：仅 1 条记录、2 个段落，quote `Page one top line Page one middle line`。
  6. 文本框正文 `getComputedStyle(...).userSelect === 'none'`，「鼠标」工具横穿文本框拖动后 `getSelection()` 为空。
  7. `Page.reload` 后重新打开：记录数不变，页 2 高亮仍渲染。
  8. 隔离校验：`get_aster_paths` 根目录位于 `app.aster.research.dev.arena-f3.*` 之下。

## 5. 验证命令

- `npm run test:pdf-crosspage-selection`：31 断言通过。
- `npx tsc -b`、`npm run test:reader-helpers`、`npm run test:pdf-rotated-text`（142）、`npm run test:pdf-text-annotation`（28）、`node scripts/verify-reader-priority-fixes.mjs`（60）、`node scripts/verify-reader-rendering.mjs`、`node scripts/verify-architecture-boundaries.mjs`、`npm run test:ui-state`：通过。
- `npm run verify`、`npm run test:agent-status`：见 §7。

## 6. 注意事项

- 隔离实例与任务板：执行期间 MCP 隧道中断约 30 分钟（Cloudflare 530），恢复后任务板服务 4319 一度不可达（需在 A4 Note 中打开项目，未自行起服务），心跳按规则在恢复后补发。
- `.worktrees/` 仍未被 `.gitignore` 忽略，仓库根执行 `git clean -fd` 会清空所有工作树（今日已发生一次）。
- 跨页拆分后每页一条记录，标注列表中会看到两条相邻记录；若希望合并展示，需要位置模型支持多页，属于后续工作。

## 7. 运行记录

- `npm run test:pdf-crosspage-selection`：31 断言通过；隔离实例 arena-f3 驱动 22/22 通过（见 §4）。
- `npm run verify`：在 `a9fb934`（含修复 `8d89134`）上全量通过（Rust 209 过 5 忽略；`.tmp/f3/verify.log`）。
- `npm run test:agent-status`：通过（状态行提交后复跑）。
- 上传到任务卡的结果附件：`03-cross-page-highlight.png`、`04-cross-page-underline.png`、`05-single-page.png`、`06-text-box-unselectable.png`、`summary.json`、驱动脚本。
