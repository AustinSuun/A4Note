# Ctrl 透明悬浮提示返工（spec 2）

更新时间：2026-09-22T10:36:25+08:00。任务 `9230f8ce-beef-4157-8771-014c4aee48c4`，执行者星序。

## 用户反馈与实现

用户退回上轮列表框方案，要求：可见按钮的快捷键在按钮旁浮现；没有可见按钮的命令以透明背景悬浮，只显示快捷键，按住 Ctrl 时出现。

- 移除原右侧列表框、标题、分组标题和命令描述。不再绘制卡片底色、边框或阴影框；提示只有 `kbd` 文字，文字轻微描边式阴影用于复杂 PDF 背景的可读性。
- 有可见控件时靠近该控件：不再为右侧列表预留410px，PDF缩放/适宽也就近显示。密集工具栏可错行但不盖图标；原先 `button.bottom - 30` 导致图标被遮住，现从上边界计算上方位置。
- 大型场景导航按钮以图标为锚点、实际图标及标签文字为避让区域，可使用按钮内部留白，避免整个大点击区域把提示挤到数行之外。不缩小点击区域，不改侧栏业务。
- 没有可见按钮的命令使用视口内自由位置的透明文字；空间不足自动换列。没有新的弹窗或列表容器，不抢焦点、不阻挡点击；不可用命令灰显。未绑定命令没有可触发组合，因此不显示“未绑定”文字。
- 提示显示**第一条当前有效绑定**以控制密度；全部别名仍在原控件 tooltip、aria-keyshortcuts 和快捷键设置中。默认绑定、用户覆盖、Escape/Delete语义、存储格式、录制和分发器都未改变。
- 按Ctrl150ms出现、松开140ms渐隐、减少动画偏好、失焦/隐藏/组合键清理沿用已有实现。DOM增删/可见性、滚动、resize、焦点及过渡结束时重测；卸载和隐藏时断开observer/listener与待处理animation frame。

## 代码与集成边界

- `88c64dc`：初版透明文字、测量与布局。
- `58c30d0`：同步 main `29341cc1b9905fa0a495f9a2ae5728c0ab993ec9`，保留已合入的橡皮擦及色板任务。
- `bd77244`：整合色板新CSS后，完整verify发现旧UI-state静态断言仍要求旧grid；仅更新为已合入的flex列/heading/共享row契约，未修改色板业务。
- `75c20c8f09e89b13e2c8244e021af0e43d1bf498`：最终业务源码，侧栏大按钮按内容锚定。交付文档提交不改变该源码。最终交付SHA及main包含关系见任务卡delivery审计记录。
- 产品改动仅共享 `ShortcutHints.tsx`、`shortcuts.css`、纯布局 `hintLayout.ts`。没有修改App、ReaderToolbar、PDF坐标、橡皮擦或色板文件；不是覆盖其他Agent的方案。

## 验证（真实执行）

| 检查 | 结果 |
|---|---|
| 最终PowerShell `npm run verify` | 退出0，94.385秒，包含build/架构/Reader/UI-state/Settings/数据/插件等；Rust215通过、0失败、5忽略 |
| `npm run test:shortcuts` | 核心52、dispatcher50、布局18通过；布局覆盖360/800/1280宽度、密集工具、右侧zoom、侧栏图标距离、DEV条避让 |
| `npm run test:shortcuts-browser` | 83通过，React StrictMode真实DOM/Chrome；6组800×600/1280×800 × UI100/125/150%，透明/不遮挡/重测/录制回归 |
| `node scripts/verify-shortcuts-browser.mjs --baseline-hints` | 加载c0470d0的原提示组件+原CSS，在“spec2: boxed command list removed”断言上失败（1≠0）；未改主树回放旧代码 |
| 隔离Windows/Tauri交互 | 33通过；含原录制/侧键/冲突/缩放等25项加8项新提示断言 |
| 隔离Windows/Tauri提示布局 | 33通过；4个实际WebView状态，每态透明、边界、重叠、控件邻近、松开隐藏等8项，加console/page errors为空 |
| 正常关闭窗口后重启 | 4通过；自定义CtrlJ、实际执行、ARIA、无错误 |
| 同一原生场景按住/松开连续截图 | 4通过；截图12/13，确认显示、透明度归零、隔离身份、无错误 |
| 快捷键源码diagnostics | 0 errors / warnings |

原生大视口1280×820、DPR1.25、UI100%。另两态是同一真实WebView通过**CDP视口覆盖**压到800×600、DPR1.25、UI100%/140%，不是操作系统窗口拖拽或实体显示器DPI矩阵。UI140%由实际快捷键调整。既有顶部工具栏在极窄高UI缩放下仍可能被主布局裁切，本轮保证可见控件的提示就近及其他有效键不越界，未重做主布局。

重启前launcher PID32316、startedAt2026-09-22T02:28:45.921Z；重启后PID27608、startedAt2026-09-22T02:33:34.969Z。同一隔离profile，正常窗口关闭，不终止其他进程。

## 原生证据

实例 `shortcuts-xingxu`，identity `app.aster.research.dev.shortcuts-xingxu.w80719577ef`；使用独立WebView/profile及已核验独立AsterData，只使用自行生成的PDF夹具，未复制生产资料库。

工作树目录 `.tmp/shots/shortcut-hints-spec2/`：

- `02-reader-ctrl-hints.png`：默认绑定透明提示。
- `09-sidebar-hints.png`：侧栏图标就近提示，测试配置高亮为CtrlJ。
- `10-narrow-native-hints.png`、`11-narrow-ui140-native-hints.png`：真实WebView窄视口及UI缩放压测。
- `06-after-native-restart.png`：正常重启配置保留。
- `12-current-ctrl-on.png`、`13-current-ctrl-off.png`：同一场景Ctrl按住/松开连续状态。
- `native-result.json`、`native-geometry.json`、`layout-result.json`、`restart-result.json`、`final-pair-result.json`及重启前后session记录。

日志 `.tmp/shortcuts/spec2-verify-delivery.log`、`spec2-browser-integrated.log`、`spec2-native-final.log`、`spec2-native-layout.log`、`spec2-restart-final.log`、`spec2-final-pair.log`。浏览器夹具与原生证据分开，不冒充桌面验收。截图作为spec2结果附件；spec1旧截图留作历史，不代表本轮效果。

## 限制与后续

- 默认绑定表和保留组合/侧键驱动限制仍见 `mcp-context-shortcuts-delivery-xingxu-2026-09-22.md`；本轮没有改变键位。第一有效绑定以外的别名去设置或tooltip查看。
- 鼠标侧键以CDP事件验证真实WebView，不代表实体鼠标驱动全覆盖；未做macOS/Linux、屏幕阅读器人工验收。Rust既有23条编译警告与5个忽略测试未掩盖。
- 由用户检查实际透明浮现效果并决定验收，不自行归档。本次不推送、打包、安装或发布；先前EXE不会自动包含本轮。

## 本地main整合核验

`29341cc` → `e28158440e629c12772052a490ed021989656998` 已完成快进合并；main重跑agent-status、core52、dispatcher50、布局18、Reader优先级62、UI-state、Reader rendering全部通过。`git diff 75c20c8 HEAD -- src scripts package.json`零差异；`git merge-base --is-ancestor e281584 main`通过，主树已跟踪文件干净。后续仅本段和双状态文档记录提交，实际最终delivery SHA由任务卡记录。既有未跟踪PDF/截图保持原状。隔离窗口已正常关闭，自己的dev:live launcher退出0。
