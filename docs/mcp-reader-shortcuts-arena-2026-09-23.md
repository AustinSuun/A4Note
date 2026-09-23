# 阅读器视图快捷键、滚轮缩放与毛玻璃提示（Arena，2026-09-23）

任务 `2e96c3ee-6ac2-472b-95f0-9e5b80efa108`，需求版本 4，原任务参考截图附件 `c9796b6c-42f4-4427-b810-41222567883a`。独立分支 `fix/reader-shortcut-overlay-arena-084aaa`，工作树 `.worktrees/reader-shortcut-overlay-arena-084aaa`；基线本地 main `33b9bfd`，代码和回归提交 `15ecbaacb9a5`。**尚未合并 main、尚未向任务板提交 review**：main 已前进到 `a8fab19` 且存在 18 项其他人的未跟踪文件，按 `AGENTS.md` 的脏 main 规则不清理、不覆盖、不强行合并。新 main 的已跟踪变动与本任务代码文件无重叠；它们的组合尚未做合并后验证，不能把本分支验证冒充集成后验证。

## 改动范围

- 原文、译文、对照按钮复用现有 `readerFileMode` 状态，分别提供 `Ctrl+F1/F2/F3`，在不可用的 PDF 形态下禁止切换；按住 Ctrl 时显示三项提示，按钮 tooltip/`aria-keyshortcuts` 同步更新。不占用已用于场景切换的 `Ctrl+1/2/3`。
- 缩放默认键盘快捷键及旧重置快捷键不再作为命令注册；滚轮提示作为不可录制的固定手势显示 `Ctrl+鼠标滚轮向上/下`，历史保存的 PDF/界面缩放键位也不能恢复旧键。PDF 视图内保留 `PdfReader` 的原生滚轮锚定、延时提交及防重复缩放；阅读 PDF 场景其他区域触发 PDF 缩放，其他场景触发界面缩放。可见模态/快捷键录制保护与隐藏对话框区分、输入框不中断正常交互。`Ctrl+0` 的 PDF「适合宽度」为独立操作，未移除。
- 快捷键提示只隐藏冗余的当前场景/已打开阅读入口行，不改变派发行为。键帽以半透明高对比背板和 8px 模糊隔离底层文字；右侧浮动操作行加 94% surface、12px 毛玻璃和局部边框阴影；禁用行只降低前景对比，不再让整行 opacity 变低、导致 PDF 字透过背板。必要时优先放置宽键帽以维持高缩放布局的浮层避让；不在全屏铺设遮罩。

## 已执行验证

- `npm run test:shortcuts`：core 52、dispatcher 62、layout 36、settings 22 全通过；包括已保存旧缩放键位不起效、不可用视图不切换。
- `npm run test:shortcuts-browser`：491 项通过，含 2 主题 × 2 视口 × 4 UI 缩放 × 2 键位变体的实际浏览器 DOM/避让矩阵、禁用浮动行毛玻璃背板、滚轮分流与模态保护；该夹具不是原生桌面验收。
- 最终代码的完整 `npm run verify` 已在同代码的分支提交前退出 0，日志 `.tmp/arena-reader-shortcuts-final-verify.log` 尾部 `A4Note verification passed` / `VERIFY_EXIT=0`（Rust 215 passed、0 failed、5 ignored；build 与 verify-all 各步均通过）。只更新交接状态文档后另外复跑 `test:agent-status`，不把验证结论外推到未合并的新 main。
- 独立原生 `npm run dev:live -- --instance reader-shortcuts --port 1427 --cdp-port 9237`，底部 `DEV reader-shortcuts · 独立测试库（原生已核验 …）` 状态条。只向该隔离库导入合成原文/译文 PDF，不复制或读取正式资料库；通过 WebView2 CDP 真实键盘/鼠标验收三视图、无译文时禁用、Ctrl+滚轮 PDF 由 130%→144%、浮动行 computed backdrop `blur(12px)` 且 94% 背板/禁用行 97% 背板。最终运行 `pageerror=[]`、`console.error=[]`；取证日志 `.tmp/shots/reader-shortcuts/native-visual.log`。
- 初次探索脚本在前端库初始化完成前写入隔离测试库，曾得到一次 `database is locked` 控制台错误；后续改为等待应用就绪、确认隔离库，再复跑原生交互和截图，最终无控制台错误。未把有错误的探索运行作为交付证据。

## 截图及边界

原生截图位于本分支工作树的 `.tmp/shots/reader-shortcuts/`，未提交仓库；已按 `--purpose result` 上传任务卡（修订 9→14）：`03-native-source-ctrl-hints.png` 原文及 Ctrl 提示（附件 `4e9d3bd4-a0d4-436e-8918-494ad05821b0`）、`04-native-translated.png` 译文（`bf916846-cce5-4804-93aa-40f13d5bc88d`）、`05-native-parallel-ctrl-hints.png` 对照及禁用背板（`58da5360-22db-4e71-8f74-233915649ccc`）、`07-native-pdf-wheel-zoom.png` 130%→144% 滚轮缩放（`a5fcdde7-b557-432d-9fc6-7812f34c3c65`）、`08-native-guide-disabled-translation.png` 无译文禁用边界（`e1282d17-f1f8-49d6-a7d4-fd0a9a393555`）。全部 1600×1025 并保留底部隔离 DEV 状态条；这些属于开发者交付证据，**不等于独立验收**。

后续：更新双状态文件及执行 `test:agent-status`，将交接文档单独提交到本任务分支。待用户/文件所有者妥善处理 main 的未跟踪文件后，再重新核对 main 与任务版本，安全合并本分支、复测最新 main 组合、检查合并包含关系并提交结构化 delivery 进入 review；在此之前任务保持 `in_progress`。未打包、安装、推送或发布。
