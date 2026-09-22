# PDF 阅读器：高缩放与侧栏布局下鼠标位置与标注预览/选中效果向左偏移

- 日期：2026-09-22
- 执行者：arena-two（agent `934fe669-708f-4b2b-85eb-4142ebbbc5b1`）
- 任务：`9222954f-ed8e-4057-a7bf-35dc604b8323`（high，claimed_spec revision 2）
- 分支：`fix/reader-text-layer-hit-offset-arena-two`（worktree `.worktrees/text-layer-offset-arena-two`，基线 main `29341cc`）
- 交付 commit：`2aba6ba`（fix）→ 合并 main `4c918db`（含 `fa49614` 标注拖动反馈、`fd35859` 快捷键提示）得 `4d50ded` → 文档/状态提交 → 合入本地 main（commit 见任务交付 JSON）

## 问题与根因

参考图：370% 缩放 + 左侧「正在阅读」列表展开时，下划线/高亮的落点整体在鼠标左侧，且越靠行尾偏得越多；同一标注的选中/命中区也跟着偏。

只读定位后确认 **不是**容器偏移或侧栏宽度没有被扣除：`pointFromEvent`/`normalizeClientRect` 一直是相对 `.pdf-render-layer` 的百分比，起点误差本来就很小。真正的根因是文本层与 PDF run 盒之间的 **字形宽度不一致**：

1. `PdfTextLayer` 用 `%` 宽度的透明 `<span>` 承载每个 pdf.js run，但字体是系统替代字体（Times-Roman → 本机 serif），其自然 advance 只有 PDF run 宽度的 0.86–0.89×（部分字体 >1.1×）。字符落在文本层里的真实位置 ≠ 按 PDF run 宽度线性等分的位置。
2. `textSelectionRectsFromOffsets` / `sliceTextItemBox` 把 caret 字符偏移**线性**映射到 PDF run 盒：`left = box.left + box.width × start/len`。于是误差 = (1 − scale) × 字符序号 × 字宽 × 缩放，与缩放和字符序号成正比：100% 行尾 −33 px，150% −57 px，370% −120 ~ −126 px；配合侧栏展开导致的横向滚动，在真实窗口里整条标注甚至会被推出可视区（浏览器回归里量到 −464 px）。
3. 预览、最终标注、命中区三者都从同一条错误矩形派生，所以「三者一致但都偏」——这正是参考图里看到的现象。

## 修复（统一坐标管线，无按工具/按 370% 的硬编码）

- `src/features/reader/pdf/pdfTextLayerFit.ts`（新增）：`fitTextRunsToPdfBoxes` 按 pdf.js 的做法，在 `useLayoutEffect` 中用 Range 量出每个 run 的自然宽度，并以 CSS 变量 `--pdf-run-scale` 把 span 沿主轴（0°/180° `scaleX`，90°/270° `scaleY`，`transform-origin: 0 0`）拟合到 PDF run 盒；重测前先移除旧 scale 避免叠乘，缩放系数夹在 0.1–10，`fonts.ready` 与 `ResizeObserver` 触发复测，层无尺寸时跳过。
- `src/features/reader/pdf/PdfTextLayer.tsx`：span 改为 `max-content` 宽度 + 上述拟合；保留 `data-text-index`、`fontSize: Math.max(item.fontSize * zoom, 6)`、`selectable` 类等既有契约。
- `src/features/reader/pdf/pdfSelection.ts`：新增 `textSelectionRectsFromLayer(items, selections, layerRect, measurer)` 与 `textRunExtentMeasurer(layer)`：从**真实字形 Range** 取起止 x（夹回 run 盒、剔除首尾空白），纵向沿用 pdf.js 盒；measurer 为空或层矩形为空时回退旧的比例切片（`textSelectionRectsFromOffsets` 保留导出，跨页/旋转逻辑不变）。
- `src/features/reader/pdf/PdfReader.tsx`：preciseRects（拖选预览、最终 highlight/underline、重选命中）统一改走 `textSelectionRectsFromLayer`；自由笔/图形/箭头本来就用 layer 百分比，未改动、也不需要补偿项。
- `src/ui/styles/reader.css`：`.pdf-text-layer span` 使用 `--pdf-run-scale` 的 transform；90/270 分支同理。

## 验证结果

- `npx tsc --noEmit`：0 错误；`npm run build`：通过（合并 main 后复跑）。
- 新增 `npm run test:pdf-text-layer-offset`（`scripts/verify-pdf-text-layer-offset.mjs`，55 断言）：client→PDF→render 往返在「容器偏移 + 侧栏宽度 + 370%」下起止 ≤1.5 px、误差不随缩放/侧栏累积、拟合系数不叠乘、源码契约（无 `zoom === 3.7`/`sidebarWidth` 之类补偿）。**在旧代码上失败**（缺少拟合模块 & 行尾漂移 19 px > 阈值）。
- 新增 `npm run test:pdf-text-layer-offset-browser`（隔离 headless Chrome + 真实组件/CSS，含 pageerror/console 采集）：修复后 **113/113**，旧代码 **48/106**（100% 行尾 −30、150% −52、370% −131、370%+侧栏 −464 px）；覆盖 100/150/370% × 侧栏开合 × 两页、resize、跨缩放重开、自由笔/图形/箭头往返。
- 既有回归：`test:reader`、`test:pdf-selection-preview`（37）、`test:pdf-rotated-text`（151）、`test:pdf-crosspage-selection`（31）、`test:reader-helpers`、`test:annotation-layers`（55）、`test:ui-state`、`test:architecture` 全部通过；两个新步骤已加入 `scripts/verify-all.mjs`。
- `npm run verify`：首轮（合并 main 前）仅两处失败且均与本卡无关——`test:ui-state` 是 main 侧 `bd77244` 已更新的色板断言，`test:project-tasks` 的「real CLI and MCP stdio clients」一项是本机 4319 看板服务身份的环境性失败（未重启 4319）。合并 main `4c918db` 得 `4d50ded` 后全量复跑：**「A4Note verification passed」，退出码 0**（55 步全过，Rust 215/0/5 ignored）；`test:pdf-text-layer-offset-browser` 合并后复跑 113/113。

