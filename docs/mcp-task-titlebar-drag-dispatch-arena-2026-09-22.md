# 任务场景标题栏空白区无法拖动窗口任务派发记录

任务卡：`8cc3cc88-3837-434d-ae0f-34e294972aff`（本机看板 · queued · normal · rev 2）
派发者：arena（远程 MCP 会话，代号「竞场」）
日期：2026-09-22

## 用户反馈

任务场景（看板已连接）标题栏里，流程切换「总览 / 任务队列 / 正在进行 / 待检查效果 / 已归档」右侧到
「发布者提示词」按钮之间的整段空白，鼠标按下无法拖动窗口。参考截图已作为任务附件 `task-titlebar-drag-reference.png` 上传。

## 派发前定位（供执行者核对，非最终根因）

- 窗口拖动由 `src/workbench/windowTitlebarGestures.ts` 在 `header.window-titlebar` 上的捕获阶段 mousedown/dblclick 实现；
  `isBlankArea` 对 `target.closest(INTERACTIVE_TARGET)` 命中的目标直接放弃，列表包含 `[data-window-no-drag]`。
- `src/features/taskboard/TaskStageViews.tsx:12` 把 `data-window-no-drag` 打在整个 `<nav class="tb-stage-nav">` 上，
  而 `task-stage-views.css:1` 给 `.tb-stage-nav` 设了 `flex: 1 1 auto`；在标题栏宿主中它增长到主按钮之前，
  真正的控件 `.tb-stage-switch` 只有 `width: max-content`，因此切换右侧的“空白”实际都在 no-drag 容器内。
- `task-titlebar-actions.css:4` 的 `-webkit-app-region: no-drag` 在 Tauri/WebView2 下不生效，属于误导性残留。
- 现有回归 `scripts/verify-task-stage-integration.mjs:251-252` 只对 `.window-titlebar-drag-zone` 派发事件，未覆盖真实空白坐标。

## 任务要点

- `data-window-no-drag` 只标在真正的控件表面，标题栏中的 `.tb-stage-nav` 不再 flex-grow（窄窗仍可横向滚动）。
- 清理不生效的 `-webkit-app-region` 规则/注释；不新增第二套拖动处理器。
- 顺带核查阅读器 / Markdown / 资料库 / 设置的标题栏宿主是否有同类问题。
- 回归补坐标级断言（`elementFromPoint` + `__gestures`），旧实现下应失败。

## 边界

- 本会话只发布任务，未领取、未执行、未改动 `src/`；未推送、未打包。
