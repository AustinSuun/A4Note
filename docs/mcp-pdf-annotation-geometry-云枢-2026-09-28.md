# PDF 高亮 / 下划线几何偏移修复（任务 6d59b629，云枢，2026-09-28）

## 结论

用户反馈的"高亮条整体偏右偏下、下划线 / 标注图标悬在行中间、≥118% 与多行时更严重"由三处几何转换缺陷叠加造成，全部在几何层修正，未引入任何经验补偿值（fudge offset）：

| # | 根因（函数 / 转换） | 现象 | 修复 |
| --- | --- | --- | --- |
| RC1 | `PdfReader.tsx` 的 SelectionPopup 定位：`event.clientX/Y − containerRef.getBoundingClientRect() + scrollLeft/Top`，把**视口客户端像素**当作 `.pdf-document-content`（含 7px padding）里的**布局像素**写进 `left/top` | UI 缩放 118% 下弹窗偏移 +94 / +74 px（`(zoom−1)×到滚动容器原点的距离`），100% 下也恒偏 (6.7, 7) px（容器 padding）——即截图里"悬在行中间的下划线 / 标注图标" | 新增 `pdfSelectionPopup.ts::selectionPopupAnchor`：弹窗锚点用**页面百分比**表示，渲染进该页 `.pdf-render-layer`，与选区预览带、落盘标注共用 `textSelectionGeometry` 同一份 segments。悬在选区首行上方 10px、水平跟随指针（页面顶部放不下时挂末行下方，页边 40px 内夹紧） |
| RC2 | `PdfTextLayer.tsx` 文本层 span 继承 UI 字体栈（CJK 无衬线 + `font-kerning:auto`）；`pdfTextLayerFit` 的 `--pdf-run-scale` 只能校正整段 run 的总宽度，段内每个字形的 advance 仍是替代字体的 | 段中部单词的 Range rect / 光标 / 高亮条边缘相对位图字形漂移，Times 正文第 9 字符处约 0.3em（200% 时 6.9px）；随缩放线性放大 | `extractTextItemBoxes` 读取 pdf.js `textContent.styles[fontName].fontFamily`（只接受 serif / sans-serif / monospace）写入 `TextItemBox.fontFamily`，span 输出 `data-text-font`，`reader.css` 为三类分别指定 Times / Arial / Courier 度量兼容的替代字体栈（先具名再泛型：`lang=zh-CN` 下裸 `serif` 会落到宋体半角拉丁），并关闭 `font-kerning` / `font-variant-ligatures`，保证一字一形与 pdf.js 绘制方式一致 |
| RC3 | `pdfSelection.ts::mergeRectsIntoLineSegments` 用固定 `1.2%` 页高判断同一行 | A4 上 9pt 字 10pt 行距的行距 = 10/841.89 = 1.188% < 1.2%，相邻两行被并成一个 segment，高亮条跨越行间距、且从上一行首延到下一行尾 | 容差改为相对行高：`0.5 × max(prev.height, rect.height)`（竖排同理用宽度），行内 run 间隙容差 1.2% 不变 |

高亮带 `[baseline − 0.9em, baseline + 0.2em]` 与下划线 `baseline + clamp(0.04h)` 的度量常数保持不变：浏览器测试里修复后的高亮带顶边落在该行 ascender 边（例如 9pt 双行场景第 1 条带顶边 601.27px = 行框顶边），之前观察到的"整体偏下"实际来自 RC1 的弹窗/图标错位与 RC3 的跨行合并，而不是带高本身。`annotationPositionOptimism`、`pdfCoordinates.ts`、颜色、粗细、交互均未改动。

## 复现与证据

- 最小复现：`scripts/verify-pdf-annotation-geometry-browser.mjs` 构造 A4 Times-Roman 文档（11pt 正文 30 行 + 9pt/10pt 行距脚注块 6 行），真实 `PdfReader` + 真实鼠标拖拽：
  - 旧代码：弹窗底边距行顶 `+2.5px`（100%）/ `+70px`（UI 118%）而非 `−10px`；"Small 02→03" 两行选区只生成 1 个 segment、1 条跨行高亮；`Line 12: curved` 字形框与位图字形相差 0.31em。
  - 新代码：见下表。
- 诊断记录（修复前）：`.tmp/annot-geometry-diag/diag/diag.log`（工作树内，未提交）。

## 变更文件

