# 阅读器：/Rotate 页面文字层与选区几何修复（任务卡 e8106251，审计 F1）

- 日期：2026-09-21；执行者：Arena（任务板 worker「Arena执行」）。
- 任务卡：`e8106251-7c9a-4453-b6d3-146a7f830f36`（high），来源审计 `docs/mcp-reader-annotation-audit-arena-2026-09-21.md` §6。
- 分支：`fix/reader-rotated-text-layer-arena`，基于 `main d7feb05`（工作树 `.worktrees/fix-rotate-arena`）。
- 提交：`2e357b8`（几何/文字层/选区/标记 + 回归脚本）、`bda54f6`（180/270 免 transform 布局 + 旋转选区取运行框几何）。
- 结论：四个方向（0/90/180/270）文字层 span 全部落在页面内并贴合位图字形；旋转页可原生选字、拖选，高亮/下划线记录写入 SQLite 且几何沿字形轴；水平页行为不变。

## 1. 根因

`src/features/reader/pdf/pdfGeometry.ts` 的 `extractTextItemBoxes` 用 `Util.transform(viewport.transform, item.transform)` 得到运行矩阵后，只取平移分量 `tx[4], tx[5]` 和 `|tx[3]|` 当作「左上角 + 高度」，再按 `item.width` 向右延伸。`getViewport` 已把页面 `/Rotate` 折进 `transform`，旋转页的运行方向向量是 `(tx[0], tx[1]) = (0, ±w)`，于是 span 仍按水平方向铺开：`/Rotate 90` 时从 x=740 向右伸到 929（页宽 792，越界）；`/Rotate 180` 从 562 伸到 751；`/Rotate 270` 位置整体错位。文字层、原生选区、`textSelectionFromDrag`、行分组、高亮/下划线样式全部建立在「运行沿 x 轴」的假设上。

同一探针（18pt Helvetica 一行，`.tmp/f1/probe-rotated.mjs`，只读）在修复前后的输出：

```text
BEFORE main@1694b28
rotate 0:   viewport 612x792 span px left=50    top=34  right=239.1 bottom=52    on-page
rotate 90:  viewport 792x612 span px left=740   top=32  right=929.1 bottom=50    OFF-PAGE
rotate 180: viewport 612x792 span px left=562   top=722 right=751.1 bottom=740   OFF-PAGE
rotate 270: viewport 792x612 span px left=52    top=544 right=241.1 bottom=562   on-page（位置错误）
AFTER fix/reader-rotated-text-layer-arena
rotate 0:   viewport 612x792 span px left=50    top=34    right=239.1 bottom=52    orientation=-   on-page
rotate 90:  viewport 792x612 span px left=740   top=50    right=758   bottom=239.1 orientation=90  on-page
rotate 180: viewport 612x792 span px left=372.9 top=740   right=562   bottom=758   orientation=180 on-page
rotate 270: viewport 792x612 span px left=34    top=372.9 right=52    bottom=562   orientation=270 on-page
```

## 2. 修改

