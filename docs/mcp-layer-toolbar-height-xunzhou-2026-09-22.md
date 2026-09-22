# 阅读器标注工具栏图层入口等高与左侧残留清理（巡舟 · f3878879）

任务卡：`f3878879-2067-4566-bc43-923bcb331c20`（normal，spec_revision 2，claimed spec 2）
执行者：巡舟（worker `6c2ef6c2-6a7c-4583-bf30-983fe1a43a75`，分支 `fix/layer-toolbar-height-xunzhou`，基线=最新本地 main `8a3b1ed`）
日期：2026-09-22
范围：阅读器底部标注工具坞中图层入口（叠层图标 + 可见/总数）与同排工具不等高、左侧容器残留边线、工具栏整体被撑高的外观/布局回归。不改图层数据、标注几何、橡皮擦坐标、工具尺寸、快捷键与弹窗内容。

## 1. 目标与本轮结论

| 需求 | 结论 |
| --- | --- |
| 图层入口与同排工具等高、垂直对齐 | 已实现并量测：修复前 64×64（比同排 36×36 高 28px、上下各溢出 14px），修复后 64×36，与同排按钮高度差 0px、上下边缘差 0px（≤1 CSS px 要求内） |
| 移除左侧非预期边框/阴影/圆角容器残留 | 已实现：修复前 `border-left: 0.8px solid rgba(60,80,70,.14)`（DPR 1.25 下 1px 指定值渲染 0.8px）、`margin-left: 3px`、`border-radius: 8px`（同排为 9px）；修复后 border-left 0、margin 0、radius 与同排一致 9px。未发现伪元素或 box-shadow 残留（`:is(.active,.contextual)` 的 inset 描边是选中反馈，按任务要求保留） |
| 工具栏不再被图层入口/包裹容器撑高 | 已实现：工具栏高度修复前 69.6px → 修复后 41.6px（= 36px 按钮 + 2×2px padding + 2×0.8px 边框，与既有工具按钮相称的紧凑高度）；包裹 slot 修复前 64px → 修复后 36px。未加高其它按钮、未缩小可点击区域、未用 translateY/裁切/隐藏溢出掩盖 |
| 保留既有稳定宽度设计 | 入口宽度全程 64px（125% 缩放 80px、150% 缩放 96px），不随层名伸缩；长层名重命名后入口与相邻按钮位置不变 |

参考图说明：附件 `layer-toolbar-height-reference.png`（SHA-256 `d27b84bb…f89c75` 校验一致）已下载到 worktree；本轮执行环境无法对图片做视觉查看，未凭截图断言根因——所有结论均来自隔离 dev:live 真实运行时的 DOM rect 与 computed style 量测，参考图中的疑点（不等高、左侧残留、撑高）均已被量测证实或证伪（见 §2、§5）。

## 2. 根因（真实运行时量测，非截图推断）

隔离实例 `xunzhou-toolbar`（`app.aster.research.dev.xunzhou-toolbar.w782dfc61ef`，1461/CDP 9271，DEV 身份条原生核验）打开内置指南 PDF 后量测：

1. **撑高根因——flex-basis 落在竖直轴**：`reader-annotation-layers.css` 的入口规则带 `flex: 0 0 64px`。该按钮的包裹容器 `.annotation-tool-slot` 在真实应用里是 `flex-direction: column`（遗留 `reader.css` 的 `.annotation-tool-slot` 规则泄漏，dock CSS 只覆写了 display/align-items 未覆写方向），因此 flex-basis 64px 被用作**高度**：按钮渲染为 64×64（computed height 64px，同排 `flex: 0 0 auto` → height 36px），slot 被撑到 64px，工具栏被撑到 69.6px。宽度另有 `width/min-width/max-width: 64px` 三重钉死，flex-basis 对宽度是冗余的。
2. **左侧残留**：同规则的 `border-left: 1px solid var(--border-soft)`、`margin-left: 3px` 与 `border-radius: 8px`（同排 9px）构成旧分组容器的残边观感。
3. **为什么既有回归没拦住**：`tests/fixtures/annotation-layer-picker.tsx` 只导入 tokens/base/dock CSS，不含遗留 `reader.css`，其 slot 是 row 方向——`flex: 0 0 64px` 在那里恰好落在宽度轴上，64×64 方块在夹具中不可见。真实应用级联才触发。

## 3. 实现（最小修复，2 个 CSS 文件 4 行删除 + 1 处方向钉死）

- `src/features/reader/reader-annotation-layers.css`（入口规则）：删除 `flex: 0 0 64px`（宽度已有三重钉死；避免任何 flex 容器方向下把 64px 当主轴尺寸）、`border-left`、`margin-left: 3px`、`border-radius: 8px`（回落到同排 9px），保留 64px 稳定宽度、`flex-direction: row`（抵御遗留 column 泄漏对按钮内部图标+计数排版的影响）与 overflow 保护。
- `src/features/reader/reader-annotation-dock.css`：`.reader-annotation-dock .annotation-tool-slot` 补 `flex-direction: row`，把 dock 边界内的 slot 方向钉死为行，杜绝遗留方向泄漏再次把按钮主轴尺寸当高度用。

