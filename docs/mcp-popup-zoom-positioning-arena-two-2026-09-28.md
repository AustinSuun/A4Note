# 弹层 / 拖拽预览在界面缩放下跟随鼠标（任务 ae61143f）

- 任务：`ae61143f-7da5-4888-bf5f-62a7c5808e4a`（笔记树右键菜单在 118% / 150% 界面缩放下偏离鼠标，越靠下偏得越多）
- 分支：`ctx-pos-arena-two`（worktree `.worktrees/ctx-pos-arena-two`，基线 `main b159a6a`）
- 日期：2026-09-28

## 1. 根因

`src/ui/App.tsx:637-641` 用 `document.documentElement.style.zoom` 实现界面缩放。WebView2 使用标准化 CSS zoom
（Chromium ≥ 128），此时页面里同时存在两套坐标：

| 坐标空间 | 来源 | 单位 |
| --- | --- | --- |
| 视口空间 | `MouseEvent.clientX/Y`、`window.innerWidth/Height`、`getBoundingClientRect()` | 真实视口 CSS px |
| 布局空间 | 根节点以下任何元素的 `left/top/width/height`，**包括 `position: fixed` 的弹层** | 缩放前 px，`layout = viewport / zoom` |

旧代码把 `clientX/Y` 直接写进 `position: fixed` 弹层的 `left/top`，屏幕上实际落在 `clientX * zoom`，误差
`(zoom - 1) * client`，因此越靠下 / 越靠右偏得越多；`Math.min(clientY, innerHeight - 225)` 这类硬编码钳位又
使用了视口尺寸和估算的菜单高度，100% 下也会在底部被裁掉（原生实测 100% 底部：菜单底边 838 > 视口 820）。

## 2. 共享工具

### `src/shared/ui/viewportToLayout.ts`（纯函数，无 React 依赖）

| 函数 | 作用 |
| --- | --- |
| `parseZoomValue(raw)` / `readRootZoom(root?)` | 读取根 zoom：优先 `rect.width / offsetWidth` 实测，其次 computed `zoom`，再回退 `--ui-zoom`；均缺省则 1 |
| `viewportPointToLayout(point, zoom?)` / `viewportLengthToLayout` / `viewportDeltaToLayout` | 视口 → 布局的点 / 长度 / 增量换算 |
| `layoutViewportSize(zoom?, view?)` | 以布局 px 表示的可视区尺寸（`innerWidth / zoom` …） |
| `rectToLayout(rect, zoom?)` / `pointerToElementLayout(point, element, zoom?)` | 把 `getBoundingClientRect` 结果、指针相对元素的位置换算为布局 px |
| `measureLayoutSize(element)` | 用 `offsetWidth/Height` 取弹层的布局尺寸（不受 zoom 影响） |
| `clampPopoverPosition(anchor, size, viewport, options)` | 以**实测尺寸**做钳位 / 翻转：右侧 / 下方放不下时先镜像到左 / 上（`flipX/flipY` 可关），仍放不下则贴边（`margin` 默认 4），永不越界；返回 `{ left, top, flippedX, flippedY }` |
| `placePopoverAtPointer(point, size, options, zoom?)` | 上两者的组合：视口指针 → 布局锚点 → 钳位 |

`options.offset` 支持给锚点加偏移（拖拽预览用 `{ x: 14, y: 14 }`），偏移量在布局空间内，屏幕上随 zoom 等比放大。

### `src/shared/ui/usePointerAnchoredPosition.ts`（React hook）

`usePointerAnchoredPosition(anchor | null, options)` 返回 `{ ref, style, placement, size }`：把 `ref` 挂到弹层根节点，
hook 用 `useLayoutEffect` + `ResizeObserver` 实测弹层尺寸并在绘制前写回位置（首帧先放在锚点处并 `visibility` 隐藏，
避免闪跳），窗口 `resize` 时重算；`data-flipped-x/y` 由调用方按 `placement` 输出，便于测试与样式。

## 3. 接入清单（逐文件：受影响 / 已修 / 不受影响）

