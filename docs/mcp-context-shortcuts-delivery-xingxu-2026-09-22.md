# 上下文快捷键实现与交付验证

更新时间：2026-09-22T09:48:23+08:00。任务 `9230f8ce-beef-4157-8771-014c4aee48c4`，执行者星序，spec 1。

## 代码与范围

- 工作分支 `feat/context-shortcuts-xingxu`；实现提交 `fd35859`；同步最新 main 的验证提交 `b99f471372c74319683ea6b832c312e7d9413ea3`（含 main `59ca336`）。
- 本文记录代码与实际验证；最终本地 main 合并 SHA 和 delivery SHA 由任务卡 integration 只读包含关系核验记录，不以本文预先宣称合并。
- UI 无关核心位于 `src/core/shortcuts.ts`。共享 store/provider/dispatcher/hints/editor 位于 `src/shared/shortcuts/`；App 命令工厂位于 `src/ui/shortcuts/`。
- 只迁移工作台场景切换/命令面板及 Reader 试点。没有重构 Markdown 内部、Library 表格导航或 OS 全局热键；未接管其他 Reader/色板任务。
- 主树 Cargo.toml 经 Git diff 确认没有内容差异，仅 `git update-index --refresh` 刷新状态缓存；未改写主工作区文件字节。既有 PDF、截图和其他未跟踪文件保留。

## 用户入口与行为

1. 设置 → 快捷键：工作台/侧栏、命令面板及界面缩放；Reader 底部标注工具栏键盘图标：阅读器快捷键。两个入口复用同一个录制、冲突和重置实现。
2. 按住 Ctrl 150ms 显示当前有效绑定；松开、组合键、失焦、隐藏、输入法组合、场景变更和卸载清理提示。按钮旁显示不挡鼠标的 kbd，拥挤/无可见锚点的命令在右侧分组。禁用项灰显；尊重 reduced-motion。
3. 稳定 command id + global/workbench/scene。场景优先级显式；互斥场景可复用绑定；保存前显示冲突并要求替换或取消。
4. `a4note.shortcuts.v1` / schemaVersion 1 保存覆盖，新命令继承默认，已删命令忽略，损坏数据回退；写入失败保留原配置。单项恢复删除覆盖，避免将旧默认冻结为永久自定义。
5. 逻辑 key 与物理 code 可选；录制期间暂停正常分发；Escape 取消，Delete/Backspace 清除。窗口失焦/隐藏取消录制。可录制鼠标 button 3/4，只有有效匹配被执行的手势才拦截后退/前进。
6. 输入框、textarea、select、contenteditable、CodeMirror、IME、AltGraph、模态和录制保护；仅明确允许的命令可在编辑器执行。对应旧 App/Reader 独立监听已移除。Reader 设置入口不放在会复制/卸载子树的紧凑工具栏弹层内。

## Windows 默认绑定

| 范围 | 功能 | 默认 |
|---|---|---|
| 工作台 | 可见场景切换 | Ctrl + 场景注册数字；默认可见总览1、文献库2、阅读3、笔记5；隐藏/停用项不注册 |
| 工作台 | 命令面板 | Ctrl+K / Ctrl+Shift+P |
| 工作台 | 导入 PDF / 阅读选中文献 | Ctrl+O / Ctrl+Enter |
| 非 Reader 工作台 | 文献库搜索 | Ctrl+F |
| Reader | 当前 PDF 搜索 | Ctrl+F，不跳文献库 |
| Reader | PDF 放大/缩小/适宽 | Ctrl+=（或 Ctrl+Shift++）/ Ctrl+- / Ctrl+0 |
| 全局 UI | 界面放大/缩小/重置 | Ctrl+Alt+=（或 Ctrl+Alt+Shift++）/ Ctrl+Alt+- / Ctrl+Alt+0 |
| Reader | 光标/高亮/下划线/区域/文本/画笔/橡皮/图形/箭头 | Ctrl+M/H/U/B/T/P/E/R/A |
| Reader | 撤销 / 重做标注 | Ctrl+Z / Ctrl+Y 或 Ctrl+Shift+Z |
| Reader | 删除 / 取消选中标注 | Delete 或 Backspace / Escape；须有选中项 |
| Reader 笔记 | 打开/收起 | Ctrl+Alt+N |
| Reader 笔记 | 悬浮速记 / 边读边记 | Ctrl+Alt+Q / Ctrl+Alt+2 |
| Reader 笔记 | 专注写作 | Ctrl+Alt+3 / Ctrl+Alt+Enter |
| Reader 笔记 | 悬浮速记卡 / PDF专注 | Ctrl+Alt+4 / Ctrl+Alt+P |
| 鼠标 | 侧键后退/前进 | 默认不绑定；按命令自行录制 |

