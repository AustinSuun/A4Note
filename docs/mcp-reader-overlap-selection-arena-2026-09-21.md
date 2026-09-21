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

## 跨行标注几何修复（第二轮反馈）

首轮交付后用户反馈：跨行情况下高亮和下划线不跟随文字结束、结束位置不整齐，且下划线线宽不一样。任务卡附件截图（`粘贴图片-1789988820835-0.png`）显示英文摘要第 1、2 行的下划线越过可见文字一直画到页面右缘，且各行线宽不一致。

### 根因

- `PdfReader.textSelectionDraft` 在横向页面曾采用浏览器 `range.getClientRects()` 的实时矩形。这些矩形跟随透明文字层的*替代字体*渲染结果，而非 PDF 位图字形：整行被选中时会越过已绘制文字，各行右端参差不齐，行盒高度也随替代字体度量变化。
- 下划线线宽由 `clamp(段高度 × 8%, 0.05, 0.42)` 逐段导出，段高度不齐时线宽随之不齐。

### 修改

1. `src/features/reader/pdf/PdfReader.tsx`
   - 只要存在文字层运行几何（`textSelectionRectsFromOffsets`，按字符偏移切分并裁掉首尾空白），任何方向页面一律优先使用；实时矩形仅在页面没有文字条目时兜底。端点跟随可见文字，同字号行高度一致。
2. `src/features/reader/pdf/pdfAnnotationHelpers.ts`
   - 新增 `underlineThicknessForSegments`：取同一条标注各段字形盒轴的*中位数*导出单一线宽，单个偏高的行盒不再产生更粗的线。
   - `underlinePositionStyle` 增加可选线宽参数；不传时保持逐段原行为（拖拽预览与回归脚本不受影响）。
3. `src/features/reader/pdf/AnnotationMark.tsx`
   - 渲染下划线时把标注级统一线宽传入每个分段。

### 回归

- `npm run test:reader-helpers`：通过，含新增断言（中位数线宽、override 后各段线宽一致、默认行为保留、空数组返回 undefined）。
- `npm run test:pdf-rotated-text`：142 断言通过（旋转方向仍沿字形轴裁切与画线）。
- `npm run test:pdf-crosspage-selection`：31 断言通过。
- `OVERLAP_ONLY=1 MODAL_PHASE=after node scripts/verify-pdf-text-annotation-browser.mjs`：9/9。
- 真实 PDF 正文回归各 20/20（原 14 项 + 新增 6 项跨行审计），`pageErrors=0`：
  - 同一条标注渲染出的各分段厚度一致（高亮带英文 5.375px、中文 7.547px；下划线英文 1px、中文 1.109px，最大差 ≤0.75px 断言通过）；
  - 末行右端 ≤ 文字结束 +3px，首行左端 ≥ 拖选起点 −3px；
  - 英文下划线中间行宽度由旧实时矩形的 64.42%（越过文字）收敛到 53.06%，与可见文字一致。
- 证据：`.tmp/pdf-real-evidence/{english,chinese}/after/` 截图与 `result.json`，合并 `real-body-evidence.json` 附卡。

### 线宽如何确定（对反馈的直接回答）

线宽仍由字形盒高度导出（8%，夹在页面百分比 [0.05, 0.42]），但现在取*同一条标注各段的中位数*并统一应用到每一行；此前线宽不一是因为段高度来自替代字体实时矩形、逐行变化。改用 PDF 运行几何 + 中位数线宽后，同一条标注内、同字号之间的线宽一致。
