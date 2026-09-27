# 资料库文件位置提示样式交付记录（巡川）

- 任务 `6ee1e545-3d31-4682-8c45-a59499075f00` spec 1，独立分支 `fix/library-storage-notice-xunchuan`，初始本地 main `5597956`。实施前核对了 review 中的 `6557dc15` 资料库存储实现；仅修改 `LibraryStorageNotice.tsx` 和该组件的 CSS，不改推荐目录、路径内容、迁移命令、文案语义或「保持默认」行为。
- 路径改为普通内联 `span`，沿用同段文字的 `font-family` / `font-size` 与界面 `--ink`，安全断词；不再使用 `code` 元素的等宽字形。绿色主按钮和中性次按钮同高、对齐、共用 UI 字号、项目圆角及语义色，增加显式 hover、focus-visible、disabled 状态；仅限定在提示组件。

## 原生隔离证据

- `dev:live -- --instance xunchuan-storage --port 1486 --cdp-port 9386`，原生身份 `app.aster.research.dev.xunchuan-storage.w99dd53c96d`。原生 WebView 测试 `node scripts/verify-library-storage-notice-live.mjs` 最终 21 项通过，`pageerrors=[]`、`consoleErrors=[]`；长 Windows 路径两处计算样式与段落严格相同，按钮可焦点/悬停/禁用，原生迁移选择、迁回默认位置及默认保留的永久隐藏均在该独立身份内完成。
- 本任务卡已上传带 `DEV xunchuan-storage · 独立测试库` 状态条的有效截图：`before.png`、`after-light-100pct.png`、`after-dark-1100-ui125pct.png`（宽 1100、界面字号 125%）、`after-light-980-ui150pct.png`（宽 980、界面字号 150%）。与项目原生最小窗口宽度 980px 一致；125%/150% 是软件界面字体尺度的实际 WebView 检查，不宣称测试过未授权的 WebView 浏览器内核缩放。
- 先前上传的 `after-dark-680-125pct.png` / `after-light-540-150pct.png` 用了低于应用 980px 最小窗口的人工视口，整张应用会被裁切且主题标题与捕获帧错位，**不作验收证据**；已上传两张清晰标注的有效窗口截图替代。尝试单独测试内核缩放时发现正式应用未授予 `core:webview:allow-set-webview-zoom`；临时测试权限和自动生成文件已在提交前还原，未扩大交付权限。

## 验证

- `npm run test:architecture`、`npm run build`、`npm run test:library-storage-browser`（31/31）、`npm run test:dev-live`、原生21项、源码诊断0 和 `git diff --check` 均通过。
- 首次完整 `npm run verify` 的唯一失败是无关的 `test:reader-page-control-browser` 遇到 Vite `504 Outdated Optimize Dep`，当时 dev:live 实例和浏览器测试并行。停用实例后该测试定向复跑 59/59 通过；从 PowerShell 完整复跑退出 0（Rust 238 通过、0 失败、5 忽略），最终日志 `.tmp/storage-notice-verify-final.log`。
- 不打包、安装、推送、发布或自行验收归档；本地 main 合入哈希以任务卡结果为准。
