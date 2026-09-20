# 阅读列表易用性优化（青帆，2026-09-20）

任务：ebe8db12-e67a-4fa8-9808-a74b78eb734d。

## 修改

- 展开/关闭按钮热区 34×34px，图标 18px；补齐悬停、按下、可见键盘焦点，关闭按钮常显。
- 保留独立原生按钮和既有关闭回调，不删除文献或笔记，不改宿主未保存保护。
- 标题下一行显示资源类型标签与笔记数；类型来自宿主 tab.kind 与文献 PDF 元数据，不从标题猜测。
- 现有阅读场景只接入 PDF；无 PDF 的文献项显示未知类型。Markdown 是组件契约测试，未新增应用文件格式支持。
- 窄侧栏允许元数据换行，保留长标题省略及完整提示。

代码：src/features/reader/ReaderSceneSidebar.tsx、src/features/paper-notes.css、src/ui/App.tsx（仅阅读列表映射增加元数据）。

## 隔离与证据

分支 fix/reader-list-qingfan；worktree .worktrees/reader-list-qingfan；基线 main 4b4f57a。
独立 npm ci；独立浏览器 profile、动态回环端口；仅合成样例，不连接用户资料库。
已下载并查看原附件 image-3.png；原图中的红圈分别标出展开与关闭按钮。

- 基线：.a4-tests/reader-list/reader-list-2026-09-20T12-37-08-503Z。
- 最终组件浏览器证据：.a4-tests/reader-list/reader-list-2026-09-20T12-39-27-781Z。
- 执行：node scripts/verify-reader-list-browser.mjs；22 项通过，0 失败，包括320/220px、热区、无横向溢出、展开/标题/关闭不串动作、零笔记、键盘、悬停/按下/焦点、长标题、重开类型标签。
- 浏览器首轮16项中的Enter/Space失败来自CDP Enter缺少字符文本；补充回车字符后通过，不把探针修正称为产品修复。
- 最终 npm run build、npm run test:architecture、npm run test:agent-status、git diff --check 通过；编辑器目标文件诊断0。
- PowerShell npm run verify 退出0，日志末尾 A4Note verification passed；Rust 198通过、5忽略、0失败。独立构建生成的 src-tauri/gen/schemas 不提交。

## 未验证边界

此证据是实际React组件及应用CSS在独立Chrome中的表现，不是完整Tauri阅读窗口或安装版。
未做真实文献/原生保存/系统DPI/未保存弹窗的端到端测试；对应宿主逻辑未更改。
未打包、安装、推送、发布或自行归档。按用户明确授权，验证完成后合并本地main。
