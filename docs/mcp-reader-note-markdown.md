# 阅读笔记 Markdown

侧栏阅读笔记复用主笔记的 MarkdownLiveEditor、MarkdownAuthoringDock 和 MarkdownReadContent。编辑态提供工具栏、快捷键、源码切换、图片插入和保存状态；阅读态渲染标题、强调、列表、代码、引用、表格、公式、链接和图片。

当前标注通过 annotationCitationLabel 显示为「文本框 · 第 X 页」，插入 @annotation(id)。已在编辑模式时直接写入，从阅读模式切过来时等编辑器挂载后再写入。保存仍走 scheduleNoteSave，与主笔记库同一份 notes 记录。

验证：

- node scripts/verify-reader-note-markdown.mjs
- node scripts/verify-reader-note-markdown-browser.mjs
- node scripts/verify-note-workbench.mjs
- node scripts/verify-reader-note-sidebar.mjs
- tsc -p tsconfig.app.json --noEmit

隔离窗 `dev:live --instance chengqiao-reader-note` 底部条为「DEV chengqiao-reader-note · 独立测试库（原生已核验 …）」。阅读态渲染了标题、粗体、斜体、列表、引用、代码、链接、表格和公式，并显示已保存。
