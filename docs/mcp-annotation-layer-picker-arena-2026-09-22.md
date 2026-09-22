# 阅读器标注图层弹窗 UI 优化与底部图层入口解耦（Arena · f6b927bb）

任务卡：`f6b927bb-1acd-45a3-b758-7650d4620aeb`（high，spec_revision 4）
执行者：Arena（本地别名 `arena-shun`，worker；会话文件 `%USERPROFILE%\.a4note-project-tasks\sessions\arena-shun-1.json`，仅本对话使用）
日期：2026-09-22
范围：阅读器底部“标注图层”入口与快速弹窗的视觉/交互重构；不改标注几何、图层存储、锁定/归档语义与快捷键。

## 1. 目标与本轮结论

用户截图提出三点：活动图层左侧的单选圆点应改为整行选中背景；标题栏“新图层”按钮不清晰；每行缺少直接删除入口。补充需求：底部工具坞图层按钮与可编辑图层名称解耦。全部落地，并顺带修掉了“新图层”按钮被通用弹窗标题栏规则压成 26×26 方块的根因。

| 需求 | 结论 |
| --- | --- |
| 去掉单选圆点，整行选中背景 | 已实现：`.annotation-layer-row.active` 用 `--accent-soft` 底色 + `--accent-strong` 内描边 + 名称加粗与强调色；DOM 中不再存在 `.annotation-layer-dot`，`role="radio"`/`aria-checked` 语义保留 |
| 标题栏“新图层”按钮完整、清晰 | 已实现：主按钮样式 + 根因修复（见 2.2） |
| 每行独立删除入口 | 已实现：每行垃圾桶按钮，唯一图层禁用，含标注时弹窗内确认（移动后删除 / 连同标注删除 / 取消），删除活动层后自动切相邻层 |
| 底部入口与名称解耦 | 已实现：入口固定 64px，只显示叠层图标 + `可见/总数`；完整名称保留在 `aria-label`、`title` 与弹窗内 |

## 2. 实现要点

### 2.1 图层行：从单选圆点到整行状态

`src/features/reader/AnnotationLayerPicker.tsx`

- 删除 `<span className="annotation-layer-dot">`；`button[role="radio"][aria-checked]` 保留，键盘方向键与 Enter/Space 行为不变。
- 行状态改由整行背景承担：`.annotation-layer-row.active` 使用 `--accent-soft` 底 + `inset` 细描边，名称加粗到 680 并改用 `--accent-strong`；非活动行 hover 使用 `color-mix` 的浅色反馈，隐藏层仍以名称降透明度区分。
- 名称行仍可双击行内重命名（`onDoubleClick` → 输入框 → Enter 提交 / Esc 取消 / 失焦提交），未被删除按钮或眼睛按钮干扰。

### 2.2 “新图层”按钮：根因是通用标题栏规则

`ReaderToolPopover` 的标题栏按钮规则是给“关闭 ×”写的方形按钮样式：

```css
.reader-tool-popover-heading button { width: 26px; height: 26px; ... font-size: 19px; }
```

“新图层”按钮作为 `headerAction` 落入同一条规则，被压成 26×26、`overflow` 之外的文案被裁掉——这正是截图中“只剩模糊图标/被挤到边界”的原因。修复放在 `reader-annotation-dock.css`（不改 `ReaderToolPopover` 结构）：

- 标题栏按钮改为内容驱动：`inline-flex`、`min-width/min-height 26px`、`padding 2px 8px`、`white-space: nowrap`、`flex: 0 0 auto`。
- 图层主按钮再由 `reader-annotation-layers.css` 覆盖为：`min-height 30px`、`padding 0 10px`、强调色描边与文字、hover 浅底。
- 结果：1280×800、460px@150% 缩放下按钮文字完整、未裁切、点击区 ≥ 30px 高（契约断言 `buttonClipped === false`、`buttonHeight >= 28`、`buttonWidth >= 60`）。

### 2.3 逐行删除：可发现、可保护、可回退

