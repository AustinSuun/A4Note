# 白板界面布局重构（任务 d8505429 ）

- 任务：`d8505429-fa4d-43c8-9150-34cb2d19b0e7`（工具改悬浮工具栏、颜色并入弹层、控制迁标题栏、默认进入画布、背景纹理设置）
- 分支：`board-layout-arena-two`（worktree `.worktrees/board-layout-arena-two`，基于 `main 2ab5900`）
- 日期：2026-09-29

## 1. 悬浮工具栏（复用共享坞皮肤，不复制样式）

- 删除整行 `board-toolbar` 顶栏（窄窗两行换行、控制堆叠的根源）。
- 工具按钮保持与阅读器标注坞**同一段标记**（`.annotation-toolbar` + `.annotation-tool-btn`，97fcfb6c 引入），外套 `.board-annotation-dock`（绝对定位、底部居中、`bottom:16px`、`max-width:calc(100% - 24px)`）。
- `src/shared/floating-dock.css` 的选择器组从 `.reader-annotation-dock …` 扩展为 `:is(.reader-annotation-dock …, .board-annotation-dock …)`——胶囊圆角 16px、`--surface`/`--line` 背景、玻璃拟态、阴影 token、40→36px 紧凑按钮、图标 24px/2.2 线宽、激活态 `accent-soft` 全部**由共享文件提供**（`board.css` 仅 `@import` + 少量板面特有覆盖，无复制）；浏览器回归断言共享文件里存在 `.board-annotation-dock` 选择器。
- 工具集与颜色弹层沿用 97fcfb6c 的共享实现（本卡第 2 点「颜色并入工具弹层」即该共享弹层：预设色 + 自定义色 + 线宽/字号/箭头样式/橡皮尺寸，按工具记忆）；常驻 `board-swatches` 色板行与 `board-width` 下拉**删除**（CSS 与 JSX 一并移除，架构脚本本就禁止 BoardEditor 再出现）。

## 2. 控制项迁入窗口标题栏

- 复用 `DocumentToolbar` 的 `controlsHost` portal + `ReaderResponsiveToolbar`（`label="白板"`）：撤销/重做/复制/删除、缩放（−/百分比/+/适应内容）、「复制引用」、保存状态在**白板页签激活时**出现在窗口标题栏文档控制区；窄窗口由 `ReaderResponsiveToolbar` 既有策略收进「更多」菜单，结构上不可能再换行。
- 无标题栏宿主时（阅读器内嵌白板）回退为画布右上角覆盖胶囊 `.board-stage-controls`，同一份 `docControls` 节点复用。
- **标题取舍**：`board-title` 保留在内容区左上角覆盖胶囊（不进窗口标题栏）——内嵌白板没有标题栏宿主，且标题双击重命名（`board-title-input`）留在画布上更贴近「文件本体」；文档标题随 `.a4board` 持久化。

## 3. 默认进入即画布

- 打开白板直接是干净画布 + 悬浮坞；空白提示弱化（标题 13px `--muted`、说明 11px、整体 opacity .6），出现首个元素后不再显示（沿用原有条件渲染）。

## 4. 背景纹理（按白板持久化）

- `BoardDocument` 新增可选 `background: { style, density }`：`dots | grid | lines | graph | solid` × `small | medium | large`；缺省/旧文件 = `dots + medium`（即原点阵观感），读写向后兼容（未知值告警并回退默认，不静默清空）。
- 世界坐标间距 `16/24/40px`（`boardBackgroundSpacing`），SVG pattern `userSpaceOnUse` + `x/y=viewport.x/y`，随缩放/平移与内容保持对齐；横线/方格纸副线（`board-grid-minor`）仅方格纸渲染。
- 低对比：全部用 `--line` 派生（`.board-grid-line` 透明度 .5、minor .3、点 .55），深色主题同样走 token；缩放到 pattern 间距 <5 屏幕 px 时自动隐藏（`aria-hidden` + 透明填充）防摩尔纹。
- 入口：坞内「画布背景」按钮（Palette 图标）弹 `AnnotationToolPopover`，样式 5 选 + 密度 3 选（纯色时隐藏密度）；选择即写盘（`setDocMeta` → `serializeBoardDocument`），不写第二份设置。

## 5. 验证

| 项 | 结果 |
| --- | --- |
| `tsc -p tsconfig.app.json --noEmit` | 0 错 |
| verify 矩阵（build / board / board-browser / tree-guides / reader-popover-layout / pdf-eraser / library-context / architecture / core / viewport-to-layout / popover-zoom） | 11/11 全 0 |
| `npm run -s verify` | 修复 97fcfb6c 连带的三处源码契约破损后，仅剩已知旧失败 `test:ui-state`（基线同样失败） |
| 新单测（verify-board-model +2） | background 缺省=旧文件兼容、未知样式告警回退、三档间距 16/24/40、序列化往返 |
| 新浏览器回归（verify-board-browser +11） | 坞皮肤 16px 共享（断言 floating-dock.css 源含板面选择器，非复制）、旧工具栏/色板/线宽消失、默认 24 世界 px 点阵、方格纸主副线、密度=世界间距、选择落盘、缩小时摩尔纹隐藏、无宿主时回退覆盖层 |
| 旧代码对照 | `git checkout` 四个 src 文件后新断言首项即失败（OLD_EXIT=1），已还原 |
| 连带修复（97fcfb6c 遗留） | `verify-reader-rendering` / `verify-pdf-selection-preview` / `verify-pdf-text-annotation` 的源码契约断言改指 `annotationTools` 新位置（工具表 / 颜色映射 / 文字设置控件 / `textFontSize: 24` 默认值）——97fcfb6c 合入后 main 的 verify 伞在这三项上是红的，本卡修复后仅剩 `test:ui-state` |

## 6. 原生（dev:live）证据

实例 `arena-two-layout`（隔离 dev:live，vite 1502 / CDP 9332，共享 debug cargo target），注入 vault 工程打开 白板.a4board，CDP 驱动真实窗口：

- 悬浮坞：`.board-annotation-dock` 圆角 16px（共享胶囊皮）、9 按钮（8 工具 + 画布背景）、按钮 36px 与阅读器紧凑档一致；旧 `.board-toolbar`/色板/线宽下拉 = 0；空白提示 13px / opacity 0.6。
- **窗口标题栏 portal 生效**：真实标题栏内出现 `reader-titlebar-tools`（缩放 100%、撤销、复制所选），画布上无回退覆盖层。
- 标题覆盖胶囊双击重命名 → 「重构板」写入 .a4board。
- 背景菜单：点阵/网格/横线/方格纸/纯色 + 小/中/大间距；选 网格+大间距 → pattern 间距 40px（100% 缩放 = 世界 40px）、落盘 `background {"style":"grid","density":"large"}`。
- 画笔补一笔后空白提示消失、元素 1、自动保存。
- 全程 0 条 console.error / 页面异常。截图 5 张 + `native-result.json` 见 `docs/screenshots/board-layout-arena-two/`。

## 7. 注意点

- `git worktree add` 出来的新 worktree 若 `node_modules` 为空目录，dev:live 启动器会找不到 `@tauri-apps/cli`——需删空目录并 `mklink /J` 到主仓 `node_modules`（`npm run` 系列靠向上解析不受影响）。
- 合成 WheelEvent 连续派发时 `viewportRef` 同帧读旧值，一次 evaluate 里多步缩放需每步让出事件循环。
- 工具统一/颜色弹层主体由 97fcfb6c 交付，本卡在其上完成布局三迁（坞/标题栏/覆盖层）与背景纹理。
