# 阅读器视图快捷键、滚轮缩放与毛玻璃提示（Arena，2026-09-23）

任务 `2e96c3ee-6ac2-472b-95f0-9e5b80efa108`，需求版本 4，原任务参考截图附件 `c9796b6c-42f4-4427-b810-41222567883a`。独立分支 `fix/reader-shortcut-overlay-arena-084aaa`，工作树 `.worktrees/reader-shortcut-overlay-arena-084aaa`；基线本地 main `33b9bfd`，代码和回归提交 `15ecbaacb9a5`。先后**仅在独立分支**吸收 main `a8fab19`（`908ec6afd3a9`）、`8065f6b`（`97b1a53bdeb9`）及文档/状态提交 `44632a9`（`81ce84f`）；后一次双状态文件的冲突逐项合并，保留 main 的笔记动效状态与本任务状态，`test:agent-status` 通过。**尚未合并回 main、尚未向任务板提交 review**；用户已授权保留全部未跟踪文件前提下尝试普通非强制合并，临合并还需重新检查，遇文件风险停止。

## 改动范围

- 原文、译文、对照按钮复用现有 `readerFileMode` 状态，分别提供 `Ctrl+F1/F2/F3`，在不可用的 PDF 形态下禁止切换；按住 Ctrl 时显示三项提示，按钮 tooltip/`aria-keyshortcuts` 同步更新。不占用已用于场景切换的 `Ctrl+1/2/3`。
- 缩放默认键盘快捷键及旧重置快捷键不再作为命令注册；滚轮提示作为不可录制的固定手势显示 `Ctrl+鼠标滚轮向上/下`，历史保存的 PDF/界面缩放键位也不能恢复旧键。PDF 视图内保留 `PdfReader` 的原生滚轮锚定、延时提交及防重复缩放；阅读 PDF 场景其他区域触发 PDF 缩放，其他场景触发界面缩放。可见模态/快捷键录制保护与隐藏对话框区分、输入框不中断正常交互。`Ctrl+0` 的 PDF「适合宽度」为独立操作，未移除。
- 快捷键提示只隐藏冗余的当前场景/已打开阅读入口行，不改变派发行为。键帽以半透明高对比背板和 8px 模糊隔离底层文字；右侧浮动操作行加 94% surface、12px 毛玻璃和局部边框阴影；禁用行只降低前景对比，不再让整行 opacity 变低、导致 PDF 字透过背板。必要时优先放置宽键帽以维持高缩放布局的浮层避让；不在全屏铺设遮罩。

## 已执行验证

- `npm run test:shortcuts`：core 52、dispatcher 62、layout 36、settings 22 全通过；包括已保存旧缩放键位不起效、不可用视图不切换。
- `npm run test:shortcuts-browser`：491 项通过，含 2 主题 × 2 视口 × 4 UI 缩放 × 2 键位变体的实际浏览器 DOM/避让矩阵、禁用浮动行毛玻璃背板、滚轮分流与模态保护；该夹具不是原生桌面验收。
- 原实现代码的完整 `npm run verify` 已退出 0，日志 `.tmp/arena-reader-shortcuts-final-verify.log` 尾部 `VERIFY_EXIT=0`。合入 main `a8fab19` 的独立分支 `908ec6afd3a9` **再次完整运行** `npm run verify`，日志 `.tmp/arena-reader-shortcuts-integrated-verify.log` 尾部 `A4Note verification passed` / `INTEGRATED_VERIFY_EXIT=0`（含 build、Rust 215 passed / 0 failed / 5 ignored）；额外 `test:reader-note-markdown` 13 项及真实浏览器 `verify-reader-note-markdown-browser.mjs` 编辑坞/引用检查均通过。交接文档更新后单独复跑 `test:agent-status`；这些是隔离分支的组合验证，不冒充尚未合并的 main 验证。
- 独立原生 `npm run dev:live -- --instance reader-shortcuts --port 1427 --cdp-port 9237`，底部 `DEV reader-shortcuts · 独立测试库（原生已核验 …）` 状态条。只向该隔离库导入合成原文/译文 PDF，不复制或读取正式资料库；通过 WebView2 CDP 真实键盘/鼠标验收三视图、无译文时禁用、Ctrl+滚轮 PDF 由 130%→144%、浮动行 computed backdrop `blur(12px)` 且 94% 背板/禁用行 97% 背板。最终运行 `pageerror=[]`、`console.error=[]`；取证日志 `.tmp/shots/reader-shortcuts/native-visual.log`。
- 分支吸收新 main 后复用同一隔离身份重新启动原生 WebView2，脚本输出改放 `.tmp/shots/reader-shortcuts-integrated/`，不覆盖已上传的初版证据。真实快捷键三视图、禁用条件、Ctrl+滚轮 144%→159%、浮动层 `blur(12px)` 和禁用行 97% 背板重新通过；`.tmp/shots/reader-shortcuts-integrated/native-visual.log` 最终 `errors:[]`，截图 `05-native-parallel-ctrl-hints.png` 已目视检查，后台实例已正常停止且 `productionLibraryCopied:false`。
- 初次探索脚本在前端库初始化完成前写入隔离测试库，曾得到一次 `database is locked` 控制台错误；后续改为等待应用就绪、确认隔离库，再复跑原生交互和截图，最终无控制台错误。未把有错误的探索运行作为交付证据。

