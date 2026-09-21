# 阅读器重叠高亮选区修复（青砚，2026-09-21）

## 任务

- 项目任务：`3128932d-e502-4c91-b543-3c5c1739ea5c`
- 分支：`fix/reader-overlap-highlight-qingyan`
- 范围：修复从已有高亮上开始或拖过已有文字标注时，浏览器原生文本选区被标注命中层截断的问题。

## 根因与实现

- 持久化高亮/下划线使用 `.annotation-mark` 命中框，位于 PDF 文本层上方；其 `mousedown` 会阻止默认行为与冒泡，因此浏览器不能从已有标注内部开始或继续文本选择。
- 仅在 `highlight-mode` 或 `underline-mode` 下，使已有 `highlight`/`underline` 命中框不参与指针命中，让事件落到真实 PDF 文本层。
- 光标模式继续保留 `.annotation-mark { pointer-events: auto; }`，因此重叠标注仍可选择、改色、删除；文本框、图形、拖动把手和行内操作不受该规则影响。

## 自动化验证

- `npm run test:reader`：通过；源码契约同时锁定文字选择模式的穿透规则和普通模式的交互规则。
- `OVERLAP_ONLY=1 MODAL_PHASE=after node scripts/verify-pdf-text-annotation-browser.mjs`：9/9 通过。
  - 从已有高亮内部反向拖选并穿过该高亮，成功创建第二条重叠高亮。
  - 新标注 quote 同时包含重叠区域两侧文字，几何独立。
  - 高亮模式命中真实 PDF 文本层；切回光标模式后命中标注层。
- 证据：`.tmp/pdf-text-annotation/after/after-overlapping-highlight.png` 与同目录 `result.json`（不进入提交）。

## 边界

- 未安装、打包、发布或重启正式服务；未读取或修改正式资料库。
- 使用合成 PDF 和隔离验证数据，不把测试数据或截图纳入代码提交。