| 文件 | 弹层 / 交互 | 结论 |
| --- | --- | --- |
| `src/features/explorer/FileTreePanel.tsx` | 文件树右键菜单（行 + 空白区域根菜单） | **受影响 → 已修**。菜单 `anchor` 保存视口坐标，`usePointerAnchoredPosition` 换算 + 实测钳位 / 翻转；菜单左上角贴鼠标，底部 / 右侧空间不足时翻到上 / 左并贴边；菜单内容、键盘、外点关闭、拖拽语义未改 |
| `src/features/explorer/FileTreePanel.tsx` | 拖拽预览（`.file-tree-drag-preview`） | **受影响 → 已修**。同一 hook，`offset 14/14`、`flip:false`（只钳位，不翻转），预览随鼠标不再漂移 |
| `src/features/explorer/MarkdownResourceTab.tsx` | Markdown 资源页右键菜单（含子菜单方向判定） | **受影响 → 已修**。指针与可视区尺寸都换算到布局 px 后再判定 `submenuSide/verticalSide` 与钳位 |
| `src/features/reader/pdf/PdfReader.tsx` | 划词弹层 `selectionPopup` 的 `clientX - rect.left` 定位；批注层指针 → 元素坐标 | **受影响 → 已修**。统一走 `pointerToElementLayout`（滚动偏移保持原样） |
| `src/features/board/BoardEditor.tsx` | `screenPoint()`（画板所有指针工具）与滚轮缩放锚点 | **受影响 → 已修**。指针相对 `<svg>` 的位置按 zoom 换算，缩放后工具落点不再向左上偏（用户反馈的「画板工具偏向左上」） |
| `src/features/library/LibraryOverview.tsx` | 列宽拖拽增量、行内定位 | **受影响（轻微）→ 已修**。`viewportDeltaToLayout` / `pointerToElementLayout`，拖多少动多少 |
| `src/workbench/WorkbenchShell.tsx` | 侧栏宽度拖拽增量 | **受影响（轻微）→ 已修**。同上 |
| `src/features/reader/pdf/pdfCoordinates.ts` `pdfPointerCoordinates` | PDF 页面内指针坐标 | **不受影响**。已按页面 `rect.width / 页面 CSS 宽` 归一化，zoom 被自动抵消 |
| `src/features/library/BrandUpdateMenu.tsx:41` | 品牌菜单 | **不受影响**。锚定在触发按钮的 DOM 上（同一布局空间），不用指针坐标 |
| `src/features/explorer/MarkdownLivePreviewEditor.tsx` `posAtCoords` | 编辑器点击定位 | **不受影响**。CodeMirror 自己用 `getBoundingClientRect` 做同空间比较 |
| 各处 `document.elementFromPoint` / `entryAtPoint` | 命中测试 | **不受影响**。API 接受视口坐标，输入本就是 `clientX/Y` |
| 滚轮平移速度（Board、PDF）`deltaX/deltaY` | 平移手感 | **不在本任务范围**。增量未按 zoom 换算，只影响每格滚动距离，不影响对齐；如需可再开卡 |
| `uiZoom` 实现（`App.tsx`、`useUiZoom`） | — | **未改动**（任务要求） |

## 4. 验证

### 4.1 类型 / 构建 / 结构

- `npx tsc -p tsconfig.app.json --noEmit`：0 错误（`.tmp/tsc.log`）
- `npm run -s build`：EXIT 0
- `npm run -s test:architecture`：通过（新增 `src/shared/ui/*` 的边界规则已登记到 `scripts/verify-architecture-boundaries.mjs`）
- `node scripts/verify-file-tree-display-name.mjs`：PASS 130（补充了新 hook 的 mock）
- `npm run -s test:core`：通过（见 §6 热修）
- `npm run -s test:board-browser` / `test:tree-guides-browser` / `test:reader-popover-layout` / `test:pdf-eraser-alignment` / `verify-library-context-menu-browser.mjs`：均 EXIT 0
- `npm run -s verify`：`test:ui-state` 为 main 上自 `42184f1` 起的既有失败，与本任务无关；其余步骤通过（日志 `.tmp/verify2.log`）

### 4.2 单元测试 `npm run test:viewport-to-layout`（`scripts/verify-viewport-to-layout.mjs`）

10 组断言：zoom 解析（因子 / 百分比 / 关键字）、`readRootZoom` 三级回退、1 / 1.18 / 1.5 下点 / 长度 / 增量换算的精确逆运算、
钳位 / 翻转（右下放不下时镜像、镜像仍放不下时贴边、`flip:false` 只钳位、`offset` 语义、超大弹层永不越界）。

### 4.3 浏览器回归 `npm run test:popover-zoom-browser`（`scripts/verify-popover-zoom-browser.mjs`）

