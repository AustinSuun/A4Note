# 阅读器笔记动效：中途反向连续性（巡川）

任务 `bc5308c6-a902-4701-af6a-fcaf3a56392e`，基线本地 `main` `42184f1`。只修正已存在的笔记 presence 动效中断路径；侧栏轨道、悬窗变换、时长和曲线、正文及 PDF 布局实现均保持原样。不涉及悬窗拖拽顶栏或三形态默认编辑任务。

## 可复现缺陷与修正

- 隔离 Windows Tauri/WebView2 `dev:live --instance readermotion --port 1439 --cdp-port 9246`，独立 DEV 身份条核验后，使用**另一个隔离 DEV 测试库**中的有效 PDF 夹具；未复制正式资料库。
- 基线在分屏笔记退出约 80 ms 时反向点击：PDF 可用宽度 `954.35 → 1368 → 910 px`，笔记边界同步瞬跳约 `414 px`。悬窗退出时透明度 `0.917 → 0.357`（下一帧突然变淡），后又回到不透明。
- 原因是 presence 处于 `exiting` 时重走 `entering`：其首帧规则禁用 transition 并重置到隐藏姿态。现在 `exiting` 收到显示请求直接转 `entered`，使现有 CSS transition 从**当前画面**反向；新开、形态切换、退场计时器和 reduced-motion 分支不变。
- 同条件修正后：PDF `954.06 → 954.06 → 910 px`，悬窗透明度 `0.917 → 1`；两个原生运行均无 pageerror/console.error。这个数据来自同一 WebView 事件循环中逐帧几何采样，避免 CDP 截图耗时跨过 220 ms 退场窗口。`before` 和 `after` 各自的 `split-000/040/080/120/160/220.png` 是可复核的侧栏原生进场帧；`comparison.png` 标记采样值及截图，`report.json` 保存完整状态、帧间隔、窄窗和 UI 缩放证据。截图保留原生 DEV 身份条；证据存于 `.tmp/shots/reader-note-motion-native/{before,after}/` 并作为任务结果附件上传，不把截图提交到源码。

## 验证范围与限制

- 既有 69 项动效浏览器回归加分屏/浮卡中断反向、80 行未保存草稿与编辑器 DOM 保留、PDF 滚动 420、空笔记，共 73/73；最终版本连续三次通过。其他已覆盖：分屏拖宽、悬窗四角拖/键盘缩放、形态切换 FLIP、窄窗回退、reduced-motion；真实隔离原生另留 980 窄窗与 UI zoom 125% 截图。
- `test:note-workbench` 85/85、`test:note-workbench-browser` 117/117、`test:reader-note-sidebar` 16/16、`test:reader-note-sidebar-browser` passed、`test:reader` passed、`npm run build`（TS + Vite）通过；`git diff --check` 通过。构建有既有的大 chunk 和动态导入提示，非本轮错误。合入主线后 `test:agent-status`、架构检查与 build 均复跑通过。
- WebView2 记录的退出启动首个 requestAnimationFrame 等待在改前约 122–123 ms、改后约 170 ms；其后样本约 3–17 ms。该首帧耗时含原生 PDF/React 工作与采样调度，不可由此声称所有帧均 60fps、亦不能声称解决了该旧有首帧开销；本次仅证明中断反向不再额外瞬跳或闪烁。若用户继续感到首帧卡顿，应单列性能剖析，不在拖拽/顶栏任务中混改。
- 首次在 main 整合复跑曾命中 Chrome Windows 创建 DevToolsActivePort 后尚未解除写锁的 `EBUSY`；浏览器启动等待现同时检查文件可读取（仅 EBUSY/ENOENT 短重试，不吞其他错误），随后重跑。
- 浏览器脚本原以 5 帧、随后 2 帧的墙钟时间等待退出；在负载高的 main 整合复跑中，原有的 10 帧收起检查及新增反向检查都曾超过 220 ms 卸载计时，已经进入 `hidden` 而误报失败。现对真实 CSSTransition 在同一渲染器任务内暂停并定点采样 0–200 ms，再于 80 ms 的已绘制中间姿态反向，保留实际 DOM/React 事件与完整功能断言；原失败日志保留。修订后在分支与合入主线连续复跑，结果以最终日志为准。
- 未操作正式库、安装、打包、推送或发布；本报告是开发者验证，不是用户验收。已合入干净本地 main `26e9421` 并 submit review revision 16，由用户决定是否归档；完整 verify 未运行。
