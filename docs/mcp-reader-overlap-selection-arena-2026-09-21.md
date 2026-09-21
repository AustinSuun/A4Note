# 阅读器重叠标注选区补强（Arena，2026-09-21）

## 任务与边界

- 任务：`3128932d-e502-4c91-b543-3c5c1739ea5c`，分支：`fix/reader-overlap-selection-arena`。
- 基线：本 worktree 从本地 `main` `498745a001e6ca9cdceae60f91ea848bb8d7ed` 创建。
- 目标：高亮/下划线文字选择模式下，从既有范围标注起点开始、反向拖过既有标注并创建重叠标注；光标模式仍能分别选中、改色、删除标注。
- 遵守：未安装依赖、未发布、未重启 4319、未启动第二个原生实例、未读取或修改正式资料库。验证使用隔离浏览器/临时 PDF；任务卡已有的隔离 SQLite 证据继续作为原生交互证据。

## 实现

1. `src/features/reader/pdf/AnnotationMark.tsx`
   - 新增 `rangeSelectionActive`。
   - 对 `highlight`/`underline` 范围标注，在文字选择模式下让 `mousedown`、`mouseup`、`click`、`doubleclick` 直接返回，不调用 `preventDefault()` 或 `stopPropagation()`。
   - 文本框、图形、光标模式以及行内控件仍沿用原有事件路径。
2. `src/features/reader/pdf/AnnotationOverlay.tsx`
   - 根据 `activeTool === 'highlight' || activeTool === 'underline'` 传递 `rangeSelectionActive`。
3. `src/ui/styles/reader.css` 的既有模式规则未重复修改：文字选择模式下范围标注仍使用 `pointer-events: none`；本轮事件处理器补强用于防止命中路径在样式变化或事件回退时再次截断原生选区。

## 验证

### 自动化与源码

- `OVERLAP_ONLY=1 MODAL_PHASE=after node scripts/verify-pdf-text-annotation-browser.mjs`：9/9 通过（`cmd_63fbea981bcbe3fa308623ba2d1211262f763b101d8a2e2f`）。覆盖既有高亮内部反向拖选、完整 quote/几何、重叠标注独立聚焦、改色和删除；证据目录为 `.tmp/pdf-text-annotation/after/`。
- `npm run verify`：exit 0，Rust `209 passed; 0 failed; 5 ignored`（`cmd_c176aed1344e079324fb71d1f310a242b14dde3d94301237`）。
- `get_diagnostics`：当前 worktree `src` 返回 0 errors。
- `git diff --check`：通过。

### 正文区域、英文与中文文字层

为回应“不能只在 PDF 开头验证”的反馈，临时从生产 `PdfReader` 构建了同一套 CDP 浏览器回归，把测试点限制在第 1 页页面高度 30% 之后的正文区域（即 `targetTopRatio > 0.30`），分别运行高亮和下划线：

| PDF | 正文目标 | 结果 |
| --- | --- | --- |
| 英文 `arXiv 2505.13447v1`（真实 PDF） | 第 1 页摘要正文：`We propose a principled and effective framework for one-step generative modeling.`，`targetTopRatio=0.3032275884` | 高亮/下划线合计各 14/14；`pageErrors=0` |
| 中文文字层 PDF fixture（由临时 HTML 生成，含多段中文正文） | 第 1 页正文段落，`targetTopRatio=0.3134441929` | 高亮/下划线合计各 14/14；`pageErrors=0` |

每份 PDF 的 14 项检查均包含：正文命中真实 PDF text layer、选择模式穿过既有范围标注、生成非空 quote 和独立几何、切回 cursor 模式后的标注操作及删除新标注。截图和合并结果已作为任务卡 result 附件上传：

- `after-highlight-body.png`（英文、中文各一张）
- `after-underline-body.png`（英文、中文各一张）
- `real-body-evidence.json`

说明：当前 worktree 中未找到任务描述列出的 `2505.13447v1-仅译文.pdf`，因此没有冒充该命名文件已验证；中文结果使用的是独立的中文文字层 PDF fixture。若后续提供该确切译文文件，应将同一正文回归再对该文件跑一次。

### 原生隔离证据

任务卡已有隔离 `qingyan-overlap` 原生 WebView 结果附件：`02b-native-selection-through-mark.png`、`03-after-overlap-created.png`、`04-original-individually-selected.png`、`05-created-overlap-individually-selected.png`、`06-created-deleted-original-preserved.png` 和 `sqlite-evidence.json`。其中 SQLite 终态仅保留改色后的原标注。上述原生运行未接触正式资料库；本轮没有为了补测而启动第二个原生实例。

## 当前交付状态

- 本轮最终源码只涉及 `AnnotationMark.tsx` 与 `AnnotationOverlay.tsx`；本报告和两个状态文件也已纳入提交。功能提交为 `e2d6e499c458b1fdf1e93ba665ebee5915b02859`，已以非快进方式合并到本地 `main`，合并提交为 `5a76df27af2c2ac26a441f1f4f06b2f99e4ea3b1`。
- 交付前仍需在文档同步提交后复核 `main` 仍以 `498745a001e6ca9cdceaece60f91ea848bb8d7ed` 为祖先，并提交 `--delivery-json`。
