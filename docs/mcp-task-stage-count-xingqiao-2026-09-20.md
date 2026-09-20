# 任务场景切换条空槽修复（星桥执行，2026-09-20）

任务：04922ea7-45e6-4c3c-893e-dbe5282995f6（用户截图：已归档右侧多余空白底框）。
分支：fix/task-stage-count；工作区：.worktrees/task-stage-style；基线：本地 main。

## 原因

阶段切换条实际渲染 5 个按钮（taskStages），但 `task-stage-views.css` 仍按旧的六项布局写死：
`grid-template-columns: repeat(6, ...)` 与选中滑块宽度 `calc((100% - 14px) / 6)`。第六列没有按钮，
容器右侧留下一个空槽，与用户截图一致。浏览器基线实测：1440 宽、100%、浅色时最右按钮到容器
右边界为 115px。

## 修改

- `src/features/taskboard/TaskStageViews.tsx`：切换条内联变量增加 `--tb-stage-columns: taskStages.length`，
  与已有的 `--tb-stage-index` 一样由真实阶段数驱动。
- `src/features/taskboard/task-stage-views.css`：网格列数与滑块宽度改为按 `--tb-stage-columns`
  计算（含 2px 间距与内边距），阶段增减不再残留空槽。按钮字号、字重、圆角、焦点、禁用、
  reduced-motion 规则未改。
- 新增 `scripts/verify-task-stage-count-browser.mjs`：独立 Chrome（临时 profile、随机回环端口）
  加载生产构建的 TaskStageSwitcher，`--baseline` 用于复现旧空槽。

## 验证

| 项目 | 结果 |
| --- | --- |
| 浏览器基线（修复前，`--baseline`） | 80 组几何检查通过，其中最右空白 115px 复现旧问题 |
| 浏览器修复后 | 80 组通过：1440/1280/1024/360 宽 × 缩放 1/1.25 × 浅/深主题 × 5 个阶段；最右空白 3px（边框+内边距），滑块左边界/宽度误差 <2px，单一 aria-pressed，无横向溢出；键盘 End/Home/ArrowRight/ArrowLeft 4 项、禁用态点击不切换、reduced-motion 过渡 0s |
| `scripts/verify-task-stage-views.mjs` | 74 断言通过，隔离 TypeScript 诊断 0 |
| `scripts/verify-task-stage-integration.mjs` | 53 项通过 |
| MCP 诊断（taskboard 目录） | 0 |
| 完整 PowerShell `npm run verify` | 退出 0（cmd_b45118a098f34c46122a3f6fb62b9c91124240e80b8814db，日志 .tmp/arena-dispatch/stage-verify-serial.txt，末尾 A4Note verification passed） |

源码提交：560cc2c6e62d717685185b623fc4508dbcaca600（fix/task-stage-count，仅 4 个显式文件；生成的 src-tauri/gen/schemas 未纳入）。

截图：`.tmp/stage-count/before/1440-light.png`、`.tmp/stage-count/after/1440-light.png`（已上传任务附件）。

## 边界

- 证据来自隔离 Chrome 中的生产构建组件，不是 Tauri 原生窗口或安装版；用户看到的安装版需重新打包后才包含本修复。
- 未修改共享工作区产品代码，未触碰他人正在改的 TaskDetailDialog/taskboard-dialog.css，未重启现用服务、未推送、未安装发布。
- 提交仅进入待检查，归档由用户决定。

## 第二轮：退回意见处理（2026-09-20）

用户反馈：“第三个图片好像出现了滑条，这个滑条样式不要出现”——即 360 宽、125% 缩放、深色主题截图里切换条下方的横向滚动条。

- 原因：`.tb-stage-nav` 为保证窄窗口可横向滚动而使用 `overflow-x: auto`，宽度不足时浏览器绘制原生滚动条。
- 修改：滚动条不再显示（`scrollbar-width: none` 与 WebKit 伪元素隐藏），横向可达改由滚轮/触控板及键盘保证：
  切换阶段时只滚动该条本身把当前按钮带入可视区（不滚动页面）；≤720px 时按钮内边距收紧为 8px，字号与字重不变。
- 验证：浏览器脚本新增窄窗口断言——360 宽下条内内容溢出但滚动条厚度为 0、`scrollbar-width: none`；End/Home/ArrowLeft 后当前按钮均位于条内可视范围。
  80 组几何矩阵与 4 项键盘用例继续通过；组件 74 项、集成 53 项通过；完整 PowerShell `npm run verify` 退出 0（.tmp/arena-dispatch/stage2-verify.txt）。
- 截图：`.tmp/stage-count/after/360-dark.png`（无滚动条）、`360-dark-keyboard-end.png`（End 键后已归档在视区内）。