- 每行新增 `.annotation-layer-delete`（Trash2 图标），`aria-label="删除图层「名称」"` 与眼睛按钮 `aria-label` 互不相同，且与眼睛按钮保持 ≥4px 间距；点击删除/眼睛不会触发行激活或进入重命名。
- 唯一可用图层时按钮 `disabled` 且 `title="唯一图层不能删除"`；服务层同样拒绝（`previewDelete.deletable === false`），双层保护。
- 空图层：直接删除，无多余确认。
- 含标注/被笔记引用的图层：不立即删除，弹出 `role="alertdialog"` 面板，明确写出「包含 N 条标注（M 处被笔记引用）」，并提供：
  - 「移动并删除」：选择目标图层后 `deleteLayer(id, 'move', target)`，标注 id/几何/时间与 `@annotation(id)` 引用不变；
  - 「连同标注删除」：`deleteLayer(id, 'purge')`；
  - 「取消」：不改任何数据，焦点回到该行的删除按钮。
- 删除的是活动图层时，按行内相邻顺序接管活动态（优先下一行，其次上一行），并在状态区播报；失败时不静默——播报失败并保留图层与焦点。

### 2.4 底部工具坞入口与名称解耦

`AnnotationLayerPicker` 入口按钮不再渲染 `.annotation-layer-btn-name`：

- 固定 `width/min-width/max-width: 64px`、`flex: 0 0 64px`，内容恒为「叠层图标 + `可见/总数`」；`data-layer-total` 便于契约断言。
- 完整活动图层名保留在 `aria-label`（含写入层与可见计数、写阻塞原因）与 `title` 中，可访问性不降级。
- 因此把图层重命名为超长中英数混排 / emoji，按钮宽度与相邻工具位置完全不变（契约断言宽度与相邻按钮左边界偏移 < 0.5px）。

### 2.5 顺带修掉的真实缺陷（回归先行发现）

首次浏览器契约运行 43 项中 1 项失败：`460px 窗口 @150% 缩放` 下弹窗出现横向溢出（`scrollWidth 300 > clientWidth 295`）。根因是新弹窗的 `min-width: 300px` 在窄窗口 + UI 缩放时超过标题栏按钮重排后的可用宽度。改为 `min-width: 280px` 后复跑全绿。这条缺陷由新契约在提交前捕获，未进入 main。

## 3. 变更文件

| 文件 | 说明 |
| --- | --- |
| `src/features/reader/AnnotationLayerPicker.tsx` | 入口按钮与快速弹窗重构：去圆点、删除入口与确认、活动层接管、播报 |
| `src/features/reader/reader-annotation-layers.css` | 入口固定宽度、整行选中态、删除/确认/主按钮样式、深色主题覆盖 |
| `src/features/reader/reader-annotation-dock.css` | 弹窗标题栏按钮规则由 26px 方块改为内容驱动（1 行） |
| `package.json` | 新增 `test:annotation-layer-picker` |
| `scripts/verify-annotation-layer-picker-browser.mjs` | 新增隔离浏览器契约（43 项断言 + 8 张截图） |
| `tests/fixtures/annotation-layer-picker.html` / `.tsx` | 新增组件夹具（真实组件 + 真实应用 CSS + 内存图层 API） |
| `docs/notes/AGENT_STATUS.md`、`plans/PROJECT_STATUS.json` | 状态同步 |

`scripts/verify-all.mjs` 在本轮曾临时加入新契约，随后恢复原样：该回归需要启动 Vite + Chrome（在高负载宿主上单次约 3–4 分钟），与 `test:reader-popover-layout` 一致地保留为独立目标，避免拖慢每次 `npm run verify`。

## 4. 验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 新增弹窗/入口契约 | `npm run test:annotation-layer-picker` | 43/43 通过（`passed 43 / failed 0`），含入口宽度稳定性、无圆点、整行选中态与对比度、删除保护与确认流、12 层滚动、460px@150%、深色主题、`pageerror` 0 |
| 图层仓库/历史契约 | `npm run test:annotation-layers` | PASS 55 assertions |
| 类型与生产构建 | `npx tsc -b`、`npm run build` | tsc 退出 0；build 退出 0（2623 modules，1.38s） |
| 全量验证 | `npm run verify`（PowerShell） | 28/30 步骤通过；2 步失败见下 |
| 诊断 | `get_diagnostics` | 0 errors / 0 warnings |