- `src/features/reader/pdf/pdfSelectionPopup.ts`（新增）：`selectionPopupAnchor`、`SELECTION_POPUP_CLEARANCE_PX`、`SELECTION_POPUP_HALF_WIDTH_PX`。
- `src/features/reader/pdf/SelectionPopup.tsx`：改为 `{ anchor, onHighlight, onUnderline }`，`left/top` 为页面百分比，`data-placement`，阻止 mousedown/pointerdown/click 冒泡以免清空选区。
- `src/features/reader/pdf/PdfReader.tsx`：`textSelectionGeometry(pageElement, range)` 从 `textSelectionDraft` 抽出，供预览 / 弹窗 / 落盘共用；`handleMouseUp` 以 `selection.focusNode` 所在页为准；弹窗渲染进对应页的 `annotationLayer`。rebase 到 main a7d2023（arena-two 的 ae61143f）时，main 用 `pointerToElementLayout` 把弹窗指针坐标换算为容器布局坐标的挂载块被本方案取代（弹窗不再依赖指针坐标与滚动容器），`pointerToCommentOffset` 仍沿用 `pointerToElementLayout`。
- `src/features/reader/pdf/pdfGeometry.ts`：`textFontFamily()`，`extractTextItemBoxes` 写入 `fontFamily`。
- `src/features/reader/pdf/types.ts`：`TextFontFamily`、`TextItemBox.fontFamily?`。
- `src/features/reader/pdf/PdfTextLayer.tsx`：span `data-text-font`。
- `src/features/reader/pdf/pdfSelection.ts`：相对行高容差。
- `src/ui/styles/reader.css`：文本层字体栈 / kerning；`.selection-popup` 改为页面内绝对定位 + `translate(-50%, calc(-100% - 10px))`，`.below` 变体。
- 测试：`scripts/verify-pdf-annotation-geometry.mjs`（`test:pdf-annotation-geometry`）、`scripts/verify-pdf-annotation-geometry-browser.mjs`（`test:pdf-annotation-geometry-browser`），已加入 `scripts/verify-all.mjs`。
- 文档：本文件；`docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json`。

`pdfCoordinates.ts` 契约未改动（仅新增调用 `pdfPointerCoordinates` 读取 `layoutWidth/layoutHeight`）。与 review 任务 7e18e7d8 / f241fd40 无文件交集。

## 验证

工作树 `.worktrees/pdf-annot-geometry-yunshu`，分支 `fix/pdf-annotation-geometry-yunshu`（开发基线 b159a6a，先后 rebase 到 main a7d2023、a4f6a19 后复跑）。

### 自动化

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 错误（a7d2023 与 a4f6a19 基线各跑一次） |
| `npm run build` | 通过 |
| `npm run test:pdf-annotation-geometry`（新增 Node 单测） | 100 项通过；切回旧代码在 `TextItemBox.fontFamily` 断言处失败 |
| `npm run test:pdf-annotation-geometry-browser`（新增，headless Chrome + 真实 `PdfReader`，zh-CN，1400×1000） | 新代码 159/159；旧代码 102/156（失败项 = 字形漂移、跨缩放落盘百分比漂移、弹窗位置、9pt 双行合并） |
| `test:reader`、`test:reader-helpers`、`test:pdfjs`、`test:architecture`、`test:core`、`test:viewport-to-layout` | 通过 |
| `test:pdf-text-layer-offset` / `-browser` | 55 / 113 通过 |
| `test:pdf-selection-preview` | 38 + 28 通过 |
| `test:pdf-crosspage-selection` 31、`test:pdf-rotated-text` 151、`test:pdf-text-annotation` 33 | 通过（跨页 / 竖排 / 文本批注无回归） |
| `test:pdf-eraser-precision` 26、`test:pdf-eraser-alignment` 217 + 24、`test:annotation-layers` 55、`test:pdf-find-entry` 35 | 通过（橡皮擦 / 墨迹 / 形状 / 搜索无回归） |
| rebase 到 main a4f6a19（arena-b 的 6f9e0947）后复跑 | tsc 0；`npm run build` 通过；`test:architecture`、`test:pdf-annotation-geometry` 100、`test:pdf-annotation-geometry-browser` 159/159、`test:sidebar-visibility` 8 + browser 39、`test:reader` 通过（无冲突合并） |
| `npm run verify`（a7d2023 基线，完整跑完含 `cargo test` 247 passed） | 除两步外全绿：`test:ui-state`（main 既有失败，卡片允许例外）；`test:summary-fields` 中 `verify-summary-direct-edit-browser.mjs` 的焦点断言"clicking another card moves editing there and closes the previous editor"随机失败——同一脚本在未改动的 main a4f6a19 工作树连续两次同样失败、在本工作树单独运行时通过，属既有不稳定用例，与本卡文件无交集，未修 |

`test:core` 在开发基线 b159a6a 上因 doc2x.core 重复注册失败（main 已由 3866352 修复），rebase 后通过。

### 浏览器测试关键数值（新 vs 旧）