## 实测与回归

在 `b99f471` 的集成代码上执行：

| 检查 | 实际结果 |
|---|---|
| PowerShell `npm run verify` | 退出0，99.839秒；含生产 build、Reader、UI-state、架构、Settings、插件/任务/数据等回归；Rust 215通过、0失败、5忽略 |
| `npm run test:shortcuts` | core52 + dispatcher50 |
| `node scripts/verify-reader-priority-fixes.mjs` | 62行为断言；保留原输入/IME/搜索覆盖，改为调用真实 dispatcher/命令工厂，不再抽取已删除旧函数 |
| `npm run test:shortcuts-browser` | 56；真实 Chrome/React StrictMode/DOM；物理键、侧键、替换/取消/清除/重置、ARIA、场景与编辑器保护、reload、六组布局 |
| Settings / 笔记工作台 | 116 / 51 |
| 隔离 Windows/Tauri 交互 | 25；搜索、工具、两种缩放、Ctrl提示、写作单次切换、冲突、重绑键盘/侧键、配置入口分区，console/page errors为空 |
| 正常关闭原生窗口后重新启动 | 4；绑定、实际执行、ARIA与无错误；Ctrl+J 保留 |
| src diagnostics | 0 errors / warnings；Rust编译仍有既有23条警告，并非声称所有编译器零警告 |

浏览器几何矩阵：800×600、1280×800，各应用缩放100%/125%/150%。真实绘制测量锚点不越界、不重叠，右侧内容不裁切。组件浏览器夹具与真实桌面证据分别保存，不相互冒充。

## 独立桌面与证据

- 启动：`npm run dev:live -- --instance shortcuts-xingxu --port 1467 --cdp-port 9267`。
- identity：`app.aster.research.dev.shortcuts-xingxu.w80719577ef`；原生路径及底部独立测试库条核验通过；独立 WebView profile。没有复制或操作生产资料库。
- 导入仅在该测试库内临时生成的 PDF，标题 `Shortcut isolated fixture`。测试文档是合成夹具，截图来自实际 Tauri 窗口，并非合成图。
- 原生 CSS viewport 1280×820、DPR1.25、UI100%。最新交互取证时间约2026-09-22 09:45；正常关闭后重启前 launcher PID7396（01:44:39.886Z），之后 PID39304（01:46:37.955Z），同一 profile。
- native证据在工作树 `.tmp/shots/shortcuts-native/`：`02-reader-ctrl-hints.png`、`03-native-conflict.png`、`04-native-reader-settings.png`、`05-native-workbench-settings.png`、`06-after-native-restart.png`；`native-result.json`、`restart-result.json`、前后session记录。
- browser证据：`.tmp/shots/shortcuts-browser/result.json` 与六组 `geometry-*` 图。
- 日志：`.tmp/shortcuts/verify-integrated.log`、`browser-integrated.log`、`native-integrated.log`、`final-restart-check.log`。截图和测试库不入 Git；任务结果附件选取真实原生关键状态。

## 限制与风险提示

- 鼠标侧键通过 CDP 向真实 WebView 注入 back/button3 验证了录制与执行；纯逻辑另覆盖 button4/未绑定不拦截。**未做实体鼠标/驱动硬件矩阵**，驱动未暴露侧键时无法保证捕获，映射键盘时按键盘录制。
- Meta、Alt+Tab/F4/Escape、Ctrl+Alt+Delete 等可能属于系统/辅助技术；F5/F11/F12、Ctrl+R/W/L/T/N 等可能属于浏览器/WebView。录制器提示风险，但应用无法接收到的组合不可能保证覆盖。IME/AltGraph不会被拿来强制录制。
- 物理 code 与逻辑字符跨布局的冲突采用保守提示，可能要求确认更多候选命令；更换键盘布局后应复核配置。
- Windows为本次实测平台；没有声称macOS/Linux或屏幕阅读器人工验收。测试忽略项与既有构建警告保留，不将通过单元测试等同独立验收。
- 本次不更新先前0.1.27安装包，不安装、不推送、不发布；用户验收后如需新版EXE需另行授权打包。
