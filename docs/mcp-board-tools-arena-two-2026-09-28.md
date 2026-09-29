# 白板工具与阅读器标注工具统一（任务 97fcfb6c）

- 任务：`97fcfb6c`（白板工具与阅读器标注工具保持一致；白板工具落点在界面缩放下偏向左上）
- 分支：`board-tools-arena-two`（worktree `.worktrees/board-tools-arena-two`，基于 `main`，提交前 rebase 到当期 main）
- 日期：2026-09-28

## 1. 根因

两个问题：

1. **工具不一致**：白板（`BoardEditor`）自带一套独立的工具按钮、颜色板、线宽/字号等设置，与 PDF 阅读器标注工具（高亮/下划线/批注/文本/画笔/橡皮/图形/连线）各自为政：同名工具图标不同、颜色互不记忆、线宽等设置不共享，用户要分别调两遍。
2. **落点偏移**：界面缩放用 `document.documentElement.style.zoom` 实现（Chromium 标准化 CSS zoom）。此时存在两套坐标——`MouseEvent.clientX/Y` 是视口 px，而 `<svg>` 内部绘制坐标是布局 px（`layout = viewport / zoom`）。旧代码把 `clientX - rect.left` 直接当画板布局坐标用，100% 下恰好相等，125% 起所有工具（画笔/图形/文本/橡皮/框选）落点系统性偏向左上，误差 `(zoom-1)×相对位移`，越靠右下偏得越多。

## 2. 方案

### `src/features/annotationTools/`（新共享模块，白板与阅读器同源）

| 文件 | 内容 |
| --- | --- |
| `constants.ts` | 工具清单（id/中文名/快捷键）、`annotationPresetColors` 预设色、`defaultToolColors`（每工具默认色，互相独立记忆）、`toolHasSettings` |
| `toolSettings.ts` | 唯一的共享设置存储：storage key `aster.reader.annotationToolSettings.v1`（沿用阅读器历史 key，老用户设置无缝迁移）；`load/save/normalize` + 页内单例 store（`createAnnotationToolStore`/`annotationToolStore`）+ `useSharedAnnotationToolSettings`；颜色覆盖 map + `useSharedToolColors` |
| `AnnotationToolIcon.tsx` / `AnnotationToolPopover.tsx` / `ToolOptionsBar.tsx` | 统一图标、工具弹层（颜色预设 + 线宽/字号/箭头样式/橡皮形状等）、工具条选项栏 |
| `index.ts` | 汇出（含 `ToolColorPalette`） |

### 接入清单

| 文件 | 改动 |
| --- | --- |
| `src/features/board/BoardEditor.tsx`（重写工具层） | 工具集改为与阅读器一致：选择/平移/文本/便签/图形/连线/画笔/橡皮（V/H/T/N/R/A/P/E，`O` 为图形别名）；按钮/弹层直接复用 `annotationTools` 组件；颜色走 `useSharedToolColors`（与阅读器同一份记忆）；线宽/字号/箭头样式/橡皮尺寸读共享设置；指针坐标统一 `pointerToElementLayout`（复用 ae61143f 的共享换算），缩放下落点与鼠标一致；**新建元素默认 `stroke:'auto'`（渲染为 `currentColor`，深浅主题跟随）**，仅当用户改过该工具颜色才落具体色（`boardPaintOf`）；箭头以 `x:0,y:0,w:0,h:0` 进 `withBounds`，拖出的包围盒即所见；`data-board-tool` 根属性、`data-tool` 按钮属性、`[data-element-id]` 渲染契约保持不变 |
| `src/features/reader/ReaderScene.tsx` | `useState+useEffect` 持久化对换成 `useSharedAnnotationToolSettings()`（同一 store，白板/阅读器实时互通） |
| `src/features/reader/pdf/types.ts` | `ReaderToolSettings = AnnotationToolSettings` 等类型别名（兼容面不变） |
| `src/features/reader/pdf/readerToolSettingsStorage.ts` | 兼容 shim：全部转调 `annotationTools`（同 key），旧导入路径不破 |
| `src/features/reader/ReaderToolbar.tsx` | `toolColorFor` 优先共享颜色覆盖，其次默认色 |

### 校验脚本