- 吸收 main `8065f6b` 后复跑 `npm run test:shortcuts-browser`：491 checks，通过；完整 `npm run verify` 退出 0，日志 `.tmp/arena-reader-shortcuts-main806-verify.log` 尾部 `MAIN806_VERIFY_EXIT=0`，含笔记动效浏览器 47/47 和 Rust 215 passed / 5 ignored。后续 main `44632a9` 只含文档/状态变化，未引入产品代码；分支对状态文件完成双侧保留与状态测试。
- 最新组合在隔离 Tauri/WebView2 `reader-shortcuts` 实例复测：底部独立测试库状态条已核验；三模式快捷键、禁用边界、Ctrl+滚轮 PDF 缩放 159%→176%、浮动背板 94%/`blur(12px)`、禁用行背板 97% 全通过，`pageerror=[]`、`console.error=[]`。`.tmp/shots/reader-shortcuts-main446/native-visual.log` 和同目录 7 张截图为分支内本次证据；后台实例已停止、锁已移除，`productionLibraryCopied:false`。原先上传的 6 张任务板截图保留，未用本次复测覆盖。

## 截图及边界

原生截图位于本分支工作树的 `.tmp/shots/reader-shortcuts/`，未提交仓库；已按 `--purpose result` 上传任务卡（修订 9→14）：`03-native-source-ctrl-hints.png` 原文及 Ctrl 提示（附件 `4e9d3bd4-a0d4-436e-8918-494ad05821b0`）、`04-native-translated.png` 译文（`bf916846-cce5-4804-93aa-40f13d5bc88d`）、`05-native-parallel-ctrl-hints.png` 对照及禁用背板（`58da5360-22db-4e71-8f74-233915649ccc`）、`07-native-pdf-wheel-zoom.png` 130%→144% 滚轮缩放（`a5fcdde7-b557-432d-9fc6-7812f34c3c65`）、`08-native-guide-disabled-translation.png` 无译文禁用边界（`e1282d17-f1f8-49d6-a7d4-fd0a9a393555`）。全部 1600×1025 并保留底部隔离 DEV 状态条；这些属于开发者交付证据，**不等于独立验收**。

合入新 main 后另上传 `09-main-a8fab19-parallel-ctrl-hints.png`（来自 `.tmp/shots/reader-shortcuts-integrated/`，任务卡附件 `1ee284ab-c9d2-4fec-bb98-ebce2c692821`，修订 16），证明当前集成分支的对照 PDF、右侧快捷键毛玻璃与完整 DEV 状态条；它仍仅是开发者结果截图。原 5 张附件未更改。

后续：用户已授权在**逐一保留且不覆盖** main 中所有未跟踪文件的前提下尝试普通非强制合并。临写入前重新核对 main 与任务版本、已跟踪状态、全部未跟踪文件的路径/大小/哈希及待合并路径冲突；任何冲突或文件风险立即停止。仅在安全时合并到 main，前后核对清单、在 main 上复验并提交结构化 delivery 进入 review。在这之前不把分支验证当作 main 已交付；未打包、安装、推送或发布。
