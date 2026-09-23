# 图片本地托管任务：实现进度（未交付）

任务：d3cdee12-3c10-4383-b94e-dda8bf829664，领取 spec 1 / revision 2。
分支：fix/markdown-managed-images-arena-board，独立 worktree 基线 b427f75。

## 范围与执行顺序

用户授权逐个完成任务，随后尝试打包、推送和发布。当前只领取图片任务；总览字段联动、页码控件、论文菜单仍未领取，不抢占在线 Agent 的阅读器面板任务。发布必须单独执行，不能把未完成实现打进正式版本。白板仍仅讨论。

## 已实现的独立部分

- `src/core/managedImageInsertion.ts`：不依赖浏览器/文件系统的写盘后插入事务。绑定稳定文档身份、单调编辑代次、选区；异步过程中切文档、改选区、编辑或撤销导致事务失效，不把引用插进另一文档。
- 单次批量图片全部写入成功才提交一次正文修改；混合纯文本一起提交；失败不改正文；并发导入拒绝且可重试。失效后不擅自删除已生成资产（可能被其他文档引用）。
- 托管引用格式检查拒绝绝对路径、URL、data URI、穿越及非法格式；为同名资源目录的非 ASCII 字符编码，转义 alt 文本。
- `scripts/verify-managed-image-insertion.mjs`：52 项纯事务断言通过。测试使用模拟写盘，不是后端落盘或真实 ClipboardEvent 证明。
- `tsc -b`、architecture boundary、`npm run build`、agent-status 和 `git diff --check` 通过。构建仍有大分块与动态/静态混合导入警告，不等同于无警告；尚未运行完整 verify。

## 源码调查与必须完成的剩余工作

1. 共享 CodeMirror 当前没有图片粘贴写盘通路。ReaderMarkdown 和 MarkdownResourceTab 的图片按钮仍用 data URI。事务模块尚未接线，产品行为尚未改变。
2. `library_summaries.rs` 的现有图片导入只按魔数和 3MB 上限检查；1600 万像素上限目前在前端。新受限后端必须补服务端尺寸/格式校验，不能把前端校验当成安全边界。
3. 现有 summary-assets 路径检查处理 symlink/越界 canonical path，但需补 Windows reparse 的显式拒绝和新接口边界测试；普通笔记按 paperId 隔离，复用资料维护/备份闸门。
4. 独立 Markdown 应写文件旁同名 `.assets` 目录。现有通用文件接口接受绝对路径，不能直接把它当作新图片接口的已授权工作区边界。需要完成授权来源、文件身份、只读、symlink/reparse 和原子新建的设计与实现。
5. Reader 数据库笔记没有磁盘父路径；编辑与阅读须显式携带 paperId / noteId / 是否总览的资源上下文。共享加载器当前只有磁盘路径解析，尚未接入托管解析。
6. 接入真实 ClipboardEvent、按钮、忙碌/失败提示、文档切换 epoch、混合内容规则与重试；保留纯文本、旧 data URI 和合法旧链接，不自动迁移。
7. 与 7603aaaf 协调字段内外图片、紧凑缩略图和放大查看；不推断自由图片归属。不要覆盖 3932f561 的阅读器布局修改。
8. 补后端/浏览器测试，隔离 dev:live 三类入口前后、重开、离线、错误与竞态证据；完整 PowerShell verify、双状态更新、干净 main 安全合并，再 submit。当前没有这些完成证据。

## 发布预检（只读）

- origin：git@github.com:AustinSuun/A4Note.git。
- `gh release list --repo AustinSuun/A4Note --limit 5` 成功，查询时最新正式发布 v0.1.29；源码版本 0.1.30。
- 后续版本须重新检查远端 tag / Release / main 状态，不假设预检永久有效。
- 标准命令 `npm run package:windows`；使用隔离 Cargo 构建和 artifacts/windows/latest，不拷贝根目录 EXE、不覆盖已发布资产。
- 当前未执行新打包、推送、发布、安装；未将本任务合并 main 或提交验收。此文档是工作进度，不是完成报告。