Playwright + Vite 挂真实 `FileTreePanel`，zoom ∈ {0.9, 1, 1.18, 1.5} × {顶部行、中部行、底部空白、右缘空白}
右键 + 118% 拖拽预览，共 24 例；断言菜单左上角（翻转时对应角）与鼠标 ≤ 2px 且完全在视口内。

- 新代码：全部通过，证据 `.tmp/shots/popover-zoom/2026-09-28T13-27-40-400Z/`（带红点标记鼠标）
- 旧代码（`git stash` 后同一脚本，`.tmp/vb_old.log`）：第一例即失败 `dx -120.6 / dy -14.4`（0.9 顶部行），证明测试能抓到回归

### 4.4 dev:live 原生窗口（WebView2，DPR 1.25，窗口 1280×820）

隔离实例 `A4 Note DEV arena-two-ctx`（vite 1499 / CDP 9329，独立库身份，不触碰真实库）。因 OS 文件夹选择器无法在无头
会话里驱动，测试库 `.tmp/native/vault/`（5 个文件夹 + 8 个 md）通过 IPC `load_workbench_state`/`save_workbench_state`
注入为文件夹项目后进入笔记场景。脚本 `.tmp/native/native-evidence.mjs` 用 CDP `Input.dispatchMouseEvent` 真实右键、
量取 `.file-tree-context-menu` 与鼠标的偏差并截图（红点 = 鼠标）。`before` = `git stash` 旧代码经 HMR 生效后的同一脚本。

| zoom | 位置 | 修复前 dx / dy（px） | 修复后 dx / dy（px） | 备注 |
| --- | --- | --- | --- | --- |
| 100% | 顶部行 | 0 / -0.3 | 0 / -0.3 | — |
| 100% | 中部行 | 0 / -0.7 | 0 / -0.7 | — |
| 100% | 底部空白 | 0 / **-171**（菜单底边 838，超出 820 视口） | 0 / -0.4 | 修复后向上翻转，底边贴鼠标 |
| 100% | 右缘空白 | -0.2 / **-75** | -0.2 / -0.4 | 同上 |
| 118% | 顶部行 | **8.4 / 54** | -0.8 / -0.6 | — |
| 118% | 中部行 | **8.4 / 80.7** | -0.8 / 0 | — |
| 118% | 底部空白 | **8.4 / -58.5**（菜单底边 988，被裁） | -0.8 / 0.3 | 向上翻转 |
| 118% | 右缘空白 | **61.6 / 37.5** | -0.1 / 0.3 | 向上翻转 |
| 118% | 拖拽预览 | **95.7 / 104.5** | 0.1 / 0.1 | 相对鼠标 +14/+14 偏移 |
| 150% | 顶部行 | **27.5 / 193** | 0 / -0.6 | — |
| 150% | 中部行 | **27.5 / 285.4** | 0 / -0.3 | — |
| 150% | 底部空白 | **27.5 / 141.5**（底边 1256） | 0 / -0.2 | 向上翻转 |
| 150% | 右缘空白 | **219.3 / 237.5** | -0.4 / -0.2 | 向上翻转 |

截图：`.tmp/shots/ctx-native/before/*.png`、`.tmp/shots/ctx-native/after/*.png`（`menu-{100,118,150}-{top-row,middle-row,bottom-blank,right-edge-blank}.png`、
`drag-preview-118.png`）与 `result.json`。`after` 全程无 console error。

## 5. 与其他卡片的协调

- `1f8d8317`（文件树多选 / 拖拽）复用本任务的 `usePointerAnchoredPosition`；冲突面只有 `FileTreePanel.tsx` 的菜单 / 拖拽预览渲染段。
- 画板卡片（`6f9e0947` 等）若新增指针工具，统一经 `screenPoint()`（已换算），不要再直接读 `clientX - rect.left`。

## 6. 顺带热修（独立提交 `fix(core): register doc2x plugin once`）

`main b159a6a` 在 `src/core/asterCore.ts` 的内建场景 for 循环内重复执行 `registerPlugin(createDoc2xPlugin())`，
启动即抛 `Plugin already registered: doc2x.core`（原生窗口白屏，`npm run test:core` 失败）。本分支把 Doc2X 注册移到循环之后，
只注册一次；基于 `b159a6a` 的其他 worktree 同样会遇到，合并后即恢复。

## 7. 限制

- 浏览器回归用 Chromium 的标准化 CSS zoom，与 WebView2 一致；原生证据在 DPR 1.25 下采集。
- 键盘打开的上下文菜单（若后续加入）应传入触发元素的中心点视口坐标，同样经该 hook 定位。
