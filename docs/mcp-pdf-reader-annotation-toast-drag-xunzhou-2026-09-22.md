# PDF 标注状态提示与文本框拖动稳定性：Windows/Tauri 证据

- 任务：`20b183cd-b25c-44b5-b2f2-b63921b51242`
- 隔离实例：`xunzhou-toast-drag`
- 原生身份：`app.aster.research.dev.xunzhou-toast-drag.wd8d697bd3d`
- 实现提交：`fa49614e23800bf8f637fe47ad2174702b258e64`
- 本地 main 合并提交：`4c918db272b9665161d5a2a0ea041267627ea91f`
- 环境：Windows 原生 Tauri `dev:live`，WebView DPR 1.25

## 实现结果

1. `useReaderSaveQueue` 继续保留待处理任务、重试和放弃语义，但正常保存/移动/擦除不再渲染 `role=status` 或“……中…”提示；仅失败任务显示 `role=alert`、重试和放弃/关闭。
2. 文本框移动/缩放统一由拖动预览与 revisioned optimistic geometry 驱动。pointerup 时预览原子切换为乐观最终几何；只有原生/父层发布了完全相同的最终几何才清除乐观状态。
3. 旧异步结果与旧失败的放弃动作都不能覆盖更新 revision；显式放弃当前失败则恢复已提交几何。
4. 未加入固定坐标补偿。

## 修复前/后确定性逐帧结果（118%）

为建立可复现的异步窗口，仅在证据运行时临时加入 900 ms 原生持久化延迟；证据采集后已完整撤销，延迟不在提交中。

| 检查项 | 修复前 | 修复后 |
|---|---|---|
| 拖动 CSS 位移 | `150 × 95` | `150 × 95` |
| pointerup 后逐帧 | 40–640 ms 回到旧几何，约 680 ms 才回到最终位置 | 40–1280 ms 始终保持最终几何 |
| 文本框移动提示 | `移动标注中…` | 无 |
| 橡皮擦提示 | `擦除笔迹中…` | 无 |
| snap-back 样本 | 多个 | `[]` |
| 原生只读回读 | 最终才更新 | 与最终乐观几何一致：`x=38.3820060814, y=54.1140746235` |
| pageerror/console error | 无应用错误 | `[]` |

截图：
- `annotation-before-eraser-status.png`：修复前左上角橡皮擦状态提示。
- `annotation-after-eraser-status.png`：相同操作修复后无正常进度提示。
- `annotation-before-drag-release.png`：修复前 pointerup 后文本框回到旧位置并显示移动提示。
- `annotation-after-drag-release.png`：修复后 pointerup 后仍在最终位置且无提示。
- 完整逐帧、队列文本、原生回读和错误日志分别见 `annotation-before-result.json`、`annotation-after-result.json`。

## 拖动矩阵

`annotation-after-matrix.json` 的五个 Windows/Tauri 场景全部通过：

- 100% 快速拖动；
- 侧栏收起/fit-width 140%；
- 190% 高缩放并滚动；
- 左侧可视边缘；
- pointerleave 清理。

矩阵同时覆盖慢速/快速移动。每个场景的 release→settled 位移均为 `[0,0]`，保存队列文本和浏览器错误列表均为空。主确定性脚本另覆盖 118%。

## Undo / redo / reopen

`annotation-after-undo-redo-reopen.json`：

- 一次 undo 产生单一稳定回退：`[-28,+22]`；
- 一次 redo 回到最终位置：`[0,0]`，持续采样稳定；
- reload 后原生 position JSON 与 redo 后完全一致；
- `errors: []`。

重开截图：`annotation-after-reopen.png`。

## 可操作失败反馈

通过仅用于证据的原生写入拒绝注入验证（采集后已撤销）：

- 乐观几何在拒绝后继续保持；
- 队列显示 `移动标注失败：证据：原生写入被拒绝`；
- 保留“重试”和“放弃未保存标注”；
- 显式放弃后恢复已提交几何并清除队列 alert。

见 `annotation-after-actionable-error.png` 和 `annotation-after-actionable-error.json`。

## 自动化验证

- `node scripts/verify-reader-priority-fixes.mjs`：`PASS 71 reader priority behavior assertions`。
- reader rendering/helpers、PDF text annotation（28）、selection preview（37）、eraser precision（22）：通过。
- `npx tsc -b --pretty false`：通过。
- `npm run build`：通过。
- `npm run verify`：退出码 0，`A4Note verification passed`；含项目任务 86 pass / 1 平台 skip、Rust 215 pass / 5 ignored（明确网络/专用集成项）、所有 reader/annotation/UI/native-host/sync/library 套件。

## 本地 main 集成

- 实现提交 `fa49614e23800bf8f637fe47ad2174702b258e64` 已由 `4c918db272b9665161d5a2a0ea041267627ea91f` 合入本地 `main`。
- 后续 `main` 的 PDF text-layer 改动仍保留该实现；在当前 `main` 上重新执行优先级行为、Reader、helpers、文本标注、选区预览、橡皮擦和 TypeScript 检查均通过。
- 根目录原有未跟踪 PDF/截图/测试资料保持未触碰。
- 当前 `main` `e26e766ce50c105c7809b1342c8db27d389f7ca1` 上再次执行完整 `npm run verify` 退出码 0；Rust 为 215 passed / 0 failed / 5 ignored，最终输出 `A4Note verification passed`。
