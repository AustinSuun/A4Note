# 阅读器高亮/下划线基线定位修复（巡舟，2026-09-22）

## 任务

- 任务：`a35a4c83-05ab-4949-8383-6e20f563ba27`
- 分支：`fix/reader-highlight-underline-xunzhou`
- 实现提交：`983f3f7cd85329855b079e884e81ebe7e79d78aa`
- 同步主线提交：`ae13047`（将 `main` 的 `d726c5d` 合入任务分支）

## 结论

PDF.js 文字 transform 的锚点现在按基线解释，不再把它误当作包含降部的字框底边。高亮在基线/降部一侧按字形轴扩展 20%，完整覆盖 `g/y/p/q/j` 与标点；下划线移动到基线外侧并保留随缩放增长的间隙，不再横切英文小写或中文字身。0°、90°、180°、270° 四个方向使用同一方向感知规则。

拖选预览继续复用持久标注的 `textSelectionDraft → segments → highlightPositionStyle` 管线，因此创建前后几何一致，无跳变。未修改标注数据结构或迁移旧数据；颜色、透明度/混合、重叠标注交互、文本框、形状、箭头与橡皮路径保持不变。

## 几何契约

- 选择段仍保存 PDF 上升区间：`[baseline - ascent, baseline]`。
- 四向基线边：0° 为 bottom、90° 为 left、180° 为 top、270° 为 right。
- 高亮：完整上升区间，并只在基线/降部侧扩展 `0.20 × glyph-axis extent`。
- 下划线间隙：`clamp(0.04 × glyph-axis extent, 0.02%, 0.12%)`。
- 下划线厚度：`clamp(0.08 × glyph-axis extent, 0.05%, 0.42%)`；多段仍保留中位数统一线宽规则。
- helper 坐标直接表示可见下划线框；CSS 不再向上平移或强制竖向 2px 宽度。

## 代表性测量

使用 18px 字形轴夹具：

| 缩放 | 字形轴 | 高亮总尺寸 | 降部扩展 | 下划线间隙 | 下划线厚度 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100% | 18px | 21.6px | 3.6px | 0.72px | 1.44px |
| 150% | 27px | 32.4px | 5.4px | 1.08px | 2.16px |
| 200% | 36px | 43.2px | 7.2px | 1.44px | 2.88px |

精确机器可读结果：`.tmp/task-evidence/measurements.json`。

## 视觉证据

- 旧/新 100% 对比：`.tmp/task-evidence/reader-baseline-before-after-100.png`
- 修复后 100% / 150% / 200%：`.tmp/task-evidence/reader-baseline-after-zooms.png`
- 四方向逐图：`.tmp/task-evidence/after/{100,150,200}pct/`

位图夹具使用代表性降部与标点，逐缩放验证四方向墨迹、高亮和下划线相对位置。对比图已目视检查：高亮包含基线下方墨迹；下划线与字身之间存在可见呼吸间隙；相邻行未被侵入。

## 修改范围

- `src/features/reader/pdf/pdfGeometry.ts`
- `src/features/reader/pdf/pdfAnnotationHelpers.ts`
- `src/ui/styles/reader.css`
- `scripts/verify-reader-helpers.mjs`
- `scripts/verify-pdf-highlight.mjs`
- `scripts/verify-pdf-selection-preview.mjs`
- `scripts/verify-reader-rendering.mjs`
- `scripts/verify-pdf-rotated-text-layer.mjs`

实现与测试共 8 个文件，136 行新增、92 行删除。

## 验证

- `node scripts/verify-reader-helpers.mjs`：通过。
- `npm run test:reader`：通过。
- PDF selection preview：37/37。
- PDF highlight appearance：57/57。
- PDF rotated text layer：100%、150%、200% 各 151/151。
- 合入最新 `main` 前完整 `npm run verify`：通过；Settings UI 115/115；Rust 215 passed、0 failed、5 ignored；project-task 86 passed、1 platform skip。
- `git diff --check`：通过。
- MCP diagnostics：0 errors、0 warnings。

已知输出仅有既有编译/构建、canvas polyfill 与 chunk-size 警告，无新增失败。
