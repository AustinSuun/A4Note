# PDF 阅读器橡皮擦回归修复

- 日期：2026-09-22
- 执行者：青岚
- 任务：`1b61d9e0-e0c2-4507-ac26-0a7c1e36f98c`
- 分支：`fix/eraser-regression-qinglan`

## 问题与根因

1. `PdfReader` 的每次移动事件都从 React 尚未刷新的 `currentFileAnnotations` 计算裁剪结果。持久化队列虽然串行，但排队的 `nextPosition` 已由旧几何生成，因此较后的单点结果会覆盖较早的擦除，表现为已有字迹擦不掉或重新出现。
2. 旧橡皮逻辑混用 mouse/pointer 生命周期，按下后没有统一的 pointer capture；预览又允许页面外 15% 的死区并保留旧状态。指针跨 PDF 边界、侧栏或窗口时，预览会滞留、跳动，并可能留下不完整的拖动生命周期。

## 修复

- 为每个 annotation 保存未落盘的累计擦除几何，后续采样从最新草稿继续裁剪，而不是从 props 中的旧 stroke 重算。
- 保存成功时仅在该 promise 对应的值仍是最新值时清理草稿，避免早完成的异步操作清除后续采样。
- 橡皮统一使用 `pointerdown/move/up/cancel/lostpointercapture`；按下后捕获 pointer，结束时统一释放，只允许活动 pointer 在主键按下时擦除。
- render layer 矩形外立即隐藏预览；非拖动离页、窗口失焦和 document 离开时也清理预览，避免边界滞留。
- 保留现有 annotation owner/file/resource/layer 过滤和 `eraseInkPosition` 精确分段算法，未放宽锁定层写入规则。

## 回归覆盖

`scripts/verify-pdf-eraser-precision.mjs` 新增以下旧实现会失败的契约：

- 页外立即清理光标，且不存在旧 15% 死区；
- eraser 使用 pointer capture 和完整终止生命周期；
- 快速连续采样从 annotation 的累计缓存几何计算。

原有 16 项几何/坐标契约继续覆盖圆形、方形、非等比半径、稀疏长线段、边缘相切、run 分隔与 bounding box；现共 19 项。

## 验证结果

- `npm run test:pdf-eraser-precision`：19/19 通过。
- `npx tsc --noEmit`：通过。
- PDF reader 目录 diagnostics：0 error / 0 warning。
- `git diff --check`：通过。
- Windows PowerShell 中 `npm run verify`：退出码 0；包含前端生产构建、Rust/Tauri 编译及项目全量验证。原有 native host dead-code warning 未由本变更引入。

隔离 `dev:live` 启动曾在端口 1456/CDP 9356 发起，但当前远程命令会话未保留可连接的 CDP 端口，因此未把未观察到的鼠标操作、截图或 SQLite 结果写成证据。自动化契约、完整构建和全量验证结果如上，可复核。

## 影响文件

- `src/features/reader/pdf/PdfReader.tsx`
- `src/features/reader/pdf/PdfPageView.tsx`
- `scripts/verify-pdf-eraser-precision.mjs`