## 隔离原生窗口证据（Windows / Tauri / WebView2，真实鼠标事件）

用 `.tmp/native/build-native.mjs` 以 `liveDevPlan({instance:'arena-two', port 1497, cdpPort 9327})` 的独立身份 `app.aster.research.dev.arena-two.w15eca3720d` 打了两份 `tauri build --debug --no-bundle` 二进制（前端 `vite build` 分别取自修复前/后源码，`--config` 指向独立 identifier，`bundle.active=false`），`.tmp/native/offset-driver.mjs` 用独立 HOME/AppData/WebView2 profile + `checkDevAdmission` 启动，经 CDP `Input.dispatchMouseEvent` 真实拖拽；仅导入驱动器自建的合成 PDF（`.a4-tests/acceptance/9222954f-…/<runId>/TextLayerOffset.pdf`），未触碰正式资料库；状态条全程为「DEV arena-two · 独立测试库（原生已核验 …）」。窗口 1280×1025 CSS px、DPR 1。

同一布局（370%、阅读列表展开、`.pdf-document` 左缘 328 px、横向滚动 ≈200 px、同一行 Line 12 从第 9 个字符拖到可视区最后一个字符）下：

| 场景 | 修复前 起点Δ / 终点Δ (px) | 修复后 起点Δ / 终点Δ (px) |
| --- | --- | --- |
| 370% + 侧栏展开 · 下划线（p1） | −8.4 / **−120.5**，终点命中落空 | −0.01 / −0.02，起止均命中 |
| 370% + 侧栏展开 · 高亮（p1） | −8.4 / −120.5 | −0.01 / −0.02 |
| 370% + 侧栏展开 · 下划线（p2，连续页滚动 3171 px） | −8.4 / −120.5 | −0.01 / −0.02 |
| 370% + 侧栏收起 · 下划线 | −8.4 / −125.8 | −0.01 / −0.01 |
| 100% + 侧栏收起 · 下划线 | −2.9 / −33.4 | −0.01 / −0.01 |
| 150% + 侧栏展开 · 高亮 | −4.0 / −56.8 | −0.01 / −0.01 |
| 370% + 侧栏 · 自由笔 / 图形 / 箭头 | 笔/图形 ≤0.7 px；箭头未落库（旧代码在该场景创建失败） | 三者 ≤0.7 px，箭头/笔端点持久化往返 ≤0.5 px |
| 窗口缩至 1180×820 后 | 首条下划线仍偏 −8.4/−120.5 | 与字形对齐 ≤0.02 |
| Page.reload 重开、370% 重置 | 仍偏 | 行数不变（9 条），几何与字形对齐 |

汇总：修复前 **33 通过 / 28 失败**，修复后 **62 通过 / 0 失败**；两轮 pageerror / console.error 均为 0。
证据目录：`.tmp/native/evidence/{before,after}/`（`summary.json` 含每个场景的指针/预览/最终标注/命中/SQLite 行；`driver.log`；截图 `z370-sidebar-underline-{dragging,created}.png`、`z370-sidebar-highlight-*.png`、`z370-sidebar-p2-underline-*.png`、`z370-collapsed-underline-*.png`、`z100-*`、`z150-*`、`z370-sidebar-{ink,rect,arrow}.png`、`z370-sidebar-resized.png`、`z370-after-reload.png`；`app.log`）。

## 影响文件

- `src/features/reader/pdf/pdfTextLayerFit.ts`（新增）
- `src/features/reader/pdf/PdfTextLayer.tsx`
- `src/features/reader/pdf/pdfSelection.ts`
- `src/features/reader/pdf/PdfReader.tsx`
- `src/ui/styles/reader.css`
- `scripts/verify-pdf-text-layer-offset.mjs`、`scripts/verify-pdf-text-layer-offset-browser.mjs`（新增）
- `scripts/verify-all.mjs`、`scripts/verify-reader-rendering.mjs`、`package.json`（脚本别名）

## 遗留 / 说明

- 字形拟合依赖浏览器测量，首帧（字体未就绪）时以 pdf.js 盒为准，`fonts.ready` 后自动复测；不会改变已持久化数据格式。
- `.tmp/`、`.a4-tests/` 证据目录与 `src-tauri/resources/native-host/`（为本地 tauri build 从主工作区复制，git 忽略）均不入库。
- 未安装、未打包、未发布，未重启 4319，未写入正式资料库。