| 文件 | 变化 |
| --- | --- |
| `src/features/reader/pdf/types.ts` | 新增 `TextOrientation = 0 \| 90 \| 180 \| 270`；`TextItemBox.orientation?`（水平运行不写该键，序列化不变）。 |
| `src/features/reader/pdf/pdfGeometry.ts` | `textOrientationFromTransform` 由 `atan2(tx[1], tx[0])` 量化方向；旋转运行由单位运行向量与上升向量走四角取轴对齐包围盒（`rotatedRunBounds`）；水平运行沿用原公式（逐字节相同）。 |
| `src/features/reader/pdf/PdfTextLayer.tsx` | 按 `orientation` 布局：90 → `writing-mode: vertical-rl; text-orientation: sideways`；270 → `writing-mode: sideways-lr`（不支持时回退 vertical-rl + rotate(180deg)）；180 → `direction: rtl; unicode-bidi: bidi-override`（字符顺序反转即可，文字透明；Chromium 不能在 rotate(180deg) 的行内盒上扩展拖动选区，实测只选中 1 个字符，故不用 transform）；输出 `data-text-orientation`。 |
| `src/features/reader/pdf/pdfSelection.ts` | `READING_AXES` 表定义四个方向的行坐标/阅读顺序/运行顺序；`groupTextItemsIntoLines` 按方向分别分行；`textSelectionFromDrag` 的行段带 `orientation`，`lineSelectionScore` 对竖排交换跨行/沿行覆盖率；`sliceTextItemBox` 沿阅读方向切片（90 从上、270 从下、180 从右）；`mergeRectsIntoLineSegments(rects, orientation)` 竖排走列合并；新增 `textItemOrientation`、`isVerticalTextOrientation`、`dominantTextOrientation`、`withSegmentOrientation`、`textItemsSeparated`。既有导出与调用形状不变。 |
| `src/features/reader/pdf/PdfReader.tsx` | `finishTextSelection`：按选中项求主方向；旋转页取「运行框按偏移切片」的精确矩形（与拖选路径同源，浏览器竖排行盒比字形宽 4px/侧），水平页仍用实时 `getClientRects`；段落写入 `orientation`。 |
| `src/features/reader/pdf/pdfAnnotationHelpers.ts` | `highlightPositionStyle` / `underlinePositionStyle` 读取段落 `orientation`：90/270 沿 x 裁上升/下降边、下划线放在下降边（90 左、270 右）；180 上升边在下、下划线放在顶部下降带；比例沿用 main d7feb05 的水平模型（28%/18% 内缩、8% 线宽、20% 下降）。 |
| `src/features/reader/pdf/AnnotationMark.tsx` + `src/ui/styles/reader.css` | 竖排下划线加 `vertical-rule`：不做 `translateY(-100%)`，`width: 2px`，高度保留段落全长。 |
| `src/features/reader/pdf/pdfSearch.ts` | 页面文本拼接改用 `textItemsSeparated`，旋转页跨行/跨列同样补空格。 |
| `scripts/verify-pdf-rotated-text-layer.mjs`（新） | 见 §3；`package.json` 新增 `test:pdf-rotated-text`，`scripts/verify-all.mjs` 接入。 |
| `scripts/verify-reader-rendering.mjs`、`scripts/verify-pdf-highlight.mjs` | main d7feb05 合入高亮带/色板变量后未同步的过期断言（原公式、`repeat(10, 16px)`、`y:20.08/height:2`）改为当前实现；这两项在 main 上本已失败，与本任务无关但阻塞 `npm run verify`。 |

## 3. 回归测试

`npm run test:pdf-rotated-text`（`scripts/verify-pdf-rotated-text-layer.mjs`，142 断言）：用真实 pdf.js 构造 `/Rotate 0/90/180/270` 的 PDF（18pt Helvetica，1 行与 3 行两种），以 `PdfReader` 同样的 `getViewport({scale:1})` + `extractTextItemBoxes` 取框，再用 `@napi-rs/canvas` 渲染位图取字形墨迹包围盒：

- 每个方向：viewport 尺寸随 /Rotate 交换；span 在页内；墨迹像素全部落在 span 内（2.5px 抗锯齿余量），span 超出墨迹不超过半个字高；`orientation` 正确、水平运行无该键；
- 三行：`groupTextItemsIntoLines` 保持阅读顺序；沿第一行拖选只得该行、跨三行拖选按阅读顺序拼 quote、段落数=3；高亮带落在运行框内并沿字形轴裁边；下划线在对应下降带；按偏移切片（前 7 字）位置/长度正确；`dominantTextOrientation`；搜索跨行补空格命中；
- 纯函数：列合并、`withSegmentOrientation`、方向量化、四方向高亮/下划线样式常量、水平样式与 main 一致；文字层源码含 vertical-rl / sideways-lr / rtl bidi-override。
- `ROTATED_TEXT_LAYER_EVIDENCE_DIR=<dir>` 时输出带框图（`rotate-<n>-single-run.png`、`rotate-<n>-marks.png`）。

在 `main@1694b28` 上运行同一脚本失败（缺少 `dominantTextOrientation` 等导出，旋转 span 越界），在本分支通过。

## 4. 隔离实例验收（真实窗口 + SQLite）

