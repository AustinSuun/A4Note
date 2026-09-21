# 阅读器拖选色带与高亮辨识度修复（Arena，2026-09-21）

## 任务与边界

- 任务：`35496a06-c546-4462-ad78-c3e8e0574b2f`。
- 分支：`fix/reader-selection-band-arena`；接管时已有提交 `b79ba58`、`6b507e8`，工作树干净，本轮保留并复核既有实现。
- 目标：让拖选中的临时色带与落地高亮使用同一套自适应字形几何，并提高黄/绿/蓝/紫预设色辨识度；不改变 Range、quote、复制、跨页选择、下划线位置或旧标注数据。
- 约束：未安装、未发布、未重启 4319、未操作正式资料库；原生检查使用 `.tmp/f5` 下独立身份、独立 HOME/AppData/WebView2 profile 和隔离 SQLite。

## 实现

### 临时选区与落地高亮共用几何

- `PdfReader` 监听原生 `selectionchange`，通过现有 `textSelectionDraft` 把真实 Range 按页裁剪，并复用 `textSelectionRectsFromOffsets`、方向识别、分行合并和 `highlightPositionStyle`。
- 临时选区作为只读 `selectionPreview` 进入 `AnnotationOverlay`/`PdfHighlightLayer`；落地时仍由同一个 `textSelectionDraft` 生成标注，因此同一文字运行的临时/持久矩形完全一致。
- 浏览器 `::selection` 只隐藏绘制，不修改真实 Range、命中盒或复制文本；`forced-colors: active` 恢复系统 `Highlight/HighlightText`，保留高对比度可访问反馈。
- 水平及 90/180/270 度均沿字形轴裁切。几何全部以运行盒比例和页面百分比表示，不引入固定 px 高度；脚注、正文、标题及 100%/150%/200% 使用相同比例。
- 预览矩形与持久高亮共用单一 SVG 合成层；重叠区域只合成一次，不因 alpha 重复累积。预览不创建 AnnotationMark 的交互命中区域。

### 高亮颜色与设置兼容

| 项目 | 旧值 | 新值 |
| --- | --- | --- |
| 黄 | `#ffe579` | `#ffd54a` |
| 绿 | `#b9e7c5` | `#8fd9a3` |
| 蓝 | `#b9cef7` | `#8fb9f2` |
| 紫 | `#cbb7ef` | `#bf9cf0` |
| 未保存配置的默认 opacity | 22% | 40% |
| opacity 可调范围 | 10–35% | 10–60% |
| 默认 blend | `multiply` | `multiply`（不变） |

- 只改变缺省值；localStorage 中明确保存的 22%、35% 或其他合法旧值继续原样读取，不迁移、不覆盖。
- 白色背景下 40% multiply 的合成色为：黄 `#ffeeb7`、绿 `#d2f0da`、蓝 `#d2e3fa`、紫 `#e5d7f9`；最小两两 CIE76 ΔE = 12.33，最小背景差 ΔE = 16.70。
- 米色 `#f5f0e6` 下合成色为：黄 `#f5e0a5`、绿 `#cae2c5`、蓝 `#cad6e1`、紫 `#dccbe1`；最小两两 ΔE = 11.98，最小背景差 ΔE = 15.82。
- multiply 对黑色正文的计算结果仍为 `#000000`，不会把黑色细笔画漂白；选中态继续依赖边框/焦点反馈，而非整体加深。

## 自动化验证

- `npm run test:pdf-selection-preview`：37 assertions passed。
- `node scripts/verify-pdf-highlight.mjs`：57 assertions passed。
- `npm run test:reader`：passed。
- `npm run test:pdf-rotated-text`：142 assertions passed。
- `npm run test:pdf-crosspage-selection`：31 assertions passed。
- `npm run verify`：exit 0；包含 TypeScript/Vite build、全部前端验证及 Rust `209 passed; 0 failed; 5 ignored`。
- `get_diagnostics(.worktrees/fix-selection-band-arena, error+warning)`：0。
- 几何契约覆盖脚注/正文/标题和四方向：同一运行的 preview/persisted top、bottom 差值为 0%，满足各不超过运行高度 8% 的门槛；带宽保持运行盒字形轴的约 50–60%，缩放不改变页面百分比几何。

## 原生隔离证据

- 接管前已有原生 `arena-f5` 驱动和静态 debug exe；首次运行确认隔离身份，但任务指定的根目录 `2505.13447v1.pdf` 经 PDF.js 直接校验为 `InvalidPDFException: Invalid PDF structure`，`2505.13447v1-仅译文.pdf` 不存在，故该失败运行不作为效果证据。
- 为避免冒充指定样本已通过，后续原生复核改用合成的可搜索多字号 PDF（28pt 标题、14pt 正文、8pt 脚注）、仓库内有效指南及合成 `/Rotate 90` fixture，仍沿用独立 profile/SQLite。
- 多字号原生运行完成 9 组测量（100%/150%/200% × 标题/正文/脚注）：49 项通过；每组 preview 与落地高亮的 DOM top/bottom 差值和像素扫描差值均为 0%，色带高度为运行盒约 54%，相邻行不串色。作为对照，浏览器原生但已隐藏的选择盒每条边与落地色带相差约 38%–48% 运行高度，验证了用户截图中的旧高度跳变。
- 有效指南运行成功打开 Reader；合成旋转页的临时竖向色带与落地色带矩形完全一致，并留下 `30-rotated-mid.png`、`31-rotated-after.png`。
- 原生驱动在颜色阶段执行 `Page.reload` 后，隔离数据库路径被测试壳释放，导致颜色/后续 SQLite 阶段报告 2 项 harness failure；没有把这两项冒充通过。颜色辨识度改由 57 项纯函数/持久化契约、完整 verify 和上述 CIE76 数值覆盖。译文 PDF 缺失，因此中文指定样本和四预设原生同屏截图仍列为未完成验证；提交进入 review 而非宣称全部原生验收完成。

## 交付状态

- 功能提交：`b79ba58`、`6b507e8`；本报告和两个状态文件将在交付提交中补齐。
- 合并前需复核分支相对最新本地 `main`、运行 `git diff --check` 与 `npm run test:agent-status`；合并提交与精确 delivery JSON 记录在任务提交结果中。