- 字形对位（`Line 12: curved`，选区 Range rect 与位图字形边缘之差）：新 0.68–1.04px（0.03–0.05em）@ PDF 118 / 150 / 200%、UI 缩放 118 / 125%、DPR 1.25 / 1.5；旧 4.32–7.5px（0.26–0.36em）。例 200%：字形框 [292.13→352] vs 位图 [292.81→351.5]（旧 [286.22→348.7]）。run 拟合缩放 `--pdf-run-scale` 由 0.8858 变为不再需要（null），span `data-text-font="serif"`。
- 落盘 PositionJson（页面百分比）跨缩放漂移：新 ≤0.01%；旧 0.11–0.24%。
- 弹窗：新代码 100% 下 `[490–560, 279.88→315.88]`，底边 = 选区首行顶 − 10px，中心 = mouseup x；UI 118% 底边 372.73 vs 期望 372.74。旧代码弹窗不在页面层内，底边偏 12–110px、中心偏 7–100px。
- 9pt / 10pt 行距双行选区：新 2 个 segment / 2 条带（第 1 条顶边 601.27 = 该行 ascender 边）；旧 1 条合并带。
- 旧数据兼容：单矩形 PositionJson（Line 16 @150%）绘制位置不变。
- 每个场景 `pageerror` / `console.error` = 0。

### 截图

- 修复前 / 后（浏览器测试自动截图）：`.tmp/pdf-annotation-geometry/before/`、`.tmp/pdf-annotation-geometry/after/`（100 / 118 / 150 / 200%、UI 118 / 125%、DPR 1.25 / 1.5 的高亮、下划线、弹窗、双行场景，附 `result.json`）。
- dev:live 隔离实例（`npm run dev:live -- --instance yunshu --port 1471 --cdp-port 9371`，实例代号只允许小写 ASCII 故用 `yunshu`；identifier `app.aster.research.dev.yunshu.w8721bd59f3`，独立测试库，窗口 1280×820、DPR 1.25；原生编译复用本工作树 `src-tauri/target` 的 junction，30s 起动）：脚本 `.tmp/arena-yunshu/live-evidence.mjs` 经 CDP 9371 用 IPC `import_pdf_to_library` 把合成 Times-Roman 文档导入隔离库，在文献库列表双击打开，真实鼠标拖拽选中 `Line 12 / 22: curved`（高亮）与 `Line 14 / 24: curved`（下划线），点击选区弹窗按钮落盘；截图、`live.log`、`result.json` 在 `.tmp/shots/pdf-annotation-geometry-live/after/` 与 `.../before/`（`z120-*`、`z150-*`）。改前取证 = 同一实例上临时 `git checkout main --` 检出 a4f6a19 的 7 个前端文件（Vite HMR 热更新）后重跑，随后 `git checkout HEAD --` 恢复，工作树无残留。
  - 改后（PDF 120% / 150%）：弹窗渲染在页面层内，底边 = 选区首行顶 − 10px（306.86 vs 306.87；371.93 vs 371.93），水平中心 = mouseup x；高亮带左右边 = 字形框（Δ ≤ 0.01px），顶 / 底 = baseline − 0.9em / + 0.2em（Δ 0）；下划线位于基线下 0.52px（120%）/ 0.66px（150%）= 0.04em；文本层 span `data-text-font="serif"`、`font-kerning: none`；console / pageerror = 0。
  - 改前（同一 4 个场景，console / pageerror 同样为 0）：弹窗不在页面层内（`inPage=false`），锚在指针位置——底边落在行顶之下 4.1px（120%）/ 4.9px（150%），压住被选文字，而非行顶上方 10px（即用户截图里"悬在行中间"的图标）；文本层字形框相对改后（改后与位图差 ≤ 0.05em）左移 2.8px = 0.21em（120%）、5.2px = 0.31em（150%），高亮带 / 下划线随字形框一起左偏；带的垂直度量与改后完全一致，证明偏差不在带高常数。
  - dev:live 未覆盖、由浏览器测试覆盖的项：界面缩放 118% / 125%、DPR 1.5、9pt 双行合并、旧单矩形数据；PDF 118% 以工具栏步进的 120% 代替（弹窗按钮步长 0.1）。
  - 取证过程中发现（与本卡无关，未改）：阅读器已打开一篇 PDF 时，从文献库列表再打开另一篇不会切换舞台上的文档，需先「关闭」；文献库列表行的双击在 CDP `clickCount=2` 下不触发 `dblclick`（脚本改为派发 DOM 事件）。

## 设计取舍与已知风险

- **未采用 pdf.js `styles[].ascent/descent` 决定高亮带高度**：pdf.js 对 TrueType 取 `/Ascent`（≈0.891 行度量）、对 Type1 取字形 ascender（≈0.683），同一文档混排时带高会跳变，pdf.js v6 自身的文本层也不再依赖这两个值；保留基于基线的 0.9em / 0.2em 常数带。
- 替代字体度量只能逼近，不能等同嵌入字体；对非 Times/Arial/Courier 度量的字体（如 Computer Modern、Minion）段内仍可能有 ≤0.1em 级漂移，整段总宽仍由 `--pdf-run-scale` 校正。
- 系统未安装 Times New Roman / Arial / Courier New 时回退到泛型族（Windows 默认安装齐全）。
- 弹窗改为页内定位后会随页面滚动（原先固定在滚动容器坐标中，效果一致），页面顶部 56px 内的选区弹窗挂在末行下方。