- 构建：`.tmp/f1/build-f1.mjs` 以分支工作树静态 debug 构建（`tauri build --debug --no-bundle`，身份 `app.aster.research.dev.arena-f1.w3a587fb6d3`，复用 `.build/live-dev/qingcheng-review-c9f3/target` 缓存）。
- 驱动：`.tmp/f1/f1-rotated-driver.mjs`（与审计 4de2cac5 驱动同构：独立 HOME/AppData/WebView2 profile、`checkDevAdmission` 登记身份、CDP 9313 真实鼠标事件、`node:sqlite` 只读核对）。每次运行清空 `.tmp/f1/home` 与 profile，只导入合成 PDF `RotatedTextLayer.pdf`（p1 /Rotate 0、p2 90、p3 180、p4 270），放在 `.a4-tests/acceptance/e8106251-…/<runId>/`。不触碰正式资料库。
- 结果：63 项检查全部通过（`.tmp/f1/evidence/summary.json`、`driver.log`、截图 `00`–`05` 共 16 张）：
  - 几何：四页 span 全部在页面框内；竖排页 span `h > 3w`，横排页 `w > 3h`；`data-text-orientation` 与 writing-mode（90 vertical-rl、270 sideways-lr、180 horizontal-tb + rtl）正确；span 并集与页面 canvas 墨迹包围盒误差 ≤ 0.6 字高（例：p2 spans x=684 w=74 vs 墨迹 x=684 w=69.3）。
  - 原生选区：「鼠标」工具沿 p2/p3/p4 的旋转运行拖动，`getSelection()` 得到 `Rotated searchable line`。
  - 高亮/下划线：四页各创建 1 条 `highlight` + 1 条 `underline` 记录，quote 正确、`page` 正确；旋转页段落 `orientation` = 90/180/270、坐标在 0..100；存储段落与 span IoU 0.74–0.97；DOM 高亮带落在 span 内；下划线为细条并位于对应下降带（p2 x=1107 在 span 左缘 1106 内侧；p4 x=471 在右缘 474 内侧；p3 y=407 在顶缘 404 内侧；p1 在底部）。
  - 缩放两级后同一记录仍贴合 span；`Page.reload` 后重新打开，p2 高亮仍贴合。
  - 隔离校验：`get_aster_paths` 根目录位于隔离身份之下，非 `app.aster.research`。
- 上传到任务卡的结果附件：`03-p2-rot90-marks.png`、`03-p3-rot180-marks.png`、`03-p4-rot270-marks.png`、`04-p2-rot90-zoomed.png`、`summary.json`。

## 5. 验证命令

- `npm run test:pdf-rotated-text`：142 断言通过。
- `node scripts/verify-reader-rendering.mjs`、`node scripts/verify-architecture-boundaries.mjs`、`npm run test:reader-helpers`、`node --experimental-strip-types scripts/verify-pdf-highlight.mjs`（42）、`node scripts/verify-reader-priority-fixes.mjs`（60）：通过。
- `npx tsc -b` 与 `npm run build`：通过。
- `npm run verify`：见 §7 记录。
- `npm run test:agent-status`：通过。

## 6. 环境事件与注意

- 14:54–14:58 期间 `.worktrees/` 整个目录被另一会话清空（main 由 1694b28 前进到 d7feb05，reflog 显示 `reset`/`clean`），本任务首个工作树及其未提交修改随之丢失；已在新 main 上重建工作树并按本地补丁重放，之后每一步都及时提交。请其他 Agent 勿对仓库根执行 `git clean -fd` 之类会波及 `.worktrees/` 的操作。
- ShunCode 内置 git 的系统配置 `core.autocrlf=true`，工作树文件为 CRLF，提交内容仍为 LF（`git ls-files --eol` 全部 `i/lf`）。
- 浏览器竖排行盒比字形宽（每侧约 4px），因此旋转页的选区几何改取运行框切片；水平页保持实时矩形不变。
- `writing-mode: sideways-lr` 需 Chromium 132+；当前 WebView2 已支持（实测 `getComputedStyle` 为 sideways-lr）。不支持时回退 vertical-rl + rotate(180deg)，仍可点选，但拖动扩展选区可能不稳。

## 7. 交付

- 任务卡进度/提交见任务板事件；交付 JSON 随 `submit` 提交。
- 合并：按手册合入本地 main（仅 fast-forward/merge，不改写他人分支），合并结果记录于状态文件。