| 脚本 | 改动 |
| --- | --- |
| `scripts/verify-board-browser.mjs` | 1500 元素 marquee 用例补 `scrollIntoViewIfNeeded`（第 3 行条目原本整体在首屏折叠线下，拖拽坐标落在视口外——检查本身与实现无关） |
| `scripts/verify-popover-zoom-browser.mjs` | 白板图形按钮选择器更新为新工具条 `.annotation-tool-btn[data-tool="shape"]` |
| `scripts/verify-architecture-boundaries.mjs` | 必含文件 + 断言：BoardEditor/ReaderToolbar/storage 必须来自 `annotationTools`，BoardEditor 禁止出现旧 `board-swatch/board-width` |
| `scripts/verify-annotation-tools-settings.mjs`（新） | 共享 store 单例语义、normalize、持久化、跨实例（storage + 晚挂载 host + 订阅计数） |
| `scripts/verify-annotation-tools-browser.mjs`（新） | 真实双挂载（白板 + 阅读器）共享设置互通：颜色/线宽/快捷键/125% 缩放落点 dx/dy=0 |

## 3. 验证

| 项 | 结果 |
| --- | --- |
| `tsc -p tsconfig.app.json --noEmit` | 0 错 |
| `npm run -s build` | 0 |
| `test:annotation-tools-settings`（新单测） | PASS |
| `test:annotation-tools-browser`（新浏览器回归） | PASS（125% 下 pen/shape dx/dy=0） |
| `test:board-browser` | PASS（含 1500 元素 marquee <3s） |
| verify 矩阵（build / board-browser / tree-guides / reader-popover-layout / pdf-eraser / library-context / architecture / core / viewport-to-layout / popover-zoom） | 全部 0 |
| `npm run -s verify` | 除已知旧失败 `test:ui-state` 外 0 |
| 旧代码对照 | `test:annotation-tools-browser` 在旧代码失败（`shared ids []`），设置单测旧代码 0（新断言仅对新代码有意义） |

## 4. 原生（dev:live）证据

实例 `arena-two-bt`（隔离 dev:live，vite 1500 / CDP 9330，共享 debug cargo target），注入 vault 工程（`.tmp/native/vault`）后打开 白板.a4board，用 CDP `Input.dispatchMouseEvent` 真实绘制。`CDP Input.dispatchMouseEvent` 在 100% / 125% 界面缩放下逐工具验证（`Input.dispatchMouseEvent` 落点 vs 元素包围盒）：

| 缩放 | 工具 | 起点偏差 | 末点偏差 | 备注 |
| --- | --- | --- | --- | --- |
| 100% | 画笔 | dx=0 dy=0 | — | 墨迹包围盒左上角与落点重合 |
| 100% | 图形 | dx=0 dy=0 | dx2=0 dy2=0 | 拖出矩形四角全对齐 |
| 100% | 文本 | dx=0 dy=0 | — | 编辑器中心即点击点 |
| 100% | 橡皮 | — | — | 整笔擦除生效（3→2） |
| 125% | 画笔 | dx=0 dy=0 | — | 偏移修复后与 100% 一致 |
| 125% | 图形 | dx=0 dy=0 | dx2=0 dy2=0 | 同上 |
| 125% | 文本 | dx=0 dy=-0.01 | — | 亚像素 |
| 125% | 橡皮 | — | — | 生效（5→4），撤销恢复 |

落盘校验：`read_text_file` 读回 白板.a4board，5 个元素、矩形存布局坐标 `[78, 56.6, 130, 80]`；全程 0 条 console.error / 页面异常。截图 8 张（100%/125% 各 pen/shape/text + 125% 画笔弹层 + 深色主题）见 `docs/screenshots/board-tools-arena-two/`，原始数据 `native-result.json` 同目录。

## 5. 注意点

- 新元素默认色保持主题跟随（`currentColor`）；用户显式选色后才落 hex——与阅读器行为一致，同时不破坏白板深浅主题测试。
- `annotationToolStore` 是同页单例：两次 `createAnnotationToolStore()` 共享状态（测试用 storage 断言 + 晚挂载 host 验证传播）。
- `normalizeStoredAnnotationToolSettings` 不钳位数值（只兜底非数字），钳位在渲染层。
