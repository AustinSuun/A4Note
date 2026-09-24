# 文献库右键打开 PDF 所在文件夹

用户要在文献库列表右键菜单增加「打开论文 PDF 所在文件夹」。结论：可以做，复用已有定位能力，不要新写路径或 shell。

## 现状

列表右键菜单是 `src/features/library/PaperContextMenu.tsx`，由 `src/features/library/LibraryScene.tsx` 的表格行 `onContextMenu` 打开。现有项是阅读、详情、关系、设置文件夹、编辑论文信息、编辑标签、导入译文 PDF、复制 BibTeX、删除论文。没有打开 PDF 文件夹。

详情面板已经有「显示」。它调用 `onRevealSourcePdf`，经 `src/platform/nativeApi.ts` 的 `revealPaperFile` 到原生 `reveal_paper_file`。该命令按资料库记录解析原文 PDF，再用资源管理器打开父目录，不是用默认程序打开 PDF，也不是在资源管理器里选中文件。外部打开才是 `open_paper_file`。

右键会先选中该行。菜单回调目前使用当前选中论文。新项必须作用在被右键的那一篇。没有原文时详情按钮已禁用；非 Tauri 预览只提示浏览器预览。

## 范围

只加原文 PDF 所在文件夹。译文 PDF 的「显示」留在详情里，不放进这个菜单项。
