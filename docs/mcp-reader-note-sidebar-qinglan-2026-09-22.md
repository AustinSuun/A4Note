# 阅读器笔记侧栏重构（青岚，2026-09-22）

任务：`bcd4de7e-8922-4abc-a577-f04df4590c37`（spec 9）。

## 实现

- 笔记为活动面板时不再渲染 `reader-workspace-header`，顶部“笔记 / 关闭 / +”整行及高度从 DOM 消失；其它 Reader 面板仍保留多标签头。
- 原标题输入与右侧文档计数、独立新增按钮合并为单一文档选择触发器。列表仅取当前 `paper.notes`，支持 0/1/12+ 文档、滚动、长标题省略、当前项选中态、ArrowUp/ArrowDown/Home/End、Escape 与外点关闭。
- “新建文档”“重命名当前文档”“打开/新建总览笔记”统一放入文档下拉。重命名继续写入同一个 Library note session；新建和切换先 flush 当前会话，并由 `switchingRef` 阻止重复异步操作。
- 删除 `Markdown · 普通笔记 / 打开总览笔记` 状态行；保存状态移入紧凑文档栏。总览关系与创建能力未删除。
- 编辑正文继续复用 `MarkdownLiveEditor`、Library note session、自动保存、撤销历史和标注引用跳转。最右侧标题栏入口随整行移除；全局 `ReaderNoteWorkbenchMenu` 仍是独立的开关/恢复路径，因此侧栏不会失去重新打开能力。
- 新选择器视觉使用 `--surface`、`--surface-soft`、`--line`、`--accent-*` 等共享主题 token，并尊重 reduced motion。

## 验证

- `npx tsc -b --pretty false`：通过。
- `npm run build`：通过。
- `npm run test:reader-note-sidebar`：16/16。
- `npm run test:reader-note-sidebar-browser`：真实 React `MarkdownNotePanel`，12 文档、长标题、键盘 End/Escape、焦点回退、重命名、新建自动切换、深色 125%，pageerror/console error 0。
- `npm run test:note-workbench`：51/51。
- `npm run test:note-workbench-browser`：42/42。
- `npm run test:reader`：通过。
- VS Code diagnostics（Reader 范围 error/warning）：0。
- 完整 `npm run verify`：退出 0，`A4Note verification passed`；Rust 215 passed / 5 ignored。
- Browser 证据：`.tmp/shots/reader-note-sidebar/2026-09-22T12-39-50-170Z`。

原生 `dev:live` 经命令桥后台启动后未保持 CDP 端口，因此本轮不把浏览器组件证据冒充原生截图；未修改正式资料库，未打包、安装、推送或发布。