`npm run verify` 的两步失败与处置：

1. `npm run test:annotation-layers`：既有源码文本契约 `/ > 新图层<\/button>/` 因本轮按钮内部结构调整而失败。为把改动面缩到最小，未改他人脚本，而是让新按钮源码保留兼容写法（`... /> 新图层</button>`，渲染文本不变、契约断言 `textContent.trim() === '新图层'` 仍成立）。单独复跑 `node scripts/verify-annotation-layers.mjs` → **PASS 55**。
2. `npm run test:pdf-find-entry`（他人卡片合入的浏览器脚本，与本轮文件无交集）：失败原因为 Vite 页面加载超过该脚本硬编码的 30s `page.goto` 超时：

```text
page.goto: Timeout 30000ms exceeded.
  - navigating to "http://127.0.0.1:5173/__find", waiting until "load"
```

宿主当前负载很高（同时有其它 Agent 的构建/浏览器任务；实测本机空闲显存/内存一度低至 2.4GB / 32GB，Vite 首次转换在本轮回归里实测需约 3.5 分钟）。这是环境时序问题，不是本轮代码问题：该脚本不加载本轮任何文件，且本轮契约在放宽就绪等待后可以通过。未修改该脚本，交由卡片归属方决定是否放宽超时。

## 5. 证据与限制

- 契约证据：`.a4-tests/annotation-layer-picker/<run>/result.json`、`stages.log`、`screenshots/`（`picker-1-layer`、`picker-5-layer`、`picker-12-light`、`picker-12-scroll`、`picker-12-dark`、`picker-confirm`、`picker-narrow-z150`、`dock-long-name`）。
- 夹具为真实组件 + 真实应用 CSS（`tokens.css`、`base.css`、`reader-annotation-dock.css`、`reader-annotation-layers.css`）+ 内存图层 API；不接触真实资料库、不启动原生进程。
- **未提供原生 `dev:live` 截图（验收第 8 项未满足，如实记录）**：本轮实际尝试过原生取证，被两道硬性约束挡住。其一，仓库内已有的隔离实例（`.tmp/live-dev/*`）都留着 `owner.lock.json`，启动器按 fail-closed 设计直接拒绝复用，也不会清除他人锁（其提示明确要求不得终止他人会话）；其二，新建实例会使用 `.build/live-dev/<instance>/target` 这个全新的 Rust 目标目录，需要完整冷编译，在无人值守窗口内无法可靠完成；此后仍要经系统文件对话框打开 PDF 才会出现阅读器工具坞。这与已归档卡片 `23528921` 记录的限制一致（该卡的弹窗几何同样由隔离 Chrome 回归覆盖并获验收）。本轮没有伪造原生截图；原生复核方式：在具备暖目标目录或交互条件的会话中执行 `npm run dev:live -- --instance <新代号> --port <端口> --cdp-port <端口>`，打开内置指南 PDF 后对照第 2 节的断言点检查 1/5/12 层与浅深主题，并记录 pageerror/console error。
- 启动器与探针脚本、日志均留在 `.tmp/` 与 `.a4-tests/`，未进入 `docs/`。

## 6. 未做与下一步

- 未打包、未安装、未推送、未发布；未触碰其它 Agent 的未提交改动与工作树。
- 图层数量 12 层时列表内滚动、标题栏固定；如需支持 20+ 层的分组/搜索，属于后续卡片。
- 建议下一步：由验收方在原生实例复核 1/5/12 层的观感、深色主题与 125%/150% 缩放；若认可，可把 `test:annotation-layer-picker` 的等待预算或 Vite 预热策略同 `test:pdf-find-entry` 一起统一，避免高负载下的假失败。
