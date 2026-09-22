# 快捷键提示 spec4：按钮旁省略 Ctrl 与遮挡复核

- 任务 `9230f8ce-beef-4157-8771-014c4aee48c4`；执行者星序；2026-09-22。
- 实现 `98bb2385fde5974212a869b2b2543c5fe1b0d0c8`；已整合 main `c22a5e0713b6d6caefad045415aa85bcaba116c5`，合并提交 `e905ec937ffd559cc017f36ee2771b0f25eb0e48`。
- 最终经验证的代码/脚本 `0bacf9616b44b8090b068f36ca38891287ba5b7e`；后续为交付文档。最终 main 包含关系、delivery SHA 和任务提交状态见任务卡交付记录。

## 用户反馈与实现

用户要求有按钮的快捷键不再显示 Ctrl，只显示需要的按键，并检查提示位置是否被遮挡或遮挡其他按键。

1. 按钮旁渲染剩余键帽：Ctrl+H → H、Ctrl+数字 → 数字；Ctrl+Alt+N → Alt+N，不丢失仍需按下的 Alt/Shift/Meta。
2. 无按钮或无法贴邻而改为浮动行时，仍显示完整组合和右侧真实功能名；保留透明背景，不恢复面板。
3. `hintKeycaps(binding, omitHeldControl = false)` 默认仍完整显示，设置编辑器/ARIA/tooltip 的绑定语义不变。实际键位、录制、冲突、分发器没有改变。
4. 紧凑键帽和浮动完整行分别测量，按最终 placement 渲染，避免用大尺寸挤走单键或小尺寸漏算完整行。
5. menu/listbox/tooltip/dialog/popover 及显式 obstacle 整体进入避让范围，不能只保护弹窗内的按钮而把键帽放在弹窗空白区；保留所有普通控件、侧栏图标/文字、DEV条与提示之间的碰撞保护。

保留最新主线的快捷键设置 UI 重构 `9c64b03` 和 PDF 查找按钮移除 `bb020ee`；搜索无按钮后自动成为完整 Ctrl+F +“搜索当前PDF”的浮动行。本任务不修改这些业务代码。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 完整 `npm run verify`（整合源码） | 退出0，175.121秒；cmd_3e0017f409f3bc1dfa70e3f4e32d53182203efca42e3b2c0；含新 PDF find-entry 验证 |
| core / dispatcher / hint layout / settings UI | 52 / 50 / 33 / 17 通过 |
| 浏览器组件回归 | 110通过；包含6种窗口/缩放组合、顶部绘制采样、尺寸/控件/提示碰撞、动态锚点转换和高层弹窗避让 |
| 真实旧版回放 | 加载 spec3 c056588 组件/CSS/布局/键帽，在 Ctrl+H ≠ H 的新断言上预期失败 |
| 整合后 Windows/Tauri 交互 | 40通过；包含实际设置改绑/冲突取消和替换/侧键、完整设置键位、按钮省略Ctrl，以及无搜索按钮时仍显示Ctrl+F |
| 原生布局矩阵 | 49通过；4场景状态，键帽顶部绘制、不重复Ctrl、不越界、不相互覆盖、不遮控件、名称条件、松开清理 |
| 原生高亮设置弹窗 | 14通过；整个弹窗及其控件未被键帽遮盖，提示重排后保持可见、无重叠 |
| 正常关闭重启 / Ctrl按住松开 | 4 / 4通过；自定义CtrlJ持久化，截图后正常关闭自有实例 |
| shortcuts源码诊断 | 0错误/警告 |

完整verify之后仅同步浏览器夹具，110项再次独立通过；没有改变已验证的产品源码。浏览器夹具更新新设置文案/ARIA定位，并在编辑阶段暂时隐藏夹具中同时渲染的固定工具坞，reload后再次隐藏，几何阶段恢复；真实原生模态设置未做此隐藏，40项仍以真实点击验证。夹具独立 Vite cacheDir，避免与实际开发入口共用预构建缓存。

## 中断与测试环境记录

- MCP连接中断后重建会话。恢复原生启动时发现本实例遗留owner锁；先用PID和命令行确认原owner34636已不存在、1467/9267均空闲，才把自己的锁归档。没有终止其他进程或清除共享服务。
- 右键不是高亮设置入口，最初弹窗脚本因此超时；已按真实交互改成激活高亮后再次左键点击，最终14项通过。
- 整合后一次原生reload白屏，记录 `Invalid or unexpected token`。CDP捕获到模块URL与响应正文不符（React runtime URL收到另一模块/不完整源映射片段）；仅清理独立测试WebView的HTTP缓存后恢复，未清理生产资料或快捷键数据。随后实际应用普通reload、40+49+14以及进程重启4、显隐4均重新通过。不据此假称已定位操作系统或生产环境根因。

## 原生证据

身份 `app.aster.research.dev.shortcuts-xingxu.w80719577ef`，独立profile与已核验AsterData；仅自制PDF夹具。最终证据目录 `.tmp/shots/shortcut-hints-spec4/`：

- `02-reader-ctrl-hints.png` 默认键位；`09-sidebar-hints.png` 侧栏与工具坞（录制测试后高亮CtrlJ，下划线冲突键已解除）。
- `11-narrow-ui140-native-hints.png` 窄视口；`14-popover-avoidance.png` 真正高亮设置弹窗避让。
- `06-after-native-restart.png` 自定义绑定重启保持；`12-current-ctrl-on.png` / `13-current-ctrl-off.png` 同场景连续状态。
- native/layout/popover/restart/final-pair JSON以及重启前后session记录。

日志：`.tmp/shortcuts/spec4-verify-integrated.log`、`spec4-browser-final.log`、`spec4-unit-integrated-final.log`、`spec4-native-delivery.log`、`spec4-native-layout-delivery.log`、`spec4-popover-delivery.log`、`spec4-restart-delivery.log`、`spec4-pair-delivery.log`。

1280×820/DPR1.25/UI100% 为实际原生视口；800×600/UI140%为真实WebView CDP视口覆盖加实际UI快捷键，不是OS拖窗或硬件DPI全矩阵。鼠标侧键也是CDP事件，非实体驱动全覆盖。保留既有23条Rust警告与5项忽略测试；不宣称人工屏幕阅读器或macOS/Linux验收。

## 交付边界

用户已授权必要时先备份、临时保存冲突文件、合并后恢复，不替并行任务提交UI改动。最初主线脏文件随后由其任务提交，因此第一次feature整合不需stash；如最终main整合遇到新并行修改，按同一授权保留并在任务交付记录给出结果。无关PDF、截图、其他代理源码及任务状态不覆盖。

本任务只交付共享提示/纯键帽展示与回归测试、双状态及本报告。待用户决定验收，不自行归档；不打包、安装、推送或发布。旧EXE不自动包含本轮。
