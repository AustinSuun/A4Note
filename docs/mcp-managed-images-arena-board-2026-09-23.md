# Markdown 图片本地托管：实现与验证

任务 `d3cdee12-3c10-4383-b94e-dda8bf829664`，spec 1；执行者 Arena-Board。
分支 `fix/markdown-managed-images-arena-board`。开发者验证不等于用户验收。

## 实现边界

- 阅读器普通笔记、指定总览笔记（显式字段和自由正文）、独立工作区 Markdown，共用 CodeMirror 图片粘贴/文件选择事务；实时与源码模式共用同一通路。纯文本仍交给原编辑器，混合文本随图片成功后一次提交。
- 绑定文档身份、编辑代次、选区和编辑器实例。异步期间切文档、移动选区、编辑/撤销或卸载使事务失效；批量全部成功才插入一次可撤销修改。显示保存中/失败提示，忙碌时拒绝重入，排除错误后重新粘贴/选择即可重试。
- `managed_image_io.rs` 共享后端校验与新建：PNG/JPEG/WebP、3MB、1600万像素、魔数/MIME 一致、完整有界解码；UUID 文件名、create_new、sync_all，部分写失败清除未发布文件，不覆盖旧文件。
- `markdown_images.rs` 的独立文件接口只接受持久化 folder workspace 根内的现有可写 Markdown；无路径、根外、只读、非普通文件和 symlink/reparse 拒绝。Windows 使用文件/祖先目录句柄固定路径，保留必要的读取权限，拒绝重解析目录。图片保存到 `<文件名>.assets/UUID.ext`，正文是可迁移的相对引用，可从文件树找到资源目录。
- 阅读器数据库笔记复用 `AsterData/files/papers/<paperId>/summary-assets/`，不假设数据库笔记有文件系统父目录。`paper-note://paperId/noteId` 只是内部解析上下文；保存正文仍用稳定的 `summary-assets/UUID.ext` 引用。编辑/阅读/表格均显式带 paperId，B 论文不能借同名文件读取 A 的图片。
- 原有安全 data:image、合法旧链接和 summary-assets 仍走既有读取兼容；不自动迁移、删除旧图，不增加任意 file://、脚本引用或通用文件写入权限。图片错误显示可识别的提示，正文仍可修复引用。
- 总览紧凑单元格按 Markdown AST 提取当前字段中的真图片节点，代码示例不是图片，自由正文不分配到任何字段。缩略图受当前 cell 高度/宽度约束，ResizeObserver 复测；object-fit 保留比例。复用 MarkdownFigure 放大查看和 Enter/Escape 焦点返回，操作不触发单元格编辑；缩略图角标绝对定位，避免挤出图片区域。

## 自动化证据

- 纯插入事务：52 项；真实 CodeMirror 浏览器测试：18 项、errors=[]。后者用模拟 IPC，覆盖剪贴板、选择器、混合/纯文本、并发/切换/选区/撤销及错误，不冒充原生写盘。
- Windows Rust：225 passed / 0 failed / 5 ignored。新增覆盖格式/MIME/字节和像素上限、损坏数据、授权工作区、只读、目录重解析、原子唯一文件、JPEG/WebP 及注入部分写失败后的清理。5 个 ignored 为套件中的既有忽略项，不计作通过。
- PowerShell 完整 `npm run verify` 两轮通过：`.tmp/image-full-verify-v2.log`（192.702秒），最终缩略图角标样式之后 `.tmp/image-full-verify-v3.log`（184.389秒）。包含 build、TypeScript、架构和 Rust。
- 首轮完整 verify 的 reader 静态源码契约与架构直接组件预期失败已修复：保持 sessionId 接线顺序，并验证 MarkdownReadContent→PaperNoteImage→MarkdownFigure 的显式 paperId 链；未降低架构行数限制或跳过测试。
- `src` diagnostics：0。构建仍有既有分块/混合导入与 Rust dead_code 警告，不宣称零警告。

## 隔离原生验证

只使用自己的 fixture，不复制生产资料库。实例 `arena-images`，1487/CDP9287；身份 `app.aster.research.dev.arena-images.w393dcc7ea8`。截图保留已核验 DEV 状态条，IPC 使用实际 Tauri 后端。

证据目录：`.tmp/shots/managed-images-native/`，执行脚本在本 worktree `.tmp/native-image-{seed,standalone,reader,restart,errors,layout}.mjs`。

| 记录 | 结果与覆盖 |
| --- | --- |
| standalone-result.json | 5项：真实 Windows Bitmap 剪贴板→Ctrl+V、相对引用与磁盘文件、阅读、键盘放大、WebView重载 |
| reader-result.json | 8项：普通笔记、指定总览字段/自由正文实际粘贴、与总览同源回读、论文隔离、表格仅字段图、键盘查看/焦点恢复 |
| restart-result.json | 7项：停止原本人的 launcher 并启动新的 a4note.exe 后，普通/总览正文逐字一致；表格/普通/总览/独立 MD 重开加载；放大与焦点恢复 |
| error-retry-result.json | 5项：真实文件只读拒绝且正文/磁盘/资源列表不变；恢复权限后源码模式真实粘贴重试；单步撤销；原生文件选择器同一落盘通路；撤销保存后原文逐字恢复 |
| layout-result.json | 3组受控几何压力检查：100%及50%总览缩放，原生按钮操作；角标定位、图片边界、比例保持和键盘查看 |

上述最终运行均 pageerror/console error=[]。首次 harness 失败（选择笔记默认阅读、模块导入、等待图片异步加载及显示名称）已修正后重跑；不将失败轮当通过。

“离线”证据的精确范围：原生 WebView 阻断所有非回环 HTTP，允许 Vite 回环及 *.localhost 原生 IPC；真实后端从磁盘重新读取，不是浏览器数据缓存截图。未物理断开操作系统网络，不声称完成整机空气隔离测试。

只读验证恢复 fixture 原权限；重试/选择器撤销产生的两张未引用测试资产故意保留，符合不擅自清理资源的策略。未制造真正磁盘满，部分写失败由 Rust 故障注入覆盖。

## 分工与已知限制

- 字段目录/稳定ID/重命名、自由内容归属操作、标记隐藏、常规单元格文本可用空间及侧栏竖线，属于后续总览任务 `7603aaaf…`；本任务不推断字段、不重写其文本截断策略。
- 主题压力检查只是临时修改 theme 属性，不是完整设置主题流程；现有总览深色背景/文字对比问题仍可见，不能据几何通过宣称深色视觉验收通过。
- 原生重开时发现缓存的隐藏 PDF 子层能拦截其他场景鼠标。本任务未修改这些布局/图层文件；测试通过“阅读”场景选择已打开论文，或先关闭自己的 PDF 标签再测独立 Markdown，未 force-click 或用 CSS 隐藏问题。此场景遮挡需另外跟踪，不属于图片资产正确性的证明。
- 安全/错误/竞态采用原生、Rust和浏览器分层证据；没有把所有组合都宣称为人工或原生截图验收。

## 合并、任务板与发布

实现与最终样式在独立 worktree 已验证。发现本地 main 已前进至 `0a43b66`（抓取 PDF 可读文件名与阅读器交付记录），须保留其改动，整合后复核再安全合并 main、上传 result 证据并 submit。最终交付/合并 SHA 以任务卡追加记录为准。

当前未打包、安装、推送或发布本任务。用户已授权队列完成后单独执行发布流程；标准命令 `npm run package:windows`，重新检查远端版本/tag/签名，保留并归档 latest，不覆盖已发布版本。白板仍仅讨论，不实施。
