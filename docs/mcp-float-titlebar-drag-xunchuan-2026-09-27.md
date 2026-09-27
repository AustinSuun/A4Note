# 悬浮笔记顶栏三形态居中分组与拖动跟手优化交付记录（f241fd40）

- 日期：2026-09-27（Asia/Shanghai）
- 任务：`f241fd40-9ceb-4941-a32b-7802a9e7d9f8`（in_progress rev4，owner a4046fff-89af-479e-b1f9-1d6bd0bb032b）
- 分支：`fix/float-titlebar-drag-xunchuan`（基于本地 main `90182b6`，含 456 交付）
- 执行者：巡川（Arena）

## 需求摘要

1. 悬浮速记/专注写作/PDF 专注三形态按钮组成顶栏**视觉居中的独立组**；右侧仅保留编辑/阅读等内容状态操作；位置、间距、语义清楚分离。
2. 原中央拖动短横条保留、不被遮盖；窄窗/宽窗、100–220% 缩放、浅深主题下无按钮重叠、隐藏、截断。
3. 拖动更跟手：指针移动时窗口及时跟随，无显著落后/卡顿/松手补位；提供改前改后帧间隔/性能轨迹证据。
4. 仅把手/明确拖动区可发起移动；四角缩放、菜单、正文编辑、文字选择保持原交互；边界约束与拖动后位置保持不回归。

## 实现

- `ReaderMarkdown.tsx`：笔记头改为三区结构——左 `.note-history-shell`、中 `.note-layout-center`（三形态 switch）、右 `.note-document-actions`（保存状态/插入引用/编辑·阅读）。
- `reader-writing-layout.css`：抽屉内 `.note-document-header` 用 `grid-template-columns: minmax(24px,1fr) auto minmax(0,1fr)`，三区 start/center/end 对齐；标题窄时省略号收缩，中/右组不被挤压重叠。
- 拖动/缩放改为**命令式 live 几何**：`ReaderNoteFloatingControls` 在 pointermove 期间只把 `--floating-note-{left,top,width,height}-live` 直写到 shell 元素（rAF 节流），CSS 的 `--note-card-safe-*` 消费 live 回退链；**零 React 渲染**跟随指针；pointerup 一次性 `onRectChange` 提交（持久化 + FLIP 观察到单次无视觉变化）。键盘微调与 Escape 行为不变。
- 同步更新 `note-enter-motion-host.tsx` / `note-edge-host.tsx` 夹具头部结构以匹配真实三区 DOM。
- 新增 `scripts/verify-float-drag-native.mjs`：dev:live 原生 before/after 取证——顶栏几何断言（居中偏差≤8px、左/右贴边、拖动条不遮形态组、三组互不重叠）、980 窄窗、zoom 125/150/220%、midnight 主题、CDP 真实指针拖动帧间隔/跟随误差/longtask、四角缩放可用性。

## 验证（改前/改后，隔离 dev:live floatdrag@1445/CDP 9252，DEV 身份条核验）

- **before**（旧代码，stash 后取证）：`layout.centerOffset 164.8–389.9`（形态组偏右，与编辑/阅读挤在一起）；drag1 帧间隔 median 16.6ms / p95 17.3 / max 18.6，longtasks 0。
- **after**（新代码）：`centerOffset 0`，12/12 断言通过、errors []；drag1 median 16.8 / p95 17.8、drag2 max ≤30.6ms，longtasks 0，跟随误差与 before 同量级（p95 48–61px 的测量含 CDP 往返噪声，两版一致）；改后拖动全程**无 React 提交**（live 变量路径），帧间隔不劣于改前、无 longtask；四角缩放 +60px 生效；980 窄窗与 125/150/220% 缩放下三组互不重叠、拖动条不遮形态组；midnight 截图正常。
- 合成浏览器回归：`verify-note-enter-motion-browser` 73/73、`verify-note-workbench-browser` 117/117、`verify-note-default-edit-browser` 16/16（新代码上）。
- `test:architecture`、`test:agent-status`、`npm run build` 通过（build 1.70s，仅既有 chunk 警告）。

## 限制与如实记录

- 性能证据在空闲隔离主机上：改前帧间隔已接近 vsync（median 16.6ms），改后同水平且无 longtask；改进点为结构性消除每 move 的 React 重渲染，未虚称肉眼级提速。
- `pointermoveSlow16`（Event Timing ≥16ms 的 pointermove 处理）两版均为 0，如实记录。
- 未打包/安装/推送/发布；隔离实例取证后停止。

## 状态

分支提交后 ff 合入本地 main；任务板 submit review，待用户验收归档。