修复前后关键量测（原生 dev:live，viewport 1280×820，DPR 1.25，UI zoom 100%；1/1、2/2、12/12、hover、focus、弹窗展开、深色主题下数值一致）：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 图层入口 | 64×64，y=687.2 | 64×36，y=715.2 |
| 同排工具/快捷键按钮 | 36×36，y=701.2 | 36×36，y=715.2 |
| 高度差 / 顶边差 | +28px / −14px | 0 / 0 |
| 入口 slot | 64px | 36px |
| 工具栏 | 69.6px | 41.6px |
| border-left / margin-left / radius | 0.8px solid / 3px / 8px | 0 / 0 / 9px |
| 125% UI zoom | 80×80，工具栏 86.6px | 80×45，工具栏 51.6px |
| 150% UI zoom | 96×96，工具栏 103.6px | 96×54，工具栏 61.6px |

## 4. 变更文件

| 文件 | 说明 |
| --- | --- |
| `src/features/reader/reader-annotation-layers.css` | 入口规则去掉 flex-basis/左边框/左外边距/独立圆角 |
| `src/features/reader/reader-annotation-dock.css` | dock 内 slot 方向钉死为 row（1 行） |
| `tests/fixtures/layer-toolbar-geometry.tsx` / `.html` | 新增几何夹具：真实组件 + 真实应用级联（含遗留 reader.css 与真实 CSS 顺序），复刻工具坞 DOM（5 个工具按钮 + 图层入口 + 快捷键入口） |
| `scripts/verify-layer-toolbar-geometry-browser.mjs` | 新增隔离浏览器几何契约（42 断言 + 截图） |
| `package.json` | 新增 `test:layer-toolbar-geometry` |
| `docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json` | 状态同步 |

与 `test:annotation-layer-picker` 一致，新几何契约保留为独立目标（需 Vite + Chrome），不并入 `npm run verify`，避免拖慢每次全量验证。

## 5. 验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 新几何契约（修复后） | `npm run test:layer-toolbar-geometry` | 42/42 通过：等高/边缘对齐 ≤1px、slot 不撑高、移除入口后工具栏高度不变、无左边框/左外边距、radius 一致、1/1 2/2 12/12 与长层名稳定、hover/focus-visible(:focus-visible 实测)/弹窗展开稳定、midnight 主题、UI 125%/150%、460px 窄窗无溢出无裁切、功能冒烟（选层/眼睛计数/Esc）、pageerror 0 |
| 旧布局红测 | stash 两个 CSS 修复后复跑 | 22 通过 / **20 失败**，失败项全部为本轮引入的几何断言（等高、对齐、slot、工具栏、左边框、左外边距、圆角、计数/主题/缩放/窄窗稳定性） |
| 图层弹窗契约（回归） | `npm run test:annotation-layer-picker` | 43/43 通过 |
| 弹窗布局契约（回归） | `npm run test:reader-popover-layout` | 166/166 通过 |
| 图层仓库/历史契约 | `npm run test:annotation-layers` | PASS 55 |
| 类型与生产构建 | `npx tsc -b`、`npm run build` | 退出 0（1.48s） |
| 全量验证 | `npm run verify`（PowerShell） | 除 2 步既有失败外全部通过：Rust 215 passed/0 failed/5 ignored、note-workbench 51/51、settings-ui 116/116、架构/场景插件/插件绑定/声明式运行时/文献库全套与 build 等。失败的 `test:reader`、`test:ui-state` 两步在干净基线（stash 本轮全部改动）复现完全相同断言（annotationColorInputValue 与 textFontSize 源码契约），系 qinglan 已合入 main 的 3781ddf 简化文本工具控件后 verify 源码契约未同步的既有阻塞（8a3b1ed 已记录该 blocker）；与本轮改动文件零交集，按惯例不代改他人脚本 |
| 诊断 | `get_diagnostics` | 0 errors / 0 warnings |
| 原生功能探针（CDP 驱动真实 Tauri 窗口） | `.tmp/xunzhou/functprobe.mjs` | 14/14：弹窗点击开启、选层更新 aria-label、眼睛切换更新计数、Esc 关闭且焦点回入口、外部点击关闭、Tab 顺序（前一工具→图层入口→快捷键按钮）、Enter 键开启、焦点描边保留、pageerror/应用 console error 0 |

原生截图（均保留 `DEV xunzhou-toolbar · 独立测试库` 身份条）：修复前 9 张（1/1、2/2、12/12、hover、focus、弹窗展开、深色、125%、150%）与修复后 9 张同场景对照，存 `.tmp/shots/layer-toolbar-height/{before,after}-*/`，随任务卡上传；量测 JSON（metrics/result/border-probe/functional-probe）同目录。已知环境噪音：dev server `favicon.ico` 404（与其它卡片记录一致，非应用逻辑错误）。
参考图附件已下载并 SHA-256 校验一致；本轮执行环境无法查看图片内容，报告结论全部来自运行时量测而非截图目视（任务描述文字与量测结果互证）。

## 6. 未做与下一步

- 未打包、未安装、未推送、未发布；未触碰正式资料库与他人未提交改动；未改弹窗内容、图层数据与标注几何。
- dev:live 隔离实例 `xunzhou-toolbar` 用后按约定停止进程，`.tmp/live-dev/xunzhou-toolbar/owner.lock.json` 留存。
- 建议后续（独立卡片）：把 dock 专属样式从遗留 `reader.css` 全量迁出，消除此类“遗留规则泄漏进 dock”的整类风险；`test:pdf-find-entry` 在高负载宿主上的 30s 硬编码超时仍待归属方放宽。

