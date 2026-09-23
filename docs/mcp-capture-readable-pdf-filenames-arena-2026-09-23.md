# 浏览器采集 PDF 的可辨识文件名与译文存放规则

日期：2026-09-23。范围：桌面端接收插件采集文件时的**新入库 PDF**；用户选择不迁移已有文件、不修改译文导入命名或位置。

## 现状与改动

- 旧采集目录为 `AsterData/files/papers/<paperId>/captures/<captureId>/<完整 SHA-256>.pdf`。目录 ID 用于稳定定位采集、重试和去重，不改动。
- 新采集 PDF 在同一目录中使用 `<论文标题> - 原文 - <SHA-256 前 16 位>.pdf`。同一论文后续全文使用“其他版本”，补充 PDF 使用“补充材料”。可信标题来自论文记录；未有标题时按采集到的 arXiv、DOI，最后用“论文”兜底，不编造网页标题。
- `src-tauri/src/capture/ingest.rs` 在写入前处理 Windows 非法字符、控制字符和双向文本控制符，限制整个文件名不超过旧 64 位哈希加 `.pdf` 的 68 个 UTF-16 单元，降低旧 Windows 路径过长风险。完整 SHA-256 仍写入 `paper_files.content_hash` 并用于原有验证/去重；同名但哈希不符时拒绝覆盖。非 PDF 附件继续沿用原哈希文件名。
- 旧文件名及数据库路径**保持原样**；再遇相同内容按数据库哈希复用旧文件，不对真实资料库执行迁移或批量重命名。源码变更需后续构建并安装新版桌面程序才会体现在实际采集；只重载插件不会生效。

## 译文 PDF 的既有规则（未改动）

- 文献详情的“导入译文 PDF”须指定**已有论文**，复制用户所选 PDF 到 `AsterData/files/papers/<paperId>/translated.<语言或manual>.<fileId>.pdf`；不移动外部原文件，也不放进 `captures/<captureId>`。
- 在 `paper_files` 中以同一个 `paperId` 登记独立的 `translated_pdf`/`fileId`。可绑定多份译文；加载未指定译文时按 `created_at` 取最新记录，原文/译文分别绑定各自文件 ID 及标注。该论文在文献库中的文件夹分类不因导入译文改变。
- 插件捕获的全文/补充 PDF 不会仅因下载网址含“翻译”自动归类为译文；要作为译文阅读，应在目标论文详情中使用桌面端“导入译文 PDF”。

## 验证与边界

- `cargo test --manifest-path src-tauri/Cargo.toml capture::ingest_tests --lib`：8/8 通过，覆盖新原文/版本名、缺标题兜底、Windows 字符与长度、旧哈希文件复用、同名不覆盖、译文仍与同篇论文关联且在父目录。执行前用 `node scripts/prepare-native-host.mjs --debug` 准备测试用资源；初次直接 cargo test 因缺少该资源无法进入测试。
- 隔离工作树执行 `npm run verify` 退出 0（包含前端构建、插件采集/原生辅助测试、状态测试和 Rust 220 项通过、5 项忽略）；完整验证会自动准备测试用 native-host 资源。
- 不曾扫描或改写真实用户资料库；不自动安装、打包、推送或发布。合并 SHA 由交付记录给出。
