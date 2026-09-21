# 阅读器：无文字层页面（扫描页）使用文字工具时的提示（arena-one，2026-09-21）

## 任务

- 项目任务：`259f7b91-d193-4345-bd07-741d0075c76c`（来源：审计 `4de2cac5` 问题 F6，priority high）
- 分支：`fix/reader-text-tools-no-text-layer-arena`，worktree `.worktrees/scanned-texttools-arena`
- 基线：`e394cfe`；rebase 到 main `c01715c` 后 `git merge --ff-only` 合并为本地 main `61720e9`

## 缺陷机制（源码确认）

- `PdfReader.finishTextSelection`（`src/features/reader/pdf/PdfReader.tsx`）在找不到包含选区的 `.pdf-text-layer` 时静默 `return`；即使放行，`textSelectionRectsFromOffsets(textItems=[])` 也只会得到空 rect，随后 `if (!rects.length) return`。
- 纯栅格/扫描页没有文字层（`page.textItems.length === 0`），所以高亮/下划线拖拽既不产生标注、也不给任何提示。两条入口都受影响：文字工具自动落标注的 window `mouseup`，以及光标模式下的 SelectionPopup。

## 实现（小而聚焦）

- `src/features/reader/pdf/PdfReader.tsx`：新增 `pageHasSelectableText(pageNumber)`（当前页 `textItems.length > 0`）与 `showTextLayerHint()`（可重入计时器、5.2 秒自动消失、卸载时清理）；切到高亮/下划线且当前可视页无文字层时立即提示；`pageHandlers.onMouseDown` 在无文字层页面上直接提示并返回，不再走进静默失败路径；向 `PdfPageView` 传 `textToolsUnavailable`。
- `src/features/reader/pdf/PdfPageView.tsx`：新增 `textToolsUnavailable` 属性，命中时页容器加 `text-tools-unavailable` 类。
- `src/ui/styles/reader.css`：`.pdf-page.text-tools-unavailable`（含其文字层与 span）光标 `not-allowed !important`；新增 `.pdf-text-layer-hint` 顶部居中浮层（`pointer-events: none`，不拦截交互）。
- `src/ui/zh.ts`：新增 `reader.textLayerUnavailable` 文案。
- 未改动几何/画笔/文本框/橡皮路径；未触碰同域卡 `b6c1a566` 涉及的高亮几何与 `pdfAnnotationHelpers`、`PdfHighlightLayer`。

## 验证

1. 构建：`npx tsc -b` 0 错误、`npx vite build` 通过。
2. 全量：合并后的 main 上 `npm run verify` 全绿（`A4Note verification passed`、`verify_exit=0`，含 cargo test）。
3. 合成夹具浏览器回归：新增 `scripts/verify-reader-text-tool-scan-notice.mjs`（生产 Vite 构建 + 合成两页 PDF：第 1 页 Helvetica 正文，第 2 页没有任何文字算子），headless Edge/Chrome over CDP：23/23 通过，pageerror 与 console error 均为 0；证据 `.tmp/shots/text-tool-scan-notice/`（截图 + `result.json`）。
4. 隔离原生实例：`npm run dev:live -- --instance scantools --port 1432 --cdp-port 9242`（身份 `app.aster.research.dev.scantools.w6515a5643c`，`get_dev_environment.mode === 'isolated'`，窗口底部为绿色「独立测试库（原生已核验）」状态条），用附着真实窗口的 CDP 驱动 `.tmp/scan-native/scan-driver.mjs` 驱动：33 项通过 / 0 失败（1 条备注：总览未列出夹具时改用文献库表格打开）；证据 `.tmp/shots/text-tool-scan-native/`（截图 + `driver.log` + `result.json`）。
   关键断言：扫描页带 `text-tools-unavailable` 且光标 `not-allowed`；提示文案与 `zh.reader.textLayerUnavailable` 完全一致，`role=status`、`aria-live=polite`、`pointer-events=none`；在扫描页拖拽高亮不产生新记录且提示仍在屏上；下划线工具同样处理；矩形/自由画笔/文本框在扫描页仍各建 1 条记录；文字页无标记、光标仍为 `crosshair`、高亮照常创建。
5. 隔离 SQLite 终态：`annotations` 表中该 `paper_id` 恰为 `rect 1 / ink 1 / text 1 / highlight 1`，扫描页（page 2）零条高亮/下划线记录。

## 交付与合并

- 交付 commit `61720e9`（分支 `fix/reader-text-tools-no-text-layer-arena`），基线 `e394cfe`，rebase 到 `c01715c` 后 `--ff-only` 合并本地 main。
- 变更文件：`src/features/reader/pdf/PdfReader.tsx`、`src/features/reader/pdf/PdfPageView.tsx`、`src/ui/styles/reader.css`、`src/ui/zh.ts`、`scripts/verify-reader-text-tool-scan-notice.mjs`（+430 / -1）。

## 未覆盖 / 边界

- 夹具是「整页无文字层」；同一页内混合（扫描条带 + 文字层）不在本卡范围。
- 提示只在切到高亮/下划线时、以及在无文字层页面上按下鼠标时出现；工具栏按钮仍可切换，也不阻止用户继续尝试（非阻断设计）。
- 未用真实扫描 PDF（审计样本 `AuditReaderTools.pdf` 已被清理），未测触摸/触控笔，未测长文档连续滚动时提示与翻页切换的动画细节。
- 未安装、未打包、未发布；未重启 4319；未接触真实资料库；未改动其他 agent 的 worktree。
- main 工作树中既有的两行未提交状态改动（本会话更早的 MCP 重连接记录）随本次一并提交，未回滚任何内容。

## 复现

```bash
# 浏览器夹具（不需要原生）
node scripts/verify-reader-text-tool-scan-notice.mjs
# 隔离原生实例 + 附着驱动
npm run dev:live -- --instance scantools --port 1432 --cdp-port 9242
node .tmp/scan-native/scan-driver.mjs
```

