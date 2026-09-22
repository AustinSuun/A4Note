# 快捷键提示第三版：键帽、功能名与分组排列

- 日期：2026-09-22；执行者：星序。
- 任务：`9230f8ce-beef-4157-8771-014c4aee48c4`，spec3。
- 分支：`feat/context-shortcuts-xingxu`；基线：`41c51feb4eeafb667e6ff261c993361a3989b22e`。
- 实现：`07286bd57e97788972bc8c2de96e20cab03ce93c`；后续仅交付文档/双状态记录。

## 反馈与实现

保留用户认可的第二版透明悬浮，不恢复面板背景、列表外框或标题。

1. 按结构化绑定分别渲染 Ctrl / Alt / Shift / 主键的小键帽，轻边框、底边和轻阴影；Plus 主键不会被按“+”分割丢失，物理 code 和鼠标侧键可正确显示。
2. 贴近可见按钮的提示仅显示按键，不重复功能名。按钮不在当前视口或未渲染时，浮动提示在按键右侧显示注册命令名称；按钮重新可见会恢复为无重复名称的贴邻提示。
3. 浮动行统一键位列宽、左边缘及行距，用组间留白代替容器；同组放大/缩小/重置等命令整体换列。极窄自定义注册表无法整组放入时才逐项回退，且不回填标题栏。
4. 底部工具坞优先在上方排成错层，顶部控件向下排；侧栏大导航块仍按图标定位并保护真实文字，不恢复大矩形空白障碍。
5. 用不可见测量行取得键帽与完整功能名两种尺寸，碰撞包含功能名；避免状态切换导致测量自反馈。保留逆 UI zoom、resize/scroll/DOM/focus 重测、Ctrl150ms显示及松开清理、reduced-motion、disabled状态和点击穿透。

仅修改共享提示组件、布局、样式、纯展示键帽函数及测试。默认绑定、用户覆盖、分发器、录制器、快捷键注册逻辑及 PDF 标注业务均未修改；主线最新文本层偏移与标注拖动修复保留。复制/粘贴是用户举的功能名示例，本轮不新增剪贴板拦截，也不虚构未注册命令。

## 最终验证

| 验证 | 结果 |
| --- | --- |
| `npm run verify` | 退出0，111.990秒；cmd_cf83d18d628a59970266b989683bb7e7086c8483a40f6a7b；Rust215通过/0失败/5忽略，既有23警告 |
| core / dispatcher / hint layout | 52 / 50 / 27通过；含Plus、physical-code、鼠标键、标签碰撞、同组换列、侧栏贴邻 |
| 浏览器组件回归 | 99通过；键帽、名称条件、尺寸矩阵、控件重排/隐藏/恢复、编辑/IME/录制/冲突与清理 |
| 真实旧版回放 | 加载真实spec2 `d6d70d8` 的组件/CSS/布局，在“spec3: real keycaps instead of plain text”预期失败；非伪造旧版 |
| 隔离Windows/Tauri交互 | 35通过；绑定、冲突取消/替换、侧鼠标录制/执行、PDF/UI缩放、编辑保护、新键帽/标签 |
| 隔离原生布局 | 41通过；4状态的边界、可见性、无背景、无重叠/遮控件、贴邻、右侧名称、键帽、松开清理 |
| 正常关闭→新进程重启 | 4通过；自定义CtrlJ持久化、执行、ARIA与无错误 |
| 同一原生场景按住/松开 | 4通过；两个连续截图及正常关闭 |
| 编辑器诊断 | shortcuts目录0错误/警告 |

最终原生交互/布局 cmd_70bf0149f1ca5f1d0fc88c899b8f7a9e3bf414aae55ef5e1；重启/按住松开 cmd_0cc5a9da78a1d509c887d6c3f6471f8f065ca74b378a3762。实际逐张检查默认绑定、侧栏和800×600/UI140%截图后，增加整组换列以避免重置缩放孤立在另一列。

### 原生身份、证据与边界

- `dev:live --instance shortcuts-xingxu --port 1467 --cdp-port 9267`；原生已核验身份 `app.aster.research.dev.shortcuts-xingxu.w80719577ef`，独立profile/AsterData，仅自制PDF夹具，不复制生产资料。
- 最终正常关闭前会话 startedAt `2026-09-22T06:15:17.747Z`，重启后 `2026-09-22T06:16:12.010Z`；会话记录保留。两次最终launcher均正常退出0（53.684秒、45.945秒）。
- 中间一次开发实例退出1，随后连接CDP报ECONNREFUSED；该轮失败日志未当作通过结果。重新启动在最终固定源码上重跑35+41+4+4全部通过，正常关闭/重启两轮均退出0；未据退出码臆测外部关闭原因。
- 原生1280×820/DPR1.25/UI100%；800×600与UI140%是同一真实WebView的CDP视口覆盖及真实UI快捷键，不是OS窗口拖拽或硬件DPI全矩阵。窄窗口高UI缩放下原有主工具栏仍可能被主布局裁切，隐藏按钮的提示会带功能名浮动，本轮不重做主布局。
- 鼠标侧键是CDP注入真实WebView，并非实体驱动全覆盖；未做macOS/Linux和屏幕阅读器人工验收。
- 极小视口/异常大量插件命令可能无法全部放入；不为此覆盖控件。功能不可用保持变淡，第一有效绑定之外的别名仍在tooltip、ARIA与设置中。

`.tmp/shots/shortcut-hints-spec3/`：

- `02-reader-ctrl-hints.png` 默认CtrlH/CtrlU等；`09-sidebar-hints.png`侧栏（录制回归后CtrlJ、下划线已解除冲突绑定）。
- `10-narrow-native-hints.png`、`11-narrow-ui140-native-hints.png` 原生窄视口压测。
- `06-after-native-restart.png`重启保留；`12-current-ctrl-on.png` / `13-current-ctrl-off.png`连续按住/松开。
- `native-result.json`、`native-geometry.json`、`layout-result.json`、`restart-result.json`、`final-pair-result.json`及重启前后会话。

最终日志 `.tmp/shortcuts/spec3-{verify-final,browser,native-final,native-layout-final,restart-final,final-pair}.log`。任务上传附件使用`spec3-`前缀，spec1/spec2留作历史。

## 本地main整合与交付

本地main已从`41c51fe`快进至`93a95450c55bdd4468a33fbb0f1ac0715060c6f9`，cmd_ba241a9748d65fcbf401edd6f4cef7e6720f840ce7106d46退出0/8.200秒。主树重跑agent-status、core52/dispatcher50/layout27、Reader rendering、UI-state、Reader helpers通过；源码与已验证`07286bd`零差异、包含关系通过、已跟踪文件干净。主树Reader helpers打印了可选@napi-rs/canvas缺失及DOMMatrix/Path2D polyfill警告，断言通过；不将其说成全平台渲染验证。随后仅本文和双状态更新记录的提交为最终delivery，准确SHA以任务卡为准。保持其他代理状态与无关未跟踪PDF/截图不变。任务提交后由用户验收，不自行归档；本轮不推送、打包、安装或发布。
